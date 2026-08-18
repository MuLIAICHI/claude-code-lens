/**
 * Read queries over the index. Sessions are listed flat or grouped by project,
 * sortable by date, duration, or message (turn) count. Token columns are
 * reassembled into {@link TokenUsage}; a single summed total is never exposed.
 */

import type { LensIndex } from './db.ts';
import type { ListOptions, ProjectGroup, SessionListItem, SortBy, SortOrder } from './types.ts';

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
