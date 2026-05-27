// vm-bridges — automates the host↔guest bus mirror lifecycle.
//
// When a worker-session row transitions to status='running' with a
// `vmid`, this subscriber calls `attachVm(vmid)` so the host bus
// receives every guest event under 'vm:<vmid>:*'. When the session
// terminates (complete / failed), it calls `detachVm(vmid)` to tear
// the mirror down.
//
// Idempotent: attachVm itself is a no-op for already-attached vmids,
// so duplicate row updates can't double-attach. We track per-vmid
// reference counts so a single session ending doesn't tear a bridge
// that another active session on the same VM still depends on (rare,
// but defensive — VM reuse across sessions is on the table).
//
// Lifecycle:
//   - `installVmBridges()` subscribes; called from cart/app/db/index.ts
//     so the bridge auto-loads with the rest of the DB layer.
//   - `uninstallVmBridges()` reverses it; useful for hot-reload.

import { subscribe } from '@reactjit/runtime/ffi';
import { attachVm, detachVm, listAttachedVms } from '@reactjit/runtime/hooks/ifttt/vm';

type SessionEvent = {
  sessionId: string;
  status: string;
  vmid?: string;
};

const _refcounts = new Map<string, Set<string>>(); // vmid → Set<sessionId>
let _installed = false;
let _unsubscribe: (() => void) | null = null;

function bumpAttach(vmid: string, sessionId: string): void {
  let sessions = _refcounts.get(vmid);
  const isFirst = !sessions || sessions.size === 0;
  if (!sessions) { sessions = new Set(); _refcounts.set(vmid, sessions); }
  sessions.add(sessionId);
  if (isFirst) {
    attachVm(vmid);
  }
}

function bumpDetach(vmid: string, sessionId: string): void {
  const sessions = _refcounts.get(vmid);
  if (!sessions) return;
  sessions.delete(sessionId);
  if (sessions.size === 0) {
    _refcounts.delete(vmid);
    detachVm(vmid);
  }
}

function onSessionLifecycle(payload: any): void {
  if (!payload || typeof payload !== 'object') return;
  const evt = payload as SessionEvent;
  if (typeof evt.sessionId !== 'string' || typeof evt.status !== 'string') return;
  if (typeof evt.vmid !== 'string' || evt.vmid.length === 0) return;
  if (evt.status === 'running') {
    bumpAttach(evt.vmid, evt.sessionId);
  } else {
    // complete / failed / anything else terminal — drop our claim.
    bumpDetach(evt.vmid, evt.sessionId);
  }
}

/** Subscribe to session:lifecycle and route attach/detach. Idempotent. */
export function installVmBridges(): void {
  if (_installed) return;
  _unsubscribe = subscribe('session:lifecycle', onSessionLifecycle);
  _installed = true;
}

/** Reverse of installVmBridges. Detaches every currently-tracked VM
 *  so a hot-reload doesn't leak bus subscriptions. */
export function uninstallVmBridges(): void {
  if (!_installed) return;
  try { _unsubscribe?.(); } catch { /* ignore */ }
  _unsubscribe = null;
  for (const vmid of Array.from(_refcounts.keys())) {
    try { detachVm(vmid); } catch { /* ignore */ }
  }
  _refcounts.clear();
  _installed = false;
}

/** Inspect: vmid → set of sessions claiming it. Useful for the
 *  sweatshop debugging surface. */
export function listVmBridgeRefs(): Array<{ vmid: string; sessionIds: string[] }> {
  return Array.from(_refcounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([vmid, sessions]) => ({ vmid, sessionIds: Array.from(sessions).sort() }));
}

/** Re-export of the underlying attached set. Equivalent to
 *  listAttachedVms() from ifttt-vm — re-exported here so the cart's
 *  DB layer is the single import surface for vm bridge inspection. */
export { listAttachedVms };
