// cli/commands/dev.ts - persistent dev host with hot bundle push.

import { bundleCart, BundleMode } from '../cart/bundle.ts';
import { loadManifest } from '../cart/manifest.ts';
import { bakeIconAtlas } from './bake-icons.ts';
import { fsExists, fsMkdir, fsRead, fsRemove, fsWrite, tryFsRead } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawn, spawnSync } from '../host/process.ts';
import { trimZigCacheIfOversized } from '../host/zigcache.ts';
import {
  DEV_SOCKET_PATH,
  nativeBuildFingerprint,
  readDevBuildId,
  readDevHostInfo,
  sendRebuildNotice,
  shortHash,
  writeDevBuildInfo,
  type NativeBuildFingerprint,
} from '../dev/rebuild-signal.ts';

type Substrate = 'gui' | 'tui';

interface DevArgs {
  name: string;
  substrateFlag: Substrate | null;
}

interface CartPaths {
  entry: string;
  dir: string;
  manifest: string;
}

export async function run(argv: string[]): Promise<number> {
  const parsed = parseDevArgs(argv);
  if (typeof parsed === 'number') return parsed;

  const cartRoot = __cwd();
  const rjitHome = __env('RJIT_HOME') || cartRoot;
  const cart = resolveCart(cartRoot, parsed.name);
  if (!cart) return fail(`[dev] not found: ${cartRoot}/cart/${parsed.name}/index.tsx or ${cartRoot}/cart/${parsed.name}.tsx`, 1);

  const substrate = resolveSubstrate(parsed.substrateFlag, cart.manifest);
  const bundleMode: BundleMode = substrate === 'tui' ? 'tui-host' : 'gpu-host';
  const perCartBundle = `${cartRoot}/.cache/bundle-${parsed.name}.js`;
  const binName = substrate === 'tui' ? 'reactjit-dev-tui' : 'reactjit-dev';
  const bin = `${rjitHome}/zig-out/bin/${binName}`;
  fsMkdir(`${cartRoot}/.cache`);

  runFixReactImports(rjitHome, cartRoot);
  const bakedIcons = bakeIconAtlas({ root: rjitHome, ifNeeded: true, quiet: true });
  if (bakedIcons !== 0) return bakedIcons;
  reapOrphanWatchers();

  out(`[dev] bundling ${cart.entry} -> ${perCartBundle}`);
  const term = terminalSize();
  const bundle = bundleCart({
    rjitHome,
    cartEntry: cart.entry,
    outFile: perCartBundle,
    mode: bundleMode,
    termCols: term.cols,
    termRows: term.rows,
  });
  writeSpawnOutput(bundle);
  if (bundle.code !== 0) return bundle.code || 1;

  const nativeFingerprint = nativeBuildFingerprint(rjitHome);
  const needsBuild = devHostNeedsBuild(bin, nativeFingerprint);
  const socket = DEV_SOCKET_PATH;
  const hostAlive = isHostAlive(socket);
  if (hostAlive) {
    const hostInfo = readDevHostInfo(socket);
    if (!hostInfo || hostInfo.build_id !== nativeFingerprint.hash) {
      const stale = { current: nativeFingerprint, host: hostInfo ?? { build_id: 'unknown' } };
      sendRebuildNotice(stale, socket);
      err('[dev] STALE DEV HOST - running native build id differs from disk.');
      err('[dev] refusing to push: bundle would talk to incompatible native code.');
      err('[dev] kill the running dev host (ctrl-c its terminal) and rerun this command.');
      err(`[dev] running build id: ${shortHash(stale.host.build_id)}`);
      err(`[dev] disk build id:    ${shortHash(stale.current.hash)} (${stale.current.inputCount} native inputs)`);
      return 1;
    }
    out(`[dev] host detected - pushing '${parsed.name}'`);
    const push = spawnSync(`${rjitHome}/tools/rjit`, ['push-bundle', parsed.name, perCartBundle]);
    writeSpawnOutput(push);
    if (push.code === 0) {
      out(`[dev] host switched to tab '${parsed.name}'`);
      return 0;
    }
    fsRemove(socket);
  }

  fsWrite(`${rjitHome}/bundle.js`, fsRead(perCartBundle));

  if (needsBuild && fsExists(bin)) out('[dev] dev host inputs newer than binary - rebuilding...');
  if (needsBuild) {
    const built = buildDevHost(rjitHome, cartRoot, binName, substrate, perCartBundle, nativeFingerprint);
    if (built !== 0) return built;
    writeDevBuildInfo(bin, nativeFingerprint);
  }

  ensurePgRunning(rjitHome);

  const child = spawn('env', [`RJIT_DEV_CART_DIR=${cart.dir}`, bin]);
  out(`[dev] host child=${child.id} - run 'rjit dev <other>' from another terminal to add tabs`);

  const watchArgs = ['watch-and-push', parsed.name, cart.entry, perCartBundle, '--rjit-home', rjitHome];
  if (substrate === 'tui') watchArgs.push('--tui');
  const watcher = spawn(`${rjitHome}/tools/rjit`, watchArgs);
  drainUntilExit(child.id, watcher.id);
  return 0;
}

function parseDevArgs(argv: string[]): DevArgs | number {
  let name = '';
  let substrateFlag: Substrate | null = null;
  for (const arg of argv) {
    if (arg === '--tui' || arg === '--headless') {
      substrateFlag = 'tui';
    } else if (arg === '--gui') {
      substrateFlag = 'gui';
    } else if (arg.startsWith('--')) {
      err(`[dev] unknown flag: ${arg}`);
      return usage();
    } else if (name) {
      err(`[dev] unexpected positional arg: ${arg}`);
      return usage();
    } else {
      name = arg;
    }
  }
  if (!name) return usage();
  return { name, substrateFlag };
}

function usage(): number {
  err('Usage: scripts/dev <cart-name>');
  err(`  Cart expected at: ${__cwd()}/cart/<name>/index.tsx or ${__cwd()}/cart/<name>.tsx`);
  return 1;
}

function resolveCart(cartRoot: string, name: string): CartPaths | null {
  const dirEntry = `${cartRoot}/cart/${name}/index.tsx`;
  if (fsExists(dirEntry)) return { entry: dirEntry, dir: dirname(dirEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
  const fileEntry = `${cartRoot}/cart/${name}.tsx`;
  if (fsExists(fileEntry)) return { entry: fileEntry, dir: dirname(fileEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
  return null;
}

function resolveSubstrate(flag: Substrate | null, manifestPath: string): Substrate {
  if (flag) return flag;
  if (fsExists(manifestPath)) {
    const surface = loadManifest(manifestPath).surface;
    if (surface === 'tui' || surface === 'gui') return surface;
  }
  return 'gui';
}

function runFixReactImports(rjitHome: string, cartRoot: string): void {
  const script = `${rjitHome}/scripts/fix-react-imports`;
  if (!fsExists(script)) return;
  const result = spawnSync('env', [`RJIT_HOME=${rjitHome}`, `CART_ROOT=${cartRoot}`, script]);
  writeSpawnOutput(result);
}

function reapOrphanWatchers(): void {
  const pids = spawnSync('pgrep', ['-f', 'scripts/watch-and-push.js|tools/rjit.js watch-and-push|tools/rjit watch-and-push']);
  if (pids.code !== 0) return;
  for (const pid of pids.stdout.trim().split(/\s+/).filter(Boolean)) {
    const ppid = spawnSync('ps', ['-o', 'ppid=', '-p', pid]).stdout.trim();
    if (ppid === '1') {
      spawnSync('pkill', ['-TERM', '-P', pid]);
      spawnSync('kill', ['-TERM', pid]);
      err(`[dev] reaped orphan watcher pid=${pid}`);
    }
  }
}

function devHostNeedsBuild(bin: string, fingerprint: NativeBuildFingerprint): boolean {
  if (!fsExists(bin)) return true;
  return readDevBuildId(bin) !== fingerprint.hash;
}

function isHostAlive(socket: string): boolean {
  if (!fsExists(socket)) return false;
  const ss = spawnSync('ss', ['-lUp']);
  if (ss.code === 0 && ss.stdout.includes(socket)) return true;
  fsRemove(socket);
  return false;
}

function buildDevHost(rjitHome: string, cartRoot: string, binName: string, substrate: Substrate, bundlePath: string, fingerprint: NativeBuildFingerprint): number {
  out(`[dev] compiling dev binary (${rjitHome}/zig-out/bin/${binName}, ${substrate}, ReleaseFast)...`);
  const flagsResult = spawnSync(`${rjitHome}/tools/rjit`, ['metafile-gate', '--format', 'dev-zig-flags', '--build-zig', `${rjitHome}/build.zig`]);
  writeSpawnOutput(flagsResult);
  if (flagsResult.code !== 0) return flagsResult.code || 1;
  const devFlags = flagsResult.stdout.trim().split(/\s+/).filter(Boolean);
  if (devFlags.length === 0) return fail('[dev] FATAL: sdk-dependency-resolve produced no dev flags', 1);

  const zig = resolveZig(rjitHome);
  const args = [
    'build',
    'app',
    '-p',
    `${rjitHome}/zig-out`,
    `-Dapp-name=${binName}`,
    '-Dapp-source=framework/v8_app.zig',
    `-Dbundle-path=${bundlePath}`,
    `-Ddev-build-id=${fingerprint.hash}`,
    ...devFlags,
    '-Doptimize=ReleaseFast',
  ];
  if (substrate === 'tui') args.push('-Dhas-gpu=false');
  const cmd = cartRoot === rjitHome ? zig : 'env';
  const finalArgs = cartRoot === rjitHome ? args : [`ZIG_GLOBAL_CACHE_DIR=${rjitHome}/tools/zig/cache`, zig, ...args];
  const build = spawnSync(cmd, finalArgs);
  writeSpawnOutput(build);
  if (build.code !== 0) return build.code || 1;
  // Same disk-leak guard as ship: zig never evicts .zig-cache/o entries and
  // every dev rebuild lands a fresh one. Whole-cache drop over budget only —
  // partial pruning is unsound (cli/host/zigcache.ts). RJIT_CACHE_MAX_GB=0
  // disables.
  trimZigCacheIfOversized(rjitHome);
  return 0;
}

function ensurePgRunning(rjitHome: string): void {
  const pg = resolvePg(rjitHome);
  if (!pg) {
    err('[dev] postgres not found - install postgresql or run scripts/stage-pg-bundle');
    return;
  }

  const datadir = `${__env('HOME') || '/tmp'}/.cache/reactjit-embed/embed-pg`;
  const sockdir = `${__env('HOME') || '/tmp'}/.cache/reactjit-embed/embed-pg-sock`;
  const status = spawnSync(pg.pgCtl, ['-D', datadir, '-s', 'status']);
  if (status.code === 0) return;

  const pidfile = `${datadir}/postmaster.pid`;
  const stalePid = tryFsRead(pidfile)?.split('\n')[0]?.trim();
  if (stalePid && spawnSync('kill', ['-0', stalePid]).code !== 0) fsRemove(pidfile);

  fsMkdir(datadir);
  fsMkdir(sockdir);
  if (!fsExists(`${datadir}/PG_VERSION`)) {
    out('[dev] initializing embedded postgres cluster (first run)...');
    const init = spawnSync('env', [`PGSHAREDIR=${pg.shareDir}`, pg.initdb, '-D', datadir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-sync']);
    writeSpawnOutput(init);
    if (init.code !== 0) return;
  }

  out('[dev] starting embedded postgres...');
  const start = spawnSync('env', [
    `PGSHAREDIR=${pg.shareDir}`,
    pg.pgCtl,
    '-D',
    datadir,
    '-l',
    `${datadir}/pg.log`,
    '-o',
    `-k ${sockdir} -c listen_addresses= -c max_connections=300`,
    '-w',
    'start',
  ]);
  writeSpawnOutput(start);
}

function resolvePg(rjitHome: string): { pgCtl: string; initdb: string; shareDir: string } | null {
  const bundled = `${rjitHome}/.pg-bundle/bin`;
  if (fsExists(`${bundled}/postgres`)) {
    return { pgCtl: `${bundled}/pg_ctl`, initdb: `${bundled}/initdb`, shareDir: `${rjitHome}/.pg-bundle/share/postgresql` };
  }
  for (const version of ['17', '16', '15', '14']) {
    const base = `/usr/lib/postgresql/${version}/bin`;
    if (fsExists(`${base}/postgres`)) return { pgCtl: `${base}/pg_ctl`, initdb: `${base}/initdb`, shareDir: `/usr/share/postgresql/${version}` };
  }
  return null;
}

function terminalSize(): { cols: number; rows: number } {
  try {
    const parsed = JSON.parse(__termSize()) as [number, number];
    return { cols: parsed[0] || 80, rows: parsed[1] || 24 };
  } catch {
    return { cols: 80, rows: 24 };
  }
}

function resolveZig(rjitHome: string): string {
  const bundled = __env('REACTJIT_ZIG') || `${rjitHome}/tools/zig/zig`;
  if (fsExists(bundled)) return bundled;
  return 'zig';
}

function drainUntilExit(hostId: number, watcherId: number): void {
  while (true) {
    const hostLine = __childReadLine(hostId, 50);
    if (hostLine !== null) __writeStdout(`${hostLine}\n`);
    const watcherLine = __childReadLine(watcherId, 50);
    if (watcherLine !== null) __writeStdout(`${watcherLine}\n`);
    __sleepMs(50);
  }
}

function writeSpawnOutput(result: { stdout: string; stderr: string }): void {
  if (result.stdout) __writeStdout(result.stdout);
  if (result.stderr) __writeStderr(result.stderr);
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

function fail(message: string, code: number): number {
  err(message);
  return code;
}
