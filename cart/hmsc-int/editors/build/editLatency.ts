// editLatency — EDITLATENCY req_1924/req_1928: a tiny shared stopwatch for the editor's
// edit→render loop. ANY edit gesture (place, move, delete, rotate, clone, skin/texture) stamps
// the keystroke moment here; the loader pane's live-push effect takes the stamp after it pushes
// to the host and logs keystroke→push (the React + push cost) and keystroke→rendered (≈ one frame
// later). One stamp at a time — the next gesture's push consumes the prior stamp — so the verbs
// don't need to thread a timer through their commit paths; they just call stampEdit at the gesture.
//
// Decoupled on purpose: the skin/texture gesture lives in FacePainter, the measurement in
// LoaderIsoView; a module singleton bridges them (same app instance). The goal is a MATRIX of
// per-verb latencies — a baseline to beat as the edit loop is driven toward gameplay rate.

const g: any = globalThis;

/** High-res monotonic clock (ms), falling back to wall clock. */
export const nowMs = (): number => g.performance?.now?.() ?? Date.now();

export interface EditStamp { t: number; label: string }

let pending: EditStamp | null = null;

/** Stamp the gesture that starts an edit (the keystroke/click), labelled by verb. */
export function stampEdit(label: string): void {
  pending = { t: nowMs(), label };
}

/** Take (and clear) the pending stamp — the measurement site calls this once per push. */
export function takeEditStamp(): EditStamp | null {
  const p = pending;
  pending = null;
  return p;
}

// RENDERTICK req_1968: a component calls renderTick('Name') at the top of its render; the
// edit-latency line snapshots the counts and reports which components re-rendered for an edit —
// the definitive answer to "which panel is still redrawing" instead of guessing prop-by-prop.
export function renderTick(name: string): void {
  const m = (g.__rt ??= {});
  m[name] = (m[name] ?? 0) + 1;
}
export function snapRenderTicks(): Record<string, number> {
  return { ...(g.__rt ?? {}) };
}
