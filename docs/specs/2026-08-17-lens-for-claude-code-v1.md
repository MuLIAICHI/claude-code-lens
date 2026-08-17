# Spec — Lens for Claude Code (v1)

Status: v1 spec, authority (ISO-020). Supersedes the working PRD (`claude-code-lens-PRD.md`) for anything they disagree on.
Date: 2026-08-17
Source: synthesized from `claude-code-lens-PRD.md` + `grill-first.md` + the four locked forks (shell, sqlite engine, v1 scope, naming).

---

## Problem Statement

Claude Code writes every session to raw JSONL under `~/.claude/projects/`. The record is complete but unusable directly:

- No search across projects.
- No visual timeline of what you actually did.
- The real signal (the conversation) is buried under tool payloads and file dumps.
- No view into usage patterns (time spent, tools used, debugging loops).
- No safe way to scan past sessions for secrets that passed through tool calls and got left in the transcript.

Existing tools (VS Code extensions, one-off wrappers) each solve a fragment. Nothing ships a clean, local-first, open-source dashboard.

## Solution

A single `npx`-installable command that boots a **local** dashboard for your Claude Code session history:

1. Parses all local session files.
2. Gives fast search and a clean, chat-style conversation view.
3. (Fast-follows) surfaces usage analytics.

Everything runs on the user's machine. No account, no cloud upload, no auth, **zero network calls**. That is the core trust promise: these files can contain secrets that passed through tool calls, so nothing may ever leave the machine.

### v1 scope (locked)

**v1 is M1–M2 only:**
- **M1 — Parser CLI:** `cc-lens scan` parses real session files and prints session count + basic stats to the terminal. This validates parsing against real data before any UI is designed.
- **M2 — Local dashboard v0:** session list + clean detail view, booted via `npx`. No analytics yet.

**Fast-follows (not v1):** M3 analytics, M4 search + export. They are specified at lower fidelity below so v1 does not paint them into a corner, but they are out of scope for the first ship.

## User Stories

1. As a Claude Code user, I want to run one `npx` command and land on a local dashboard in seconds, so that I never configure anything.
2. As a user, I want the tool to find my sessions automatically under `~/.claude/projects/`, so that I don't point it at files by hand.
3. As a user with a non-default config location, I want the scan path to respect `CLAUDE_CONFIG_DIR` and an override flag/env, so that it works with my setup.
4. As a user, I want `cc-lens scan` to print how many sessions and turns it found plus basic stats, so that I can confirm parsing works before trusting the UI.
5. As a user, I want the parser to reconstruct each conversation tree from `parentUuid`, so that branched/edited turns render in the right order.
6. As a user, I want each JSONL line parsed as a typed record (user / assistant / tool_use / tool_result / summary), so that unknown or malformed lines are handled without crashing the scan.
7. As a user with thousands of sessions, I want re-scans to be incremental (skip files unchanged by hash or mtime), so that repeat runs are fast.
8. As a user, I want a list of all sessions grouped by project, so that I can navigate my history by where I was working.
9. As a user, I want to sort sessions by date, duration, or message count, so that I can find the long or recent ones.
10. As a user, I want a clean chat-style detail view of a session — text and thinking blocks as conversation — so that I read what actually happened without noise.
11. As a user, I want tool calls collapsed by default and expandable, so that payloads don't drown the conversation but stay available.
12. As a user, I want file diffs in a session rendered nicely, so that I can see what changed at a glance.
13. As a privacy-conscious user, I want the display layer to flag/mask common secret patterns (API keys, `.env`-looking key/value pairs), so that I can spot a secret I left in a session — without the tool sending anything anywhere.
14. As a privacy-conscious user, I want a guarantee of zero network calls in v1, so that I trust the tool with sensitive transcripts.
15. As a user, I want the index stored in `~/.claude-code-lens/index.db` and never inside the source files, so that my original session files are never mutated.
16. As an OSS adopter on any machine, I want `npx` to install cleanly with no native build step, so that the install does not fail.
17. As a maintainer, I want the parser to be a decoupled module of pure functions, so that it can later ship as a standalone npm package.
18. As a user, I want the process to stop cleanly when I close it, so that no server keeps running in the background.
19. (Fast-follow) As a user, I want full-text search across my prompts and assistant text (tool payloads excluded by default, togglable), so that I can find a past conversation.
20. (Fast-follow) As a user, I want a timeline, tool-usage breakdown, session-length distribution, token usage over time, and most-touched files, so that I understand my own patterns.
21. (Fast-follow) As a user, I want to export a session to clean Markdown and analytics to CSV/JSON, so that I can share or archive.

## Implementation Decisions

### Locked forks (from grill-first)

- **Shell:** Vite + a tiny Node server. Rejected Next.js as too heavy for "parse JSONL → local dashboard" and a threat to the fast-boot promise. The Node server reads the filesystem + SQLite and serves a small API; the Vite-built frontend consumes it.
- **SQLite engine:** `sql.js` (wasm). Rejected `better-sqlite3` (native) because native compile can fail on other people's machines — the exact failure mode that kills OSS install adoption. Accepted trade-off: slower / heavier in memory, acceptable at personal session-history scale.
- **v1 scope:** M1–M2 only (parser + session browser). M3 analytics and M4 search/export are fast-follows.
- **Name:** "Lens for Claude Code" (avoids implying official Anthropic affiliation). Working package name `cc-lens`; final package name TBD before publish, must not imply an official Anthropic product.

### Architecture

- **Shell:** `npx cc-lens` → boots a local Node server → opens the browser to `localhost:PORT`. Not a native window.
- **CLI:** `cc-lens scan` (M1) runs the parser over real data and prints stats to the terminal, no server. The default command (M2) boots the server + browser.
- **Parsing:** dedicated `parser/` module — pure functions, JSONL → normalized `Session` / `Turn` types. Decoupled from the UI so it can become a standalone package. Malformed lines are skipped defensively, counted, and never crash the scan.
- **Ingestion:** scan `~/.claude/projects/*/**.jsonl` (path override via flag/env, respects `CLAUDE_CONFIG_DIR`). Reconstruct trees via `parentUuid`. Incremental re-scan via hash or mtime; unchanged files are not reparsed.
- **Storage:** `sql.js` index at `~/.claude-code-lens/index.db`. Source files are read-only; never written.
- **Frontend:** Vite + Tailwind. Diff/code rendering via an existing lib (e.g. shiki or a diff viewer). Charts (fast-follow) via a light lib when M3 lands.

### Privacy (non-negotiable)

- Zero network calls in v1. No telemetry, no "analytics of the analytics tool."
- Redaction is **display-layer only**: secret patterns are flagged/masked in the rendered view so the user can catch a forgotten secret. Raw files on disk are never modified.
- README leads with "this never leaves your machine."

### Data model (sketch)

```
Session: id, project_path, started_at, ended_at, turn_count, total_tokens, git_branch
Turn:    id, session_id, parent_id, role (user/assistant),
         type (text/tool_use/tool_result/thinking), content, tool_name, timestamp
```

## Testing Decisions

- **Primary seam: the `parser/` module.** Pure functions, deterministic, tested against real fixture JSONL captured from `~/.claude/projects/`. This is where correctness lives; M1 exists to force this validation. Tests assert external behavior: given real session files, the parser returns the expected session count, turn counts, correctly reconstructed `parentUuid` order, and correct record typing — and skips (not crashes on) malformed lines.
- **Secondary seam: the query layer** over the SQLite index. Given a parsed + indexed fixture set, queries return the expected grouped/sorted session lists and incremental re-scan skips unchanged files.
- **Out of test scope (v1):** the Vite UI and rendering. Verified by eye for v1; no component tests.
- **Redaction:** unit-test the secret-pattern detector against a fixture transcript containing planted fake keys / `.env` pairs — assert they are flagged, and assert no network call is made during a scan or render.

## Out of Scope

- Cloud sync / hosted version.
- Team / multiplayer features.
- LLM-generated insights (opt-in, v2 only).
- Editing / resuming sessions (Claude Code already does this).
- Other agent tools (Cursor, Copilot) — v1 is Claude Code only.
- Analytics (M3) and search/export (M4) — real, but fast-follows, not v1.

## Further Notes

- **Tracking:** this is a personal OSS tool ("you first"), so it tracks on the **local `.ay/` board**, not AYTalent. `to-tickets` writes to `.ay/tracking/BOARD.md`; register the repo in `~/Desktop/ay-os/config.toml` so it renders in the ay-os Gate Inbox. (If it were on AYTalent it would not appear in ay-os until the AYTalent→.ay mirror epic ships — ay-os ADR-003.)
- **Supply-chain gate:** once `package.json` exists, the pin-guard gate applies before any `npm install`. Keep the dep count minimal and pin every version exact. `npx <pkg>@latest` is always blocked.
- **Sequence to appear in ay-os:** `to-spec` → `to-tickets` (local board) → register in ay-os config → `/go` → gates + notifications light up. This repo's `go.md` needs the gate-marker patch (same Phase 5/8 patch as ay-os and sage-receptionist) for gates to fire.
