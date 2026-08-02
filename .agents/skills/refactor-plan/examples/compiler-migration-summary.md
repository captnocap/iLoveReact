# Example: Smith Compiler Atom Migration (2026-04-08)

This is a real refactor that used this methodology. 660 steps, ~2 hours planning, ~2 hours parallel execution.

## What changed

The Smith compiler had two emit paths: a legacy monolithic orchestrator (`emit.js` calling 12 functions in sequence) and a new atom pipeline (46 composable units). The atom pipeline was built but never activated. The legacy path was still live.

**Thesis:** "The atom system is the target architecture. The cleanup is completing the migration."

## Document chain

Each document was produced in order. Each required the previous as input.

| # | Document | Size | What it did |
|---|----------|------|-------------|
| 1 | COMPILER_MANIFEST | 94KB | Inventoried 652 functions across 200 JS + 6 Zig files. Every function: name, line range, ownership, fragility, callers. |
| 2 | COMPILER_MANIFEST_FINAL_CUT | 27KB | Named the thesis. Defined target directory structure. Set done standard: byte-identical output. Identified known drift between paths. |
| 3 | COMPILER_MAP | 27KB | Traced intake -> contract fill -> emission. Mapped every React pattern to its atom family. |
| 4 | FRAGILE_FUNCTION_DECOMPOSITION_MAP | 27KB | Decomposed every high-fragility function into named sub-operations. Left duplicates intentionally. |
| 5 | FRAGILE_FUNCTION_REUSE_MAP | 12KB | Found overlap: "scan -> resolve -> register -> serialize" pattern in most fragile functions. Proposed canonical shared layers. |
| 6 | MIGRATION_SINGLE_AGENT_EXECUTION_PROPOSAL | 74KB | 660 numbered steps across 17 sections. Every step: one action, one artifact, one verification. |

## Section structure

| Range | Section | Type |
|-------|---------|------|
| 001-020 | Loop Discipline | Setup |
| 021-050 | Workspace Scaffolding | Setup |
| 051-080 | Canonical Source Capture | Setup |
| 081-110 | Harness Scaffolding | Setup |
| 111-140 | Coverage And Live-Risk Baseline | Setup |
| 141-165 | Preamble Parity | Parity |
| 166-190 | State Tree Parity | Parity |
| 191-215 | Handlers / Effects Parity | Parity |
| 216-250 | Object Arrays Parity | Parity |
| 251-340 | Maps Zig Parity | Parity |
| 341-370 | Maps Lua Parity | Parity |
| 371-410 | Logic / Runtime Parity | Parity |
| 411-458 | Entry / Split / Finalize Parity | Parity |
| 459-492 | Live Switch And Rollback | Switch |
| 493-517 | Legacy Emit Deletion | Cleanup |
| 518-547 | Duplicate / Global Cleanup | Cleanup |
| 548-660 | Structural Cleanup + Final | Verification |

## Execution

- Setup sections (001-140): ran sequentially by one agent
- Parity sections (141-458): ran in parallel across multiple agents, each assigned a section range
- Switch/cleanup/verification (459-660): ran sequentially

## Severance

After workers reported "done," the legacy emit path was removed from view entirely. The build broke multiple times due to:
- Hidden imports of deleted files
- Bundle ordering dependencies
- Transitive import chains

Each break was fixed forward (completing the new path, not restoring old code). Multiple build-fix cycles until clean.

## Key artifacts preserved

The full migration artifacts are archived in `archive/compiler-dead-code.zip` under `migration/`.

## What made it work

1. **Planning was the real work.** The 6 documents took longer to produce than execution took.
2. **Steps had zero ambiguity.** Workers were tape machines. No judgment required.
3. **Boolean gates prevented drift.** Each section had explicit pass/fail criteria written to disk.
4. **Parity standard was byte-identical.** Not "compiles" or "works." Identical bytes. Every diff was a bug.
5. **Severance was a phase, not a step.** Removing the old code surfaced hidden dependencies that the plan didn't anticipate.
