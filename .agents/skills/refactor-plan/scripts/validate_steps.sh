#!/bin/bash
# Validate an execution plan for task-shaped rows (hidden judgment).
# Usage: validate_steps.sh <EXECUTION_PLAN.md>
#
# Scans every numbered step for danger words that indicate the step
# requires inference rather than mechanical execution.
# Exit code 0 = all steps are real. Exit code 1 = task-shaped rows found.

set -euo pipefail

PLAN="${1:?Usage: validate_steps.sh <EXECUTION_PLAN.md>}"

if [ ! -f "$PLAN" ]; then
  echo "ERROR: $PLAN not found"
  exit 1
fi

# Danger words that indicate hidden judgment in a step.
# Each pattern is checked case-insensitively against numbered step lines.
DANGER_PATTERNS=(
  "compare .* to"
  "verify whether"
  "decide whether"
  "as needed"
  "correct branch"
  "equivalent"
  "match exactly"
  "patch it"
  "if appropriate"
  "ensure that"
  "clean up"
  "fix any"
  "check whether"
  "make sure"
  "should be"
  "looks correct"
  "seems right"
  "probably"
  "might need"
  "consider"
  "think about"
  "figure out"
)

FAILURES=0
TOTAL_STEPS=0

# Match lines that look like numbered steps: "- [ ] 42." or "- [x] 42." or "42. " at start
while IFS= read -r line; do
  # Extract step number and content
  if echo "$line" | grep -qP '^\s*-\s*\[[ x]\]\s*\d+\.|^\s*\d+\.\s'; then
    TOTAL_STEPS=$((TOTAL_STEPS + 1))
    step_num=$(echo "$line" | grep -oP '\d+' | head -1)

    for pattern in "${DANGER_PATTERNS[@]}"; do
      if echo "$line" | grep -qiP "$pattern"; then
        echo "TASK-SHAPED: Step $step_num matches '$pattern'"
        echo "  $line"
        echo ""
        FAILURES=$((FAILURES + 1))
        break  # One failure per step is enough
      fi
    done
  fi
done < "$PLAN"

echo "---"
echo "Total steps scanned: $TOTAL_STEPS"
echo "Task-shaped rows found: $FAILURES"

if [ "$FAILURES" -gt 0 ]; then
  echo ""
  echo "FAIL: $FAILURES steps contain hidden judgment. Expand them into concrete sub-steps."
  echo "See references/step_integrity.md for expansion rules."
  exit 1
else
  echo ""
  echo "PASS: All steps are concrete."
  exit 0
fi
