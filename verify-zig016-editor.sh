#!/bin/bash
# Zig 0.16 gate 3: the editor cart's flag-gated closure compiles (Debug analysis
# build — same semantics as the ReleaseFast ship, minutes faster), and the
# binaries + tests gates stay green.
Z16=/home/siah/toolchains/zig-x86_64-linux-0.16.0/zig
cd "$(dirname "$0")"
out=$($Z16 build app -Dapp-name=editor -Dapp-source=v8_app.zig -Dbundle-path=$PWD/bundle-editor.js -Duse-v8=true -Dcustom-chrome=true -Dsysroot=deps/sysroot -Dhas-window=true -Dhas-deej=true -Dhas-sqlite=true -Dhas-process=true -Dhas-fs=true -Dhas-telemetry=true -Dhas-paintable=true -Dhas-onnx=true -Dhas-game-build=true -Dhas-game-map=true -Dhas-compiled-world=true -Dhas-capture=true -Dhas-imageops=true 2>&1)
if [ $? -ne 0 ]; then
  echo "FAIL editor-flags :: $(grep -m1 'error:' <<<"$out" | cut -c1-150) ($(grep -c 'error:' <<<"$out") errors)"
  exit 1
fi
echo "PASS editor-flags build"
./verify-zig016-bins.sh | tail -1 | grep -q 'GATE GREEN' || { echo 'GATE RED: bins/tests regressed'; exit 1; }
echo "GATE GREEN (editor flags + binaries + tests)"
exit 0
