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
import type { DecalDoc } from '../../game/textures/decal';
import type { SeatRigFace } from '../../game/figure/seating';

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

// ── DECALS (the composer fold, req_1730) ─────────────────────────────────────
// A decal placed on the model's surface: the SAME DecalDoc the materials composer
// authors (real-font text / rect with shader+image fills / image / neon), but
// anchored to a face's UV at a scale, and editable forever. It composites into the
// model's pixel paint texture (a paint LAYER sourced from DecalSurface, not brush
// dabs) and flattens into the same paintRef at bake — so there is NO extra runtime
// texture. The doc is tiny vector JSON, so persisting it is far cheaper than the
// flattened PNG and makes re-edit lossless. The decal's id IS its paint-layer id.
export type ModelDecal = {
  id: string;
  /** the part whose face the decal is anchored to. */
  partId: string;
  /** the hit face on that part (UV-island anchor). */
  faceIndex: number;
  /** normalized UV anchor on the atlas the decal centres on. */
  u: number;
  v: number;
  /** atlas pixels per doc pixel — the on-surface size of the doc canvas. */
  scale: number;
  /** the editable decal document (composer-identical). */
  doc: DecalDoc;
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
  /** content hash (sha256) of the model's PIXEL paint texture, into `paintBlobs`
   *  (req_1382). The painted atlas is stored ONCE by hash and referenced — the
   *  GUIDING_LIGHT content-address law, and the same form the in-game bake reads.
   *  Absent until the model is pixel-painted. */
  paintRef?: string;
  /** surface decals (the composer fold, req_1730). Absent until the first decal.
   *  Editable forever; composited into the paint texture for the look. */
  decals?: ModelDecal[];
  /** SEAT RIG (req_2028-2030) — faces tagged by the body part that touches them
   *  (seat/back/head/legs). The cook resolves these into the prop's seat (capacity,
   *  facing, sit-vs-lay all derived). Absent until the first face is rigged. */
  seatRig?: SeatRigFace[];
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
  // bake the model's PIXEL paint texture as a content-addressed blob (req_1382):
  // interns blobB64 under its hash (paintRef) and points the model at it. blobB64
  // is omitted when the hash is already interned (dedup — re-stamping the same
  // picture stores nothing). The durable, restart-safe replacement for the localstore
  // base64 hack that blew the 4MB cap.
  | { kind: 'modelPaintBaked'; model: string; paintRef: string; blobB64?: string }
  // set the model's surface decals (whole-list replace — branch + undoable). The
  // list is tiny vector docs, so replacing it wholesale on each edit is cheap and
  // keeps the reducer a dumb upsert (req_1730).
  | { kind: 'modelDecalsSet'; model: string; decals: ModelDecal[] }
  // set the model's seat rig (whole-list replace — branch + undoable, like decals).
  | { kind: 'modelSeatRigSet'; model: string; seatRig: SeatRigFace[] }
  | { kind: 'partRenamed'; model: string; id: string; name: string }
  | { kind: 'partVisibilitySet'; model: string; id: string; visible: boolean }
  | { kind: 'partReordered'; model: string; id: string; dir: 'up' | 'down' }
  | { kind: 'partRemoved'; model: string; id: string };

export type ModelStreamState = {
  models: Record<string, StoredModel>;
  /** model creation order — the library list. */
  order: string[];
  /** content-addressed pixel-paint texture blobs: paintRef → base64 PNG. Stored
   *  ONCE per distinct picture, referenced by `StoredModel.paintRef` (req_1382). */
  paintBlobs?: Record<string, string>;
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
      case 'modelDecalsSet': {
        const m = state.models[event.model];
        if (!m) return state;
        // an empty list clears decals back to absent (keeps snapshots tidy).
        const decals = event.decals.length ? event.decals : undefined;
        return { ...state, models: { ...state.models, [event.model]: { ...m, decals } } };
      }
      case 'modelSeatRigSet': {
        const m = state.models[event.model];
        if (!m) return state;
        // an empty list clears the rig back to absent (keeps snapshots tidy).
        const seatRig = event.seatRig.length ? event.seatRig : undefined;
        return { ...state, models: { ...state.models, [event.model]: { ...m, seatRig } } };
      }
      case 'modelPaintBaked': {
        const m = state.models[event.model];
        if (!m) return state;
        const blobs = state.paintBlobs ?? {};
        // intern the blob by its hash (dedup — a known hash re-uses the stored bytes).
        let paintBlobs = event.blobB64 && !(event.paintRef in blobs)
          ? { ...blobs, [event.paintRef]: event.blobB64 }
          : blobs;
        const models = { ...state.models, [event.model]: { ...m, paintRef: event.paintRef } };
        // GC (req_1556): every stroke bakes a NEW full-atlas PNG, so the model's
        // PRIOR blob is now superseded. Drop it UNLESS another model still references
        // it (content-addressed → shared). Without this the store grew unbounded
        // (~2 MB/stroke, 421 MB of orphans) and the 444 MB snapshot OOM'd the editor's
        // boot, emptying the model roster. Keeps materialized state (and the snapshot)
        // bounded to the live blobs; the append-only event log is compacted separately.
        const prior = m.paintRef;
        if (prior && prior !== event.paintRef && prior in paintBlobs
            && !Object.values(models).some((mm) => mm.paintRef === prior)) {
          const { [prior]: _superseded, ...rest } = paintBlobs;
          paintBlobs = rest;
        }
        return { ...state, paintBlobs, models };
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

/** The content-addressed pixel-paint blob (base64 PNG) for a paintRef, or null. */
export function paintBlobFor(state: ModelStreamState, paintRef: string | null | undefined): string | null {
  if (!paintRef) return null;
  return state?.paintBlobs?.[paintRef] ?? null;
}

/** One model's parts in outliner order (empty if the model is unknown). */
export function modelParts(state: ModelStreamState, modelId: string | null): StoredPart[] {
  if (!modelId) return [];
  const m = state?.models?.[modelId];
  return m ? m.order.map((id) => m.parts[id]).filter(Boolean) : [];
}

/** One model's surface decals (empty if none / unknown model). */
export function modelDecals(state: ModelStreamState, modelId: string | null): ModelDecal[] {
  if (!modelId) return [];
  return state?.models?.[modelId]?.decals ?? [];
}

export function modelSeatRig(state: ModelStreamState, modelId: string | null): SeatRigFace[] {
  if (!modelId) return [];
  return state?.models?.[modelId]?.seatRig ?? [];
}

// ── palette helpers (slot → appearance) ──────────────────────────────────────────

/** The default palette minted on first paint: a starter SWATCH ROW of plain single
 *  colours (the common case — most faces are just one colour, req_1297), plus a couple
 *  of world-scaled materials. A slot can carry MORE than one colour (then `variant`
 *  cycles them — the recolour use-case); these start single, so painting is just
 *  "pick a colour, paint". Material slugs are catalog spec ids (`<board>-<slug>`). */
export function defaultPalette(): Palette {
  return {
    variant: 0,
    slots: [
      { id: 0, name: 'Slate', pseudo: '#8a93a3', kind: 'color', colors: ['#8a93a3'] },
      { id: 1, name: 'Red', pseudo: '#c64b53', kind: 'color', colors: ['#c64b53'] },
      { id: 2, name: 'Orange', pseudo: '#d98a4a', kind: 'color', colors: ['#d98a4a'] },
      { id: 3, name: 'Yellow', pseudo: '#d8c24a', kind: 'color', colors: ['#d8c24a'] },
      { id: 4, name: 'Green', pseudo: '#5ec26a', kind: 'color', colors: ['#5ec26a'] },
      { id: 5, name: 'Blue', pseudo: '#4aa3ff', kind: 'color', colors: ['#4aa3ff'] },
      { id: 6, name: 'Purple', pseudo: '#8a5bd6', kind: 'color', colors: ['#8a5bd6'] },
      { id: 7, name: 'Black', pseudo: '#1c1f26', kind: 'color', colors: ['#1c1f26'] },
      { id: 8, name: 'White', pseudo: '#eef2f7', kind: 'color', colors: ['#eef2f7'] },
      { id: 9, name: 'Brick', pseudo: '#b06a44', kind: 'material', material: { slug: 'a-brick', variant: 0 }, worldPerTile: 1 },
      { id: 10, name: 'Grass', pseudo: '#5b9e4a', kind: 'material', material: { slug: 'a-grass', variant: 0 }, worldPerTile: 1.5 },
    ],
  };
}

/** Append (or reuse) a single-colour slot for `hex` and return its id — the
 *  "pick any colour and paint" path (req_1297). */
export function paletteWithColor(palette: Palette, hex: string): { palette: Palette; id: number } {
  const existing = palette.slots.find((s) => s.kind === 'color' && s.colors?.length === 1 && s.colors[0] === hex);
  if (existing) return { palette, id: existing.id };
  const id = palette.slots.reduce((m, s) => Math.max(m, s.id), -1) + 1;
  const slot: SlotDef = { id, name: hex, pseudo: hex, kind: 'color', colors: [hex] };
  return { palette: { ...palette, slots: [...palette.slots, slot] }, id };
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
