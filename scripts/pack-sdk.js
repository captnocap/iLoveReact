// scripts/pack-sdk.js — build the single-file `rjit` distributable.
//
// Runs via: tools/v8cli scripts/pack-sdk.js [--out path] [--keep-stage]
//
// Output: a self-extracting shell script that, on first run, expands the
// embedded tarball into $XDG_CACHE_HOME/rjit/<sig>/ and dispatches to
// init|dev|ship|help. Same self-extractor pattern scripts/ship uses for
// cart binaries — proven smaller than a Zig ELF with @embedFile.
//
// Payload contents (mirrors the in-repo install layout):
//   tools/{zig,v8cli,esbuild}           — toolchain
//   deps/                             — vendored npm deps (react, ts, …)
//   framework/ runtime/ renderer/       — runtime + reconciler source
//   scripts/                            — dispatcher targets (dev, ship, init, …)
//   sdk/dependency-registry.json        — single source of truth
//   build.zig v8_app.zig qjs_app.zig    — build entry points
//   deps/v8-prebuilt/libc_v8.a          — V8 static archive (~116 MB)
//   deps/<zig-packages>/                — wgpu-native, tls.zig, zig-v8
//   deps/sysroot/                       — pinned headers + .so for SDL3,
//                                          freetype, luajit, curl
//
// Build artifacts (.zig-cache, zig-out, .cache, node_modules, __pycache__)
// are pruned at copy time — see EXCLUDES — so a stray local build can never
// bloat the release tarball. This was a real problem: deps/zig-v8/.zig-cache
// alone was leaking 121 MB of cached build outputs into the SDK.
//
// Output is Linux-x86_64-bound. Cross-platform build is a follow-up.

const ROOT = __cwd();

function die(msg, code) {
  __writeStderr('[pack-sdk] ' + msg + '\n');
  __exit(code | 0 || 1);
}

function log(msg) { __writeStdout('[pack-sdk] ' + msg + '\n'); }

function sh(cmd, args, stdin) {
  const r = JSON.parse(__spawnSync(cmd, JSON.stringify(args || []), stdin || ''));
  return r;
}

function shOrDie(cmd, args, label) {
  const r = sh(cmd, args, '');
  if (r.code !== 0) {
    if (r.stderr) __writeStderr(r.stderr);
    die((label || cmd) + ' failed (code ' + r.code + ')', r.code || 1);
  }
  return r;
}

// ── argv ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(1);
let outPath = ROOT + '/dist/rjit';
let keepStage = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out' || a === '-o') { outPath = argv[++i]; continue; }
  if (a === '--keep-stage') { keepStage = true; continue; }
  die('unknown flag: ' + a, 2);
}
if (!outPath.startsWith('/')) outPath = ROOT + '/' + outPath;

// ── load registry ─────────────────────────────────────────────────────
const REGISTRY_PATH = ROOT + '/sdk/dependency-registry.json';
if (!__fs_exists(REGISTRY_PATH)) die('registry missing: ' + REGISTRY_PATH);
const registry = JSON.parse(__fs_read(REGISTRY_PATH));

// ── stage dir ─────────────────────────────────────────────────────────
const STAGE = '/tmp/rjit-stage-' + Date.now();
__fs_mkdir(STAGE);
log('staging at ' + STAGE);

// Anything matching these globs is dropped on the floor when staging.
// .zig-cache and zig-out are build artifacts that have repeatedly snuck in
// (deps/zig-v8/.zig-cache alone was 121 MB of bloat). Lock them out at the
// source so a stray local build can never bloat a release tarball.
const EXCLUDES = [
  '.zig-cache', 'zig-cache', 'zig-out', '.cache',
  'node_modules', '__pycache__', '.DS_Store',
];

function copyTree(srcAbs, destAbs, label) {
  if (!__fs_exists(srcAbs)) die('missing payload: ' + (label || srcAbs));
  __fs_mkdir(destAbs.replace(/\/[^/]+$/, ''));
  // rsync -a preserves perms/symlinks like cp -a; --exclude prunes per-name.
  // Trailing '/' on src and dest gives us "copy contents into" semantics.
  const args = ['-a'];
  for (const e of EXCLUDES) args.push('--exclude=' + e);
  args.push(srcAbs + '/', destAbs + '/');
  __fs_mkdir(destAbs);
  shOrDie('rsync', args, 'rsync ' + (label || srcAbs));
}

function copyFile(srcAbs, destAbs) {
  if (!__fs_exists(srcAbs)) die('missing file: ' + srcAbs);
  __fs_mkdir(destAbs.replace(/\/[^/]+$/, ''));
  shOrDie('cp', ['-a', srcAbs, destAbs], 'cp ' + srcAbs);
}

// Source trees — these come from the in-repo layout verbatim.
const SOURCE_TREES = [
  'framework', 'runtime', 'renderer', 'scripts', 'sdk', 'vendor',
  // C source roots referenced unconditionally by build.zig.
  'stb',                   // stb_image / stb_image_write
  // 'love2d/quickjs' removed: the directory is gitignored build output that is not in the
  // checkout, and love2d is now archive/love2d.zip. This loop has no fsExists guard (unlike
  // cli/commands/pack-sdk.ts), so the entry was a hard failure waiting on a QJS pack.
];
for (const sub of SOURCE_TREES) {
  log('copy ' + sub + '/');
  copyTree(ROOT + '/' + sub, STAGE + '/' + sub, sub);
}

// Path-based zig package deps declared in build.zig.zon. Foundational only;
// feature-gated deps (llama.cpp.zig, vello_ffi, libvterm, …) are not yet
// wired through the registry's bundling step.
const ZIG_PATH_DEPS = [
  'deps/tls.zig',          // tls_zig — TLS for net features (referenced as foundational by build.zig)
  'deps/wgpu_native_zig',  // wgpu — render backbone
  'deps/zig-v8',           // v8 zig binding
  'deps/sysroot',          // vendored headers + .so for SDL3/freetype/luajit/curl — build.zig --Dsysroot
];
for (const sub of ZIG_PATH_DEPS) {
  if (__fs_exists(ROOT + '/' + sub)) {
    log('copy ' + sub + '/');
    copyTree(ROOT + '/' + sub, STAGE + '/' + sub, sub);
  }
}

// Top-level build entry files. build.zig.zon declares zig package deps
// (wgpu_native_zig, etc.) that build.zig pulls in via b.dependency().
for (const f of ['build.zig', 'build.zig.zon', 'v8_app.zig', 'qjs_app.zig', 'v8_cli.zig', 'v8_hello.zig']) {
  if (__fs_exists(ROOT + '/' + f)) {
    log('copy ' + f);
    copyFile(ROOT + '/' + f, STAGE + '/' + f);
  }
}

// Toolchain: zig (with full lib/ tree), v8cli, esbuild from registry tools.
const tools = registry.cliPayload && registry.cliPayload.tools ? registry.cliPayload.tools : {};
for (const [name, spec] of Object.entries(tools)) {
  if (spec.packPolicy === 'optional') continue;
  if (spec.payloadPath) {
    log('tool ' + name + ' ← ' + spec.payloadPath);
    copyFile(ROOT + '/' + spec.payloadPath, STAGE + '/' + spec.payloadPath);
  }
  for (const sup of spec.supportPaths || []) {
    if (__fs_exists(ROOT + '/' + sup)) {
      log('tool ' + name + ' support ← ' + sup);
      copyTree(ROOT + '/' + sup, STAGE + '/' + sup, sup);
    }
  }
}

// Bundle SDL3's transitive .so deps (PipeWire / Pulse / Wayland / xkbcommon /
// libdecor / libdrm / libgbm). We pinned SDL3 → we pin its deps too, otherwise
// the cart binary on Whonix loads our newer SDL3 against Whonix's older libs
// and explodes with errors like "undefined symbol: pw_check_library_version".
//
// Filters: skip glibc family (handled separately below), the X11 family
// (system-assumed — every desktop Linux has it), linux-vdso (kernel virtual).
const SR_LIB_STAGE = STAGE + '/deps/sysroot/usr/lib';
__fs_mkdir(SR_LIB_STAGE);
const SDL3_HOST_PATH = '/lib/x86_64-linux-gnu/libSDL3.so.0';
const SKIP_FAMILIES = [
  /^libc\.so\./, /^libm\.so\./, /^libpthread\.so\./, /^libdl\.so\./,
  /^libresolv\.so\./, /^ld-linux/, /^linux-vdso/,
  // X11 family — system-assumed. Every desktop Linux has these.
  /^libX11\.so\./, /^libXext\.so\./, /^libXcursor\.so\./, /^libXi\.so\./,
  /^libXfixes\.so\./, /^libXrandr\.so\./, /^libXss\.so\./, /^libXrender\.so\./,
  /^libxcb\.so\./, /^libxcb-/,
];
function copyLibChain(realPath, soname, label) {
  const dest = SR_LIB_STAGE + '/' + soname;
  if (__fs_exists(dest)) return false;
  copyFile(realPath, dest);
  // Also drop a soname symlink one step up the version chain
  // (lib<name>.so.<MAJOR> → real file's basename).
  return true;
}
if (__fs_exists(SDL3_HOST_PATH)) {
  const lddOut = sh('ldd', [SDL3_HOST_PATH], '').stdout || '';
  for (const line of lddOut.split('\n')) {
    const m = line.match(/^\s*(\S+)\s*=>\s*(\S+)/);
    if (!m) continue;
    const soname = m[1];
    const libPath = m[2];
    if (libPath === 'not' || !__fs_exists(libPath)) continue;
    if (SKIP_FAMILIES.some(rx => rx.test(soname))) continue;
    const realPath = sh('readlink', ['-f', libPath], '').stdout.trim() || libPath;
    if (copyLibChain(realPath, soname, 'SDL3-dep')) {
      log('SDL3 dep ' + soname + ' ← ' + realPath);
    }
  }
}

// Glibc family — bundle libc/libm/libpthread/libdl/libresolv/ld-linux from
// THIS pack-sdk host's /lib/x86_64-linux-gnu/ into deps/sysroot/usr/lib/.
// This is what lets cart binaries built on Whonix (older glibc) still load
// our pinned SDL3 (which references e.g. GLIBC_2.38). scripts/ship prefers
// sysroot libs over ldd-resolved system libs when bundling the cart's
// self-extractor, so the cart ships *our* glibc, not the build host's.
//
// NOT shipped: NSS plugins (libnss_*.so). If DNS / /etc/hosts lookups
// break under our bundled libc, add libnss_files / libnss_dns here.
const GLIBC_FAMILY = [
  '/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2',
  '/lib/x86_64-linux-gnu/libc.so.6',
  '/lib/x86_64-linux-gnu/libm.so.6',
  '/lib/x86_64-linux-gnu/libpthread.so.0',
  '/lib/x86_64-linux-gnu/libdl.so.2',
  '/lib/x86_64-linux-gnu/libresolv.so.2',
  '/lib64/ld-linux-x86-64.so.2',  // fallback path on some distros
];
__fs_mkdir(STAGE + '/deps/sysroot/usr/lib');
for (const p of GLIBC_FAMILY) {
  if (!__fs_exists(p)) continue;
  const realPath = sh('readlink', ['-f', p], '').stdout.trim() || p;
  const baseName = p.replace(/^.*\//, '');
  const dest = STAGE + '/deps/sysroot/usr/lib/' + baseName;
  if (__fs_exists(dest)) continue;
  log('glibc ' + baseName + ' ← ' + realPath);
  copyFile(realPath, dest);
}

// Zig package cache — overlay the host's $ZIG_GLOBAL_CACHE_DIR/p/ on top
// of whatever was already staged from tools/zig/cache/p/. The repo's
// pinned cache gets pruned over time (libwgpu_native.a went missing) and
// the only authoritative source is the dev machine's actual fetch cache.
// Without this, off-tree builds on Whonix fail with "libwgpu_native.a:
// file not found" because zluajit + wgpu-native-prebuilt aren't there.
const HOST_ZIG_CACHE = (__env('HOME') || '/root') + '/.cache/zig/p';
if (__fs_exists(HOST_ZIG_CACHE)) {
  log('zig pkg cache ← ' + HOST_ZIG_CACHE);
  __fs_mkdir(STAGE + '/tools/zig/cache/p');
  shOrDie('rsync', [
    '-a',
    '--exclude=.zig-cache', '--exclude=zig-out',
    HOST_ZIG_CACHE + '/', STAGE + '/tools/zig/cache/p/',
  ], 'rsync zig pkg cache');
} else {
  __writeStderr('[pack-sdk] WARN: ' + HOST_ZIG_CACHE + ' missing — packed SDK may fail to find zluajit/wgpu prebuilt archives offline.\n');
}

// Native libraries with bundlePolicy: always — only static-library /
// zig-package kinds need explicit copying here. The dynamic-library kinds
// (SDL3, freetype, luajit, curl) are now carried by deps/sysroot/usr/lib/
// already, so we don't ldconfig-mirror them into a separate lib/ dir
// anymore — that was the source of the duplicated runtime libs.
const nativeLibs = registry.nativeLibraries || {};
const missingLibs = [];
for (const [name, spec] of Object.entries(nativeLibs)) {
  if (spec.bundlePolicy !== 'always') continue;
  if (spec.kind === 'static-library' || spec.kind === 'zig-package') {
    if (!spec.payloadPath) {
      missingLibs.push(name + ' (kind=' + spec.kind + ', no payloadPath)');
      continue;
    }
    const src = ROOT + '/' + spec.payloadPath;
    if (!__fs_exists(src)) {
      missingLibs.push(name + ' (' + spec.payloadPath + ' missing)');
      continue;
    }
    log('native ' + name + ' ← ' + spec.payloadPath);
    const stat = JSON.parse(__fs_stat_json(src) || 'null');
    if (stat && stat.isDir) copyTree(src, STAGE + '/' + spec.payloadPath, name);
    else copyFile(src, STAGE + '/' + spec.payloadPath);
    continue;
  }
  // dynamic-library / vendored-c-source / platform-library — handled by
  // deps/sysroot/ (dynamic) or compiled-from-source (vendored). Nothing to
  // copy here.
}

if (missingLibs.length) {
  __writeStderr('[pack-sdk] missing foundational payloads:\n');
  for (const m of missingLibs) __writeStderr('  - ' + m + '\n');
  die('cannot pack SDK with missing foundational libs', 3);
}

// ── tarball ───────────────────────────────────────────────────────────
const TARBALL = '/tmp/rjit-payload-' + Date.now() + '.tar.gz';
log('compressing → ' + TARBALL);
shOrDie('sh', ['-c', "cd '" + STAGE + "' && tar czf '" + TARBALL + "' ."], 'tar');

// ── wrapper + concat ──────────────────────────────────────────────────
const WRAPPER = [
  '#!/bin/sh',
  'set -e',
  'SELF="$0"',
  'CMD="${1:-help}"',
  '[ "$#" -gt 0 ] && shift',
  'CACHE_HOME=${XDG_CACHE_HOME:-$HOME/.cache}',
  'APP_DIR=$CACHE_HOME/rjit',
  'SIG=$(md5sum "$SELF" 2>/dev/null | cut -c1-8 || cksum "$SELF" | cut -d" " -f1)',
  'CACHE=$APP_DIR/$SIG',
  'if [ ! -f "$CACHE/.ready" ]; then',
  '  rm -rf "$APP_DIR"',
  '  mkdir -p "$CACHE"',
  '  SKIP=$(awk \'/^__ARCHIVE__$/{print NR + 1; exit}\' "$SELF")',
  '  tail -n+"$SKIP" "$SELF" | tar xz -C "$CACHE"',
  '  touch "$CACHE/.ready"',
  'fi',
  'export RJIT_HOME="$CACHE"',
  '# Do NOT export LD_LIBRARY_PATH here. The bundled glibc + pinned .so',
  '# files in $CACHE/deps/sysroot/usr/lib are for the CART binary (loaded',
  '# via its own launcher with --library-path). If we export it for the',
  '# rjit dispatcher itself, tools/v8cli + tools/zig/zig get loaded by',
  "# the host's old ld-linux but with our newer libc.so.6, and the host's",
  '# ld-linux lacks GLIBC_PRIVATE symbols that the newer libc references.',
  'case "$CMD" in',
  '  init) exec "$CACHE/tools/v8cli" "$CACHE/scripts/init.js" "$@" ;;',
  '  dev)  exec "$CACHE/scripts/dev" "$@" ;;',
  '  ship) exec "$CACHE/scripts/ship" "$@" ;;',
  '  help|--help|-h) exec "$CACHE/tools/v8cli" "$CACHE/scripts/help.js" "$@" ;;',
  '  *) exec "$CACHE/tools/v8cli" "$CACHE/scripts/help.js" "$CMD" "$@" ;;',
  'esac',
  '__ARCHIVE__',
  '',
].join('\n');

__fs_mkdir(outPath.replace(/\/[^/]+$/, ''));
const STAGED = outPath + '.staged';
if (__fs_exists(STAGED)) __fs_remove(STAGED);
__fs_write(STAGED, WRAPPER);
shOrDie('sh', ['-c', "cat '" + TARBALL + "' >> '" + STAGED + "'"], 'concat');
shOrDie('chmod', ['+x', STAGED], 'chmod');
shOrDie('mv', ['-f', STAGED, outPath], 'mv');

// ── cleanup + report ──────────────────────────────────────────────────
if (!keepStage) {
  __fs_remove(STAGE);
  __fs_remove(TARBALL);
}

const sizeOut = sh('du', ['-h', outPath], '').stdout.trim().split(/\s+/)[0];
log('done → ' + outPath + ' (' + sizeOut + ')');
