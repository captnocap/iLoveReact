// cli/commands/dev.ts - persistent dev host with hot bundle push.

import { bundleCart, BundleMode } from '../cart/bundle.ts';
import { loadManifest } from '../cart/manifest.ts';
import { bakeIconAtlas } from './bake-icons.ts';
import { fsExists, fsMkdir, fsRead, fsRemove, fsWrite, tryFsRead } from '../host/fs.ts';
import { err, out } from '../host/log.ts';
import { spawn, spawnSync } from '../host/process.ts';
import { trimZigCacheIfOversized } from '../host/zigcache.ts';
import {
  DEV_SOCKET_PATH,
  readDevHostInfo,
  requestDevCheckpoint,
  requestNativeReload,
  saveDevHotState,
  sendNativeUpdateReadyNotice,
  sendOrphanHostsNotice,
  sendNativeUpdateResultNotice,
  sendOrphanCleanupResultNotice,
  sendRebuildNotice,
  shortHash,
  writeDevBuildInfo,
} from '../dev/rebuild-signal.ts';
import {
  fingerprintNativeTiers,
  moduleRecordIsCurrent,
  publishStagedModule,
  readCoreRecord,
  readModuleRecord,
  readSessionManifest,
  rememberSessionTab,
  sha256File,
  tierCacheDir,
  updateSessionModules,
  useIncrementalCompilation,
  writeCoreRecord,
  writeModuleRecord,
  writeSessionManifest,
  type DevSessionManifest,
  type HotNativeTier,
  type ModuleArtifactRecord,
  type NativeFingerprints,
  type TierFingerprint,
} from '../dev/native-modules.ts';
import {
  changedNativeTiers,
  nativeApprovalPath,
  nativeUpdateToken,
  parseNativeUpdateApproval,
  sameNativeFingerprints,
  type PendingNativeUpdate,
} from '../dev/native-approval.ts';

type Substrate = 'gui' | 'tui';

interface DevArgs {
  name: string;
  substrateFlag: Substrate | null;
}

interface CartPaths {
  entry: string;
  dir: string;
  manifest: string;
}

interface DevSupervisorState {
  rjitHome: string;
  cartRoot: string;
  cartDir: string;
  bin: string;
  binName: string;
  substrate: Substrate;
  devFlags: string[];
  profileSalt: { core: string; hot: string };
  hostId: number;
  watcherId: number;
  /** Latest source hashes observed by the compiler watcher. */
  fingerprints: NativeFingerprints;
  /** Hashes actually resident in the running native host. */
  activeFingerprints: NativeFingerprints;
  scene3d: ModuleArtifactRecord;
  game: ModuleArtifactRecord;
  pendingNative: PendingNativeUpdate | null;
  approvalPath: string;
  orphanApprovalPath: string;
  nextOrphanScanMs: number;
}

export async function run(argv: string[]): Promise<number> {
  const parsed = parseDevArgs(argv);
  if (typeof parsed === 'number') return parsed;

  const cartRoot = __cwd();
  const rjitHome = __env('RJIT_HOME') || cartRoot;
  const cart = resolveCart(cartRoot, parsed.name);
  if (!cart) return fail(`[dev] not found: ${cartRoot}/cart/${parsed.name}/index.tsx or ${cartRoot}/cart/${parsed.name}.tsx`, 1);

  const substrate = resolveSubstrate(parsed.substrateFlag, cart.manifest);
  const bundleMode: BundleMode = substrate === 'tui' ? 'tui-host' : 'gpu-host';
  const perCartBundle = `${cartRoot}/.cache/bundle-${parsed.name}.js`;
  const binName = substrate === 'tui' ? 'reactjit-dev-tui' : 'reactjit-dev';
  const bin = `${rjitHome}/zig-out/bin/${binName}`;
  fsMkdir(`${cartRoot}/.cache`);

  runFixReactImports(rjitHome, cartRoot);
  const bakedIcons = bakeIconAtlas({ root: rjitHome, ifNeeded: true, quiet: true });
  if (bakedIcons !== 0) return bakedIcons;

  out(`[dev] bundling ${cart.entry} -> ${perCartBundle}`);
  const term = terminalSize();
  const bundle = bundleCart({
    rjitHome,
    cartEntry: cart.entry,
    outFile: perCartBundle,
    mode: bundleMode,
    termCols: term.cols,
    termRows: term.rows,
  });
  writeSpawnOutput(bundle);
  if (bundle.code !== 0) return bundle.code || 1;

  const devFlags = resolveDevFlags(rjitHome);
  if (!devFlags) return 1;
  const profileSalt = nativeProfileSalt(substrate, devFlags);
  const fingerprints = fingerprintNativeTiers(rjitHome, profileSalt);
  const socket = DEV_SOCKET_PATH;
  const hostAlive = isHostAlive(socket);
  if (hostAlive) {
    const hostInfo = readDevHostInfo(socket);
    const activeCoreId = readCoreRecord(rjitHome)?.sourceHash ?? null;
    if (!hostInfo || (hostInfo.build_id !== fingerprints.core.hash && hostInfo.build_id !== activeCoreId)) {
      const stale = { current: fingerprints.core, host: hostInfo ?? { build_id: 'unknown' } };
      sendRebuildNotice(stale, socket);
      err('[dev] cold core changed; its owning supervisor is rebuilding/restarting it.');
      err('[dev] refusing this push until the core build id catches up.');
      err(`[dev] running build id: ${shortHash(stale.host.build_id)}`);
      err(`[dev] disk core id:     ${shortHash(stale.current.hash)} (${stale.current.inputCount} native inputs)`);
      return 1;
    }
    if (hostInfo.build_id !== fingerprints.core.hash) {
      out('[dev-native] native sources have a compiled update pending; the running host remains authoritative until you approve it.');
    }
    out(`[dev] host detected - pushing '${parsed.name}'`);
    const push = spawnSync(`${rjitHome}/tools/rjit`, ['push-bundle', parsed.name, perCartBundle]);
    writeSpawnOutput(push);
    if (push.code === 0) {
      // Module records may point at a compiled-but-unapproved candidate. The
      // session manifest is the durable identity of what this live host owns.
      const activeSession = readSessionManifest(rjitHome);
      const scene3d = activeSession?.scene3d ?? readModuleRecord(rjitHome, 'scene3d');
      const game = activeSession?.game ?? readModuleRecord(rjitHome, 'game');
      if (scene3d && game) rememberSessionTab(rjitHome, sessionTab(parsed.name, perCartBundle), scene3d, game);
      out(`[dev] host switched to tab '${parsed.name}'`);
      return 0;
    }
    fsRemove(socket);
  }

  fsWrite(`${rjitHome}/bundle.js`, fsRead(perCartBundle));

  let scene3d = readModuleRecord(rjitHome, 'scene3d');
  let game = readModuleRecord(rjitHome, 'game');
  if (substrate === 'gui') {
    scene3d = ensureModule(rjitHome, cartRoot, 'scene3d', fingerprints.scene3d, devFlags, scene3d);
    if (!scene3d) return 1;
    game = ensureModule(rjitHome, cartRoot, 'game', fingerprints.game, devFlags, game);
    if (!game) return 1;
  }

  const coreRecord = readCoreRecord(rjitHome);
  const coreStale = !coreRecord || coreRecord.sourceHash !== fingerprints.core.hash || coreRecord.path !== bin || !fsExists(bin);
  if (coreStale && fsExists(bin)) out('[dev-native] cold core inputs changed - rebuilding core once...');
  if (coreStale) {
    const built = buildDevHost(rjitHome, cartRoot, binName, substrate, fingerprints.core, devFlags);
    if (built !== 0) return built;
    writeDevBuildInfo(bin, fingerprints.core);
    writeCoreRecord(rjitHome, fingerprints.core.hash, bin);
  }

  if (substrate === 'tui') {
    const child = spawn('env', [`RJIT_DEV_CART_DIR=${cart.dir}`, bin]);
    const watchArgs = ['watch-and-push', parsed.name, cart.entry, perCartBundle, '--rjit-home', rjitHome, '--tui'];
    const watcher = spawn(`${rjitHome}/tools/rjit`, watchArgs);
    out(`[dev] TUI host child=${child.id}`);
    drainUntilExit(child.id, watcher.id);
    return 0;
  }
  if (!scene3d || !game) return fail('[dev-native] GUI module bootstrap did not produce both module artifacts', 1);
  rememberSessionTab(rjitHome, sessionTab(parsed.name, perCartBundle), scene3d, game);

  ensurePgRunning(rjitHome);

  const inheritedHandoff = __env('RJIT_DEV_HOTSTATE_HANDOFF') || null;
  const child = spawnDevHost(bin, cart.dir, scene3d, game, inheritedHandoff);
  out(`[dev] host child=${child.id} - run 'rjit dev <other>' from another terminal to add tabs`);

  const watchArgs = ['watch-and-push', parsed.name, cart.entry, perCartBundle, '--rjit-home', rjitHome];
  watchArgs.push('--core-build-id', fingerprints.core.hash);
  if (substrate === 'tui') watchArgs.push('--tui');
  const watcher = spawn(`${rjitHome}/tools/rjit`, watchArgs);
  const approvalPath = nativeApprovalPath(rjitHome);
  if (fsExists(approvalPath)) fsRemove(approvalPath);
  const orphanApproval = orphanApprovalPath(rjitHome);
  if (fsExists(orphanApproval)) fsRemove(orphanApproval);
  superviseDevHost({
    rjitHome,
    cartRoot,
    cartDir: cart.dir,
    bin,
    binName,
    substrate,
    devFlags,
    profileSalt,
    hostId: child.id,
    watcherId: watcher.id,
    fingerprints,
    activeFingerprints: fingerprints,
    scene3d,
    game,
    pendingNative: null,
    approvalPath,
    orphanApprovalPath: orphanApproval,
    // Orphans accumulate over days, not seconds. The first scan waits a minute so a
    // host that is still coming up is never mistaken for one that was abandoned.
    nextOrphanScanMs: __nowMs() + ORPHAN_FIRST_SCAN_MS,
  });
  return 0;
}

function parseDevArgs(argv: string[]): DevArgs | number {
  let name = '';
  let substrateFlag: Substrate | null = null;
  for (const arg of argv) {
    if (arg === '--tui' || arg === '--headless') {
      substrateFlag = 'tui';
    } else if (arg === '--gui') {
      substrateFlag = 'gui';
    } else if (arg.startsWith('--')) {
      err(`[dev] unknown flag: ${arg}`);
      return usage();
    } else if (name) {
      err(`[dev] unexpected positional arg: ${arg}`);
      return usage();
    } else {
      name = arg;
    }
  }
  if (!name) return usage();
  return { name, substrateFlag };
}

function usage(): number {
  err('Usage: scripts/dev <cart-name>');
  err(`  Cart expected at: ${__cwd()}/cart/<name>/index.tsx or ${__cwd()}/cart/<name>.tsx`);
  return 1;
}

function resolveCart(cartRoot: string, name: string): CartPaths | null {
  const dirEntry = `${cartRoot}/cart/${name}/index.tsx`;
  if (fsExists(dirEntry)) return { entry: dirEntry, dir: dirname(dirEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
  const fileEntry = `${cartRoot}/cart/${name}.tsx`;
  if (fsExists(fileEntry)) return { entry: fileEntry, dir: dirname(fileEntry), manifest: `${cartRoot}/cart/${name}/cart.json` };
  return null;
}

function resolveSubstrate(flag: Substrate | null, manifestPath: string): Substrate {
  if (flag) return flag;
  if (fsExists(manifestPath)) {
    const surface = loadManifest(manifestPath).surface;
    if (surface === 'tui' || surface === 'gui') return surface;
  }
  return 'gui';
}

function runFixReactImports(rjitHome: string, cartRoot: string): void {
  const script = `${rjitHome}/scripts/fix-react-imports`;
  if (!fsExists(script)) return;
  const result = spawnSync('env', [`RJIT_HOME=${rjitHome}`, `CART_ROOT=${cartRoot}`, script]);
  writeSpawnOutput(result);
}

function isHostAlive(socket: string): boolean {
  if (!fsExists(socket)) return false;
  if (readDevHostInfo(socket)) return true;
  fsRemove(socket);
  return false;
}

function resolveDevFlags(rjitHome: string): string[] | null {
  const flagsResult = spawnSync(`${rjitHome}/tools/rjit`, ['metafile-gate', '--format', 'dev-zig-flags', '--build-zig', `${rjitHome}/build.zig`]);
  writeSpawnOutput(flagsResult);
  if (flagsResult.code !== 0) return null;
  const devFlags = flagsResult.stdout.trim().split(/\s+/).filter(Boolean);
  if (devFlags.length === 0) {
    err('[dev] FATAL: sdk-dependency-resolve produced no dev flags');
    return null;
  }
  return devFlags;
}

function nativeProfileSalt(substrate: Substrate, devFlags: string[]): { core: string; hot: string } {
  const base = ['modular-dev-v1', substrate, ...devFlags.slice().sort()].join('\n');
  return { core: `${base}\nsocket=${DEV_SOCKET_PATH}`, hot: base };
}

function buildDevHost(
  rjitHome: string,
  cartRoot: string,
  binName: string,
  substrate: Substrate,
  fingerprint: TierFingerprint,
  devFlags: string[],
  installPrefix = `${rjitHome}/zig-out`,
): number {
  out(`[dev-native] compiling cold core (${installPrefix}/bin/${binName}, ${substrate}, ReleaseFast)...`);

  const zig = resolveZig(rjitHome);
  const cacheDir = tierCacheDir(rjitHome, 'core');
  fsMkdir(cacheDir);
  const args = [
    'build',
    'app',
    '-p',
    installPrefix,
    `-Dapp-name=${binName}`,
    '-Dapp-source=framework/v8_app.zig',
    `-Dbundle-path=${rjitHome}/framework/dev_bundle_stub.js`,
    `-Ddev-bundle-path=${rjitHome}/bundle.js`,
    `-Ddev-socket-path=${DEV_SOCKET_PATH}`,
    `-Ddev-build-id=${fingerprint.hash}`,
    `-Ddev-native-modules=${substrate === 'gui' ? 'true' : 'false'}`,
    ...devFlags,
    '-Doptimize=ReleaseFast',
    '--cache-dir',
    cacheDir,
    useIncrementalCompilation() ? '-fincremental' : '-fno-incremental',
  ];
  if (substrate === 'tui') args.push('-Dhas-gpu=false');
  const cmd = cartRoot === rjitHome ? zig : 'env';
  const finalArgs = cartRoot === rjitHome ? args : [`ZIG_GLOBAL_CACHE_DIR=${rjitHome}/tools/zig/cache`, zig, ...args];
  const build = spawnSync(cmd, finalArgs);
  writeSpawnOutput(build);
  if (build.code !== 0) return build.code || 1;
  // Same disk-leak guard as ship: zig never evicts .zig-cache/o entries and
  // every dev rebuild lands a fresh one. Whole-cache drop over budget only —
  // partial pruning is unsound (cli/host/zigcache.ts). RJIT_CACHE_MAX_GB=0
  // disables.
  trimZigCacheIfOversized(rjitHome);
  return 0;
}

function buildNativeModule(
  rjitHome: string,
  cartRoot: string,
  tier: HotNativeTier,
  fingerprint: TierFingerprint,
  devFlags: string[],
): ModuleArtifactRecord | null {
  const started = __nowMs();
  out(`[dev-native] ${tier} ${shortHash(fingerprint.hash)} compiling (ReleaseFast${useIncrementalCompilation() ? ', incremental' : ''})...`);
  const zig = resolveZig(rjitHome);
  const cacheDir = tierCacheDir(rjitHome, tier);
  fsMkdir(cacheDir);
  const args = [
    'build',
    tier === 'scene3d' ? 'dev-scene3d-module' : 'dev-game-module',
    '-p',
    `${rjitHome}/zig-out`,
    '-Ddev-native-modules=true',
    tier === 'scene3d' ? '-Ddev-scene3d-module=true' : '-Ddev-game-module=true',
    ...devFlags,
    '-Doptimize=ReleaseFast',
    '--cache-dir',
    cacheDir,
    useIncrementalCompilation() ? '-fincremental' : '-fno-incremental',
  ];
  const cmd = cartRoot === rjitHome ? zig : 'env';
  const finalArgs = cartRoot === rjitHome ? args : [`ZIG_GLOBAL_CACHE_DIR=${rjitHome}/tools/zig/cache`, zig, ...args];
  const built = spawnSync(cmd, finalArgs);
  writeSpawnOutput(built);
  if (built.code !== 0) {
    err(`[dev-native] ${tier} compile failed; active module remains loaded`);
    return null;
  }
  const record = publishStagedModule(rjitHome, tier, fingerprint.hash);
  out(`[dev-native] ${tier} published ${shortHash(record.artifactHash)} in ${(__nowMs() - started).toFixed(0)}ms`);
  return record;
}

function ensureModule(
  rjitHome: string,
  cartRoot: string,
  tier: HotNativeTier,
  fingerprint: TierFingerprint,
  devFlags: string[],
  record: ModuleArtifactRecord | null,
): ModuleArtifactRecord | null {
  if (moduleRecordIsCurrent(record, fingerprint)) {
    out(`[dev-native] ${tier} ${shortHash(record.artifactHash)} cached`);
    return record;
  }
  return buildNativeModule(rjitHome, cartRoot, tier, fingerprint, devFlags);
}

function ensurePgRunning(rjitHome: string): void {
  const pg = resolvePg(rjitHome);
  if (!pg) {
    err('[dev] postgres not found - install postgresql or run scripts/stage-pg-bundle');
    return;
  }

  const datadir = `${__env('HOME') || '/tmp'}/.cache/reactjit-embed/embed-pg`;
  const sockdir = `${__env('HOME') || '/tmp'}/.cache/reactjit-embed/embed-pg-sock`;
  const status = spawnSync(pg.pgCtl, ['-D', datadir, '-s', 'status']);
  if (status.code === 0) return;

  const pidfile = `${datadir}/postmaster.pid`;
  const stalePid = tryFsRead(pidfile)?.split('\n')[0]?.trim();
  if (stalePid && spawnSync('kill', ['-0', stalePid]).code !== 0) fsRemove(pidfile);

  fsMkdir(datadir);
  fsMkdir(sockdir);
  if (!fsExists(`${datadir}/PG_VERSION`)) {
    out('[dev] initializing embedded postgres cluster (first run)...');
    const init = spawnSync('env', [`PGSHAREDIR=${pg.shareDir}`, pg.initdb, '-D', datadir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-sync']);
    writeSpawnOutput(init);
    if (init.code !== 0) return;
  }

  out('[dev] starting embedded postgres...');
  const start = spawnSync('env', [
    `PGSHAREDIR=${pg.shareDir}`,
    pg.pgCtl,
    '-D',
    datadir,
    '-l',
    `${datadir}/pg.log`,
    '-o',
    `-k ${sockdir} -c listen_addresses= -c max_connections=300`,
    '-w',
    'start',
  ]);
  writeSpawnOutput(start);
}

function resolvePg(rjitHome: string): { pgCtl: string; initdb: string; shareDir: string } | null {
  const bundled = `${rjitHome}/.pg-bundle/bin`;
  if (fsExists(`${bundled}/postgres`)) {
    return { pgCtl: `${bundled}/pg_ctl`, initdb: `${bundled}/initdb`, shareDir: `${rjitHome}/.pg-bundle/share/postgresql` };
  }
  for (const version of ['17', '16', '15', '14']) {
    const base = `/usr/lib/postgresql/${version}/bin`;
    if (fsExists(`${base}/postgres`)) return { pgCtl: `${base}/pg_ctl`, initdb: `${base}/initdb`, shareDir: `/usr/share/postgresql/${version}` };
  }
  return null;
}

function terminalSize(): { cols: number; rows: number } {
  try {
    const parsed = JSON.parse(__termSize()) as [number, number];
    return { cols: parsed[0] || 80, rows: parsed[1] || 24 };
  } catch {
    return { cols: 80, rows: 24 };
  }
}

function resolveZig(rjitHome: string): string {
  const bundled = __env('REACTJIT_ZIG') || `${rjitHome}/tools/zig/zig`;
  if (fsExists(bundled)) return bundled;
  return 'zig';
}

function spawnDevHost(
  bin: string,
  cartDir: string,
  scene3d: ModuleArtifactRecord,
  game: ModuleArtifactRecord,
  hotstateHandoff: string | null = null,
): { id: number } {
  const env = [
    `RJIT_DEV_CART_DIR=${cartDir}`,
    `RJIT_DEV_SCENE3D_PATH=${scene3d.path}`,
    `RJIT_DEV_SCENE3D_HASH=${scene3d.artifactHash}`,
    `RJIT_DEV_GAME_PATH=${game.path}`,
    `RJIT_DEV_GAME_HASH=${game.artifactHash}`,
  ];
  if (hotstateHandoff) env.push(`RJIT_DEV_HOTSTATE_HANDOFF=${hotstateHandoff}`);
  env.push(bin);
  return spawn('env', env);
}

function sessionTab(name: string, bundlePath: string): { name: string; bundlePath: string; bundleHash: string } {
  return { name, bundlePath, bundleHash: sha256File(bundlePath) };
}

function superviseDevHost(state: DevSupervisorState): void {
  let nextNativeCheck = __nowMs() + 500;
  while (true) {
    const hostLine = __childReadLine(state.hostId, 40);
    if (hostLine === '') {
      __childKill(state.watcherId);
      return;
    }
    if (hostLine !== null) __writeStdout(`${hostLine}\n`);
    const watcherLine = __childReadLine(state.watcherId, 20);
    if (watcherLine === '') {
      err('[dev] bundle watcher exited; stopping its exact host child');
      __childKill(state.hostId);
      return;
    }
    if (watcherLine !== null) __writeStdout(`${watcherLine}\n`);

    if (__nowMs() >= nextNativeCheck) {
      nextNativeCheck = __nowMs() + 500;
      try {
        const next = fingerprintNativeTiers(state.rjitHome, state.profileSalt);
        applyNativeChanges(state, next);
      } catch (error) {
        err(`[dev-native] watcher scan failed: ${(error as Error).message}`);
      }
    }
    try {
      scanForOrphanHosts(state);
      applyApprovedOrphanCleanup(state);
    } catch (error) {
      err(`[dev-orphans] scan failed without touching any process: ${(error as Error).message}`);
    }
    try {
      applyApprovedNativeUpdate(state);
    } catch (error) {
      err(`[dev-native] approval handling failed without restarting the editor: ${(error as Error).message}`);
      if (state.pendingNative) sendNativeUpdateReadyNotice(state.pendingNative, state.approvalPath);
    }
    __sleepMs(20);
  }
}

function applyNativeChanges(state: DevSupervisorState, next: NativeFingerprints): void {
  if (sameNativeFingerprints(next, state.fingerprints)) return;

  // Compile every tier whose CURRENT sources differ from the live process. A
  // prior failed save is only retried when another source edge arrives, while
  // an already-staged tier is recovered from its content-addressed record.
  let nextScene = state.scene3d;
  if (next.scene3d.hash !== state.activeFingerprints.scene3d.hash) {
    const built = ensureModule(state.rjitHome, state.cartRoot, 'scene3d', next.scene3d, state.devFlags, readModuleRecord(state.rjitHome, 'scene3d'));
    if (!built) return abandonNativeCandidate(state, next, '3D engine compile failed; the running editor was not touched');
    nextScene = built;
  }

  let nextGame = state.game;
  if (next.game.hash !== state.activeFingerprints.game.hash) {
    const built = ensureModule(state.rjitHome, state.cartRoot, 'game', next.game, state.devFlags, readModuleRecord(state.rjitHome, 'game'));
    if (!built) return abandonNativeCandidate(state, next, 'game engine compile failed; the running editor was not touched');
    nextGame = built;
  }

  let nextCore: PendingNativeUpdate['core'] = null;
  if (next.core.hash !== state.activeFingerprints.core.hash) {
    const alreadyStaged = state.pendingNative?.fingerprints.core.hash === next.core.hash
      ? state.pendingNative.core
      : null;
    if (alreadyStaged && fsExists(alreadyStaged.path)) {
      nextCore = alreadyStaged;
    } else {
      const candidatePrefix = `${state.rjitHome}/.cache/dev-core-candidate`;
      const candidatePath = `${candidatePrefix}/bin/${state.binName}`;
      const built = buildDevHost(state.rjitHome, state.cartRoot, state.binName, state.substrate, next.core, state.devFlags, candidatePrefix);
      if (built !== 0 || !fsExists(candidatePath)) {
        return abandonNativeCandidate(state, next, 'cold core compile failed; the running editor was not touched');
      }
      nextCore = { path: candidatePath, artifactHash: sha256File(candidatePath) };
    }
  } else if (next.core.hash !== state.fingerprints.core.hash) {
    // The source reverted while a different core candidate was staged. Rebuild
    // the active artifact off to the side only if its on-disk launch binary no
    // longer exists; the running inode remains authoritative either way.
    const activeRecord = readCoreRecord(state.rjitHome);
    if (!activeRecord || activeRecord.sourceHash !== next.core.hash || !fsExists(state.bin)) {
      const rebuilt = buildDevHost(state.rjitHome, state.cartRoot, state.binName, state.substrate, next.core, state.devFlags);
      if (rebuilt !== 0) return abandonNativeCandidate(state, next, 'active core restore failed; the running editor was not touched');
      writeDevBuildInfo(state.bin, next.core);
      writeCoreRecord(state.rjitHome, next.core.hash, state.bin);
    }
  }

  state.fingerprints = next;
  const changedTiers = changedNativeTiers(state.activeFingerprints, next);
  if (changedTiers.length === 0) {
    const hadPending = state.pendingNative !== null;
    state.pendingNative = null;
    writeModuleRecord(state.rjitHome, state.scene3d);
    writeModuleRecord(state.rjitHome, state.game);
    if (hadPending) sendNativeUpdateResultNotice(false, 'The pending native update was canceled because the sources now match the running editor.');
    return;
  }

  const pending: PendingNativeUpdate = {
    token: '',
    fingerprints: next,
    scene3d: nextScene,
    game: nextGame,
    core: nextCore,
    changedTiers,
  };
  pending.token = nativeUpdateToken(next, nextScene, nextGame, nextCore);
  state.pendingNative = pending;
  out(`[dev-native] ${changedTiers.join(' + ')} compiled and waiting for editor approval; running host child=${state.hostId} was not touched`);
  if (!sendNativeUpdateReadyNotice(pending, state.approvalPath)) {
    err('[dev-native] update is pending, but the editor notification could not be delivered');
  }
}

function abandonNativeCandidate(state: DevSupervisorState, observed: NativeFingerprints, message: string): void {
  state.fingerprints = observed;
  state.pendingNative = null;
  writeModuleRecord(state.rjitHome, state.scene3d);
  writeModuleRecord(state.rjitHome, state.game);
  err(`[dev-native] ${message}`);
  sendNativeUpdateResultNotice(false, message);
}

/** Orphans accumulate over days. Scanning every few minutes is plenty, and the first
 *  scan is deliberately late so a host still coming up is never called abandoned. */
const ORPHAN_FIRST_SCAN_MS = 60_000;
const ORPHAN_RESCAN_MS = 300_000;

function scanForOrphanHosts(state: DevSupervisorState): void {
  if (__nowMs() < state.nextOrphanScanMs) return;
  state.nextOrphanScanMs = __nowMs() + ORPHAN_RESCAN_MS;
  const scan = scanDevHosts(state.rjitHome, DEV_SOCKET_PATH);
  if (scan.orphans.length === 0) return;
  const pids = scan.orphans.map((row) => row.pid);
  sendOrphanHostsNotice(scan.orphans, scan.reclaimableKb, orphanCleanupToken(pids), state.orphanApprovalPath);
}

function applyApprovedOrphanCleanup(state: DevSupervisorState): void {
  const approval = parseOrphanCleanupApproval(tryFsRead(state.orphanApprovalPath));
  if (!approval) return;
  fsRemove(state.orphanApprovalPath);
  // The token binds to the exact pid set the notice advertised. A click that arrives
  // after the situation moved is stale, not approximately right — rescan and re-ask.
  if (approval.token !== orphanCleanupToken(approval.pids)) {
    err('[dev-orphans] ignored a cleanup approval whose token did not match its pids');
    return;
  }
  const outcomes = killOrphanHosts(state.rjitHome, DEV_SOCKET_PATH, approval.pids);
  const retired = outcomes.filter((row) => row.ok);
  for (const spared of outcomes.filter((row) => !row.ok)) {
    err(`[dev-orphans] spared pid ${spared.pid}: ${spared.reason}`);
  }
  err(`[dev-orphans] retired ${retired.length}/${outcomes.length} orphaned host(s)`);
  sendOrphanCleanupResultNotice(retired.length, outcomes.length);
  // Let the next scan re-notice anything that survived, rather than looping on it now.
  state.nextOrphanScanMs = __nowMs() + ORPHAN_RESCAN_MS;
}

function applyApprovedNativeUpdate(state: DevSupervisorState): void {
  const approval = parseNativeUpdateApproval(tryFsRead(state.approvalPath));
  if (!approval) return;
  fsRemove(state.approvalPath);
  const pending = state.pendingNative;
  if (!pending || approval.token !== pending.token) {
    err('[dev-native] ignored stale native update approval');
    if (pending) sendNativeUpdateReadyNotice(pending, state.approvalPath);
    return;
  }

  // Close the click-vs-save race: approval is valid only for the exact source
  // snapshot that was compiled. A newer edit gets its own candidate and click.
  const current = fingerprintNativeTiers(state.rjitHome, state.profileSalt);
  if (!sameNativeFingerprints(current, pending.fingerprints)) {
    err('[dev-native] approval arrived after a newer native source edit; staging the newer candidate first');
    applyNativeChanges(state, current);
    return;
  }

  activateNativeCandidate(state, pending);
  state.pendingNative = null;
}

function activateNativeCandidate(state: DevSupervisorState, pending: PendingNativeUpdate): void {
  if (pending.changedTiers.includes('core')) {
    if (!pending.core || !installPendingCore(pending.core.path, state.bin)) {
      const message = 'compiled core could not be installed; the running editor was not touched';
      err(`[dev-native] ${message}`);
      sendNativeUpdateResultNotice(false, message);
      return;
    }
    state.scene3d = pending.scene3d;
    state.game = pending.game;
    state.activeFingerprints = pending.fingerprints;
    writeDevBuildInfo(state.bin, pending.fingerprints.core);
    writeCoreRecord(state.rjitHome, pending.fingerprints.core.hash, state.bin);
    writeModuleRecord(state.rjitHome, state.scene3d);
    writeModuleRecord(state.rjitHome, state.game);
    updateSessionModules(state.rjitHome, state.scene3d, state.game);
    restartExactHost(state, 'user approved native core update');
    return;
  }

  let restartReason: string | null = null;
  const rejected: string[] = [];
  for (const tier of ['scene3d', 'game'] as const) {
    if (!pending.changedTiers.includes(tier)) continue;
    const candidate = tier === 'scene3d' ? pending.scene3d : pending.game;
    const active = tier === 'scene3d' ? state.scene3d : state.game;
    if (candidate.artifactHash === active.artifactHash) {
      out(`[dev-native] ${tier} source changed but emitted identical library`);
      commitActiveModule(state, pending, tier, candidate);
      continue;
    }

    const outcome = requestNativeReload(tier, candidate.artifactHash, candidate.path);
    out(`[dev-native] ${tier} user-approved activation ${outcome}`);
    if (outcome === 'committed') {
      commitActiveModule(state, pending, tier, candidate);
    } else if (outcome === 'restart_required' || outcome === 'timeout' || outcome === 'unreachable') {
      commitActiveModule(state, pending, tier, candidate);
      restartReason = restartReason ?? `${tier} activation ${outcome}`;
    } else {
      rejected.push(tier);
      writeModuleRecord(state.rjitHome, active);
    }
  }

  updateSessionModules(state.rjitHome, state.scene3d, state.game);
  if (restartReason) {
    restartExactHost(state, `user approved ${restartReason}`);
    return;
  }
  if (rejected.length > 0) {
    sendNativeUpdateResultNotice(false, `${rejected.join(' + ')} rejected the compiled candidate; the previous native module remains active.`);
  } else {
    sendNativeUpdateResultNotice(true, 'The approved native update is active.');
  }
}

function commitActiveModule(
  state: DevSupervisorState,
  pending: PendingNativeUpdate,
  tier: 'scene3d' | 'game',
  candidate: ModuleArtifactRecord,
): void {
  if (tier === 'scene3d') {
    state.scene3d = candidate;
    state.activeFingerprints.scene3d = pending.fingerprints.scene3d;
  } else {
    state.game = candidate;
    state.activeFingerprints.game = pending.fingerprints.game;
  }
  writeModuleRecord(state.rjitHome, candidate);
}

function installPendingCore(candidatePath: string, activePath: string): boolean {
  const temporaryPath = `${activePath}.installing`;
  const copied = spawnSync('cp', ['--', candidatePath, temporaryPath]);
  if (copied.code !== 0) return false;
  const installed = spawnSync('mv', ['--', temporaryPath, activePath]);
  if (installed.code !== 0) {
    if (fsExists(temporaryPath)) fsRemove(temporaryPath);
    return false;
  }
  return true;
}

function restartExactHost(state: DevSupervisorState, reason: string): void {
  const runningInfo = readDevHostInfo(DEV_SOCKET_PATH);
  const manifest = readSessionManifest(state.rjitHome);
  if (manifest && runningInfo?.active_tab && runningInfo.active_tab !== 'main' && manifest.tabs.some((tab) => tab.name === runningInfo.active_tab)) {
    manifest.activeTab = runningInfo.active_tab;
    manifest.scene3d = state.scene3d;
    manifest.game = state.game;
    writeSessionManifest(state.rjitHome, manifest);
  }
  const currentSession = readSessionManifest(state.rjitHome);
  const active = currentSession?.tabs.find((tab) => tab.name === currentSession.activeTab);
  if (active && fsExists(active.bundlePath)) fsWrite(`${state.rjitHome}/bundle.js`, fsRead(active.bundlePath));

  const checkpointId = Math.max(1, Math.floor(__nowMs()));
  const handoffPath = `${state.rjitHome}/.cache/dev-hotstate-handoff-${checkpointId}.json`;
  const checkpointed = requestDevCheckpoint(checkpointId);
  const handoffReady = checkpointed && saveDevHotState(handoffPath);
  if (!handoffReady) {
    err(`[dev-native] WARNING: could not capture exact-child state handoff (${checkpointed ? 'save failed' : 'checkpoint failed'})`);
  }

  out(`[dev-native] restarting exact host child=${state.hostId}: ${reason}`);
  __childKill(state.hostId);
  state.hostId = spawnDevHost(state.bin, state.cartDir, state.scene3d, state.game, handoffReady ? handoffPath : null).id;
  if (!waitForHost(DEV_SOCKET_PATH, 15000)) {
    err(`[dev-native] replacement host child=${state.hostId} did not open ${DEV_SOCKET_PATH}`);
    return;
  }
  replaySession(state.rjitHome, currentSession);
  out(`[dev-native] replacement host child=${state.hostId} ready`);
}

function waitForHost(socket: string, timeoutMs: number): boolean {
  const deadline = __nowMs() + timeoutMs;
  while (__nowMs() < deadline) {
    if (readDevHostInfo(socket)) return true;
    __sleepMs(25);
  }
  return false;
}

function replaySession(rjitHome: string, manifest: DevSessionManifest | null): void {
  if (!manifest) return;
  const available = manifest.tabs.filter((tab) => fsExists(tab.bundlePath));
  const ordered = [
    ...available.filter((tab) => tab.name !== manifest.activeTab),
    ...available.filter((tab) => tab.name === manifest.activeTab),
  ];
  for (const tab of ordered) {
    const pushed = spawnSync(`${rjitHome}/tools/rjit`, ['push-bundle', tab.name, tab.bundlePath]);
    if (pushed.code !== 0) err(`[dev-native] failed to replay tab '${tab.name}'`);
  }
}

function drainUntilExit(hostId: number, watcherId: number): void {
  while (true) {
    const hostLine = __childReadLine(hostId, 50);
    if (hostLine === '') {
      __childKill(watcherId);
      return;
    }
    if (hostLine !== null) __writeStdout(`${hostLine}\n`);
    const watcherLine = __childReadLine(watcherId, 50);
    if (watcherLine === '') {
      __childKill(hostId);
      return;
    }
    if (watcherLine !== null) __writeStdout(`${watcherLine}\n`);
    __sleepMs(50);
  }
}

function writeSpawnOutput(result: { stdout: string; stderr: string }): void {
  if (result.stdout) __writeStdout(result.stdout);
  if (result.stderr) __writeStderr(result.stderr);
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

function fail(message: string, code: number): number {
  err(message);
  return code;
}
