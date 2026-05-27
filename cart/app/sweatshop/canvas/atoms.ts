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
import { listIfttSources, listIfttActions } from '@reactjit/runtime/hooks/ifttt/registry';
// Side-effect import: registers `event:*`, `queue-job:*`, `notify-user:*` etc.
// so the trigger/action prefix lists below pick them up. Mirrors what
// sweatshop/page.tsx does to populate its palette.
import '@reactjit/runtime/hooks/ifttt/supervisor';
import {
  // Tool atoms
  MousePointer, Hand, PenLine, Crosshair,
  // Primitive spawners
  Square, Type, MousePointerClick, Image as ImageIcon, Frame,
  // Editing
  Copy, ClipboardPaste, BoxSelect, Trash2, Group, Ungroup, Undo2, Redo2,
  // Pages / layout
  MonitorCheck, FilePlus,
  // IFTTT default fallbacks
  Zap, Play, Bot,
  // Misc placeholders
  Sparkles, Hammer, Boxes, Layers, Sliders, Box as BoxIcon,
  Code, Settings, Eye, Move, FileCode, Plus, Minus,
} from '@reactjit/runtime/icons/icons';

// ── Atom shape ────────────────────────────────────────────────────

export type AtomGroup =
  | 'TOOLS'
  | 'PRIMITIVES'    // strong set + escape hatches (Box, Text, Pressable, Image, Frame)
  | 'TRIGGERS'
  | 'ACTIONS'
  | 'EDIT'
  | 'PAGES'
  | 'DOMAIN'        // sweatshop domain shapes (Goal, Plan, Worker, …)
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
  /** Optional baked SDF icon name. When set, IconButton routes to the
   *  pre-baked atlas (one batched draw); otherwise it falls back to
   *  rendering `icon` polylines through Graph.Path. Names live in
   *  runtime/icons/baked-names.ts. */
  iconName?: string;
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

// Generic SDF placeholder pool. Until the icon-bake step ships every
// Lucide name, atoms without an explicit `iconName` still get an SDF
// quad (fast path) by hashing their id into one of these. The bag's
// per-tile bg color carries the visual distinction; the icon shape is
// just a marker. Replace per-atom by setting `iconName` explicitly.
const PLACEHOLDER_ICON_NAMES = [
  'Heart', 'Search', 'ArrowRight', 'Plus', 'X', 'Settings',
  'Star', 'Home', 'Eye', 'User', 'Bell', 'Bookmark',
] as const;

function hash01(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return (h >>> 0) / 0xffffffff;
}

function placeholderIconName(id: string): string {
  return PLACEHOLDER_ICON_NAMES[Math.floor(hash01(id) * PLACEHOLDER_ICON_NAMES.length)];
}

export function register(atom: Atom): void {
  // Auto-fill iconName from the id when not provided, so every atom
  // routes through the SDF fast path even before bespoke icons are
  // baked. Caller-provided names always win.
  const filled: Atom = atom.iconName ? atom : { ...atom, iconName: placeholderIconName(atom.id) };
  // Replace if id collision so hot-reload re-registration stays sane.
  const i = _atoms.findIndex((a) => a.id === filled.id);
  if (i >= 0) _atoms[i] = filled; else _atoms.push(filled);
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
  'TOOLS', 'PRIMITIVES', 'EDIT', 'PAGES', 'TRIGGERS', 'ACTIONS', 'DOMAIN', 'COMPOSITES',
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

// ── Pages — the bridge between the composer's UI-sketch surface and
//    the sweatshop flow graph. A "page" here is a Design Reference:
//    the user drops an empty page on the canvas, sketches quick-and-
//    dirty UI inside (boxes, text, buttons, controls), and the page
//    itself IS a flow node. Other actions wire INTO it as "when the
//    flow reaches this point, reveal this design to the worker as
//    the shape the user seeks for the UI in this task."
//
//    Properties:
//      - id, name, width, height — the page surface
//      - preset                  — mobile / tablet / web defaults
//      - children                — nested composer SNode tree (Box /
//                                  Text / Pressable / GalleryAtom)
//      - bg                      — background color for the sketch
//
//    Ports (assigned when the flow renderer hydrates the spawn):
//      - in  : flow — "reveal-here" trigger
//      - out : flow — continuation after the worker acknowledges
const PAGE_PRESET_SIZES: Record<string, { width: number; height: number }> = {
  mobile: { width: 393, height: 852 },
  tablet: { width: 1024, height: 768 },
  web:    { width: 1440, height: 900 },
};
register({
  id: 'page-add', label: 'Add Page', icon: MonitorCheck, group: 'PAGES',
  description: 'Drop an empty page on the canvas. Sketch the UI you want the worker to follow at this point in the flow (boxes, text, buttons, controls). The page itself becomes a flow node — when reached, it reveals to the worker as the user-supplied UI reference for this task. args.preset = "mobile" | "tablet" | "web" (default web) sets the page dimensions.',
  invoke: (ctx) => {
    const preset: string = ctx.args?.preset ?? 'web';
    const dims = PAGE_PRESET_SIZES[preset] ?? PAGE_PRESET_SIZES.web;
    emitInvoke('page-add', 'spawn-node', {
      kind: 'design-ref',
      preset,
      name: '',
      width: dims.width,
      height: dims.height,
      bg: '#ffffff',
      padding: 16,
      gap: 8,
      children: [],
      // Flow-port hints so the sweatshop renderer can wire ports the
      // moment the spawn lands. Renderer is free to ignore and use
      // its own port discovery, but having these inline keeps the
      // node connectable out of the box.
      ports: [
        { id: 'reveal', side: 'in',  kind: 'flow', label: 'reveal — show this page to the worker as the UI reference' },
        { id: 'next',   side: 'out', kind: 'flow', label: 'next — fires after the worker acknowledges' },
      ],
      x: ctx.cursor.x,
      y: ctx.cursor.y,
    });
  },
});
register({
  id: 'page-new-doc', label: 'New Doc', icon: FilePlus, group: 'PAGES',
  description: 'Start a new canvas document (clears current).',
  invoke: () => emitInvoke('page-new-doc', 'page', { op: 'new-doc' }),
});

// ── IFTTT triggers + actions — populated from the runtime registry.
//    Same data the sweatshop palette walks (see cart/app/sweatshop/
//    canvas/palette.ts::capabilityNodes). Every prefix that any hook
//    declared via registerIfttSource / registerIfttAction shows up
//    here as a draggable atom; spawning it drops a trigger/action
//    node carrying the prefix as its `channel`.
//
//    The label/description are derived from the prefix (Title Case,
//    trailing colon stripped). Concrete prefixes (`event:click`)
//    spawn directly with that channel; prefix-only ones (`key:`)
//    leave the suffix blank for the user to fill in via Properties.

function titleCase(s: string): string {
  return s.split(/[:_-]/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Curated human-friendly descriptions for the load-bearing IFTTT
 *  prefixes. Lookups fall back to the auto-generated text when a
 *  prefix isn't listed here. Sourced from the canvas spec the user
 *  laid out — keep wording aligned with that so the bag's tooltips
 *  and the LLM-facing canvas-list-atoms output read the same way. */
const IFTTT_DESCRIPTIONS: Record<string, { label?: string; description: string }> = {
  // ── Triggers (sources) ───────────────────────────────────────
  'fs:any:':       { label: 'FS Any',     description: 'Fires when any file under the watched path changes.' },
  'fs:changed:':   { label: 'FS Changed', description: 'Fires when the specified file changes.' },
  'fs:created:':   { label: 'FS Created', description: 'Fires when a new file is created.' },
  'fs:deleted:':   { label: 'FS Deleted', description: 'Fires when a file is deleted.' },
  'match:':        { label: 'Match',      description: 'Fires when a string match is found on the channel.' },
  'mount':         { label: 'Mount',      description: 'Fires once on cart start. Use for one-shot setup steps.' },
  'repeat:':       { label: 'Repeat',     description: 'Loop the next node connection — repeats downstream firing on the configured cadence.' },
  'rule:':         { label: 'Rule',       description: 'Fires a string into the model as additional context. The suffix is the rule body.' },
  'run:':          { label: 'Run',        description: 'Fires when an action runs. The suffix targets a specific action verb.' },
  'state:':        { label: 'State',      description: 'Fires when a state value updates. The suffix is the state key.' },
  'timer:every:':  { label: 'Timer Every',description: 'Fires every N milliseconds. The suffix is the interval.' },
  'timer:once:':   { label: 'Timer Once', description: 'Fires once after N milliseconds. The suffix is the delay.' },
  'worker:':       { label: 'Worker',     description: 'Fires when the named worker becomes active.' },
  // ── Actions ──────────────────────────────────────────────────
  'halt-run':            { label: 'Halt Run',           description: 'Stops the run dead in its tracks. Use as a circuit breaker.' },
  'flag-pathology:':     { label: 'Flag Pathology',     description: 'Flag a pathology when invoked. Pairs well with match + timer:every for early-warning detection.' },
  'kick-to-supervisor':  { label: 'Kick to Supervisor', description: 'Pushes the trigger context as a notification to the supervisor on duty.' },
  'log:':                { label: 'Log',                description: 'Log the trigger payload for later review.' },
  'state:set:':          { label: 'State Set',          description: 'Set a state value. Suffix is the key; payload carries the new value.' },
  'state:toggle:':       { label: 'State Toggle',       description: 'Toggle a boolean state value at the keyed slot.' },
  'set-variable:':       { label: 'Set Variable',       description: 'Set a variable to a string / number / boolean / object. Suffix is the variable name.' },
  'send:':               { label: 'Send',               description: 'Sends a message on the named channel when triggered.' },
  'queue-job:':          { label: 'Queue Job',          description: 'Queue another job for the worker when this fires.' },
  'mark-status:':        { label: 'Mark Status',        description: 'Update the status of the current step.' },
  'proc:kill:':          { label: 'Proc Kill',          description: 'Kill the named process.' },
  'proc:spawn:':         { label: 'Proc Spawn',         description: 'Spawn a process. Suffix is the command line.' },
  'proc:write:':         { label: 'Proc Write',         description: 'Write to the stdin of a running process.' },
};

function ifttSourceAtomId(prefix: string): string {
  // Stable id keyed off the prefix; preserves the trailing ':' so
  // `event:click` and `event:click:` (if ever both registered) can't
  // collide. Prefix is lowercase ascii + ':' so it's URL-safe.
  return `trigger-${prefix.replace(/:$/, '')}`;
}
function ifttActionAtomId(prefix: string): string {
  return `action-${prefix.replace(/:$/, '')}`;
}

/** Resync TRIGGERS + ACTIONS atoms from the live IFTTT registry.
 *  Idempotent: register() replaces by id so calling repeatedly is
 *  safe (and cheap). Called at module init once the side-effect
 *  imports above have run; cart code can call it again later if a
 *  new hook registers a prefix at runtime (rare). */
export function syncIfttAtoms(): void {
  for (const prefix of listIfttSources()) {
    const id = ifttSourceAtomId(prefix);
    const trailing = prefix.endsWith(':');
    const override = IFTTT_DESCRIPTIONS[prefix];
    register({
      id,
      label: override?.label ?? titleCase(prefix.replace(/:$/, '')),
      icon: Zap,
      group: 'TRIGGERS',
      description: override?.description ?? (trailing
        ? `Spawn a ${prefix} trigger node. The suffix after "${prefix}" is the concrete channel — set it on the node's Properties panel.`
        : `Spawn an ${prefix} trigger node. Fires whenever ${prefix} fires.`),
      invoke: (ctx) => emitInvoke(id, 'spawn-node', {
        kind: 'trigger',
        channel: prefix,
        prefix,
        x: ctx.cursor.x,
        y: ctx.cursor.y,
      }),
    });
  }
  for (const prefix of listIfttActions()) {
    const id = ifttActionAtomId(prefix);
    const trailing = prefix.endsWith(':');
    const override = IFTTT_DESCRIPTIONS[prefix];
    register({
      id,
      label: override?.label ?? titleCase(prefix.replace(/:$/, '')),
      icon: Play,
      group: 'ACTIONS',
      description: override?.description ?? (trailing
        ? `Spawn a ${prefix} action node. The suffix after "${prefix}" is the concrete verb arg — set it on the node's Properties panel.`
        : `Spawn an ${prefix} action node.`),
      invoke: (ctx) => emitInvoke(id, 'spawn-node', {
        kind: 'action',
        channel: prefix,
        prefix,
        x: ctx.cursor.x,
        y: ctx.cursor.y,
      }),
    });
  }
}

syncIfttAtoms();

// ── Custom action nodes that aren't (yet) registered with the IFTTT
//    registry but are fundamental to the recipe surface. Each carries
//    its property defaults in the spawn payload so the canvas content
//    layer (and Properties panel) has somewhere to bind. As these get
//    real runtime backings, the matching registerIfttAction() call
//    lands and these spawn-payloads turn into actual dispatch.
interface CustomActionDef {
  id: string;
  label: string;
  description: string;
  channel: string;
  defaults: Record<string, any>;
}
const CUSTOM_ACTION_NODES: CustomActionDef[] = [
  {
    id: 'action-hitl',
    label: 'Human-in-the-Loop',
    description: 'Force-stops the run for human intervention. When triggered the worker pauses and yields the floor to the user; resume requires explicit acknowledgement.',
    channel: 'hitl',
    defaults: { reason: '', prompt: '', waiting: false },
  },
  {
    id: 'action-research',
    label: 'Research',
    description: 'Spawns a research task. type:"deep" walks the source graph and synthesises; type:"shallow" returns a single-pass summary. Sources / whitelist / blacklist constrain the corpus; topic / keywords drive the query.',
    channel: 'research',
    defaults: {
      type: 'shallow',          // 'deep' | 'shallow'
      sources: [] as string[],  // [] = all configured sources
      whitelist: [] as string[],
      blacklist: [] as string[],
      topic: '',
      keywords: [] as string[],
    },
  },
  {
    id: 'action-vector-search',
    label: 'Vector Search',
    description: 'Searches the embedding store for the given keyword(s). Returns top-k matches scored by cosine similarity.',
    channel: 'vector-search',
    defaults: {
      query: '',
      topK: 8,
      sourceType: '' as string,  // optional partial-index filter
    },
  },
  {
    id: 'action-insert-message',
    label: 'Insert Message',
    description: 'Fires a pre-written message into the conversation when triggered. Use to seed context, prime the next turn, or surface an alert.',
    channel: 'insert-message',
    defaults: { role: 'system', text: '' },
  },
];
for (const def of CUSTOM_ACTION_NODES) {
  register({
    id: def.id,
    label: def.label,
    icon: Play,
    group: 'ACTIONS',
    description: def.description,
    invoke: (ctx) => emitInvoke(def.id, 'spawn-node', {
      kind: 'action',
      channel: def.channel,
      prefix: def.channel,
      defaults: def.defaults,
      x: ctx.cursor.x,
      y: ctx.cursor.y,
    }),
  });
}

// ── Domain — supervisor-architecture shapes. Each spawns a token
//    node carrying the shape name + property defaults. The Properties
//    panel renders against those defaults; the canvas content layer
//    (once wired) reads them on resolve.
interface DomainShape {
  name: string;
  description: string;
  defaults?: Record<string, any>;
}
const DOMAIN_SHAPES: DomainShape[] = [
  {
    name: 'Goal',
    description: 'The top-level objective declared by the user. Acts as the guiding light that cascades down into how plans, tasks, and rules are aimed.',
    defaults: { statement: '', owner: 'user' },
  },
  {
    name: 'Plan',
    description: 'A set of tasks mapped out that work towards solving the user\'s goal.',
    defaults: { name: '', phases: [] as string[] },
  },
  {
    name: 'Task',
    description: 'An isolated set of actions that must be followed to complete one step of a plan.',
    defaults: { name: '', actions: [] as string[] },
  },
  {
    name: 'Worker',
    description: 'A runtime executor. Picks up queued jobs, runs actions, and reports status back up the supervisor.',
    defaults: { name: '', status: 'idle' },
  },
  {
    name: 'Supervisor',
    description: 'The task-local enforcer that watches a worker — applies rules, flags pathologies, holds the constraint contract.',
    defaults: { name: '' },
  },
  {
    name: 'Connection',
    description: 'How a model is reached — CLI, HTTP API, websocket, local subprocess, etc.',
    defaults: { kind: 'http', endpoint: '', auth: '' },
  },
  {
    name: 'Model',
    description: 'The specific model choice attached to a connection (Opus 4.7, Sonnet 4.6, etc.).',
    defaults: { id: '', label: '' },
  },
  {
    name: 'Rule',
    description: 'A persisted IF-THIS-THEN-THAT row — trigger spec on one side, action verb on the other.',
    defaults: { trigger: '', action: '', enabled: true },
  },
  {
    name: 'Pathology',
    description: 'A word / action / phrase the model is known to produce that is harmful to the development process. Auto-flagged when matched.',
    defaults: { pattern: '', severity: 'warn', active: true },
  },
  {
    name: 'Constraint',
    description: 'Things that CANNOT be done while working towards closing out a plan from its tasks — the contract floor.',
    defaults: { statement: '', scope: 'task' },
  },
  {
    name: 'Variable',
    description: 'A named slot for state that lives across the run. Set via set-variable, read by any action.',
    defaults: {
      id: '',
      name: '',
      value: '',
      type: 'string',
      createdDate: '',
      updatedDate: '',
    },
  },
  {
    name: 'Composition',
    description: 'A multi-stage work definition — the canonical recipe a worker executes.',
  },
  {
    name: 'CompositionRun',
    description: 'A per-execution snapshot of a Composition run — captures status, timing, and step outputs.',
  },
];
for (const s of DOMAIN_SHAPES) {
  register({
    id: `domain-${s.name.toLowerCase()}`,
    label: s.name,
    icon: BoxIcon,
    group: 'DOMAIN',
    description: s.description,
    invoke: (ctx) => emitInvoke(`domain-${s.name.toLowerCase()}`, 'spawn-node', {
      kind: 'token',
      shape: s.name,
      defaults: s.defaults ?? {},
      x: ctx.cursor.x,
      y: ctx.cursor.y,
    }),
  });
}

// ── Suppress unused-import warnings for icons we'll wire to atoms
//    in v1 (kept here so additions are one-line edits, not new
//    imports first). TS doesn't lint unused imports through `as`-
//    aliased names but does for direct names — touch them so the
//    bundler doesn't tree-shake them out before atoms reach for them.
void Hammer; void Boxes; void Layers; void Sliders; void BoxIcon;
void Code; void Settings; void Eye; void Move; void FileCode;
void Plus; void Minus; void Bot; void Sparkles;
