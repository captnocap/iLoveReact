#!/bin/bash
# fetch-zig — download the repository's pinned Zig 0.16.0 toolchain.
#
# Run once after cloning the repo:
#   scripts/fetch-zig.sh
#
# The 165 MB binary + 215 MB lib/ tree are kept out of git (.gitignore)
# and pulled from ziglang.org on demand. End users of the rjit SDK never
# run this — they download the prebuilt rjit binary from GitHub Releases,
# which already has zig embedded.
set -euo pipefail

ZIG_VERSION="0.16.0"
ZIG_TARBALL="zig-x86_64-linux-${ZIG_VERSION}.tar.xz"
ZIG_URL="https://ziglang.org/download/${ZIG_VERSION}/${ZIG_TARBALL}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/tools/zig"
mkdir -p "$DEST"

if [[ -x "$DEST/zig" ]] && "$DEST/zig" version 2>/dev/null | grep -q "^${ZIG_VERSION}$"; then
    echo "[fetch-zig] $DEST/zig is already $ZIG_VERSION — nothing to do."
    exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "[fetch-zig] downloading $ZIG_URL..."
curl -fsSL -o "$TMP/$ZIG_TARBALL" "$ZIG_URL"

echo "[fetch-zig] extracting..."
(cd "$TMP" && tar xf "$ZIG_TARBALL")
SRC="$TMP/zig-x86_64-linux-${ZIG_VERSION}"
[[ -x "$SRC/zig" ]] || { echo "[fetch-zig] tarball missing 'zig' binary" >&2; exit 1; }

# Replace the binary + lib tree atomically. Keep tools/zig/cache/ untouched
# (zig's package fetch cache).
rm -rf "$DEST/lib"
cp "$SRC/zig" "$DEST/zig"
cp -a "$SRC/lib" "$DEST/lib"

echo "[fetch-zig] installed $($DEST/zig version) → $DEST/zig"
