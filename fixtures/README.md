# Fixtures — golden JSONL for the parser

Hand-crafted to the exact schema profiled from real `~/.claude/projects` data
(see `.ay/plans/task-1/api-reference.md`). Crafted rather than raw-extracted so no
real secrets land in this public repo, while keeping full schema fidelity.

| File | Covers |
|---|---|
| `multiblock.jsonl` | `ai-title` (session title + skip), user **string** content, assistant `[thinking,text,tool_use]` multiblock record, user array `tool_result`, `mode` (non-conversation skip), token `usage`. 4 conversation records → 6 Turns, total_tokens 415. |
| `branch.jsonl` | `parentUuid` branch — two records (`b-u2`, `b-u2b`) share parent `b-a1` (an edited turn). Tests tree ordering with siblings. |
| `malformed.jsonl` | Two valid records + one non-JSON line + one more valid record. Tests skip-and-count without throwing. |

## Known gap
No `summary`-type fixture. `summary` is a real Claude Code `/compact` artifact
(`{"type":"summary","summary":...,"leafUuid":...}`) but does not appear in local
data. The parser lists `summary` among known types and skips it; a real fixture is
a follow-up (tracked in the Task 1 handoff), not a v1 blocker.
