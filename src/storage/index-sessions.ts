/**
 * Incremental indexer, aggregate-by-sessionId model.
 *
 * Claude Code shards ONE conversation (one sessionId) across many `.jsonl` files.
 * The `files` ledger stores each file's PARTIAL aggregate; a `sessions` row is
 * (re)computed by summing all files that share its sessionId. Shard records are
 * disjoint, so summing does not double-count.
 *
 * Source files are opened READ-ONLY; all writes go to the index. A changed shard
 * replaces only its own turns (via `turns.source_file`) and triggers a recompute
 * of its session from the ledger — no re-parse of sibling shards.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

import type { LensIndex } from './db.ts';
import type { IndexResult } from './types.ts';
import { parseSession, type FileMeta } from '../parser/parse.ts';
import type { Session, Turn } from '../parser/types.ts';

/** Recursively collect `*.jsonl` file paths under `dir`. */
function walkJsonl(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonl(full));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

/** Best-effort decode of a Claude Code project dir name (`-a-b-c` → `/a/b/c`). */
function decodeProjectDir(name: string): string {
  return name.startsWith('-') ? name.replace(/-/g, '/') : name;
}

interface LedgerRow {
  mtime_ms: number;
  size: number;
  session_id: string | null;
}

/** Read the `files` ledger (path → mtime/size/session_id) for skip + prune decisions. */
function readLedger(index: LensIndex): Map<string, LedgerRow> {
  const map = new Map<string, LedgerRow>();
  const res = index.db.exec('SELECT path, mtime_ms, size, session_id FROM files');
  for (const row of res[0]?.values ?? []) {
    map.set(String(row[0]), {
      mtime_ms: Number(row[1]),
      size: Number(row[2]),
      session_id: row[3] === null ? null : String(row[3]),
    });
  }
  return map;
}

/** Insert one turn row, tagged with its source file so it can be replaced per-file. */
function writeTurn(index: LensIndex, t: Turn, sourceFile: string): void {
  index.db.run(
    `INSERT OR REPLACE INTO turns
       (id, session_id, source_file, record_uuid, parent_id, role, type, content, tool_name, timestamp)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [t.id, t.session_id, sourceFile, t.record_uuid, t.parent_id, t.role, t.type, t.content, t.tool_name, t.timestamp],
  );
}

/** Store a file's partial aggregate in the ledger (from its per-file parsed Session, or zeros). */
function writeLedger(index: LensIndex, file: string, mtimeMs: number, size: number, s: Session | null, nowIso: string): void {
  index.db.run(
    `INSERT OR REPLACE INTO files
       (path, mtime_ms, size, session_id, turn_count, record_count,
        tok_input, tok_output, tok_cache_write, tok_cache_read,
        started_at, ended_at, title, project_path, git_branch, indexed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      file, mtimeMs, size, s?.id ?? null, s?.turn_count ?? 0, s?.record_count ?? 0,
      s?.tokens.input ?? 0, s?.tokens.output ?? 0, s?.tokens.cache_creation ?? 0, s?.tokens.cache_read ?? 0,
      s?.started_at ?? null, s?.ended_at ?? null, s?.title ?? null, s?.project_path ?? null, s?.git_branch ?? null, nowIso,
    ],
  );
}

/** Recompute (or delete) the `sessions` row for one sessionId by aggregating its ledger files. */
function recomputeSession(index: LensIndex, sessionId: string): void {
  const res = index.db.exec(
    `SELECT COUNT(*), SUM(turn_count), SUM(record_count),
            SUM(tok_input), SUM(tok_output), SUM(tok_cache_write), SUM(tok_cache_read),
            MIN(started_at), MAX(ended_at), MAX(project_path), MAX(title), MAX(git_branch)
     FROM files WHERE session_id = ?`,
    [sessionId],
  );
  const row = res[0]?.values?.[0];
  const fileCount = Number(row?.[0] ?? 0);
  if (!row || fileCount === 0) {
    index.db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    return;
  }
  index.db.run(
    `INSERT OR REPLACE INTO sessions
       (id, project_path, started_at, ended_at, turn_count, record_count,
        tok_input, tok_output, tok_cache_write, tok_cache_read, git_branch, title, file_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      sessionId,
      row[9] === null ? '' : String(row[9]), // project_path
      row[7] === null ? '' : String(row[7]), // started_at (MIN)
      row[8] === null ? '' : String(row[8]), // ended_at (MAX)
      Number(row[1] ?? 0), Number(row[2] ?? 0),
      Number(row[3] ?? 0), Number(row[4] ?? 0), Number(row[5] ?? 0), Number(row[6] ?? 0),
      row[11] === null ? null : String(row[11]), // git_branch
      row[10] === null ? null : String(row[10]), // title
      fileCount,
    ],
  );
}

/**
 * Index every `*.jsonl` under `projectsDir`, incrementally, aggregating by sessionId.
 * Does NOT persist — the caller calls {@link LensIndex.persist} after.
 */
export function indexProjects(index: LensIndex, projectsDir: string): IndexResult {
  const files = walkJsonl(projectsDir);
  const ledger = readLedger(index);
  const seen = new Set<string>();
  const touched = new Set<string>();
  const nowIso = new Date().toISOString();

  let indexed = 0;
  let skipped = 0;
  let removed = 0;

  for (const file of files) {
    seen.add(file);
    let mtimeMs: number;
    let size: number;
    try {
      const st = statSync(file);
      mtimeMs = Math.floor(st.mtimeMs);
      size = st.size;
    } catch {
      continue; // unreadable stat — skip, never crash
    }

    const prev = ledger.get(file);
    if (prev && prev.mtime_ms === mtimeMs && prev.size === size) {
      skipped += 1;
      continue;
    }

    // Changed/new file: drop its old turns, re-parse, re-store. Mark old + new sessions dirty.
    index.db.run('DELETE FROM turns WHERE source_file = ?', [file]);
    if (prev?.session_id) touched.add(prev.session_id);

    let lines: string[];
    try {
      lines = readFileSync(file, 'utf8').split('\n');
    } catch {
      continue;
    }
    const relFirst = file.slice(projectsDir.length + 1).split('/')[0] ?? '';
    const meta: FileMeta = { fallbackId: basename(file, '.jsonl'), fallbackProject: decodeProjectDir(relFirst) };
    const { session, turns } = parseSession(lines, meta);

    if (session) {
      for (const t of turns) writeTurn(index, t, file);
      touched.add(session.id);
    }
    writeLedger(index, file, mtimeMs, size, session, nowIso);
    indexed += 1;
  }

  // Prune ledger entries whose source file no longer exists.
  for (const [path, row] of ledger) {
    if (seen.has(path)) continue;
    index.db.run('DELETE FROM turns WHERE source_file = ?', [path]);
    index.db.run('DELETE FROM files WHERE path = ?', [path]);
    if (row.session_id) touched.add(row.session_id);
    removed += 1;
  }

  // Recompute every session whose shard set changed.
  for (const sessionId of touched) recomputeSession(index, sessionId);

  return { indexed, skipped, removed };
}
