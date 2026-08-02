---
name: flight-check-loop
description: >
  The Flight-Check Driven Compiler Loop — strict methodology for debugging the Smith/.tsz compiler.
  Use when: starting a compiler debugging session, triaging cart failures, fixing emitter/parser bugs,
  working through Red/Yellow/Green cart buckets, or any task involving "flight checks", "trap and fix",
  "compiler loop", "triage carts", "baseline the suite", "what's failing", or "next bug".
  Enforces: diff-driven root cause analysis, trap-before-fix discipline, top-down frequency targeting,
  zero false-positive checks, and atomic Git checkpoints.
---

# The Flight-Check Driven Compiler Loop

**Never guess at a compiler bug.** Diff generated output of known-good (Green) vs known-bad (Yellow/Red) to find exact structural anomalies. Always write a pipeline check to trap the anomaly BEFORE attempting a fix.

## Operational Rules

1. **No `timeout` prefix on binaries.** Run `./binary` directly — `timeout` suppresses output in this environment. Handle hangs reactively.
2. **Atomic Git checkpoints.** Commit after verifying a new flight check (the trap). Commit again after clearing it with a fix. Two commits per bug, minimum.
3. **Top-down frequency targeting.** Always fix the highest-frequency failure signature first. Systemic fixes cascade and resolve downstream bugs for free.

## Live Triage Notes — `tsz/docs/notes.txt`

The human maintains a live triage file at `tsz/docs/notes.txt` with the current Green/Yellow/Red categorization and per-cart failure descriptions. **Read this file at the start of every session.** It is the human's real-time ground truth — more current than `conformance-report --verified` or `--notes`.

**DO NOT edit `tsz/docs/notes.txt`.** The human updates it in real time. Read it, use it, never write to it.

## Phase 1: Baseline & Prioritize

Categorize every cart into exactly one bucket:

| Bucket | Meaning |
|--------|---------|
| **Green** | Compiled, built, functional, **verified by human interaction** |
| **Yellow** | Compiled, built, shows *something*, but behavior diverges from source intent. Range: almost-passing to mostly-wrong |
| **Red** | Compiled, built, dead window on startup. Source code not active. Startup error present |

Then:

1. **Generate & Diff** — Compile representative samples from each bucket. Examine only generated output (`.zig`, `.lua` files).
2. **Tally failure signatures** — Count occurrences of each distinct anomaly across Red and Yellow.
3. **Target the top hit** — Pick the single highest-frequency signature.
4. **Zero false-positive gate** — Grep the signature against ALL Green outputs. If it matches any Green cart, the signature is wrong. Refine until 0% false-positive rate.

## Phase 2: Pipeline Map — Where Each Check Lives

The build pipeline runs in this order. Know which file to edit for each stage:

| Stage | When | File(s) | What it does |
|-------|------|---------|-------------|
| **Preflight / Validation** | Pre-compile (inside Smith, after collect, before parse) | `compiler/smith/validate.js` | Lint-level source validation |
| **Route Scan** | Pre-compile (after collect, before parse) | `compiler/smith/preflight/route_scan.js` | Predicts features, map routes, expression stats. Builds immutable route plan |
| **Preflight Rules** | Pre-compile (within Smith) | `compiler/smith/preflight/rules/*.js` | Per-domain checks: `dyn.js`, `handlers.js`, `maps.js`, `state.js`, `js_logic.js`, `classifiers.js`, `unimplemented.js` |
| **Routing Check** | Post-compile self-test (inside Smith) | `compiler/smith/preflight/routing_check.js` | Verifies generated output matches route plan predictions |
| **Flight Check** | Post-compile, pre-build gate (bash) | `scripts/flight-check` | THE gate. Blocks the Zig build if generated code is structurally wrong |
| **Build** | Final link | `scripts/build` | Zig compile + link → native binary |

### Flight Check Sections (where to add traps)

`scripts/flight-check` is organized into numbered sections. Add new traps to the correct section:

**Zig-mode checks (sections 1–16):**
- 1: Color integrity (hex survival)
- 2: `Color{}` placeholder audit
- 3/3b/3c/3d/3e: Handler balance, orphans, map handlers, change handlers
- 4: State slot balance
- 5/5b/5c: Static text survival, dead `_updateConditionals`, `js_on_press` arg mismatch
- 6/6a–6h: Map/For content — callback leaks, conditionals, unresolved brackets, empty text, truncation, handler params, OA stubs
- 7: Component inlining
- 8: Empty node arrays
- 9: Multi-file import content
- 11: Chad handler coverage
- 12: Map handler args
- 13: Chad page routing
- 14: Unresolved glyph shortcodes
- 15: Map variant stomp
- 16: Map text buffer stomping

**Lua-tree checks (LT series):**
- LT1: Zig syntax leaked into `LUA_LOGIC`
- LT2: Unquoted enum values in Lua tables
- LT3: `<script>` tags in `JS_LOGIC`
- LT4/4c/4d/4e/4g/4h: Broken string literals, state key mismatch, dropped conditionals, dropped children, scalar sync, unresolved component props in maps
- LT5: Map variable leakage in handlers

**Naming convention:** Zig checks are numbered (1–16). Lua-tree checks are prefixed `LT`. New checks follow the next number in the appropriate series.

## Phase 3: Trap-and-Fix Loop

Execute in this exact order for each failure signature:

### Step 1: Write the Trap (DO THIS FIRST)

Add a new check to `scripts/flight-check` in the correct section (Zig-mode or LT series). Use the existing `fail()` / `warn()` / `gcount()` helpers. **Do not touch compiler code until the trap exists.**

### Step 2: Verify Trap → Git Checkpoint

Run the build. The flight check must:
- **Block** the Yellow/Red carts that exhibit the signature
- **Pass** all Green carts

Both conditions hold → `git commit` (trap checkpoint).

### Step 3: Trace Root Cause

With the trap in place, trace backward: generated output → emitter → parser/AST builder. Find the exact code path producing the anomaly.

### Step 4: Implement the Fix

Patch the compiler logic responsible. Minimal, targeted change.

### Step 5: Clear the Trap → Git Checkpoint

Re-run the build. Previously-failing carts must now pass the new flight check. `git commit` (fix checkpoint).

## Phase 4: Macro Verification

1. **Run the conformance build** — `./scripts/conformance-build` compiles all d01–d152 mixed conformance carts and reports PASS/FAIL/TIMEOUT counts.
2. **Read human context** — `./scripts/conformance-report --verified` lists all human-verified (Green) carts. `./scripts/conformance-report --notes` lists human-written failure notes explaining *why* specific carts are Yellow/Red. Read both before triaging — they are the human's ground truth.
3. **Re-categorize** — Count migrations: Red→Yellow, Yellow→Green.
4. **Target next** — Identify next highest-frequency signature in remaining failures.
5. **Return to Phase 3.**
