#!/bin/bash
# Lane 0 gate: the Zig 0.16 build graph resolves and retains every step from
# the pre-migration baseline. New regression-test steps are allowed.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
zig_bin="$repo_root/tools/zig/zig"
if [ ! -x "$zig_bin" ]; then
  echo "FAIL toolchain: $zig_bin is missing; run scripts/fetch-zig.sh"
  exit 1
fi
cd "$repo_root" || exit 1

steps_out=$(mktemp)
steps_err=$(mktemp)
steps_names=$(mktemp)
steps_baseline=$(mktemp)
trap 'rm -f -- "$steps_out" "$steps_err" "$steps_names" "$steps_baseline"' EXIT

"$zig_bin" build --list-steps >"$steps_out" 2>"$steps_err"
if [ $? -ne 0 ]; then
  echo "FAIL list-steps: $(grep -c 'error:' "$steps_err") errors, first: $(grep -m1 'error:' "$steps_err" | cut -c1-160)"
  exit 1
fi
echo "PASS list-steps exits 0"

awk '{print $1}' "$steps_out" | sort -u >"$steps_names"
sort -u zig-out/steps-baseline.txt >"$steps_baseline"
missing=$(comm -23 "$steps_baseline" "$steps_names")
if [ -n "$missing" ]; then
  echo "FAIL baseline steps disappeared:"
  echo "$missing" | head -10
  exit 1
fi
echo "PASS every baseline build step remains available"
exit 0
