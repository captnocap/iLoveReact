// editors/controls.ts — the EDITOR control contract (EDITORCTL-0610, structure
// review §3).
//
// The disease this cures: the gameplay side has input/controlContract.ts
// (bindings as DATA, consumed by game/input.ts + the console), but the EDITOR
// had no contract at all — every surface hand-rolled its own raw `__keydown`
// listener, its own modifier checks, and its own copy of the typing gate, so
// the same key meant different things per surface with nothing checking for
// collisions, and nothing could render a keymap ("you have to already know").
//
// THE BINDINGS ARE THE TABLE (P2). One entry per editor action: which scope it
// lives in, which key chords fire it, what it is called. Everything else falls
// out of the table:
//   - useEditorControls(scope, …) is the ONE dispatcher — it owns chord
//     normalization and the typing gate; surfaces only say which scope they
//     consume and hand over handlers by action id.
//   - legendForScope(scope) is the discoverable keymap — any surface renders
//     its legend from the same rows that drive dispatch, so the legend can
//     never lie (the PlayRoute status-line idea, generalized).
//   - validateEditorBindings() runs at module init: within one scope a chord
//     maps to AT MOST one action — key conflicts are a boot-time error, not a
//     user discovery.
//
// DATA ONLY, NO REACT IMPORTS (the decal.ts idiom) — this file is the
// contract and its resolution logic, testable headless under tools/v8cli;
// the React dispatcher hooks live in editors/useEditorControls.ts.
//
// Adoption state: 'canvas' (the / map canvas) + 'iso-build' (the iso build
// pane) + 'bench' (the workbench shell chords) consume this table. The paint
// editor's tool keys (usePaintEditor.ts, B/E/H/S/L/F…) and the gameplay
// surfaces (input/controlContract.ts — a DIFFERENT, ruled contract) are the
// remaining transports; fold them in by ADDING rows, not new listeners.

import { callHost } from '@reactjit/ffi';

/** Per-surface activation scope. A scope is a focus world: within it a chord
 *  means ONE thing; across scopes the same key may differ (E orbits the iso
 *  camera, E rotates the canvas brush) because only one is active per press. */
export type EditorScope = 'canvas' | 'iso-build' | 'bench' | 'studio';

export type EditorBinding = {
  /** dot-namespaced action id, `<concern>.<verb>` (e.g. 'brush.rotate-cw') */
  action: string;
  scope: EditorScope;
  /** normalized chords: a bare key ('e', 'delete', 'f8') matches only with NO
   *  ctrl/alt/meta held; a combo ('ctrl+shift+z') matches that exact modifier
   *  set. Multiple chords = aliases of one action. */
  keys: string[];
  /** what the action does — full text for the keymap surface */
  label: string;
  /** compact legend text, or null to keep the row out of the on-pane strip
   *  (held-movement keys earn a legend; modifier-state rows usually don't) */
  legend: string | null;
  /** fire even while a text input is focused (default false — the gate is the
   *  contract's job, not each surface's) */
  whileTyping?: boolean;
  /** held-movement action: the handler receives BOTH phases ('down' on press,
   *  'up' on release, base-key matched so a modifier pressed mid-hold can't
   *  strand it). Press actions (the default) receive 'down' only. */
  held?: boolean;
};

export const EDITOR_BINDINGS: EditorBinding[] = [
  // ── 'canvas' — the / route map canvas (PaintCanvas) ────────────────────────
  { action: 'view.pan', scope: 'canvas', keys: ['w', 'a', 's', 'd'], label: 'Pan the map view (hold; click the canvas to claim WASD)', legend: 'WASD pan', held: true },
  { action: 'view.pan-lock', scope: 'canvas', keys: ['f8'], label: 'Toggle the WASD pan focus lock (pan even while a text field is focused)', legend: 'F8 lock', whileTyping: true, held: true },
  { action: 'brush.rotate-cw', scope: 'canvas', keys: ['e', 'r'], label: 'Rotate the armed placement brush +90°', legend: 'E/R rotate' },
  { action: 'brush.rotate-ccw', scope: 'canvas', keys: ['q'], label: 'Rotate the armed placement brush −90°', legend: 'Q ccw' },
  { action: 'road.commit', scope: 'canvas', keys: ['enter'], label: 'Stamp the road draft (road layer)', legend: null },
  { action: 'road.cancel', scope: 'canvas', keys: ['escape'], label: 'Drop the road draft (road layer)', legend: null },

  // ── 'iso-build' — the iso 3D build pane (IsoAuthor) ────────────────────────
  { action: 'view.pan', scope: 'iso-build', keys: ['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'], label: 'Slide the view across the ground (hold)', legend: 'WASD pan', held: true },
  { action: 'camera.orbit-ccw', scope: 'iso-build', keys: ['q'], label: 'Orbit the iso camera left', legend: 'Q/E orbit' },
  { action: 'camera.orbit-cw', scope: 'iso-build', keys: ['e'], label: 'Orbit the iso camera right', legend: null },
  { action: 'view.recenter', scope: 'iso-build', keys: ['f', 'home'], label: 'Recenter the view on the build', legend: 'F recenter' },
  { action: 'selection.rotate', scope: 'iso-build', keys: ['r'], label: 'Rotate the armed ghost (or the selection) +90°', legend: 'R rotate' },
  { action: 'selection.delete', scope: 'iso-build', keys: ['delete', 'backspace'], label: 'Delete the selected pieces', legend: 'Del remove' },
  { action: 'selection.cancel', scope: 'iso-build', keys: ['escape'], label: 'Disarm the brush / clear the selection', legend: 'Esc clear' },

  // ── 'bench' — the workbench shell (uniform across every source) ───────────
  { action: 'bench.undo', scope: 'bench', keys: ['ctrl+z'], label: 'Undo (the active source)', legend: '^Z undo' },
  { action: 'bench.redo', scope: 'bench', keys: ['ctrl+y', 'ctrl+shift+z'], label: 'Redo (the active source)', legend: '^Y redo' },
  { action: 'bench.save', scope: 'bench', keys: ['ctrl+s'], label: 'Save (the active source)', legend: '^S save' },

  // ── 'studio' — the model editor viewport (StudioViewport) ──────────────────
  // Folds the hand-rolled selection-key listener (req_0978) into the contract.
  // Ctrl+Z/Y stay OUT of this scope on purpose: the always-active 'bench' scope
  // already owns history (delegating to the source), and Studio layers paint-vs-
  // model undo on its own — binding it here too would double-fire.
  { action: 'selection.cancel', scope: 'studio', keys: ['escape'], label: 'Clear the selection (or close the open popup / finish moving a backdrop)', legend: 'Esc clear' },
  { action: 'selection.all', scope: 'studio', keys: ['ctrl+a', 'meta+a'], label: 'Select every element of the active mode (vertex / edge / face)', legend: '^A all' },
  { action: 'selection.delete', scope: 'studio', keys: ['delete', 'backspace'], label: 'Delete the selected faces — or the selected rig joint / pivot', legend: 'Del remove' },
  { action: 'view.recenter', scope: 'studio', keys: ['f', 'home'], label: 'Reframe the camera on the model', legend: 'F reframe' },
];

const ACTION_ID_SHAPE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const CHORD_SHAPE = /^(ctrl\+)?(alt\+)?(shift\+)?(meta\+)?[a-z0-9]+$/;

/** Boundary validation, run once at module init: malformed rows and intra-scope
 *  key conflicts are boot-time errors. Exported so the P4 suite can feed it
 *  deliberately-broken tables. */
export function validateEditorBindings(bindings: EditorBinding[]): void {
  const owner = new Map<string, string>(); // `${scope}:${chord}` -> action
  for (const b of bindings) {
    if (!ACTION_ID_SHAPE.test(b.action)) {
      throw new Error(`editor controls: action id must be <concern>.<verb> kebab-case (got ${JSON.stringify(b.action)})`);
    }
    if (!b.keys.length) throw new Error(`editor controls: ${b.action} binds no keys`);
    for (const chord of b.keys) {
      if (!CHORD_SHAPE.test(chord)) {
        throw new Error(`editor controls: ${b.action} has a malformed chord ${JSON.stringify(chord)} (lowercase, modifiers in ctrl+alt+shift+meta order)`);
      }
      const slot = `${b.scope}:${chord}`;
      const holder = owner.get(slot);
      if (holder && holder !== b.action) {
        throw new Error(`editor controls: KEY CONFLICT in scope "${b.scope}" — "${chord}" is bound to both ${holder} and ${b.action}`);
      }
      owner.set(slot, b.action);
    }
  }
}
validateEditorBindings(EDITOR_BINDINGS);

export function bindingsForScope(scope: EditorScope): EditorBinding[] {
  return EDITOR_BINDINGS.filter((b) => b.scope === scope);
}

/** The discoverable keymap: every legend-bearing row of a scope, in table
 *  order. Render this; never hand-write a key hint string again. */
export function legendForScope(scope: EditorScope): { keys: string; label: string; legend: string }[] {
  return bindingsForScope(scope)
    .filter((b): b is EditorBinding & { legend: string } => b.legend !== null)
    .map((b) => ({ keys: b.keys.join('/'), label: b.label, legend: b.legend }));
}

export type EditorKeyEvent = {
  key?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

/** Normalize a key-bus event to a chord string ('e', 'ctrl+shift+z'). */
export function chordOf(ev: EditorKeyEvent): string {
  const base = String(ev?.key ?? '').toLowerCase();
  let chord = '';
  if (ev?.ctrlKey) chord += 'ctrl+';
  if (ev?.altKey) chord += 'alt+';
  if (ev?.shiftKey) chord += 'shift+';
  if (ev?.metaKey) chord += 'meta+';
  return chord + base;
}

/** The ONE typing gate (was re-implemented per surface): a host text input is
 *  focused, so plain-key actions must not fire. `__tel_input` reports the
 *  focused input id; -1/absent = none. */
export function editorTypingFocused(): boolean {
  const t = callHost<{ focused_id?: number } | null>('__tel_input', null);
  return !!t && Number(t.focused_id ?? -1) >= 0;
}

/** Resolve one key event against a scope's table. Phase 'down' matches the
 *  full chord and respects the typing gate. Phase 'up' is dispatched ONLY to
 *  held bindings, matches the BASE key with modifiers ignored (a modifier
 *  pressed mid-hold can't strand the release), and bypasses the gate (a key
 *  released while typing must still release). Exported for the P4 suite. */
export function resolveEditorKey(
  scope: EditorScope,
  phase: 'down' | 'up',
  ev: EditorKeyEvent,
  typingFocused: boolean,
): EditorBinding | null {
  const base = String(ev?.key ?? '').toLowerCase();
  if (!base) return null;
  const chord = chordOf(ev);
  for (const b of bindingsForScope(scope)) {
    if (phase === 'up') {
      if (!b.held) continue;
      if (b.keys.includes(base) || b.keys.includes(chord)) return b;
      continue;
    }
    if (!b.keys.includes(chord)) continue;
    if (typingFocused && !b.whileTyping) return null; // the gate is per-press, not per-table
    return b;
  }
  return null;
}
