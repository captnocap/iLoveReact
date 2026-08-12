#!/usr/bin/env bash
# Driver-side grading: promote the codex workdir copies onto the live tree, run the
# real gates, diff against W0 baselines. NEVER commits and NEVER reverts on its own —
# it prints the exact command for either outcome and the driver decides.
# Usage: plan/3d-refactor/scripts/grade-wave.sh <wave>
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PLAN="$ROOT/plan/3d-refactor"
W="${1:?usage: grade-wave.sh <wave>}"
source "$PLAN/scripts/waves.env"
FILES="$(wave_files "$W")"
WD="/tmp/codex-3d/$W"
OUT="$PLAN/reports/sections/$W-suites"
mkdir -p "$OUT"
fail=0
say() { echo "[grade:$W] $*"; }

# 1. Clean-tree precondition: the only allowed dirt is a previous grade of this wave.
if [ -n "$(cd "$ROOT" && git status --porcelain -- $FILES)" ]; then
  say "WARN: target files already dirty in live tree (previous grade attempt?)."
  say "      git status of targets:"; (cd "$ROOT" && git status --short -- $FILES)
fi

# 2. Workdir verify must pass in the driver's own shell first.
( cd "$WD" && bash verify.sh ) || { say "FAIL: verify.sh red in driver shell"; exit 1; }

# 3. Promote copies onto live paths.
for f in $FILES; do
  cp "$WD/work/$(basename "$f")" "$ROOT/$f"
  say "promoted work/$(basename "$f") -> $f"
done

# 4. Real gates, quiet, tee'd. Build first (ship flock serializes).
cd "$ROOT"
say "gate: build (SHIP_RUN_PACKAGE=0 rjit ship editor)"
if ! SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor > "$OUT/build.log" 2>&1; then
  say "FAIL: build — tail:"; tail -20 "$OUT/build.log"; fail=1
fi
if [ $fail -eq 0 ]; then
  say "gate: test-scene3d-mesh-drag"
  ./tools/zig/zig build test-scene3d-mesh-drag > "$OUT/mesh_drag.txt" 2>&1 \
    || { say "FAIL: mesh-drag — tail:"; tail -15 "$OUT/mesh_drag.txt"; fail=1; }
fi
if [ $fail -eq 0 ]; then
  for suite in mesh-port-parity part-sync-parity; do
    say "gate: $suite"
    ./tools/$suite > "$OUT/${suite//-/_}.txt" 2>&1
    echo "exit=$?" >> "$OUT/${suite//-/_}.txt"
  done
  # Baseline comparison: no NEW deltas (a failing baseline stays failing identically).
  for pair in "mesh_port_parity.txt:mesh_port.txt" "part_sync_parity.txt:part_sync.txt"; do
    got="${pair%%:*}"; base="${pair##*:}"
    if ! diff -q "$OUT/$got" "$PLAN/contracts/$base" >/dev/null 2>&1; then
      say "DELTA vs baseline in $base — first differing lines:"
      diff "$PLAN/contracts/$base" "$OUT/$got" | head -25
      say "(driver judgment: benign timing noise vs real drift)"
    else
      say "ok: $base identical to baseline"
    fi
  done
fi

# 5. Scope containment: show what actually changed for the driver's diff audit.
say "diff stat vs HEAD:"
git diff --stat -- $FILES
say "hunk map (@@ lines):"
git diff -U0 -- $FILES | grep '^@@' | head -40

if [ $fail -eq 0 ]; then
  say "GATES GREEN. Private probes next: $PLAN/scripts/private-probes.sh $W"
  say "Commit with:"
  say "  git add $FILES && git commit -m 'refactor(3d): <title> (USER ASK req_4259)'"
else
  say "GATES RED. Revert with:"
  say "  git checkout -- $FILES"
  exit 1
fi
