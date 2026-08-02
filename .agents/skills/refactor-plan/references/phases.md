# Phase Breakdown

## Phase 1: Inventory

**Goal:** A complete, factual catalog of everything in scope. No opinions.

For each file in scope:
- File path and line count
- Purpose (one line)
- Every function/export with: name, line range, ownership category, fragility rating, callers

Fragility rating:
- `high` = 5+ callers OR in a critical path (parse, emit, entry)
- `low` = leaf function or single-caller

Ownership categories depend on the project. In a compiler it might be `meta`, `zig`, `lua`, `qjs`. In a web app it might be `api`, `ui`, `data`, `infra`. Name them in the inventory header.

**Output:** `INVENTORY.md`

**Gate:** `inventory_complete_and_verified: true` — every file in scope is cataloged, every function is listed, line ranges are verified by reading the file (not from memory).

---

## Phase 2: Thesis

**Goal:** One document that names the change.

Read the inventory top to bottom. Then write:

1. **Current shape** — how the system is organized today (not how it works, just the shape)
2. **Target shape** — how it should be organized after (directory structure, module boundaries, data flow)
3. **The thesis** — one sentence: "The change is: [X]"
4. **Done standard** — what "complete" means. Be specific. "Byte-identical output" is a done standard. "Works correctly" is not.
5. **What does NOT change** — equally important. Scope the blast radius.

**Output:** `THESIS.md`

**Gate:** `thesis_names_target_shape_and_done_standard: true`

---

## Phase 3: Flow Map

**Goal:** Trace how data and control actually move through the system.

This is NOT the inventory (which lists what exists). This is how things connect:

- Entry points: where does execution start?
- Data flow: what gets passed where? What transforms happen?
- Control flow: what decides what runs? What are the branch points?
- Output paths: where does output get produced?

Map the actual live paths, not theoretical ones. If a code path is dead, mark it dead.

Format: use the pattern `intake -> contract -> emission` or equivalent for your domain. Name every stage.

**Output:** `FLOW_MAP.md`

**Gate:** `flow_map_traces_all_live_paths: true`

---

## Phase 4: Decomposition

**Goal:** Break every high-fragility unit into named sub-operations.

For every function marked `high` in the inventory:
- List the logical sub-operations it performs (scan, resolve, register, serialize, etc.)
- Name each sub-operation as a potential function
- Keep names local to each function — do NOT deduplicate yet

This phase is intentionally redundant. Multiple functions will produce helpers with overlapping names. That's correct. Dedup is Phase 5.

**Output:** `DECOMPOSITION_MAP.md`

**Gate:** `all_high_fragility_units_decomposed: true`

---

## Phase 5: Reuse Analysis

**Goal:** Find where decomposed pieces overlap and propose canonical shapes.

Read the decomposition map. Identify:
- Helpers that do the same semantic job under different names
- Shared layers that can be extracted (e.g., "resolve identity" appears in 7 functions)
- What is genuinely reusable vs what only looks similar

Propose canonical shapes:
- Name the shared layer
- List which functions currently inline it
- Define the extraction boundary (what goes in the shared helper, what stays local)

Working rule: extract shared **semantic** layers. Keep backend-specific serialization local. Do not force different output formats into one mega-helper.

**Output:** `REUSE_MAP.md`

**Gate:** `canonical_shapes_identified: true`

---

## Phase 6: Execution Plan

**Goal:** Convert all previous phases into numbered microsteps.

Read `step_integrity.md` and `execution_rules.md` before writing any steps.

The execution plan is organized into sections. Each section has:
- A step range (e.g., 001-030)
- A name (e.g., "Workspace Scaffolding")
- A count
- An optional parity contract (for sections that change live behavior)

Section types:
1. **Setup sections** — scaffold workspace, capture canonical state, build harness
2. **Parity sections** — change implementation while proving output stays identical
3. **Switch sections** — flip the live path from old to new
4. **Cleanup sections** — delete dead code, resolve duplicates
5. **Verification sections** — final pass, closure summary

Every step follows the pattern in `step_integrity.md`. No exceptions.

**Output:** `EXECUTION_PLAN.md`

**Gate:** `all_steps_pass_integrity_check: true` — run `scripts/validate_steps.sh` to check for task-shaped rows.

---

## Phase 7: Severance Build

**Goal:** Delete the old path entirely and prove the system survives without it.

This is not cleanup. This is the moment of truth. Workers will report "done" after Phase 6 execution. They are wrong. The old code is still present, possibly still imported, possibly still called from paths nobody checked.

Read `severance_build.md` for the full method. The short version:

1. Archive all legacy files (move, don't delete — you need them for diffing)
2. Remove all imports of legacy paths from every file in scope
3. Remove legacy entries from bundle configs, manifests, load order files
4. Build. It will fail.
5. Fix forward — complete the new path, never restore old code
6. Build again. Repeat until green.
7. Run the full test/verification suite
8. Delete the archive
9. Write the closure summary

**Critical rule:** If a build error reveals that new code imports from old code, that is **dependency smuggling** (see `dependency_smuggling.md`). The fix is reimplement in the new path or extract to a shared location — never "keep the old file."

**Output:** `reports/severance_fixes.md` (every fix-forward recorded), `reports/closure_summary.md`

**Gate:** All four must be true:
- `legacy_deleted: true`
- `clean_build_passes: true`
- `all_tests_pass_without_legacy: true`
- `closure_summary_written: true`
