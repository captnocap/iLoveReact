// cli/dev/rebuild-signal.ts - native rebuild fingerprint + dev IPC notice helpers.

import { fsExists, tryFsRead, fsWrite } from '../host/fs.ts';
import { SocketError, tryUnixConnect, unixClose, unixReadLine, unixWrite } from '../host/net.ts';
import { spawnSync } from '../host/process.ts';

export const DEV_SOCKET_PATH = '/tmp/reactjit.sock';
const TIMEOUT_MS = 3000;

export interface NativeBuildFingerprint {
  hash: string;
  inputCount: number;
}

export interface DevHostInfo {
  build_id: string;
}

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
  printf '%s\\n' build.zig v8_app.zig v8_cli.zig v8_hello.zig sdk/dependency-registry.json scripts/sdk-dependency-resolve.js tools/zig/zig
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
    return typeof parsed.build_id === 'string' ? { build_id: parsed.build_id } : null;
  } catch {
    return null;
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
  const fd = tryUnixConnect(socket);
  if (fd === null) return false;
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
