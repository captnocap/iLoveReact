// scripts/cart-bundle.js — cart bundler (one-shot).
//
// Runs via: tools/v8cli scripts/cart-bundle.js <cart.tsx> --out <bundle.js>
// Shells out to tools/esbuild (the native Go binary). No node, no bun.
//
// Non-watch only. Watch mode is handled by scripts/watch-and-push.js.

const ROOT = __cwd();
const ESBUILD = ROOT + '/tools/esbuild';

function die(msg, code) {
  __writeStderr('[cart-bundle] ' + msg + '\n');
  __exit(code | 0 || 1);
}

function ensureAbs(p) {
  if (p.startsWith('/')) return p;
  // naive join — ship/dev always pass paths relative to ROOT.
  if (p.startsWith('./')) p = p.slice(2);
  return ROOT + '/' + p;
}

// ── harness gate ──────────────────────────────────────────────────────
if (__env('BUNDLE_FROM_HARNESS') !== '1') {
  __writeStderr('[cart-bundle] REFUSING to run — this is an internal script, not an entry point.\n');
  __writeStderr('[cart-bundle]\n');
  __writeStderr('[cart-bundle] Use one of the user-facing entry points instead:\n');
  __writeStderr('[cart-bundle]   ./scripts/dev <cart-name>   # dev host + watcher\n');
  __writeStderr('[cart-bundle]   ./scripts/ship <cart-name>  # production binary\n');
  __exit(1);
}

// ── argv parse ────────────────────────────────────────────────────────
// process.argv[0] = this script path. Skip it.
const argv = process.argv.slice(1);
let entryArg = null;
let outArg = null;
let cartridgeMode = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out' || a === '-o') { outArg = argv[++i]; continue; }
  if (a === '--cartridge') { cartridgeMode = true; continue; }
  if (a.startsWith('-')) die('unknown flag: ' + a, 2);
  if (entryArg === null) { entryArg = a; continue; }
  die('too many positional args', 2);
}

if (!entryArg) die('missing cart entry path', 2);
const entryAbs = ensureAbs(entryArg);
const bundleAbs = outArg ? ensureAbs(outArg) : ROOT + '/bundle.js';

// Sanity guard: entry must live inside the SDK install (RJIT_HOME, == ROOT
// here) or under the user's project (CART_ROOT). The dispatcher sets
// CART_ROOT to the user's cwd; in-repo invocations leave it unset and the
// fallback to ROOT preserves the original "stay inside the repo" check.
const CART_ROOT = __env('CART_ROOT') || ROOT;
const entryInsideHome = entryAbs.startsWith(ROOT + '/');
const entryInsideCart = CART_ROOT !== ROOT && entryAbs.startsWith(CART_ROOT + '/');
if (!entryInsideHome && !entryInsideCart) {
  die('entry must stay inside ' + ROOT + (CART_ROOT !== ROOT ? ' or ' + CART_ROOT : ''), 2);
}
if (!__fs_exists(entryAbs)) die('missing entry: ' + entryArg, 2);

// ── esbuild flags ─────────────────────────────────────────────────────
// In cartridge mode the bundle is loaded into an already-running host. The
// host has React, the reconciler, scheduler, console, timers, fs, dispatch,
// and the renderer wired up — we MUST share those instances or hooks break
// (each React copy has its own dispatcher; two copies = "Invalid hook call").
// runtime/cart_externs/*.cjs redirects bare imports to globalThis.__hostModules.
const runtimeEntry = cartridgeMode
  ? ROOT + '/runtime/cartridge_entry.tsx'
  : ROOT + '/runtime/index.tsx';
// Metafile is the structured "what ended up in the bundle" record.
// scripts/ship reads it to decide which V8 binding ingredients to
// register on the cart. Path is bundle path + ".metafile.json" so
// each cart's bundle has its own sidecar.
const metafileAbs = bundleAbs + '.metafile.json';
const reactAlias = cartridgeMode
  ? ROOT + '/runtime/cart_externs/react.cjs'
  : ROOT + '/deps/react';
const reconcilerAlias = cartridgeMode
  ? ROOT + '/runtime/cart_externs/react_reconciler.cjs'
  : ROOT + '/deps/react-reconciler';
const schedulerAlias = cartridgeMode
  ? ROOT + '/runtime/cart_externs/scheduler.cjs'
  : ROOT + '/deps/scheduler';
const flags = [
  runtimeEntry,
  '--bundle',
  '--outfile=' + bundleAbs,
  '--metafile=' + metafileAbs,
  '--format=iife',
  '--jsx-factory=__jsx',
  '--jsx-fragment=Fragment',
  '--inject:' + ROOT + '/runtime/jsx_shim.ts',
  '--inject:' + ROOT + '/runtime/ambient.ts',
  '--inject:' + ROOT + '/runtime/ambient_primitives.ts',
  '--alias:@reactjit/core=' + ROOT + '/runtime/core_stub.ts',
  // @reactjit is the portable handle for cart code to import everything the SDK
  // exposes — primitives, hooks, classifiers, and the effects/geometries/cameras
  // registries. Physically the runtime/ dir: '@reactjit/primitives' → runtime/
  // primitives, '@reactjit/effects' → runtime/effects, etc. Replaces the old
  // '@reactjit/runtime/X' form and brittle '../runtime/X' relative paths.
  // @reactjit/core stays an explicit longer-match override (→ core_stub, not
  // runtime/core).
  '--alias:@reactjit=' + ROOT + '/runtime',
  '--alias:@cart-entry=' + entryAbs,
  // Vendored npm deps under deps/. Replaces node_modules lookup so
  // bare-specifier imports (react, react-reconciler, ...) resolve without
  // any node_modules directory anywhere in the tree.
  '--alias:react=' + reactAlias,
  '--alias:react-reconciler=' + reconcilerAlias,
  '--alias:scheduler=' + schedulerAlias,
  '--alias:loose-envify=' + ROOT + '/deps/loose-envify',
  '--alias:js-tokens=' + ROOT + '/deps/js-tokens',
  '--external:path',
  '--external:typescript',
  // absWorkingDir equivalent — esbuild uses cwd. We already set cwd to ROOT
  // via __cwd(). Good enough for the non-watch path.
];

const result = JSON.parse(__spawnSync(ESBUILD, JSON.stringify(flags), ''));
if (result.stderr) __writeStderr(result.stderr);
if (result.stdout) __writeStdout(result.stdout);
if (result.code !== 0) {
  __writeStderr('[cart-bundle] esbuild exited with code ' + result.code + '\n');
  __exit(result.code || 1);
}

// Match the mjs path's final status line so ship's log output stays the same.
const rel = (p) => p.startsWith(ROOT + '/') ? p.slice(ROOT.length + 1) : p;
__writeStdout('[cart-bundle] app=' + rel(entryAbs) + ' bundle=' + rel(bundleAbs) + '\n');
