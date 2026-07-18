#!/bin/bash
# Zig 0.16 gate 3: the editor DEV-HOST closure (the user's real daily flag set)
# compiles in the repository-required ReleaseFast mode, and the binaries +
# tests gates stay green.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
zig_bin="$repo_root/tools/zig/zig"
if [ ! -x "$zig_bin" ]; then
  echo "FAIL toolchain: $zig_bin is missing; run scripts/fetch-zig.sh"
  exit 1
fi
cd "$repo_root" || exit 1
out=$("$zig_bin" build app -Dapp-name=editor -Dapp-source=v8_app.zig -Dbundle-path=$PWD/bundle-editor.js -Duse-v8=true -Dcustom-chrome=true -Dsysroot=deps/sysroot -Ddev-mode=true -Dhas-window=true -Dhas-audio=true -Dhas-midi=true -Dhas-deej=true -Dhas-terminal=true -Dhas-physics=true -Dhas-sqlite=true -Dhas-privacy=true -Dhas-process=true -Dhas-httpsrv=true -Dhas-wssrv=true -Dhas-net=true -Dhas-tor=true -Dhas-websocket=true -Dhas-fs=true -Dhas-telemetry=true -Dhas-zigcall=true -Dhas-sdk=true -Dhas-voice=true -Dhas-audio-input=true -Dhas-paintable=true -Dhas-onnx=true -Dhas-physics-lab=true -Dhas-game-physics=true -Dhas-game-build=true -Dhas-game-map=true -Dhas-game-pathing=true -Dhas-game-camera=true -Dhas-compiled-world=true -Dhas-pg=true -Dhas-embed=true -Dhas-doom=true -Dhas-capture=true -Dhas-imageops=true -Doptimize=ReleaseFast 2>&1)
if [ $? -ne 0 ]; then
  echo "FAIL editor-flags :: $(grep -m1 'error:' <<<"$out" | cut -c1-150) ($(grep -c 'error:' <<<"$out") errors)"
  exit 1
fi
echo "PASS editor-flags build"
./verify-zig016-bins.sh | tail -1 | grep -q 'GATE GREEN' || { echo 'GATE RED: bins/tests regressed'; exit 1; }
echo "GATE GREEN (editor flags + binaries + tests)"
exit 0
