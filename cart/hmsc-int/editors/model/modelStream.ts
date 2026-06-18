// editors/model/modelStream.ts — the V20 per-concern stream for the Studio: a
// LIBRARY OF SAVED MODELS, independent of the map project (req_0993). Each model
// is a saved scene = its ordered parts; the model's stream events ARE its BRANCH
// (the persisted, undoable edit history — req_0998/req_1000). This SUPERSEDES the
// req_0993 shape where the live scene itself was the stream (it auto-restored on
// cold start, which was wrong): the working scene is now in-memory (studioModel),
// the editor boots to 'new' (blank), and saved models live HERE as browsable
// library docs you load. Mirrors the painter's saved-document library
// (editors/cutout/stream.ts): a dumb-upsert materializer carrying the resulting
// artifact, events scoped to their owning model (the map-editor mapName idiom),
// unknown kinds pass through (V20 schema-by-addition).
//
// BRANCH vs TWIG (the law, see [[feedback_studio_branch_twig_cold_hot]]): every
// event here is a BRANCH save (persisted + undoable). Working-state (camera, tool,
// selection, which model is open) is a TWIG and lives in hotstate, never here.

import type { StreamDef } from '../../data';
import type { EditMesh } from './editMesh';

// ── PAINT (the corrected painter, req_1288/req_1289) ─────────────────────────────
// Paint is a LAYER over the read-only atlas, keyed in uniform model-SURFACE cells
// (not atlas texels — that was the sliver bug), storing a SLOT id (a pseudo-colour /
// placement), never raw RGB. A SLOT resolves through the model PALETTE to a real
// colour OR a material shader sampled at a world scale. All of it is BRANCH data:
// persisted + undoable, on the part (paint) and the model (palette).

/** A part's paint layer: `"faceIndex:cu:cv"` (a model-surface cell) → slot id. */
export type PaintLayer = Record<string, number>;

export type SlotKind = 'color' | 'material';
/** One palette slot — a named placement the painter assigns to cells. */
export type SlotDef = {
  id: number;
  name: string;
  /** placeholder hue for the colourless "slot" view while painting. */
  pseudo: string;
  kind: SlotKind;
  /** kind 'color': the set of possible colours; `Palette.variant` picks one. */
  colors?: string[];
  /** kind 'material': a catalog material (game/textures) + its own variant. */
  material?: { slug: string; variant: number };
  /** metres per texture tile (material scale) — a physical size, never "fit". */
  worldPerTile?: number;
};
/** Per-model palette: the slot table + the active recolour variant. */
export type Palette = { slots: SlotDef[]; variant: number };

/** One authored part as persisted — the library row + everything the viewport
 *  needs to render it. Geometry is lowered from `mesh` on read. */
export type StoredPart = {
  id: string;
  name: string;
  mesh: EditMesh;
  color: string;
  visible: boolean;
  lift: number;
  version: number;
  /** the paint LAYER (surface-cell → slot id). Absent on an unpainted part. */
  paint?: PaintLayer;
};

/** One saved model = a named scene and its ordered parts. */
export type StoredModel = {
  id: string;
  name: string;
  parts: Record<string, StoredPart>;
  /** index 0 = TOP of the outliner. */
  order: string[];
  /** the model's paint palette (slot → appearance). Absent until first paint. */
  palette?: Palette;
};

export type ModelEvent =
  | { kind: 'modelCreated'; model: string; name: string }
  | { kind: 'modelRenamed'; model: string; name: string }
  | { kind: 'modelDeleted'; model: string }
  // part edits — each scoped to its owning model. `afterId` = the part this one
  // sits directly above in the outliner (the duplicate/undo-of-delete anchor);
  // absent / not-found → top.
  | { kind: 'partAdded'; model: string; part: StoredPart; afterId?: string | null }
  | { kind: 'partMeshUpdated'; model: string; id: string; mesh: EditMesh }
  // paint a part's layer (surface-cell → slot id) — branch + undoable, no geometry change.
  | { kind: 'partPaintUpdated'; model: string; id: string; paint: PaintLayer }
  // set the model's paint palette (slot table + variant) — branch + undoable.
  | { kind: 'modelPaletteSet'; model: string; palette: Palette }
  | { kind: 'partRenamed'; model: string; id: string; name: string }
  | { kind: 'partVisibilitySet'; model: string; id: string; visible: boolean }
  | { kind: 'partReordered'; model: string; id: string; dir: 'up' | 'down' }
  | { kind: 'partRemoved'; model: string; id: string };

export type ModelStreamState = {
  models: Record<string, StoredModel>;
  /** model creation order — the library list. */
  order: string[];
};

function insertAfter(order: string[], id: string, afterId?: string | null): string[] {
  if (order.includes(id)) return order;
  const i = afterId ? order.indexOf(afterId) : -1;
  if (i < 0) return [id, ...order];
  return [...order.slice(0, i + 1), id, ...order.slice(i + 1)];
}

function swap(order: string[], id: string, dir: 'up' | 'down'): string[] {
  const i = order.indexOf(id);
  if (i < 0) return order;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= order.length) return order;
  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Apply a part edit inside ONE model (returns a new model, or the same if the
 *  edit doesn't apply). Pure. */
function applyPartEdit(model: StoredModel, event: ModelEvent): StoredModel {
  switch (event.kind) {
    case 'partAdded':
      return { ...model, parts: { ...model.parts, [event.part.id]: event.part }, order: insertAfter(model.order, event.part.id, event.afterId) };
    case 'partMeshUpdated': {
      const prev = model.parts[event.id];
      return prev ? { ...model, parts: { ...model.parts, [event.id]: { ...prev, mesh: event.mesh, version: prev.version + 1 } } } : model;
    }
    case 'partPaintUpdated': {
      // paint rides beside the mesh; version is NOT bumped (geometry is unchanged,
      // so the lowered geo cache stays valid — only the texture re-bakes).
      const prev = model.parts[event.id];
      return prev ? { ...model, parts: { ...model.parts, [event.id]: { ...prev, paint: event.paint } } } : model;
    }
    case 'partRenamed': {
      const prev = model.parts[event.id];
      return prev ? { ...model, parts: { ...model.parts, [event.id]: { ...prev, name: event.name } } } : model;
    }
    case 'partVisibilitySet': {
      const prev = model.parts[event.id];
      return prev ? { ...model, parts: { ...model.parts, [event.id]: { ...prev, visible: event.visible } } } : model;
    }
    case 'partReordered':
      return { ...model, order: swap(model.order, event.id, event.dir) };
    case 'partRemoved': {
      if (!(event.id in model.parts)) return model;
      const parts = { ...model.parts };
      delete parts[event.id];
      return { ...model, parts, order: model.order.filter((id) => id !== event.id) };
    }
    default:
      return model;
  }
}

export const modelStream: StreamDef<ModelStreamState, ModelEvent> = Object.freeze({
  name: 'model',
  initial: (): ModelStreamState => ({ models: {}, order: [] }),
  apply: (state: ModelStreamState, event: ModelEvent): ModelStreamState => {
    // Tolerate a pre-req_0998 snapshot: the old shape was a FLAT parts library
    // ({ parts, order:[partIds] }, no `models`), which this reducer can't use.
    // Discard it and start clean — the editor boots to 'new' and those throwaway
    // dev parts drop, which boot-to-new wants anyway (V20: a materializer must
    // tolerate shapes it predates; here the change wasn't additive).
    if (!state || !(state as Partial<ModelStreamState>).models) state = { models: {}, order: [] };
    switch (event?.kind) {
      case 'modelCreated': {
        if (event.model in state.models) return state;
        return { models: { ...state.models, [event.model]: { id: event.model, name: event.name, parts: {}, order: [] } }, order: [...state.order, event.model] };
      }
      case 'modelRenamed': {
        const m = state.models[event.model];
        return m ? { ...state, models: { ...state.models, [event.model]: { ...m, name: event.name } } } : state;
      }
      case 'modelDeleted': {
        if (!(event.model in state.models)) return state;
        const models = { ...state.models };
        delete models[event.model];
        return { models, order: state.order.filter((id) => id !== event.model) };
      }
      case 'modelPaletteSet': {
        const m = state.models[event.model];
        return m ? { ...state, models: { ...state.models, [event.model]: { ...m, palette: event.palette } } } : state;
      }
      case 'partAdded':
      case 'partMeshUpdated':
      case 'partPaintUpdated':
      case 'partRenamed':
      case 'partVisibilitySet':
      case 'partReordered':
      case 'partRemoved': {
        const m = state.models[event.model];
        if (!m) return state; // an edit for an unknown model is future noise, not a crash
        return { ...state, models: { ...state.models, [event.model]: applyPartEdit(m, event) } };
      }
      default:
        // Unknown kinds are future additions — old materializers skip them.
        return state;
    }
  },
});

/** The library in creation order — what the roster lists. Defensive against a
 *  pre-req_0998 / partial snapshot (no `models`) so boot never crashes. */
export function libraryModels(state: ModelStreamState): StoredModel[] {
  const models = state?.models ?? {};
  return (state?.order ?? []).map((id) => models[id]).filter(Boolean);
}

/** One model's parts in outliner order (empty if the model is unknown). */
export function modelParts(state: ModelStreamState, modelId: string | null): StoredPart[] {
  if (!modelId) return [];
  const m = state?.models?.[modelId];
  return m ? m.order.map((id) => m.parts[id]).filter(Boolean) : [];
}

// ── palette helpers (slot → appearance) ──────────────────────────────────────────

/** The default palette minted on first paint: a few colour slots (each with a small
 *  set of possible colours that `variant` cycles) + a couple of material slots. */
export function defaultPalette(): Palette {
  return {
    variant: 0,
    slots: [
      { id: 0, name: 'Body', pseudo: '#ff4d6d', kind: 'color', colors: ['#c64b53', '#3f6fb0', '#4f9e63', '#dfe3ea', '#d8b24a'] },
      { id: 1, name: 'Trim', pseudo: '#4d8bff', kind: 'color', colors: ['#20242b', '#8a909c', '#3a3f47'] },
      { id: 2, name: 'Glass', pseudo: '#3ddc84', kind: 'color', colors: ['#bfe6f2', '#9fd0dc'] },
      { id: 3, name: 'Brick', pseudo: '#e0a060', kind: 'material', material: { slug: 'brick', variant: 0 }, worldPerTile: 1 },
      { id: 4, name: 'Grass', pseudo: '#7cd06a', kind: 'material', material: { slug: 'grass', variant: 0 }, worldPerTile: 1.5 },
    ],
  };
}

export function slotById(palette: Palette | null | undefined, id: number): SlotDef | null {
  return palette?.slots.find((s) => s.id === id) ?? null;
}

/** A colour slot's current colour (variant picks from its set); null for a material
 *  slot (which bakes through a shader, not a flat fill). */
export function slotColor(palette: Palette | null | undefined, id: number): string | null {
  const s = slotById(palette, id);
  if (!s || s.kind !== 'color') return null;
  const cs = s.colors && s.colors.length ? s.colors : [s.pseudo];
  return cs[(palette?.variant ?? 0) % cs.length];
}
