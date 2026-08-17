# PRD — Claude Code Lens (working name)

Local-first viewer + analytics dashboard for Claude Code session history.

---

## 1. Problem

Claude Code stores every session as raw JSONL under `~/.claude/projects/`. It's complete but unusable directly:
- No search across projects
- No visual timeline
- Signal (actual conversation) is buried under tool payloads and file dumps
- No insight into usage patterns (time spent, tools used, debugging loops)

Existing tools (VS Code extensions, one-off wrappers) solve fragments of this. Nothing ships a clean, local-first, open-source dashboard.

## 2. Goal

Ship a `npx`-installable local dashboard that:
1. Parses all local session files
2. Gives fast search + a clean conversation view
3. Surfaces usage analytics (time, tools, patterns)

All local. No account, no cloud upload, no auth. That's the core trust promise — these files can contain secrets that passed through tool calls.

## 3. Non-goals (v1)

- No cloud sync / hosted version
- No team/multiplayer features
- No LLM-generated insights (opt-in, v2 only)
- No editing/resuming sessions (Claude Code already does this)
- No support for other agent tools (Cursor, Copilot) — v1 is Claude Code only

## 4. Users

You, first. Then: any Claude Code power user who wants to see what they've actually been doing across projects.

## 5. Core v1 Features

### 5.1 Ingestion
- Scan `~/.claude/projects/*/**.jsonl` (path configurable via flag/env, respects `CLAUDE_CONFIG_DIR`)
- Parse each line as a typed record (user / assistant / tool_use / tool_result / summary)
- Reconstruct conversation trees via `parentUuid`
- Index into local SQLite (session metadata, turn count, tool usage, token usage, timestamps) — re-scan incrementally, don't reparse unchanged files (hash or mtime check)

### 5.2 Session Browser
- List view: all sessions, grouped by project, sortable by date/duration/message count
- Search: full-text across user prompts + assistant text (exclude raw tool payloads from default search to cut noise; toggle to include)
- Detail view: clean chat-style rendering of a session — text and thinking blocks shown as conversation, tool calls collapsed by default (expandable), file diffs rendered nicely

### 5.3 Dashboard / Analytics
- Timeline: sessions per day/week per project
- Tool usage breakdown (Bash vs Edit vs Read vs Grep etc.) — bar/heatmap
- Session length distribution (turns, duration)
- Token usage over time (rough cost estimate if pricing table included)
- "Most touched files" per project

### 5.4 Export
- Export a session to clean Markdown (for sharing/archiving)
- Export analytics as CSV/JSON

## 6. Explicit non-negotiable: privacy

- Zero network calls in v1. No telemetry, no analytics-of-the-analytics-tool.
- Redaction pass on ingestion: flag/mask common secret patterns (API keys, `.env`-looking KV pairs) in the *display* layer, even though raw files stay untouched on disk.
- README leads with "this never leaves your machine."

## 7. Architecture

- **Shell:** CLI (`npx claude-code-lens`) → spins up a local Next.js server → opens browser to `localhost:PORT`
- **Backend:** Next.js API routes (or a tiny Node/Express layer) read filesystem + SQLite, no external DB
- **Parsing:** dedicated `parser/` module — pure functions, JSONL → normalized `Session`/`Turn` types. Keep this decoupled from the UI so it can later become a standalone npm package.
- **Storage:** SQLite (via `better-sqlite3` or `sql.js` if you want zero native deps) for fast query/search — file lives in `~/.claude-code-lens/index.db`, never the source files
- **Frontend:** Next.js + Tailwind, charts via Recharts, code/diff rendering via existing lib (e.g. `react-diff-viewer` or shiki for syntax)

## 8. Data model (sketch)

```
Session
  id, project_path, started_at, ended_at,
  turn_count, total_tokens, git_branch

Turn
  id, session_id, parent_id, role (user/assistant),
  type (text/tool_use/tool_result/thinking),
  content, tool_name, timestamp
```

## 9. Milestones

- **M1 — Parser CLI:** `claude-code-lens scan` prints session count + basic stats to terminal. Validates parsing logic against real data.
- **M2 — Local dashboard v0:** session list + detail view, no analytics yet. Runnable via `npx`.
- **M3 — Analytics:** timeline, tool breakdown, token usage charts.
- **M4 — Search + export:** full-text search, Markdown/CSV export.
- **M5 — Polish + OSS launch:** README, demo GIF, license (MIT), Product Hunt / Show HN / Reddit post.

## 10. Open source setup

- License: MIT
- README with a 10-second install (`npx claude-code-lens`), screenshot/GIF above the fold, privacy statement up top
- `CONTRIBUTING.md` if you want outside PRs early
- Consider a project name check — "Claude Code" is Anthropic's product name, so avoid implying official affiliation (e.g. "Lens for Claude Code" phrasing, not "Claude Code Lens™" branding)

## 11. Stretch (v2+)

- Opt-in LLM-generated weekly digest (explicit consent, redacted payload only)
- Support for other local agent tools (Cursor, Copilot agent mode) — same JSONL-ish shape per the ecosystem search results
- Desktop app wrapper (Tauri) instead of npx+browser
