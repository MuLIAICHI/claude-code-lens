/**
 * `cc-lens scan` — the only place with filesystem I/O.
 *
 * Walks the projects directory for `*.jsonl` files, hands each file's raw lines
 * to the pure parser, aggregates {@link ScanStats}, and prints them. No network.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

import { resolveProjectsDir, type ResolveOptions } from '../config.ts';
import { parseSession, type FileMeta } from '../parser/parse.ts';
import { addTokens, emptyTokens, type ScanStats } from '../parser/types.ts';

/** Recursively collect `*.jsonl` file paths under `dir`. */
function findJsonlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findJsonlFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

/** Best-effort decode of a Claude Code project dir name (`-a-b-c` → `/a/b/c`). */
function decodeProjectDir(name: string): string {
  return name.startsWith('-') ? name.replace(/-/g, '/') : name;
}

/** Run a scan and return the aggregate stats. Pure-ish: reads files, no writes, no network. */
export function runScan(opts: ResolveOptions = {}): ScanStats {
  const projectsDir = resolveProjectsDir(opts);
  const files = findJsonlFiles(projectsDir);

  const stats: ScanStats = { sessions: 0, turns: 0, by_project: {}, tokens: emptyTokens(), skipped_total: 0 };

  for (const file of files) {
    const rel = file.slice(projectsDir.length + 1);
    const projectDirName = rel.split('/')[0] ?? '';
    const meta: FileMeta = {
      fallbackId: basename(file, '.jsonl'),
      fallbackProject: decodeProjectDir(projectDirName),
    };
    let lines: string[];
    try {
      lines = readFileSync(file, 'utf8').split('\n');
    } catch {
      continue; // unreadable file — skip, never crash the whole scan
    }
    const { session, skipped } = parseSession(lines, meta);
    stats.skipped_total += skipped.malformed + skipped.nonConversation + skipped.unknownType;
    if (session) {
      stats.sessions += 1;
      stats.turns += session.turn_count;
      addTokens(stats.tokens, session.tokens);
      const key = session.project_path || meta.fallbackProject;
      stats.by_project[key] = (stats.by_project[key] ?? 0) + 1;
    }
  }
  return stats;
}

/** Format the stats as the human-facing terminal report. */
export function formatStats(stats: ScanStats, projectsDir: string): string {
  const lines: string[] = [];
  lines.push(`Lens for Claude Code — scan of ${projectsDir}`);
  lines.push('');
  const n = (v: number): string => v.toLocaleString('en-US');
  lines.push(`  Sessions:      ${stats.sessions}`);
  lines.push(`  Turns:         ${stats.turns}`);
  lines.push(`  Skipped recs:  ${stats.skipped_total}`);
  lines.push('');
  lines.push('  Tokens (broken out — a single sum would be dominated by cache reads):');
  lines.push(`    input:          ${n(stats.tokens.input)}`);
  lines.push(`    output:         ${n(stats.tokens.output)}`);
  lines.push(`    cache write:    ${n(stats.tokens.cache_creation)}`);
  lines.push(`    cache read:     ${n(stats.tokens.cache_read)}`);
  lines.push('');
  const projects = Object.entries(stats.by_project).sort((a, b) => b[1] - a[1]);
  lines.push(`  Projects (${projects.length}):`);
  for (const [project, count] of projects) {
    lines.push(`    ${String(count).padStart(4)}  ${project}`);
  }
  return lines.join('\n');
}
