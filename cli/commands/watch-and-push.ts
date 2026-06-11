// cli/commands/watch-and-push.ts - watch a cart and push rebuilds to dev host.

import { bundleFlags } from '../cart/bundle.ts';
import { tryFsStat } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawn, spawnSync } from '../host/process.ts';
import { DEV_SOCKET_PATH, sendRebuildNotice, shortHash, staleDevHost } from '../dev/rebuild-signal.ts';

const POLL_MS = 200;

export async function run(argv: string[]): Promise<number> {
  const cartName = argv[0];
  const cartFile = argv[1];
  const outPath = argv[2];
  const tui = argv.includes('--tui') || argv.includes('--headless');
  const rjitHome = flagValue(argv, '--rjit-home') ?? __cwd();
  if (!cartName || !cartFile || !outPath) {
    err('[watch-and-push] usage: watch-and-push.js <cart-name> <cart-file> <out-path>');
    return 1;
  }

  const root = __cwd();
  const entryAbs = toAbs(root, cartFile);
  const outAbs = toAbs(root, outPath);
  const flags = bundleFlags({
    rjitHome: root,
    cartEntry: entryAbs,
    outFile: outAbs,
    mode: tui ? 'tui-host' : 'gpu-host',
    watch: true,
    metafile: false,
  });

  try {
    spawn(`${root}/tools/esbuild`, flags);
  } catch {
    err('[watch-and-push] failed to spawn esbuild');
    return 1;
  }

  out(`[dev] watching ${cartFile} - edits rebuild + push automatically (ctrl-c to stop)`);

  let lastMtime = 0;
  while (true) {
    __sleepMs(POLL_MS);
    const mtime = statMtime(outAbs);
    if (mtime !== 0 && mtime !== lastMtime) {
      lastMtime = mtime;
      push(root, rjitHome, cartName, outAbs);
    }
  }
}

function flagValue(argv: string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] ?? null : null;
}

function toAbs(root: string, path: string): string {
  if (path.startsWith('/')) return path;
  const trimmed = path.startsWith('./') ? path.slice(2) : path;
  return `${root}/${trimmed}`;
}

function statMtime(path: string): number {
  const stat = tryFsStat(path);
  return stat ? Number(stat.mtimeMs) || 0 : 0;
}

function push(root: string, rjitHome: string, cartName: string, outAbs: string): void {
  const stale = staleDevHost(rjitHome, DEV_SOCKET_PATH);
  if (stale) {
    sendRebuildNotice(stale, DEV_SOCKET_PATH);
    err(`[dev ${new Date().toLocaleTimeString()}] rebuild needed - native build id running ${shortHash(stale.host.build_id)} / disk ${shortHash(stale.current.hash)}`);
    return;
  }
  const result = spawnSync(`${root}/tools/rjit`, ['push-bundle', cartName, outAbs]);
  const timestamp = new Date().toLocaleTimeString();
  if (result.code === 0) {
    out(`[dev ${timestamp}] rebuilt - pushed '${cartName}'`);
  } else if (result.code === 2) {
    // Host not running / socket stale. Match the old quiet path.
  } else {
    if (result.stderr) __writeStderr(result.stderr);
    err(`[dev ${timestamp}] push exit ${result.code}`);
  }
}
