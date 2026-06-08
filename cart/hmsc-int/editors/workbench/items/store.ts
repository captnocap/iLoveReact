// editors/workbench/items/store.ts -- ITEM source truth (WBSTEP5-0606).
//
// The old /items and /voxels routes stay alive until the flip. This store is
// additive: it speaks the same stream doors (items + voxels), the same sculpt
// grid truth, and the same voxel blockout document, but hangs them from the
// WorkbenchSource contract.

import { mkdir, writeFile } from '@reactjit/hooks/fs';
import { editorChannel } from '../../store';
import { editorSessions, type RouteSession } from '../../sessions';
import { readRouteTwigState, writeRouteTwigState } from '../../twigs';
import { createPaintHistory } from '../../paint/history';
import { PAINT_EDITOR_TUNING, type SculptMode } from '../../characters/paintKit';
import { SMOOTH_TUNING } from '../../characters/smoothKit';
import {
  ITEM_DRAFT_DEFAULTS, bakeBlockoutToGlobe, emptyItemGrid, itemGlobeParams, itemVoxelMeshParams,
  itemVoxelShapeFromBlockout,
} from '../../items/bake';
import {
  itemsStream, mintItemId, type ItemRepresentation, type ItemVoxelShapeDoc, type ItemsEvent, type ItemsStreamState, type SculptedItemDoc,
} from '../../items/stream';
import {
  VOXEL_BLOCKOUT_TUNING, normalizeVoxelCellSizeMeters, voxelsStream,
  type VoxelBlockKind, type VoxelBlockoutDoc, type VoxelBlockSnap, type VoxelsEvent, type VoxelsStreamState,
} from '../../voxels/stream';
import { GAME_ITEMS, type ItemDefinition } from '../../../game/items';

const GRID_W = PAINT_EDITOR_TUNING.grid.width;
const GRID_H = PAINT_EDITOR_TUNING.grid.height;
const AUTOSAVE_MS = PAINT_EDITOR_TUNING.autosaveDebounceMs;
const TWIG_ROUTE = '/workbench/items';
const GAME_ITEM_ROSTER_PREFIX = 'game:';
const STREAM_ITEM_ROSTER_PREFIX = 'stream:';
export const WORKING_ITEM_ROSTER_ID = '__working_item__';

export const ITEM_KNOBS = Object.freeze({
  radius: { min: 0.1, max: 4, step: 0.05, precision: 2 },
  amount: { min: 0.05, max: 3, step: 0.05, precision: 2 },
  dims: { min: 1, max: 20, step: 1, precision: 0 },
  cellSize: {
    min: VOXEL_BLOCKOUT_TUNING.minCellSizeMeters,
    max: VOXEL_BLOCKOUT_TUNING.maxCellSizeMeters,
    step: VOXEL_BLOCKOUT_TUNING.cellSizeStepMeters,
    precision: 2,
  },
  brush: PAINT_EDITOR_TUNING.knobs.brush,
  strength: PAINT_EDITOR_TUNING.knobs.strength,
});

export type ItemLens = 'item' | 'sculpt' | 'voxel';
export type VoxelTool = 'build' | 'mine';
export type VoxelDims = { w: number; d: number; h: number };
export type VoxelFace = { key: string; label: string; dx: number; dy: number; dz: number };
export type WorkbenchVoxelBlock = VoxelBlockSnap & { locked?: boolean };
export type VoxelFaceGroup = {
  id: string;
  face: VoxelFace;
  kind: VoxelBlockKind;
  plane: number;
  cells: { x: number; y: number; z: number; u: number; v: number }[];
  bounds: { u0: number; v0: number; u1: number; v1: number };
};

export type ItemDraft = {
  radius: number;
  amount: number;
  grid: number[];
  color: string;
  source: SculptedItemDoc['source'];
  representation: ItemRepresentation;
  voxelShape: ItemVoxelShapeDoc | null;
};

type AutoBakeBase = {
  radius: number;
  amount: number;
  grid: number[];
  source: NonNullable<SculptedItemDoc['source']>;
};

export type TwigAdapter = {
  read<T>(key: string, initial: T): T;
  write<T>(key: string, value: T): void;
};

export type ItemStoreDeps = {
  items: { state(): ItemsStreamState } | null;
  itemSession: Pick<RouteSession<ItemsEvent>, 'commit' | 'note'> | null;
  voxels: { state(): VoxelsStreamState } | null;
  voxelSession: Pick<RouteSession<VoxelsEvent>, 'commit' | 'note'> | null;
  error: string | null;
  autosaveMs?: number;
  twig?: boolean | TwigAdapter;
  exportFile?: (path: string, content: string) => void;
};

export const VOXEL_FACES: VoxelFace[] = [
  { key: 'xp', label: '+X', dx: 1, dy: 0, dz: 0 },
  { key: 'xn', label: '-X', dx: -1, dy: 0, dz: 0 },
  { key: 'yp', label: '+Y', dx: 0, dy: 1, dz: 0 },
  { key: 'yn', label: '-Y', dx: 0, dy: -1, dz: 0 },
  { key: 'zp', label: '+Z', dx: 0, dy: 0, dz: 1 },
  { key: 'zn', label: '-Z', dx: 0, dy: 0, dz: -1 },
];

export const VOXEL_KINDS: Record<VoxelBlockKind, { label: string; color: string; opacity?: number }> = {
  floor: { label: 'Floor', color: '#6f6652' },
  wall: { label: 'Wall', color: '#9ca3af' },
  glass: { label: 'Glass', color: '#4fc3df', opacity: 0.48 },
  trim: { label: 'Trim', color: '#d8b56a' },
};

export const VOXEL_PALETTE: VoxelBlockKind[] = ['wall', 'glass', 'trim', 'floor'];

export function emptyItemDraft(): ItemDraft {
  return {
    radius: ITEM_DRAFT_DEFAULTS.radius,
    amount: ITEM_DRAFT_DEFAULTS.amount,
    grid: emptyItemGrid(),
    color: ITEM_DRAFT_DEFAULTS.color,
    source: null,
    representation: 'globe',
    voxelShape: null,
  };
}

export function gameItemRosterId(id: string): string {
  return `${GAME_ITEM_ROSTER_PREFIX}${id}`;
}

export function gameItemIdFromRosterId(id: string): string | null {
  return id.startsWith(GAME_ITEM_ROSTER_PREFIX) ? id.slice(GAME_ITEM_ROSTER_PREFIX.length) : null;
}

export function streamItemRosterId(id: string): string {
  return `${STREAM_ITEM_ROSTER_PREFIX}${id}`;
}

export function streamItemIdFromRosterId(id: string): string {
  return id.startsWith(STREAM_ITEM_ROSTER_PREFIX) ? id.slice(STREAM_ITEM_ROSTER_PREFIX.length) : id;
}

export function draftToItemDoc(draft: ItemDraft, name: string): SculptedItemDoc {
  return {
    kind: 'sculpted-item',
    version: 1,
    name,
    radius: draft.radius,
    amount: draft.amount,
    cols: GRID_W,
    rows: GRID_H,
    grid: draft.grid.slice(),
    color: draft.color,
    source: draft.source,
    representation: draft.representation,
    voxelShape: draft.voxelShape ? cloneVoxelShape(draft.voxelShape) : null,
    metadata: { title: name },
  };
}

export function draftFromItemDoc(doc: SculptedItemDoc): ItemDraft {
  return {
    radius: doc.radius,
    amount: doc.amount,
    grid: doc.grid.length === GRID_W * GRID_H ? doc.grid.slice() : emptyItemGrid(),
    color: doc.color,
    source: doc.source ?? null,
    representation: doc.representation ?? (doc.voxelShape ? 'voxel-surface' : 'globe'),
    voxelShape: doc.voxelShape ? cloneVoxelShape(doc.voxelShape) : null,
  };
}

function cloneVoxelShape(shape: ItemVoxelShapeDoc): ItemVoxelShapeDoc {
  return {
    kind: 'voxel-shape',
    version: 1,
    dims: { ...shape.dims },
    cellSizeMeters: shape.cellSizeMeters,
    blocks: shape.blocks.map((b) => ({ id: b.id, x: b.x, y: b.y, z: b.z, kind: b.kind })),
    mesh: {
      quads: shape.mesh.quads,
      vertices: shape.mesh.vertices,
      bounds: { size: [shape.mesh.bounds.size[0], shape.mesh.bounds.size[1], shape.mesh.bounds.size[2]] },
    },
  };
}

function cloneDraft(draft: ItemDraft): ItemDraft {
  return {
    radius: draft.radius,
    amount: draft.amount,
    grid: draft.grid.slice(),
    color: draft.color,
    source: draft.source ? { blocks: draft.source.blocks, dims: { ...draft.source.dims }, cellSizeMeters: draft.source.cellSizeMeters } : null,
    representation: draft.representation,
    voxelShape: draft.voxelShape ? cloneVoxelShape(draft.voxelShape) : null,
  };
}

function cloneAutoBakeBase(base: AutoBakeBase | null): AutoBakeBase | null {
  return base
    ? {
      radius: base.radius,
      amount: base.amount,
      grid: base.grid.slice(),
      source: { blocks: base.source.blocks, dims: { ...base.source.dims }, cellSizeMeters: base.source.cellSizeMeters },
    }
    : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function coordKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

export function addFace(b: WorkbenchVoxelBlock, f: VoxelFace): { x: number; y: number; z: number } {
  return { x: b.x + f.dx, y: b.y + f.dy, z: b.z + f.dz };
}

export function inVoxelBounds(p: { x: number; y: number; z: number }, dims: VoxelDims): boolean {
  return p.x >= 0 && p.x < dims.w && p.z >= 0 && p.z < dims.d && p.y >= 0 && p.y <= dims.h;
}

export function makeVoxelFloor(dims: VoxelDims): WorkbenchVoxelBlock[] {
  const blocks: WorkbenchVoxelBlock[] = [];
  let id = 1;
  for (let z = 0; z < dims.d; z++) {
    for (let x = 0; x < dims.w; x++) blocks.push({ id: id++, x, y: 0, z, kind: 'floor', locked: true });
  }
  return blocks;
}

function fitBlocks(blocks: WorkbenchVoxelBlock[], dims: VoxelDims): WorkbenchVoxelBlock[] {
  return blocks.filter((b) => b.locked || inVoxelBounds(b, dims));
}

function facePlane(block: WorkbenchVoxelBlock, face: VoxelFace): number {
  if (face.dx > 0) return block.x + 1;
  if (face.dx < 0) return block.x;
  if (face.dy > 0) return block.y + 1;
  if (face.dy < 0) return block.y;
  if (face.dz > 0) return block.z + 1;
  return block.z;
}

function faceUv(block: WorkbenchVoxelBlock, face: VoxelFace): { u: number; v: number } {
  if (face.dx !== 0) return { u: block.z, v: block.y };
  if (face.dy !== 0) return { u: block.x, v: block.z };
  return { u: block.x, v: block.y };
}

export function detectVoxelFaceGroups(blocks: WorkbenchVoxelBlock[]): VoxelFaceGroup[] {
  const occupied = new Set(blocks.map((b) => coordKey(b.x, b.y, b.z)));
  const buckets = new Map<string, { block: WorkbenchVoxelBlock; face: VoxelFace; u: number; v: number; plane: number }[]>();
  for (const block of blocks) {
    for (const face of VOXEL_FACES) {
      if (occupied.has(coordKey(block.x + face.dx, block.y + face.dy, block.z + face.dz))) continue;
      const plane = facePlane(block, face);
      const { u, v } = faceUv(block, face);
      const key = `${face.key}:${block.kind}:${plane}`;
      const arr = buckets.get(key) ?? [];
      arr.push({ block, face, u, v, plane });
      buckets.set(key, arr);
    }
  }

  const groups: VoxelFaceGroup[] = [];
  for (const [, items] of buckets) {
    const pending = new Map(items.map((it) => [`${it.u}:${it.v}`, it]));
    while (pending.size) {
      const firstKey = pending.keys().next().value as string;
      const first = pending.get(firstKey)!;
      pending.delete(firstKey);
      const stack = [first];
      const cells: VoxelFaceGroup['cells'] = [];
      let u0 = first.u, u1 = first.u, v0 = first.v, v1 = first.v;
      while (stack.length) {
        const cur = stack.pop()!;
        cells.push({ x: cur.block.x, y: cur.block.y, z: cur.block.z, u: cur.u, v: cur.v });
        u0 = Math.min(u0, cur.u); u1 = Math.max(u1, cur.u);
        v0 = Math.min(v0, cur.v); v1 = Math.max(v1, cur.v);
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nk = `${cur.u + du}:${cur.v + dv}`;
          const next = pending.get(nk);
          if (!next) continue;
          pending.delete(nk);
          stack.push(next);
        }
      }
      const id = `${first.face.key}_${first.block.kind}_${first.plane}_${groups.length}`;
      groups.push({ id, face: first.face, kind: first.block.kind, plane: first.plane, cells, bounds: { u0, v0, u1: u1 + 1, v1: v1 + 1 } });
    }
  }
  return groups.sort((a, b) => b.cells.length - a.cells.length || a.id.localeCompare(b.id));
}

export function voxelDocFromState(dims: VoxelDims, custom: WorkbenchVoxelBlock[], cellSizeMeters = VOXEL_BLOCKOUT_TUNING.defaultCellSizeMeters): VoxelBlockoutDoc {
  return {
    dims: { ...dims },
    cellSizeMeters: normalizeVoxelCellSizeMeters(cellSizeMeters),
    blocks: custom.map((b) => ({ id: b.id, x: b.x, y: b.y, z: b.z, kind: b.kind })),
  };
}

function defaultExport(path: string, content: string): void {
  mkdir('cart/hmsc-int/exports');
  writeFile(path, content);
}

export function createItemStore(deps: ItemStoreDeps) {
  const autosaveMs = deps.autosaveMs ?? AUTOSAVE_MS;
  const tw = deps.twig !== false;
  const adapter: TwigAdapter | null = typeof deps.twig === 'object' ? deps.twig : null;
  const twigRead = <T,>(key: string, initial: T): T => {
    if (!tw) return initial;
    if (adapter) return adapter.read(key, initial);
    try { return readRouteTwigState(TWIG_ROUTE, key, initial); } catch { return initial; }
  };
  const twigWrite = <T,>(key: string, value: T): void => {
    if (!tw) return;
    if (adapter) { adapter.write(key, value); return; }
    try { writeRouteTwigState(TWIG_ROUTE, key, value); } catch { /* twigless host */ }
  };

  let draft = emptyItemDraft();
  let draftId: string | null = null;
  let draftName = 'new item';
  let selectedGameItemId: string | null = null;
  let workingDraftVisible = false;
  let status: string | null = deps.error ? `store unavailable: ${deps.error}` : null;
  let rosterRev = 0;
  let seq = 0;
  let installRev = 0;
  const view = {
    lens: twigRead<ItemLens>('lens', 'item'),
    sculptMode: twigRead<SculptMode>('sculptMode', 'raise'),
    mirror: twigRead('mirror', false),
    brush: twigRead('brush', 14),
    strength: twigRead('strength', 0.5),
    smoothIterations: twigRead('smoothIterations', SMOOTH_TUNING.action.iterations),
    showGrabGrid: twigRead('showGrabGrid', true),
    voxelTool: twigRead<VoxelTool>('voxelTool', 'build'),
    voxelKind: twigRead<VoxelBlockKind>('voxelKind', 'wall'),
    activeFace: twigRead<VoxelFace>('activeFace', VOXEL_FACES[2]),
    selectedVoxelId: twigRead('selectedVoxelId', 1),
    selectedGroupId: twigRead<string | null>('selectedGroupId', null),
  };
  let voxelDims: VoxelDims = deps.voxels?.state().doc?.dims ?? { w: 5, d: 6, h: 7 };
  let voxelCellSizeMeters = normalizeVoxelCellSizeMeters(deps.voxels?.state().doc?.cellSizeMeters);
  let voxelCustom: WorkbenchVoxelBlock[] = deps.voxels?.state().doc?.blocks.map((b) => ({ ...b })) ?? [];
  let autoBakeBase: AutoBakeBase | null = null;

  const listeners = new Set<() => void>();
  const emit = () => { for (const fn of [...listeners]) fn(); };
  const history = createPaintHistory<ItemDraft>();
  const snapDraft = () => cloneDraft(draft);

  let itemTimer: ReturnType<typeof setTimeout> | null = null;
  let voxelTimer: ReturnType<typeof setTimeout> | null = null;

  const selectedRosterId = (): string | null => {
    if (selectedGameItemId) return gameItemRosterId(selectedGameItemId);
    if (draftId) return streamItemRosterId(draftId);
    if (workingDraftVisible) return WORKING_ITEM_ROSTER_ID;
    return null;
  };
  const lensBoundItemId = (lens: ItemLens = view.lens): string => {
    if (selectedGameItemId) return gameItemRosterId(selectedGameItemId);
    if (draftId) return streamItemRosterId(draftId);
    if (workingDraftVisible || lens === 'sculpt' || lens === 'voxel') return WORKING_ITEM_ROSTER_ID;
    return 'none';
  };
  const traceLensBinding = (hop: string, selection = selectedRosterId(), lens: ItemLens = view.lens): void => {
    console.log(`[ITEMLENS-0607] ${hop} selection=${selection ?? 'none'} lens=${lens} bound=${lensBoundItemId(lens)} draft=${draftId ?? 'working'} registry=${selectedGameItemId ?? 'none'} name="${draftName}" source=${draft.source ? `${draft.source.blocks} blocks` : 'none'}`);
  };

  const flushItemAutosave = () => {
    if (!deps.itemSession) return;
    const id = draftId ?? mintItemId();
    draftId = id;
    deps.itemSession.commit({ kind: 'authored', id, doc: draftToItemDoc(draft, draftName) }, `autosave · ${draftName}`);
    rosterRev += 1;
  };
  const scheduleItemAutosave = () => {
    if (!deps.itemSession) return;
    if (autosaveMs <= 0) { flushItemAutosave(); return; }
    if (itemTimer) clearTimeout(itemTimer);
    itemTimer = setTimeout(() => { itemTimer = null; flushItemAutosave(); emit(); }, autosaveMs);
  };
  const flushVoxelAutosave = () => {
    if (!deps.voxelSession) return;
    const doc = voxelDocFromState(voxelDims, voxelCustom, voxelCellSizeMeters);
    deps.voxelSession.commit({ kind: 'authored', doc }, `autosave · ${doc.blocks.length} blocks · ${doc.dims.w}x${doc.dims.d}x${doc.dims.h} @ ${doc.cellSizeMeters.toFixed(2)}m`);
  };
  const scheduleVoxelAutosave = () => {
    if (!deps.voxelSession) return;
    if (autosaveMs <= 0) { flushVoxelAutosave(); return; }
    if (voxelTimer) clearTimeout(voxelTimer);
    voxelTimer = setTimeout(() => { voxelTimer = null; flushVoxelAutosave(); emit(); }, autosaveMs);
  };

  const setStatus = (s: string | null) => { status = s; emit(); };
  const bumpItem = (opts?: { autosave?: boolean }) => {
    seq += 1;
    if (opts?.autosave !== false) scheduleItemAutosave();
    emit();
  };
  const installDraft = (next: ItemDraft, opts?: { autosave?: boolean; history?: boolean }) => {
    if (opts?.history) history.commit(snapDraft);
    draft = cloneDraft(next);
    seq += 1;
    installRev += 1;
    if (opts?.autosave) scheduleItemAutosave();
    emit();
  };
  const editDraft = (updater: (d: ItemDraft) => ItemDraft) => {
    history.commit(snapDraft);
    draft = cloneDraft(updater(draft));
    bumpItem();
  };
  const editDraftCoalesced = (updater: (d: ItemDraft) => ItemDraft) => {
    history.commitCoalesced(snapDraft);
    draft = cloneDraft(updater(draft));
    bumpItem();
  };
  const restoreDraft = (state: ItemDraft | null, label: string) => {
    if (!state) { setStatus(`nothing to ${label}`); return; }
    installDraft(state, { autosave: true });
    deps.itemSession?.note(label);
    setStatus(label);
  };

  const rosterState = (): ItemsStreamState => deps.items?.state() ?? { items: {}, order: [] };
  const registryItem = (): ItemDefinition | null => {
    if (!selectedGameItemId || !GAME_ITEMS.is(selectedGameItemId)) return null;
    return GAME_ITEMS.get(selectedGameItemId);
  };
  const loadFromRoster = (id: string, opts?: { history?: boolean }) => {
    if (id === WORKING_ITEM_ROSTER_ID) {
      selectedGameItemId = null;
      workingDraftVisible = true;
      emit();
      return;
    }
    const gameId = gameItemIdFromRosterId(id);
    if (gameId) {
      if (!GAME_ITEMS.is(gameId)) return;
      const def = GAME_ITEMS.get(gameId);
      selectedGameItemId = gameId;
      draftId = null;
      draftName = def.label;
      view.lens = 'item';
      twigWrite('lens', view.lens);
      setStatus(`registry item · ${def.scaleStatus} scale · no migration written`);
      traceLensBinding('pick', id);
      emit();
      return;
    }
    const streamId = streamItemIdFromRosterId(id);
    const doc = rosterState().items[streamId];
    if (!doc) return;
    selectedGameItemId = null;
    installDraft(draftFromItemDoc(doc), { history: opts?.history !== false });
    autoBakeBase = doc.source ? { radius: doc.radius, amount: doc.amount, grid: doc.grid.slice(), source: doc.source } : null;
    draftId = streamId;
    draftName = doc.metadata?.title ?? doc.name;
    setStatus(`loaded "${draftName}"`);
    traceLensBinding('pick', id);
    emit();
  };
  const saveToRoster = () => {
    selectedGameItemId = null;
    if (!deps.itemSession) { setStatus(`save unavailable — ${deps.error ?? 'no session'}`); return; }
    const id = draftId ?? mintItemId();
    deps.itemSession.commit({ kind: 'authored', id, doc: draftToItemDoc(draft, draftName) }, `${draftName}: saved`);
    draftId = id;
    rosterRev += 1;
    setStatus(`saved "${draftName}" — it shows up as a prop in characters`);
  };
  const removeFromRoster = (id: string) => {
    if (gameItemIdFromRosterId(id)) { setStatus('registry items are read-only until the scale audit/migration'); return; }
    if (!deps.itemSession) { setStatus(`remove unavailable — ${deps.error ?? 'no session'}`); return; }
    const streamId = streamItemIdFromRosterId(id);
    deps.itemSession.commit({ kind: 'removed', id: streamId }, `${streamId}: removed`);
    rosterRev += 1;
    if (draftId === streamId) draftId = null;
    setStatus('removed from the roster (its history stays in the log)');
  };
  const newItem = () => {
    history.commit(snapDraft);
    selectedGameItemId = null;
    workingDraftVisible = true;
    draft = emptyItemDraft();
    autoBakeBase = null;
    draftId = null;
    draftName = 'new item';
    view.lens = 'item';
    twigWrite('lens', view.lens);
    bumpItem({ autosave: true });
    setStatus('blank sphere — sculpt from scratch, or build voxels to shape it');
  };
  const openVoxelBlockout = () => {
    selectedGameItemId = null;
    workingDraftVisible = true;
    view.lens = 'voxel';
    view.voxelTool = 'build';
    twigWrite('lens', view.lens);
    twigWrite('voxelTool', view.voxelTool);
    setStatus('voxel blockout — stack blocks here; sculpt updates automatically');
  };
  const setGrid = (grid: number[], opts?: { history?: boolean; note?: string }) => {
    if (opts?.history) history.commit(snapDraft);
    draft = { ...draft, grid: grid.slice() };
    if (opts?.note) deps.itemSession?.note(opts.note);
    bumpItem();
  };
  const commitGrid = (baseGrid: number[], grid: number[], note?: string) => {
    history.commit(() => {
      const pre = snapDraft();
      pre.grid = baseGrid.slice();
      return pre;
    });
    draft = { ...draft, grid: grid.slice() };
    if (note) deps.itemSession?.note(note);
    bumpItem();
  };
  const sculptDeltaFromBase = (base: AutoBakeBase | null): number[] => {
    if (!base || base.grid.length !== draft.grid.length) return new Array(draft.grid.length).fill(0);
    return draft.grid.map((v, i) => v - base.grid[i]);
  };
  const applyVoxelBake = (reason: string, opts?: { history?: boolean; switchLens?: boolean }) => {
    const doc = voxelDocFromState(voxelDims, voxelCustom, voxelCellSizeMeters);
    if (doc.blocks.length === 0) {
      const hadBase = autoBakeBase !== null || draft.source !== null;
      autoBakeBase = null;
      if (hadBase) {
        if (opts?.history) history.commit(snapDraft);
        draft = { ...emptyItemDraft(), color: draft.color, representation: 'globe', voxelShape: null };
        bumpItem({ autosave: true });
      }
      setStatus(`${reason} — no custom blocks; sculpt is a blank item`);
      return false;
    }
    const bake = bakeBlockoutToGlobe(doc);
    if (!bake) { setStatus(`${reason} — blockout did not bake`); return false; }
    const voxelShape = itemVoxelShapeFromBlockout(doc);
    if (opts?.history) history.commit(snapDraft);
    selectedGameItemId = null;
    workingDraftVisible = workingDraftVisible || !draftId;
    const delta = sculptDeltaFromBase(autoBakeBase);
    const grid = bake.grid.map((v, i) => clamp(v + (delta[i] ?? 0), -1, 1));
    const source = { blocks: doc.blocks.length, dims: { ...doc.dims }, cellSizeMeters: doc.cellSizeMeters };
    const representation: ItemRepresentation = draft.representation === 'voxel-mesh' ? 'voxel-mesh' : 'voxel-surface';
    draft = {
      ...draft,
      radius: bake.radius,
      amount: bake.amount,
      grid,
      source,
      representation,
      voxelShape,
    };
    autoBakeBase = { radius: bake.radius, amount: bake.amount, grid: bake.grid.slice(), source };
    if (!draftName || draftName === 'new item') draftName = 'blockout item';
    if (opts?.switchLens) {
      view.lens = 'sculpt';
      twigWrite('lens', view.lens);
    }
    deps.itemSession?.note(`auto-bake blockout · ${doc.blocks.length} blocks · ${doc.dims.w}x${doc.dims.d}x${doc.dims.h} @ ${doc.cellSizeMeters.toFixed(2)}m`);
    bumpItem({ autosave: true });
    setStatus(`${reason} — ${representation} auto-baked from ${doc.blocks.length} blocks @ ${doc.cellSizeMeters.toFixed(2)}m cells`);
    return true;
  };
  const voxelFloor = () => makeVoxelFloor(voxelDims);
  const voxelBlocks = () => [...voxelFloor(), ...voxelCustom];
  const voxelGroups = () => detectVoxelFaceGroups(voxelBlocks());
  const selectedVoxel = () => voxelBlocks().find((b) => b.id === view.selectedVoxelId) ?? voxelBlocks()[0];
  const voxelPreview = () => addFace(selectedVoxel(), view.activeFace);
  const voxelPreviewOk = () => {
    const p = voxelPreview();
    const occupied = new Set(voxelBlocks().map((b) => coordKey(b.x, b.y, b.z)));
    return inVoxelBounds(p, voxelDims) && !occupied.has(coordKey(p.x, p.y, p.z));
  };
  const commitVoxel = (statusText: string) => {
    const base = cloneAutoBakeBase(autoBakeBase);
    const before = snapDraft();
    const changed = applyVoxelBake(statusText, { history: false, switchLens: false });
    if (changed) {
      history.commit(() => before);
    } else if (base !== autoBakeBase) {
      history.commit(() => before);
    }
    scheduleVoxelAutosave();
    emit();
  };
  const setVoxelCellSizeMeters = (size: number) => {
    voxelCellSizeMeters = normalizeVoxelCellSizeMeters(size);
    commitVoxel(`Cell size ${voxelCellSizeMeters.toFixed(2)}m`);
  };
  const setVoxelDims = (patch: Partial<VoxelDims>) => {
    voxelDims = {
      w: clamp(Math.round(patch.w ?? voxelDims.w), 1, 20),
      d: clamp(Math.round(patch.d ?? voxelDims.d), 1, 20),
      h: clamp(Math.round(patch.h ?? voxelDims.h), 1, 20),
    };
    voxelCustom = fitBlocks(voxelCustom, voxelDims);
    view.selectedVoxelId = 1;
    twigWrite('selectedVoxelId', 1);
    commitVoxel('Resized blockout');
  };
  const setActiveFace = (face: VoxelFace) => {
    view.activeFace = face;
    twigWrite('activeFace', face);
    emit();
  };
  const setVoxelTool = (tool: VoxelTool) => {
    view.voxelTool = tool;
    twigWrite('voxelTool', tool);
    emit();
  };
  const setVoxelKind = (kind: VoxelBlockKind) => {
    view.voxelKind = kind;
    view.voxelTool = 'build';
    twigWrite('voxelKind', kind);
    twigWrite('voxelTool', 'build');
    emit();
  };
  const selectVoxel = (id: number) => {
    view.selectedVoxelId = id;
    twigWrite('selectedVoxelId', id);
    setStatus(`Selected #${id}`);
  };
  const selectGroup = (id: string | null) => {
    view.selectedGroupId = id;
    twigWrite('selectedGroupId', id);
    const g = voxelGroups().find((x) => x.id === id);
    setStatus(g ? `Face ${g.face.label} ${g.kind} x${g.cells.length}` : null);
  };
  const onVoxelFace = (block: WorkbenchVoxelBlock, face: VoxelFace) => {
    view.selectedVoxelId = block.id;
    view.activeFace = face;
    twigWrite('selectedVoxelId', block.id);
    twigWrite('activeFace', face);
    if (view.voxelTool === 'mine') {
      if (block.locked) { setStatus('Floor is locked'); return; }
      voxelCustom = voxelCustom.filter((b) => b.id !== block.id);
      view.selectedVoxelId = 1;
      twigWrite('selectedVoxelId', 1);
      commitVoxel('Removed block');
      return;
    }
    const nextPos = addFace(block, face);
    const occupied = new Set(voxelBlocks().map((b) => coordKey(b.x, b.y, b.z)));
    const key = coordKey(nextPos.x, nextPos.y, nextPos.z);
    if (!inVoxelBounds(nextPos, voxelDims)) { setStatus('Outside declared space'); return; }
    if (occupied.has(key)) {
      const hit = voxelBlocks().find((b) => coordKey(b.x, b.y, b.z) === key);
      if (hit) view.selectedVoxelId = hit.id;
      setStatus('Occupied');
      return;
    }
    const nextId = Math.max(1000, ...voxelCustom.map((b) => b.id)) + 1;
    const nextBlock: WorkbenchVoxelBlock = { id: nextId, ...nextPos, kind: view.voxelKind };
    voxelCustom = voxelCustom.concat(nextBlock);
    view.selectedVoxelId = nextId;
    twigWrite('selectedVoxelId', nextId);
    commitVoxel(`Added ${VOXEL_KINDS[view.voxelKind].label}`);
  };
  const addPreviewBlock = () => {
    if (!voxelPreviewOk()) { setStatus('Preview blocked'); return; }
    onVoxelFace(selectedVoxel(), view.activeFace);
  };
  const clearVoxel = () => {
    voxelCustom = [];
    view.selectedVoxelId = 1;
    view.activeFace = VOXEL_FACES[2];
    view.voxelTool = 'build';
    twigWrite('selectedVoxelId', 1);
    twigWrite('activeFace', VOXEL_FACES[2]);
    twigWrite('voxelTool', 'build');
    commitVoxel('Cleared blockout');
  };
  const exportVoxelJson = () => {
    const groups = voxelGroups();
    const payload = {
      schema: 'hmsc-int.voxel-blockout.v1',
      exportedAt: new Date().toISOString(),
      dims: voxelDims,
      cellSizeMeters: voxelCellSizeMeters,
      worldSizeMeters: {
        w: voxelDims.w * voxelCellSizeMeters,
        d: voxelDims.d * voxelCellSizeMeters,
        h: voxelDims.h * voxelCellSizeMeters,
      },
      blocks: voxelCustom.map((b) => ({ x: b.x, y: b.y, z: b.z, kind: b.kind })),
      artificialFloor: { y: 0, width: voxelDims.w, depth: voxelDims.d, cellSizeMeters: voxelCellSizeMeters },
      faceGroups: groups.map((g) => ({
        id: g.id,
        face: g.face.key,
        normal: { x: g.face.dx, y: g.face.dy, z: g.face.dz },
        kind: g.kind,
        plane: g.plane,
        bounds: g.bounds,
        cells: g.cells,
        textureKey: `${g.kind}/${g.face.key}/${g.id}`,
      })),
    };
    const path = 'cart/hmsc-int/exports/voxel-blockout.json';
    (deps.exportFile ?? defaultExport)(path, JSON.stringify(payload, null, 2));
    setStatus(`Exported ${groups.length} face groups`);
  };

  const st = rosterState();
  if (st.order.length > 0) {
    const remembered = twigRead<string | null>('draftId', null);
    const id = remembered && st.items[remembered] ? remembered : st.order[st.order.length - 1];
    loadFromRoster(id, { history: false });
    status = `restored "${draftName}" — the draft autosaves as you work`;
  }
  if (voxelCustom.length > 0) applyVoxelBake('restored voxel blockout', { history: false, switchLens: false });

  const setViewKey = <K extends keyof typeof view>(key: K, twigKey: string) => (value: (typeof view)[K]) => {
    (view[key] as (typeof view)[K]) = value;
    twigWrite(twigKey, value);
    emit();
  };

  return {
    subscribe(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); },
    get draft() { return draft; },
    get draftId() { return draftId; },
    get draftName() { return draftName; },
    selectedRegistryItem: registryItem,
    selectedRosterId,
    lensBoundItemId,
    traceLensBinding,
    get workingDraftVisible() { return workingDraftVisible; },
    get status() { return status; },
    get rosterRev() { return rosterRev; },
    get seq() { return seq; },
    get installRev() { return installRev; },
    get view() { return view; },
    get voxelDims() { return voxelDims; },
    get voxelCellSizeMeters() { return voxelCellSizeMeters; },
    get voxelCustom() { return voxelCustom; },
    get voxelDoc() { return voxelDocFromState(voxelDims, voxelCustom, voxelCellSizeMeters); },
    get itemParams() { return itemGlobeParams(draft); },
    get itemVoxelMeshParams() { return itemVoxelMeshParams(draft); },
    rosterState,
    voxelBlocks,
    voxelGroups,
    selectedVoxel,
    selectedGroup: () => voxelGroups().find((g) => g.id === view.selectedGroupId) ?? voxelGroups()[0] ?? null,
    voxelPreview,
    voxelPreviewOk,
    snapDraft,
    editDraft,
    editDraftCoalesced,
    installDraft,
    setGrid,
    commitGrid,
    setStatus,
    setDraftName: (name: string) => { draftName = name; twigWrite('draftName', name); emit(); },
    setRadius: (radius: number) => editDraftCoalesced((d) => ({ ...d, radius: clamp(radius, ITEM_KNOBS.radius.min, ITEM_KNOBS.radius.max) })),
    setAmount: (amount: number) => editDraftCoalesced((d) => ({ ...d, amount: clamp(amount, ITEM_KNOBS.amount.min, ITEM_KNOBS.amount.max) })),
    setColor: (color: string) => editDraft((d) => ({ ...d, color })),
    setRepresentation: (representation: ItemRepresentation) => {
      if (representation !== 'globe' && !draft.voxelShape) {
        setStatus('build a voxel blockout before comparing voxel representations');
        return;
      }
      editDraft((d) => ({ ...d, representation }));
      setStatus(`representation = ${representation}`);
    },
    setLens: (lens: ItemLens) => {
      view.lens = lens;
      twigWrite('lens', lens);
      traceLensBinding('lens', selectedRosterId(), lens);
      emit();
    },
    setSculptMode: setViewKey('sculptMode', 'sculptMode'),
    setMirror: setViewKey('mirror', 'mirror'),
    setBrush: setViewKey('brush', 'brush'),
    setStrength: setViewKey('strength', 'strength'),
    setSmoothIterations: setViewKey('smoothIterations', 'smoothIterations'),
    setShowGrabGrid: setViewKey('showGrabGrid', 'showGrabGrid'),
    setVoxelDims,
    setVoxelCellSizeMeters,
    setVoxelTool,
    setVoxelKind,
    setActiveFace,
    selectVoxel,
    selectGroup,
    onVoxelFace,
    addPreviewBlock,
    clearVoxel,
    exportVoxelJson,
    saveToRoster,
    loadFromRoster,
    removeFromRoster,
    newItem,
    openVoxelBlockout,
    undo: () => restoreDraft(history.undo(snapDraft), 'undo'),
    redo: () => restoreDraft(history.redo(snapDraft), 'redo'),
    clearSculpt: () => {
      if (autoBakeBase) {
        installDraft({ ...draft, radius: autoBakeBase.radius, amount: autoBakeBase.amount, grid: autoBakeBase.grid.slice(), source: autoBakeBase.source }, { autosave: true, history: true });
        deps.itemSession?.note('clear sculpt detail');
        setStatus('cleared sculpt detail; voxel base kept');
        return;
      }
      setGrid(emptyItemGrid(), { history: true, note: 'clear sculpt' });
    },
    softenGrid: (grid: number[]) => setGrid(grid, { history: true, note: 'soften' }),
    note: (label: string) => deps.itemSession?.note(label),
  };
}

export type ItemStore = ReturnType<typeof createItemStore>;

let liveStore: ItemStore | null = null;

export function itemWorkbenchStore(): ItemStore {
  if (liveStore) return liveStore;
  let deps: ItemStoreDeps;
  try {
    const items = editorChannel(itemsStream);
    const voxels = editorChannel(voxelsStream);
    const sessions = editorSessions();
    deps = {
      items,
      itemSession: sessions.open('/workbench/items', items) as RouteSession<ItemsEvent>,
      voxels,
      voxelSession: sessions.open('/workbench/items', voxels) as RouteSession<VoxelsEvent>,
      error: null,
    };
  } catch (e) {
    deps = { items: null, itemSession: null, voxels: null, voxelSession: null, error: String(e) };
  }
  liveStore = createItemStore(deps);
  return liveStore;
}
