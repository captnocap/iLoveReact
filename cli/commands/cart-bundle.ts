// cli/commands/cart-bundle.ts - one-shot cart bundler.

import { bundleCart } from '../cart/bundle.ts';
import { fsExists } from '../host/fs.ts';
import { err, out } from '../host/log.ts';

export async function run(argv: string[]): Promise<number> {
  if (__env('BUNDLE_FROM_HARNESS') !== '1') {
    err('[cart-bundle] REFUSING to run - this is an internal script, not an entry point.');
    err('[cart-bundle]');
    err('[cart-bundle] Use one of the user-facing entry points instead:');
    err('[cart-bundle]   ./scripts/dev <cart-name>   # dev host + watcher');
    err('[cart-bundle]   ./scripts/ship <cart-name>  # production binary');
    return 1;
  }

  let entryArg: string | null = null;
  let outArg: string | null = null;
  let cartridgeMode = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--out' || arg === '-o') {
      outArg = argv[++i] ?? null;
      continue;
    }
    if (arg === '--cartridge') {
      cartridgeMode = true;
      continue;
    }
    if (arg.startsWith('-')) return die(`unknown flag: ${arg}`, 2);
    if (entryArg === null) {
      entryArg = arg;
      continue;
    }
    return die('too many positional args', 2);
  }

  if (!entryArg) return die('missing cart entry path', 2);

  const root = __cwd();
  const entryAbs = ensureAbs(root, entryArg);
  const bundleAbs = outArg ? ensureAbs(root, outArg) : `${root}/bundle.js`;
  const cartRoot = __env('CART_ROOT') || root;
  const entryInsideHome = entryAbs.startsWith(`${root}/`);
  const entryInsideCart = cartRoot !== root && entryAbs.startsWith(`${cartRoot}/`);
  if (!entryInsideHome && !entryInsideCart) {
    return die(`entry must stay inside ${root}${cartRoot !== root ? ' or ' + cartRoot : ''}`, 2);
  }
  if (!fsExists(entryAbs)) return die(`missing entry: ${entryArg}`, 2);

  const result = bundleCart({
    rjitHome: root,
    cartEntry: entryAbs,
    outFile: bundleAbs,
    mode: cartridgeMode ? 'cartridge' : 'gpu-host',
  });
  if (result.stderr) __writeStderr(result.stderr);
  if (result.stdout) __writeStdout(result.stdout);
  if (result.code !== 0) {
    err(`[cart-bundle] esbuild exited with code ${result.code}`);
    return result.code || 1;
  }

  out(`[cart-bundle] app=${rel(root, entryAbs)} bundle=${rel(root, bundleAbs)}`);
  return 0;
}

function ensureAbs(root: string, path: string): string {
  if (path.startsWith('/')) return path;
  const trimmed = path.startsWith('./') ? path.slice(2) : path;
  return `${root}/${trimmed}`;
}

function rel(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function die(message: string, code: number): number {
  err(`[cart-bundle] ${message}`);
  return code || 1;
}
