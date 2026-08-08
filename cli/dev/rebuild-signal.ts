// cli/dev/rebuild-signal.ts - native rebuild fingerprint + dev IPC notice helpers.

import { fsExists, tryFsRead, fsWrite } from '../host/fs.ts';
import { SocketError, tryUnixConnect, unixClose, unixReadLine, unixWrite } from '../host/net.ts';
import { spawnSync } from '../host/process.ts';
import { nativeTierLabel, type PendingNativeUpdate } from './native-approval.ts';

export const DEV_SOCKET_PATH = __env('RJIT_DEV_SOCKET_PATH') || '/tmp/reactjit.sock';
const TIMEOUT_MS = 3000;
const CHECKPOINT_TIMEOUT_MS = 5000;
const HOTSTATE_SAVE_TIMEOUT_MS = 30000;

export interface NativeBuildFingerprint {
  hash: string;
  inputCount: number;
}

export interface DevHostInfo {
  build_id: string;
  scene3d_hash?: string;
  game_hash?: string;
  native_attempt_tier?: string;
  native_attempt_hash?: string;
  native_reload?: string;
  active_tab?: string;
  checkpoint_completed?: number;
}

export type NativeReloadOutcome = 'committed' | 'rejected' | 'restart_required' | 'timeout' | 'unreachable';

export interface StaleDevHost {
  current: NativeBuildFingerprint;
  host: DevHostInfo;
}

export function nativeBuildFingerprint(rjitHome: string): NativeBuildFingerprint {
  const manifest = spawnSync('sh', ['-c', nativeInputManifestScript(), 'native-input-manifest', rjitHome]);
  if (manifest.code !== 0) {
    throw new Error(`native input manifest failed\n${manifest.stderr || manifest.stdout}`);
  }
  const digest = spawnSync('sha256sum', [], manifest.stdout);
  if (digest.code !== 0) {
    throw new Error(`native input digest failed\n${digest.stderr || digest.stdout}`);
  }
  const hash = digest.stdout.trim().split(/\s+/)[0] || '';
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`native input digest malformed: ${digest.stdout.trim()}`);
  const inputCount = manifest.stdout.split('\n').filter(Boolean).length;
  return { hash, inputCount };
}

function nativeInputManifestScript(): string {
  return `
set -eu
cd "$1"
{
  # framework/testing/** are zig 'test' modules pulled in ONLY by build.zig's
  # test-* steps (b.addTest) - never by the 'app' step that builds the dev
  # binary. Hashing them made any test-file touch (a test run, a git checkout,
  # another worker editing tests) force a needless full dev rebuild on every
  # start. Prune them: the fingerprint must reflect only the dev binary's inputs.
  find framework -type d -name testing -prune -o -type f -print 2>/dev/null || true
  printf '%s\\n' build.zig sdk/dependency-registry.json scripts/sdk-dependency-resolve.js tools/zig/zig
} | LC_ALL=C sort -u | while IFS= read -r f; do
  [ -f "$f" ] || continue
  sha256sum "$f"
done
`;
}

export function devBuildInfoPath(bin: string): string {
  return `${bin}.dev-build.json`;
}

export function readDevBuildId(bin: string): string | null {
  const raw = tryFsRead(devBuildInfoPath(bin));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { build_id?: unknown };
    return typeof parsed.build_id === 'string' ? parsed.build_id : null;
  } catch {
    return null;
  }
}

export function writeDevBuildInfo(bin: string, fingerprint: NativeBuildFingerprint): void {
  fsWrite(devBuildInfoPath(bin), `${JSON.stringify({
    build_id: fingerprint.hash,
    input_count: fingerprint.inputCount,
    written_at: new Date().toISOString(),
  }, null, 2)}\n`);
}

export function readDevHostInfo(socket: string = DEV_SOCKET_PATH): DevHostInfo | null {
  if (!fsExists(socket)) return null;
  const fd = tryUnixConnect(socket);
  if (fd === null) return null;
  try {
    unixWrite(fd, 'INFO\n');
    const line = unixReadLine(fd, __nowMs() + TIMEOUT_MS).trim();
    const parsed = JSON.parse(line) as Partial<DevHostInfo>;
    return typeof parsed.build_id === 'string' ? parsed as DevHostInfo : null;
  } catch {
    return null;
  } finally {
    unixClose(fd);
  }
}

export function requestNativeReload(
  tier: 'scene3d' | 'game',
  hash: string,
  path: string,
  socket: string = DEV_SOCKET_PATH,
  timeoutMs = 10000,
): NativeReloadOutcome {
  const fd = tryUnixConnect(socket);
  if (fd === null) return 'unreachable';
  try {
    unixWrite(fd, `NATIVE_RELOAD ${tier} ${hash} ${utf8ByteLength(path)}\n`);
    unixWrite(fd, path);
    const acknowledgement = unixReadLine(fd, __nowMs() + TIMEOUT_MS).trim();
    if (!acknowledgement.startsWith('OK')) return 'rejected';
  } catch (error) {
    if (error instanceof SocketError) return 'unreachable';
    throw error;
  } finally {
    unixClose(fd);
  }

  const deadline = __nowMs() + timeoutMs;
  while (__nowMs() < deadline) {
    const info = readDevHostInfo(socket);
    if (!info) return 'unreachable';
    if (info.native_attempt_tier === tier && info.native_attempt_hash === hash) {
      if (info.native_reload === 'committed' && (tier === 'scene3d' ? info.scene3d_hash : info.game_hash) === hash) return 'committed';
      if (info.native_reload === 'restart_required') return 'restart_required';
      if (info.native_reload === 'rejected') return 'rejected';
    }
    __sleepMs(20);
  }
  return 'timeout';
}

/** Ask the live JS world to synchronously flush its editor state into the
 * process-resident hotstate map, then wait until the frame loop completes it. */
export function requestDevCheckpoint(
  requestId: number,
  socket: string = DEV_SOCKET_PATH,
  timeoutMs = CHECKPOINT_TIMEOUT_MS,
): boolean {
  const fd = tryUnixConnect(socket);
  if (fd === null) return false;
  try {
    unixWrite(fd, `CHECKPOINT ${requestId}\n`);
    const acknowledgement = unixReadLine(fd, __nowMs() + TIMEOUT_MS).trim();
    if (!acknowledgement.startsWith('OK')) return false;
  } catch (error) {
    if (error instanceof SocketError) return false;
    throw error;
  } finally {
    unixClose(fd);
  }

  const deadline = __nowMs() + timeoutMs;
  while (__nowMs() < deadline) {
    const info = readDevHostInfo(socket);
    if (!info) return false;
    if ((info.checkpoint_completed ?? 0) >= requestId) return true;
    __sleepMs(10);
  }
  return false;
}

/** Save the already-checkpointed hotstate map to a supervisor-owned one-shot
 * file. The new exact child consumes and removes this file before bundle eval. */
export function saveDevHotState(path: string, socket: string = DEV_SOCKET_PATH): boolean {
  const fd = tryUnixConnect(socket);
  if (fd === null) return false;
  try {
    unixWrite(fd, `SAVE_HOTSTATE ${utf8ByteLength(path)}\n`);
    unixWrite(fd, path);
    return unixReadLine(fd, __nowMs() + HOTSTATE_SAVE_TIMEOUT_MS).trim().startsWith('OK');
  } catch (error) {
    if (error instanceof SocketError) return false;
    throw error;
  } finally {
    unixClose(fd);
  }
}

export function staleDevHost(rjitHome: string, socket: string = DEV_SOCKET_PATH): StaleDevHost | null {
  const current = nativeBuildFingerprint(rjitHome);
  const host = readDevHostInfo(socket);
  if (!host) return null;
  return host.build_id === current.hash ? null : { current, host };
}

export function sendRebuildNotice(stale: StaleDevHost, socket: string = DEV_SOCKET_PATH): boolean {
  const body = JSON.stringify({
    id: 'dev-host-stale',
    type: 'rebuild-required',
    kind: 'native-build-id-mismatch',
    title: 'Rebuild needed',
    message: 'The running dev host was built from different native engine or wire-format sources. Restart rjit dev before hot reload can continue.',
    detail: `running ${shortHash(stale.host.build_id)} / disk ${shortHash(stale.current.hash)}`,
    persistent: true,
    runningBuildId: stale.host.build_id,
    currentBuildId: stale.current.hash,
    inputCount: stale.current.inputCount,
  });
  return sendDevNotice(body, socket);
}

/** Orphaned dev hosts are invisible by definition — no window, no socket, nothing
 *  attached — so the editor is the only place the user will ever see them (req_4075).
 *  The notice carries the exact pids and never a pattern; approval is a one-shot token
 *  file, exactly like the native update, so the EDITOR never signals a process itself. */
export function sendOrphanHostsNotice(
  orphans: readonly { pid: number; elapsed: string; rssKb: number }[],
  reclaimableKb: number,
  token: string,
  approvalPath: string,
  socket: string = DEV_SOCKET_PATH,
): boolean {
  if (orphans.length === 0) return false;
  const gb = (reclaimableKb / 1048576).toFixed(1);
  const oldest = orphans.reduce((longest, row) => (row.elapsed.length > longest.length ? row.elapsed : longest), '');
  return sendDevNotice(JSON.stringify({
    id: 'dev-orphan-hosts',
    type: 'orphan-hosts',
    kind: 'orphan-hosts',
    title: 'Orphaned dev hosts',
    message: `${orphans.length} dev host${orphans.length === 1 ? '' : 's'} kept running after their launcher exited. They hold no window and serve nothing.`,
    detail: `${gb} GB held · oldest ${oldest} · this app is not among them`,
    persistent: true,
    token,
    approvalPath,
    pids: orphans.map((row) => row.pid),
    reclaimableKb,
  }), socket);
}

export function sendOrphanCleanupResultNotice(
  retired: number,
  attempted: number,
  socket: string = DEV_SOCKET_PATH,
): boolean {
  return sendDevNotice(JSON.stringify({
    id: 'dev-orphan-hosts-result',
    type: 'orphan-hosts-result',
    kind: 'orphan-hosts-result',
    title: 'Orphan cleanup finished',
    message: retired === attempted
      ? `Retired ${retired} orphaned dev host${retired === 1 ? '' : 's'}`
      : `Retired ${retired} of ${attempted}; the rest were spared because they no longer looked orphaned`,
    ok: retired > 0,
  }), socket);
}

export function sendNativeUpdateReadyNotice(
  pending: PendingNativeUpdate,
  approvalPath: string,
  socket: string = DEV_SOCKET_PATH,
): boolean {
  const labels = pending.changedTiers.map(nativeTierLabel);
  return sendDevNotice(JSON.stringify({
    id: 'dev-native-update-ready',
    type: 'native-update-ready',
    kind: 'native-update-ready',
    title: 'Native update ready',
    message: 'Compilation finished. Keep working as long as you want; this update will not activate until you approve it.',
    detail: `${labels.join(' + ')}${pending.changedTiers.includes('core') ? ' · restart required' : ' · activation may restart the host'}`,
    persistent: true,
    token: pending.token,
    approvalPath,
    changedTiers: pending.changedTiers,
  }), socket);
}

export function sendNativeUpdateResultNotice(
  ok: boolean,
  message: string,
  socket: string = DEV_SOCKET_PATH,
): boolean {
  return sendDevNotice(JSON.stringify({
    id: 'dev-native-update-result',
    type: 'native-update-result',
    kind: 'native-update-result',
    title: ok ? 'Native update applied' : 'Native update not applied',
    message,
    ok,
    persistent: false,
  }), socket);
}

function sendDevNotice(body: string, socket: string): boolean {
  const fd = tryUnixConnect(socket);
  if (fd === null) return false;
  try {
    unixWrite(fd, `NOTICE ${utf8ByteLength(body)}\n`);
    unixWrite(fd, body);
    const line = unixReadLine(fd, __nowMs() + TIMEOUT_MS).trim();
    return line.startsWith('OK');
  } catch (error) {
    if (error instanceof SocketError) return false;
    throw error;
  } finally {
    unixClose(fd);
  }
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return 'unknown';
  return hash === 'unknown' ? hash : hash.slice(0, 12);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
