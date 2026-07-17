#!/bin/bash
# Lane 0 gate: 0.16 build graph resolves; step list identical to 0.15.2 baseline;
# edits confined to build scripts. Quiet: one line per check.
Z16=/home/siah/toolchains/zig-x86_64-linux-0.16.0/zig
cd "$(dirname "$0")"

$Z16 build --list-steps > /tmp/zig016-steps.out 2>/tmp/zig016-steps.err
if [ $? -ne 0 ]; then
  echo "FAIL list-steps: $(grep -c 'error:' /tmp/zig016-steps.err) errors, first: $(grep -m1 'error:' /tmp/zig016-steps.err | cut -c1-160)"
  exit 1
fi
echo "PASS list-steps exits 0"

awk '{print $1}' /tmp/zig016-steps.out > /tmp/zig016-steps.names
if ! diff -q zig-out/steps-baseline.txt /tmp/zig016-steps.names >/dev/null; then
  echo "FAIL step list differs from baseline:"; diff zig-out/steps-baseline.txt /tmp/zig016-steps.names | head -10
  exit 1
fi
echo "PASS step list matches 0.15.2 baseline (42 steps)"

BAD=$(git diff --name-only | grep -vE '^(build\.zig|build\.zig\.zon|deps/[^/]+/build\.zig)$')
if [ -n "$BAD" ]; then
  echo "FAIL out-of-scope modifications:"; echo "$BAD" | head -10
  exit 1
fi
echo "PASS edits confined to build scripts"
exit 0
