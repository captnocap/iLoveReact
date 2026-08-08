#!/usr/bin/env bash
# fetch-lore — install the release-pinned Lore C library used by -Dhas-lore.
#
# The authoritative C header is tracked so Zig's @cImport remains reproducible.
# The 34 MB shared library stays out of Git and is fetched from Epic Games' exact
# v0.8.6 release artifact. Both the archive and extracted payload are verified.
# The upstream ELF omits DT_SONAME, which makes Zig embed its absolute build-host
# path in consumers. A pinned patchelf release adds `liblore.so` before install so
# `$ORIGIN` remains a real relocation contract rather than decorative metadata.

set -euo pipefail

LORE_VERSION="0.8.6"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEADER_OUT="$REPO_ROOT/deps/lore/include/lore.h"
LIB_OUT="$REPO_ROOT/deps/lore/lib/liblore.so"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    ASSET="liblore-v${LORE_VERSION}-x86_64-unknown-linux-gnu.tar.gz"
    ARCHIVE_SHA256="36087136120ecd50606ea879224b96434afc437cb6d9e2ce9c3bc6e5ddbf7695"
    ;;
  *)
    echo "[fetch-lore] unsupported host: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

HEADER_SHA256="fc5dcffbe57a355c4924701c0a529b55ecbde8ad7b89ffbf84b24ddedf2c2481"
UPSTREAM_LIB_SHA256="a11affc18c9911b636d7b9bd2f6ef63f1154e00f686e3d74bd35521964299147"
INSTALLED_LIB_SHA256="976d6c08b752adb740cb86513b5456699a5a9383c4c47f5269a29935a3ae4acc"
URL="https://github.com/EpicGames/lore/releases/download/v${LORE_VERSION}/${ASSET}"

PATCHELF_VERSION="0.18.0"
PATCHELF_ASSET="patchelf-${PATCHELF_VERSION}-x86_64.tar.gz"
PATCHELF_SHA256="ce84f2447fb7a8679e58bc54a20dc2b01b37b5802e12c57eece772a6f14bf3f0"
PATCHELF_URL="https://github.com/NixOS/patchelf/releases/download/${PATCHELF_VERSION}/${PATCHELF_ASSET}"

if [[ -f "$HEADER_OUT" && -f "$LIB_OUT" ]] &&
   printf '%s  %s\n' "$HEADER_SHA256" "$HEADER_OUT" | sha256sum --check --status &&
   printf '%s  %s\n' "$INSTALLED_LIB_SHA256" "$LIB_OUT" | sha256sum --check --status; then
  echo "[fetch-lore] Lore ${LORE_VERSION} already verified — nothing to do."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ARCHIVE="$TMP/$ASSET"
PATCHELF_ARCHIVE="$TMP/$PATCHELF_ASSET"
EXTRACT="$TMP/extract"
mkdir -p "$EXTRACT"

echo "[fetch-lore] downloading $ASSET..."
curl -fL --retry 3 -o "$ARCHIVE" "$URL"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$ARCHIVE" | sha256sum --check --status || {
  echo "[fetch-lore] archive checksum mismatch" >&2
  exit 1
}

tar xzf "$ARCHIVE" -C "$EXTRACT" ./lore.h ./liblore.so
printf '%s  %s\n' "$HEADER_SHA256" "$EXTRACT/lore.h" | sha256sum --check --status || {
  echo "[fetch-lore] lore.h checksum mismatch" >&2
  exit 1
}
printf '%s  %s\n' "$UPSTREAM_LIB_SHA256" "$EXTRACT/liblore.so" | sha256sum --check --status || {
  echo "[fetch-lore] liblore.so checksum mismatch" >&2
  exit 1
}

echo "[fetch-lore] normalizing liblore.so SONAME..."
curl -fL --retry 3 -o "$PATCHELF_ARCHIVE" "$PATCHELF_URL"
printf '%s  %s\n' "$PATCHELF_SHA256" "$PATCHELF_ARCHIVE" | sha256sum --check --status || {
  echo "[fetch-lore] patchelf archive checksum mismatch" >&2
  exit 1
}
tar xzf "$PATCHELF_ARCHIVE" -C "$TMP" ./bin/patchelf
"$TMP/bin/patchelf" --set-soname liblore.so "$EXTRACT/liblore.so"
[[ "$("$TMP/bin/patchelf" --print-soname "$EXTRACT/liblore.so")" == "liblore.so" ]] || {
  echo "[fetch-lore] failed to install relocatable liblore.so SONAME" >&2
  exit 1
}
printf '%s  %s\n' "$INSTALLED_LIB_SHA256" "$EXTRACT/liblore.so" | sha256sum --check --status || {
  echo "[fetch-lore] normalized liblore.so checksum mismatch" >&2
  exit 1
}

mkdir -p "$(dirname "$HEADER_OUT")" "$(dirname "$LIB_OUT")"
install -m 0644 "$EXTRACT/lore.h" "$HEADER_OUT"
install -m 0644 "$EXTRACT/liblore.so" "$LIB_OUT"
echo "[fetch-lore] installed Lore ${LORE_VERSION} -> deps/lore/"
