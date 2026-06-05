// cli/cart/bundle.ts - canonical esbuild flag list for cart bundling.

import { spawnSync } from '../host/process.ts';

export type BundleMode = 'gpu-host' | 'tui-host' | 'cartridge';

export interface BundleOptions {
  rjitHome: string;
  cartEntry: string;
  outFile: string;
  mode: BundleMode;
  watch?: boolean;
  metafile?: boolean;
  termCols?: number;
  termRows?: number;
}

export function bundleFlags(opts: BundleOptions): string[] {
  const cartridge = opts.mode === 'cartridge';
  const tui = opts.mode === 'tui-host';
  const runtimeEntry = cartridge
    ? `${opts.rjitHome}/runtime/cartridge_entry.tsx`
    : tui
      ? `${opts.rjitHome}/tui/entry.tsx`
      : `${opts.rjitHome}/runtime/index.tsx`;
  const reactAlias = cartridge ? `${opts.rjitHome}/runtime/cart_externs/react.cjs` : `${opts.rjitHome}/deps/react`;
  const reconcilerAlias = cartridge
    ? `${opts.rjitHome}/runtime/cart_externs/react_reconciler.cjs`
    : `${opts.rjitHome}/deps/react-reconciler`;
  const schedulerAlias = cartridge
    ? `${opts.rjitHome}/runtime/cart_externs/scheduler.cjs`
    : `${opts.rjitHome}/deps/scheduler`;

  const flags = [
    runtimeEntry,
    '--bundle',
    `--outfile=${opts.outFile}`,
  ];

  if (opts.metafile !== false) flags.push(`--metafile=${opts.outFile}.metafile.json`);

  if (tui) {
    flags.push(
      '--platform=neutral',
      '--main-fields=module,main',
      '--target=es2020',
      '--jsx=automatic',
      '--jsx-import-source=react',
      '--format=cjs',
      '--define:process.env.NODE_ENV="production"',
      `--define:__TUI_COLS__=${opts.termCols ?? 80}`,
      `--define:__TUI_ROWS__=${opts.termRows ?? 24}`,
      '--log-level=warning',
      '--resolve-extensions=.tsx,.ts,.jsx,.js',
      '--conditions=default',
    );
  } else {
    flags.push(
      '--format=iife',
      '--jsx-factory=__jsx',
      '--jsx-fragment=Fragment',
      `--inject:${opts.rjitHome}/runtime/jsx_shim.ts`,
      `--inject:${opts.rjitHome}/runtime/ambient.ts`,
      `--inject:${opts.rjitHome}/runtime/ambient_primitives.ts`,
    );
  }

  flags.push(
    // The game ground floor (V17): labs/editors write `import { GAME_* } from
    // '@game'`. That import is ALSO the metafile-gate signal that opts a cart
    // into the game's host bindings (V18 — gated ingredient, 2D carts pay zero).
    `--alias:@game=${opts.rjitHome}/cart/hmsc-int/game`,
    `--alias:@reactjit/core=${opts.rjitHome}/runtime/core_stub.ts`,
    `--alias:@reactjit/runtime=${opts.rjitHome}/runtime`,
    `--alias:@reactjit/effects=${opts.rjitHome}/runtime/effects`,
    `--alias:@reactjit/geometries=${opts.rjitHome}/runtime/geometries`,
    `--alias:@reactjit/cameras=${opts.rjitHome}/runtime/cameras`,
    // Catch-all: every other @reactjit/* subpath resolves under runtime/ —
    // @reactjit/primitives, /hooks/*, /workspace, /router, /icons/*, etc. esbuild
    // matches the most-specific alias first, so the explicit entries above still
    // win (core -> core_stub.ts, runtime -> the index). Mirrors the proven
    // scripts/cart-bundle.js; without it nothing outside the five above resolves.
    `--alias:@reactjit=${opts.rjitHome}/runtime`,
    `--alias:@cart-entry=${opts.cartEntry}`,
    `--alias:react=${reactAlias}`,
    `--alias:react-reconciler=${reconcilerAlias}`,
    `--alias:scheduler=${schedulerAlias}`,
    `--alias:loose-envify=${opts.rjitHome}/deps/loose-envify`,
    `--alias:js-tokens=${opts.rjitHome}/deps/js-tokens`,
    '--external:path',
    '--external:typescript',
  );

  if (opts.watch) flags.push('--watch=forever', '--log-level=info');
  return flags;
}

export function bundleCart(opts: BundleOptions): { code: number; stdout: string; stderr: string } {
  return spawnSync(`${opts.rjitHome}/tools/esbuild`, bundleFlags(opts));
}
