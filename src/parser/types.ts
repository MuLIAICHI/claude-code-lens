/**
 * Normalized types for parsed Claude Code session history.
 *
 * Two-level model (grounded in real `~/.claude/projects` data):
 *  - Records form the conversation tree, threaded on `uuid` / `parentUuid`.
 *  - Each record's `message.content` holds one or more blocks; each block
 *    becomes one {@link Turn}. So a single record can yield several Turns.
 *
 * This module is pure types with zero runtime/I/O imports so the parser can
 * later ship as a standalone package.
 */

/** The role that produced a conversation record. */
export type Role = 'user' | 'assistant';

/** The kind of a single content block, normalized across user/assistant records. */
export type TurnType = 'text' | 'thinking' | 'tool_use' | 'tool_result';

/**
 * Token usage broken out by kind. Kept as four separate fields on purpose: a
 * single summed "total" is dominated by `cache_read` (the full context re-read
 * each turn) and misrepresents real usage/cost. Cost-weighting these fields with
 * a pricing table is a later (analytics) concern.
 */
export interface TokenUsage {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
}

/** A zeroed {@link TokenUsage}. */
export function emptyTokens(): TokenUsage {
  return { input: 0, output: 0, cache_creation: 0, cache_read: 0 };
}

/** Add `b` into `a` in place and return `a`. */
export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  a.input += b.input;
  a.output += b.output;
  a.cache_creation += b.cache_creation;
  a.cache_read += b.cache_read;
  return a;
}

/**
 * A parsed session — the normalized form of one JSONL file.
 * `turn_count` counts blocks (Turns); `record_count` counts tree nodes.
 */
export interface Session {
  /** sessionId from the records, or the filename stem as a fallback. */
  id: string;
  /** Human-decoded project path (from cwd/records or the project dir name). */
  project_path: string;
  /** Earliest record timestamp (ISO-8601). */
  started_at: string;
  /** Latest record timestamp (ISO-8601). */
  ended_at: string;
  /** Number of Turns (content blocks) across all conversation records. */
  turn_count: number;
  /** Number of conversation records (tree nodes). */
  record_count: number;
  /** Token usage broken out by kind, summed across assistant records. */
  tokens: TokenUsage;
  /** Git branch captured on the records, if present. */
  git_branch: string | null;
  /** Session title from an `ai-title` record, if present. */
  title: string | null;
}

/**
 * A single content block from a user/assistant record.
 * `parent_id` is the RECORD-level parentUuid (tree edge), shared by sibling
 * blocks of the same record.
 */
export interface Turn {
  /** Stable unique id: `${record_uuid}:${blockIndex}`. */
  id: string;
  /** Owning session id. */
  session_id: string;
  /** The source record's uuid (tree node). */
  record_uuid: string;
  /** The source record's parentUuid (tree edge), or null at the root. */
  parent_id: string | null;
  /** Role of the source record. */
  role: Role;
  /** Normalized block type. */
  type: TurnType;
  /** Text, thinking text, tool input, or stringified tool result. */
  content: string;
  /** Tool name when `type === 'tool_use'`, else null. */
  tool_name: string | null;
  /** Record timestamp (ISO-8601). */
  timestamp: string;
}

/** Skip accounting — the parser counts rather than throws. */
export interface SkipCounts {
  /** Lines that were not valid JSON. */
  malformed: number;
  /** Recognized but non-conversation record types (mode, ai-title, system, ...). */
  nonConversation: number;
  /** Record types not in the known set at all. */
  unknownType: number;
}

/** Result of parsing one file. `session` is null when the file has no conversation records. */
export interface ParseResult {
  session: Session | null;
  turns: Turn[];
  skipped: SkipCounts;
}

/** Aggregate stats across all scanned files — what `cc-lens scan` prints. */
export interface ScanStats {
  sessions: number;
  turns: number;
  /** project_path -> session count. */
  by_project: Record<string, number>;
  tokens: TokenUsage;
  skipped_total: number;
}

/**
 * Top-level record types known to the parser. Only `user` and `assistant`
 * produce Turns in v1; the rest are recognized and skipped (counted).
 * `summary` is a real `/compact` artifact — kept here as known even though it
 * is absent from local fixtures (a documented fixture gap).
 */
export const KNOWN_RECORD_TYPES = [
  'user',
  'assistant',
  'system',
  'summary',
  'attachment',
  'ai-title',
  'last-prompt',
  'mode',
  'file-history-snapshot',
  'queue-operation',
] as const;

export type KnownRecordType = (typeof KNOWN_RECORD_TYPES)[number];
