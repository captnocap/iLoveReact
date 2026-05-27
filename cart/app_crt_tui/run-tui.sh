#!/bin/sh
# run-tui.sh — exec'd by <Terminal shell="..."> inside app_crt_tui.
#
# The framework's PTY only takes a single binary path (no argv beyond it),
# so this wrapper does the cd + arg dance. cd's to repo root (two parents
# up from this script), then exec's scripts/tui on the gallery cart.
# `exec` so the PTY's child process is the TUI itself, not a shell layer.

set -e
cd "$(dirname "$0")/../.."
exec ./scripts/tui tui/examples/gallery.tsx
