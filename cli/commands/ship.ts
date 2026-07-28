// cli/commands/ship.ts - build a cart into a shippable binary.

import { loadManifest, manifestField } from '../cart/manifest.ts';
import { bundleCart } from '../cart/bundle.ts';
import { fsExists, fsMkdir, fsRead, fsWrite, tryFsRead } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawnSync } from '../host/process.ts';
import { trimZigCacheIfOversized } from '../host/zigcache.ts';

type Substrate = 'gui' | 'tui';

interface ShipArgs {
  name: string;
  fat: boolean;
  substrateFlag: Substrate | null;
}

interface CartPaths {
  entry: string;
  dir: string;
  manifest: string;
}

export async function run(argv: string[]): Promise<number> {
  const parsed = parseShipArgs(argv);
  if (typeof parsed === 'number') return parsed;

  const root = __cwd();
  const rjitHome = __env('RJIT_HOME') || root;
  const cartRoot = root;
  const zig = resolveZig(rjitHome);
  const cart = resolveCart(cartRoot, parsed.name);
  if (!cart) return fail(`not found: ${cartRoot}/cart/${parsed.name}/index.tsx or ${cartRoot}/cart/${parsed.name}.tsx`, 1);
  const substrate = resolveSubstrate(parsed.substrateFlag, cart.manifest);

  const bundleOut = `${cartRoot}/bundle-${parsed.name}.js`;
  const embedBundle = cartRoot === rjitHome ? bundleOut : `${rjitHome}/bundles/bundle-${parsed.name}.js`;

  const icon = resolveIcon(cartRoot, cart, parsed.name);
  if (icon) out(`[ship] app icon: ${icon}`);

  runFixReactImports(rjitHome, cartRoot);
  const restoreGeometrySeed = bakeGeometryForCart(rjitHome, parsed.name, cart);
  if (!restoreGeometrySeed) return 1;

  out(`[ship] bundling ${cart.entry} -> ${bundleOut}...`);
  const bundle = bundleCart({
    rjitHome,
    cartEntry: cart.entry,
    outFile: bundleOut,
    mode: substrate === 'tui' ? 'tui-host' : 'gpu-host',
  });
  writeSpawnOutput(bundle);
  restoreGeometrySeed();
  if (bundle.code !== 0) return bundle.code || 1;

  if (embedBundle !== bundleOut) {
    fsMkdir(dirname(embedBundle));
    const copy = spawnSync('cp', ['-f', bundleOut, embedBundle]);
    writeSpawnOutput(copy);
    if (copy.code !== 0) return copy.code || 1;
  }

  const customChromeFlag = customChromeFlagFor(cart.manifest, bundleOut);
  const zigFlags = resolveZigFlags(rjitHome, `${bundleOut}.metafile.json`);
  const sysrootFlags = resolveSysrootFlags(rjitHome);
  const substrateFlags = substrate === 'tui' ? ['-Dhas-gpu=false'] : [];
  const flags = [
    'build',
    'app',
    '-p',
    `${cartRoot}/zig-out`,
    `-Dapp-name=${parsed.name}`,
    '-Dapp-source=framework/v8_app.zig',
    `-Dbundle-path=${embedBundle}`,
    '-Duse-v8=true',
    ...customChromeFlag,
    ...substrateFlags,
    '-Doptimize=ReleaseFast',
    ...sysrootFlags,
    ...zigFlags.filter((flag) => flag !== '-Duse-v8=true'),
  ];

  out('[ship] compiling native binary...');
  out(`[ship]   zig flags: ${flags.slice(2).join(' ')}`);
  const build = runLockedBuild(rjitHome, buildCommand(rjitHome, cartRoot, zig, flags));
  writeSpawnOutput(build);
  if (build.code !== 0) return build.code || 1;
  // Every build lands a fresh multi-hundred-MB .zig-cache/o entry and zig
  // never evicts (756GB / full disk on 2026-07-03) — drop the WHOLE cache
  // once it outgrows the budget (partial pruning is unsound, see
  // cli/host/zigcache.ts). RJIT_CACHE_MAX_GB=0 disables.
  trimZigCacheIfOversized(rjitHome);

  const buildBin = `${cartRoot}/zig-out/bin/${parsed.name}`;
  if (!fsExists(buildBin)) return fail(`build produced no binary: ${buildBin}`, 1);
  if (!verifyIngredientLabels(cartRoot, buildBin, flags)) return 1;

  if (__env('SHIP_RUN_PACKAGE') === '0') {
    out(`[ship] done (packaging skipped) -> ${buildBin}`);
    return 0;
  }

  const os = spawnSync('uname', ['-s']).stdout.trim();
  if (os === 'Darwin') {
    return packageMacos({ name: parsed.name, buildBin, cartRoot, icon });
  }
  if (os !== 'Linux') {
    out(`[ship] packaging not implemented for this OS - leaving build output at ${buildBin}`);
    return 0;
  }

  return packageLinux({ name: parsed.name, buildBin, rjitHome, cartRoot, fat: parsed.fat, bundleOut, icon, buildFlags: flags });
}

function parseShipArgs(argv: string[]): ShipArgs | number {
  let name = '';
  let fat = false;
  let substrateFlag: Substrate | null = null;
  for (const arg of argv) {
    if (arg === '--fat') {
      fat = true;
    } else if (arg === '--tui' || arg === '--headless') {
      substrateFlag = 'tui';
    } else if (arg === '--gui') {
      substrateFlag = 'gui';
    } else if (arg.startsWith('--')) {
      err(`[ship] unknown flag: ${arg}`);
      err('Usage: scripts/ship <cart-name> [--fat] [--gui|--tui]');
      return 1;
    } else if (name) {
      err(`[ship] unexpected positional arg: ${arg}`);
      err('Usage: scripts/ship <cart-name> [--fat] [--gui|--tui]');
      return 1;
    } else {
      name = arg;
    }
  }
  if (!name) {
    err('Usage: scripts/ship <cart-name> [--fat] [--gui|--tui]');
    err(`  Cart expected at: ${__cwd()}/cart/<cart-name>.tsx`);
    err('  --fat: bundle every .so in deps/sysroot/usr/lib/ (Whonix-class hosts');
    err('         with stripped-out runtime libs); default skips the catch-all.');
    return 1;
  }
  return { name, fat, substrateFlag };
}

function resolveCart(cartRoot: string, name: string): CartPaths | null {
  const dirEntry = `${cartRoot}/cart/${name}/index.tsx`;
  if (fsExists(dirEntry)) return { entry: dirEntry, dir: dirname(dirEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
  const fileEntry = `${cartRoot}/cart/${name}.tsx`;
  if (fsExists(fileEntry)) return { entry: fileEntry, dir: dirname(fileEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
  return null;
}

function resolveZig(rjitHome: string): string {
  const bundled = __env('REACTJIT_ZIG') || `${rjitHome}/tools/zig/zig`;
  if (fsExists(bundled)) return bundled;
  return 'zig';
}

function runFixReactImports(rjitHome: string, cartRoot: string): void {
  const script = `${rjitHome}/scripts/fix-react-imports`;
  if (!fsExists(script)) return;
  const result = spawnSync('env', [`RJIT_HOME=${rjitHome}`, `CART_ROOT=${cartRoot}`, script]);
  writeSpawnOutput(result);
  if (result.code !== 0) throw new Error(`fix-react-imports exited ${result.code}`);
}

function bakeGeometryForCart(rjitHome: string, name: string, cart: CartPaths): (() => void) | null {
  const manifestPath = `/tmp/reactjit-${sanitizeName(name)}-geometry-bake.json`;
  const seedPath = `${rjitHome}/runtime/geometries/_baked.generated.ts`;
  const previousSeed = tryFsRead(seedPath);

  out('[ship] baking static Scene3D geometry...');
  const scan = spawnSync(`${rjitHome}/tools/rjit`, ['bake-geometry-auto', cart.entry, '--out', manifestPath]);
  writeSpawnOutput(scan);
  if (scan.code !== 0) return null;

  const bake = spawnSync(`${rjitHome}/tools/rjit`, ['bake-geometry', '--manifest', manifestPath, '--out', seedPath]);
  writeSpawnOutput(bake);
  if (bake.code !== 0) return null;

  return () => {
    if (previousSeed !== null) {
      fsWrite(seedPath, previousSeed);
    } else {
      spawnSync('rm', ['-f', seedPath]);
    }
  };
}

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function resolveSubstrate(flag: Substrate | null, manifestPath: string): Substrate {
  if (flag) return flag;
  if (fsExists(manifestPath)) {
    const surface = loadManifest(manifestPath).surface;
    if (surface === 'tui' || surface === 'gui') return surface;
  }
  return 'gui';
}

function resolveIcon(cartRoot: string, cart: CartPaths, name: string): string | null {
  const declared = iconDeclared(cart.manifest);
  if (declared) {
    const resolved = resolveIconPath(cartRoot, cart.dir, declared);
    if (!resolved) throw new Error(`cart manifest icon not found: ${declared}`);
    return resolved;
  }
  for (const candidate of [
    `${cartRoot}/cart/${name}/icon.icns`,
    `${cartRoot}/cart/${name}/icon.png`,
    `${cartRoot}/cart/${name}/icon.svg`,
    `${cartRoot}/cart/${name}/icon.ico`,
    `${cartRoot}/cart/${name}.icns`,
    `${cartRoot}/cart/${name}.png`,
    `${cartRoot}/cart/${name}.svg`,
    `${cartRoot}/cart/${name}.ico`,
  ]) {
    if (fsExists(candidate)) return candidate;
  }
  return null;
}

function iconDeclared(manifestPath: string): string {
  if (!fsExists(manifestPath)) return '';
  const manifest = loadManifest(manifestPath);
  const os = spawnSync('uname', ['-s']).stdout.trim();
  const preferred = os === 'Darwin' ? manifestField(manifest, 'icons.macos') : os === 'Linux' ? manifestField(manifest, 'icons.linux') : undefined;
  const fallback = preferred ?? manifestField(manifest, 'icons.default') ?? manifestField(manifest, 'icon');
  return typeof fallback === 'string' ? fallback : '';
}

function resolveIconPath(cartRoot: string, cartDir: string, value: string): string | null {
  const candidates = value.startsWith('/') ? [value] : [`${cartDir}/${value}`, `${cartRoot}/${value}`];
  for (const candidate of candidates) {
    if (fsExists(candidate)) return candidate;
  }
  return null;
}

function customChromeFlagFor(manifestPath: string, bundlePath: string): string[] {
  const manifest = tryFsRead(manifestPath);
  if (!manifest || !/"customChrome"\s*:\s*true/.test(manifest)) return [];
  const bundle = tryFsRead(bundlePath) ?? '';
  if (bundle.includes('windowDrag')) {
    out('[ship] cart manifest: customChrome=true (windowDrag detected -> borderless)');
    return ['-Dcustom-chrome=true'];
  }
  out('[ship] cart manifest: customChrome=true ignored - no windowDrag in bundle');
  out('[ship]   (cart has no draggable chrome bar; falling back to OS chrome so user can move/close the window)');
  return [];
}

function resolveZigFlags(rjitHome: string, metafilePath: string): string[] {
  if (!fsExists(metafilePath)) {
    err(`[ship] WARNING: no metafile at ${metafilePath} - all opt-in V8 bindings disabled`);
    return [];
  }
  const result = spawnSync(`${rjitHome}/tools/rjit`, ['metafile-gate', '--metafile', metafilePath, '--format', 'zig-flags']);
  if (result.stderr) __writeStderr(result.stderr);
  if (result.code !== 0) throw new Error('metafile-gate failed');
  const flags = result.stdout.trim() ? result.stdout.trim().split(/\s+/) : [];
  const gate = spawnSync(`${rjitHome}/tools/rjit`, ['metafile-gate', '--metafile', metafilePath, '--format', 'ship-gate']);
  const names = ['privacy', 'useHost', 'useConnection', 'fs', 'websocket', 'telemetry', 'zigcall', 'sdk', 'voice', 'audio_input', 'whisper', 'paintable', 'onnx', 'pg', 'embed', 'sqlite', 'terminal', 'process', 'window', 'doom'];
  const values = gate.stdout.trim().split(/\s+/);
  const enabled = new Set(names.filter((_, i) => values[i] === '1'));
  // sqlite no longer piggybacks has-telemetry: __sql_* is its own ingredient
  // (v8_bindings_sqlite.zig, STOREDB-0606) and the registry's buildOptions
  // emit -Dhas-sqlite=true through the zig-flags format above.
  if (enabled.has('embed') && !flags.includes('-Dhas-pg=true')) flags.push('-Dhas-pg=true');
  return flags;
}

function resolveSysrootFlags(rjitHome: string): string[] {
  const sysroot = `${rjitHome}/deps/sysroot`;
  if (!fsExists(`${sysroot}/usr/include`)) return [];
  ensureSystemDevSymlink(rjitHome, 'X11');
  return [`-Dsysroot=${sysroot}`];
}

function ensureSystemDevSymlink(rjitHome: string, name: string): void {
  const sysrootLib = `${rjitHome}/deps/sysroot/usr/lib`;
  const link = `${sysrootLib}/lib${name}.so`;
  if (fsExists(link)) return;
  const ldconfig = spawnSync('sh', ['-c', `ldconfig -p 2>/dev/null | awk '$1 ~ /^lib${name}\\\\.so/ {print $NF; exit}'`]);
  const target = ldconfig.stdout.trim();
  if (!target || !fsExists(target)) return;
  const result = spawnSync('ln', ['-sfn', target, link]);
  writeSpawnOutput(result);
  if (result.code === 0) out(`[ship] sysroot: linked lib${name}.so -> ${target}`);
}

function buildCommand(rjitHome: string, cartRoot: string, zig: string, flags: string[]): string[] {
  if (cartRoot === rjitHome) return [zig, ...flags];
  return ['env', `ZIG_GLOBAL_CACHE_DIR=${rjitHome}/tools/zig/cache`, zig, ...flags];
}

function runLockedBuild(rjitHome: string, command: string[]): { code: number; stdout: string; stderr: string } {
  const lockFile = `${rjitHome}/.zig-cache/.ship.lock`;
  fsMkdir(dirname(lockFile));
  const first = spawnSync('flock', ['-n', '-E', '75', lockFile, ...command]);
  if (first.code !== 75) return first;
  out('[ship] another build in progress - waiting for lock...');
  const second = spawnSync('flock', [lockFile, ...command]);
  if (second.code === 0) out('[ship] got lock, proceeding');
  return second;
}

function verifyIngredientLabels(cartRoot: string, buildBin: string, flags: string[]): boolean {
  const labelDir = `${cartRoot}/zig-out/manifest/v8-ingredients`;
  const expected: Record<string, boolean> = {
    privacy: hasBuildFlag(flags, 'has-privacy'),
    process: hasBuildFlag(flags, 'has-process'),
    httpsrv: hasBuildFlag(flags, 'has-httpsrv'),
    wssrv: hasBuildFlag(flags, 'has-wssrv'),
    net: hasBuildFlag(flags, 'has-net'),
    tor: hasBuildFlag(flags, 'has-tor'),
    fs: hasBuildFlag(flags, 'has-fs'),
    websocket: hasBuildFlag(flags, 'has-websocket'),
    telemetry: hasBuildFlag(flags, 'has-telemetry'),
    sqlite: hasBuildFlag(flags, 'has-sqlite'),
    zigcall: hasBuildFlag(flags, 'has-zigcall'),
    sdk: hasBuildFlag(flags, 'has-sdk'),
    voice: hasBuildFlag(flags, 'has-voice'),
    audio_input: hasBuildFlag(flags, 'has-audio-input'),
    paintable: hasBuildFlag(flags, 'has-paintable'),
    pg: hasBuildFlag(flags, 'has-pg') || hasBuildFlag(flags, 'has-embed'),
    embed: hasBuildFlag(flags, 'has-embed'),
    whisper: hasBuildFlag(flags, 'has-whisper'),
    onnx: hasBuildFlag(flags, 'has-onnx'),
    audio: hasBuildFlag(flags, 'has-audio'),
    midi: hasBuildFlag(flags, 'has-midi'),
    deej: hasBuildFlag(flags, 'has-deej'),
    vterm: hasBuildFlag(flags, 'has-terminal'),
    doom: hasBuildFlag(flags, 'has-doom'),
    pathing: hasBuildFlag(flags, 'has-pathing'),
    compiled_world: hasBuildFlag(flags, 'has-compiled-world'),
    imageops: hasBuildFlag(flags, 'has-imageops'),
  };

  let mismatch = false;
  for (const [name, want] of Object.entries(expected)) {
    const flagFile = `${labelDir}/${name}.flag`;
    if (!fsExists(flagFile)) {
      err(`[ship] LABEL MISSING: ${flagFile} (expected ${want ? '1' : '0'})`);
      mismatch = true;
      continue;
    }
    const actual = fsRead(flagFile).trim();
    const expectedText = want ? '1' : '0';
    if (actual !== expectedText) {
      err(`[ship] LABEL MISMATCH: ${name} - cart asked for '${expectedText}' but binary built '${actual}'`);
      mismatch = true;
    }
  }
  if (!mismatch) return true;
  err('[ship] DESTROYING binary - manifest disagrees with cart declaration');
  spawnSync('rm', ['-f', buildBin]);
  return false;
}

function hasBuildFlag(flags: string[], name: string): boolean {
  return flags.includes(`-D${name}=true`);
}

function packageLinux(opts: { name: string; buildBin: string; rjitHome: string; cartRoot: string; fat: boolean; bundleOut: string; icon: string | null; buildFlags: string[] }): number {
  out('[ship] packaging self-extracting binary...');
  const tmpDir = `/tmp/reactjit-dist-${opts.name}`;
  const libDir = `${tmpDir}/lib`;
  const tarball = `/tmp/reactjit-${opts.name}-payload.tar.gz`;
  runOrThrow('rm', ['-rf', tmpDir, tarball]);
  fsMkdir(libDir);
  runOrThrow('cp', [opts.buildBin, `${tmpDir}/app.bin`]);

  bundleLocalAiWorker(opts.rjitHome, tmpDir, libDir, opts.buildFlags);
  bundleLibMpv(opts.rjitHome, libDir, opts.bundleOut);
  const libCount = bundleLinkedLibs(opts.buildBin, libDir, opts.rjitHome, opts.fat);
  bundlePostgres(opts.rjitHome, tmpDir);
  if (opts.icon) writeDesktopFiles(tmpDir, opts.name, opts.icon);
  writeLauncher(`${tmpDir}/run`);
  runOrThrow('tar', ['czf', tarball, '-C', tmpDir, '.']);
  writeSelfExtractor(opts.buildBin, tarball, opts.name, opts.icon ? `${opts.name}.${extension(opts.icon)}` : '');
  const size = spawnSync('du', ['-m', opts.buildBin]).stdout.trim().split(/\s+/)[0] || '?';
  out(`[ship] done (${size}MB self-extracting, ${libCount} libs bundled) -> ${opts.buildBin}`);
  runOrThrow('rm', ['-rf', tmpDir, tarball]);
  return 0;
}

function packageMacos(opts: { name: string; buildBin: string; cartRoot: string; icon: string | null }): number {
  out('[ship] packaging macOS .app bundle...');
  const appBundle = `${opts.cartRoot}/zig-out/bin/${opts.name}.app`;
  const contents = `${appBundle}/Contents`;
  const macosDir = `${contents}/MacOS`;
  const fwDir = `${contents}/Frameworks`;
  const resDir = `${contents}/Resources`;
  runOrThrow('rm', ['-rf', appBundle]);
  fsMkdir(macosDir);
  fsMkdir(fwDir);
  fsMkdir(resDir);
  runOrThrow('cp', [opts.buildBin, `${macosDir}/${opts.name}`]);

  let iconPlist = '';
  if (opts.icon) {
    const iconFile = `${opts.name}.${extension(opts.icon)}`;
    runOrThrow('cp', [opts.icon, `${resDir}/${iconFile}`]);
    if (extension(opts.icon) === 'icns') {
      iconPlist = `    <key>CFBundleIconFile</key>\n    <string>${iconFile}</string>`;
    } else {
      err(`[ship] macOS icon copied to Resources/${iconFile}; Finder icon requires .icns`);
    }
  }

  fsWrite(`${contents}/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${opts.name}</string>
    <key>CFBundleIdentifier</key>
    <string>com.reactjit.${opts.name}</string>
    <key>CFBundleName</key>
    <string>${opts.name}</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
${iconPlist}
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
</dict>
</plist>
`);

  runOrThrow('sh', ['-c', `
set -e
collect_dylibs() {
  for bin in "$@"; do
    otool -L "$bin" 2>/dev/null | tail -n +2 | awk '{print $1}' | while read -r lib_path; do
      case "$lib_path" in /usr/lib/*|/System/*|@rpath/*|@executable_path/*) continue ;; esac
      [ -f "$lib_path" ] || continue
      lib_name=$(basename "$lib_path")
      [ -f "${fwDir}/$lib_name" ] && continue
      cp "$lib_path" "${fwDir}/$lib_name"
    done
  done
}
rewrite_dylib_paths() {
  bin="$1"
  otool -L "$bin" 2>/dev/null | tail -n +2 | awk '{print $1}' | while read -r lib_path; do
    case "$lib_path" in /usr/lib/*|/System/*|@rpath/*|@executable_path/*) continue ;; esac
    lib_name=$(basename "$lib_path")
    install_name_tool -change "$lib_path" "@executable_path/../Frameworks/$lib_name" "$bin" 2>/dev/null || true
  done
}
collect_dylibs "${macosDir}/${opts.name}"
collect_dylibs "${fwDir}"/*.dylib >/dev/null 2>/dev/null || true
rewrite_dylib_paths "${macosDir}/${opts.name}"
install_name_tool -add_rpath "@executable_path/../Frameworks" "${macosDir}/${opts.name}" 2>/dev/null || true
for dylib in "${fwDir}"/*.dylib; do
  [ -f "$dylib" ] || continue
  lib_name=$(basename "$dylib")
  install_name_tool -id "@executable_path/../Frameworks/$lib_name" "$dylib" 2>/dev/null || true
  rewrite_dylib_paths "$dylib"
done
codesign --force --sign - --deep "${appBundle}" 2>/dev/null || true
`]);
  const libCount = spawnSync('sh', ['-c', `find "${fwDir}" -name '*.dylib' 2>/dev/null | wc -l | tr -d ' '`]).stdout.trim() || '0';
  const size = spawnSync('du', ['-sm', appBundle]).stdout.trim().split(/\s+/)[0] || '?';
  out(`[ship] done (${size}MB .app bundle, ${libCount} dylibs) -> ${appBundle}`);
  return 0;
}

function bundleLocalAiWorker(rjitHome: string, tmpDir: string, libDir: string, buildFlags: string[]): void {
  if (!hasBuildFlag(buildFlags, 'has-embed')) return;
  const worker = `${rjitHome}/zig-out/bin/rjit-llm-worker`;
  const libSource = `${rjitHome}/deps/llama.cpp-fresh/build/bin`;
  if (!fsExists(worker) || !fsExists(libSource)) {
    err(`[ship]   WARNING: has-embed needs ${worker} + ${libSource} - skipping local-runtime bundle`);
    return;
  }
  runOrThrow('cp', [worker, `${tmpDir}/rjit-llm-worker`]);
  runOrThrow('chmod', ['+x', `${tmpDir}/rjit-llm-worker`]);
  runOrThrow('sh', ['-c', `
set -e
for so_pattern in libllama libggml libggml-base libggml-cpu libggml-vulkan; do
  for f in "${libSource}/$so_pattern.so"*; do
    [ -e "$f" ] || continue
    soname=$(basename "$f")
    real=$(readlink -f "$f")
    cp "$real" "${libDir}/$soname"
  done
done
`]);
  out('[ship]   bundled rjit-llm-worker + libllama.so + ggml-vulkan backend');
}

function bundleLibMpv(rjitHome: string, libDir: string, bundleOut: string): void {
  const bundle = tryFsRead(bundleOut) ?? '';
  if (!/__jsxs?\(Video,/.test(bundle)) return;
  const src = `${rjitHome}/love2d/storybook/lib/libmpv.so.2`;
  if (fsExists(src)) {
    runOrThrow('cp', ['-L', src, `${libDir}/libmpv.so.2`]);
    out('[ship]   bundled libmpv.so.2 (video cart - Video primitive detected)');
    return;
  }
  err(`[ship]   WARNING: cart uses Video but pinned libmpv.so.2 not found at ${src}`);
  err('[ship]            video playback will fall back to user system libmpv if installed, else no-op');
}

function bundlePostgres(rjitHome: string, tmpDir: string): void {
  const pg = `${rjitHome}/.pg-bundle`;
  if (!fsExists(pg)) return;
  runOrThrow('cp', ['-RL', pg, `${tmpDir}/pg`]);
  const size = spawnSync('du', ['-sh', `${tmpDir}/pg`]).stdout.trim().split(/\s+/)[0] || '?';
  out(`[ship]   bundled postgres (${size}) - extract dir -> pg/bin/postgres`);
}

function bundleLinkedLibs(buildBin: string, libDir: string, rjitHome: string, fat: boolean): number {
  const prefixes = ['libSDL3', 'libfreetype', 'libsodium', 'libsqlite3', 'libwhisper', 'libllama_ffi', 'libmpv', 'libbox2d', 'libvterm', 'libluajit', 'libllama', 'libggml'];
  const sysrootLib = `${rjitHome}/deps/sysroot/usr/lib`;
  const ldd = spawnSync('ldd', [buildBin]);
  let count = 0;
  for (const line of ldd.stdout.split('\n')) {
    if (!line.trim() || line.includes('linux-vdso')) continue;
    const soname = line.trim().replace(/\s*=>.*$/, '');
    if (!prefixes.some((prefix) => soname === `${prefix}.so` || soname.startsWith(`${prefix}.so.`))) continue;
    const sysroot = `${sysrootLib}/${soname}`;
    const path = fsExists(sysroot) ? sysroot : (line.match(/=>\s+([^ ]+)/)?.[1] ?? '');
    if (!path || !fsExists(path) || fsExists(`${libDir}/${soname}`)) continue;
    runOrThrow('cp', ['-L', path, `${libDir}/${soname}`]);
    count++;
  }
  if (fat && fsExists(sysrootLib)) {
    runOrThrow('sh', ['-c', `cp -a "${sysrootLib}"/*.so* "${libDir}"/ 2>/dev/null || true`]);
  }
  out(`[ship]   bundled ${count} SDK-owned lib(s)`);
  return count;
}

function writeDesktopFiles(tmpDir: string, name: string, icon: string): void {
  const iconFile = `${name}.${extension(icon)}`;
  fsMkdir(`${tmpDir}/share/icons`);
  fsMkdir(`${tmpDir}/share/applications`);
  runOrThrow('cp', [icon, `${tmpDir}/share/icons/${iconFile}`]);
  fsWrite(`${tmpDir}/share/applications/${name}.desktop.in`, `[Desktop Entry]
Type=Application
Name=${name}
Exec=@EXEC@
Icon=@ICON@
Terminal=false
Categories=Development;
`);
}

function writeLauncher(path: string): void {
  fsWrite(path, `#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="$DIR/lib\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$DIR/app.bin" "$@"
`);
  runOrThrow('chmod', ['+x', path]);
}

function writeSelfExtractor(buildBin: string, tarball: string, name: string, iconFile: string): void {
  const staged = `${buildBin}.staged`;
  const header = `#!/bin/sh
set -e
APP_DIR=\${XDG_CACHE_HOME:-$HOME/.cache}/reactjit-${name}
SIG=$(md5sum "$0" 2>/dev/null | cut -c1-8 || cksum "$0" | cut -d" " -f1)
CACHE="$APP_DIR/$SIG"
ICON_FILE="${iconFile}"
if [ ! -f "$CACHE/.ready" ]; then
  rm -rf "$APP_DIR"
  mkdir -p "$CACHE"
  SKIP=$(awk '/^__ARCHIVE__$/{print NR + 1; exit}' "$0")
  tail -n+"$SKIP" "$0" | tar xz -C "$CACHE"
  if [ -n "$ICON_FILE" ] && [ -f "$CACHE/share/applications/${name}.desktop.in" ]; then
    sed "s|@EXEC@|$CACHE/run|g; s|@ICON@|$CACHE/share/icons/$ICON_FILE|g" "$CACHE/share/applications/${name}.desktop.in" > "$CACHE/share/applications/${name}.desktop"
  fi
  touch "$CACHE/.ready"
fi
exec "$CACHE/run" "$@"
__ARCHIVE__
`;
  fsWrite(staged, header);
  runOrThrow('sh', ['-c', `cat "${tarball}" >> "${staged}" && chmod +x "${staged}" && mv -f "${staged}" "${buildBin}"`]);
}

function runOrThrow(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args);
  writeSpawnOutput(result);
  if (result.code !== 0) throw new Error(`${cmd} exited ${result.code}`);
}

function writeSpawnOutput(result: { stdout: string; stderr: string }): void {
  if (result.stderr) __writeStderr(result.stderr);
  if (result.stdout) __writeStdout(result.stdout);
}

function fail(message: string, code: number): number {
  err(`[ship] ${message}`);
  return code;
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

function extension(path: string): string {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index + 1).toLowerCase();
}
