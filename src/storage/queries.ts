/**
 * Read queries over the index. Sessions are listed flat or grouped by project,
 * sortable by date, duration, or message (turn) count. Token columns are
 * reassembled into {@link TokenUsage}; a single summed total is never exposed.
 */

import type { LensIndex } from './db.ts';
import type { ListOptions, ProjectGroup, SessionListItem, SortBy, SortOrder, TurnRow } from './types.ts';

const SELECT_SESSIONS = `
  SELECT id, project_path, started_at, ended_at, turn_count, record_count,
         tok_input, tok_output, tok_cache_write, tok_cache_read, git_branch, title
  FROM sessions
`;

/** Parse an ISO timestamp to ms, or null if unparseable. */
function toMs(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Map a raw sql.js row (column order matches SELECT_SESSIONS) to a list item. */
function rowToItem(row: unknown[]): SessionListItem {
  const started = String(row[2] ?? '');
  const ended = String(row[3] ?? '');
  const s = toMs(started);
  const e = toMs(ended);
  const duration_ms = s !== null && e !== null && e >= s ? e - s : 0;
  return {
    id: String(row[0]),
    project_path: String(row[1] ?? ''),
    started_at: started,
    ended_at: ended,
    turn_count: Number(row[4] ?? 0),
    record_count: Number(row[5] ?? 0),
    tokens: {
      input: Number(row[6] ?? 0),
      output: Number(row[7] ?? 0),
      cache_creation: Number(row[8] ?? 0),
      cache_read: Number(row[9] ?? 0),
    },
    git_branch: row[10] === null || row[10] === undefined ? null : String(row[10]),
    title: row[11] === null || row[11] === undefined ? null : String(row[11]),
    duration_ms,
  };
}

/** Comparator for the requested sort key. */
function comparator(sortBy: SortBy, order: SortOrder): (a: SessionListItem, b: SessionListItem) => number {
  const dir = order === 'asc' ? 1 : -1;
  return (a, b) => {
    let d: number;
    if (sortBy === 'duration') d = a.duration_ms - b.duration_ms;
    else if (sortBy === 'messages') d = a.turn_count - b.turn_count;
    else d = (toMs(a.started_at) ?? 0) - (toMs(b.started_at) ?? 0); // 'date'
    return d * dir;
  };
}

/** List all sessions, sorted. Defaults: by date, descending (newest first). */
export function listSessions(index: LensIndex, opts: ListOptions = {}): SessionListItem[] {
  const res = index.db.exec(SELECT_SESSIONS);
  const rows = res[0]?.values ?? [];
  const items = rows.map(rowToItem);
  items.sort(comparator(opts.sortBy ?? 'date', opts.order ?? 'desc'));
  return items;
}

/** Fetch one session row by id, or null if it does not exist. */
export function getSession(index: LensIndex, id: string): SessionListItem | null {
  const stmt = index.db.prepare(`${SELECT_SESSIONS} WHERE id = ?`);
  try {
    stmt.bind([id]);
    if (!stmt.step()) return null;
    return rowToItem(stmt.get());
  } finally {
    stmt.free();
  }
}

/**
 * All turn rows of one session, ordered by timestamp then id. This is raw shard
 * order — the server's session-detail assembly applies the record-tree ordering.
 */
export function getSessionTurns(index: LensIndex, sessionId: string): TurnRow[] {
  const stmt = index.db.prepare(`
    SELECT id, record_uuid, parent_id, role, type, content, tool_name, timestamp
    FROM turns WHERE session_id = ? ORDER BY timestamp, id
  `);
  const rows: TurnRow[] = [];
  try {
    stmt.bind([sessionId]);
    while (stmt.step()) {
      const r = stmt.get();
      rows.push({
        id: String(r[0]),
        record_uuid: String(r[1]),
        parent_id: r[2] === null || r[2] === undefined ? null : String(r[2]),
        role: String(r[3]) as TurnRow['role'],
        type: String(r[4]) as TurnRow['type'],
        content: String(r[5] ?? ''),
        tool_name: r[6] === null || r[6] === undefined ? null : String(r[6]),
        timestamp: String(r[7] ?? ''),
      });
    }
  } finally {
    stmt.free();
  }
  return rows;
}

/** List sessions grouped by project. Groups are ordered by their most-recent session. */
export function listByProject(index: LensIndex, opts: ListOptions = {}): ProjectGroup[] {
  const items = listSessions(index, opts);
  const groups = new Map<string, SessionListItem[]>();
  for (const item of items) {
    const bucket = groups.get(item.project_path);
    if (bucket) bucket.push(item);
    else groups.set(item.project_path, [item]);
  }
  const out: ProjectGroup[] = [];
  for (const [project_path, sessions] of groups) out.push({ project_path, sessions });
  // Order groups by their newest session's start time, descending.
  out.sort((a, b) => {
    const an = Math.max(...a.sessions.map((s) => toMs(s.started_at) ?? 0));
    const bn = Math.max(...b.sessions.map((s) => toMs(s.started_at) ?? 0));
    return bn - an;
  });
  return out;
}
