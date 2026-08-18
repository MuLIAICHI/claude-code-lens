/**
 * Session list frontend. Fetches the same-origin /api/sessions endpoint and
 * renders sessions grouped by project, with sort controls. No external calls.
 */

// Minimal shapes mirroring the server's SessionListItem / ProjectGroup. Kept
// local so the web build does not couple to the server tsconfig.
interface TokenUsage {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
}
interface SessionItem {
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
interface ProjectGroup {
  project_path: string;
  sessions: SessionItem[];
}

const app = document.getElementById('app') as HTMLElement;
const sortBy = document.getElementById('sortBy') as HTMLSelectElement;
const order = document.getElementById('order') as HTMLSelectElement;

/** Human-readable duration from milliseconds. */
function fmtDuration(ms: number): string {
  if (ms <= 0) return '—';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Compact integer (12,345 → 12.3k). */
function fmtNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Short local date. */
function fmtDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Last path segment of a project path, for a compact heading. */
function projectName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderSession(s: SessionItem): HTMLElement {
  const row = el('div', 'session');
  const title = el('div', 'session-title', s.title ?? s.id.slice(0, 8));
  const meta = el('div', 'session-meta');
  meta.append(
    el('span', 'chip', `${fmtNum(s.turn_count)} turns`),
    el('span', 'chip', fmtDuration(s.duration_ms)),
    el('span', 'chip', fmtDate(s.started_at)),
    el('span', 'chip dim', `in ${fmtNum(s.tokens.input)} / out ${fmtNum(s.tokens.output)}`),
  );
  if (s.git_branch) meta.append(el('span', 'chip branch', s.git_branch));
  row.append(title, meta);
  return row;
}

function renderGroups(groups: ProjectGroup[]): void {
  app.replaceChildren();
  if (groups.length === 0) {
    app.append(el('p', 'status', 'No sessions found.'));
    return;
  }
  const totalSessions = groups.reduce((n, g) => n + g.sessions.length, 0);
  app.append(el('p', 'summary', `${totalSessions} sessions across ${groups.length} projects`));
  for (const g of groups) {
    const section = el('section', 'project');
    const head = el('div', 'project-head');
    head.append(el('span', 'project-name', projectName(g.project_path)));
    head.append(el('span', 'project-count', `${g.sessions.length}`));
    head.title = g.project_path;
    section.append(head);
    for (const s of g.sessions) section.append(renderSession(s));
    app.append(section);
  }
}

async function load(): Promise<void> {
  app.replaceChildren(el('p', 'status', 'Loading…'));
  try {
    const res = await fetch(`/api/sessions?group=1&sortBy=${sortBy.value}&order=${order.value}`);
    const data = (await res.json()) as { groups: ProjectGroup[] };
    renderGroups(data.groups);
  } catch (err) {
    app.replaceChildren(el('p', 'status error', `Failed to load: ${(err as Error).message}`));
  }
}

sortBy.addEventListener('change', () => void load());
order.addEventListener('change', () => void load());
void load();
