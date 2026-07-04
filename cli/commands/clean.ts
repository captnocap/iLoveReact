// cli/commands/clean.ts - prune the local zig cache.
//
// `rjit clean`            prune .zig-cache/o entries older than 7 days
// `rjit clean --days N`   custom age horizon
// `rjit clean --all`      drop every cache entry (next build is fully cold)
//
// Successful ship/dev builds already auto-prune at the default horizon
// (cli/host/zigcache.ts); this command is the manual lever plus a size report.

import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';
import { fsExists } from '../host/fs.ts';
import { DEFAULT_PRUNE_DAYS, pruneZigCache } from '../host/zigcache.ts';

export async function run(argv: string[]): Promise<number> {
  let days = DEFAULT_PRUNE_DAYS;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') {
      all = true;
    } else if (arg === '--days') {
      days = Number(argv[++i]);
      if (!Number.isFinite(days) || days < 0) {
        err('[clean] --days needs a non-negative number');
        return 1;
      }
    } else {
      err(`[clean] unknown arg: ${arg}`);
      err('Usage: rjit clean [--days N] [--all]');
      return 1;
    }
  }

  const rjitHome = __env('RJIT_HOME') || __cwd();
  const cacheDir = `${rjitHome}/.zig-cache/o`;

  if (all) {
    if (!fsExists(cacheDir)) {
      out('[clean] no local zig cache');
      return 0;
    }
    const lock = `${rjitHome}/.zig-cache/.ship.lock`;
    out('[clean] dropping the ENTIRE local zig cache (next build is fully cold)...');
    const rm = spawnSync('flock', [lock, 'sh', '-c', `rm -rf '${cacheDir}'/*`]);
    if (rm.code !== 0) {
      err(`[clean] failed (exit ${rm.code}): ${rm.stderr.trim()}`);
      return rm.code || 1;
    }
  } else {
    pruneZigCache(rjitHome, days, { verbose: true });
  }

  reportSize(rjitHome, '.zig-cache');
  reportSize(rjitHome, 'zig-out');
  return 0;
}

function reportSize(rjitHome: string, rel: string): void {
  const path = `${rjitHome}/${rel}`;
  if (!fsExists(path)) return;
  const du = spawnSync('du', ['-sh', path]);
  const size = du.stdout.trim().split('\t')[0] ?? '?';
  out(`[clean] ${rel}: ${size}`);
}
