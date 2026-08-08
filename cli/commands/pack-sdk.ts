// cli/commands/pack-sdk.ts - build the single-file rjit distributable.

import { fsExists, fsMkdir, fsReadJson, fsRemove, fsWrite, tryFsStat } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawnSync, SpawnResult } from '../host/process.ts';
import type { Registry, NativeLibrarySpec, ToolSpec } from '../registry/schema.ts';

interface PackArgs {
  outPath: string;
  keepStage: boolean;
}

const ROOT = __cwd();
const EXCLUDES = [
  '.zig-cache',
  'zig-cache',
  'zig-out',
  '.cache',
  'node_modules',
  '__pycache__',
  '.DS_Store',
];

const SOURCE_TREES = [
  'framework',
  'runtime',
  'renderer',
  'cli',
  'scripts',
  'sdk',
  'vendor',
  'stb',
  // 'love2d/quickjs' was here for the QJS bridge. The directory does not exist in the
  // checkout (gitignored build output) so the fsExists guard always skipped it, and love2d
  // is now archive/love2d.zip. QJS is legacy maintenance-only; V8 is the default runtime.
];

const ZIG_PATH_DEPS = [
  'deps/tls.zig',
  'deps/wgpu_native_zig',
  'deps/zig-v8',
  'deps/sysroot',
];

// The app roots (v8_app/v8_cli/v8_hello.zig) live in framework/ and ride the
// SOURCE_TREES copy; only true root files belong here.
const TOP_LEVEL_FILES = [
  'build.zig',
  'build.zig.zon',
];

const SKIP_FAMILIES = [
  /^libc\.so\./,
  /^libm\.so\./,
  /^libpthread\.so\./,
  /^libdl\.so\./,
  /^libresolv\.so\./,
  /^ld-linux/,
  /^linux-vdso/,
  /^libX11\.so\./,
  /^libXext\.so\./,
  /^libXcursor\.so\./,
  /^libXi\.so\./,
  /^libXfixes\.so\./,
  /^libXrandr\.so\./,
  /^libXss\.so\./,
  /^libXrender\.so\./,
  /^libxcb\.so\./,
  /^libxcb-/,
];

const GLIBC_FAMILY = [
  '/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2',
  '/lib/x86_64-linux-gnu/libc.so.6',
  '/lib/x86_64-linux-gnu/libm.so.6',
  '/lib/x86_64-linux-gnu/libpthread.so.0',
  '/lib/x86_64-linux-gnu/libdl.so.2',
  '/lib/x86_64-linux-gnu/libresolv.so.2',
  '/lib64/ld-linux-x86-64.so.2',
];

export async function run(argv: string[]): Promise<number> {
  const parsed = parsePackArgs(argv);
  if (typeof parsed === 'number') return parsed;

  const registryPath = `${ROOT}/sdk/dependency-registry.json`;
  if (!fsExists(registryPath)) return fail(`registry missing: ${registryPath}`, 1);
  const registry = fsReadJson<Registry>(registryPath);

  const stage = `/tmp/rjit-stage-${Date.now()}`;
  fsMkdir(stage);
  log(`staging at ${stage}`);

  try {
    stageSourceTrees(stage);
    stageZigDeps(stage);
    stageTopLevelFiles(stage);
    stageToolchain(stage, registry);
    stageRjitTool(stage);
    stageSdlDeps(stage);
    stageGlibc(stage);
    stageZigPackageCache(stage);
    const missing = stageAlwaysNativeLibraries(stage, registry);
    if (missing.length) {
      for (const item of missing) err(`  - ${item}`);
      return fail('cannot pack SDK with missing foundational libs', 3);
    }

    const tarball = `/tmp/rjit-payload-${Date.now()}.tar.gz`;
    log(`compressing -> ${tarball}`);
    shOrDie('sh', ['-c', `cd '${stage}' && tar czf '${tarball}' .`], 'tar');
    writeSelfExtractor(parsed.outPath, tarball);

    if (!parsed.keepStage) {
      fsRemove(stage);
      fsRemove(tarball);
    }

    const sizeOut = sh('du', ['-h', parsed.outPath]).stdout.trim().split(/\s+/)[0] ?? '?';
    log(`done -> ${parsed.outPath} (${sizeOut})`);
    return 0;
  } catch (error) {
    if (!parsed.keepStage) fsRemove(stage);
    throw error;
  }
}

function parsePackArgs(argv: string[]): PackArgs | number {
  let outPath = `${ROOT}/dist/rjit`;
  let keepStage = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--out' || arg === '-o') {
      const value = argv[++i];
      if (!value) return fail('flag requires value: --out', 2);
      outPath = value;
    } else if (arg === '--keep-stage') {
      keepStage = true;
    } else if (arg === '--help' || arg === '-h') {
      out('Usage: rjit pack-sdk [--out path] [--keep-stage]');
      return 0;
    } else {
      return fail(`unknown flag: ${arg}`, 2);
    }
  }
  if (!outPath.startsWith('/')) outPath = `${ROOT}/${outPath}`;
  return { outPath, keepStage };
}

function stageSourceTrees(stage: string): void {
  for (const sub of SOURCE_TREES) {
    if (!fsExists(`${ROOT}/${sub}`)) continue;
    log(`copy ${sub}/`);
    copyTree(`${ROOT}/${sub}`, `${stage}/${sub}`, sub);
  }
}

function stageZigDeps(stage: string): void {
  for (const sub of ZIG_PATH_DEPS) {
    if (!fsExists(`${ROOT}/${sub}`)) continue;
    log(`copy ${sub}/`);
    copyTree(`${ROOT}/${sub}`, `${stage}/${sub}`, sub);
  }
}

function stageTopLevelFiles(stage: string): void {
  for (const file of TOP_LEVEL_FILES) {
    if (!fsExists(`${ROOT}/${file}`)) continue;
    log(`copy ${file}`);
    copyFile(`${ROOT}/${file}`, `${stage}/${file}`);
  }
}

function stageToolchain(stage: string, registry: Registry): void {
  const tools = registry.cliPayload?.tools ?? {};
  for (const [name, spec] of Object.entries(tools) as Array<[string, ToolSpec]>) {
    if (spec.packPolicy === 'optional') continue;
    if (spec.payloadPath) {
      log(`tool ${name} <- ${spec.payloadPath}`);
      copyFile(`${ROOT}/${spec.payloadPath}`, `${stage}/${spec.payloadPath}`);
    }
    for (const supportPath of spec.supportPaths ?? []) {
      if (!fsExists(`${ROOT}/${supportPath}`)) continue;
      log(`tool ${name} support <- ${supportPath}`);
      copyTree(`${ROOT}/${supportPath}`, `${stage}/${supportPath}`, supportPath);
    }
  }
}

function stageRjitTool(stage: string): void {
  for (const file of ['tools/rjit', 'tools/rjit.js']) {
    if (!fsExists(`${ROOT}/${file}`)) throw new Error(`missing rjit tool payload: ${file}`);
    log(`tool rjit <- ${file}`);
    copyFile(`${ROOT}/${file}`, `${stage}/${file}`);
  }
}

function stageSdlDeps(stage: string): void {
  const sysrootLib = `${stage}/deps/sysroot/usr/lib`;
  fsMkdir(sysrootLib);
  const sdlHostPath = '/lib/x86_64-linux-gnu/libSDL3.so.0';
  if (!fsExists(sdlHostPath)) return;

  const lddOut = sh('ldd', [sdlHostPath]).stdout;
  for (const line of lddOut.split('\n')) {
    const match = /^\s*(\S+)\s*=>\s*(\S+)/.exec(line);
    if (!match) continue;
    const soname = match[1]!;
    const libPath = match[2]!;
    if (libPath === 'not' || !fsExists(libPath)) continue;
    if (SKIP_FAMILIES.some((rx) => rx.test(soname))) continue;
    const realPath = sh('readlink', ['-f', libPath]).stdout.trim() || libPath;
    const dest = `${sysrootLib}/${soname}`;
    if (fsExists(dest)) continue;
    copyFile(realPath, dest);
    log(`SDL3 dep ${soname} <- ${realPath}`);
  }
}

function stageGlibc(stage: string): void {
  const sysrootLib = `${stage}/deps/sysroot/usr/lib`;
  fsMkdir(sysrootLib);
  for (const path of GLIBC_FAMILY) {
    if (!fsExists(path)) continue;
    const realPath = sh('readlink', ['-f', path]).stdout.trim() || path;
    const baseName = path.replace(/^.*\//, '');
    const dest = `${sysrootLib}/${baseName}`;
    if (fsExists(dest)) continue;
    log(`glibc ${baseName} <- ${realPath}`);
    copyFile(realPath, dest);
  }
}

function stageZigPackageCache(stage: string): void {
  const hostZigCache = `${__env('HOME') || '/root'}/.cache/zig/p`;
  if (!fsExists(hostZigCache)) {
    err(`[pack-sdk] WARN: ${hostZigCache} missing - packed SDK may fail to find zluajit/wgpu prebuilt archives offline.`);
    return;
  }
  log(`zig pkg cache <- ${hostZigCache}`);
  fsMkdir(`${stage}/tools/zig/cache/p`);
  shOrDie('rsync', [
    '-a',
    '--exclude=.zig-cache',
    '--exclude=zig-out',
    `${hostZigCache}/`,
    `${stage}/tools/zig/cache/p/`,
  ], 'rsync zig pkg cache');
}

function stageAlwaysNativeLibraries(stage: string, registry: Registry): string[] {
  const missing: string[] = [];
  const nativeLibs = registry.nativeLibraries ?? {};
  for (const [name, spec] of Object.entries(nativeLibs) as Array<[string, NativeLibrarySpec]>) {
    if (spec.bundlePolicy !== 'always') continue;
    if (spec.kind !== 'static-library' && spec.kind !== 'zig-package') continue;
    if (!spec.payloadPath) {
      missing.push(`${name} (kind=${spec.kind}, no payloadPath)`);
      continue;
    }
    const payloads = Array.isArray(spec.payloadPath) ? spec.payloadPath : [spec.payloadPath];
    for (const payloadPath of payloads) {
      const src = `${ROOT}/${payloadPath}`;
      if (!fsExists(src)) {
        missing.push(`${name} (${payloadPath} missing)`);
        continue;
      }
      log(`native ${name} <- ${payloadPath}`);
      const stat = tryFsStat(src);
      if (stat?.isDir) copyTree(src, `${stage}/${payloadPath}`, name);
      else copyFile(src, `${stage}/${payloadPath}`);
    }
  }
  return missing;
}

function writeSelfExtractor(outPath: string, tarball: string): void {
  const wrapper = [
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
    '# Do not export LD_LIBRARY_PATH here. The sysroot libraries are for',
    '# shipped cart launchers, not for the rjit dispatcher process itself.',
    'case "$CMD" in',
    '  help|--help|-h) exec "$CACHE/tools/rjit" help "$@" ;;',
    '  *) exec "$CACHE/tools/rjit" "$CMD" "$@" ;;',
    'esac',
    '__ARCHIVE__',
    '',
  ].join('\n');

  fsMkdir(outPath.replace(/\/[^/]+$/, ''));
  const staged = `${outPath}.staged`;
  if (fsExists(staged)) fsRemove(staged);
  fsWrite(staged, wrapper);
  shOrDie('sh', ['-c', `cat '${tarball}' >> '${staged}'`], 'concat');
  shOrDie('chmod', ['+x', staged], 'chmod');
  shOrDie('mv', ['-f', staged, outPath], 'mv');
}

function copyTree(srcAbs: string, destAbs: string, label: string): void {
  if (!fsExists(srcAbs)) throw new Error(`missing payload: ${label || srcAbs}`);
  fsMkdir(destAbs.replace(/\/[^/]+$/, ''));
  const args = ['-a'];
  for (const exclude of EXCLUDES) args.push(`--exclude=${exclude}`);
  args.push(`${srcAbs}/`, `${destAbs}/`);
  fsMkdir(destAbs);
  shOrDie('rsync', args, `rsync ${label || srcAbs}`);
}

function copyFile(srcAbs: string, destAbs: string): void {
  if (!fsExists(srcAbs)) throw new Error(`missing file: ${srcAbs}`);
  fsMkdir(destAbs.replace(/\/[^/]+$/, ''));
  shOrDie('cp', ['-a', srcAbs, destAbs], `cp ${srcAbs}`);
}

function sh(cmd: string, args: string[], stdin = ''): SpawnResult {
  return spawnSync(cmd, args, stdin);
}

function shOrDie(cmd: string, args: string[], label: string): SpawnResult {
  const result = sh(cmd, args);
  if (result.code !== 0) {
    if (result.stderr) __writeStderr(result.stderr);
    throw new Error(`${label || cmd} failed (code ${result.code})`);
  }
  return result;
}

function log(message: string): void {
  out(`[pack-sdk] ${message}`);
}

function fail(message: string, code: number): number {
  err(`[pack-sdk] ${message}`);
  return code;
}
