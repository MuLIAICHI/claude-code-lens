/**
 * Session detail view — a chat-style transcript. Text and thinking render as
 * conversation; tool_use / tool_result render collapsed and fill their payload
 * lazily on first expand (keeps the DOM light on huge sessions). File-editing
 * tools (Edit / MultiEdit / Write) render as line diffs. All transcript content
 * is untrusted and is only ever set via textContent.
 */

import { el, fmtDate, fmtDuration, fmtNum, projectName, type SessionDetail, type TurnRow } from './ui.ts';
import { diffLines, extractEdits } from './diff.ts';
import { detectSecrets } from '../../src/redact/detect.ts';

/** Truncation cap for a rendered payload body (characters). */
const MAX_PAYLOAD_CHARS = 200_000;
/** Truncation cap for a collapsed summary preview (characters). */
const MAX_PREVIEW_CHARS = 100;

/** First-line preview of a payload for a collapsed summary row. */
function preview(content: string): string {
  const firstLine = content.split('\n', 1)[0] ?? '';
  const flat = firstLine.trim();
  return flat.length > MAX_PREVIEW_CHARS ? `${flat.slice(0, MAX_PREVIEW_CHARS)}…` : flat;
}

/** Pretty-print JSON content if it parses, else return it unchanged. */
function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

/** One masked segment: chip shown by default, original shown under body.reveal. */
function redactedSpan(label: string, original: string): HTMLElement {
  const wrap = el('span', 'redacted');
  wrap.append(el('span', 'mask', `●●● ${label}`), el('span', 'orig', original));
  return wrap;
}

/**
 * Append `text` to `parent` with secret spans masked (display-layer redaction,
 * task 5). Plain segments become text nodes; detected spans become .redacted
 * elements. Everything is set via textContent — XSS posture unchanged.
 */
function appendRedacted(parent: HTMLElement, text: string): void {
  const spans = detectSecrets(text);
  if (spans.length === 0) {
    parent.append(document.createTextNode(text));
    return;
  }
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) parent.append(document.createTextNode(text.slice(cursor, s.start)));
    parent.append(redactedSpan(s.label, text.slice(s.start, s.end)));
    cursor = s.end;
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

/** A <pre> holding payload text (redacted), truncated past {@link MAX_PAYLOAD_CHARS}. */
function payloadPre(text: string, className: string): HTMLElement {
  const pre = el('pre', className);
  if (text.length > MAX_PAYLOAD_CHARS) {
    appendRedacted(pre, `${text.slice(0, MAX_PAYLOAD_CHARS)}\n… truncated (${fmtNum(text.length)} chars total)`);
  } else {
    appendRedacted(pre, text);
  }
  return pre;
}

/** Render one file edit as a line diff block. */
function renderDiff(filePath: string, oldStr: string, newStr: string): HTMLElement {
  const wrap = el('div', 'diff-file');
  if (filePath) wrap.append(el('div', 'diff-path', filePath));
  const pre = el('pre', 'diff');
  for (const op of diffLines(oldStr, newStr)) {
    const prefix = op.kind === 'add' ? '+ ' : op.kind === 'del' ? '- ' : '  ';
    const line = el('div', `line ${op.kind}`);
    line.append(document.createTextNode(prefix));
    appendRedacted(line, op.text);
    pre.append(line);
  }
  wrap.append(pre);
  return wrap;
}

/** Fill a tool_use payload: diffs for file-editing tools, pretty JSON otherwise. */
function fillToolUseBody(body: HTMLElement, turn: TurnRow): void {
  const edits = extractEdits(turn.tool_name, turn.content);
  if (edits) {
    for (const e of edits) body.append(renderDiff(e.file_path, e.old_string, e.new_string));
  } else {
    body.append(payloadPre(prettyJson(turn.content), 'payload'));
  }
}

/** Collapsed-by-default tool row; payload is rendered on first expand. */
function renderTool(turn: TurnRow): HTMLElement {
  const details = el('details', turn.type === 'tool_use' ? 'tool' : 'tool result') as HTMLDetailsElement;
  const summary = el('summary');
  const label = turn.type === 'tool_use' ? (turn.tool_name ?? 'tool') : 'result';
  summary.append(el('span', 'tool-badge', label));
  const previewEl = el('span', 'tool-preview');
  appendRedacted(previewEl, preview(turn.content));
  summary.append(previewEl);
  details.append(summary);

  const body = el('div', 'tool-body');
  details.append(body);
  details.addEventListener(
    'toggle',
    () => {
      if (turn.type === 'tool_use') fillToolUseBody(body, turn);
      else body.append(payloadPre(prettyJson(turn.content), 'payload'));
    },
    { once: true },
  );
  return details;
}

/** Render one turn into its conversation element. */
function renderTurn(turn: TurnRow): HTMLElement {
  if (turn.type === 'tool_use' || turn.type === 'tool_result') return renderTool(turn);
  if (turn.type === 'thinking') {
    // Real data: Claude Code usually persists only the thinking signature, not
    // the text — render a slim marker instead of an empty bubble.
    if (turn.content.trim() === '') return el('div', 'thinking-empty', '∴ thinking (not recorded)');
    const msg = el('div', 'msg thinking');
    msg.append(el('div', 'msg-label', 'thinking'));
    const bubble = el('div', 'bubble');
    appendRedacted(bubble, turn.content);
    msg.append(bubble);
    return msg;
  }
  const msg = el('div', `msg ${turn.role}`);
  const bubble = el('div', 'bubble');
  appendRedacted(bubble, turn.content);
  msg.append(bubble);
  return msg;
}

/** The reveal toggle: flips body.reveal and its own label. */
function revealButton(secretCount: number): HTMLElement {
  const btn = el('button', 'reveal-btn') as HTMLButtonElement;
  const setLabel = (): void => {
    const revealed = document.body.classList.contains('reveal');
    btn.textContent = revealed
      ? `hide ${secretCount} potential secret${secretCount === 1 ? '' : 's'}`
      : `⚠ reveal ${secretCount} potential secret${secretCount === 1 ? '' : 's'}`;
  };
  btn.addEventListener('click', () => {
    document.body.classList.toggle('reveal');
    setLabel();
  });
  setLabel();
  return btn;
}

/** Detail header: back link, title, project, meta chips (tokens kept split). */
function renderHeader(detail: SessionDetail, secretCount: number): HTMLElement {
  const s = detail.session;
  const head = el('div', 'detail-head');
  const back = el('a', 'back', '← All sessions') as HTMLAnchorElement;
  back.href = '#/';
  head.append(back);
  if (secretCount > 0) head.append(revealButton(secretCount));
  head.append(el('h2', 'detail-title', s.title ?? s.id));
  const sub = el('div', 'detail-sub', s.project_path);
  sub.title = s.project_path;
  head.append(sub);
  const meta = el('div', 'session-meta');
  meta.append(
    el('span', 'chip', `${fmtNum(s.turn_count)} turns`),
    el('span', 'chip', fmtDuration(s.duration_ms)),
    el('span', 'chip', fmtDate(s.started_at)),
    el('span', 'chip dim', `in ${fmtNum(s.tokens.input)} / out ${fmtNum(s.tokens.output)}`),
    el('span', 'chip dim', `cache w ${fmtNum(s.tokens.cache_creation)} / r ${fmtNum(s.tokens.cache_read)}`),
  );
  if (s.git_branch) meta.append(el('span', 'chip branch', s.git_branch));
  head.append(meta);
  return head;
}

/** Fetch and render the detail view for one session into `app`. */
export async function renderDetail(app: HTMLElement, id: string): Promise<void> {
  document.body.classList.remove('reveal'); // masking is the default per session view
  app.replaceChildren(el('p', 'status', 'Loading session…'));
  document.title = `Lens — ${projectName(id)}`;
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      app.replaceChildren(el('p', 'status error', `Session not found: ${id}`));
      return;
    }
    const detail = (await res.json()) as SessionDetail;
    // Total across ALL turns (lazy tool bodies included) so the count is stable.
    let secretCount = 0;
    for (const turn of detail.turns) secretCount += detectSecrets(turn.content).length;
    const convo = el('div', 'convo');
    for (const turn of detail.turns) convo.append(renderTurn(turn));
    app.replaceChildren(renderHeader(detail, secretCount), convo);
    document.title = `Lens — ${detail.session.title ?? detail.session.id}`;
  } catch (err) {
    app.replaceChildren(el('p', 'status error', `Failed to load session: ${(err as Error).message}`));
  }
}
