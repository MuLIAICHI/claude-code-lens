# Lens for Claude Code

**This never leaves your machine.** Lens is a local-first viewer for your Claude
Code session history. It makes zero network calls: no telemetry, no cloud, no
account. Your transcripts can contain secrets that passed through tool calls,
so nothing is ever sent anywhere, and that guarantee is enforced by tests, not
just promised here.

## What it does

Claude Code stores every session as JSONL under `~/.claude/projects/`, sharded
across files and buried under tool payloads. Lens turns that into:

- a **session list** grouped by project, sortable by date, duration, or messages;
- a **clean chat view** per session: your prompts and the assistant's replies as
  conversation, tool calls collapsed until you expand them, file edits shown as
  diffs;
- a **secret scanner** in the display layer: API-key shapes, `.env`-style
  values, JWTs, private-key blocks, and URL passwords are masked in the rendered
  view with a per-session reveal toggle, so you can spot a key you once pasted.

## Privacy guarantees (tested)

| Guarantee | How it is enforced |
|---|---|
| Zero network calls | A test wraps the socket layer and fails on any non-loopback connection during scan + render (`tests/no-network.test.ts`). |
| No external assets | The built frontend is scanned for any `http(s)://` reference (`tests/server.test.ts`, N1). |
| Localhost only | The server binds `127.0.0.1`, never `0.0.0.0`; asserted by test. Nothing on your LAN can reach it. |
| Source files never touched | Redaction is display-only; a test hash-compares session files before/after scan + render. |
| Index kept separate | The SQLite index lives at `~/.claude-code-lens/index.db`, never inside your session files. |

## Run

```bash
npm install
npm run build
npm run serve        # boots the dashboard on a localhost port and opens it
```

Other commands: `npm run scan` (terminal stats), `npm run index` (rebuild the
index incrementally), `npm test`.

Requires Node 20+. No native build steps: the SQLite engine is WebAssembly
(`sql.js`), so install works the same on any machine.

## Status

v1 = parser + session browser (M1-M2), complete. Analytics, full-text search,
and export are planned fast-follows. The npm package name and `npx` publish
land in M5.

Lens is an independent open-source tool and is not affiliated with Anthropic.
