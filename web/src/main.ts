/**
 * Frontend entry: hash router over two views — the session list (`#/`) and the
 * session detail (`#/session/:id`). Fetches same-origin APIs only; no external
 * calls. All data rendering goes through textContent (XSS-safe).
 */

import { el, fmtDate, fmtDuration, fmtNum, projectName, type ProjectGroup, type SessionItem } from './ui.ts';
import { renderDetail } from './detail.ts';

const app = document.getElementById('app') as HTMLElement;
const sortBy = document.getElementById('sortBy') as HTMLSelectElement;
const order = document.getElementById('order') as HTMLSelectElement;

function renderSession(s: SessionItem): HTMLElement {
  const row = el('a', 'session') as HTMLAnchorElement;
  row.href = `#/session/${encodeURIComponent(s.id)}`;
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

/** Fetch and render the session list view. */
async function renderList(): Promise<void> {
  document.title = 'Lens for Claude Code';
  app.replaceChildren(el('p', 'status', 'Loading…'));
  try {
    const res = await fetch(`/api/sessions?group=1&sortBy=${sortBy.value}&order=${order.value}`);
    const data = (await res.json()) as { groups: ProjectGroup[] };
    renderGroups(data.groups);
  } catch (err) {
    app.replaceChildren(el('p', 'status error', `Failed to load: ${(err as Error).message}`));
  }
}

/** Decode a hash segment; malformed percent-encoding falls back to the raw text. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Route on the current hash: `#/session/:id` → detail, anything else → list. */
function route(): void {
  const match = /^#\/session\/(.+)$/.exec(location.hash);
  if (match?.[1] !== undefined) {
    document.body.classList.add('detail');
    void renderDetail(app, safeDecode(match[1]));
  } else {
    document.body.classList.remove('detail');
    void renderList();
  }
}

sortBy.addEventListener('change', () => void renderList());
order.addEventListener('change', () => void renderList());
window.addEventListener('hashchange', route);
route();
