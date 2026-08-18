/**
 * Storage-layer types. Reuses the parser's {@link TokenUsage} — the persisted
 * token columns reassemble into it, never a single summed total (ADR-001).
 */

import type { TokenUsage } from '../parser/types.ts';

/** A session row as returned by the list queries, with computed duration. */
export interface SessionListItem {
  id: string;
  project_path: string;
  started_at: string;
  ended_at: string;
  turn_count: number;
  record_count: number;
  tokens: TokenUsage;
  git_branch: string | null;
  title: string | null;
  /** ended_at - started_at in milliseconds (0 if timestamps are unparseable). */
  duration_ms: number;
}

/**
 * One turn row as served by the detail API. Wire order = display order:
 * parents before children, siblings by timestamp, blocks by block index.
 */
export interface TurnRow {
  /** `${record_uuid}:${blockIndex}` — stable per content block. */
  id: string;
  record_uuid: string;
  parent_id: string | null;
  role: 'user' | 'assistant';
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  content: string;
  tool_name: string | null;
  timestamp: string;
}

/** Full payload for `GET /api/sessions/:id`. */
export interface SessionDetail {
  session: SessionListItem;
  turns: TurnRow[];
}

/** Sort keys for the session list. */
export type SortBy = 'date' | 'duration' | 'messages';

/** Sort direction. */
export type SortOrder = 'asc' | 'desc';

/** Options for the list queries. */
export interface ListOptions {
  sortBy?: SortBy;
  order?: SortOrder;
}

/** Sessions grouped under their project path. */
export interface ProjectGroup {
  project_path: string;
  sessions: SessionListItem[];
}

/** Outcome of an indexing run. */
export interface IndexResult {
  /** Files parsed and written this run (new or changed). */
  indexed: number;
  /** Files unchanged since last index (skipped). */
  skipped: number;
  /** Source files that disappeared and whose rows were pruned. */
  removed: number;
}
