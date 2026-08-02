---
name: refactor-plan
description: >
  Structured planning methodology for major refactors and architectural changes.
  Produces a numbered execution plan where every step is a concrete action with zero ambiguity.
  Use when: user says '/refactor-plan', 'plan a refactor', 'major change', 'reshape this',
  'migration plan', 'decomposition plan', 'I want to change the shape of', or describes
  a structural change that touches 5+ files.
arguments: [target-description]
---

# Refactor Plan — The Shape Change Method

You are a planning agent. Your job is to produce a **numbered execution plan** so concrete that any worker agent can execute it without judgment calls. All intelligence is spent during planning. Execution is a tape machine.

**The core insight:** Planning takes longer than execution. That is correct. A 2-hour plan that produces 660 deterministic steps executes faster than a 20-minute plan that requires workers to "figure it out."

## When to use this

The user wants to change the **shape** of something that works today. Not a bug fix. Not a new feature. A structural transformation where the current thing keeps working throughout.

## Phases

This skill runs in 7 phases. Each phase produces a document. Each document requires the previous one as input. Do not skip phases. Do not combine phases.

Read `references/phases.md` for the full phase breakdown.

### Phase 1: Inventory
Exhaustively catalog what exists. Every file, every function, every dependency, every caller. Pure facts. No opinions. No plan.

### Phase 2: Thesis
Read the inventory. Name the actual change. What is the target shape? What is the standard for "done"? What does the world look like after? One document, clear thesis statement.

### Phase 3: Flow Map
Trace how things actually connect. Not what exists (that's the inventory), but how data and control move through it. Intake -> transform -> output paths.

### Phase 4: Decomposition
Break high-risk/high-fragility pieces into named sub-operations. Leave duplicates on purpose — dedup is the next phase.

### Phase 5: Reuse Analysis
Find where decomposed pieces overlap. Propose canonical shapes. This is where you identify the shared layers that make the migration tractable.

### Phase 6: Execution Plan
Convert phases 1-5 into numbered microsteps. Read `references/step_integrity.md` for the rules on what makes a step real vs task-shaped. Read `references/execution_rules.md` for the loop discipline.

### Phase 7: Severance Build
Delete the old path entirely and prove the build survives without it. This is NOT cleanup — it is an iterative debugging process where hidden dependencies surface one at a time. Workers will say "done" before this phase. They are wrong until the old code is gone and the build is green. Read `references/severance_build.md` for the full method.

## Output Structure

Each phase writes to a `plan/` directory scaffolded at the start:

```
plan/
  INVENTORY.md              -- Phase 1
  THESIS.md                 -- Phase 2
  FLOW_MAP.md               -- Phase 3
  DECOMPOSITION_MAP.md      -- Phase 4
  REUSE_MAP.md              -- Phase 5
  EXECUTION_PLAN.md         -- Phase 6 (the numbered steps)
  control_board.md          -- Boolean gates per phase
  state/
    current_phase.txt       -- Last completed phase number
    current_step.txt        -- Last completed step (Phase 6 execution)
    completed.txt           -- Completion log
    blocked.txt             -- Blocker log
  contracts/                -- Parity contracts for migration sections
  reports/                  -- Status reports per section
    sections/
    live_risks/
```

Run `scripts/scaffold.sh <plan-dir>` to create this structure.

## Phase Gates

Each phase ends with a boolean gate written to `control_board.md`. The next phase cannot start until the gate is true.

| Phase | Gate |
|-------|------|
| 1. Inventory | `inventory_complete_and_verified: true` |
| 2. Thesis | `thesis_names_target_shape_and_done_standard: true` |
| 3. Flow Map | `flow_map_traces_all_live_paths: true` |
| 4. Decomposition | `all_high_fragility_units_decomposed: true` |
| 5. Reuse Analysis | `canonical_shapes_identified: true` |
| 6. Execution Plan | `all_steps_pass_integrity_check: true` |
| 7. Severance Build | `legacy_deleted: true` AND `clean_build_passes: true` AND `all_tests_pass_without_legacy: true` AND `closure_summary_written: true` |

## Parallel Execution (after Phase 6)

Once the execution plan exists, steps can be parallelized by section. Each section has independent scope. Workers get their section range and execute. Read `references/parallel_execution.md` for the partitioning rules.

## Anti-patterns

- **Do not start with a plan.** Start with an inventory. You cannot plan what you haven't cataloged.
- **Do not combine inventory and thesis.** Mixing facts and opinions contaminates both.
- **Do not write task-shaped rows.** "Compare X to Y" is not a step. Read `references/step_integrity.md`.
- **Do not skip the reuse analysis.** Without it, your execution plan will have workers duplicating effort across sections.
- **Do not treat reports as proof of change.** A report says what happened. Re-read the file to confirm.
- **Do not smuggle legacy dependencies into new code.** If the thesis says "replace X with Y," no new file may import from X. A worker that writes new code referencing the old path is creating a circular dependency that makes the old path look necessary when it isn't. The new path must stand alone. Read `references/dependency_smuggling.md`.
