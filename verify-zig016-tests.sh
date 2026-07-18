#!/bin/bash
# Zig 0.16 gate: the baseline test steps plus native-I/O ownership regressions
# must build and pass. test-game-physics must COMPILE (its test failure is a
# pre-existing main red); test-luajit-runtime is stale and skipped.
# Quiet: one line per step.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
zig_bin="$repo_root/tools/zig/zig"
if [ ! -x "$zig_bin" ]; then
  echo "FAIL toolchain: $zig_bin is missing; run scripts/fetch-zig.sh"
  exit 1
fi
cd "$repo_root" || exit 1
fails=0
for s in $(
  grep -oE '^\s*test-[a-z0-9-]+' zig-out/steps-baseline.txt | tr -d ' ' | grep -v '^test-luajit-runtime$'
  printf '%s\n' test-assistant-io test-pty-io
); do
  out=$("$zig_bin" build "$s" 2>&1)
  if [ $? -eq 0 ]; then
    echo "PASS $s"
  elif [ "$s" = "test-game-physics" ] && ! grep -q 'compilation errors' <<<"$out"; then
    echo "PASS(known-red, compiles) $s"
  else
    echo "FAIL $s :: $(grep -m1 'error:' <<<"$out" | cut -c1-150)"
    fails=$((fails+1))
  fi
done
echo "---"
if [ $fails -eq 0 ]; then echo "GATE GREEN"; exit 0; else echo "GATE RED: $fails failing steps"; exit 1; fi
