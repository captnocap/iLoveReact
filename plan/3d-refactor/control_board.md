# Control Board

## Phase 1: Inventory
inventory_complete_and_verified: true

## Phase 2: Thesis
thesis_names_target_shape_and_done_standard: true

## Phase 3: Flow Map
flow_map_traces_all_live_paths: true

## Phase 4: Decomposition
all_high_fragility_units_decomposed: true

## Phase 5: Reuse Analysis
canonical_shapes_identified: true

## Phase 6: Execution Plan
all_steps_pass_integrity_check: true
# W1/W2/W5 specs + verify gates pre-written; W3/W4/W6-W9 authored between waves
# from DECOMPOSITION_MAP + SPEC-TEMPLATE-RULES (all anchors pinned there).

## Overnight run gates (Phase B)
freeze_committed_and_baselines_captured: false   # Step 0 — at launch
w1_graded_and_committed: false
w2_graded_and_committed: false
w3_graded_and_committed: false
w4_graded_and_committed: false
w5_graded_and_committed: false
w6_graded_and_committed: false
w7_graded_and_committed: false
w8_graded_and_committed: false
w9_graded_and_committed: false
morning_report_written: false

## Phase 7: Severance Build (continuous per-wave; final pass before morning report)
legacy_deleted: false
clean_build_passes: false
all_tests_pass_without_legacy: false
closure_summary_written: false

## Phase C (the chapter split) — NOT tonight
c_manifest_generated: false        # OF4, read-only, optional quota burn
c_phase_planned: false             # planned against the post-B frozen file
