// editors/model/studioModel.ts — the Studio's WORKING SCENE: an in-memory view
// over ONE open model from the library (editors/model/modelStream.ts). This is
// the painter-shaped restructure (req_0998/req_1000, [[feedback_studio_branch_twig_cold_hot]]):
//
//   • The editor BOOTS TO 'new' (blank) on a cold start — `openModelId` is a TWIG
//     held in hotstate (in-process), so it survives a hot reload but resets on a
//     fresh process. The branch (the model's parts + edit history) lives in the
//     V20 store and survives everything.
//   • Adding the first part to a blank scene MINTS a saved model (auto-named
//     `new_mesh_NNN`) that appears in the library roster immediately.
//   • EVERY part edit is a BRANCH save on the open model's history (V20 commit +
//     a labeled undo point). Undo/redo are part-edit only (twigs never undo).
//   • Picking a library row OPENS that model; 'new' returns to a blank scene.
//
// The scene is a module-level shared store so column 3 (UV panel) and column 4
// (viewport) read the SAME parts. When the data store is unavailable it falls
// back to an in-memory fold so the viewport never crashes.

import { useEffect } from 'react';
import { getHotState, setHotState, useRerender } from '@reactjit/hooks';
import type { GeometryData } from '@reactjit/geometries';
import { cuboid, editMeshToGeometry, type EditMesh } from './editMesh';
import type { LayerStripAction } from '../paint/LayerStrip';
import { libraryModels, modelParts, modelStream, type ModelEvent, type ModelStreamState, type StoredModel, type StoredPart } from './modelStream';
import type { StreamHandle } from '../../data';
import { editorChannel } from '../store';
import { editorSessions, type RouteSession } from '../sessions';

const ROUTE = '/studio';
/** TWIG: which model is open. hotstate-only → survives hot reload, resets cold. */
const HOT_OPEN = 'studio:openModel';

export type StudioPart = {
  id: string;
  name: string;
  mesh: EditMesh;
  geo: GeometryData;
  /** GLASS (req_1181): the translucent faces lowered separately, rendered as a
   *  see-through pass over the opaque `geo`. null when the part has no glass faces. */
  glassGeo: GeometryData | null;
  visible: boolean;
  color: string;
  version: number;
  lift: number;
};

function liftToGround(mesh: EditMesh): number {
  let lo = Infinity;
  for (const v of mesh.verts) if (v[1] < lo) lo = v[1];
  return Number.isFinite(lo) ? -lo : 0;
}

const PART_TINTS = ['#c9b48f', '#8fb6c9', '#c98f9b', '#9cc98f', '#b49bc9', '#c9c08f', '#8fc9bb'];

export type StudioModel = {
  /** the open model, or null on a blank 'new' scene. */
  openModelId: string | null;
  /** the open model's name (null on a blank scene). */
  modelName: string | null;
  /** the library of saved models (the roster). */
  models: StoredModel[];
  parts: StudioPart[];
  activeId: string | null;
  revision: number;
  meshRev: number;
  activePart: StudioPart | null;
  visibleParts: StudioPart[];
  /** the face indices currently selected in the viewport (face mode) — the UV
   *  panel scopes to these so it shows the SELECTED face's island (Part 5.2). */
  selectedFaces: number[];
  setSelectedFaces(ids: number[]): void;
  select(id: string): void;
  addPart(mesh: EditMesh, name: string): string;
  addCube(diameter: number, height: number): string;
  addCuboid(): void;
  rename(id: string, name: string): void;
  updatePartMesh(id: string, mesh: EditMesh): void;
  runAction(id: string, action: LayerStripAction): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  /** library verbs (the roster): blank 'new' scene, open a saved model, rename it. */
  newModel(): void;
  openModel(id: string): void;
  renameModel(name: string): void;
  /** delete a saved model from the library (req_1060). If it was open, fall back
   *  to the blank 'new' scene. This is a BRANCH event — not undoable here. */
  deleteModel(id: string): void;
};

// ── The live stream wiring ──────────────────────────────────────────────────────

type Live = { channel: StreamHandle<ModelStreamState, ModelEvent>; session: RouteSession<ModelEvent> };
let live: Live | null = null;
let liveTried = false;
let memState: ModelStreamState = modelStream.initial();

function acquire(): Live | null {
  if (live || liveTried) return live;
  liveTried = true;
  try {
    const channel = editorChannel(modelStream);
    const session = editorSessions().open(ROUTE, channel) as RouteSession<ModelEvent>;
    live = { channel, session };
  } catch {
    live = null;
  }
  return live;
}

function streamState(): ModelStreamState {
  const l = acquire();
  return l ? l.channel.state() : memState;
}

function pushEvent(event: ModelEvent, label: string): void {
  const l = acquire();
  if (l) l.session.commit(event, label);
  else memState = modelStream.apply(memState, event);
}

function labelFor(event: ModelEvent): string {
  switch (event.kind) {
    case 'modelCreated': return `new ${event.name}`;
    case 'modelRenamed': return `rename model → ${event.name}`;
    case 'modelDeleted': return 'delete model';
    case 'partAdded': return `add ${event.part.name}`;
    case 'partMeshUpdated': return 'edit mesh';
    case 'partRenamed': return `rename → ${event.name}`;
    case 'partVisibilitySet': return event.visible ? 'show part' : 'hide part';
    case 'partReordered': return `reorder ${event.dir}`;
    case 'partRemoved': return 'delete part';
    default: return 'edit';
  }
}

/** the inverse that, applied against the PRE-edit model, undoes `event`. */
function inverseOf(event: ModelEvent, before: StoredModel): ModelEvent | null {
  const model = before.id;
  switch (event.kind) {
    case 'partAdded':
      return { kind: 'partRemoved', model, id: event.part.id };
    case 'partRemoved': {
      const part = before.parts[event.id];
      if (!part) return null;
      const i = before.order.indexOf(event.id);
      const afterId = i > 0 ? before.order[i - 1] : undefined;
      return { kind: 'partAdded', model, part, afterId };
    }
    case 'partMeshUpdated': {
      const p = before.parts[event.id];
      return p ? { kind: 'partMeshUpdated', model, id: event.id, mesh: p.mesh } : null;
    }
    case 'partRenamed': {
      const p = before.parts[event.id];
      return p ? { kind: 'partRenamed', model, id: event.id, name: p.name } : null;
    }
    case 'partVisibilitySet': {
      const p = before.parts[event.id];
      return p ? { kind: 'partVisibilitySet', model, id: event.id, visible: p.visible } : null;
    }
    case 'partReordered':
      return { kind: 'partReordered', model, id: event.id, dir: event.dir === 'up' ? 'down' : 'up' };
    default:
      return null;
  }
}

// ── The projection store ────────────────────────────────────────────────────────

type Tick = 'structure' | 'mesh';
type StackEntry = { event: ModelEvent; tick: Tick };

const store: { openModelId: string | null; parts: StudioPart[]; activeId: string | null; revision: number; meshRev: number; selectedFaces: number[] } = {
  openModelId: null, parts: [], activeId: null, revision: 0, meshRev: 0, selectedFaces: [],
};
const geoCache = new Map<string, { version: number; geo: GeometryData; glassGeo: GeometryData | null }>();
const undoStack: StackEntry[] = [];
const redoStack: StackEntry[] = [];
const listeners = new Set<() => void>();
const seq = { tint: 0, name: 0 };
let inited = false;

function notify(): void { for (const l of listeners) l(); }
function mintId(prefix: string): string { return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`; }
function nextTint(): string { return PART_TINTS[seq.tint++ % PART_TINTS.length]; }

function buildParts(): void {
  const sps = modelParts(streamState(), store.openModelId);
  const alive = new Set(sps.map((p) => p.id));
  for (const id of geoCache.keys()) if (!alive.has(id)) geoCache.delete(id);
  store.parts = sps.map((sp: StoredPart) => {
    const cached = geoCache.get(sp.id);
    let geo: GeometryData;
    let glassGeo: GeometryData | null;
    if (cached && cached.version === sp.version) { geo = cached.geo; glassGeo = cached.glassGeo; }
    else {
      // opaque pass excludes glass faces; glass pass is built only when present so
      // a glass-free part pays nothing (req_1181).
      geo = editMeshToGeometry(sp.mesh, (f) => !f.glass);
      glassGeo = sp.mesh.faces.some((f) => f.glass) ? editMeshToGeometry(sp.mesh, (f) => !!f.glass) : null;
      geoCache.set(sp.id, { version: sp.version, geo, glassGeo });
    }
    return { id: sp.id, name: sp.name, mesh: sp.mesh, geo, glassGeo, visible: sp.visible, color: sp.color, version: sp.version, lift: sp.lift };
  });
}

function reproject(tick: Tick): void {
  buildParts();
  if (tick === 'structure') store.revision += 1; else store.meshRev += 1;
  notify();
}

function ensureInit(): void {
  if (inited) return;
  inited = true;
  // openModelId is a TWIG (hotstate): survives a hot reload, empty on cold start.
  const saved = getHotState<string | null>(HOT_OPEN, null);
  store.openModelId = saved && streamState().models?.[saved] ? saved : null;
  buildParts();
  seq.name = store.parts.length;
  seq.tint = store.parts.length;
  store.activeId = store.parts[0]?.id ?? null;
}

function setOpen(id: string | null): void {
  store.openModelId = id;
  setHotState(HOT_OPEN, id);
  undoStack.length = 0; redoStack.length = 0; // undo is per open-model session
  buildParts();
  store.activeId = store.parts[0]?.id ?? null;
  store.revision += 1;
  notify();
}

function setActive(id: string | null): void {
  store.activeId = id;
  notify();
}

function setSelectedFaces(ids: number[]): void {
  // skip the notify when nothing actually changed (the viewport effect can fire
  // on unrelated re-renders) so the UV panel doesn't churn.
  const prev = store.selectedFaces;
  if (prev.length === ids.length && prev.every((v, i) => v === ids[i])) return;
  store.selectedFaces = ids;
  notify();
}

/** Ensure a model is open before a part edit; mint+open a blank one on demand
 *  (the "add on a blank scene creates a model doc" rule). Returns the model id. */
function ensureOpenModel(): string {
  if (store.openModelId) return store.openModelId;
  const id = mintId('mdl');
  const models = libraryModels(streamState());
  let max = 0;
  for (const m of models) { const mt = /^new_mesh_(\d+)$/.exec(m.name); if (mt) max = Math.max(max, Number(mt[1])); }
  const name = `new_mesh_${String(max + 1).padStart(3, '0')}`;
  pushEvent({ kind: 'modelCreated', model: id, name }, labelFor({ kind: 'modelCreated', model: id, name }));
  store.openModelId = id;
  setHotState(HOT_OPEN, id);
  return id;
}

// The one branch-edit door: capture the inverse, append the event, record undo,
// reproject. `history` distinguishes a fresh edit from an undo/redo replay.
function commit(event: ModelEvent, tick: Tick, history: 'record' | 'undo' | 'redo'): void {
  const before = streamState().models?.[(event as any).model];
  const inverse = before ? inverseOf(event, before) : null;
  pushEvent(event, labelFor(event));
  if (inverse) {
    const entry: StackEntry = { event: inverse, tick };
    if (history === 'record') { undoStack.push(entry); redoStack.length = 0; }
    else if (history === 'undo') { redoStack.push(entry); }
    else { undoStack.push(entry); }
  }
  reproject(tick);
}

// ── Mutators ────────────────────────────────────────────────────────────────────

function addPart(mesh: EditMesh, name: string): string {
  ensureInit();
  const model = ensureOpenModel();
  const id = mintId('pt');
  const part: StoredPart = { id, name, mesh, color: nextTint(), visible: true, lift: liftToGround(mesh), version: 0 };
  commit({ kind: 'partAdded', model, part }, 'structure', 'record');
  setActive(id);
  return id;
}

function addCube(diameter: number, height: number): string {
  seq.name += 1;
  return addPart(cuboid(diameter, height, diameter), `Cube ${seq.name}`);
}
function addCuboid(): void { addCube(1, 1); }

function select(id: string): void { ensureInit(); setActive(id); }

function rename(id: string, name: string): void {
  ensureInit();
  const model = store.openModelId; if (!model) return;
  commit({ kind: 'partRenamed', model, id, name }, 'structure', 'record');
}

function updatePartMesh(id: string, mesh: EditMesh): void {
  ensureInit();
  const model = store.openModelId; if (!model) return;
  commit({ kind: 'partMeshUpdated', model, id, mesh }, 'mesh', 'record');
}

function runAction(id: string, action: LayerStripAction): void {
  ensureInit();
  const model = store.openModelId; if (!model) return;
  const i = store.parts.findIndex((p) => p.id === id);
  if (i < 0) return;
  const p = store.parts[i];
  if (action === 'visibility') {
    commit({ kind: 'partVisibilitySet', model, id, visible: !p.visible }, 'structure', 'record');
  } else if (action === 'duplicate') {
    const afterId = i > 0 ? store.parts[i - 1].id : undefined;
    const copy: StoredPart = { id: mintId('pt'), name: `${p.name} copy`, mesh: p.mesh, color: nextTint(), visible: p.visible, lift: p.lift, version: p.version };
    commit({ kind: 'partAdded', model, part: copy, afterId }, 'structure', 'record');
    setActive(copy.id);
  } else if (action === 'move-up') {
    if (i === 0) return;
    commit({ kind: 'partReordered', model, id, dir: 'up' }, 'structure', 'record');
  } else if (action === 'move-down') {
    if (i >= store.parts.length - 1) return;
    commit({ kind: 'partReordered', model, id, dir: 'down' }, 'structure', 'record');
  } else if (action === 'delete') {
    commit({ kind: 'partRemoved', model, id }, 'structure', 'record');
    if (store.activeId === id) setActive(store.parts[Math.min(i, store.parts.length - 1)]?.id ?? null);
  }
}

function undo(): void {
  ensureInit();
  const entry = undoStack.pop();
  if (!entry) return;
  commit(entry.event, entry.tick, 'undo');
}
function redo(): void {
  ensureInit();
  const entry = redoStack.pop();
  if (!entry) return;
  commit(entry.event, entry.tick, 'redo');
}

// ── Library verbs (the roster) ──────────────────────────────────────────────────

function newModel(): void { ensureInit(); setOpen(null); }
function openModel(id: string): void {
  ensureInit();
  if (!streamState().models?.[id]) return;
  setOpen(id);
}
function renameModel(name: string): void {
  ensureInit();
  const model = store.openModelId; if (!model) return;
  const clean = name.trim(); if (!clean) return;
  pushEvent({ kind: 'modelRenamed', model, name: clean }, labelFor({ kind: 'modelRenamed', model, name: clean }));
  notify();
}

// Delete a saved model from the library (req_1060: "delete previous stored
// meshes"). This is a BRANCH event (modelDeleted) — the library is V20-persisted
// data, so a removed model is gone for good (not on the per-model undo chain, which
// is part-edit only); the panel guards it behind a confirm. If the deleted model
// was open, drop back to the blank 'new' scene (setOpen clears the undo stacks).
function deleteModel(id: string): void {
  ensureInit();
  if (!streamState().models?.[id]) return;
  pushEvent({ kind: 'modelDeleted', model: id }, labelFor({ kind: 'modelDeleted', model: id }));
  if (store.openModelId === id) setOpen(null);
  else notify();
}

/** Subscribe a non-React consumer (the workbench source) to store changes. */
export function subscribeStudio(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// Non-hook accessors for the workbench source (its list()/onPick()/selectedRow()
// run outside React render). They share the one module store.
export function studioOpenModelId(): string | null { ensureInit(); return store.openModelId; }
export function studioModelsList(): StoredModel[] { ensureInit(); return libraryModels(streamState()); }
export function studioNewModel(): void { newModel(); }
export function studioOpenModel(id: string): void { openModel(id); }
export function studioModelName(): string | null {
  ensureInit();
  const id = store.openModelId;
  return id ? (streamState().models?.[id]?.name ?? null) : null;
}
export function studioRenameModel(name: string): void { renameModel(name); }
export function studioDeleteModel(id: string): void { deleteModel(id); }

const MUTATORS = { select, setSelectedFaces, addPart, addCube, addCuboid, rename, updatePartMesh, runAction, undo, redo, newModel, openModel, renameModel, deleteModel } as const;

export function useStudioModel(): StudioModel {
  ensureInit();
  const rerender = useRerender();
  useEffect(() => {
    listeners.add(rerender);
    return () => { listeners.delete(rerender); };
  }, [rerender]);
  const st = streamState();
  return {
    openModelId: store.openModelId,
    modelName: store.openModelId ? (st.models?.[store.openModelId]?.name ?? null) : null,
    models: libraryModels(st),
    parts: store.parts,
    activeId: store.activeId,
    revision: store.revision,
    meshRev: store.meshRev,
    activePart: store.parts.find((p) => p.id === store.activeId) ?? null,
    visibleParts: store.parts.filter((p) => p.visible),
    selectedFaces: store.selectedFaces,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    ...MUTATORS,
  };
}
