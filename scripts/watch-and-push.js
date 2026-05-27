// scripts/watch-and-push.js — watch a cart and push rebuilds to the dev host.
//
// Usage: tools/v8cli scripts/watch-and-push.js <cart-name> <cart-file> <out-path>
//
// Runs `tools/esbuild --watch=forever` in the background; esbuild's own
// stderr (including `[watch] build finished` / error diagnostics) passes
// through to our stderr so the user sees everything they used to see.
//
// We don't parse stdout — instead we poll the outfile's mtime and push
// whenever it advances. Simpler than parsing esbuild's watch output, and
// robust against the fact that the "build finished" marker fires on errors
// too (we key on the actual filesystem artifact, not log lines).

const ROOT = __cwd();
const ESBUILD = ROOT + '/tools/esbuild';
const PUSH_SCRIPT = ROOT + '/scripts/push-bundle.js';
const V8CLI = ROOT + '/tools/v8cli';
const POLL_MS = 200;

const argv = process.argv.slice(1);
const cartName = argv[0];
const cartFile = argv[1];
const outPath = argv[2];
if (!cartName || !cartFile || !outPath) {
  __writeStderr('[watch-and-push] usage: watch-and-push.js <cart-name> <cart-file> <out-path>\n');
  __exit(1);
}

function toAbs(p) {
  if (p.startsWith('/')) return p;
  if (p.startsWith('./')) p = p.slice(2);
  return ROOT + '/' + p;
}

const entryAbs = toAbs(cartFile);
const outAbs = toAbs(outPath);

// Flags mirror scripts/cart-bundle.js exactly. Drift would mean saved files
// build differently from the startup ship.
const flags = [
  ROOT + '/runtime/index.tsx',
  '--bundle',
  '--outfile=' + outAbs,
  '--format=iife',
  '--jsx-factory=__jsx',
  '--jsx-fragment=Fragment',
  '--inject:' + ROOT + '/runtime/jsx_shim.ts',
  '--inject:' + ROOT + '/runtime/ambient.ts',
  '--inject:' + ROOT + '/runtime/ambient_primitives.ts',
  '--alias:@reactjit/core=' + ROOT + '/runtime/core_stub.ts',
  '--alias:@reactjit/runtime=' + ROOT + '/runtime',
  '--alias:@cart-entry=' + entryAbs,
  '--alias:react=' + ROOT + '/deps/react',
  '--alias:react-reconciler=' + ROOT + '/deps/react-reconciler',
  '--alias:scheduler=' + ROOT + '/deps/scheduler',
  '--alias:loose-envify=' + ROOT + '/deps/loose-envify',
  '--alias:js-tokens=' + ROOT + '/deps/js-tokens',
  '--external:path',
  '--external:typescript',
  '--watch=forever',
  '--log-level=info',
];

const id = __spawn(ESBUILD, JSON.stringify(flags));
if (id < 0) {
  __writeStderr('[watch-and-push] failed to spawn esbuild\n');
  __exit(1);
}

__writeStdout('[dev] watching ' + cartFile + " — edits rebuild + push automatically (ctrl-c to stop)\n");

function statMtime(p) {
  const s = __fs_stat_json(p);
  if (s === null) return 0;
  try { return Number(JSON.parse(s).mtimeMs) || 0; } catch { return 0; }
}

function push() {
  const res = JSON.parse(__spawnSync(V8CLI, JSON.stringify([PUSH_SCRIPT, cartName, outAbs]), ''));
  const ts = new Date().toLocaleTimeString();
  if (res.code === 0) {
    __writeStdout('[dev ' + ts + "] rebuilt — pushed '" + cartName + "'\n");
  } else if (res.code === 2) {
    // Host not running / socket stale — quiet (user probably killed it).
  } else {
    if (res.stderr) __writeStderr(res.stderr);
    __writeStderr('[dev ' + ts + '] push exit ' + res.code + '\n');
  }
}

let lastMtime = 0;
while (true) {
  __sleepMs(POLL_MS);
  const mt = statMtime(outAbs);
  if (mt !== 0 && mt !== lastMtime) {
    lastMtime = mt;
    push();
  }
}
