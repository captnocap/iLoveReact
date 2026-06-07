// editors/workbench/paint/targets.ts — the AGNOSTIC paint target model
// (AGNOSTICPAINT-0606; parity rows A1-A10 in ../AGNOSTICPAINT.CAPTURE.md).
//
// THE USER'S RULING: "this is an agnostic painting surface, put whatever u
// want here … any thing at all is all just the same thing at this level."
// A PaintTarget names ANY paintable thing — a figure part, a vehicle part,
// a stored material, a recipe, a saved document, an extracted cutout, or a
// blank canvas — and resolveTarget() turns it into the ONE
// working shape the bench paints (cutout's Work model, line-true:
// CutoutRoute.tsx:125-165, 188-232, 438-505, 555-562).
//
// Pure: deps arrive as data (roster states, the library, texture lookup,
// the draft-slot reader) so the P4 suite round-trips every family headless.

// headless imports ONLY (the characters.test.ts bundling law): the paint
// door's index re-exports the React half — reach the pure modules directly.
import { PAINT_TUNING } from '../../paint/tuning';
import type { PaintDocument } from '../../paint/layers';

export type Dims = { w: number; h: number }; // usePaintEditor's shape, headless copy
import {
  modelCanvasBg, modelCanvasDims, modelWorkId, modelWorkName, overlayOf,
  reopenOverlayDocument, slotDocumentHasContent,
  type ModelBinding,
} from '../../cutout/models';
import { cutoutToDocument, mintDocumentId } from '../../cutout/extraction';
import { libraryCutouts, libraryDocuments, type CutoutStreamState } from '../../cutout/stream';
import type { CharactersStreamState } from '../../../game/figure/stream';
import type { BodyDocument } from '../../../game/figure/body';
import type { PaintTargetId } from '../../../game/figure/shapes';
import type { HedLayer } from '../../../game/figure/hed';

// the vehicles stream state shape (id → doc + order) — structural, so the
// pure resolver doesn't import the vehicles module tree
export type VehiclesStateLike = { vehicles: Record<string, any>; order: string[] };

export type PaintTarget =
  | { kind: 'blank'; w?: number; h?: number }
  | { kind: 'material'; id: string; label: string }
  | { kind: 'figure-part'; docId: string; part: PaintTargetId }
  | { kind: 'vehicle-part'; docId: string; part: string }
  | { kind: 'document'; id: string }
  | { kind: 'cutout'; id: string }
  // CLOTHFLIP-0607 (req_0234, the user's spine: "add a new design, brings me
  // to the painter save, done now that shirt exists"): a garment's print
  // DESIGN. designId null = a fresh design; set = re-edit (the model-paint
  // re-edit law, worn by garments). Save routes to the clothing-variants
  // stream — the garment family's own consumer, like figure/vehicle parts.
  | { kind: 'garment-design'; garmentId: string; designId: string | null };

/** the print canvas — TEE_CAPTURE dims (the chest print box's aspect; the
 *  same artwork shape ClothingSkinCaptures bakes the built-in prints at) */
export const GARMENT_DESIGN_DIMS: Dims = { w: 256, h: 192 };

/** What's on the canvas — cutout's Work, minus the route's epoch (the store
 *  owns remount epochs). */
export type BenchWork = {
  docId: string;
  name: string;
  srcPath: string | null;
  textureId: string | null;
  model: ModelBinding | null;
  modelBg: string | null;
  modelLayers: HedLayer[] | null;
  dims: Dims;
  initial: PaintDocument | null;
  /** an unsaved slot resumed (TATTOODRAFT) — surfaced in the status line */
  resumed: boolean;
  /** CLOTHFLIP-0607: set when the canvas IS a garment design — save routes
   *  to the clothing-variants stream (additive; every other target omits) */
  garment?: { garmentId: string; designId: string | null } | null;
};

export type ResolveDeps = {
  figures: CharactersStreamState | null;
  vehicles: VehiclesStateLike | null;
  library: CutoutStreamState | null;
  /** registry texture lookup (material canvases) */
  textureById: (id: string) => { id: string; label: string } | null;
  /** the workbench draft book's slot for a workId (content-gated by caller) */
  slotDoc: (workId: string) => PaintDocument | null;
  /** CLOTHFLIP-0607: garment label + saved-design lookup (live: the garment
   *  store's tables + the clothing-variants channel; tests fake) */
  garmentLabel?: (garmentId: string) => string | null;
  garmentDesign?: (garmentId: string, designId: string) => { label: string; overlay: unknown } | null;
};

/** a design target's stable slot id — the draft book key (the modelWorkId
 *  idiom; fresh designs share one 'new' slot per garment) */
export function garmentDesignWorkId(garmentId: string, designId: string | null): string {
  return `gdsn:${garmentId}:${designId ?? 'new'}`;
}

function clampCanvasSize(n: number): number {
  const { minSize, maxSize, defaultSize } = PAINT_TUNING.canvas;
  if (!Number.isFinite(n)) return defaultSize;
  return Math.max(minSize, Math.min(maxSize, Math.round(n)));
}

function blankWork(w?: number, h?: number): BenchWork {
  const size = PAINT_TUNING.canvas.defaultSize;
  return {
    docId: mintDocumentId(),
    name: 'untitled',
    srcPath: null,
    textureId: null,
    model: null,
    modelBg: null,
    modelLayers: null,
    dims: { w: clampCanvasSize(w ?? size), h: clampCanvasSize(h ?? size) },
    initial: null,
    resumed: false,
  };
}

function modelWork(binding: ModelBinding, deps: ResolveDeps): BenchWork | null {
  const model = binding.family === 'figure'
    ? deps.figures?.characters[binding.docId]
    : deps.vehicles?.vehicles[binding.docId];
  if (!model) return null;
  const workId = modelWorkId(binding);
  // TATTOODRAFT: this target's unsaved slot wins over the saved overlay
  const slot = deps.slotDoc(workId);
  const slotDoc = slot && slotDocumentHasContent(slot) ? slot : null;
  const overlay = overlayOf(binding, (model as any).paint);
  return {
    docId: workId,
    name: modelWorkName(binding),
    srcPath: null,
    textureId: null,
    model: binding,
    modelBg: modelCanvasBg(binding, model),
    modelLayers: binding.family === 'figure' && binding.part === 'head'
      ? (model as BodyDocument).parts.head.layers
      : null,
    dims: modelCanvasDims(binding),
    initial: slotDoc ?? (overlay ? reopenOverlayDocument(overlay) : null),
    resumed: !!slotDoc,
  };
}

/** Resolve ANY paintable thing to the bench's working shape. Null = the
 *  thing doesn't exist (a ghost row) — the store keeps the current canvas
 *  and says so, exactly like cutout's vanished-model degrade (A10). */
export function resolveTarget(target: PaintTarget, deps: ResolveDeps): BenchWork | null {
  switch (target.kind) {
    case 'blank':
      return blankWork(target.w, target.h);

    case 'material': {
      const def = deps.textureById(target.id);
      if (!def) return null;
      // cutout parity (A4): a registry texture as the canvas — square
      // default size, fresh document each open (paintOnMaterial's law)
      const size = PAINT_TUNING.canvas.defaultSize;
      return { ...blankWork(size, size), name: target.label || def.label, textureId: def.id };
    }

    case 'figure-part':
      return modelWork({ family: 'figure', docId: target.docId, part: target.part }, deps);

    case 'vehicle-part':
      return modelWork({ family: 'vehicle', docId: target.docId, part: target.part as any }, deps);

    case 'document': {
      const rec = deps.library ? libraryDocuments(deps.library).find((d) => d.id === target.id) : null;
      if (!rec) return null;
      // reopen keeps the id — re-saves upsert (A7)
      return {
        docId: rec.id,
        name: rec.name,
        srcPath: rec.srcPath ?? null,
        textureId: rec.textureId ?? null,
        model: null,
        modelBg: null,
        modelLayers: null,
        dims: { w: rec.doc.dims.w, h: rec.doc.dims.h },
        initial: rec.doc,
        resumed: false,
      };
    }

    case 'cutout': {
      const asset = deps.library ? libraryCutouts(deps.library).find((c) => c.id === target.id) : null;
      if (!asset) return null;
      // a cutout reopens as a NEW document (A8 — openCutout's law)
      return {
        docId: mintDocumentId(),
        name: asset.name,
        srcPath: asset.srcPath ?? null,
        textureId: asset.textureId ?? null,
        model: null,
        modelBg: null,
        modelLayers: null,
        dims: asset.dims,
        initial: cutoutToDocument(asset),
        resumed: false,
      };
    }

    case 'garment-design': {
      // CLOTHFLIP-0607: the garment print canvas. The garment must exist;
      // a re-edit reopens the saved overlay's own document (the model-paint
      // re-edit law); the unsaved slot wins over both (TATTOODRAFT).
      const label = deps.garmentLabel?.(target.garmentId) ?? null;
      if (label === null) return null;
      const workId = garmentDesignWorkId(target.garmentId, target.designId);
      const slot = deps.slotDoc(workId);
      const slotDoc = slot && slotDocumentHasContent(slot) ? slot : null;
      const saved = target.designId ? deps.garmentDesign?.(target.garmentId, target.designId) ?? null : null;
      if (target.designId && !saved) return null; // a ghost design row
      const reopened = saved ? reopenOverlayDocument(saved.overlay as any) : null;
      return {
        docId: workId,
        name: saved?.label ?? `${label} design`,
        srcPath: null,
        textureId: null,
        model: null,
        modelBg: '#ffffff', // the print bakes over white (ClothingSkinSurface's plain base)
        modelLayers: null,
        dims: { ...GARMENT_DESIGN_DIMS },
        initial: slotDoc ?? reopened,
        resumed: !!slotDoc,
        garment: { garmentId: target.garmentId, designId: target.designId },
      };
    }
  }
}

// ── roster-row encoding (the PAINT source's gutter-2 ids) ─────────────────────

export function encodeTargetRow(target: PaintTarget): string {
  switch (target.kind) {
    case 'blank': return 'blank';
    case 'material': return `mat:${target.id}`;
    case 'figure-part': return `fig:${target.docId}`;
    case 'vehicle-part': return `veh:${target.docId}`;
    case 'document': return `doc:${target.id}`;
    case 'cutout': return `cut:${target.id}`;
    // not a PAINT-roster row (designs open from the garment source) — the
    // encoding exists so defaultRow/twig round-trips stay total
    case 'garment-design': return garmentDesignWorkId(target.garmentId, target.designId);
  }
}

/** Decode a roster row back to a target. Model rows carry no part — the
 *  caller supplies it (the panel's `part` enum owns sub-selection). */
export function decodeTargetRow(row: string, partFor: (family: 'figure' | 'vehicle', docId: string) => string): PaintTarget | null {
  if (row === 'blank') return { kind: 'blank' };
  const sep = row.indexOf(':');
  if (sep < 0) return null;
  const tag = row.slice(0, sep);
  const id = row.slice(sep + 1);
  switch (tag) {
    case 'mat': return { kind: 'material', id, label: '' };
    case 'fig': return { kind: 'figure-part', docId: id, part: partFor('figure', id) as PaintTargetId };
    case 'veh': return { kind: 'vehicle-part', docId: id, part: partFor('vehicle', id) };
    case 'doc': return { kind: 'document', id };
    case 'cut': return { kind: 'cutout', id };
    case 'gdsn': {
      // `gdsn:<garmentId>:<designId|new>` — round-trips garmentDesignWorkId
      const last = id.lastIndexOf(':');
      if (last < 0) return null;
      const designId = id.slice(last + 1);
      return { kind: 'garment-design', garmentId: id.slice(0, last), designId: designId === 'new' ? null : designId };
    }
    default: return null;
  }
}
