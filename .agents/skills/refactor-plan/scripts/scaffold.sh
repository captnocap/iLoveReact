#!/bin/bash
# Scaffold the plan directory structure for a refactor plan.
# Usage: scaffold.sh <plan-dir>
# Example: scaffold.sh tsz/compiler/migration

set -euo pipefail

PLAN_DIR="${1:?Usage: scaffold.sh <plan-dir>}"

if [ -d "$PLAN_DIR" ]; then
  echo "ERROR: $PLAN_DIR already exists. Remove it first or pick a different name."
  exit 1
fi

mkdir -p "$PLAN_DIR"/{contracts,reports/{sections,live_risks},state}

# Phase documents (created empty — phases fill them)
touch "$PLAN_DIR/INVENTORY.md"
touch "$PLAN_DIR/THESIS.md"
touch "$PLAN_DIR/FLOW_MAP.md"
touch "$PLAN_DIR/DECOMPOSITION_MAP.md"
touch "$PLAN_DIR/REUSE_MAP.md"
touch "$PLAN_DIR/EXECUTION_PLAN.md"

# Control board
cat > "$PLAN_DIR/control_board.md" << 'EOF'
# Control Board

## Phase 1: Inventory
inventory_complete_and_verified: false

## Phase 2: Thesis
thesis_names_target_shape_and_done_standard: false

## Phase 3: Flow Map
flow_map_traces_all_live_paths: false

## Phase 4: Decomposition
all_high_fragility_units_decomposed: false

## Phase 5: Reuse Analysis
canonical_shapes_identified: false

## Phase 6: Execution Plan
all_steps_pass_integrity_check: false

## Phase 7: Severance Build
legacy_deleted: false
clean_build_passes: false
all_tests_pass_without_legacy: false
closure_summary_written: false
EOF

# State tracking
echo "0" > "$PLAN_DIR/state/current_phase.txt"
echo "0" > "$PLAN_DIR/state/current_step.txt"
touch "$PLAN_DIR/state/completed.txt"
touch "$PLAN_DIR/state/blocked.txt"

echo "Scaffolded plan directory at $PLAN_DIR"
echo ""
echo "Directory structure:"
find "$PLAN_DIR" -type f | sort | sed "s|^$PLAN_DIR/|  |"
