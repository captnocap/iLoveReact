// shell/workbenchDoor.ts — the chrome's two doorways into /workbench
// (STEP10-COLLAPSE-0607, WORKBENCH.md §3: the ruled six icons).
//
// ASSETS and SETTINGS are both /workbench; the bench's gutter-1 stays the one
// real source switcher. This module is the thin door layer between them:
//
// - requestWorkbenchSource(id) — the one-shot "open ON this source" ask
//   (the paint deep-link A9 mailbox precedent): consumed at Workbench mount
//   for cross-route nav, delivered live when the bench is already mounted.
//   No twig write from outside — the mounted twig hook stays the only writer.
// - reportWorkbenchFamily / subscribeWorkbenchFamily — the bench reports which
//   FAMILY its active source belongs to so the chrome lights the right door
//   truthfully (a door, made a mirror). `requests` rides the settings family
//   for highlight ONLY (it postdates §3 — revisit when REQPANEL lands).

export type WorkbenchFamily = 'assets' | 'settings';

/** settings/logs (+ requests, highlight-only) = the SETTINGS door's family;
 *  every authoring source = ASSETS. */
export function familyOfSource(id: string): WorkbenchFamily {
  return id === 'settings' || id === 'logs' || id === 'requests' ? 'settings' : 'assets';
}

// ── the one-shot source request ──────────────────────────────────────────────

let pendingSource: string | null = null;
const sourceListeners = new Set<(id: string) => void>();

export function requestWorkbenchSource(id: string): void {
  if (sourceListeners.size > 0) {
    // the bench is mounted — deliver live, nothing left pending
    for (const fn of Array.from(sourceListeners)) {
      try { fn(id); } catch { /* a dead subscriber never blocks the door */ }
    }
    return;
  }
  pendingSource = id;
}

export function takePendingWorkbenchSource(): string | null {
  const taken = pendingSource;
  pendingSource = null;
  return taken;
}

export function subscribeWorkbenchSource(fn: (id: string) => void): () => void {
  sourceListeners.add(fn);
  return () => { sourceListeners.delete(fn); };
}

// ── the family report (chrome highlight) ─────────────────────────────────────

let currentFamily: WorkbenchFamily = 'assets';
const familyListeners = new Set<(family: WorkbenchFamily) => void>();

export function currentWorkbenchFamily(): WorkbenchFamily {
  return currentFamily;
}

export function reportWorkbenchFamily(family: WorkbenchFamily): void {
  if (family === currentFamily) return;
  currentFamily = family;
  for (const fn of Array.from(familyListeners)) {
    try { fn(family); } catch { /* never kills the report */ }
  }
}

export function subscribeWorkbenchFamily(fn: (family: WorkbenchFamily) => void): () => void {
  familyListeners.add(fn);
  return () => { familyListeners.delete(fn); };
}
