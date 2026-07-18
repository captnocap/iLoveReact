#!/bin/bash
# Zig 0.16 gate 2: every non-test build step compiles; test gate stays green.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
zig_bin="$repo_root/tools/zig/zig"
if [ ! -x "$zig_bin" ]; then
  echo "FAIL toolchain: $zig_bin is missing; run scripts/fetch-zig.sh"
  exit 1
fi
cd "$repo_root" || exit 1
fails=0
for s in v8-hello v8-cli hmsc-parity-compiler flora-dump flora-geometry loader-geometry gamefile-writer app; do
  grep -q "^\s*$s\b" zig-out/steps-baseline.txt || continue
  out=$("$zig_bin" build "$s" 2>&1)
  if [ $? -eq 0 ]; then
    echo "PASS $s"
  else
    echo "FAIL $s :: $(grep -m1 'error:' <<<"$out" | cut -c1-150)"
    fails=$((fails+1))
  fi
done
echo "---"
if [ $fails -ne 0 ]; then echo "GATE RED: $fails failing binaries"; exit 1; fi
./verify-zig016-tests.sh | tail -1 | grep -q 'GATE GREEN' || { echo 'GATE RED: test sweep regressed'; exit 1; }
echo "GATE GREEN (binaries + tests)"
exit 0
