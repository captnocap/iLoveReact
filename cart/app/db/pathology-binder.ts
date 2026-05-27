// pathology-binder — auto-bind active Pathology rows as live `match:`
// rules per running worker session.
//
// Closes the loop on the Pathology dictionary: each row's
// `detectionSignals[]` (kind='pattern') becomes one IFTTT subscription
// on `vm:<vmid>:event:append` for every running session. On hit, the
// binder emits `supervisor:flag-pathology` with the row id + evidence;
// the writer side (mechanical-wires + claim-engine + buses) takes
// over from there.
//
// Adding a banned phrase becomes a row insert. No cart code changes.
//
// Lifecycle:
//   - installPathologyBinder() subscribes to `session:lifecycle`
//   - setActivePathologies(rows) is called from a cart-side hook that
//     watches the pathology table; rebinds against all active sessions
//   - uninstallPathologyBinder() reverses
//
// Why setActivePathologies is exported separately rather than the
// binder querying the DB directly: useCRUD is a React hook and the
// binder is a non-hook module. The cart-side mount effect fetches the
// rows and pushes them in. This keeps the binder free of DB transport
// concerns and makes it trivial to drive from tests.

import { subscribe, emit } from '@reactjit/runtime/ffi';
import { resolveTrigger } from '@reactjit/runtime/hooks/ifttt/registry';
import { matchSpec } from '@reactjit/runtime/hooks/ifttt/match';
import type { Pathology } from '../gallery/data/core/pathology';

interface ActiveSession { sessionId: string; vmid: string }
interface BindingHandle { key: string; teardown: () => void }

let _installed = false;
let _activePathologies: Pathology[] = [];
const _activeSessions = new Map<string, ActiveSession>();
const _bindings = new Map<string, BindingHandle>();
let _unsubSession: (() => void) | null = null;

const bindKey = (pathologyId: string, sessionId: string) => `${pathologyId}__${sessionId}`;

function bindOne(pat: Pathology, sess: ActiveSession): void {
  const key = bindKey(pat.id, sess.sessionId);
  if (_bindings.has(key)) return;
  const teardowns: Array<() => void> = [];
  for (const sig of pat.detectionSignals) {
    if (sig.kind !== 'pattern' || !sig.spec) continue;
    const channel = `vm:${sess.vmid}:event:append`;
    const spec = matchSpec(channel, `/${sig.spec}/i`);
    const sub = resolveTrigger(spec);
    if (!sub) {
      console.warn(`[pathology-binder] could not resolve '${spec}'`);
      continue;
    }
    const off = sub.subscribe((payload: any) => {
      emit('supervisor:flag-pathology', {
        pathologyId: pat.id,
        sessionId: sess.sessionId,
        vmid: sess.vmid,
        evidence: payload?.match ?? payload?.text ?? '',
        surface: sig.surface,
        triggerPayload: payload,
      });
    });
    teardowns.push(off);
  }
  if (teardowns.length === 0) return;
  _bindings.set(key, {
    key,
    teardown: () => { for (const t of teardowns) try { t(); } catch { /* ignore */ } },
  });
}

function unbindOne(pathologyId: string, sessionId: string): void {
  const key = bindKey(pathologyId, sessionId);
  const h = _bindings.get(key);
  if (!h) return;
  try { h.teardown(); } catch { /* ignore */ }
  _bindings.delete(key);
}

function rebindAll(): void {
  for (const h of Array.from(_bindings.values())) {
    try { h.teardown(); } catch { /* ignore */ }
  }
  _bindings.clear();
  for (const pat of _activePathologies) {
    if (!pat.active) continue;
    for (const sess of _activeSessions.values()) bindOne(pat, sess);
  }
}

function onSessionLifecycle(payload: any): void {
  if (!payload || typeof payload !== 'object') return;
  const sessionId = String(payload.sessionId ?? '');
  if (!sessionId) return;
  const vmid = typeof payload.vmid === 'string' && payload.vmid ? payload.vmid : undefined;
  if (payload.status === 'running' && vmid) {
    _activeSessions.set(sessionId, { sessionId, vmid });
    for (const pat of _activePathologies) {
      if (pat.active) bindOne(pat, { sessionId, vmid });
    }
  } else {
    if (_activeSessions.has(sessionId)) {
      for (const pat of _activePathologies) unbindOne(pat.id, sessionId);
      _activeSessions.delete(sessionId);
    }
  }
}

/** Subscribe to session:lifecycle. Idempotent. */
export function installPathologyBinder(): void {
  if (_installed) return;
  _installed = true;
  _unsubSession = subscribe('session:lifecycle', onSessionLifecycle);
}

export function uninstallPathologyBinder(): void {
  if (!_installed) return;
  if (_unsubSession) { try { _unsubSession(); } catch { /* ignore */ } _unsubSession = null; }
  for (const h of Array.from(_bindings.values())) {
    try { h.teardown(); } catch { /* ignore */ }
  }
  _bindings.clear();
  _activeSessions.clear();
  _activePathologies = [];
  _installed = false;
}

/** Push the active Pathology row set. Drives the binder; the cart's
 *  mount effect calls this whenever the table changes. */
export function setActivePathologies(rows: Pathology[]): void {
  _activePathologies = rows.filter((p) => p.active);
  rebindAll();
}

/** Inspect: which {pathology, session} pairs have a live binding. */
export function listPathologyBindings(): Array<{ pathologyId: string; sessionId: string }> {
  return Array.from(_bindings.values()).map((h) => {
    const [pathologyId, sessionId] = h.key.split('__');
    return { pathologyId, sessionId };
  });
}
