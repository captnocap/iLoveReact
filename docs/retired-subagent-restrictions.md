# Retired: subagent / Explore / workflow restrictions

**Retired 2026-06-30 (req_2143).** This file is a parking lot, **not** auto-loaded
into any session's precontext. It records the dated rules that banned the
`Agent` / `Explore` / `Task` tools (and, by extension, multi-agent workflows)
across this repo, plus exactly where each note lived — so they can be
repopulated verbatim if we decide the bans should come back.

## Why they were pulled

The user's call: these rules are dated. They were written against an older,
flakier subagent/Explore implementation (the cited ~57% false-claim rate, the
~3m46s-and-wrong Explore runs, the "supervisor goes blind" failure mode of the
kitty-pane supervisor+worker setup). The user is open to re-evaluating whether
the current systems have genuinely improved, so the blanket prohibitions are
removed rather than left standing as reflexive law. If subagents/workflows turn
out to still misbehave against this custom Zig/compiler/runtime codebase, the
exact text below goes back where it came from.

What was deliberately **kept** (not part of this retirement):
- The frozen-directory, banned-shell-command, V8-default, and self-matching-pgrep
  HARD RULES in `CLAUDE.md` — unrelated to subagents.
- The `git add -A` / explicit-staging discipline (it was bundled into the
  "NO SUBAGENTS, NO -A" block but is independently covered by §Git Discipline
  in `CLAUDE.md` and the Discipline Rules in `AGENTS.md`).
- Dated historical snapshots that merely *mention* the old rule:
  `docs/handoffs/handoff-20260624-192001-*.md`,
  `docs/game/_reports/HMSC-INT-STRUCTURE-REVIEW-0610.md`, and the conceptual
  "supervision vocabulary" product docs under `cart/app/docs/` — left untouched
  as point-in-time records / cart design material.

---

## Removed notes (verbatim, with original locations)

### 1. `CLAUDE.md` — under `## Claude-Code Specific Warnings` (was line 7)

> **Task tool is forbidden.** Do not use the `Agent` / `Explore` / `Task` tools. They go blind to supervisor context and have produced materially false reports in this repo (e.g., claimed frozen `tsz/` had `.map()` when it did not; ~57% false-claim rate on prior audits). Read files directly with Read / Grep / Glob / Bash. Treat "does this exist?" as source verification, not delegation.

### 2. `CLAUDE.md` — entire HARD RULE section (was lines 36–50)

```
# HARD RULE: DO NOT USE EXPLORE IN THIS REPOSITORY

For feature verification, compiler capability checks, and architecture comparisons:
- NEVER invoke the built-in Explore agent.
- Read files directly with Read / Grep / Glob / Bash.
- Treat "does this exist?" and "what is missing?" as source-verification tasks.

Measured evidence:
- Direct Opus read: ~1m13s, correct result
- Explore-agent path: ~3m46s, incorrect result
- Explore has produced materially false feature reports here

Why: this repo contains a custom compiler, DSL, and runtime not represented in training data. Explore summaries are less reliable than direct source inspection.
```

### 3. `CLAUDE.md` — entire HARD RULE section (was lines 77–81)

```
# HARD RULE: NO SUBAGENTS, NO `-A`

No Task / Agent / Explore tool calls. Supervisor goes blind when a worker spawns a subagent. Do all work yourself in your own context. When committing, stage files by name — never `git add -A` or `git add .` (both catch unrelated working-tree state from other workers).
```

(The `git add -A` half is preserved in `CLAUDE.md` §Git Discipline and `AGENTS.md`
Discipline Rules; only the subagent ban was retired.)

### 4. `AGENTS.md` — under `## Discipline Rules` (was line 160)

> - **No subagents.** Do everything inline. The `Agent` / `Explore` tools go blind to supervisor context.

### 5. Memory: `behavior.md` (was line 9, in the auto-loaded memory store)

Full path: `~/.claude/projects/-home-siah-creative-reactjit/memory/behavior.md`

> **No Explore agent in this repo.** Measured: 57.5% false-claim rate on this codebase (custom compiler + DSL + runtime not represented in training data). Direct Opus read = ~1m13s correct. Explore-agent path = ~3m46s often wrong. Use Read/Grep/Glob/Bash directly. This rule survives the Smith → reconciler pivot — even though the compiler is frozen, the framework is still custom-Zig and Explore still hallucinates against it.

The `description:` frontmatter of that same file also listed `no Explore agent`
among its cross-cutting rules; that phrase was dropped from the description.

### 6. Memory index: `MEMORY.md` (was the Behavior index line)

Full path: `~/.claude/projects/-home-siah-creative-reactjit/memory/MEMORY.md`

The Behavior index entry read:

> - [Behavior](behavior.md) — cross-cutting rules (no Explore agent, Zig 0.15.2, git main-only, regenerate-don't-port, binary timeouts, user philosophy).

`no Explore agent` was removed from that one-liner.

---

## To repopulate

Paste each block back at the location named above. The `CLAUDE.md` HARD RULE
sections want a `---` separator before and after to match the surrounding
formatting.
