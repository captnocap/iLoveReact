import { existsSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runLint } from './lint.mjs';
import { updateCommand } from './update.mjs';
import { TARGETS, TARGET_NAMES, esbuildArgs, esbuildDistArgs } from '../targets.mjs';
import { getEsbuildAliases } from '../lib/aliases.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.flv', '.wmv']);

/** Check if ffmpeg is available on the system. */
function hasFFmpeg() {
  try {
    execSync('which ffmpeg', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan directories for video files and convert non-.ogv files to Theora format.
 * Places .ogv files alongside originals (same name, .ogv extension).
 * Skips if .ogv already exists and is newer than the source.
 */
function convertVideos(dirs) {
  if (!hasFFmpeg()) {
    return { converted: 0, skipped: 0, noFFmpeg: true };
  }

  let converted = 0;
  let skipped = 0;

  function scanDir(dir) {
    if (!existsSync(dir)) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try { stat = statSync(fullPath); } catch { continue; }

      if (stat.isDirectory()) {
        // Skip node_modules, dist, .git, __video_cache
        if (!['node_modules', 'dist', '.git', '__video_cache'].includes(entry)) {
          scanDir(fullPath);
        }
        continue;
      }

      const ext = extname(entry).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) continue;

      // Check if .ogv sibling already exists and is up-to-date
      const ogvPath = fullPath.replace(/\.[^.]+$/, '.ogv');
      if (existsSync(ogvPath)) {
        try {
          const ogvStat = statSync(ogvPath);
          if (ogvStat.mtimeMs >= stat.mtimeMs) {
            skipped++;
            continue;
          }
        } catch { /* re-convert */ }
      }

      console.log(`  [video] Converting ${entry} → ${basename(ogvPath)}...`);
      try {
        execSync(
          `ffmpeg -y -i "${fullPath}" -c:v libtheora -q:v 7 -c:a libvorbis -q:a 4 "${ogvPath}"`,
          { stdio: 'pipe' }
        );
        converted++;
      } catch (err) {
        console.error(`  [video] Failed to convert ${entry}: ${err.message}`);
      }
    }
  }

  for (const dir of dirs) {
    scanDir(dir);
  }

  return { converted, skipped, noFFmpeg: false };
}

export async function buildCommand(args) {
  const cwd = process.cwd();
  const projectName = basename(cwd);
  const hasDebugFlag = args.includes('--debug');
  const skipUpdate = args.includes('--no-update');
  const rawTarget = args.filter(a => !a.startsWith('--'))[0]; // e.g. "dist:love", "terminal", or undefined

  // Auto-update runtime files before building (love target only — grid/web don't need lua/)
  if (!skipUpdate && (!rawTarget || rawTarget === 'love' || rawTarget === 'dist:love')) {
    await updateCommand([]);
  }

  // Parse dist:<target> vs plain <target>
  const isDist = rawTarget && rawTarget.startsWith('dist:');
  const targetName = isDist ? rawTarget.slice(5) : rawTarget;

  // No target → Love2D dev build (backwards compat)
  if (!rawTarget) {
    await buildDevTarget(cwd, projectName, 'love');
    return;
  }

  // Validate target name
  if (!TARGETS[targetName]) {
    console.error(`Unknown target: ${targetName}`);
    console.error('');
    console.error('  Available targets:');
    console.error(`    ${TARGET_NAMES.join(', ')}`);
    console.error('');
    console.error('  Usage:');
    console.error('    ilovereact build                   Bundle JS for dev (Love2D, default)');
    console.error('    ilovereact build <target>          Dev build for any target');
    console.error('    ilovereact build dist:<target>     Production executable');
    console.error('');
    console.error('  Examples:');
    console.error('    ilovereact build terminal          Dev build → dist/main.js');
    console.error('    ilovereact build dist:love         Self-extracting Love2D binary');
    console.error('    ilovereact build dist:terminal     Single-file Node.js executable');
    process.exit(1);
  }

  const target = TARGETS[targetName];

  if (isDist) {
    if (target.kind === 'love') {
      await buildDistLove(cwd, projectName, { debug: hasDebugFlag });
    } else if (target.kind === 'web') {
      // Web dist is just the ESM bundle (no shebang — not a Node.js executable)
      await buildDevTarget(cwd, projectName, targetName);
    } else {
      await buildDistGrid(cwd, projectName, targetName);
    }
  } else {
    await buildDevTarget(cwd, projectName, targetName);
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
  const local = join(cwd, 'lua');
  if (existsSync(local)) return local;
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

// ── Helper: resolve libmpv.so.2 (optional) ────────────────

function findLibMpv(cwd) {
  const local = join(cwd, 'lib', 'libmpv.so.2');
  if (existsSync(local)) return local;
  const cliRuntime = join(CLI_ROOT, 'runtime', 'lib', 'libmpv.so.2');
  if (existsSync(cliRuntime)) return cliRuntime;
  return null; // optional — video playback won't be available
}

// ── Helper: resolve tor binary (optional) ─────────────────

function findTorBinary(cwd) {
  const local = join(cwd, 'bin', 'tor');
  if (existsSync(local)) return local;
  const cliRuntime = join(CLI_ROOT, 'runtime', 'bin', 'tor');
  if (existsSync(cliRuntime)) return cliRuntime;
  return null; // optional — .onion hosting won't be available
}

// ── ilovereact build [target] (dev build) ─────────────────

async function buildDevTarget(cwd, projectName, targetName) {
  const target = TARGETS[targetName];
  const entryCandidates = target.entries.map(e => `src/${e}`);
  const entry = findEntry(cwd, ...entryCandidates);

  // Lint gate
  const { errors } = await runLint(cwd, { silent: false });
  if (errors > 0) {
    console.error(`\n  Build blocked: ${errors} lint error${errors !== 1 ? 's' : ''} must be fixed first.\n`);
    process.exit(1);
  }

  const outfile = join(cwd, target.output);
  const outdir = dirname(outfile);
  if (!existsSync(outdir)) mkdirSync(outdir, { recursive: true });

  console.log(`\n  Bundling ${projectName} [${targetName}]...\n`);
  execSync([
    'npx', 'esbuild',
    ...esbuildArgs(target),
    `--outfile=${outfile}`,
    ...getEsbuildAliases(cwd),
    entry,
  ].join(' '), { cwd, stdio: 'inherit' });

  const hint = targetName === 'love' ? '  Run: love .' : `  Output: ${target.output}`;
  console.log(`\n  Done! ${target.output} written.\n${hint}\n`);
}

// ── ilovereact build dist:<grid-target> ───────────────────
//
// Produces a single executable Node.js script with a shebang.
// Works for terminal, cc, nvim, hs, awesome.

async function buildDistGrid(cwd, projectName, targetName) {
  const target = TARGETS[targetName];
  const entryCandidates = target.entries.map(e => `src/${e}`);
  const entry = findEntry(cwd, ...entryCandidates);

  const distDir = join(cwd, 'dist');
  const outFile = join(distDir, `${projectName}-${targetName}`);
  const tmpFile = join('/tmp', `${projectName}-${targetName}.js`);

  console.log(`\n  Building dist:${targetName} for ${projectName}...\n`);

  // Lint gate
  const { errors } = await runLint(cwd, { silent: false });
  if (errors > 0) {
    console.error(`\n  Build blocked: ${errors} lint error${errors !== 1 ? 's' : ''} must be fixed first.\n`);
    process.exit(1);
  }

  mkdirSync(distDir, { recursive: true });

  // Bundle as CJS for Node.js (no ESM module warnings)
  console.log('  [1/2] Bundling JS...');
  execSync([
    'npx', 'esbuild',
    ...esbuildDistArgs(target),
    `--outfile=${tmpFile}`,
    ...getEsbuildAliases(cwd),
    entry,
  ].join(' '), { cwd, stdio: 'pipe' });

  // Prepend shebang
  console.log('  [2/2] Writing executable...');
  const shebang = Buffer.from('#!/usr/bin/env node\n');
  const js = readFileSync(tmpFile);
  writeFileSync(outFile, Buffer.concat([shebang, js]), { mode: 0o755 });

  rmSync(tmpFile, { force: true });

  const size = ((shebang.length + js.length) / 1024).toFixed(0);
  console.log(`\n  Done! ${size} KB → dist/${projectName}-${targetName}`);
  console.log(`  Run:  ./dist/${projectName}-${targetName}\n`);
}

// ── ilovereact build dist:love ────────────────────────────
//
// Produces a single self-extracting binary that runs on any x86_64
// Linux with zero dependencies. Bundles Love2D, all shared libraries
// (including glibc), and the .love game archive.

async function buildDistLove(cwd, projectName, opts = {}) {
  const target = TARGETS.love;
  const entryCandidates = target.entries.map(e => `src/${e}`);
  const entry = findEntry(cwd, ...entryCandidates);
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
    ...esbuildArgs(target),
    `--outfile=${bundlePath}`,
    ...getEsbuildAliases(cwd),
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

  // Inspector is now enabled by default in dist builds
  // (Previously disabled unless --debug was passed, but this was annoying for dev)
  // To disable: add `inspector = false` to ReactLove.init() in your main.lua

  // 2b. Pre-convert video assets to Theora (.ogv) for Love2D
  const videoDirs = [join(cwd, 'assets'), join(cwd, 'src'), cwd];
  const videoResult = convertVideos(videoDirs);
  if (videoResult.noFFmpeg && videoResult.converted === 0) {
    // Only warn if there were actually video files to convert
    // (we don't know without scanning, but ffmpeg missing is worth noting)
  }
  if (videoResult.converted > 0) {
    console.log(`  [video] Converted ${videoResult.converted} video file${videoResult.converted !== 1 ? 's' : ''} to .ogv`);
  }

  // Copy any .ogv video files from project into staging
  function copyVideoAssets(srcDir, destDir) {
    if (!existsSync(srcDir)) return;
    let entries;
    try { entries = readdirSync(srcDir); } catch { return; }
    for (const entry of entries) {
      if (extname(entry).toLowerCase() === '.ogv') {
        const srcFile = join(srcDir, entry);
        mkdirSync(destDir, { recursive: true });
        cpSync(srcFile, join(destDir, entry));
      }
    }
  }
  copyVideoAssets(join(cwd, 'assets'), join(stagingDir, 'assets'));
  copyVideoAssets(cwd, stagingDir);

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

  // Bundle libmpv if available (optional — video playback)
  const libmpv = findLibMpv(cwd);
  if (libmpv) {
    cpSync(libmpv, join(payloadDir, 'lib', 'libmpv.so.2'));
    // Bundle libmpv's transitive deps (ffmpeg libs, etc.)
    try {
      const mpvLdd = execSync(`ldd "${libmpv}"`, { encoding: 'utf-8' });
      for (const line of mpvLdd.split('\n')) {
        if (line.includes('linux-vdso')) continue;
        const match = line.match(/^\s*(\S+)\s+=>\s+(\S+)/);
        if (match) {
          const [, soname, path] = match;
          const dest = join(payloadDir, 'lib', soname);
          if (!existsSync(dest)) {
            try {
              const real = execSync(`readlink -f "${path}"`, { encoding: 'utf-8' }).trim();
              cpSync(real, dest);
            } catch { /* skip unresolvable */ }
          }
        }
      }
    } catch { /* ldd failed — still have the .so itself */ }
    console.log('  Bundled libmpv + dependencies');
  }

  // Bundle tor binary if available (optional — .onion hosting)
  const torBin = findTorBinary(cwd);
  if (torBin) {
    mkdirSync(join(payloadDir, 'bin'), { recursive: true });
    cpSync(torBin, join(payloadDir, 'bin', 'tor'));
    execSync(`chmod +x "${join(payloadDir, 'bin', 'tor')}"`);
    // Bundle tor's transitive deps
    try {
      const torLdd = execSync(`ldd "${torBin}"`, { encoding: 'utf-8' });
      for (const line of torLdd.split('\n')) {
        if (line.includes('linux-vdso')) continue;
        const match = line.match(/^\s*(\S+)\s+=>\s+(\S+)/);
        if (match) {
          const [, soname, path] = match;
          const dest = join(payloadDir, 'lib', soname);
          if (!existsSync(dest)) {
            try {
              const real = execSync(`readlink -f "${path}"`, { encoding: 'utf-8' }).trim();
              cpSync(real, dest);
            } catch { /* skip unresolvable */ }
          }
        }
      }
    } catch { /* ldd failed — still have the binary itself */ }
    console.log('  Bundled tor + dependencies');
  }

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
