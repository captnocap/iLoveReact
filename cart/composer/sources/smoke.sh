#!/bin/bash
# smoke.sh — offline adapter smoke test.
#
# Bundles cart/composer/sources/smoke.ts and runs it under tools/v8cli with
# fixtures injected (no network). See smoke.ts for what it asserts.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
ROOT="$PWD"
mkdir -p .cache
tools/esbuild cart/composer/sources/smoke.ts \
  --bundle --platform=neutral --format=iife --target=es2022 \
  --alias:@reactjit/runtime="$ROOT/runtime" \
  --alias:@reactjit/core="$ROOT/runtime/core_stub.ts" \
  --outfile=.cache/sources-smoke.bundle.js \
  --tsconfig-raw='{"compilerOptions":{"target":"es2022","module":"esnext","moduleResolution":"bundler","strict":false}}'
exec tools/v8cli .cache/sources-smoke.bundle.js
