// cli/host/zigcache.ts - local zig cache trimming.
//
// Zig NEVER evicts .zig-cache/o entries, and every cart build embeds a fresh
// bundle.js (@embedFile) so every build lands a brand-new entry — hundreds of
// MB to ~1.8GB each. Left alone the cache grows without bound (it reached
// 756GB / a full disk on 2026-07-03, req_2534).
//
// The ONLY safe trim unit is the WHOLE cache. Partial deletion of o/ entries
// is unsound no matter how it's sliced (req_2535): the o/<hash> dir name is
// not stored anywhere — zig re-derives it by hashing a manifest's inputs, so
// a surviving manifest "hits", assumes its artifact dir exists, and the build
// hard-errors ("failed to check cache: ... file_hash FileNotFound") when it
// doesn't. There is no manifest file to scrub because the mapping is
// implicit. Age-pruning o/ + scrubbing string references was tried and
// wedged the dev build on luajit's minilua.
//
// So: successful builds check the cache size and drop the WHOLE cache once
// it crosses a budget. One fully cold rebuild per budget crossing (every
// ~100+ builds) versus an unbounded disk leak.

import { out } from './log.ts';
import { spawnSync } from './process.ts';
import { fsExists } from './fs.ts';

// Cache budget in GB. Once .zig-cache exceeds this after a successful build,
// the whole cache is dropped and the next build runs cold. Override with
// RJIT_CACHE_MAX_GB; 0 or negative disables the auto-trim.
export const DEFAULT_CACHE_MAX_GB = 100;

export function resolveCacheMaxGb(): number {
  const raw = __env('RJIT_CACHE_MAX_GB');
  if (!raw) return DEFAULT_CACHE_MAX_GB;
  const gb = Number(raw);
  return Number.isFinite(gb) ? gb : DEFAULT_CACHE_MAX_GB;
}

export function zigCacheSizeGb(rjitHome: string): number {
  const cache = `${rjitHome}/.zig-cache`;
  if (!fsExists(cache)) return 0;
  const du = spawnSync('du', ['-sb', cache]);
  const bytes = Number(du.stdout.trim().split('\t')[0]);
  return Number.isFinite(bytes) ? bytes / 1e9 : 0;
}

// Drop the entire local cache (artifacts AND manifests — never one without
// the other). Serialized on the same flock every build path queues on, so a
// drop never races an in-flight compile. The next build is fully cold.
export function dropZigCache(rjitHome: string): number {
  const cache = `${rjitHome}/.zig-cache`;
  if (!fsExists(cache)) return 0;
  const lock = `${cache}/.ship.lock`;
  const rm = spawnSync('flock', [
    lock,
    'sh',
    '-c',
    `find '${cache}' -mindepth 1 -maxdepth 1 ! -name '.ship.lock' -exec rm -rf {} +`,
  ]);
  return rm.code;
}

// Post-build guard: drop the cache once it outgrows the budget.
export function trimZigCacheIfOversized(rjitHome: string): void {
  const maxGb = resolveCacheMaxGb();
  if (maxGb <= 0) return;
  const sizeGb = zigCacheSizeGb(rjitHome);
  if (sizeGb <= maxGb) return;
  out(`[clean] zig cache is ${sizeGb.toFixed(0)}GB (budget ${maxGb}GB) - dropping it; the NEXT build runs fully cold`);
  const code = dropZigCache(rjitHome);
  if (code !== 0) out(`[clean] zig cache drop FAILED (exit ${code})`);
}
