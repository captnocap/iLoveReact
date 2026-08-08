// cli/commands/clean.ts - drop the local zig cache and built binaries, safely.
//
// `rjit clean`          survey only — sizes and what every path IS. Deletes nothing.
// `rjit clean --drop`   drop the WHOLE local zig cache; next build is cold
// `rjit clean --bin`    delete DECLARED build artifacts under zig-out (never authored data)
//
// --bin exists so nobody hand-writes `rm -rf zig-out/...` again. On 2026-08-08 that
// destroyed a full-scale authored world map and the LM Studio symlink set, because
// zig-out reads as "build output" and the listing said nothing about what was inside
// (req_4083). Every path is CLASSIFIED and ANNOUNCED before a single delete, and anything
// not declared regenerable is kept — the failure mode of forgetting to declare a new
// artifact is a kept file, never a lost one.
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
import { fsExists, fsList } from '../host/fs.ts';
import { DEFAULT_CACHE_MAX_GB, dropZigCache, resolveCacheMaxGb } from '../host/zigcache.ts';
import { announce, surveyOutputDir } from '../dev/deletable.ts';
import { scanDevHosts } from '../dev/orphan-hosts.ts';
import { DEV_SOCKET_PATH } from '../dev/rebuild-signal.ts';

export async function run(argv: string[]): Promise<number> {
  let drop = false;
  let bin = false;
  for (const arg of argv) {
    if (arg === '--drop' || arg === '--all') {
      drop = true;
    } else if (arg === '--bin') {
      bin = true;
    } else {
      err(`[clean] unknown arg: ${arg}`);
      err('Usage: rjit clean [--drop] [--bin]');
      return 1;
    }
  }

  const rjitHome = __env('RJIT_HOME') || __cwd();
  const devCacheDomains = ['.cache/zig/dev-core', '.cache/zig/dev-scene3d', '.cache/zig/dev-game'];

  if (drop) {
    if (fsExists(`${rjitHome}/.zig-cache`)) {
      out('[clean] dropping the ENTIRE local zig cache (next build is fully cold)...');
      const code = dropZigCache(rjitHome);
      if (code !== 0) {
        err(`[clean] failed (exit ${code})`);
        return code || 1;
      }
    }
    for (const domain of devCacheDomains) {
      const path = `${rjitHome}/${domain}`;
      if (!fsExists(path)) continue;
      out(`[clean] dropping whole ${domain} domain...`);
      const removed = spawnSync('rm', ['-rf', '--', path]);
      if (removed.code !== 0) {
        err(`[clean] failed to drop ${domain} (exit ${removed.code})`);
        return removed.code || 1;
      }
    }
  } else {
    const maxGb = resolveCacheMaxGb();
    const budget = maxGb > 0 ? `${maxGb}GB` : 'disabled';
    out(`[clean] auto-drop budget: ${budget} (default ${DEFAULT_CACHE_MAX_GB}GB, RJIT_CACHE_MAX_GB overrides)`);
    out('[clean] run `rjit clean --drop` to drop the cache now');
  }

  // The survey ALWAYS prints, whether or not anything is being deleted. Seeing what a
  // directory holds should not require asking for a delete first.
  const verdicts = surveyOutputDir(rjitHome, 'zig-out');
  announce(verdicts, out);

  if (bin) {
    const running = scanDevHosts(rjitHome, DEV_SOCKET_PATH);
    const live = running.live.map((host) => host.pid);
    if (live.length > 0) {
      // A running host's binary can be unlinked safely on Linux, but its dev-modules are
      // dlopened on demand — pulling those out from under a live session breaks it.
      out(`[clean] ${live.length} dev host(s) still running (pid ${live.join(', ')}) — keeping zig-out/dev-modules and zig-out/bin/reactjit-dev`);
    }
    for (const row of verdicts) {
      if (!row.safeToDelete) continue;
      if (live.length > 0 && (row.path === 'zig-out/dev-modules' || row.path === 'zig-out/bin')) {
        const spared = dropBuiltBinaries(rjitHome, row.path, live.length > 0);
        out(`[clean] ${row.path}: removed ${spared.removed}, kept ${spared.kept} in use`);
        continue;
      }
      out(`[clean] removing ${row.path} (${row.size}, ${row.what})`);
      spawnSync('rm', ['-rf', '--', `${rjitHome}/${row.path}`]);
    }
  }

  reportSize(rjitHome, '.zig-cache');
  for (const domain of devCacheDomains) reportSize(rjitHome, domain);
  reportSize(rjitHome, 'zig-out');
  return 0;
}

/** Delete built binaries one by one, sparing what a running dev host needs. */
function dropBuiltBinaries(rjitHome: string, rel: string, hostsRunning: boolean): { removed: number; kept: number } {
  const root = `${rjitHome}/${rel}`;
  if (!fsExists(root)) return { removed: 0, kept: 0 };
  let removed = 0;
  let kept = 0;
  for (const name of fsList(root)) {
    const isLiveHost = hostsRunning && (name === 'reactjit-dev' || name === 'reactjit-dev-tui'
      || (rel === 'zig-out/dev-modules' && (name === 'scene3d' || name === 'game' || name === 'records')));
    if (isLiveHost) { kept += 1; continue; }
    spawnSync('rm', ['-rf', '--', `${root}/${name}`]);
    removed += 1;
  }
  return { removed, kept };
}

function reportSize(rjitHome: string, rel: string): void {
  const path = `${rjitHome}/${rel}`;
  if (!fsExists(path)) return;
  const du = spawnSync('du', ['-sh', path]);
  const size = du.stdout.trim().split('\t')[0] ?? '?';
  out(`[clean] ${rel}: ${size}`);
}
