// scripts/firecracker-build.js — TS recipe → bootable Firecracker rootfs.
//
// Usage:
//   tools/v8cli scripts/firecracker-build.js <recipe.ts>
//
// Pipeline (all unprivileged, no sudo):
//   1. esbuild bundles recipe.ts → JS → eval → spec
//   2. mmdebstrap installs apt packages + runs customize hooks
//      AND directly emits the final ext4/squashfs image (its native output
//      formats — chosen by output path extension)
//   3. Manifest written next to image
//
// We deliberately let mmdebstrap own the rootfs→image step. Doing it
// ourselves with mke2fs from outside mmdebstrap's user-namespace fails on
// root-owned files (.pwd.lock etc) that appear as the subuid base to us.

const ROOT = __cwd();
const ESBUILD = ROOT + '/tools/esbuild';
const MMDEBSTRAP = '/usr/bin/mmdebstrap';
const MKE2FS = '/usr/sbin/mke2fs';
const MKSQUASHFS = '/usr/bin/mksquashfs';

function die(msg, code) {
  __writeStderr('[fc-build] ' + msg + '\n');
  __exit(code | 0 || 1);
}

function log(msg) {
  __writeStdout('[fc-build] ' + msg + '\n');
}

function abs(p) {
  if (p.startsWith('/')) return p;
  if (p.startsWith('./')) p = p.slice(2);
  return ROOT + '/' + p;
}

function run(bin, args, stdin) {
  const result = JSON.parse(__spawnSync(bin, JSON.stringify(args), stdin || ''));
  if (result.stdout) __writeStdout(result.stdout);
  if (result.stderr) __writeStderr(result.stderr);
  if (result.code !== 0) {
    die(bin + ' exited ' + result.code, result.code || 1);
  }
  return result;
}

function runCapture(bin, args, stdin) {
  // Same as run() but doesn't tee output — caller handles stdout/stderr.
  const result = JSON.parse(__spawnSync(bin, JSON.stringify(args), stdin || ''));
  return result;
}

// ---------------------------------------------------------------------------
// 1. Argv parsing
// ---------------------------------------------------------------------------

// process.argv[0] is this script path; drop it.
const argv = process.argv.slice(1);
let recipePath = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) die('unknown flag: ' + a);
  else if (!recipePath) recipePath = a;
  else die('extra positional arg: ' + a);
}
if (!recipePath) die('usage: firecracker-build.js <recipe.ts>');
recipePath = abs(recipePath);
if (!__exists(recipePath)) die('recipe not found: ' + recipePath);

// ---------------------------------------------------------------------------
// 2. Bundle + eval the TS recipe
// ---------------------------------------------------------------------------

log('bundling recipe: ' + recipePath);
const bundleFlags = [
  '--bundle',
  '--format=cjs',
  '--platform=neutral',
  '--target=es2022',
  '--log-level=warning',
  recipePath,
];
const bundleRes = JSON.parse(__spawnSync(ESBUILD, JSON.stringify(bundleFlags), ''));
if (bundleRes.stderr) __writeStderr(bundleRes.stderr);
if (bundleRes.code !== 0) die('esbuild failed: ' + bundleRes.code, bundleRes.code || 1);

const moduleObj = { exports: {} };
try {
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', bundleRes.stdout)(moduleObj, moduleObj.exports);
} catch (e) {
  die('failed to eval recipe: ' + (e && e.message || e));
}
const spec = moduleObj.exports.default || moduleObj.exports;
if (!spec || typeof spec !== 'object') die('recipe must default-export an object');

// Light validation — we don't have zod here.
function need(field) {
  if (!spec[field]) die('recipe missing required field: ' + field);
}
need('id'); need('base'); need('arch'); need('apt'); need('output');
if (!Array.isArray(spec.apt)) die('recipe.apt must be string[]');
if (!spec.output.kind || !spec.output.path) die('recipe.output must have {kind, path}');
if (spec.output.kind === 'ext4' && !spec.output.sizeMb) die('ext4 output requires sizeMb');
if (spec.arch !== 'amd64') die('only amd64 is supported in v0 (got ' + spec.arch + ')');

log('recipe: id=' + spec.id + ' base=' + spec.base + ' apt=' + spec.apt.length + ' steps=' + (spec.steps || []).length);

// ---------------------------------------------------------------------------
// 3. Translate spec → mmdebstrap args
// ---------------------------------------------------------------------------

function shellEscape(s) {
  // Single-quote escape: ' -> '\''
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// v8cli is bare V8 — no Web globals like btoa. Tiny base64 encoder for
// writeFile contents (assumes input is already a UTF-8 byte string, which is
// what String stores for ASCII source).
function b64encode(s) {
  const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < s.length; i += 3) {
    const b0 = s.charCodeAt(i) & 0xff;
    const b1 = i + 1 < s.length ? s.charCodeAt(i + 1) & 0xff : 0;
    const b2 = i + 2 < s.length ? s.charCodeAt(i + 2) & 0xff : 0;
    const t = (b0 << 16) | (b1 << 8) | b2;
    out += T[(t >> 18) & 63];
    out += T[(t >> 12) & 63];
    out += i + 1 < s.length ? T[(t >> 6) & 63] : '=';
    out += i + 2 < s.length ? T[t & 63] : '=';
  }
  return out;
}

const customizeHooks = [];

// npmGlobal first: system-wide tools available to any later step.
for (const pkg of (spec.npmGlobal || [])) {
  customizeHooks.push('chroot "$1" /bin/sh -c ' + shellEscape('npm install -g ' + pkg));
}

// Then user steps in declared order.
for (const step of (spec.steps || [])) {
  if (step.run) {
    customizeHooks.push('chroot "$1" /bin/sh -c ' + shellEscape(step.run));
  } else if (step.writeFile) {
    const wf = step.writeFile;
    const b64 = b64encode(wf.content);
    const cmd =
      'mkdir -p "$(dirname "$1' + wf.path + '")" && ' +
      'echo ' + shellEscape(b64) + ' | base64 -d > "$1' + wf.path + '"' +
      (wf.mode ? ' && chmod ' + wf.mode.toString(8) + ' "$1' + wf.path + '"' : '');
    customizeHooks.push(cmd);
  } else if (step.copyFromHost) {
    const cf = step.copyFromHost;
    const src = abs(cf.src);
    if (!__exists(src)) die('copyFromHost src not found: ' + src);
    // Pick the right mmdebstrap built-in based on src kind. These hooks run
    // with mmdebstrap's own credentials, sidestepping the user-namespace
    // permission problem we hit when shelling out to cp.
    const statRes = JSON.parse(__spawnSync('/usr/bin/stat', JSON.stringify(['-c', '%F', src]), ''));
    const kind = (statRes.stdout || '').trim();
    if (kind === 'directory') {
      // sync-in requires dest to exist in the chroot — auto-create it.
      customizeHooks.push('chroot "$1" /bin/sh -c ' + shellEscape('mkdir -p ' + cf.dest));
      customizeHooks.push('sync-in ' + src + ' ' + cf.dest);
    } else {
      // upload writes the file directly; ensure its parent dir exists.
      const parent = cf.dest.substring(0, cf.dest.lastIndexOf('/')) || '/';
      customizeHooks.push('chroot "$1" /bin/sh -c ' + shellEscape('mkdir -p ' + parent));
      customizeHooks.push('upload ' + src + ' ' + cf.dest);
    }
  } else {
    die('unknown step shape: ' + JSON.stringify(step));
  }
}

// mmdebstrap chooses output format from the path extension. Map our schema
// kinds to the suffix it expects. ext4 size is auto-determined as content + 25%
// (with a 32 MiB floor) — sizeMb in the spec is currently informational; we
// resize2fs after if it's larger than mmdebstrap's auto-pick.
const outPath = abs(spec.output.path);
const outDir = outPath.substring(0, outPath.lastIndexOf('/'));
__mkdirp(outDir);
if (__exists(outPath)) runCapture('/bin/rm', ['-f', outPath], '');

const mmdbArgs = [
  '--variant=minbase',
  '--components=main,universe',
  '--include=' + spec.apt.join(','),
];
for (const hook of customizeHooks) {
  mmdbArgs.push('--customize-hook=' + hook);
}
mmdbArgs.push(spec.base);
mmdbArgs.push(outPath);

// ---------------------------------------------------------------------------
// 4. Run mmdebstrap (builds rootfs + emits final image in one shot)
// ---------------------------------------------------------------------------

log('mmdebstrap → ' + outPath);
const t0 = __nowMs();
run(MMDEBSTRAP, mmdbArgs, '');
log('mmdebstrap done in ' + ((__nowMs() - t0) / 1000).toFixed(1) + 's');

// ---------------------------------------------------------------------------
// 5. Optional grow: if recipe declared sizeMb > current image, resize2fs up
// ---------------------------------------------------------------------------

if (spec.output.kind === 'ext4' && spec.output.sizeMb) {
  const cur = parseInt(runCapture('/usr/bin/stat', ['-c', '%s', outPath], '').stdout.trim(), 10) || 0;
  const targetBytes = spec.output.sizeMb * 1024 * 1024;
  if (targetBytes > cur) {
    log('growing ext4: ' + (cur >> 20) + 'MB → ' + spec.output.sizeMb + 'MB');
    run('/usr/bin/truncate', ['-s', spec.output.sizeMb + 'M', outPath], '');
    run('/usr/sbin/resize2fs', [outPath], '');
  }
}

// ---------------------------------------------------------------------------
// 6. Manifest + cleanup
// ---------------------------------------------------------------------------

const sizeRes = runCapture('/usr/bin/stat', ['-c', '%s', outPath], '');
const sizeBytes = parseInt(sizeRes.stdout.trim(), 10) || 0;

const manifest = {
  id: spec.id,
  builtAt: new Date().toISOString(),
  recipePath: recipePath.startsWith(ROOT) ? recipePath.slice(ROOT.length + 1) : recipePath,
  base: spec.base,
  arch: spec.arch,
  apt: spec.apt,
  npmGlobal: spec.npmGlobal || [],
  output: { kind: spec.output.kind, path: spec.output.path, sizeBytes },
  buildElapsedMs: __nowMs() - t0,
};
const manifestPath = outPath.replace(/\.[^.]+$/, '') + '.manifest.json';
__writeFile(manifestPath, JSON.stringify(manifest, null, 2));
log('manifest → ' + manifestPath);

log('done. output: ' + outPath + ' (' + (sizeBytes / 1024 / 1024).toFixed(1) + ' MB)');
