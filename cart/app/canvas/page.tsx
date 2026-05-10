// Canvas — the merged sweatshop+composer route.
//
// Substrate: a single full-bleed pan/zoom <Canvas>. Every piece of
// chrome is a Canvas.Clamp-pinned panel that floats over it (WoW-HUD
// style). Panels live at one of 9 viewport anchors (TL/TC/TR/ML/MC/MR
// /BL/BC/BR) with cell-quantised offsets. Edit-UI mode shows a snap
// grid and lets the user drag any panel to a new anchor+offset.
//
// v0 scope (what works now):
//   - Anchor + offset + span layout solver
//   - Collision: walk in priority order, slide along anchored edge
//     on overlap, stash if no fit. Stash strip on the bag-bar shows
//     a chip per hidden panel; click to restore.
//   - Stub panels: ModeTabs, Bag, BagBar, Code, Properties, Minimap,
//     ActionBar. Each renders an icon-only placeholder so the layout
//     reads correctly even before content lands.
//   - Edit toggle on bag bar; while on, grid renders behind panels
//     and panel chrome accepts mouse-down to drag (tile_drag pattern,
//     raf + mouse-globals polling).
//   - Persistence: localStorage. useCRUD will replace this once the
//     panel doc shape is stable.
//
// What's deliberately NOT here yet (the "see what doesn't translate"
// part — these are the bridges the merge actually needs):
//   - Sweatshop's FlowEditor inside the canvas — currently the canvas
//     is empty. Wiring FlowEditor as canvas content is one swap.
//   - Composer's Canvas.Node pages on the same surface.
//   - Design ↔ rules bridge (prototype Pressables → triggers, rule
//     actions → prototype-state mutations).
//   - Live action bar key bindings (1-9 hotkeys).
//   - Real bag content (atoms from IFTTT registry + gallery).
//   - Per-user persisted layout via useCRUD.
//   - Measured canvas-viewport size (currently estimated from window
//     minus rail + chrome). Off by a few px on small windows.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Col, Row, Text, Pressable, Canvas, Native } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';
import {
  Box as BoxIcon, Code, Settings, Eye, EyeOff, Move, Grid3X3, Terminal, Map as MapIcon,
  Layers, Sparkles, Hammer, Boxes, FileCode, Plus, Minus, X, Zap, Play, Bot, Sliders,
} from '@reactjit/runtime/icons/icons';

// Unified atom registry shared with the assistant control surface.
// Bag, action bar, and (future) canvas content spawners all read from
// here, so a single registration shows up everywhere.
import { atoms as allAtoms, atomById, atomsByGroup, ATOM_GROUP_ORDER, type Atom, type AtomGroup } from './atoms';
// Assistant control surface — registering at module load so the tools
// are listable from chat even before the user visits /canvas. The
// canvas page itself subscribes to the canvas:cmd:* channels each
// tool emits on, and publishes its current state for canvas-describe.
import { publishCanvasState, registerCanvasTools, type CanvasSnapshot } from './tools';
import {
  loadHistory, loadHistoryIndex, saveHistory, pushEntry, snapshotsEqual,
  type HistoryEntry,
} from './history';

registerCanvasTools();

// ── Types ─────────────────────────────────────────────────────────

type Anchor =
  | 'TL' | 'TC' | 'TR'
  | 'ML' | 'MC' | 'MR'
  | 'BL' | 'BC' | 'BR';

type Rect = { x: number; y: number; w: number; h: number };

type PanelDef = {
  id: string;
  label: string;
  icon: number[][];
  defaultAnchor: Anchor;
  defaultOffset: { x: number; y: number };  // in cells
  span: { w: number; h: number };           // in cells
};

type PanelPlacement = {
  id: string;
  anchor: Anchor;
  offset: { x: number; y: number };
  // Optional per-placement size override (in cells). Falls back to
  // PanelDef.span when undefined. Lets the user resize a panel via
  // the corner handle without changing the registry default.
  span?: { w: number; h: number };
};

const MIN_SPAN_W = 2;  // header room for icon + label + close
const MIN_SPAN_H = 1;

// ── Constants ─────────────────────────────────────────────────────

const CELL = 56;
const LAYOUT_KEY = 'canvas_hud_layout_v0';
const ACTION_SLOTS_KEY = 'canvas_action_slots_v0';
const BAG_COLS_KEY = 'canvas_bag_cols_v0';
// ActionBar slot pixel size — slots are always 1:1, fixed pixel size.
// Number of cols/rows derives from the panel's pixel rect.
const SLOT_PX = 44;
// Shell estimates — used to convert window dims to canvas-viewport
// dims. Anything anchored to the right edge is off by ~8px until we
// read the canvas's measured size.
const RAIL_W_EST = 360;
const CHROME_H_EST = 44;

// ── Panel registry (stubs) ────────────────────────────────────────
//
// Order in this array IS the priority for collision resolution:
// earlier panels win their target rect; later panels slide or stash.
// Surfaces the user touches most go first.

const PANELS: PanelDef[] = [
  { id: 'modeTabs',  label: 'Mode',       icon: Grid3X3,  defaultAnchor: 'TL', defaultOffset: { x: 0, y: 0 }, span: { w: 6, h: 1 } },
  { id: 'bag',       label: 'Bag',        icon: BoxIcon,  defaultAnchor: 'ML', defaultOffset: { x: 0, y: 0 }, span: { w: 4, h: 8 } },
  { id: 'bagBar',    label: 'Bag bar',    icon: Sliders,  defaultAnchor: 'BL', defaultOffset: { x: 0, y: 0 }, span: { w: 6, h: 1 } },
  { id: 'actionBar', label: 'Action bar', icon: Zap,      defaultAnchor: 'BC', defaultOffset: { x: 0, y: 0 }, span: { w: 9, h: 2 } },
  { id: 'code',      label: 'Code',       icon: Code,     defaultAnchor: 'TR', defaultOffset: { x: 0, y: 1 }, span: { w: 5, h: 4 } },
  { id: 'props',     label: 'Properties', icon: Settings, defaultAnchor: 'MR', defaultOffset: { x: 0, y: 0 }, span: { w: 5, h: 5 } },
  { id: 'minimap',   label: 'Minimap',    icon: MapIcon,  defaultAnchor: 'TR', defaultOffset: { x: 0, y: 0 }, span: { w: 3, h: 1 } },
];

const DEFAULT_LAYOUT: PanelPlacement[] = PANELS.map((p) => ({
  id: p.id, anchor: p.defaultAnchor, offset: p.defaultOffset,
}));

// ── Layout persistence ────────────────────────────────────────────

function loadLayout(): PanelPlacement[] {
  try {
    const raw = (globalThis as any).localStorage?.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_LAYOUT;
    // Drop unknown ids; fill missing with defaults so adding a new
    // panel doesn't strand it because the saved layout predates it.
    const known = new Map(PANELS.map((p) => [p.id, p]));
    const seen = new Set<string>();
    const out: PanelPlacement[] = [];
    for (const item of parsed) {
      if (item && typeof item.id === 'string' && known.has(item.id) && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item as PanelPlacement);
      }
    }
    for (const p of PANELS) if (!seen.has(p.id)) out.push({ id: p.id, anchor: p.defaultAnchor, offset: p.defaultOffset });
    return out;
  } catch { return DEFAULT_LAYOUT; }
}
function saveLayout(layout: PanelPlacement[]) {
  try {
    (globalThis as any).localStorage?.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch { /* ignore */ }
}

// Action bar slots — flat array, indexed (row*cols + col). Each slot
// is null or an atom id. Length is dynamic; padded/trimmed at render
// time to match the action bar's current cols×rows.
function defaultSlotSeed(): (string | null)[] {
  // First-row seed: pick a sensible mix the user is likely to want
  // bound out of the box (select tool, primitive spawners, edits).
  // Fall back to first-N-of-registry if any of these aren't present.
  const preferred = [
    'tool-select', 'spawn-box', 'spawn-text', 'spawn-pressable',
    'edit-copy', 'edit-paste', 'edit-duplicate', 'edit-delete', 'edit-undo',
  ];
  const seed: (string | null)[] = preferred.map((id) => atomById(id) ? id : null);
  // Fill any nulls with the first registry atoms not already in seed.
  const used = new Set(seed.filter((s): s is string => !!s));
  let i = 0;
  for (let s = 0; s < seed.length; s++) {
    if (seed[s] != null) continue;
    while (i < allAtoms().length && used.has(allAtoms()[i].id)) i++;
    if (i < allAtoms().length) { seed[s] = allAtoms()[i].id; used.add(allAtoms()[i].id); i++; }
  }
  return seed;
}
function loadActionSlots(): (string | null)[] {
  try {
    const raw = (globalThis as any).localStorage?.getItem(ACTION_SLOTS_KEY);
    if (!raw) return defaultSlotSeed();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultSlotSeed();
    return parsed.map((s) => (typeof s === 'string' && atomById(s) ? s : null));
  } catch { return defaultSlotSeed(); }
}
function saveActionSlots(slots: (string | null)[]) {
  try { (globalThis as any).localStorage?.setItem(ACTION_SLOTS_KEY, JSON.stringify(slots)); } catch { /* ignore */ }
}

// Bag columns config — the number of 1:1 tiles per row in the bag.
// Cycles 4 → 6 → 8 → 4. Tile size derives from panel width / cols.
const BAG_COL_OPTS = [4, 6, 8] as const;
type BagCols = typeof BAG_COL_OPTS[number];
function loadBagCols(): BagCols {
  try {
    const raw = (globalThis as any).localStorage?.getItem(BAG_COLS_KEY);
    const n = Number(raw);
    if (BAG_COL_OPTS.includes(n as BagCols)) return n as BagCols;
  } catch { /* ignore */ }
  return 4;
}
function saveBagCols(c: BagCols) {
  try { (globalThis as any).localStorage?.setItem(BAG_COLS_KEY, String(c)); } catch { /* ignore */ }
}

// ── Mouse + viewport (tile_drag pattern) ──────────────────────────

const host: any = globalThis as any;
function readMouseX(): number { try { const v = Number(host.getMouseX?.()); return Number.isFinite(v) ? v : 0; } catch { return 0; } }
function readMouseY(): number { try { const v = Number(host.getMouseY?.()); return Number.isFinite(v) ? v : 0; } catch { return 0; } }
function readMouseDown(): boolean { try { return !!host.getMouseDown?.(); } catch { return false; } }

function readViewportW(): number {
  const w = Number(host.__viewport_width?.() ?? host.innerWidth ?? 1280);
  return Math.max(400, w - RAIL_W_EST);
}
function readViewportH(): number {
  const h = Number(host.__viewport_height?.() ?? host.innerHeight ?? 800);
  return Math.max(300, h - CHROME_H_EST);
}

// ── Layout solver ─────────────────────────────────────────────────

function defFor(id: string): PanelDef | undefined {
  return PANELS.find((p) => p.id === id);
}

function effectiveSpan(p: PanelPlacement, def: PanelDef): { w: number; h: number } {
  return p.span ?? def.span;
}

function resolveRect(p: PanelPlacement, vw: number, vh: number): Rect | null {
  const def = defFor(p.id);
  if (!def) return null;
  const sp = effectiveSpan(p, def);
  const w = sp.w * CELL;
  const h = sp.h * CELL;
  let x = 0, y = 0;
  switch (p.anchor[1]) {
    case 'L': x = 0 + p.offset.x * CELL; break;
    case 'C': x = (vw - w) / 2 + p.offset.x * CELL; break;
    case 'R': x = vw - w - p.offset.x * CELL; break;
  }
  switch (p.anchor[0]) {
    case 'T': y = 0 + p.offset.y * CELL; break;
    case 'M': y = (vh - h) / 2 + p.offset.y * CELL; break;
    case 'B': y = vh - h - p.offset.y * CELL; break;
  }
  return { x, y, w, h };
}

function inBounds(r: Rect, vw: number, vh: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= vw && r.y + r.h <= vh;
}
// Looser check used at rest — a panel only stashes if NOTHING of it
// is on-screen. Partial overhang is fine and stays where it is. The
// strict inBounds is only used during edgeSnap to pick valid
// candidates; otherwise we'd lose a panel the second the user resizes
// the window down a few pixels.
function partiallyVisible(r: Rect, vw: number, vh: number): boolean {
  return r.x + r.w > 0 && r.y + r.h > 0 && r.x < vw && r.y < vh;
}
function overlaps(a: Rect, b: Rect): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

// Edge-snap collision resolution. When the target rect collides with
// already-placed panels, push it to abut one of them on the side
// closest to the target's original position. Avoids the "1-cell slide
// loop" feel where panels almost-touch but never lay flush, and
// crucially gives the same flush result regardless of whether the
// colliding panels are L/R/T/B/C/M anchored.
function edgeSnap(target: Rect, placed: Array<{ rect: Rect }>, vw: number, vh: number): Rect | null {
  const candidates: Rect[] = [];
  for (const other of placed) {
    if (!overlaps(target, other.rect)) continue;
    // Four flush positions around `other`. Each preserves target's
    // size; only x or y shifts.
    candidates.push({ ...target, x: other.rect.x - target.w });            // abut left of other
    candidates.push({ ...target, x: other.rect.x + other.rect.w });         // abut right of other
    candidates.push({ ...target, y: other.rect.y - target.h });             // abut above other
    candidates.push({ ...target, y: other.rect.y + other.rect.h });         // abut below other
  }
  const valid: Rect[] = [];
  for (const c of candidates) {
    if (!inBounds(c, vw, vh)) continue;
    let ok = true;
    for (const it of placed) if (overlaps(c, it.rect)) { ok = false; break; }
    if (ok) valid.push(c);
  }
  if (valid.length === 0) return null;
  // Pick the candidate closest to the original target position.
  valid.sort((a, b) =>
    Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y)
  );
  return valid[0];
}

// Drag-time magnetic edge snap. When the dragged panel's rect has any
// edge within SNAP_PX of any non-dragged placed panel's matching edge,
// adjust the rect so the edges are flush. Applied BEFORE the rect is
// converted back into anchor+offset, so the snap survives the round-
// trip even when the panel is centered-anchored.
const SNAP_PX = 8;
function magneticSnap(rect: Rect, placed: Array<{ id: string; rect: Rect }>, draggedId: string): Rect {
  let { x, y, w, h } = rect;
  for (const it of placed) {
    if (it.id === draggedId) continue;
    // Horizontal edge alignment: dragged-right ↔ other-left, etc.
    if (Math.abs((x + w) - it.rect.x) < SNAP_PX) x = it.rect.x - w;
    else if (Math.abs(x - (it.rect.x + it.rect.w)) < SNAP_PX) x = it.rect.x + it.rect.w;
    else if (Math.abs(x - it.rect.x) < SNAP_PX) x = it.rect.x;
    else if (Math.abs((x + w) - (it.rect.x + it.rect.w)) < SNAP_PX) x = it.rect.x + it.rect.w - w;
    // Vertical edge alignment.
    if (Math.abs((y + h) - it.rect.y) < SNAP_PX) y = it.rect.y - h;
    else if (Math.abs(y - (it.rect.y + it.rect.h)) < SNAP_PX) y = it.rect.y + it.rect.h;
    else if (Math.abs(y - it.rect.y) < SNAP_PX) y = it.rect.y;
    else if (Math.abs((y + h) - (it.rect.y + it.rect.h)) < SNAP_PX) y = it.rect.y + it.rect.h - h;
  }
  // Snap to viewport edges, all four sides, same threshold.
  return { x, y, w, h };
}
function snapToViewportEdges(rect: Rect, vw: number, vh: number): Rect {
  let { x, y, w, h } = rect;
  if (x < SNAP_PX) x = 0;
  else if (Math.abs((x + w) - vw) < SNAP_PX) x = vw - w;
  if (y < SNAP_PX) y = 0;
  else if (Math.abs((y + h) - vh) < SNAP_PX) y = vh - h;
  return { x, y, w, h };
}
// Hard clamp — panel rect never leaves the viewport. Cursor can.
function clampToViewport(rect: Rect, vw: number, vh: number): Rect {
  return {
    x: Math.max(0, Math.min(vw - rect.w, rect.x)),
    y: Math.max(0, Math.min(vh - rect.h, rect.y)),
    w: rect.w, h: rect.h,
  };
}

function solveLayout(layout: PanelPlacement[], vw: number, vh: number, hidden: Set<string>) {
  const placed: Array<{ id: string; rect: Rect }> = [];
  const stashed: string[] = [];
  for (const p of layout) {
    if (hidden.has(p.id)) continue;
    const target = resolveRect(p, vw, vh);
    if (!target) continue;
    let collides = false;
    for (const it of placed) if (overlaps(target, it.rect)) { collides = true; break; }
    // Accept the target if it doesn't collide AND something of it is
    // on-screen. Partial overhang (right/bottom edge past viewport) is
    // tolerated rather than stashed — viewport changes shouldn't
    // suddenly hide a panel; the user resized, the panel just sticks
    // out a bit until they move it.
    if (!collides && partiallyVisible(target, vw, vh)) {
      placed.push({ id: p.id, rect: target });
      continue;
    }
    const snapped = edgeSnap(target, placed, vw, vh);
    if (snapped) placed.push({ id: p.id, rect: snapped });
    else if (partiallyVisible(target, vw, vh)) {
      // Couldn't snap (everything around the collision is occupied)
      // but the target is at least partially visible — keep it where
      // it is rather than stash. The user can drag it later.
      placed.push({ id: p.id, rect: target });
    } else {
      stashed.push(p.id);
    }
  }
  return { placed, stashed };
}

// ── Page ──────────────────────────────────────────────────────────

// ── Stage proposal ops ───────────────────────────────────────────
//
// Assistant-driven canvas commands don't mutate state directly any
// more — they push a CanvasOp into the staging queue. The live
// render derives from applyOps(committed, stagedOps), so the user
// sees the proposal exactly as it would land. Lock + diff overlay
// + chat card resolve the proposal.

type CanvasOp =
  | { type: 'move-panel'; panelId: string; anchor: Anchor; offset: { x: number; y: number } }
  | { type: 'resize-panel'; panelId: string; span: { w: number; h: number } }
  | { type: 'toggle-panel'; panelId: string; show: boolean }
  | { type: 'set-bag-cols'; cols: BagCols }
  | { type: 'bind-slot'; slot: number; atomId: string | null }
  | { type: 'swap-slots'; from: number; to: number }
  | { type: 'reset-layout' };

interface CommittedState {
  layout: PanelPlacement[];
  hidden: Set<string>;
  bagCols: BagCols;
  actionSlots: (string | null)[];
}

function applyOps(s: CommittedState, ops: CanvasOp[]): CommittedState {
  let { layout, hidden, bagCols, actionSlots } = s;
  for (const op of ops) {
    switch (op.type) {
      case 'move-panel':
        layout = layout.map((p) => p.id === op.panelId ? { ...p, anchor: op.anchor, offset: { ...op.offset } } : p);
        break;
      case 'resize-panel':
        layout = layout.map((p) => p.id === op.panelId ? { ...p, span: { ...op.span } } : p);
        break;
      case 'toggle-panel': {
        const next = new Set(hidden);
        if (op.show) next.delete(op.panelId); else next.add(op.panelId);
        hidden = next;
        break;
      }
      case 'set-bag-cols':
        bagCols = op.cols;
        break;
      case 'bind-slot': {
        const padTo = Math.max(actionSlots.length, op.slot + 1);
        const next: (string | null)[] = [];
        for (let i = 0; i < padTo; i++) next.push(actionSlots[i] ?? null);
        next[op.slot] = op.atomId;
        actionSlots = next;
        break;
      }
      case 'swap-slots': {
        const padTo = Math.max(actionSlots.length, op.from + 1, op.to + 1);
        const next: (string | null)[] = [];
        for (let i = 0; i < padTo; i++) next.push(actionSlots[i] ?? null);
        const tmp = next[op.from] ?? null;
        next[op.from] = next[op.to] ?? null;
        next[op.to] = tmp;
        actionSlots = next;
        break;
      }
      case 'reset-layout':
        layout = DEFAULT_LAYOUT;
        hidden = new Set();
        break;
    }
  }
  return { layout, hidden, bagCols, actionSlots };
}

// Compute which UI targets (panel ids, slot indices, the bag) the
// staged ops would affect. Drives the diff overlay so the user sees
// exactly what the proposal touches before deciding.
interface DiffTargets {
  panelIds: Set<string>;
  slots: Set<number>;
  bagChanged: boolean;
}
function diffTargets(ops: CanvasOp[]): DiffTargets {
  const panelIds = new Set<string>();
  const slots = new Set<number>();
  let bagChanged = false;
  for (const op of ops) {
    switch (op.type) {
      case 'move-panel':
      case 'resize-panel':
      case 'toggle-panel':
        panelIds.add(op.panelId);
        break;
      case 'bind-slot':
        slots.add(op.slot);
        break;
      case 'swap-slots':
        slots.add(op.from);
        slots.add(op.to);
        break;
      case 'set-bag-cols':
        bagChanged = true;
        panelIds.add('bag');
        break;
      case 'reset-layout':
        for (const p of PANELS) panelIds.add(p.id);
        break;
    }
  }
  return { panelIds, slots, bagChanged };
}

// Transient "look here" overlay marker. Module-level so PanelView /
// PanelContent / BagStub / ActionBarStub can type against it without
// re-exporting from inside CanvasPage.
type Highlight = {
  kind: 'atom' | 'slot' | 'panel';
  id: string;             // atom id / String(slot index) / panel id
  expiresAt: number;
  label?: string;
};
function findHighlight(hs: Highlight[], kind: Highlight['kind'], id: string): Highlight | undefined {
  return hs.find((h) => h.kind === kind && h.id === id);
}

export default function CanvasPage() {
  const [layout, setLayout] = useState<PanelPlacement[]>(loadLayout);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [editMode, setEditMode] = useState(false);
  const [actionSlots, setActionSlots] = useState<(string | null)[]>(loadActionSlots);
  const [bagCols, setBagCols] = useState<BagCols>(loadBagCols);
  // Live alt-key state. SDL only delivers modifiers via key events,
  // so we mirror altKey on every __keydown / __keyup. Held alt during
  // a slot mouse-down kicks off a slot-rearrange drag; releasing alt
  // mid-drag doesn't cancel — by then dragSlotRef is the source of
  // truth.
  const altDownRef = useRef(false);
  useIFTTT('__keydown', (ev: any) => { altDownRef.current = !!ev?.altKey; });
  useIFTTT('__keyup',   (ev: any) => { altDownRef.current = !!ev?.altKey; });
  useEffect(() => { saveActionSlots(actionSlots); }, [actionSlots]);
  useEffect(() => { saveBagCols(bagCols); }, [bagCols]);

  // ── History ──────────────────────────────────────────────────
  // Linear chain of committed snapshots; current index = head we're
  // currently rendering. User edits debounce-push; assistant accepts
  // push immediately. Undo/redo restore committed from chain[index].
  // No staging — we never restore into staged.
  const historyChainRef = useRef<HistoryEntry[]>(loadHistory());
  const historyIndexRef = useRef<number>(loadHistoryIndex());

  const buildSnapshot = useCallback((): CanvasSnapshot => ({
    panels: layout.map((p) => {
      const def = defFor(p.id);
      const span = p.span ?? def?.span ?? { w: 1, h: 1 };
      return {
        id: p.id, anchor: p.anchor,
        offset: { ...p.offset }, span: { ...span },
        hidden: hidden.has(p.id),
      };
    }),
    bag: { cols: bagCols },
    slots: [...actionSlots],
  }), [layout, hidden, bagCols, actionSlots]);

  const pushHistory = useCallback((snap: CanvasSnapshot, author: 'user' | 'assistant', summary: string) => {
    const head = historyChainRef.current[historyIndexRef.current];
    if (head && snapshotsEqual(head.snapshot, snap)) return;
    const { chain, index } = pushEntry(historyChainRef.current, historyIndexRef.current, snap, author, summary);
    historyChainRef.current = chain;
    historyIndexRef.current = index;
    saveHistory(chain, index);
  }, []);

  // Bootstrap: ensure there's at least one entry so undo from any
  // future change has a target. Runs once on mount; if localStorage
  // already has history, the snapshotsEqual dedupe in pushHistory
  // skips when current state matches the head.
  useEffect(() => {
    if (historyChainRef.current.length === 0) {
      pushHistory(buildSnapshot(), 'user', 'initial');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore committed state from a history snapshot. Used by
  // undo/redo subscribers. Also touches saveHistory so the index
  // pointer persists (the chain itself didn't change).
  const restoreFromSnapshot = useCallback((snap: CanvasSnapshot) => {
    setLayout(snap.panels.map((p) => ({
      id: p.id, anchor: p.anchor as Anchor,
      offset: { ...p.offset }, span: { ...p.span },
    })));
    setHidden(new Set(snap.panels.filter((p) => p.hidden).map((p) => p.id)));
    setBagCols(snap.bag.cols);
    setActionSlots([...snap.slots]);
    saveHistory(historyChainRef.current, historyIndexRef.current);
  }, []);

  // ── Stage proposal ────────────────────────────────────────────
  // Assistant edits go into stagedOps (not directly into committed
  // state). Live render = applyOps(committed, stagedOps). Empty
  // queue = no proposal, canvas behaves normally. Non-empty = canvas
  // is "staged" — user gestures are locked, the diff overlay
  // renders, the chat is expected to surface a stage card.
  const [stagedOps, setStagedOps] = useState<CanvasOp[]>([]);
  const stagedActive = stagedOps.length > 0;
  const live = stagedActive
    ? applyOps({ layout, hidden, bagCols, actionSlots }, stagedOps)
    : { layout, hidden, bagCols, actionSlots };
  const stagedTargets = stagedActive ? diffTargets(stagedOps) : null;

  // ── Highlights ────────────────────────────────────────────────
  // Transient "look here" overlays driven by the assistant via the
  // canvas-highlight tool. Each entry auto-expires after its window.
  // No staging — highlights are pure cosmetics, no commit required.
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const highlightTimers = useRef<Set<any>>(new Set());

  // ── Assistant command bus ─────────────────────────────────────
  // Each canvas:cmd:* channel mirrors a tool in canvas/tools.ts. v0
  // applies the change directly to local state; phase 2 will route
  // through a stage/commit cycle instead. Closures intentionally
  // pass updater functions to setX so we always operate on the
  // freshest value (subscriptions live across many renders).

  // Each canvas:cmd:* handler pushes a typed op into stagedOps. The
  // diff overlay + lock kick in the moment the queue is non-empty.
  // Args are validated/coerced here — anything malformed is dropped
  // silently so a buggy assistant call can't poison committed state
  // through stage accept later.
  useIFTTT('canvas:cmd:move-panel', (ev: any) => {
    if (!ev || typeof ev.panelId !== 'string') return;
    const anchor: Anchor = ev.anchor as Anchor;
    const offset = { x: Number(ev.offset?.x ?? 0) | 0, y: Number(ev.offset?.y ?? 0) | 0 };
    setStagedOps((prev) => [...prev, { type: 'move-panel', panelId: ev.panelId, anchor, offset }]);
  });
  useIFTTT('canvas:cmd:resize-panel', (ev: any) => {
    if (!ev || typeof ev.panelId !== 'string') return;
    const w = Math.max(MIN_SPAN_W, Number(ev.span?.w ?? 1) | 0);
    const h = Math.max(MIN_SPAN_H, Number(ev.span?.h ?? 1) | 0);
    setStagedOps((prev) => [...prev, { type: 'resize-panel', panelId: ev.panelId, span: { w, h } }]);
  });
  useIFTTT('canvas:cmd:toggle-panel', (ev: any) => {
    if (!ev || typeof ev.panelId !== 'string') return;
    setStagedOps((prev) => [...prev, { type: 'toggle-panel', panelId: ev.panelId, show: !!ev.show }]);
  });
  useIFTTT('canvas:cmd:set-bag-cols', (ev: any) => {
    const c = Number(ev?.cols);
    if (c !== 4 && c !== 6 && c !== 8) return;
    setStagedOps((prev) => [...prev, { type: 'set-bag-cols', cols: c as BagCols }]);
  });
  useIFTTT('canvas:cmd:bind-slot', (ev: any) => {
    if (!ev) return;
    const slot = Number(ev.slot) | 0;
    const atomId = ev.atomId === null ? null : (typeof ev.atomId === 'string' ? ev.atomId : null);
    setStagedOps((prev) => [...prev, { type: 'bind-slot', slot, atomId }]);
  });
  useIFTTT('canvas:cmd:swap-slots', (ev: any) => {
    if (!ev) return;
    const a = Number(ev.from) | 0;
    const b = Number(ev.to) | 0;
    setStagedOps((prev) => [...prev, { type: 'swap-slots', from: a, to: b }]);
  });
  useIFTTT('canvas:cmd:reset-layout', () => {
    setStagedOps((prev) => [...prev, { type: 'reset-layout' }]);
  });

  // ── Stage resolution ──────────────────────────────────────────
  // Chat card emits these via the @stage/* reply protocol. Accept
  // applies stagedOps to committed state in one go (history will
  // hook in here in phase 2B). Cancel just clears.
  useIFTTT('canvas:stage:accept', () => {
    if (stagedOps.length === 0) return;
    const next = applyOps({ layout, hidden, bagCols, actionSlots }, stagedOps);
    setLayout(next.layout);
    setHidden(next.hidden);
    setBagCols(next.bagCols);
    setActionSlots(next.actionSlots);
    // Push to history with assistant author + op summary. Compute
    // snapshot from `next` directly so it's accurate; the user-side
    // debounced push will dedupe via snapshotsEqual once committed
    // state actually settles.
    const opCount = stagedOps.length;
    const snap: CanvasSnapshot = {
      panels: next.layout.map((p) => {
        const def = defFor(p.id);
        const span = p.span ?? def?.span ?? { w: 1, h: 1 };
        return {
          id: p.id, anchor: p.anchor,
          offset: { ...p.offset }, span: { ...span },
          hidden: next.hidden.has(p.id),
        };
      }),
      bag: { cols: next.bagCols },
      slots: [...next.actionSlots],
    };
    pushHistory(snap, 'assistant', `${opCount} op${opCount === 1 ? '' : 's'}`);
    setStagedOps([]);
  });
  useIFTTT('canvas:stage:cancel', () => {
    if (stagedOps.length === 0) return;
    setStagedOps([]);
  });

  // ── Undo / redo subscribers ───────────────────────────────────
  // Inert during stage — the user must resolve the proposal first.
  // No-op at chain endpoints.
  useIFTTT('canvas:cmd:undo', () => {
    if (stagedActive) return;
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const entry = historyChainRef.current[historyIndexRef.current];
    if (!entry) return;
    restoreFromSnapshot(entry.snapshot);
  });
  useIFTTT('canvas:cmd:redo', () => {
    if (stagedActive) return;
    if (historyIndexRef.current >= historyChainRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const entry = historyChainRef.current[historyIndexRef.current];
    if (!entry) return;
    restoreFromSnapshot(entry.snapshot);
  });

  // ── User-side debounced push ──────────────────────────────────
  // 600ms after the last committed change, snapshot and push. The
  // snapshotsEqual dedupe inside pushHistory absorbs the case where
  // the change came from a restore (history pointer moved, committed
  // state matched chain[index] already) or from stage-accept (which
  // pre-pushed the same snapshot).
  useEffect(() => {
    const t = setTimeout(() => {
      pushHistory(buildSnapshot(), 'user', 'user edit');
    }, 600);
    return () => clearTimeout(t);
  }, [layout, hidden, bagCols, actionSlots, buildSnapshot, pushHistory]);
  useIFTTT('canvas:cmd:highlight', (ev: any) => {
    if (!ev || (ev.kind !== 'atom' && ev.kind !== 'slot' && ev.kind !== 'panel')) return;
    const id = String(ev.id ?? '');
    if (!id) return;
    const dur = Math.max(200, Number(ev.durationMs ?? 2500) | 0);
    const expiresAt = Date.now() + dur;
    const h: Highlight = { kind: ev.kind, id, expiresAt, label: typeof ev.label === 'string' ? ev.label : undefined };
    setHighlights((prev) => {
      // Replace any existing highlight on the same target so the
      // new duration wins and labels don't pile up.
      const without = prev.filter((p) => !(p.kind === h.kind && p.id === h.id));
      return [...without, h];
    });
    const timer = setTimeout(() => {
      highlightTimers.current.delete(timer);
      setHighlights((prev) => prev.filter((p) => !(p.kind === h.kind && p.id === h.id && p.expiresAt === h.expiresAt)));
    }, dur);
    highlightTimers.current.add(timer);
  });
  useIFTTT('canvas:cmd:invoke-atom', (ev: any) => {
    if (!ev || typeof ev.atomId !== 'string') return;
    const atom = atomById(ev.atomId);
    if (!atom) return;
    atom.invoke({ cursor: { x: 0, y: 0 }, selection: [], args: ev.args ?? {} });
  });
  // Cleanup any pending highlight timers on unmount so they don't
  // setState on a torn-down tree.
  useEffect(() => () => {
    for (const t of highlightTimers.current) clearTimeout(t);
    highlightTimers.current.clear();
  }, []);
  // Per-frame mouse polling rerender tick — only runs while a drag is
  // active. tile_drag uses a setState bumper for the same purpose.
  const [, force] = useState(0);

  // Persist whenever layout changes.
  useEffect(() => { saveLayout(layout); }, [layout]);

  // Drag state — refs (not state) so the raf tick reads current
  // values without re-subscribing.
  const dragIdRef = useRef<string | null>(null);
  // The anchor at drag-start. Used to compute the panel's absolute
  // pixel rect each tick (start anchor + start offset + mouse delta).
  // dragAnchorRef tracks the LIVE anchor — re-anchored as the panel's
  // center crosses zone boundaries.
  const dragStartAnchorRef = useRef<Anchor>('TL');
  const dragAnchorRef = useRef<Anchor>('TL');
  const dragStartMouseX = useRef(0);
  const dragStartMouseY = useRef(0);
  const dragStartOffset = useRef({ x: 0, y: 0 });
  const dragLiveOffset = useRef({ x: 0, y: 0 });
  const rafRef = useRef<any>(null);
  // Placed rects of NON-dragging panels — refreshed each render so
  // the drag tick can magnetic-snap against current neighbors without
  // re-running the solver.
  const otherPlacedRef = useRef<Array<{ id: string; rect: Rect }>>([]);
  // Effective span of the dragging panel — captured at drag start so
  // the tick doesn't have to re-fetch from layout each frame.
  const dragSpanRef = useRef({ w: 1, h: 1 });

  // Resize state — parallel to drag. Same raf+mouse-poll pattern,
  // but mutates `span` instead of `offset`. Bypasses the solver
  // while active so the panel can grow freely under the cursor.
  const resizeIdRef = useRef<string | null>(null);
  const resizeStartMouseX = useRef(0);
  const resizeStartMouseY = useRef(0);
  const resizeStartSpan = useRef({ w: 1, h: 1 });
  const resizeLiveSpan = useRef({ w: 1, h: 1 });
  const resizeRafRef = useRef<any>(null);

  const stopFrame = useCallback(() => {
    if (rafRef.current == null) return;
    const cancel = host.cancelAnimationFrame?.bind(host);
    if (cancel) cancel(rafRef.current); else clearTimeout(rafRef.current);
    rafRef.current = null;
  }, []);
  const scheduleFrame = useCallback((tick: () => void) => {
    const raf = host.requestAnimationFrame?.bind(host);
    if (raf) rafRef.current = raf(tick);
    else rafRef.current = setTimeout(tick, 16);
  }, []);

  const tick = useCallback(() => {
    const id = dragIdRef.current;
    if (!id) { stopFrame(); return; }
    if (!readMouseDown()) {
      // Commit the drag.
      const finalAnchor = dragAnchorRef.current;
      const finalOffset = { ...dragLiveOffset.current };
      setLayout((prev) => prev.map((p) => p.id === id ? { ...p, anchor: finalAnchor, offset: finalOffset } : p));
      dragIdRef.current = null;
      stopFrame();
      force((n) => (n + 1) | 0);
      return;
    }
    const def = defFor(id);
    if (!def) { stopFrame(); return; }
    const vw = readViewportW();
    const vh = readViewportH();
    const w = dragSpanRef.current.w * CELL;
    const h = dragSpanRef.current.h * CELL;

    // Where the panel SHOULD be in absolute viewport pixels right
    // now: start anchor + start offset, translated by the drag delta.
    const startAnchor = dragStartAnchorRef.current;
    const startOff = dragStartOffset.current;
    let baseX = 0, baseY = 0;
    switch (startAnchor[1]) {
      case 'L': baseX = startOff.x * CELL; break;
      case 'C': baseX = (vw - w) / 2 + startOff.x * CELL; break;
      case 'R': baseX = vw - w - startOff.x * CELL; break;
    }
    switch (startAnchor[0]) {
      case 'T': baseY = startOff.y * CELL; break;
      case 'M': baseY = (vh - h) / 2 + startOff.y * CELL; break;
      case 'B': baseY = vh - h - startOff.y * CELL; break;
    }
    let absX = baseX + (readMouseX() - dragStartMouseX.current);
    let absY = baseY + (readMouseY() - dragStartMouseY.current);

    // Hard clamp to viewport — panel rect can't leave the visible
    // area. Cursor can; the panel just sticks to whichever edge.
    // Applied first so subsequent snap math operates on a rect
    // that's already constrained.
    let cur: Rect = clampToViewport({ x: absX, y: absY, w, h }, vw, vh);
    // Magnetic edge snap against currently-placed neighbors. Runs
    // on the absolute pixel rect BEFORE we round into anchor+offset
    // so a snap to a centered-anchored neighbor still survives the
    // round-trip (centered-anchor offsets are fractional in cells
    // when vw isn't a clean multiple of CELL).
    cur = magneticSnap(cur, otherPlacedRef.current, id);
    // Symmetric viewport-edge snap — all four sides, not just top/left.
    cur = snapToViewportEdges(cur, vw, vh);
    const snapped = cur;
    absX = snapped.x;
    absY = snapped.y;

    // Re-anchor by zone of the panel's center. 3×3 viewport grid.
    const cx = absX + w / 2;
    const cy = absY + h / 2;
    const colChar: 'L' | 'C' | 'R' = cx < vw / 3 ? 'L' : cx > vw * 2 / 3 ? 'R' : 'C';
    const rowChar: 'T' | 'M' | 'B' = cy < vh / 3 ? 'T' : cy > vh * 2 / 3 ? 'B' : 'M';
    const newAnchor = (rowChar + colChar) as Anchor;

    // Offset = cells from the new anchor's reference point. For
    // right/bottom anchors, offset measures INWARD (away from edge).
    // We round only when the panel is NOT magnetically snapped — a
    // snap implies an intentional pixel-precise alignment that
    // shouldn't be quantised away.
    const wasSnapped =
      snapped.x !== baseX + (readMouseX() - dragStartMouseX.current) ||
      snapped.y !== baseY + (readMouseY() - dragStartMouseY.current);
    const quant = wasSnapped ? (n: number) => n : (n: number) => Math.round(n);
    let offX = 0, offY = 0;
    switch (colChar) {
      case 'L': offX = quant(absX / CELL); break;
      case 'C': offX = quant((absX - (vw - w) / 2) / CELL); break;
      case 'R': offX = quant(((vw - w) - absX) / CELL); break;
    }
    switch (rowChar) {
      case 'T': offY = quant(absY / CELL); break;
      case 'M': offY = quant((absY - (vh - h) / 2) / CELL); break;
      case 'B': offY = quant(((vh - h) - absY) / CELL); break;
    }

    dragAnchorRef.current = newAnchor;
    dragLiveOffset.current = { x: offX, y: offY };
    force((n) => (n + 1) | 0);
    scheduleFrame(tick);
  }, [scheduleFrame, stopFrame]);

  const beginDrag = useCallback((id: string) => {
    if (!editMode) return;
    const cur = layout.find((p) => p.id === id);
    if (!cur) return;
    const def = defFor(id);
    if (!def) return;
    dragIdRef.current = id;
    dragStartAnchorRef.current = cur.anchor;
    dragAnchorRef.current = cur.anchor;
    dragStartMouseX.current = readMouseX();
    dragStartMouseY.current = readMouseY();
    dragStartOffset.current = { ...cur.offset };
    dragLiveOffset.current = { ...cur.offset };
    dragSpanRef.current = { ...effectiveSpan(cur, def) };
    stopFrame();
    scheduleFrame(tick);
  }, [editMode, layout, scheduleFrame, stopFrame, tick]);

  // ── Resize ────────────────────────────────────────────────────
  const stopResize = useCallback(() => {
    if (resizeRafRef.current == null) return;
    const cancel = host.cancelAnimationFrame?.bind(host);
    if (cancel) cancel(resizeRafRef.current); else clearTimeout(resizeRafRef.current);
    resizeRafRef.current = null;
  }, []);
  const scheduleResize = useCallback((tick: () => void) => {
    const raf = host.requestAnimationFrame?.bind(host);
    if (raf) resizeRafRef.current = raf(tick);
    else resizeRafRef.current = setTimeout(tick, 16);
  }, []);

  const resizeTick = useCallback(() => {
    const id = resizeIdRef.current;
    if (!id) { stopResize(); return; }
    if (!readMouseDown()) {
      const finalSpan = { ...resizeLiveSpan.current };
      setLayout((prev) => prev.map((p) => p.id === id ? { ...p, span: finalSpan } : p));
      resizeIdRef.current = null;
      stopResize();
      force((n) => (n + 1) | 0);
      return;
    }
    const dxPx = readMouseX() - resizeStartMouseX.current;
    const dyPx = readMouseY() - resizeStartMouseY.current;
    const vw = readViewportW();
    const vh = readViewportH();
    // Find the placement so we know where the panel is anchored —
    // its top-left determines the max growable size against the
    // viewport. Read live so committed panels reflect their current
    // anchor/offset.
    const place = layout.find((p) => p.id === id);
    const def = defFor(id);
    if (!place || !def) { stopResize(); return; }
    const startW = resizeStartSpan.current.w;
    const startH = resizeStartSpan.current.h;
    let nextW = Math.max(MIN_SPAN_W, startW + Math.round(dxPx / CELL));
    let nextH = Math.max(MIN_SPAN_H, startH + Math.round(dyPx / CELL));
    // Clamp so the panel can't grow past the viewport from its
    // current anchored position. Use a temporary placement with the
    // candidate span to resolve; if the resolved rect overflows,
    // back off one cell at a time.
    while (nextW > MIN_SPAN_W) {
      const probe = resolveRect({ ...place, span: { w: nextW, h: nextH } }, vw, vh);
      if (probe && probe.x + probe.w <= vw && probe.x >= 0) break;
      nextW--;
    }
    while (nextH > MIN_SPAN_H) {
      const probe = resolveRect({ ...place, span: { w: nextW, h: nextH } }, vw, vh);
      if (probe && probe.y + probe.h <= vh && probe.y >= 0) break;
      nextH--;
    }
    resizeLiveSpan.current = { w: nextW, h: nextH };
    force((n) => (n + 1) | 0);
    scheduleResize(resizeTick);
  }, [layout, scheduleResize, stopResize]);

  const beginResize = useCallback((id: string) => {
    if (!editMode) return;
    const cur = layout.find((p) => p.id === id);
    if (!cur) return;
    const def = defFor(id);
    if (!def) return;
    resizeIdRef.current = id;
    resizeStartMouseX.current = readMouseX();
    resizeStartMouseY.current = readMouseY();
    resizeStartSpan.current = { ...effectiveSpan(cur, def) };
    resizeLiveSpan.current = { ...effectiveSpan(cur, def) };
    stopResize();
    scheduleResize(resizeTick);
  }, [editMode, layout, resizeTick, scheduleResize, stopResize]);

  useEffect(() => () => stopResize(), [stopResize]);

  useEffect(() => () => stopFrame(), [stopFrame]);

  // Hide / show toggle (used by bag bar).
  const togglePanel = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Solve layout. The dragged AND resizing panels BYPASS the solver
  // entirely — they follow the cursor without bounds or collision
  // checks so they can never disappear mid-interaction. Solver runs
  // over everything else, and we append the live rect for whichever
  // is interacting (with z-index lifted).
  const vw = readViewportW();
  const vh = readViewportH();
  const dragId = dragIdRef.current;
  const resizeId = resizeIdRef.current;
  const interactingId = dragId ?? resizeId;
  // Render off LIVE state (committed + staged). User-gesture writes
  // still go to committed via setLayout/etc., but the lock prevents
  // any user gesture from firing while staged.
  const layoutForSolve = interactingId ? live.layout.filter((p) => p.id !== interactingId) : live.layout;
  const solved = solveLayout(layoutForSolve, vw, vh, live.hidden);
  const stashed = solved.stashed;

  // Build the live rect for the interacting panel, if any. Drag uses
  // live anchor + offset and dragSpanRef for size. Resize uses the
  // committed anchor + offset and resizeLiveSpan for size.
  let liveRect: Rect | null = null;
  if (interactingId && !live.hidden.has(interactingId)) {
    const def = defFor(interactingId);
    const place = live.layout.find((p) => p.id === interactingId);
    if (def && place) {
      let w: number, h: number, anchor: Anchor, off: { x: number; y: number };
      if (dragId) {
        w = dragSpanRef.current.w * CELL;
        h = dragSpanRef.current.h * CELL;
        anchor = dragAnchorRef.current;
        off = dragLiveOffset.current;
      } else {
        w = resizeLiveSpan.current.w * CELL;
        h = resizeLiveSpan.current.h * CELL;
        anchor = place.anchor;
        off = place.offset;
      }
      let x = 0, y = 0;
      switch (anchor[1]) {
        case 'L': x = off.x * CELL; break;
        case 'C': x = (vw - w) / 2 + off.x * CELL; break;
        case 'R': x = vw - w - off.x * CELL; break;
      }
      switch (anchor[0]) {
        case 'T': y = off.y * CELL; break;
        case 'M': y = (vh - h) / 2 + off.y * CELL; break;
        case 'B': y = vh - h - off.y * CELL; break;
      }
      liveRect = { x, y, w, h };
    }
  }
  const placed: Array<{ id: string; rect: Rect }> =
    liveRect && interactingId ? [...solved.placed, { id: interactingId, rect: liveRect }] : solved.placed;
  // Refresh neighbor-rects ref so the NEXT drag tick can magnetic-
  // snap against current positions of the non-dragged panels. The
  // dragged panel itself isn't in solved.placed, so no filter needed.
  otherPlacedRef.current = solved.placed;

  // Publish the canvas snapshot so canvas-describe (assistant tool)
  // returns fresh data. Effect, not during render — publishCanvasState
  // mutates a module-level ref and we don't want re-render churn from
  // a state update during paint. Spans always come from the def
  // fallback when placement.span is unset, mirroring effectiveSpan().
  useEffect(() => {
    publishCanvasState({
      panels: layout.map((p) => {
        const def = defFor(p.id);
        const span = p.span ?? def?.span ?? { w: 1, h: 1 };
        return {
          id: p.id,
          anchor: p.anchor,
          offset: { ...p.offset },
          span: { ...span },
          hidden: hidden.has(p.id),
        };
      }),
      bag: { cols: bagCols },
      slots: [...actionSlots],
    });
  }, [layout, hidden, bagCols, actionSlots]);

  return (
    <S.Page>
      <Canvas
        style={{ width: '100%', height: '100%', backgroundColor: 'theme:bg' }}
        gridStep={CELL}
        gridStroke={1}
        gridColor={editMode ? 'theme:gridDotStrong' : 'theme:gridDot'}
        gridMajorColor="theme:gridDotStrong"
        gridMajorEvery={4}
      >
        <Canvas.Clamp>
          <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
            {/* Always-visible canvas frame. Gives the right and bottom
                edges a solid "wall" to abut against, matching what the
                shell rail (left) and chrome (top) provide on the
                other two sides. Without it, panels snapped to BR/BC/
                MR feel like they're floating against nothing — the
                left/top edges felt obvious but the right/bottom didn't.
                Pure paint, no interactivity, doesn't intercept mouse. */}
            <Box style={{
              position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
              borderWidth: 1, borderColor: 'theme:rule',
              pointerEvents: 'none' as any,
            }} />

            {/* Edit-mode tint. Full-bleed Pressable with no-op
                onMouseDown to swallow clicks (Canvas.Clamp content
                with interactive handlers short-circuits canvas pan,
                see engine.zig hit_is_interactive). Tint only — frame
                stroke is a separate sibling so opacity doesn't fade
                the border the way it used to. */}
            {(editMode || stagedActive) ? (
              <Pressable
                onMouseDown={() => { /* swallow — blocks canvas pan */ }}
                style={{
                  position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
                  backgroundColor: 'theme:accent',
                  opacity: 0.08,
                }}
              />
            ) : null}
            {/* Edit/stage frame — full-opacity accent stroke. Solid
                in EDIT MODE, dashed in STAGED so the two modes are
                visually distinguishable from across the room. */}
            {editMode && !stagedActive ? (
              <Box style={{
                position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
                borderWidth: 2, borderColor: 'theme:accent',
                pointerEvents: 'none' as any,
              }} />
            ) : null}
            {stagedActive ? (
              <Box style={{
                position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
                borderWidth: 2, borderColor: 'theme:accent',
                borderStyle: 'dashed' as any,
                pointerEvents: 'none' as any,
              }} />
            ) : null}
            {/* Mode badge — top-center pill. Either EDIT MODE or
                STAGED. STAGED overrides since the user must resolve
                the proposal before doing anything else. */}
            {stagedActive ? (
              <Box style={{
                position: 'absolute', top: 6, left: 0, right: 0,
                alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none' as any,
              }}>
                <Box style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4,
                  backgroundColor: 'theme:bg2',
                  borderWidth: 1, borderColor: 'theme:accent',
                  borderStyle: 'dashed' as any,
                }}>
                  <Native type="Icon" icon={Sparkles} size={11} strokeWidth={2} color="theme:accent" />
                  <Text size={9} color="theme:accent" bold>STAGED · {stagedOps.length} change{stagedOps.length === 1 ? '' : 's'} pending — resolve in chat</Text>
                </Box>
              </Box>
            ) : editMode ? (
              <Box style={{
                position: 'absolute', top: 6, left: 0, right: 0,
                alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none' as any,
              }}>
                <Box style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4,
                  backgroundColor: 'theme:bg2',
                  borderWidth: 1, borderColor: 'theme:accent',
                }}>
                  <Native type="Icon" icon={Move} size={11} strokeWidth={2} color="theme:accent" />
                  <Text size={9} color="theme:accent" bold>EDIT MODE — drag panel headers · canvas pan locked</Text>
                </Box>
              </Box>
            ) : null}

            {placed.map((item) => {
              const def = defFor(item.id)!;
              const isInteracting = interactingId === item.id;
              return (
                <Box key={item.id} style={{
                  position: 'absolute',
                  left: item.rect.x, top: item.rect.y,
                  width: item.rect.w, height: item.rect.h,
                  zIndex: isInteracting ? 100 : 1,
                  opacity: isInteracting ? 0.92 : 1,
                }}>
                  <PanelView
                    def={def}
                    rect={item.rect}
                    editMode={editMode && !stagedActive}
                    onDragHandle={stagedActive ? () => {} : () => beginDrag(item.id)}
                    onResizeHandle={stagedActive ? () => {} : () => beginResize(item.id)}
                    onClose={stagedActive ? () => {} : () => togglePanel(item.id)}
                    hidden={live.hidden}
                    togglePanel={stagedActive ? () => {} : togglePanel}
                    editToggle={stagedActive ? () => {} : () => setEditMode((v) => !v)}
                    actionSlots={live.actionSlots}
                    setActionSlots={stagedActive ? (() => {}) as any : setActionSlots}
                    bagCols={live.bagCols}
                    setBagCols={stagedActive ? () => {} : setBagCols}
                    altDownRef={altDownRef}
                    highlights={highlights}
                    panelHighlight={findHighlight(highlights, 'panel', item.id)}
                    stagedTarget={stagedTargets?.panelIds.has(item.id) ?? false}
                    stagedSlots={stagedTargets?.slots ?? null}
                  />
                </Box>
              );
            })}

            {/* Stash strip — pinned bottom-left of the bag bar area.
                Renders nothing when nothing's stashed; otherwise a row
                of icon chips for each hidden / no-fit panel. Clicking
                un-hides (and unhides also re-attempts placement on
                next solve pass). */}
            {stashed.length > 0 || live.hidden.size > 0 ? (
              <Box style={{
                position: 'absolute', left: 8, bottom: CELL + 8,
                flexDirection: 'row', gap: 4,
                padding: 4,
                backgroundColor: 'theme:bg2',
                borderWidth: 1, borderColor: 'theme:rule',
              }}>
                <Text size={9} color="theme:inkDim">stash:</Text>
                {[...stashed, ...Array.from(live.hidden).filter((id) => !stashed.includes(id))].map((id) => {
                  const def = defFor(id);
                  if (!def) return null;
                  return (
                    <Pressable key={id} onPress={stagedActive ? () => {} : () => {
                      // If the panel is in the hidden set, unhide. If
                      // it's just stashed-by-collision, nudge its
                      // offset to (0,0) so the next solve places it
                      // somewhere visible.
                      if (live.hidden.has(id)) togglePanel(id);
                      else setLayout((prev) => prev.map((p) => p.id === id ? { ...p, offset: { x: 0, y: 0 } } : p));
                    }} style={{
                      width: 26, height: 26,
                      alignItems: 'center', justifyContent: 'center',
                      borderWidth: 1, borderColor: 'theme:rule',
                      opacity: stagedActive ? 0.4 : 1,
                    }}>
                      <Native type="Icon" icon={def.icon} size={14} strokeWidth={2} color="theme:inkDim" />
                    </Pressable>
                  );
                })}
              </Box>
            ) : null}
          </Box>
        </Canvas.Clamp>
      </Canvas>
    </S.Page>
  );
}

// ── Panel chrome + content stubs ──────────────────────────────────

function PanelView({ def, rect, editMode, onDragHandle, onResizeHandle, onClose, hidden, togglePanel, editToggle, actionSlots, setActionSlots, bagCols, setBagCols, altDownRef, highlights, panelHighlight, stagedTarget, stagedSlots }: {
  def: PanelDef;
  rect: Rect;
  editMode: boolean;
  onDragHandle: () => void;
  onResizeHandle: () => void;
  onClose: () => void;
  hidden: Set<string>;
  togglePanel: (id: string) => void;
  editToggle: () => void;
  actionSlots: (string | null)[];
  setActionSlots: (updater: (prev: (string | null)[]) => (string | null)[]) => void;
  bagCols: BagCols;
  setBagCols: (c: BagCols) => void;
  altDownRef: { current: boolean };
  highlights: Highlight[];
  panelHighlight: Highlight | undefined;
  /** True if this panel is in the staged-ops target set (move,
   *  resize, toggle, set-bag-cols, reset). Triggers the diff halo. */
  stagedTarget: boolean;
  /** Slot indices the staged ops touch — passed through to ActionBar
   *  so it can dot-halo specific slots. Null when not staged. */
  stagedSlots: Set<number> | null;
}) {
  return (
    <Col style={{
      width: '100%', height: '100%',
      backgroundColor: 'theme:bg1',
      borderWidth: 1, borderColor: editMode ? 'theme:accent' : 'theme:rule',
      position: 'relative',
    }}>
      {/* Title row doubles as drag handle in edit mode. The whole
          row is a Pressable so onMouseDown fires reliably. */}
      <Pressable onMouseDown={editMode ? onDragHandle : undefined}>
        <Row style={{
          height: 18, paddingLeft: 6, paddingRight: 4, gap: 6,
          alignItems: 'center',
          backgroundColor: 'theme:bg2',
          borderBottomWidth: 1, borderBottomColor: 'theme:rule',
        }}>
          <Native type="Icon" icon={def.icon} size={11} strokeWidth={2} color="theme:inkDim" />
          <Text size={9} color="theme:inkDim" bold>{def.label.toUpperCase()}</Text>
          <Box style={{ flexGrow: 1 }} />
          {editMode ? (
            <Pressable onPress={onClose}>
              <Native type="Icon" icon={X} size={11} strokeWidth={2} color="theme:inkDim" />
            </Pressable>
          ) : null}
        </Row>
      </Pressable>
      <Box style={{ flexGrow: 1, minHeight: 0 }}>
        <PanelContent
          id={def.id}
          rect={rect}
          hidden={hidden}
          togglePanel={togglePanel}
          editMode={editMode}
          editToggle={editToggle}
          actionSlots={actionSlots}
          setActionSlots={setActionSlots}
          bagCols={bagCols}
          setBagCols={setBagCols}
          altDownRef={altDownRef}
          highlights={highlights}
          stagedSlots={stagedSlots}
        />
      </Box>
      {/* Resize handle — bottom-right corner, edit mode only.
          Pressable with onMouseDown so the raf loop captures the
          initial mouse position. Sits on top of panel content via
          absolute + zIndex. The diagonal-line glyph is hand-rolled
          out of two thin Boxes since there's no diagonal-line icon
          in the registry. */}
      {editMode ? (
        <Pressable onMouseDown={onResizeHandle} style={{
          position: 'absolute',
          right: 0, bottom: 0,
          width: 14, height: 14,
          alignItems: 'flex-end', justifyContent: 'flex-end',
          zIndex: 5,
        }}>
          <Box style={{
            position: 'absolute', right: 2, bottom: 2,
            width: 8, height: 8,
            borderRightWidth: 2, borderBottomWidth: 2,
            borderColor: 'theme:accent',
          }} />
        </Pressable>
      ) : null}
      {/* Staged-diff halo — visually distinct from the highlight
          halo. Indicates this panel is part of an assistant
          proposal pending Accept/Reject. Dashed border in accent
          color so it's recognisably a "preview", not a selection. */}
      {stagedTarget ? (
        <Box style={{
          position: 'absolute', left: -2, top: -2, right: -2, bottom: -2,
          borderWidth: 2, borderColor: 'theme:accent',
          borderStyle: 'dashed' as any,
          pointerEvents: 'none' as any,
          zIndex: 150,
        }} />
      ) : null}
      {/* Highlight halo — accent ring around the entire panel when
          the assistant calls canvas-highlight kind=panel. Optional
          label pinned above the panel. pointer-events-none so the
          ring doesn't intercept the resize handle, drag header, etc. */}
      {panelHighlight ? (
        <>
          <Box style={{
            position: 'absolute', left: -3, top: -3, right: -3, bottom: -3,
            borderWidth: 3, borderColor: 'theme:accent',
            pointerEvents: 'none' as any,
            zIndex: 200,
          }} />
          {panelHighlight.label ? (
            <Box style={{
              position: 'absolute', left: 0, top: -22,
              paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2,
              backgroundColor: 'theme:accent',
              pointerEvents: 'none' as any,
              zIndex: 201,
            }}>
              <Text size={9} color="theme:bg" bold>{panelHighlight.label}</Text>
            </Box>
          ) : null}
        </>
      ) : null}
    </Col>
  );
}

function PanelContent({ id, rect, hidden, togglePanel, editMode, editToggle, actionSlots, setActionSlots, bagCols, setBagCols, altDownRef, highlights, stagedSlots }: {
  id: string;
  rect: Rect;
  hidden: Set<string>;
  togglePanel: (id: string) => void;
  editMode: boolean;
  editToggle: () => void;
  actionSlots: (string | null)[];
  setActionSlots: (updater: (prev: (string | null)[]) => (string | null)[]) => void;
  bagCols: BagCols;
  setBagCols: (c: BagCols) => void;
  altDownRef: { current: boolean };
  highlights: Highlight[];
  stagedSlots: Set<number> | null;
}) {
  if (id === 'modeTabs')  return <ModeTabsStub />;
  if (id === 'bag')       return <BagStub rect={rect} bagCols={bagCols} setBagCols={setBagCols} highlights={highlights} />;
  if (id === 'bagBar')    return <BagBarStub hidden={hidden} togglePanel={togglePanel} editMode={editMode} editToggle={editToggle} />;
  if (id === 'actionBar') return <ActionBarStub rect={rect} slots={actionSlots} setSlots={setActionSlots} altDownRef={altDownRef} highlights={highlights} stagedSlots={stagedSlots} />;
  if (id === 'code')      return <CodeStub />;
  if (id === 'props')     return <PropsStub />;
  if (id === 'minimap')   return <MinimapStub />;
  return <Box style={{ flexGrow: 1 }} />;
}

function ModeTabsStub() {
  const tabs = [
    { icon: Hammer,   label: 'BUILD' },
    { icon: Bot,      label: 'RULES' },
    { icon: Boxes,    label: 'DESIGN' },
    { icon: Play,     label: 'RUN' },
    { icon: Terminal, label: 'DEBUG' },
  ];
  return (
    <Row style={{ flexGrow: 1, gap: 2, padding: 2, alignItems: 'center' }}>
      {tabs.map((t, i) => (
        <Pressable key={t.label} style={{
          paddingLeft: 6, paddingRight: 6, height: '100%',
          flexDirection: 'row', alignItems: 'center', gap: 4,
          borderWidth: 1, borderColor: i === 0 ? 'theme:accent' : 'theme:rule',
          backgroundColor: i === 0 ? 'theme:bg2' : 'transparent',
        }}>
          <Native type="Icon" icon={t.icon} size={11} strokeWidth={2} color={i === 0 ? 'theme:accent' : 'theme:inkDim'} />
          <Text size={8} color={i === 0 ? 'theme:accent' : 'theme:inkDim'}>{t.label}</Text>
        </Pressable>
      ))}
    </Row>
  );
}

function BagStub({ rect, bagCols, setBagCols, highlights }: {
  rect: Rect; bagCols: BagCols; setBagCols: (c: BagCols) => void; highlights: Highlight[];
}) {
  // Sectioned 1:1 grid. Tile size = inner panel width / cols, shared
  // across all groups so the bag reads as one consistent grid even
  // though sections render as separate row blocks (with a header
  // chip between them). Click a tile = invoke that atom directly.
  const PAD = 4;
  const innerW = Math.max(0, rect.w - 2 - PAD * 2);
  const tileSize = Math.max(16, Math.floor(innerW / bagCols));
  const cycleCols = () => {
    const idx = BAG_COL_OPTS.indexOf(bagCols);
    setBagCols(BAG_COL_OPTS[(idx + 1) % BAG_COL_OPTS.length]);
  };

  // Build sections in declared group order, skipping empty groups.
  // Each non-empty group becomes a header + N rows of `bagCols` tiles.
  const sections: Array<{ group: AtomGroup; rows: Atom[][] }> = [];
  for (const g of ATOM_GROUP_ORDER) {
    const items = atomsByGroup(g);
    if (items.length === 0) continue;
    const rows: Atom[][] = [];
    for (let i = 0; i < items.length; i += bagCols) rows.push(items.slice(i, i + bagCols));
    sections.push({ group: g, rows });
  }

  // Click in the bag = invoke this atom. v0 fires through the bus
  // (canvas:atom:invoke); the canvas page subscribes and stubs the
  // effect for now. Once content lands, the same handler spawns.
  const onAtomClick = (atom: Atom) => {
    atom.invoke({ cursor: { x: 0, y: 0 }, selection: [] });
  };

  return (
    <Col style={{ flexGrow: 1, padding: PAD, gap: 0 }}>
      {/* Cols toggle — top-right. Cycles 4 → 6 → 8. */}
      <Row style={{ paddingBottom: 2, alignItems: 'center', gap: 4 }}>
        <Box style={{ flexGrow: 1 }} />
        <Pressable onPress={cycleCols} style={{
          paddingLeft: 4, paddingRight: 4, paddingTop: 1, paddingBottom: 1,
          borderWidth: 1, borderColor: 'theme:rule',
        }}>
          <Text size={8} color="theme:inkDim">{bagCols}×</Text>
        </Pressable>
      </Row>
      {sections.map((sec) => (
        <Col key={sec.group} style={{ marginBottom: 4 }}>
          {/* Group header — small dim label, follows Image 27's bag.
              Same pattern the assistant references via list-atoms. */}
          <Box style={{ paddingTop: 2, paddingBottom: 2, paddingLeft: 2 }}>
            <Text size={8} color="theme:inkDim" bold>{sec.group}</Text>
          </Box>
          {sec.rows.map((row, rIdx) => (
            <Row key={rIdx} style={{ flexDirection: 'row' }}>
              {row.map((atom) => {
                // Highlight: assistant called canvas-highlight kind=atom.
                // Bump border to accent + carry an optional caption
                // pinned above the tile.
                const hl = findHighlight(highlights, 'atom', atom.id);
                return (
                  <Box key={atom.id} style={{ position: 'relative' }}>
                    <Pressable onPress={() => onAtomClick(atom)} style={{
                      width: tileSize, height: tileSize,
                      alignItems: 'center', justifyContent: 'center',
                      borderWidth: hl ? 2 : 1,
                      borderColor: hl ? 'theme:accent' : 'theme:rule',
                      backgroundColor: 'theme:bg2',
                    }}>
                      <Native type="Icon" icon={atom.icon} size={Math.max(10, Math.floor(tileSize * 0.45))} strokeWidth={2} color={hl ? 'theme:accent' : 'theme:ink'} />
                    </Pressable>
                    {hl?.label ? (
                      <Box style={{
                        position: 'absolute', left: 0, top: -16,
                        paddingLeft: 4, paddingRight: 4, paddingTop: 1, paddingBottom: 1,
                        backgroundColor: 'theme:accent',
                        pointerEvents: 'none' as any,
                        zIndex: 50,
                      }}>
                        <Text size={8} color="theme:bg" bold>{hl.label}</Text>
                      </Box>
                    ) : null}
                  </Box>
                );
              })}
            </Row>
          ))}
        </Col>
      ))}
    </Col>
  );
}

function BagBarStub({ hidden, togglePanel, editMode, editToggle }: {
  hidden: Set<string>; togglePanel: (id: string) => void; editMode: boolean; editToggle: () => void;
}) {
  // Toggles for which HUD panels are visible + the edit-UI toggle.
  // Bag itself isn't toggleable from here (would strand the user).
  const toggles = PANELS.filter((p) => p.id !== 'bag' && p.id !== 'bagBar');
  return (
    <Row style={{ flexGrow: 1, padding: 2, gap: 2, alignItems: 'center' }}>
      {toggles.map((p) => {
        const on = !hidden.has(p.id);
        return (
          <Pressable key={p.id} onPress={() => togglePanel(p.id)} style={{
            width: 36, height: '100%',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: on ? 'theme:accent' : 'theme:rule',
            backgroundColor: on ? 'theme:bg2' : 'transparent',
          }}>
            <Native type="Icon" icon={p.icon} size={12} strokeWidth={2} color={on ? 'theme:accent' : 'theme:inkDim'} />
          </Pressable>
        );
      })}
      <Box style={{ flexGrow: 1 }} />
      <Pressable onPress={editToggle} style={{
        paddingLeft: 6, paddingRight: 6, height: '100%',
        flexDirection: 'row', alignItems: 'center', gap: 4,
        borderWidth: 1, borderColor: editMode ? 'theme:accent' : 'theme:rule',
        backgroundColor: editMode ? 'theme:bg2' : 'transparent',
      }}>
        <Native type="Icon" icon={Move} size={11} strokeWidth={2} color={editMode ? 'theme:accent' : 'theme:inkDim'} />
        <Text size={8} color={editMode ? 'theme:accent' : 'theme:inkDim'}>EDIT UI</Text>
      </Pressable>
    </Row>
  );
}

function ActionBarStub({ rect, slots, setSlots, altDownRef, highlights, stagedSlots }: {
  rect: Rect;
  slots: (string | null)[];
  setSlots: (updater: (prev: (string | null)[]) => (string | null)[]) => void;
  altDownRef: { current: boolean };
  highlights: Highlight[];
  stagedSlots: Set<number> | null;
}) {
  // Grid driven by the panel's pixel rect — slots are fixed 1:1
  // (SLOT_PX), cols/rows derive from rect.w/rect.h. The panel chrome
  // is already accounted for by the parent's flexGrow:1 box, which
  // gives us roughly rect.h - 18 (header) usable height. The grid
  // itself covers the inner content area; cells that don't fit are
  // unrendered (panel needs to be resized to expose more slots).
  const headerH = 18;       // title row height
  const borderPx = 1;       // panel border
  const innerW = Math.max(0, rect.w - borderPx * 2);
  const innerH = Math.max(0, rect.h - borderPx * 2 - headerH);
  // Cols/rows from the preferred slot size; not forced to ≥1 — if
  // there isn't room for any slot, render the "too small" hint.
  const targetCols = Math.floor(innerW / SLOT_PX);
  const targetRows = Math.floor(innerH / SLOT_PX);
  if (targetCols <= 0 || targetRows <= 0) {
    return (
      <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 6 }}>
        <Text size={9} color="theme:inkDim">resize me bigger</Text>
      </Box>
    );
  }
  const cols = targetCols;
  const rows = targetRows;
  // Actual slot pixel size — square, capped by the preferred size,
  // shrunk to fit when innerW/innerH is the constraining axis. This
  // is what kept the buttons from overflowing: when the panel was
  // shorter than SLOT_PX we used to render slots at full SLOT_PX
  // anyway and they spilled outside the panel border.
  const slotPx = Math.min(
    SLOT_PX,
    Math.floor(innerW / cols),
    Math.floor(innerH / rows),
  );
  const total = cols * rows;
  // Pad / trim slots to fit the current grid. Don't write back to
  // state during render — just compute a view.
  const padded: (string | null)[] = [];
  for (let i = 0; i < total; i++) padded.push(slots[i] ?? null);

  // ── Slot drag state ───────────────────────────────────────────
  // Source slot index. While non-null, a ghost icon follows the
  // cursor; on release we look up the destination slot (or detect
  // out-of-bar) and apply move / swap / clear.
  const [tick, force] = useState(0);
  const dragSlotRef = useRef<number | null>(null);
  const cursorRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<any>(null);

  const stop = useCallback(() => {
    if (rafRef.current == null) return;
    const cancel = host.cancelAnimationFrame?.bind(host);
    if (cancel) cancel(rafRef.current); else clearTimeout(rafRef.current);
    rafRef.current = null;
  }, []);
  const sched = useCallback((fn: () => void) => {
    const raf = host.requestAnimationFrame?.bind(host);
    if (raf) rafRef.current = raf(fn);
    else rafRef.current = setTimeout(fn, 16);
  }, []);

  // Hit-test: which slot index is the cursor over, or -1 if outside
  // the action bar entirely. Uses the panel's absolute rect and our
  // computed cols/rows.
  const slotAt = useCallback((mx: number, my: number): number => {
    // ActionBar's content area starts at rect.x + borderPx on the
    // left and rect.y + borderPx + headerH on the top.
    const ox = rect.x + borderPx;
    const oy = rect.y + borderPx + headerH;
    if (mx < ox || my < oy) return -1;
    const col = Math.floor((mx - ox) / slotPx);
    const row = Math.floor((my - oy) / slotPx);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return -1;
    return row * cols + col;
  }, [rect.x, rect.y, cols, rows, slotPx]);

  const dragTick = useCallback(() => {
    if (dragSlotRef.current == null) { stop(); return; }
    if (!readMouseDown()) {
      const from = dragSlotRef.current;
      const mx = readMouseX();
      const my = readMouseY();
      const to = slotAt(mx, my);
      setSlots((prev) => {
        const padTo = Math.max(prev.length, total, from + 1);
        const next: (string | null)[] = [];
        for (let i = 0; i < padTo; i++) next.push(prev[i] ?? null);
        if (to < 0) {
          // Dropped outside the action bar — clear the source slot.
          next[from] = null;
        } else if (to !== from) {
          // Move into target. Swap with whatever was there (move
          // overwrites would surprise the user; swap is reversible).
          const tmp = next[to] ?? null;
          next[to] = next[from] ?? null;
          next[from] = tmp;
        }
        return next;
      });
      dragSlotRef.current = null;
      stop();
      force((n) => (n + 1) | 0);
      return;
    }
    cursorRef.current = { x: readMouseX(), y: readMouseY() };
    force((n) => (n + 1) | 0);
    sched(dragTick);
  }, [setSlots, slotAt, total, stop, sched]);

  const beginSlotDrag = useCallback((slotIdx: number) => {
    if (!altDownRef.current) return;
    if (padded[slotIdx] == null) return;
    dragSlotRef.current = slotIdx;
    cursorRef.current = { x: readMouseX(), y: readMouseY() };
    stop();
    sched(dragTick);
  }, [padded, altDownRef, dragTick, stop, sched]);

  useEffect(() => () => stop(), [stop]);

  // Render the grid as `rows` Rows of `cols` Boxes each. Each slot
  // gets a Pressable with onMouseDown so alt+click reliably starts
  // the drag (onPress would only fire on release).
  const grid: any[] = [];
  for (let r = 0; r < rows; r++) {
    const row: any[] = [];
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const atom = atomById(padded[idx]);
      const isDragSource = dragSlotRef.current === idx;
      const hl = findHighlight(highlights, 'slot', String(idx));
      const isStaged = stagedSlots?.has(idx) ?? false;
      row.push(
        <Box key={c} style={{ position: 'relative' }}>
          {isStaged ? (
            <Box style={{
              position: 'absolute', left: -2, top: -2, right: -2, bottom: -2,
              borderWidth: 2, borderColor: 'theme:accent',
              borderStyle: 'dashed' as any,
              pointerEvents: 'none' as any,
              zIndex: 30,
            }} />
          ) : null}
          <Pressable
            // onMouseDown handles the alt+drag-rearrange gesture (no-op
            // when alt isn't held; beginSlotDrag short-circuits there).
            onMouseDown={() => beginSlotDrag(idx)}
            // onPress only fires on a clean click (no drag), so a normal
            // tap on the slot invokes the bound atom while alt+drag
            // routes through the drag mechanic and never lands here.
            onPress={() => { if (atom) atom.invoke({ cursor: { x: 0, y: 0 }, selection: [] }); }}
            style={{
              width: slotPx, height: slotPx,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: hl ? 2 : 1,
              borderColor: hl ? 'theme:accent' : 'theme:rule',
              backgroundColor: atom ? 'theme:bg2' : 'theme:bg1',
              opacity: isDragSource ? 0.3 : 1,
              position: 'relative',
            }}
          >
            {atom ? (
              <Native type="Icon" icon={atom.icon} size={Math.max(10, Math.floor(slotPx * 0.45))} strokeWidth={2} color={hl ? 'theme:accent' : 'theme:ink'} />
            ) : (
              // Empty slot: faint hotkey number for the first row.
              r === 0 ? (
                <Text size={9} color="theme:inkDimmer">{c + 1}</Text>
              ) : null
            )}
          </Pressable>
          {hl?.label ? (
            <Box style={{
              position: 'absolute', left: 0, top: -16,
              paddingLeft: 4, paddingRight: 4, paddingTop: 1, paddingBottom: 1,
              backgroundColor: 'theme:accent',
              pointerEvents: 'none' as any,
              zIndex: 50,
            }}>
              <Text size={8} color="theme:bg" bold>{hl.label}</Text>
            </Box>
          ) : null}
        </Box>
      );
    }
    grid.push(<Row key={r} style={{ flexDirection: 'row' }}>{row}</Row>);
  }

  return (
    <Box style={{ flexGrow: 1, position: 'relative' }}>
      <Col style={{ flexGrow: 1 }}>{grid}</Col>
      {/* Floating ghost — atom icon following the cursor while the
          slot drag is live. Rendered inside the action bar's panel,
          but with negative offsets so it tracks the absolute cursor
          position regardless of where the panel is on the canvas.
          Positioned via panel-local coords (cursor minus panel rect
          origin), since this Box is inside the panel's wrapper. */}
      {dragSlotRef.current != null ? (() => {
        const atom = atomById(padded[dragSlotRef.current!] ?? slots[dragSlotRef.current!] ?? null);
        if (!atom) return null;
        return (
          <Box style={{
            position: 'absolute',
            left: cursorRef.current.x - rect.x - slotPx / 2,
            top:  cursorRef.current.y - rect.y - slotPx / 2 - headerH,
            width: slotPx, height: slotPx,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: 'theme:accent',
            backgroundColor: 'theme:bg2',
            opacity: 0.85,
            pointerEvents: 'none' as any,
            zIndex: 50,
          }}>
            <Native type="Icon" icon={atom.icon} size={Math.max(10, Math.floor(slotPx * 0.45))} strokeWidth={2} color="theme:accent" />
          </Box>
        );
      })() : null}
    </Box>
  );
}

function CodeStub() {
  return (
    <Box style={{ flexGrow: 1, padding: 8 }}>
      <Text size={9} color="theme:inkDim" style={{ fontFamily: 'monospace' as any }}>
        {`// canvas as code\nexport default () => (\n  <Canvas>\n    {/* selection ↦ JSX */}\n  </Canvas>\n);`}
      </Text>
    </Box>
  );
}

function PropsStub() {
  return (
    <Col style={{ flexGrow: 1, padding: 8, gap: 6 }}>
      <Text size={9} color="theme:inkDim" bold>SELECTED</Text>
      <Text size={10} color="theme:ink">Nothing selected.</Text>
      <Text size={9} color="theme:inkDim">Click a node to inspect its properties.</Text>
    </Col>
  );
}

function MinimapStub() {
  return (
    <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Native type="Icon" icon={MapIcon} size={20} strokeWidth={2} color="theme:inkDim" />
    </Box>
  );
}
