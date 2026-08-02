#!/bin/bash
# Count steps and sections in an execution plan.
# Usage: count_steps.sh <EXECUTION_PLAN.md>

set -euo pipefail

PLAN="${1:?Usage: count_steps.sh <EXECUTION_PLAN.md>}"

if [ ! -f "$PLAN" ]; then
  echo "ERROR: $PLAN not found"
  exit 1
fi

echo "=== Step Count ==="
echo ""

# Count numbered steps
TOTAL=$(grep -cP '^\s*-\s*\[[ x]\]\s*\d+\.|^\s*\d+\.\s' "$PLAN" || echo "0")
COMPLETED=$(grep -cP '^\s*-\s*\[x\]\s*\d+\.' "$PLAN" || echo "0")
REMAINING=$((TOTAL - COMPLETED))

echo "Total steps:     $TOTAL"
echo "Completed:       $COMPLETED"
echo "Remaining:       $REMAINING"
echo ""

# Count sections (## headers)
echo "=== Sections ==="
echo ""
grep -P '^## \d' "$PLAN" | while IFS= read -r line; do
  section_name=$(echo "$line" | sed 's/^## //')
  # Count steps in this section (between this ## and next ##)
  echo "  $section_name"
done

echo ""
echo "Total sections: $(grep -cP '^## \d' "$PLAN" || echo "0")"
