// cli/commands/gdev.ts - game-only dev host with hot reload.

import { bundleCart, bundleFlags, BundleMode } from '../cart/bundle.ts';
import { loadManifest } from '../cart/manifest.ts';
import { bakeIconAtlas } from './bake-icons.ts';
import { fsExists, fsMkdir, fsRead, fsRemove } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { SocketError, tryUnixConnect, unixClose, unixReadLine, unixWrite } from '../host/net.ts';
import { spawn, spawnSync } from '../host/process.ts';
import {
  nativeBuildFingerprint,
  readDevBuildId,
  readDevHostInfo,
  sendRebuildNotice,
  shortHash,
  writeDevBuildInfo,
  type NativeBuildFingerprint,
} from '../dev/rebuild-signal.ts';

type Substrate = 'gui' | 'tui';

interface GdevArgs {
  name: string;
  substrateFlag: Substrate | null;
}

interface CartPaths {
  entry: string;
  dir: string;
  manifest: string;
}

const DEFAULT_GAME_CART = 'hmsc-int';
const PROFILE_VERSION = 'gdev-v1';
const GDEV_SOCKET_GUI = '/tmp/reactjit-gdev.sock';
const GDEV_SOCKET_TUI = '/tmp/reactjit-gdev-tui.sock';

export async function run(argv: string[]): Promise<number> {
  const parsed = parseGdevArgs(argv);
  if (typeof parsed === 'number') return parsed;

  const cartRoot = __cwd();
  const rjitHome = __env('RJIT_HOME') || cartRoot;
  const cart = resolveCart(cartRoot, parsed.name);
  if (!cart) return fail(`[gdev] not found: ${cartRoot}/cart/${parsed.name}/index.tsx or ${cartRoot}/cart/${parsed.name}.tsx`, 1);

  const substrate = resolveSubstrate(parsed.substrateFlag, cart.manifest);
  const socket = substrate === 'tui' ? GDEV_SOCKET_TUI : GDEV_SOCKET_GUI;
  const bundleMode: BundleMode = substrate === 'tui' ? 'tui-host' : 'gpu-host';
  const perCartBundle = `${cartRoot}/.cache/gdev-bundle-${parsed.name}.js`;
  const binName = substrate === 'tui' ? 'reactjit-gdev-tui' : 'reactjit-gdev';
  const bin = `${rjitHome}/zig-out/bin/${binName}`;
  fsMkdir(`${cartRoot}/.cache`);

  runFixReactImports(rjitHome, cartRoot);
  const bakedIcons = bakeIconAtlas({ root: rjitHome, ifNeeded: true, quiet: true });
  if (bakedIcons !== 0) return bakedIcons;

  out(`[gdev] bundling ${cart.entry} -> ${perCartBundle}`);
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

  const zigFlags = resolveGameZigFlags(rjitHome, `${perCartBundle}.metafile.json`);
  const nativeFingerprint = gdevFingerprint(nativeBuildFingerprint(rjitHome), substrate, socket, zigFlags);
  const hostInfo = readDevHostInfo(socket);
  if (hostInfo) {
    if (hostInfo.build_id !== nativeFingerprint.hash) {
      const stale = { current: nativeFingerprint, host: hostInfo };
      sendRebuildNotice(stale, socket);
      err('[gdev] STALE GAME DEV HOST - running native build id differs from disk.');
      err('[gdev] refusing to push: bundle would talk to incompatible native code.');
      err(`[gdev] kill the running game dev host (ctrl-c its terminal) and rerun this command.`);
      err(`[gdev] running build id: ${shortHash(stale.host.build_id)}`);
      err(`[gdev] disk build id:    ${shortHash(stale.current.hash)} (${stale.current.inputCount} inputs + game profile)`);
      return 1;
    }
    out(`[gdev] host detected @ ${socket} - pushing '${parsed.name}'`);
    const push = pushBundle(socket, parsed.name, perCartBundle);
    if (push === 0) {
      out(`[gdev] host switched to tab '${parsed.name}'`);
      return 0;
    }
    if (fsExists(socket)) fsRemove(socket);
  } else if (fsExists(socket)) {
    fsRemove(socket);
  }

  if (devHostNeedsBuild(bin, nativeFingerprint)) {
    const built = buildGdevHost(rjitHome, cartRoot, binName, substrate, perCartBundle, socket, zigFlags, nativeFingerprint);
    if (built !== 0) return built;
    writeDevBuildInfo(bin, nativeFingerprint);
  }

  const child = spawn('env', [`RJIT_DEV_CART_DIR=${cart.dir}`, bin]);
  out(`[gdev] host child=${child.id} socket=${socket}`);

  const watcher = spawnBundleWatcher(rjitHome, cart.entry, perCartBundle, bundleMode, term);
  drainUntilExit(child.id, watcher.id);
  return 0;
}

function parseGdevArgs(argv: string[]): GdevArgs | number {
  let name = '';
  let substrateFlag: Substrate | null = null;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return usage(0);
    if (arg === '--tui' || arg === '--headless') {
      substrateFlag = 'tui';
    } else if (arg === '--gui') {
      substrateFlag = 'gui';
    } else if (arg.startsWith('--')) {
      err(`[gdev] unknown flag: ${arg}`);
      return usage(1);
    } else if (name) {
      err(`[gdev] unexpected positional arg: ${arg}`);
      return usage(1);
    } else {
      name = arg;
    }
  }
  return { name: name || DEFAULT_GAME_CART, substrateFlag };
}

function usage(code = 1): number {
  err('Usage: rjit gdev [cart-name] [--gui|--tui]');
  err(`  Default cart: ${DEFAULT_GAME_CART}`);
  err('  Game dev host: source-driven native flags, separate gdev socket, no embedded Postgres bootstrap.');
  return code;
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

function resolveGameZigFlags(rjitHome: string, metafilePath: string): string[] {
  if (!fsExists(metafilePath)) {
    err(`[gdev] WARNING: no metafile at ${metafilePath} - only base V8 dev flags enabled`);
    return ensureBaseFlags([]);
  }
  const result = spawnSync(`${rjitHome}/tools/rjit`, ['metafile-gate', '--metafile', metafilePath, '--format', 'zig-flags']);
  if (result.stderr) __writeStderr(result.stderr);
  if (result.code !== 0) throw new Error('metafile-gate failed');
  return ensureBaseFlags(result.stdout.trim() ? result.stdout.trim().split(/\s+/) : []);
}

function ensureBaseFlags(flags: string[]): string[] {
  const out = new Set(flags.filter(Boolean));
  out.add('-Duse-v8=true');
  out.add('-Ddev-mode=true');
  if (out.has('-Dhas-embed=true')) out.add('-Dhas-pg=true');
  return Array.from(out);
}

function gdevFingerprint(native: NativeBuildFingerprint, substrate: Substrate, socket: string, zigFlags: string[]): NativeBuildFingerprint {
  const body = [
    PROFILE_VERSION,
    native.hash,
    substrate,
    socket,
    ...zigFlags.slice().sort(),
  ].join('\n') + '\n';
  const digest = spawnSync('sha256sum', [], body);
  if (digest.code !== 0) throw new Error(`gdev input digest failed\n${digest.stderr || digest.stdout}`);
  const hash = digest.stdout.trim().split(/\s+/)[0] || '';
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`gdev input digest malformed: ${digest.stdout.trim()}`);
  return { hash, inputCount: native.inputCount + zigFlags.length + 3 };
}

function devHostNeedsBuild(bin: string, fingerprint: NativeBuildFingerprint): boolean {
  if (!fsExists(bin)) return true;
  return readDevBuildId(bin) !== fingerprint.hash;
}

function buildGdevHost(
  rjitHome: string,
  cartRoot: string,
  binName: string,
  substrate: Substrate,
  bundlePath: string,
  socket: string,
  zigFlags: string[],
  fingerprint: NativeBuildFingerprint,
): number {
  out(`[gdev] compiling game dev binary (${rjitHome}/zig-out/bin/${binName}, ${substrate}, ReleaseFast)...`);
  out(`[gdev] native flags: ${zigFlags.join(' ') || '(base only)'}`);
  const zig = resolveZig(rjitHome);
  const args = [
    'build',
    'app',
    '-p',
    `${rjitHome}/zig-out`,
    `-Dapp-name=${binName}`,
    '-Dapp-source=framework/v8_app.zig',
    `-Dbundle-path=${bundlePath}`,
    `-Ddev-bundle-path=${bundlePath}`,
    `-Ddev-socket-path=${socket}`,
    `-Ddev-build-id=${fingerprint.hash}`,
    ...zigFlags,
    '-Doptimize=ReleaseFast',
  ];
  if (substrate === 'tui') args.push('-Dhas-gpu=false');
  const cmd = cartRoot === rjitHome ? zig : 'env';
  const finalArgs = cartRoot === rjitHome ? args : [`ZIG_GLOBAL_CACHE_DIR=${rjitHome}/tools/zig/cache`, zig, ...args];
  const build = spawnSync(cmd, finalArgs);
  writeSpawnOutput(build);
  return build.code === 0 ? 0 : build.code || 1;
}

function spawnBundleWatcher(rjitHome: string, cartEntry: string, outFile: string, mode: BundleMode, term: { cols: number; rows: number }): { id: number } {
  const flags = bundleFlags({
    rjitHome,
    cartEntry,
    outFile,
    mode,
    watch: true,
    metafile: false,
    termCols: term.cols,
    termRows: term.rows,
  });
  const watcher = spawn(`${rjitHome}/tools/esbuild`, flags);
  out(`[gdev] watching ${cartEntry} - edits rebuild ${outFile} (ctrl-c to stop)`);
  return watcher;
}

function pushBundle(socket: string, tabName: string, bundlePath: string): number {
  const bundle = fsRead(bundlePath);
  if (!fsExists(socket)) return 2;
  const fd = tryUnixConnect(socket);
  if (fd === null) return 2;
  try {
    unixWrite(fd, `PUSH ${tabName} ${utf8ByteLength(bundle)}\n`);
    unixWrite(fd, bundle);
    const line = unixReadLine(fd, __nowMs() + 3000).trim();
    if (line.startsWith('OK')) return 0;
    err(`[gdev] host error: ${line}`);
    return 1;
  } catch (error) {
    if (error instanceof SocketError) {
      err(`[gdev] push failed: ${error.message}`);
      return 2;
    }
    throw error;
  } finally {
    unixClose(fd);
  }
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

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
