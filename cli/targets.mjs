/**
 * Target config registry — single source of truth for esbuild flags per target.
 *
 * Each target defines:
 *   format     – esbuild --format (iife | esm)
 *   platform   – esbuild --platform (omit for browser/universal)
 *   globalName – esbuild --global-name (IIFE targets only)
 *   external   – esbuild --external:X packages
 *   entries    – entry point candidates in priority order (resolved under src/)
 *   output     – dev build output path (relative to project root)
 *   kind       – 'love' | 'grid' | 'web' (determines dist strategy)
 */

export const TARGETS = {
  love: {
    format: 'iife',
    globalName: 'ReactLove',
    external: ['react-dom'],
    entries: ['main-love.tsx', 'native-main.tsx', 'main.tsx'],
    output: 'bundle.js',
    kind: 'love',
  },
  terminal: {
    format: 'esm',
    platform: 'node',
    external: ['react-dom'],
    entries: ['main-terminal.tsx', 'main.tsx'],
    output: 'dist/main.js',
    kind: 'grid',
  },
  cc: {
    format: 'esm',
    platform: 'node',
    external: ['ws', 'react-dom'],
    entries: ['main-cc.tsx', 'main.tsx'],
    output: 'dist/main.js',
    kind: 'grid',
  },
  nvim: {
    format: 'esm',
    platform: 'node',
    external: ['react-dom'],
    entries: ['main-nvim.tsx', 'main.tsx'],
    output: 'dist/main.js',
    kind: 'grid',
  },
  hs: {
    format: 'esm',
    platform: 'node',
    external: ['ws', 'react-dom'],
    entries: ['main-hs.tsx', 'main.tsx'],
    output: 'dist/main.js',
    kind: 'grid',
  },
  awesome: {
    format: 'esm',
    platform: 'node',
    external: ['react-dom'],
    entries: ['main-awesome.tsx', 'main.tsx'],
    output: 'dist/main.js',
    kind: 'grid',
  },
  web: {
    format: 'esm',
    entries: ['main-web.tsx', 'main.tsx'],
    output: 'dist/app.js',
    kind: 'web',
  },
};

export const TARGET_NAMES = Object.keys(TARGETS);

/**
 * Build the esbuild CLI args array for a given target config.
 * Does NOT include entry point or --outfile (caller adds those).
 */
export function esbuildArgs(target) {
  const args = [
    '--bundle',
    `--format=${target.format}`,
    '--target=es2020',
    '--jsx=automatic',
  ];
  if (target.globalName) args.push(`--global-name=${target.globalName}`);
  if (target.platform) args.push(`--platform=${target.platform}`);
  if (target.external) {
    for (const ext of target.external) args.push(`--external:${ext}`);
  }
  return args;
}

/**
 * Build the esbuild CLI args for a dist (CJS shebang) build of a grid/web target.
 * Overrides format to CJS and platform to node, always externalizes ws.
 */
export function esbuildDistArgs(target) {
  const args = [
    '--bundle',
    '--format=cjs',
    '--platform=node',
    '--target=es2020',
    '--jsx=automatic',
    '--external:ws',
  ];
  return args;
}
