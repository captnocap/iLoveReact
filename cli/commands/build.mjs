import { existsSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runLint } from './lint.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');

export async function buildCommand(args) {
  const cwd = process.cwd();
  const projectName = basename(cwd);
  const target = args[0]; // e.g. "dist:love", "dist:terminal", or undefined

  if (target === 'dist:love') {
    await buildDistLove(cwd, projectName);
  } else if (target === 'dist:terminal') {
    await buildDistTerminal(cwd, projectName);
  } else if (!target) {
    await buildBundle(cwd, projectName);
  } else {
    console.error(`Unknown build target: ${target}`);
    console.error('');
    console.error('  Usage:');
    console.error('    ilovereact build                Bundle JS for dev (love . workflow)');
    console.error('    ilovereact build dist:love       Single-file Love2D executable');
    console.error('    ilovereact build dist:terminal   Single-file terminal executable');
    process.exit(1);
  }
}

// ── Helper: find entry point ──────────────────────────────

function findEntry(cwd, ...candidates) {
  for (const c of candidates) {
    const p = join(cwd, c);
    if (existsSync(p)) return p;
  }
  console.error(`No entry point found. Looked for: ${candidates.join(', ')}`);
  process.exit(1);
}

// ── Helper: resolve the lua runtime directory ─────────────

function findLuaRuntime(cwd) {
  // Project-local lua/ (from ilovereact init)
  const local = join(cwd, 'lua');
  if (existsSync(local)) return local;
  // CLI bundled runtime
  const cliRuntime = join(CLI_ROOT, 'runtime', 'lua');
  if (existsSync(cliRuntime)) return cliRuntime;
  console.error('Lua runtime not found. Run `make cli-setup` or ensure lua/ exists.');
  process.exit(1);
}

// ── Helper: resolve libquickjs.so ─────────────────────────

function findLibQuickJS(cwd) {
  const local = join(cwd, 'lib', 'libquickjs.so');
  if (existsSync(local)) return local;
  const cliRuntime = join(CLI_ROOT, 'runtime', 'lib', 'libquickjs.so');
  if (existsSync(cliRuntime)) return cliRuntime;
  console.error('libquickjs.so not found. Run `make cli-setup` or ensure lib/libquickjs.so exists.');
  process.exit(1);
}

// ── ilovereact build (bundle only, for dev) ───────────────

async function buildBundle(cwd, projectName) {
  const entry = findEntry(cwd, 'src/main.tsx');

  // Lint gate — block build on errors
  const { errors } = await runLint(cwd, { silent: false });
  if (errors > 0) {
    console.error(`\n  Build blocked: ${errors} lint error${errors !== 1 ? 's' : ''} must be fixed first.\n`);
    process.exit(1);
  }

  console.log(`\n  Bundling ${projectName}...\n`);
  execSync([
    'npx', 'esbuild',
    '--bundle',
    '--format=iife',
    '--global-name=ReactLove',
    '--target=es2020',
    '--jsx=automatic',
    '--outfile=bundle.js',
    entry,
  ].join(' '), { cwd, stdio: 'inherit' });

  console.log(`\n  Done! bundle.js written. Run: love .\n`);
}

// ── ilovereact build dist:love ────────────────────────────
//
// Produces a single self-extracting binary that runs on any x86_64
// Linux with zero dependencies. Bundles Love2D, all shared libraries
// (including glibc), and the .love game archive.

async function buildDistLove(cwd, projectName) {
  const entry = findEntry(cwd, 'src/main-love.tsx', 'src/native-main.tsx', 'src/main.tsx');
  const luaDir = findLuaRuntime(cwd);
  const libquickjs = findLibQuickJS(cwd);

  const distDir = join(cwd, 'dist');
  const outFile = join(distDir, projectName);
  const stagingDir = join('/tmp', `ilovereact-dist-${projectName}`);
  const payloadDir = join('/tmp', `ilovereact-payload-${projectName}`);
  const loveArchive = join('/tmp', `${projectName}.love`);

  console.log(`\n  Building dist:love for ${projectName}...\n`);

  // 1. Bundle JS (IIFE for QuickJS)
  console.log('  [1/6] Bundling JS...');
  const bundlePath = join(stagingDir, 'bundle.js');
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(join(stagingDir, 'lua'), { recursive: true });

  execSync([
    'npx', 'esbuild',
    '--bundle',
    '--format=iife',
    '--global-name=ReactLove',
    '--target=es2020',
    '--jsx=automatic',
    `--outfile=${bundlePath}`,
    entry,
  ].join(' '), { cwd, stdio: 'pipe' });

  // 2. Stage the .love contents
  console.log('  [2/6] Staging archive...');

  // main.lua and conf.lua: project packaging/ first, then monorepo packaging/{name}/,
  // then project root, then love/ subdir
  const monoRoot = join(CLI_ROOT, '..');
  const mainLuaSources = [
    join(cwd, 'packaging', 'main.lua'),
    join(monoRoot, 'packaging', projectName, 'main.lua'),
    join(cwd, 'main.lua'),
    join(cwd, 'love', 'main.lua'),
  ];
  const confLuaSources = [
    join(cwd, 'packaging', 'conf.lua'),
    join(monoRoot, 'packaging', projectName, 'conf.lua'),
    join(cwd, 'conf.lua'),
    join(cwd, 'love', 'conf.lua'),
  ];

  const mainLua = mainLuaSources.find(p => existsSync(p));
  const confLua = confLuaSources.find(p => existsSync(p));

  if (!mainLua) {
    console.error('  No main.lua found (checked packaging/main.lua and main.lua)');
    process.exit(1);
  }
  if (!confLua) {
    console.error('  No conf.lua found (checked packaging/conf.lua and conf.lua)');
    process.exit(1);
  }

  cpSync(mainLua, join(stagingDir, 'main.lua'));
  cpSync(confLua, join(stagingDir, 'conf.lua'));
  cpSync(luaDir, join(stagingDir, 'lua'), { recursive: true });

  // 3. Create .love archive
  console.log('  [3/6] Creating .love archive...');
  execSync(`cd "${stagingDir}" && zip -9 -r "${loveArchive}" .`, { stdio: 'pipe' });

  // 4. Find love binary and bundle shared libraries
  console.log('  [4/6] Bundling Love2D + shared libraries...');
  let loveBin;
  try {
    loveBin = execSync('readlink -f $(which love)', { encoding: 'utf-8' }).trim();
  } catch {
    console.error('  Love2D not found. Install it: https://love2d.org');
    process.exit(1);
  }

  rmSync(payloadDir, { recursive: true, force: true });
  mkdirSync(join(payloadDir, 'lib'), { recursive: true });

  cpSync(loveBin, join(payloadDir, 'love.bin'));
  cpSync(loveArchive, join(payloadDir, 'game.love'));
  cpSync(libquickjs, join(payloadDir, 'lib', 'libquickjs.so'));

  // Bundle ALL shared libraries (same technique as Steam Runtime / AppImage)
  const lddOutput = execSync(`ldd "${loveBin}"`, { encoding: 'utf-8' });
  for (const line of lddOutput.split('\n')) {
    if (line.includes('linux-vdso')) continue;
    const match = line.match(/^\s*(\S+)\s+=>\s+(\S+)/);
    if (match) {
      const [, soname, path] = match;
      try {
        const real = execSync(`readlink -f "${path}"`, { encoding: 'utf-8' }).trim();
        cpSync(real, join(payloadDir, 'lib', soname));
      } catch { /* skip unresolvable */ }
    }
  }

  // Bundle the dynamic linker itself
  try {
    const ldLinux = execSync('readlink -f /lib64/ld-linux-x86-64.so.2', { encoding: 'utf-8' }).trim();
    cpSync(ldLinux, join(payloadDir, 'lib', 'ld-linux-x86-64.so.2'));
  } catch {
    console.error('  Could not find ld-linux. Are you on x86_64 Linux?');
    process.exit(1);
  }

  // 5. Create launcher script
  console.log('  [5/6] Creating launcher...');
  const launcher =
    '#!/bin/sh\n' +
    'DIR="$(cd "$(dirname "$0")" && pwd)"\n' +
    'exec "$DIR/lib/ld-linux-x86-64.so.2" --inhibit-cache --library-path "$DIR/lib" "$DIR/love.bin" "$DIR/game.love" "$@"\n';
  writeFileSync(join(payloadDir, 'run'), launcher, { mode: 0o755 });

  // 6. Pack into single self-extracting binary
  console.log('  [6/6] Packing self-extracting binary...');
  mkdirSync(distDir, { recursive: true });

  const tarball = join('/tmp', `${projectName}-payload.tar.gz`);
  execSync(`cd "${payloadDir}" && tar czf "${tarball}" .`, { stdio: 'pipe' });

  const header =
    '#!/bin/sh\n' +
    'set -e\n' +
    `APP_DIR=\${XDG_CACHE_HOME:-$HOME/.cache}/ilovereact-${projectName}\n` +
    'SIG=$(md5sum "$0" 2>/dev/null | cut -c1-8 || cksum "$0" | cut -d" " -f1)\n' +
    'CACHE="$APP_DIR/$SIG"\n' +
    'if [ ! -f "$CACHE/.ready" ]; then\n' +
    '  rm -rf "$APP_DIR"\n' +
    '  mkdir -p "$CACHE"\n' +
    '  SKIP=$(awk \'/^__ARCHIVE__$/{print NR + 1; exit}\' "$0")\n' +
    '  tail -n+"$SKIP" "$0" | tar xz -C "$CACHE"\n' +
    '  touch "$CACHE/.ready"\n' +
    'fi\n' +
    'exec "$CACHE/run" "$@"\n' +
    '__ARCHIVE__\n';

  const headerBuf = Buffer.from(header);
  const tarBuf = readFileSync(tarball);
  const out = Buffer.concat([headerBuf, tarBuf]);
  writeFileSync(outFile, out, { mode: 0o755 });

  // Cleanup
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(payloadDir, { recursive: true, force: true });
  rmSync(loveArchive, { force: true });
  rmSync(tarball, { force: true });

  const size = (out.length / (1024 * 1024)).toFixed(1);
  console.log(`\n  Done! ${size} MB → dist/${projectName}`);
  console.log(`  Run:  ./dist/${projectName}\n`);
}

// ── ilovereact build dist:terminal ────────────────────────
//
// Produces a single executable Node.js script with a shebang.
// Just run it: ./dist/{name}-terminal

async function buildDistTerminal(cwd, projectName) {
  const entry = findEntry(cwd, 'src/main-terminal.tsx');

  const distDir = join(cwd, 'dist');
  const outFile = join(distDir, `${projectName}-terminal`);
  const tmpFile = join('/tmp', `${projectName}-terminal.js`);

  console.log(`\n  Building dist:terminal for ${projectName}...\n`);

  mkdirSync(distDir, { recursive: true });

  // Bundle as CJS for Node.js (no ESM module warnings)
  console.log('  [1/2] Bundling JS...');
  execSync([
    'npx', 'esbuild',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2020',
    '--jsx=automatic',
    '--external:ws',
    `--outfile=${tmpFile}`,
    entry,
  ].join(' '), { cwd, stdio: 'pipe' });

  // Prepend shebang
  console.log('  [2/2] Writing executable...');
  const shebang = Buffer.from('#!/usr/bin/env node\n');
  const js = readFileSync(tmpFile);
  writeFileSync(outFile, Buffer.concat([shebang, js]), { mode: 0o755 });

  rmSync(tmpFile, { force: true });

  const size = ((shebang.length + js.length) / 1024).toFixed(0);
  console.log(`\n  Done! ${size} KB → dist/${projectName}-terminal`);
  console.log(`  Run:  ./dist/${projectName}-terminal\n`);
}
