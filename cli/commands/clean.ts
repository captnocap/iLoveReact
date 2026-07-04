// cli/commands/clean.ts - drop the local zig cache.
//
// `rjit clean`          report cache sizes (no deletion)
// `rjit clean --drop`   drop the WHOLE local zig cache; next build is cold
//
// There is deliberately no partial/age-based prune: zig derives o/<hash> dir
// names by re-hashing manifest inputs, so deleting a subset of o/ poisons
// surviving manifests and wedges every build with "failed to check cache:
// ... file_hash FileNotFound" (req_2535). All or nothing.
//
// Successful ship/dev builds already auto-drop once the cache outgrows its
// budget (cli/host/zigcache.ts, RJIT_CACHE_MAX_GB, default 100GB).

import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';
import { fsExists } from '../host/fs.ts';
import { DEFAULT_CACHE_MAX_GB, dropZigCache, resolveCacheMaxGb } from '../host/zigcache.ts';

export async function run(argv: string[]): Promise<number> {
  let drop = false;
  for (const arg of argv) {
    if (arg === '--drop' || arg === '--all') {
      drop = true;
    } else {
      err(`[clean] unknown arg: ${arg}`);
      err('Usage: rjit clean [--drop]');
      return 1;
    }
  }

  const rjitHome = __env('RJIT_HOME') || __cwd();

  if (drop) {
    if (!fsExists(`${rjitHome}/.zig-cache`)) {
      out('[clean] no local zig cache');
      return 0;
    }
    out('[clean] dropping the ENTIRE local zig cache (next build is fully cold)...');
    const code = dropZigCache(rjitHome);
    if (code !== 0) {
      err(`[clean] failed (exit ${code})`);
      return code || 1;
    }
  } else {
    const maxGb = resolveCacheMaxGb();
    const budget = maxGb > 0 ? `${maxGb}GB` : 'disabled';
    out(`[clean] auto-drop budget: ${budget} (default ${DEFAULT_CACHE_MAX_GB}GB, RJIT_CACHE_MAX_GB overrides)`);
    out('[clean] run `rjit clean --drop` to drop the cache now');
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
