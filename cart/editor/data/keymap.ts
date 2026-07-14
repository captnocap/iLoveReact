// editor/data/keymap.ts — the central, surface-aware keybinding table.
//
// Before this, keys were scattered: menus DISPLAYED keys that were never bound (every world
// single-key), and ModelView hand-rolled a partial model map. This is the one place a key maps
// to a command, resolved against the surface in view — so the key a menu advertises is the key
// that actually fires. AppFrame drives world+global dispatch through commandForKeyEvent; the
// model surface's keys live in MODEL_KEYS (ModelView owns their execution — it holds the host
// tool api — but reads its assignments from here so the two never drift).
import { activeSurface } from './surfaces';
import { commandById, commandEnabled } from './commands';
import type { Modifiers } from '../../../runtime/hooks/useModifiers';
import type { EditorState, ModelToolSnapshot } from './types';

// Global chords fire on any surface. Each command still self-gates through
// commandEnabled. Keyed by a normalized chord string.
const GLOBAL_CHORDS: Record<string, string> = {
  'ctrl+n': 'new-map',
  'ctrl+o': 'open-map',
  'ctrl+p': 'open-file-explorer',
  'ctrl+shift+p': 'find-import-source',
  'ctrl+i': 'import-model-file',
  'ctrl+s': 'save-snapshot',
  'ctrl+z': 'undo-local',
  'ctrl+shift+z': 'redo-local',
  'ctrl+y': 'redo-local',
  'ctrl+h': 'toggle-eventbus',
  'ctrl+,': 'open-preferences',
};

// Bare world single-keys — only consulted when the world surface is in view (the model surface
// owns its own bare keys via MODEL_KEYS/ModelView). `delete` lives here so it deletes a world
// object on the world and never fights ModelView's mesh-element delete on a model.
const WORLD_KEYS: Record<string, string> = {
  b: 'place-piece',
  v: 'move-selection',
  n: 'paint-faces',
  c: 'open-color-studio',
  m: 'toggle-minimap',
  f: 'focus-selection',
  // W/A/S/D are the camera pan (WorldViewport owns them) — so no bare-key world command may claim
  // them. 'd' used to be Duplicate, which fired on every strafe and spammed copies of the phantom
  // selection (req_2558); 's' was the inert Set Spawn placeholder. Neither owns a world key now.
  ']': 'world.floor.step',
  delete: 'delete-selection',
  // R rotates the selected placed piece 90° (req_2733) — free on the world surface; the model
  // surface's R (rotate gizmo) lives in MODEL_KEYS and never collides.
  r: 'rotate-selection',
  // Esc drops back to the neutral Select tool — the modal "put the click down" (req_2550).
  escape: 'select-tool',
};

// Model bare-keys → command ids, dispatched (like the menus) through runCommand, which routes
// each to the host tool api / the outliner-syncing face-op handlers. `mode` disambiguates keys
// whose commands never coexist: B is Fill while painting / Glass in face mode; X is Face Safety
// while painting / Flip Face in face mode.
// (Delete/Backspace/Escape stay ModelView-local — they're viewport-native, not registry commands.)
export const MODEL_KEYS: { key: string; commandId: string; mode?: 'paint' | 'face' }[] = [
  { key: '1', commandId: 'mesh-vertex' },
  { key: '2', commandId: 'mesh-edge' },
  { key: '3', commandId: 'mesh-face' },
  { key: 'g', commandId: 'mesh-move' },
  { key: 's', commandId: 'mesh-scale' },
  { key: 'r', commandId: 'mesh-rotate' },
  { key: 'p', commandId: 'mesh-paint' },
  { key: 'f', commandId: 'mesh-focus' },
  { key: 'w', commandId: 'mesh-wire' },
  { key: 'k', commandId: 'mesh-cam-lock' },
  { key: 'e', commandId: 'mesh-extrude' },
  { key: 'l', commandId: 'mesh-loopcut' },
  { key: 'c', commandId: 'mesh-create-face' },
  // X is contextual exactly as the Studio control contract was: flip winding in
  // face mode, Face Safety while painting.
  { key: 'x', commandId: 'mesh-flip-face', mode: 'face' },
  { key: 'd', commandId: 'mesh-detach' },
  { key: 'o', commandId: 'mesh-solidify' },
  { key: 'm', commandId: 'mesh-merge-faces' },
  { key: 'b', commandId: 'mesh-paint-fill', mode: 'paint' },
  { key: 'b', commandId: 'mesh-glass', mode: 'face' },
  { key: 'n', commandId: 'mesh-paint-brush', mode: 'paint' },
  { key: 'x', commandId: 'mesh-paint-safety', mode: 'paint' },
  { key: 'y', commandId: 'mesh-paint-detail', mode: 'paint' },
];

/** Normalize a raw `__keydown` bus event into a Modifiers record — the fix for the DEAD
 *  chord path (req_2620 gap W). Two bridges emit onto the bus with DIFFERENT shapes:
 *  useModifiers' own bridge emits `{ key, mods: { ctrl, shift, alt, meta } }`, but the bridge
 *  that actually wins at boot is useIFTTT's (runtime/index.tsx pre-defines the __ifttt_* no-ops,
 *  so useModifiers' ensureBridge sees "already a function" and never installs) — and useIFTTT
 *  emits `{ key, ctrlKey, shiftKey, altKey, metaKey }` with NO `mods` object. useModifiers'
 *  g_mods fallback only updates `if (e.mods)`, so every chord arrived here with all-false
 *  modifiers: Ctrl+Z resolved as bare 'z' and keyboard undo never fired. The durable fix is one
 *  event shape in runtime/ (not this cart's file to change); this normalizer accepts BOTH. */
export function modifiersFromKeyEvent(e: any): Modifiers {
  if (e?.mods) return e.mods as Modifiers;
  return { ctrl: !!e?.ctrlKey, shift: !!e?.shiftKey, alt: !!e?.altKey, meta: !!e?.metaKey };
}

/** Drive ONE synthetic SDL key edge through the LIVE key bridge (__ifttt_onKeyDown — the
 *  exact global engine.zig pumps), so headless harnesses (RJIT_MESHOPS 'key' op, RJIT_EDKEYS)
 *  exercise the REAL keyboard pipeline end-to-end: bridge → __keydown bus → AppFrame's
 *  normalized subscription → this keymap → runCommand → host door. `parts` is
 *  ['ctrl','shift',...,'<key>'] — modifiers first, the key name last. */
export function syntheticKeyEdge(parts: string[]): { sym: number; mod: number } {
  const keyName = parts[parts.length - 1] ?? '';
  const sym = keyName.length === 1 ? keyName.charCodeAt(0) : keyName === 'escape' ? 27 : keyName === 'enter' ? 13 : 0;
  let mod = 0;
  if (parts.includes('ctrl')) mod |= 0x00c0;
  if (parts.includes('shift')) mod |= 0x0003;
  if (parts.includes('alt')) mod |= 0x0300;
  (globalThis as any).__ifttt_onKeyDown?.(mod * 0x100000000 + sym);
  return { sym, mod };
}

function chord(key: string, mods: Modifiers): string {
  const parts: string[] = [];
  if (mods.ctrl || mods.meta) parts.push('ctrl');
  if (mods.shift) parts.push('shift');
  if (mods.alt) parts.push('alt');
  parts.push(key);
  return parts.join('+');
}

// Resolve a bare model key against the live tool mode. Returns the first binding for the key whose
// mode matches (unmoded bindings always match): B → Fill while painting, Glass in face mode, else
// nothing; the paint sub-tools (N/X/Y) only while painting.
function modelCommandForKey(key: string, tool: ModelToolSnapshot): string | null {
  for (const b of MODEL_KEYS) {
    if (b.key !== key) continue;
    if (!b.mode) return b.commandId;
    if (b.mode === 'paint' && tool.paint) return b.commandId;
    if (b.mode === 'face' && tool.selMode === 3 && !tool.paint) return b.commandId;
  }
  return null;
}

/** Resolve a key edge to the command it should run on the current surface, or null. Global chords
 *  fire anywhere; bare keys resolve against the surface in view (world tools on the world, mesh
 *  tools on a model). Disabled commands (wrong surface, no selection, not-available) never fire. */
export function commandForKeyEvent(state: EditorState, key: string, mods: Modifiers): string | null {
  const gate = (id: string): string | null => (commandEnabled(commandById(id), state).on ? id : null);

  const global = GLOBAL_CHORDS[chord(key, mods)];
  if (global) return gate(global);

  if (mods.ctrl || mods.meta || mods.alt) return null;

  const surface = activeSurface(state);
  if (surface === 'world') {
    const world = WORLD_KEYS[key];
    if (world) return gate(world);
  } else if (surface === 'model') {
    const model = modelCommandForKey(key, state.modelTool);
    if (model) return gate(model);
  }
  return null;
}
