// Canvas atom registry.
//
// An "atom" is anything the user can put on an action-bar slot, drop
// onto the canvas as a node, or click in the bag. The merged canvas
// route unifies what used to be three separate concepts:
//
//   - Composer's tool palette  (SEL, PAN, BOX, COPY, …)
//   - Sweatshop's IFTTT registry  (event:click, key:*, repeat, …)
//   - Anything new a cart wants to drop into the user's reach
//
// All three look the same from the user's seat: an icon in the bag
// that you can drag to a slot, a slot binding you can press to fire,
// and a node spawner you can drop on the canvas. The registry exists
// so the assistant has one place to ask "what can the user do here?"
// and one verb to invoke any of it.
//
// Atoms aren't wired to real handlers yet — `invoke` emits on a bus
// channel that the canvas page (and eventually the engine) listens
// for. v0: enough atoms to feel real, hosted as stubs. v1: each
// invoke calls into the actual subsystem.

import { busEmit } from '@reactjit/runtime/hooks/useIFTTT';
import {
  // Tool atoms
  MousePointer, Hand, PenLine, Crosshair,
  // Primitive spawners
  Square, Type, MousePointerClick, Image as ImageIcon, Frame,
  // Editing
  Copy, ClipboardPaste, BoxSelect, Trash2, Group, Ungroup, Undo2, Redo2,
  // Pages / layout
  MonitorCheck, FilePlus,
  // Triggers (sweatshop-style)
  MousePointerClick as ClickIcon, Search, Filter, Wand2,
  // Actions (sweatshop-style)
  Zap, Play, Bot, Pin,
  // Misc placeholders
  Sparkles, Hammer, Boxes, Layers, Sliders, Box as BoxIcon,
  Code, Settings, Eye, Move, FileCode, Plus, Minus,
} from '@reactjit/runtime/icons/icons';

// ── Atom shape ────────────────────────────────────────────────────

export type AtomGroup =
  | 'TOOLS'
  | 'PRIMITIVES'
  | 'TRIGGERS'
  | 'ACTIONS'
  | 'EDIT'
  | 'PAGES'
  | 'COMPOSITES';   // user-saved combos (later)

export interface Atom {
  /** Stable lowercase-dashed id. Persisted in slot bindings, snapshot
   *  history, and any tool args. Never rename — bindings would break.
   *  Add a new atom and migrate if you must rename. */
  id: string;
  /** Display name, shown in tooltips and the bag. */
  label: string;
  /** Lucide-style icon polyline data (number[][]). */
  icon: number[][];
  /** Bag section. Determines visual grouping and a default invoke
   *  semantics (see below). */
  group: AtomGroup;
  /** One-line description used by the assistant via canvas-list-atoms.
   *  Write it for an LLM, not a human — be specific about what
   *  invoking does and what context it needs. */
  description: string;
  /** Fire the atom. Called when:
   *   - user presses an action-bar slot bound to this atom
   *   - user clicks the atom directly in the bag
   *   - assistant calls canvas-invoke-atom { atomId }
   *  ctx carries cursor position, current selection, etc. so atoms
   *  that need it (spawners, editors) can act without a closure. */
  invoke: (ctx: InvokeCtx) => void;
}

/** Context handed to atom.invoke. Most atoms only use a couple of
 *  fields; richer atoms (spawners, edits) use more. */
export interface InvokeCtx {
  /** Where the user's cursor currently is in canvas coords. Used by
   *  spawners to drop a node near the pointer. */
  cursor: { x: number; y: number };
  /** Currently-selected node ids on the canvas. Used by edit atoms
   *  (copy, delete, group, …) and inspectors. */
  selection: string[];
  /** Free-form payload the assistant can attach when invoking via
   *  canvas-invoke-atom. Per-atom what it means. */
  args?: Record<string, any>;
}

// ── Registry ──────────────────────────────────────────────────────
//
// Module-level array. Cart code can register additional atoms via
// register(); the bag and action bar both read from `atoms()` so
// late registrations show up without any wiring on their side.

const _atoms: Atom[] = [];

export function register(atom: Atom): void {
  // Replace if id collision so hot-reload re-registration stays sane.
  const i = _atoms.findIndex((a) => a.id === atom.id);
  if (i >= 0) _atoms[i] = atom; else _atoms.push(atom);
}

export function atoms(): readonly Atom[] {
  return _atoms;
}

export function atomById(id: string | null | undefined): Atom | null {
  if (!id) return null;
  return _atoms.find((a) => a.id === id) ?? null;
}

export function atomsByGroup(group: AtomGroup): Atom[] {
  return _atoms.filter((a) => a.group === group);
}

/** Bag's display order — group headers from top to bottom. Anchors
 *  the section ordering in one place so the bag, the assistant
 *  prompt, and any list-atoms output all read the same way. */
export const ATOM_GROUP_ORDER: AtomGroup[] = [
  'TOOLS', 'PRIMITIVES', 'EDIT', 'PAGES', 'TRIGGERS', 'ACTIONS', 'COMPOSITES',
];

// ── Built-in atoms ────────────────────────────────────────────────
//
// invoke handlers are stubs — each emits a bus event the canvas page
// will subscribe to once content rendering lands. The event names
// follow the same `canvas:*` prefix the assistant control protocol
// uses, so the assistant can listen for what the user just did via
// the same channels it would emit on.

function emitInvoke(atomId: string, kind: string, payload?: any) {
  busEmit('canvas:atom:invoke', { atomId, kind, ...(payload ?? {}) });
}

// ── Tools — change canvas mode/cursor behavior. Single-shot.
register({
  id: 'tool-select', label: 'Select', icon: MousePointer, group: 'TOOLS',
  description: 'Switch the canvas to selection mode. Click selects a node; drag boxes a region.',
  invoke: () => emitInvoke('tool-select', 'set-tool', { tool: 'select' }),
});
register({
  id: 'tool-pan', label: 'Pan', icon: Hand, group: 'TOOLS',
  description: 'Switch to pan mode. Drag the canvas to scroll.',
  invoke: () => emitInvoke('tool-pan', 'set-tool', { tool: 'pan' }),
});
register({
  id: 'tool-draw', label: 'Draw', icon: PenLine, group: 'TOOLS',
  description: 'Switch to freehand draw mode for canvas annotations.',
  invoke: () => emitInvoke('tool-draw', 'set-tool', { tool: 'draw' }),
});
register({
  id: 'tool-cursor', label: 'Crosshair', icon: Crosshair, group: 'TOOLS',
  description: 'Pixel-precise cursor for measurement and aligned drops.',
  invoke: () => emitInvoke('tool-cursor', 'set-tool', { tool: 'cursor' }),
});

// ── Primitives — drop a UI primitive node on the canvas at cursor.
register({
  id: 'spawn-box', label: 'Box', icon: Square, group: 'PRIMITIVES',
  description: 'Drop a Box (container/panel) primitive at the cursor.',
  invoke: (ctx) => emitInvoke('spawn-box', 'spawn-primitive', { kind: 'Box', x: ctx.cursor.x, y: ctx.cursor.y }),
});
register({
  id: 'spawn-text', label: 'Text', icon: Type, group: 'PRIMITIVES',
  description: 'Drop a Text node at the cursor.',
  invoke: (ctx) => emitInvoke('spawn-text', 'spawn-primitive', { kind: 'Text', x: ctx.cursor.x, y: ctx.cursor.y }),
});
register({
  id: 'spawn-pressable', label: 'Button', icon: MousePointerClick, group: 'PRIMITIVES',
  description: 'Drop a Pressable (button) primitive at the cursor. Its onPress can be wired into the rule graph.',
  invoke: (ctx) => emitInvoke('spawn-pressable', 'spawn-primitive', { kind: 'Pressable', x: ctx.cursor.x, y: ctx.cursor.y }),
});
register({
  id: 'spawn-image', label: 'Image', icon: ImageIcon, group: 'PRIMITIVES',
  description: 'Drop an Image primitive at the cursor.',
  invoke: (ctx) => emitInvoke('spawn-image', 'spawn-primitive', { kind: 'Image', x: ctx.cursor.x, y: ctx.cursor.y }),
});
register({
  id: 'spawn-frame', label: 'Frame', icon: Frame, group: 'PRIMITIVES',
  description: 'Drop a Frame node — a labelled grouping container.',
  invoke: (ctx) => emitInvoke('spawn-frame', 'spawn-primitive', { kind: 'Frame', x: ctx.cursor.x, y: ctx.cursor.y }),
});

// ── Edit — operate on the current selection.
register({
  id: 'edit-copy', label: 'Copy', icon: Copy, group: 'EDIT',
  description: 'Copy the current selection to the canvas clipboard.',
  invoke: (ctx) => emitInvoke('edit-copy', 'edit', { op: 'copy', selection: ctx.selection }),
});
register({
  id: 'edit-paste', label: 'Paste', icon: ClipboardPaste, group: 'EDIT',
  description: 'Paste the canvas clipboard at the cursor.',
  invoke: (ctx) => emitInvoke('edit-paste', 'edit', { op: 'paste', x: ctx.cursor.x, y: ctx.cursor.y }),
});
register({
  id: 'edit-duplicate', label: 'Duplicate', icon: BoxSelect, group: 'EDIT',
  description: 'Duplicate the current selection in place.',
  invoke: (ctx) => emitInvoke('edit-duplicate', 'edit', { op: 'duplicate', selection: ctx.selection }),
});
register({
  id: 'edit-delete', label: 'Delete', icon: Trash2, group: 'EDIT',
  description: 'Delete the current selection.',
  invoke: (ctx) => emitInvoke('edit-delete', 'edit', { op: 'delete', selection: ctx.selection }),
});
register({
  id: 'edit-group', label: 'Group', icon: Group, group: 'EDIT',
  description: 'Group the current selection into a single Frame.',
  invoke: (ctx) => emitInvoke('edit-group', 'edit', { op: 'group', selection: ctx.selection }),
});
register({
  id: 'edit-ungroup', label: 'Ungroup', icon: Ungroup, group: 'EDIT',
  description: 'Ungroup the selected Frame back to its children.',
  invoke: (ctx) => emitInvoke('edit-ungroup', 'edit', { op: 'ungroup', selection: ctx.selection }),
});
register({
  id: 'edit-undo', label: 'Undo', icon: Undo2, group: 'EDIT',
  description: 'Undo the last canvas change.',
  invoke: () => emitInvoke('edit-undo', 'edit', { op: 'undo' }),
});
register({
  id: 'edit-redo', label: 'Redo', icon: Redo2, group: 'EDIT',
  description: 'Redo the last undone canvas change.',
  invoke: () => emitInvoke('edit-redo', 'edit', { op: 'redo' }),
});

// ── Pages — frame presets (mobile / web / etc.).
register({
  id: 'page-add', label: 'Add Page', icon: MonitorCheck, group: 'PAGES',
  description: 'Add a new page (artboard) to the canvas. Use args.preset for "mobile" | "tablet" | "web"; default web.',
  invoke: (ctx) => emitInvoke('page-add', 'page', { op: 'add', preset: ctx.args?.preset ?? 'web', x: ctx.cursor.x, y: ctx.cursor.y }),
});
register({
  id: 'page-new-doc', label: 'New Doc', icon: FilePlus, group: 'PAGES',
  description: 'Start a new canvas document (clears current).',
  invoke: () => emitInvoke('page-new-doc', 'page', { op: 'new-doc' }),
});

// ── Triggers (IFTTT-style). Each spawns a trigger node on the canvas.
register({
  id: 'trigger-click', label: 'Click', icon: ClickIcon, group: 'TRIGGERS',
  description: 'Spawn a click trigger node. Fires when its target is clicked.',
  invoke: (ctx) => emitInvoke('trigger-click', 'spawn-node', { kind: 'trigger', channel: 'event:click', x: ctx.cursor.x, y: ctx.cursor.y }),
});
register({
  id: 'trigger-key', label: 'Key', icon: Zap, group: 'TRIGGERS',
  description: 'Spawn a keyboard-trigger node. args.key sets the target key (e.g. "ctrl+s").',
  invoke: (ctx) => emitInvoke('trigger-key', 'spawn-node', { kind: 'trigger', channel: `key:${ctx.args?.key ?? 'space'}`, x: ctx.cursor.x, y: ctx.cursor.y }),
});
register({
  id: 'trigger-match', label: 'Match', icon: Search, group: 'TRIGGERS',
  description: 'Spawn a regex/string-match trigger node. args.pattern sets the matcher.',
  invoke: (ctx) => emitInvoke('trigger-match', 'spawn-node', { kind: 'trigger', channel: 'match', x: ctx.cursor.x, y: ctx.cursor.y, pattern: ctx.args?.pattern ?? '' }),
});
register({
  id: 'trigger-count', label: 'Count', icon: Filter, group: 'TRIGGERS',
  description: 'Spawn a windowed count trigger. args.n and args.windowMs set the threshold.',
  invoke: (ctx) => emitInvoke('trigger-count', 'spawn-node', { kind: 'trigger', channel: 'count', x: ctx.cursor.x, y: ctx.cursor.y, n: ctx.args?.n ?? 3, windowMs: ctx.args?.windowMs ?? 5000 }),
});
register({
  id: 'trigger-fuzzy', label: 'Fuzzy', icon: Wand2, group: 'TRIGGERS',
  description: 'Spawn a similarity-match trigger node. args.threshold sets the cosine cutoff.',
  invoke: (ctx) => emitInvoke('trigger-fuzzy', 'spawn-node', { kind: 'trigger', channel: 'fuzzy', x: ctx.cursor.x, y: ctx.cursor.y, threshold: ctx.args?.threshold ?? 0.8 }),
});

// ── Actions (IFTTT-style). Each spawns an action node on the canvas.
register({
  id: 'action-key', label: 'Send Key', icon: Zap, group: 'ACTIONS',
  description: 'Spawn an action node that synthesises a key press. args.key (default "space"), args.repeat (default 1).',
  invoke: (ctx) => emitInvoke('action-key', 'spawn-node', { kind: 'action', channel: 'key', x: ctx.cursor.x, y: ctx.cursor.y, key: ctx.args?.key ?? 'space', repeat: ctx.args?.repeat ?? 1 }),
});
register({
  id: 'action-run', label: 'Run', icon: Play, group: 'ACTIONS',
  description: 'Spawn a run-script action node. args.cmd is the shell command.',
  invoke: (ctx) => emitInvoke('action-run', 'spawn-node', { kind: 'action', channel: 'run', x: ctx.cursor.x, y: ctx.cursor.y, cmd: ctx.args?.cmd ?? '' }),
});
register({
  id: 'action-notify', label: 'Notify', icon: Bot, group: 'ACTIONS',
  description: 'Spawn a notify-user action node. args.text is the message body.',
  invoke: (ctx) => emitInvoke('action-notify', 'spawn-node', { kind: 'action', channel: 'notify-user', x: ctx.cursor.x, y: ctx.cursor.y, text: ctx.args?.text ?? '' }),
});
register({
  id: 'action-pin', label: 'Pin', icon: Pin, group: 'ACTIONS',
  description: 'Spawn a pin-to-top action node. Used to surface the trigger payload in the rail.',
  invoke: (ctx) => emitInvoke('action-pin', 'spawn-node', { kind: 'action', channel: 'pin', x: ctx.cursor.x, y: ctx.cursor.y }),
});
register({
  id: 'action-rule', label: 'Rule', icon: Sparkles, group: 'ACTIONS',
  description: 'Spawn a rule node (mid-pipeline filter). args.expr is the boolean condition.',
  invoke: (ctx) => emitInvoke('action-rule', 'spawn-node', { kind: 'rule', channel: 'rule', x: ctx.cursor.x, y: ctx.cursor.y, expr: ctx.args?.expr ?? '' }),
});

// ── Suppress unused-import warnings for icons we'll wire to atoms
//    in v1 (kept here so additions are one-line edits, not new
//    imports first). TS doesn't lint unused imports through `as`-
//    aliased names but does for direct names — touch them so the
//    bundler doesn't tree-shake them out before atoms reach for them.
void Hammer; void Boxes; void Layers; void Sliders; void BoxIcon;
void Code; void Settings; void Eye; void Move; void FileCode;
void Plus; void Minus;
