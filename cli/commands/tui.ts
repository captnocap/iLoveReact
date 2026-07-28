// cli/commands/tui.ts - one-shot foreground TUI runner.
//
// This intentionally does NOT route through `dev --tui`. A terminal UI needs
// inherited stdin/stdout/stderr so it can enter the alt screen, read keys, and
// paint directly. The persistent dev host spawns children with stdin ignored
// and stdout piped for line-draining, which is correct for logs and wrong for
// an interactive TUI.

import { bundleCart } from '../cart/bundle.ts';
import { fsExists, fsMkdir } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';
import { trimZigCacheIfOversized } from '../host/zigcache.ts';

interface TuiArgs {
  target: string;
  appArgs: string[];
}

interface CartPaths {
  name: string;
  entry: string;
  dir: string;
}

export async function run(argv: string[]): Promise<number> {
  const parsed = parseTuiArgs(argv);
  if (typeof parsed === 'number') return parsed;

  const cartRoot = __cwd();
  const rjitHome = __env('RJIT_HOME') || cartRoot;
  const cart = resolveTarget(cartRoot, parsed.target);
  if (!cart) {
    return fail(`[tui] not found: ${parsed.target} (expected cart/<name>/index.tsx, cart/<name>.tsx, or an entry path)`, 1);
  }

  runFixReactImports(rjitHome, cartRoot);

  const bundleOut = `${cartRoot}/.cache/tui-bundle-${cart.name}.js`;
  fsMkdir(`${cartRoot}/.cache`);
  const term = terminalSize();
  out(`[tui] bundling ${cart.entry} -> ${bundleOut}`);
  const bundle = bundleCart({
    rjitHome,
    cartEntry: cart.entry,
    outFile: bundleOut,
    mode: 'tui-host',
    termCols: term.cols,
    termRows: term.rows,
  });
  writeSpawnOutput(bundle);
  if (bundle.code !== 0) return bundle.code || 1;

  const bin = `${rjitHome}/zig-out/bin/${cart.name}`;
  const built = buildTuiBinary(rjitHome, cartRoot, cart.name, bundleOut, bin);
  if (built !== 0) return built;

  out(`[tui] running ${bin}`);
  return runForeground(cart, bin, parsed.appArgs);
}

function parseTuiArgs(argv: string[]): TuiArgs | number {
  let target = '';
  let appArgs: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') return usage(0);
    if (arg === '--') {
      appArgs = argv.slice(i + 1);
      break;
    }
    if (arg.startsWith('--')) {
      err(`[tui] unknown flag: ${arg}`);
      return usage(1);
    }
    if (target) {
      err(`[tui] unexpected positional arg: ${arg}`);
      return usage(1);
    }
    target = arg;
  }
  return { target: target || 'tui/examples/counter.tsx', appArgs };
}

function usage(code = 1): number {
  err('Usage: rjit tui [cart-name|entry.tsx] [-- app-args...]');
  err('  Builds a TUI bundle and execs the headless app in the foreground terminal.');
  err('  Use `rjit dev <cart-name> --tui` for the experimental persistent TUI dev host.');
  return code;
}

function resolveTarget(root: string, target: string): CartPaths | null {
  const direct = ensureAbs(root, target);
  if (fsExists(direct)) return cartFromEntry(direct);

  const dirEntry = `${root}/cart/${target}/index.tsx`;
  if (fsExists(dirEntry)) return { name: target, entry: dirEntry, dir: dirname(dirEntry) };

  const fileEntry = `${root}/cart/${target}.tsx`;
  if (fsExists(fileEntry)) return { name: target, entry: fileEntry, dir: dirname(fileEntry) };

  return null;
}

function cartFromEntry(entry: string): CartPaths {
  let name = basenameNoExt(entry);
  const dir = dirname(entry);
  if (name === 'index') name = basename(dir);
  return { name: sanitizeName(name), entry, dir };
}

function buildTuiBinary(rjitHome: string, cartRoot: string, name: string, bundlePath: string, bin: string): number {
  const zig = resolveZig(rjitHome);
  const args = [
    'build',
    'app',
    '-p',
    `${rjitHome}/zig-out`,
    `-Dapp-name=${name}`,
    '-Dapp-source=framework/v8_app.zig',
    `-Dbundle-path=${bundlePath}`,
    ...legacyTuiFlags(),
    '-Dhas-gpu=false',
    '-Doptimize=ReleaseFast',
  ];

  out(`[tui] compiling native binary (${bin}, ReleaseFast)...`);
  const cmd = cartRoot === rjitHome ? zig : 'env';
  const finalArgs = cartRoot === rjitHome ? args : [`ZIG_GLOBAL_CACHE_DIR=${rjitHome}/tools/zig/cache`, zig, ...args];
  const build = spawnSync(cmd, finalArgs);
  writeSpawnOutput(build);
  if (build.code !== 0) return build.code || 1;
  trimZigCacheIfOversized(rjitHome);
  if (!fsExists(bin)) return fail(`[tui] build produced no binary: ${bin}`, 1);
  return 0;
}

function legacyTuiFlags(): string[] {
  // Mirrors scripts/tui's foreground profile. Deliberately excludes
  // -Ddev-mode=true so the app does not emit hot-reload/flush diagnostics
  // into the terminal surface.
  return [
    '-Duse-v8=true',
    '-Dhas-terminal=true',
    '-Dhas-httpsrv=true',
    '-Dhas-wssrv=true',
    '-Dhas-process=true',
    '-Dhas-net=true',
    '-Dhas-sdk=true',
    '-Dhas-fs=true',
  ];
}

function runForeground(cart: CartPaths, bin: string, appArgs: string[]): number {
  // v8cli's spawnSync captures stdio, so the shell reattaches the child to the
  // controlling terminal before exec. In non-interactive contexts without
  // /dev/tty it falls back to captured stdio, which keeps smoke tests usable.
  const shell = 'if [ -r /dev/tty ] && [ -w /dev/tty ]; then exec < /dev/tty > /dev/tty 2>&1; fi; exec "$@"';
  const result = spawnSync('sh', [
    '-c',
    shell,
    'rjit-tui',
    'env',
    `RJIT_DEV_CART_DIR=${cart.dir}`,
    bin,
    ...appArgs,
  ]);
  writeSpawnOutput(result);
  return result.code === 0 ? 0 : result.code || 1;
}

function runFixReactImports(rjitHome: string, cartRoot: string): void {
  const script = `${rjitHome}/scripts/fix-react-imports`;
  if (!fsExists(script)) return;
  const result = spawnSync('env', [`RJIT_HOME=${rjitHome}`, `CART_ROOT=${cartRoot}`, script]);
  writeSpawnOutput(result);
  if (result.code !== 0) throw new Error(`fix-react-imports exited ${result.code}`);
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

function ensureAbs(root: string, path: string): string {
  if (path.startsWith('/')) return path;
  const trimmed = path.startsWith('./') ? path.slice(2) : path;
  return `${root}/${trimmed}`;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? path : path.slice(idx + 1);
}

function basenameNoExt(path: string): string {
  const name = basename(path);
  const idx = name.lastIndexOf('.');
  return idx < 0 ? name : name.slice(0, idx);
}

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function writeSpawnOutput(result: { stdout: string; stderr: string }): void {
  if (result.stdout) __writeStdout(result.stdout);
  if (result.stderr) __writeStderr(result.stderr);
}

function fail(message: string, code: number): number {
  err(message);
  return code;
}
