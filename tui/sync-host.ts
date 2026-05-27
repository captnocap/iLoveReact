/**
 * tui/sync-host.ts — cart-side workspace sync orchestrator.
 *
 * Replaces scripts/claudewrap-sync-host.py. The cart never handles
 * binary payloads — Zig owns all byte I/O. We just:
 *   1. Pre-allocate a vsock UDS path the cart and claude-ss agree on.
 *   2. Open a UDS server at `<path>_5002` (where firecracker routes
 *      guest-side connect(host_cid=2, port=5002) calls).
 *   3. Set the server into workspace mode pointing at the host CWD —
 *      inbound SET/DEL/DIR/INIT frames write straight to the local
 *      filesystem via framework/sync/workspace.zig.
 *   4. On every guest-accept, ship a workspace tar as INIT frame.
 *   5. On every host-side file change (via useFileWatch), broadcast a
 *      SET (or DEL/DIR) frame to every connected guest.
 *
 * Multi-VM-per-claudewrap isn't wired yet — current claudewrap has one
 * Terminal node so one VM. Adding more is a small extension (a server
 * per Terminal node) — the binding layer already supports it via the
 * id-keyed `g_uds` registry.
 */

// Side-effect import: pulls useConnection.ts into the metafile, which
// triggers the `has-net` build gate. Without this, the v8_bindings_net
// module is stubbed at link time and `__uds_*` is unavailable.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as _useConnection from '../runtime/hooks/useConnection';

import {
  udsListen,
  udsClose,
  udsSetWorkspaceRoot,
  udsSendWorkspaceInit,
  udsSendFileFrame,
  udsSendMsgFrame,
} from '../runtime/hooks/useTheInternet';
import { subscribe } from '../runtime/ffi';
import { attachWatcher } from '../runtime/hooks/useFileWatch';

const host = (): any => globalThis as any;

// Set of files / dirs we never sync either direction. Matches the
// host-side DENY_SEGMENTS in framework/sync/workspace.zig so client and
// server agree.
const DENY_SEGMENTS = new Set([
  '.git', '.zig-cache', 'node_modules', 'zig-out', 'target',
  'deps', 'archive', 'images', '.cache', '__pycache__', '.next',
  'dist', 'build', '.DS_Store',
]);

function isDenied(rel: string): boolean {
  if (!rel) return true;
  const trimmed = rel.startsWith('/') ? rel.slice(1) : rel;
  if (!trimmed) return true;
  for (const seg of trimmed.split('/')) {
    if (!seg) continue;
    if (DENY_SEGMENTS.has(seg)) return true;
    if (seg.endsWith('.pyc')) return true;
  }
  return false;
}

function relTo(cwd: string, fullPath: string): string {
  if (fullPath.startsWith(cwd + '/')) return fullPath.slice(cwd.length + 1);
  if (fullPath === cwd) return '';
  return fullPath;
}

function joinPath(cwd: string, rel: string): string {
  const trimmedRel = rel.startsWith('/') ? rel.slice(1) : rel;
  if (!trimmedRel) return cwd;
  return cwd.endsWith('/') ? cwd + trimmedRel : cwd + '/' + trimmedRel;
}

// ── Server lifecycle ────────────────────────────────────────────────

interface SyncHandle {
  id: number;
  vsockUdsPath: string;
  stop: () => void;
}

const liveServers = new Set<number>();
let nextServerId = 1;

/**
 * Open a workspace sync server for one VM. Returns a handle whose
 * `stop()` closes the UDS + tears down subscriptions. Idempotent
 * subscriptions are ref-counted via the returned cleanup.
 *
 *   const sync = startWorkspaceSync({ cwd: '/home/me/repo' });
 *   // → process.env.CLAUDEWRAP_VSOCK_UDS = sync.vsockUdsPath
 *   // → spawn Terminal with shell="scripts/claude-ss"
 *   // claude-ss reads CLAUDEWRAP_VSOCK_UDS, uses it as its vsock path
 *   // → guest dials port 5002, lands on our UDS, INIT tar ships
 */
export function startWorkspaceSync(opts: { cwd: string; vsockUdsPath?: string }): SyncHandle {
  const id = nextServerId++;
  const udsBase = opts.vsockUdsPath ?? `/tmp/claudewrap-${host().__getpid?.() ?? Date.now()}-${id}.sock`;
  const fullSyncPath = udsBase + '_5002';
  const unsubs: Array<() => void> = [];

  // 1. Bind the UDS listener BEFORE the VM tries to dial. The guest's
  //    sync daemon has retry backoff but a clean start avoids it.
  udsListen(id, fullSyncPath);
  udsSetWorkspaceRoot(id, opts.cwd);
  liveServers.add(id);

  // 2. On every guest accept, ship the workspace tar as INIT.
  unsubs.push(subscribe(`uds:accept:${id}`, (body: any) => {
    const connId = Number(typeof body === 'string' ? body : body?.text ?? body);
    if (!Number.isFinite(connId)) return;
    udsSendWorkspaceInit(id, connId, opts.cwd);
  }));

  // 3. Log listen errors — these usually mean a stale UDS file at the
  //    path, or the directory not being writable.
  unsubs.push(subscribe(`uds:listen-error:${id}`, (msg: any) => {
    const text = typeof msg === 'string' ? msg : msg?.text ?? String(msg);
    console.error?.(`[sync-host] uds listen error: ${text}`);
  }));
  unsubs.push(subscribe(`uds:workspace-error:${id}`, (msg: any) => {
    const text = typeof msg === 'string' ? msg : msg?.text ?? String(msg);
    console.error?.(`[sync-host] workspace error: ${text}`);
  }));

  // 4. Host file watcher → fan out to every connected guest. We track
  //    "every connected guest" by maintaining a small set of conn_ids
  //    that have accepted; close events drop them. Sending to a closed
  //    conn is a no-op on the Zig side.
  const conns = new Set<number>();
  unsubs.push(subscribe(`uds:accept:${id}`, (body: any) => {
    const connId = Number(typeof body === 'string' ? body : body?.text ?? body);
    if (Number.isFinite(connId)) conns.add(connId);
  }));
  // Per-conn close subscriptions are dynamic — use a wildcard.
  const { subscribeAll } = require('../runtime/ffi');
  const closePrefix = `uds:close:${id}:`;
  unsubs.push(subscribeAll((channel: string, _body: any) => {
    if (!channel.startsWith(closePrefix)) return;
    const connId = Number(channel.slice(closePrefix.length));
    if (Number.isFinite(connId)) conns.delete(connId);
  }));

  // 5. File watch. useFileWatch already gives us debounced events from
  //    the Zig-side fswatch.
  const detachWatcher = attachWatcher(opts.cwd, (ev) => {
    const rel = '/' + relTo(opts.cwd, ev.path);
    if (isDenied(rel)) return;
    for (const connId of conns) {
      if (ev.type === 'modified' || ev.type === 'created') {
        udsSendFileFrame(id, connId, rel, ev.path);
      } else if (ev.type === 'deleted') {
        udsSendMsgFrame(id, connId, 'DEL', rel);
      }
    }
  }, { recursive: true });

  return {
    id,
    vsockUdsPath: udsBase,
    stop: () => {
      try { detachWatcher(); } catch {}
      for (const off of unsubs) {
        try { off(); } catch {}
      }
      try { udsClose(id); } catch {}
      liveServers.delete(id);
    },
  };
}

/** For tests / debugging: how many sync servers are live right now. */
export function syncServerCount(): number {
  return liveServers.size;
}
