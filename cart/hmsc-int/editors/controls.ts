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
export type EditorScope = 'canvas' | 'iso-build' | 'bench' | 'studio' | 'studio-paint';

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
  // Edit modes (1–6) + transform tools (G/R/S, the Blender idiom) — the high-
  // frequency switches, so they earn keys and show them in their tooltips.
  { action: 'mode.object', scope: 'studio', keys: ['1'], label: 'Object mode', legend: null },
  { action: 'mode.vertex', scope: 'studio', keys: ['2'], label: 'Vertex mode', legend: null },
  { action: 'mode.edge', scope: 'studio', keys: ['3'], label: 'Edge mode', legend: null },
  { action: 'mode.face', scope: 'studio', keys: ['4'], label: 'Face mode', legend: null },
  { action: 'mode.rig', scope: 'studio', keys: ['5'], label: 'Rig mode', legend: null },
  { action: 'mode.paint', scope: 'studio', keys: ['6'], label: 'Paint mode', legend: null },
  { action: 'tool.move', scope: 'studio', keys: ['g'], label: 'Move tool', legend: null },
  { action: 'tool.rotate', scope: 'studio', keys: ['r'], label: 'Rotate tool', legend: null },
  { action: 'tool.resize', scope: 'studio', keys: ['s'], label: 'Resize / scale tool', legend: null },
  // Mesh ops — fire only in their context (face selection, etc.); mnemonic
  // defaults, all rebindable in the Hotkeys panel.
  { action: 'op.extrude', scope: 'studio', keys: ['e'], label: 'Extrude the selected face', legend: null },
  { action: 'op.loop-cut', scope: 'studio', keys: ['c'], label: 'Loop cut the selected face', legend: null },
  { action: 'op.flip', scope: 'studio', keys: ['x'], label: 'Flip the selected face(s) winding', legend: null },
  { action: 'op.glass', scope: 'studio', keys: ['b'], label: 'Toggle the selected face(s) as glass', legend: null },
  { action: 'op.detach', scope: 'studio', keys: ['d'], label: 'Detach the selected face(s) into a panel', legend: null },
  { action: 'op.solidify', scope: 'studio', keys: ['o'], label: 'Solidify the selected face(s) in place', legend: null },
  { action: 'op.symmetrize', scope: 'studio', keys: ['y'], label: 'Symmetrize — keep +half, rebuild the mirror', legend: null },

  // ── 'studio-paint' — the PAINT-mode tool family (req_1487) ─────────────────
  // A DISTINCT focus world, active only while painting, so the kit's native tool
  // keys (b/e/l/r/o/i — the same everywhere the kit ships) don't collide with the
  // mesh-op keys that share those letters in the 'studio' scope. Brush size has no
  // key (the bracket keys aren't valid chords here); the size dial owns it.
  { action: 'paint.brush', scope: 'studio-paint', keys: ['b'], label: 'Brush tool', legend: null },
  { action: 'paint.eraser', scope: 'studio-paint', keys: ['e'], label: 'Eraser tool', legend: null },
  { action: 'paint.line', scope: 'studio-paint', keys: ['l'], label: 'Line tool (hold Shift to snap to 45°)', legend: null },
  { action: 'paint.rect', scope: 'studio-paint', keys: ['r'], label: 'Rectangle tool (hold Shift for a square)', legend: null },
  { action: 'paint.ellipse', scope: 'studio-paint', keys: ['o'], label: 'Oval tool (hold Shift for a circle)', legend: null },
  { action: 'paint.eyedropper', scope: 'studio-paint', keys: ['i'], label: 'Eyedropper — sample a colour off the model', legend: null },
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

// ── USER OVERRIDES (req_1433): self-serve rebinding ────────────────────────
// The user can replace any action's chords without a code change. Overrides
// layer OVER the defaults; resolution, the legend, and tooltips all read
// bindingsForScope(), so a rebind updates every surface at once. This map is
// the contract's only mutable state — persistence (localstore) lives in the
// React layer (editors/keybinds.ts) so this file stays import-pure and
// headless-testable.
const userKeys = new Map<string, string[]>(); // `${scope}:${action}` -> chords
const overrideSlot = (scope: EditorScope, action: string) => `${scope}:${action}`;

export type RebindResult = { ok: true } | { ok: false; conflict: string };

/** Set a user override for one action. Validates each chord and rejects a
 *  collision with another action's EFFECTIVE chords in the same scope — the
 *  user-facing twin of validateEditorBindings (a warning, never a crash). */
export function setUserBinding(scope: EditorScope, action: string, keys: string[]): RebindResult {
  if (!keys.length) return { ok: false, conflict: 'bind at least one key' };
  for (const chord of keys) {
    if (!CHORD_SHAPE.test(chord)) return { ok: false, conflict: `"${chord}" is not a valid chord` };
  }
  for (const b of EDITOR_BINDINGS) {
    if (b.scope !== scope || b.action === action) continue;
    const other = userKeys.get(overrideSlot(b.scope, b.action)) ?? b.keys;
    const clash = keys.find((c) => other.includes(c));
    if (clash) return { ok: false, conflict: `"${clash}" is already bound to ${b.action}` };
  }
  userKeys.set(overrideSlot(scope, action), keys);
  return { ok: true };
}

export function clearUserBinding(scope: EditorScope, action: string): void {
  userKeys.delete(overrideSlot(scope, action));
}

export function isOverridden(scope: EditorScope, action: string): boolean {
  return userKeys.has(overrideSlot(scope, action));
}

/** Replace ALL overrides (boot-time load). Silently drops malformed/unknown
 *  entries so a corrupt store can never break input. */
export function loadUserBindings(saved: Record<string, string[]> | null | undefined): void {
  userKeys.clear();
  for (const [slot, keys] of Object.entries(saved ?? {})) {
    if (Array.isArray(keys) && keys.length && keys.every((k) => typeof k === 'string' && CHORD_SHAPE.test(k))) {
      userKeys.set(slot, keys);
    }
  }
}

export function exportUserBindings(): Record<string, string[]> {
  return Object.fromEntries(userKeys);
}

/** Effective bindings for a scope: defaults with any user override substituted
 *  in. Everything downstream (resolve, legend) reads this, so overrides apply
 *  uniformly. */
export function bindingsForScope(scope: EditorScope): EditorBinding[] {
  return EDITOR_BINDINGS
    .filter((b) => b.scope === scope)
    .map((b) => {
      const ov = userKeys.get(overrideSlot(b.scope, b.action));
      return ov ? { ...b, keys: ov } : b;
    });
}

// Set true by the rebind panel while it waits for a chord; gates resolveEditorKey.
let keyCaptureActive = false;
export function setKeyCapture(active: boolean): void { keyCaptureActive = active; }

/** Human-readable chord for display: 'ctrl+shift+z' -> 'Ctrl+Shift+Z',
 *  'escape' -> 'Esc'. Used by the rebind panel + key-bearing tooltips. */
export function prettyChord(chord: string): string {
  const NICE: Record<string, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Cmd', escape: 'Esc', delete: 'Del', backspace: 'Bksp', enter: 'Enter', home: 'Home', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right' };
  return chord.split('+').map((p) => NICE[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join('+');
}

/** The EFFECTIVE primary chord for an action, prettified for a tooltip — '' if
 *  the action is unbound. Reads bindingsForScope so a rebind is reflected. */
export function chordHintFor(scope: EditorScope, action: string): string {
  const b = bindingsForScope(scope).find((x) => x.action === action);
  return b && b.keys.length ? prettyChord(b.keys[0]) : '';
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
  // While the rebind panel is capturing the next chord, NOTHING dispatches —
  // otherwise pressing Delete to bind it would also delete the selection.
  if (keyCaptureActive) return null;
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
