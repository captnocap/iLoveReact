// cli/host/zigcache.ts - local zig cache pruning.
//
// Zig NEVER evicts .zig-cache/o entries, and every cart build embeds a fresh
// bundle.js (@embedFile) so every build lands a brand-new entry — hundreds of
// MB to ~1.8GB each. Left alone the cache grows without bound (it reached
// 756GB / a full disk on 2026-07-03, req_2534). Every successful build path
// calls pruneZigCache; `rjit clean` is the manual lever.
//
// Age is dir mtime. A cache HIT does not bump the o/<hash> dir mtime, so a
// still-hot dependency entry can age out and rebuild cold once — that costs
// minutes every prune horizon, versus an unbounded disk leak.

import { out } from './log.ts';
import { spawnSync } from './process.ts';
import { fsExists } from './fs.ts';

// Entries untouched for this many days get pruned after successful builds.
// Override with RJIT_CACHE_PRUNE_DAYS; 0 or negative disables the auto-prune.
export const DEFAULT_PRUNE_DAYS = 7;

export function resolvePruneDays(): number {
  const raw = __env('RJIT_CACHE_PRUNE_DAYS');
  if (!raw) return DEFAULT_PRUNE_DAYS;
  const days = Number(raw);
  return Number.isFinite(days) ? days : DEFAULT_PRUNE_DAYS;
}

const STALE_FIND_ARGS = (dir: string, days: number): string[] =>
  [dir, '-maxdepth', '1', '-mindepth', '1', '-type', 'd', '-mtime', `+${days}`];

export function pruneZigCache(rjitHome: string, days: number, opts: { verbose?: boolean } = {}): number {
  if (days <= 0) return 0;
  const dir = `${rjitHome}/.zig-cache/o`;
  if (!fsExists(dir)) return 0;

  const list = spawnSync('find', STALE_FIND_ARGS(dir, days));
  const stale = list.stdout.split('\n').filter((line) => line.trim().length > 0);
  if (stale.length === 0) {
    if (opts.verbose) out(`[clean] zig cache: nothing older than ${days} days`);
    return 0;
  }

  // Serialize with builds on the same flock every build path queues on, so a
  // prune never deletes an entry out from under an in-flight compile.
  const lock = `${rjitHome}/.zig-cache/.ship.lock`;
  const rm = spawnSync('flock', [lock, 'find', ...STALE_FIND_ARGS(dir, days), '-exec', 'rm', '-rf', '{}', '+']);
  if (rm.code !== 0) {
    out(`[clean] zig cache prune FAILED (exit ${rm.code}): ${rm.stderr.trim()}`);
    return 0;
  }
  out(`[clean] zig cache: pruned ${stale.length} entries older than ${days} days`);
  return stale.length;
}
