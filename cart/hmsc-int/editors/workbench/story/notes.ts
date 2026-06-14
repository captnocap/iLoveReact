// editors/workbench/story/notes.ts — the post-it + world-transition data
// infra, shared by every surface (req_0921/req_0922). The user wants notes
// attached to EVERYTHING — questlines, missions, events, and a general board
// pad — as scattered post-its, not one god-notepad; and a transition seam where
// a story point declares a persistent world-state change (the timeline EDITOR
// that authors them richly is a deferred follow-up — this is just the infra it
// will call). One implementation, reused on each holder (the rule-of-two law).

/** A single scattered post-it. Multiple per surface — keep thoughts in place. */
export type Note = { id: string; text: string };

/** A declared world-state change: what in the world this touches + the new
 *  state. Free text for now; the instance-picker + typed verbs are the timeline
 *  editor's job. The compile step will later lower these into map deltas that
 *  persist forward from the anchor point. */
export type WorldChange = { id: string; target: string; effect: string };

/** A TRANSITIONAL WORLD STATE anchored at a story point: "on mission 3 complete,
 *  the apartment building catches fire." `at` is the anchor — for a mission:
 *  'accept' | 'complete' | 'fail' | `event:<eventId>`; for a line: 'start' |
 *  'complete'. The changes persist forward from that point. */
export type WorldTransition = { id: string; at: string; label: string; changes: WorldChange[] };

/** Deterministic next id (no Date.now/Math.random in the cart host): the max
 *  numeric suffix among existing + 1. Stable across reloads. */
export function nextSeqId(prefix: string, existing: readonly { id: string }[]): string {
  let max = 0;
  for (const e of existing) {
    const m = /(\d+)$/.exec(e.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${max + 1}`;
}

// ── notes (post-its) ──────────────────────────────────────────────────────────

export function addNote(arr: Note[]): void {
  arr.push({ id: nextSeqId('note', arr), text: '' });
}
export function setNote(arr: Note[], id: string, text: string): void {
  const n = arr.find((x) => x.id === id);
  if (n) n.text = text;
}
export function removeNote(arr: Note[], id: string): void {
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) arr.splice(i, 1);
}

// ── world transitions ─────────────────────────────────────────────────────────

export function addTransition(arr: WorldTransition[], at: string): void {
  arr.push({ id: nextSeqId('xtn', arr), at, label: '', changes: [] });
}
export function removeTransition(arr: WorldTransition[], id: string): void {
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) arr.splice(i, 1);
}
export function setTransitionLabel(arr: WorldTransition[], id: string, label: string): void {
  const t = arr.find((x) => x.id === id);
  if (t) t.label = label;
}
export function addChange(t: WorldTransition): void {
  t.changes.push({ id: nextSeqId('chg', t.changes), target: '', effect: '' });
}
export function removeChange(t: WorldTransition, id: string): void {
  const i = t.changes.findIndex((x) => x.id === id);
  if (i >= 0) t.changes.splice(i, 1);
}
export function setChange(t: WorldTransition, id: string, patch: Partial<Pick<WorldChange, 'target' | 'effect'>>): void {
  const c = t.changes.find((x) => x.id === id);
  if (!c) return;
  if (patch.target !== undefined) c.target = patch.target;
  if (patch.effect !== undefined) c.effect = patch.effect;
}
