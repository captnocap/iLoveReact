#!/bin/bash
# Zig 0.16 migration gate: the 33 baseline-green test steps must build AND pass
# under 0.16; test-game-physics must COMPILE (its test failure is a pre-existing
# main red); test-luajit-runtime is skipped (stale step, red on 0.15.2 too).
# Quiet: one line per step.
Z16=/home/siah/toolchains/zig-x86_64-linux-0.16.0/zig
cd "$(dirname "$0")"
fails=0
for s in $(grep -oE '^\s*test-[a-z0-9-]+' zig-out/steps-baseline.txt | tr -d ' ' | grep -v '^test-luajit-runtime$'); do
  out=$($Z16 build "$s" 2>&1)
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
