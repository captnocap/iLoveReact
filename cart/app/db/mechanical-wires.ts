// mechanical-wires — the wires that aren't user choice.
//
// These run regardless of Rule rows. They implement the safety floor
// the spec requires — what cannot be opted out by a user editing rules
// in the cockpit.
//
// Currently implements:
//   1. Pathology severity=block → halt-run.
//      A 'supervisor:flag-pathology' that resolves to a Pathology row
//      with severity='block' must also halt the active CompositionRun.
//      This is the spec's non-negotiable floor; user rules cannot
//      suppress it.
//
// Documented but not yet implementable (downstream code missing):
//   2. Stage gates (artifact / well-formed / constraints / goal /
//      pathology-clean / workspace-clean). Lives in the run state
//      machine when that lands.
//   3. Run termination on verifier 'fail' verdict.
//   4. Bootstrap order (DB → Composition → Worker spawn).
//
// Re-runnable via `refreshMechanicalCaches()` if the user edits a
// Pathology row from the cockpit and wants the change live.

import { subscribe, emit } from '@reactjit/runtime/ffi';
import { query } from './connections';
import { ident, tableName } from './sql';
import { bucketFor } from './registry';

// ── Caches keyed at install time ──────────────────────────────────

const pathologyCache = new Map<string, { id: string; severity: string }>();

function refreshPathologyCache(): void {
  try {
    const bucket = bucketFor('pathology');
    const t = tableName('pathology');
    const rows = query<{ data: any }>(bucket, `SELECT data FROM ${ident(t)}`);
    pathologyCache.clear();
    for (const r of rows) {
      const row = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      if (row?.id && row?.severity) {
        pathologyCache.set(row.id, { id: row.id, severity: row.severity });
      }
    }
  } catch (e) {
    console.warn('[mechanical-wires] failed to load pathology cache:', e);
  }
}

/** Re-read the pathology cache. Call after editing pathology rows in
 *  the cockpit so severity-driven mechanical wires use fresh data. */
export function refreshMechanicalCaches(): void {
  refreshPathologyCache();
}

// ── Wire 1: pathology severity=block → halt-run ───────────────────

let installed = false;
const subscriptions: Array<() => void> = [];

export function installMechanicalWires(): void {
  if (installed) return;
  installed = true;

  refreshPathologyCache();

  const unsub1 = subscribe('supervisor:flag-pathology', (payload: any) => {
    const id = payload?.pathologyId;
    if (!id) return;
    const path = pathologyCache.get(id);
    if (!path) return;
    if (path.severity !== 'block') return;
    // Block-severity pathology — halt the run.
    emit('supervisor:halt-run', {
      runId:
        payload?.triggerPayload?.runId ??
        payload?.triggerPayload?.compositionRunId ??
        payload?.triggerPayload?.run?.id,
      reason: `pathology:${id}`,
      pathologySeverity: 'block',
      sourcePathologyDetection: payload?.triggerPayload,
    });
  });
  subscriptions.push(unsub1);

  // Future wires register here.
}

/** Tear down all installed wires. Tests + hot-reload teardown. */
export function uninstallMechanicalWires(): void {
  for (const u of subscriptions) {
    try { u(); } catch { /* ignore */ }
  }
  subscriptions.length = 0;
  pathologyCache.clear();
  installed = false;
}
