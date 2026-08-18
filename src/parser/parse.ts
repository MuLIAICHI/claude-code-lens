/**
 * Pure JSONL → normalized types parser. No I/O, no network — the CLI layer
 * reads files and hands raw lines here. Never throws on bad input: malformed
 * lines and unknown record types are counted as skips.
 */

import {
  KNOWN_RECORD_TYPES,
  addTokens,
  emptyTokens,
  type ParseResult,
  type Role,
  type Session,
  type SkipCounts,
  type TokenUsage,
  type Turn,
  type TurnType,
} from './types.ts';
import { orderByParent } from './tree.ts';

/** A raw JSONL record — untyped envelope, narrowed as we read it. */
type RawRecord = Record<string, unknown>;

const KNOWN = new Set<string>(KNOWN_RECORD_TYPES);
const CONVERSATION_TYPES = new Set<string>(['user', 'assistant']);

/** Parse one JSONL line. Returns the object, or null if the line is not valid JSON. */
export function parseLine(line: string): RawRecord | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as RawRecord;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A message content block, normalized loosely from the raw record. */
interface RawBlock {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  name?: unknown;
  input?: unknown;
  content?: unknown;
}

/** Map one raw content block to a Turn type + content string. Null = block we don't render. */
function mapBlock(role: Role, block: RawBlock): { type: TurnType; content: string; tool_name: string | null } | null {
  const bt = asString(block.type);
  if (bt === 'text') return { type: 'text', content: asString(block.text) ?? '', tool_name: null };
  if (bt === 'thinking') return { type: 'thinking', content: asString(block.thinking) ?? '', tool_name: null };
  if (bt === 'tool_use') {
    return { type: 'tool_use', content: stringify(block.input), tool_name: asString(block.name) };
  }
  if (bt === 'tool_result') return { type: 'tool_result', content: stringify(block.content), tool_name: null };
  // `image` and any other block type: represent as a text placeholder so nothing is lost.
  if (bt === 'image') return { type: 'text', content: '[image]', tool_name: null };
  void role;
  return null;
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Turn the `message.content` of one record into Turns. Handles the polymorphic
 * shape: `content` is either a plain string (user text) or an array of blocks.
 */
function recordToTurns(record: RawRecord, sessionId: string): Turn[] {
  const role = asString(record.type) as Role; // caller guarantees user|assistant
  const uuid = asString(record.uuid) ?? '';
  const parent = asString(record.parentUuid);
  const timestamp = asString(record.timestamp) ?? '';
  const message = record.message;
  if (message === null || typeof message !== 'object') return [];
  const content = (message as RawRecord).content;

  const turns: Turn[] = [];
  const push = (blockIndex: number, mapped: { type: TurnType; content: string; tool_name: string | null }): void => {
    turns.push({
      id: `${uuid}:${blockIndex}`,
      session_id: sessionId,
      record_uuid: uuid,
      parent_id: parent,
      role,
      type: mapped.type,
      content: mapped.content,
      tool_name: mapped.tool_name,
      timestamp,
    });
  };

  if (typeof content === 'string') {
    push(0, { type: 'text', content, tool_name: null });
    return turns;
  }
  if (Array.isArray(content)) {
    content.forEach((raw, i) => {
      const mapped = mapBlock(role, (raw ?? {}) as RawBlock);
      if (mapped) push(i, mapped);
    });
  }
  return turns;
}

/** Read a numeric usage field, defaulting to 0. */
function num(u: RawRecord, field: string): number {
  const v = u[field];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Extract the four token fields from an assistant record's `message.usage`, broken out by kind. */
function recordTokens(record: RawRecord): TokenUsage {
  const message = record.message;
  if (message === null || typeof message !== 'object') return emptyTokens();
  const usage = (message as RawRecord).usage;
  if (usage === null || typeof usage !== 'object') return emptyTokens();
  const u = usage as RawRecord;
  return {
    input: num(u, 'input_tokens'),
    output: num(u, 'output_tokens'),
    cache_creation: num(u, 'cache_creation_input_tokens'),
    cache_read: num(u, 'cache_read_input_tokens'),
  };
}

/** Metadata the CLI supplies about the file being parsed. */
export interface FileMeta {
  /** Fallback session id (filename stem) when records omit sessionId. */
  fallbackId: string;
  /** Fallback project path (decoded project dir) when records omit cwd. */
  fallbackProject: string;
}

/**
 * Parse all lines of one session file into a {@link ParseResult}.
 * Never throws: malformed lines and unknown/non-conversation records are counted.
 */
export function parseSession(lines: string[], meta: FileMeta): ParseResult {
  const skipped: SkipCounts = { malformed: 0, nonConversation: 0, unknownType: 0 };
  const conversation: RawRecord[] = [];
  let title: string | null = null;

  for (const line of lines) {
    if (line.trim() === '') continue;
    const record = parseLine(line);
    if (record === null) {
      skipped.malformed += 1;
      continue;
    }
    const type = asString(record.type);
    if (type === null) {
      skipped.malformed += 1;
      continue;
    }
    if (type === 'ai-title') {
      title = asString(record.aiTitle) ?? title;
      skipped.nonConversation += 1;
      continue;
    }
    if (CONVERSATION_TYPES.has(type)) {
      conversation.push(record);
      continue;
    }
    if (KNOWN.has(type)) skipped.nonConversation += 1;
    else skipped.unknownType += 1;
  }

  if (conversation.length === 0) {
    return { session: null, turns: [], skipped };
  }

  const ordered = orderByParent(
    conversation.map((r) => ({ uuid: asString(r.uuid) ?? '', parentUuid: asString(r.parentUuid), record: r })),
  );

  const sessionId =
    ordered.map((n) => asString(n.record.sessionId)).find((v): v is string => v !== null) ?? meta.fallbackId;
  const projectPath =
    ordered.map((n) => asString(n.record.cwd)).find((v): v is string => v !== null) ?? meta.fallbackProject;
  const gitBranch = ordered.map((n) => asString(n.record.gitBranch)).find((v): v is string => v !== null) ?? null;

  const turns: Turn[] = [];
  const tokens = emptyTokens();
  const timestamps: string[] = [];
  for (const node of ordered) {
    const r = node.record;
    turns.push(...recordToTurns(r, sessionId));
    if (asString(r.type) === 'assistant') addTokens(tokens, recordTokens(r));
    const ts = asString(r.timestamp);
    if (ts !== null) timestamps.push(ts);
  }
  timestamps.sort();

  const session: Session = {
    id: sessionId,
    project_path: projectPath,
    started_at: timestamps[0] ?? '',
    ended_at: timestamps[timestamps.length - 1] ?? '',
    turn_count: turns.length,
    record_count: ordered.length,
    tokens,
    git_branch: gitBranch,
    title,
  };
  return { session, turns, skipped };
}
