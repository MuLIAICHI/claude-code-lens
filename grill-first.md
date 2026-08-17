# Grill these before locking the spec — Claude Code Lens

The PRD (`claude-code-lens-PRD.md`) is strong. Run `grilling` on it, then `to-spec` → `to-tickets`.
These are the load-bearing decisions to stress-test first (not gaps — real forks):

1. **Stack weight vs the "10-second npx" promise.** Next.js is heavy for "parse JSONL → local
   dashboard." A lighter shell (Vite + tiny server, or a static bundle) may start faster and be
   easier to maintain. What actually earns Next.js here?

2. **`better-sqlite3` (native) vs `sql.js` (wasm).** Native deps make `npx` flaky across machines —
   the exact failure mode that kills OSS adoption. Load-bearing for the install promise. (sql.js =
   zero native deps but slower/heavier in memory; decide with the real data size in mind.)

3. **Naming.** "Claude Code Lens" implies Anthropic affiliation. "Lens for Claude Code" is safer.
   Settle before any public repo / package name.

4. **v1 scope.** M1–M5 is a lot. Is the true v1 just M1–M2 (parse + clean session browser), with
   analytics (M3) / search+export (M4) as fast-follows? Cut to the smallest lovable thing.

5. **Parser vs real data — validate before designing.** Confirm the JSONL schema (record types:
   user/assistant/tool_use/tool_result/summary; `parentUuid` trees; token fields) against actual
   `~/.claude/projects/**.jsonl` — there are thousands of real sessions to test against. The M1
   "scan" milestone is the right forcing function: parse real data first, design types second.

## Setup facts (from the ay-os session, 2026-08-16)
- New project → full pipeline: `grilling → to-spec` (spec lands in the repo, becomes the authority)
  `→ to-tickets`.
- It's a JS/OSS project → the **pin-guard supply-chain gate** applies before any `npm install`
  once `package.json` exists (`.claude/pin-guard.ok` must exist and be newer than package.json).
- Unlike ay-os (internal, zero-dep on purpose), Lens is *meant* to be distributed, so npm/npx is
  justified — but keep the dep count minimal and every version pinned exact.
- Becomes its own git repo + a vault project folder; move this PRD into the repo as the locked spec.

## Decision to carry into to-spec: track on the LOCAL `.ay/` board (so it shows in ay-os)

Claude-Code-Lens is a personal OSS tool ("you first"), not client work → track it on the
**local `.ay/` board** (like ay-os), NOT the AYTalent board (which is for client projects).

Why it matters: ay-os (the Gate Inbox) renders a project only when it's a registered
ay-framework repo with a `.ay/`. With the local board:
- `to-tickets` writes tasks to `.ay/tracking/BOARD.md` (local), not AYTalent.
- Register the repo in `~/Desktop/ay-os/config.toml` (one `[[repos]]` block + restart ay-os).
- Then: **board renders** as soon as `.ay/` has tasks; **pending gates + macOS notifications**
  appear during `/go` cycles at the plan/code gates — provided this repo's `go.md` has the
  gate-marker patch (the same Phase 5/8 patch on ay-os and sage-receptionist).

If it were tracked on AYTalent instead, it would NOT appear in ay-os until the separate
AYTalent→.ay mirror epic ships (ay-os vault ADR-003). Local board avoids that entirely.

Sequence to appear in ay-os: `to-spec` (no ay-os effect) → `to-tickets` (local board) →
register in ay-os config → `/go` → gates + notifications light up.
