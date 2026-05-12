// Assistant tools for the /canvas route.
//
// Each tool is a thin shim: validate args, then `busEmit` on a
// canvas:cmd:* channel. The canvas page subscribes to those channels
// and applies the change to local state. v0 applies directly; v1
// (staging) routes the same emits through a stage proposal store.
//
// Read-side tools (canvas-describe, canvas-list-atoms) snapshot the
// current state synchronously so the assistant can reason without a
// round-trip. The state lives in module-level refs that CanvasPage
// publishes into on every render — keeps the tools a pure read of
// "what's on screen right now."
//
// Permission scopes follow the convention in tools/builtins.ts:
//   - chrome ops      → scope = panelId (or '*' for blanket)
//   - bag ops         → scope = '*'
//   - slot ops        → scope = String(slot)
//   - highlight       → scope = '*'  (cosmetic, no harm)
//   - invoke-atom     → scope = atomId
//   - describe / list → scope = '*'

import { busEmit } from '@reactjit/runtime/hooks/useIFTTT';
import { register, type Tool } from '../tools';
import { atoms as allAtoms, atomById, atomsByGroup, ATOM_GROUP_ORDER, type Atom } from './atoms';
import { loadHistory, loadHistoryIndex, type HistoryEntry } from './history';

// ── State publishers ──────────────────────────────────────────────
//
// CanvasPage calls publishCanvasState(snapshot) on every render so
// canvas-describe always returns fresh data. The shape mirrors what
// will be serialised into the snapshot history once that lands.

export interface CanvasSnapshot {
  panels: Array<{
    id: string;
    anchor: string;          // 'TL' | 'TC' | ... | 'BR'
    offset: { x: number; y: number };
    span: { w: number; h: number };
    hidden: boolean;
  }>;
  bag: { cols: 4 | 6 | 8 };
  slots: (string | null)[];  // length = current cols × rows of action bar
  // Future: canvasNodes, canvasEdges
}

let _latest: CanvasSnapshot | null = null;
export function publishCanvasState(s: CanvasSnapshot): void { _latest = s; }
export function readCanvasState(): CanvasSnapshot | null { return _latest; }

// ── Helpers ───────────────────────────────────────────────────────

const ANCHORS = new Set(['TL','TC','TR','ML','MC','MR','BL','BC','BR']);

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`${name}: must be a non-empty string`);
  return v;
}
function requireInt(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${name}: must be an integer, got ${JSON.stringify(v)}`);
  return n;
}
function optInt(v: unknown, name: string, dflt: number): number {
  if (v === undefined || v === null) return dflt;
  return requireInt(v, name);
}

// ── Read tools ────────────────────────────────────────────────────

const describeTool: Tool<Record<string, never>, CanvasSnapshot | { error: string }> = {
  name: 'canvas-describe',
  description: "Snapshot of what is currently on the user's canvas: panels (chrome) with anchors / offsets / sizes / hidden state, the bag's column setting, and the action bar's slot bindings (atom ids per slot). Always read this before proposing layout edits.",
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: () => readCanvasState() ?? { error: 'canvas-not-mounted: navigate to /canvas first' },
};

const listAtomsTool: Tool<Record<string, never>, {
  groups: Array<{ group: string; atoms: Array<{ id: string; label: string; description: string }> }>;
}> = {
  name: 'canvas-list-atoms',
  description: 'List every atom the user can put on action bar slots, drop on the canvas, or click in the bag. Grouped by section (TOOLS, PRIMITIVES, EDIT, PAGES, TRIGGERS, ACTIONS, COMPOSITES).',
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: () => ({
    groups: ATOM_GROUP_ORDER.map((g) => ({
      group: g,
      atoms: atomsByGroup(g).map((a: Atom) => ({ id: a.id, label: a.label, description: a.description })),
    })).filter((s) => s.atoms.length > 0),
  }),
};

// ── Chrome (panel layout) tools ───────────────────────────────────

const movePanelTool: Tool<{ panelId: string; anchor: string; offset?: { x?: number; y?: number } }, { ok: true }> = {
  name: 'canvas-move-panel',
  description: 'Move a HUD panel to a new anchor (TL/TC/TR/ML/MC/MR/BL/BC/BR) and optional cell offset {x,y} from that anchor. Call canvas-describe first to learn the current panel ids and anchors.',
  argsSchema: '{ panelId: string, anchor: "TL"|"TC"|"TR"|"ML"|"MC"|"MR"|"BL"|"BC"|"BR", offset?: { x?: int, y?: int } }',
  scopeOf: (a) => a?.panelId ?? '*',
  handler: ({ panelId, anchor, offset }) => {
    requireString(panelId, 'panelId');
    requireString(anchor, 'anchor');
    if (!ANCHORS.has(anchor)) throw new Error(`anchor: must be one of ${[...ANCHORS].join(',')}`);
    busEmit('canvas:cmd:move-panel', {
      panelId,
      anchor,
      offset: { x: optInt(offset?.x, 'offset.x', 0), y: optInt(offset?.y, 'offset.y', 0) },
    });
    return { ok: true };
  },
};

const resizePanelTool: Tool<{ panelId: string; span: { w: number; h: number } }, { ok: true }> = {
  name: 'canvas-resize-panel',
  description: 'Resize a HUD panel. Span is in cells (1 cell ≈ 56px). Min span is {w:2,h:1}.',
  argsSchema: '{ panelId: string, span: { w: int, h: int } }',
  scopeOf: (a) => a?.panelId ?? '*',
  handler: ({ panelId, span }) => {
    requireString(panelId, 'panelId');
    const w = requireInt(span?.w, 'span.w');
    const h = requireInt(span?.h, 'span.h');
    if (w < 1 || h < 1) throw new Error('span: w and h must be ≥ 1');
    busEmit('canvas:cmd:resize-panel', { panelId, span: { w, h } });
    return { ok: true };
  },
};

const togglePanelTool: Tool<{ panelId: string; show: boolean }, { ok: true }> = {
  name: 'canvas-toggle-panel',
  description: 'Show or hide a HUD panel. Hidden panels go to the stash strip and can be brought back by the user.',
  argsSchema: '{ panelId: string, show: boolean }',
  scopeOf: (a) => a?.panelId ?? '*',
  handler: ({ panelId, show }) => {
    requireString(panelId, 'panelId');
    if (typeof show !== 'boolean') throw new Error('show: must be boolean');
    busEmit('canvas:cmd:toggle-panel', { panelId, show });
    return { ok: true };
  },
};

const setBagColsTool: Tool<{ cols: number }, { ok: true }> = {
  name: 'canvas-set-bag-cols',
  description: 'Set the bag grid column count. Valid values: 4, 6, 8.',
  argsSchema: '{ cols: 4 | 6 | 8 }',
  scopeOf: () => '*',
  handler: ({ cols }) => {
    const c = requireInt(cols, 'cols');
    if (c !== 4 && c !== 6 && c !== 8) throw new Error('cols: must be 4, 6, or 8');
    busEmit('canvas:cmd:set-bag-cols', { cols: c });
    return { ok: true };
  },
};

const resetLayoutTool: Tool<Record<string, never>, { ok: true }> = {
  name: 'canvas-reset-layout',
  description: 'Reset the HUD layout (panel anchors, offsets, sizes) to defaults. Does not touch action bar slots or the bag config.',
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: () => {
    busEmit('canvas:cmd:reset-layout', {});
    return { ok: true };
  },
};

// ── Slot tools ────────────────────────────────────────────────────

const bindSlotTool: Tool<{ slot: number; atomId: string | null }, { ok: true }> = {
  name: 'canvas-bind-slot',
  description: 'Bind an atom to an action bar slot, or clear it (atomId: null). Slot is the flat index into the action bar grid (row * cols + col); slot 0 is the top-left, hotkey 1.',
  argsSchema: '{ slot: int, atomId: string | null }',
  scopeOf: (a) => String(a?.slot ?? '*'),
  handler: ({ slot, atomId }) => {
    const s = requireInt(slot, 'slot');
    if (s < 0) throw new Error('slot: must be ≥ 0');
    if (atomId !== null) {
      requireString(atomId, 'atomId');
      if (!atomById(atomId)) throw new Error(`atomId: unknown atom "${atomId}". Use canvas-list-atoms to see options.`);
    }
    busEmit('canvas:cmd:bind-slot', { slot: s, atomId });
    return { ok: true };
  },
};

const swapSlotsTool: Tool<{ from: number; to: number }, { ok: true }> = {
  name: 'canvas-swap-slots',
  description: 'Swap two action bar slots. Either or both can be empty (then it acts as a move).',
  argsSchema: '{ from: int, to: int }',
  scopeOf: (a) => `${a?.from ?? '*'},${a?.to ?? '*'}`,
  handler: ({ from, to }) => {
    const f = requireInt(from, 'from');
    const t = requireInt(to, 'to');
    if (f < 0 || t < 0) throw new Error('from/to: must be ≥ 0');
    busEmit('canvas:cmd:swap-slots', { from: f, to: t });
    return { ok: true };
  },
};

// ── Highlight + invoke ───────────────────────────────────────────

const highlightTool: Tool<{
  kind: 'atom' | 'slot' | 'panel';
  id: string | number;
  durationMs?: number;
  label?: string;
}, { ok: true }> = {
  name: 'canvas-highlight',
  description: 'Briefly glow something on the canvas to point the user at it. kind: "atom" + atom id, "slot" + slot index, or "panel" + panel id. Optional label shows as a caption next to the highlight. Duration defaults to 2500ms.',
  argsSchema: '{ kind: "atom"|"slot"|"panel", id: string|int, durationMs?: int, label?: string }',
  scopeOf: () => '*',
  handler: ({ kind, id, durationMs, label }) => {
    if (kind !== 'atom' && kind !== 'slot' && kind !== 'panel') {
      throw new Error('kind: must be "atom" | "slot" | "panel"');
    }
    const sid = String(id);
    if (!sid) throw new Error('id: must be non-empty');
    busEmit('canvas:cmd:highlight', {
      kind, id: sid,
      durationMs: optInt(durationMs, 'durationMs', 2500),
      label: typeof label === 'string' ? label : undefined,
    });
    return { ok: true };
  },
};

const invokeAtomTool: Tool<{ atomId: string; args?: Record<string, any> }, { ok: true }> = {
  name: 'canvas-invoke-atom',
  description: 'Fire an atom directly — same code path as the user pressing a hotkey or clicking the atom in the bag. For spawners (PRIMITIVES, TRIGGERS, ACTIONS) this drops a node on the canvas; for tools it switches mode; for edits it acts on the current selection. Optional args dict is per-atom (e.g. trigger-key takes {key: "ctrl+s"}).',
  argsSchema: '{ atomId: string, args?: Record<string, any> }',
  scopeOf: (a) => a?.atomId ?? '*',
  handler: ({ atomId, args }) => {
    requireString(atomId, 'atomId');
    const atom = atomById(atomId);
    if (!atom) throw new Error(`atomId: unknown atom "${atomId}". Use canvas-list-atoms to see options.`);
    busEmit('canvas:cmd:invoke-atom', { atomId, args: args ?? {} });
    return { ok: true };
  },
};

// ── History tools ────────────────────────────────────────────────

const undoTool: Tool<Record<string, never>, { ok: true }> = {
  name: 'canvas-undo',
  description: 'Step back one entry in the canvas history (rewind committed state to the previous snapshot). Same as the user pressing Ctrl+Z.',
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: () => { busEmit('canvas:cmd:undo', {}); return { ok: true }; },
};

const redoTool: Tool<Record<string, never>, { ok: true }> = {
  name: 'canvas-redo',
  description: 'Step forward one entry in the canvas history. No-op if already at the latest commit.',
  argsSchema: '{}',
  scopeOf: () => '*',
  handler: () => { busEmit('canvas:cmd:redo', {}); return { ok: true }; },
};

const historyTool: Tool<{ limit?: number }, {
  index: number;
  entries: Array<Pick<HistoryEntry, 'id' | 'ts' | 'author' | 'summary' | 'parent'>>;
}> = {
  name: 'canvas-history',
  description: 'List the most recent canvas history entries (newest first). Each entry has id, ts (ms), author (user|assistant), and a summary. The current head index is also returned. Default limit 20, max 100.',
  argsSchema: '{ limit?: int }  // default 20, max 100',
  scopeOf: () => '*',
  handler: ({ limit }) => {
    const lim = Math.max(1, Math.min(100, Number(limit ?? 20) | 0));
    const chain = loadHistory();
    const index = loadHistoryIndex();
    // Newest first; trim to limit. Strip the snapshot bodies so the
    // payload stays small — model can call canvas-describe for the
    // current state, and undo/redo to walk the chain.
    const entries = [...chain].reverse().slice(0, lim).map((e) => ({
      id: e.id, ts: e.ts, author: e.author, summary: e.summary, parent: e.parent,
    }));
    return { index, entries };
  },
};

// ── Registration entry ───────────────────────────────────────────

let _registered = false;
export function registerCanvasTools(): void {
  if (_registered) return;
  _registered = true;
  for (const t of [
    describeTool,
    listAtomsTool,
    movePanelTool,
    resizePanelTool,
    togglePanelTool,
    setBagColsTool,
    resetLayoutTool,
    bindSlotTool,
    swapSlotsTool,
    highlightTool,
    invokeAtomTool,
    undoTool,
    redoTool,
    historyTool,
  ]) {
    register(t);
  }
  // Touch the registry so atoms.ts is forced to load (its module
  // body is what populates the atom list). Without this reference,
  // a tree-shake could omit atoms and canvas-list-atoms would
  // return empty.
  void allAtoms;
}
