/**
 * Shared frontend helpers and wire-type mirrors used by both the list and the
 * detail views. Types are kept local to web/src so the web build does not
 * couple to the server tsconfig (existing convention).
 */

/** Token usage broken out by kind — never summed into one total (ADR-001). */
export interface TokenUsage {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
}

/** One session row from /api/sessions. */
export interface SessionItem {
  id: string;
  project_path: string;
  started_at: string;
  ended_at: string;
  turn_count: number;
  record_count: number;
  tokens: TokenUsage;
  git_branch: string | null;
  title: string | null;
  duration_ms: number;
}

/** Sessions grouped under their project path. */
export interface ProjectGroup {
  project_path: string;
  sessions: SessionItem[];
}

/** One turn from /api/sessions/:id (wire order = display order). */
export interface TurnRow {
  id: string;
  record_uuid: string;
  parent_id: string | null;
  role: 'user' | 'assistant';
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  content: string;
  tool_name: string | null;
  timestamp: string;
}

/** Full payload of /api/sessions/:id. */
export interface SessionDetail {
  session: SessionItem;
  turns: TurnRow[];
}

/** Create an element with optional class and text (text set via textContent — XSS-safe). */
export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Human-readable duration from milliseconds. */
export function fmtDuration(ms: number): string {
  if (ms <= 0) return '—';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Compact integer (12,345 → 12.3k). */
export function fmtNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Short local date. */
export function fmtDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Last path segment of a project path, for a compact heading. */
export function projectName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
