// editors/cutout/models.ts — MODEL TEXTURE TARGETS, headless (MODELPAINT-0605).
//
// THE USER'S RULING, verbatim: "the painting tools for the TEXTURE of the
// character MODEL and vehicle MODEL are need to migrate entirely to the
// cutout painter" + "i dont want to paint depth, i want to paint their face
// though, or body parts." This module is the pure half of that migration:
// what a model target IS (a figure part or a vehicle part), how a painter
// document BAKES into the PaintedOverlay the model documents carry, and how
// a saved overlay REOPENS as the same document (the re-edit law).
//
// The route (CutoutRoute.tsx) owns the rail/session/preview wiring; nothing
// here touches React or the store — createSessionLog-style testability.

// headless submodule imports (the cutout.test idiom) — the ../paint door
// re-exports the React half, which headless suites must never drag in
import {
  effectiveMask, inflatePaintDocument, parsePaintDocument, scaleMask,
  PAINT_DOC_KIND, PAINT_DOC_VERSION, type PaintDocument,
} from '../paint/layers';
import { bakeLayerLook } from '../paint/surfaces';
import { sampleToCells } from '../paint/strokes';
import { PAINT_TUNING } from '../paint/tuning';
import { stockLookDefaults } from './extraction';
import type { PaintedOverlay } from '@game';
import { validatePaintedOverlay } from '@game';
import { type PaintTargetId } from '../../game/figure/shapes';
import type { VehicleDoc, VehiclePartId } from '../../game/vehicle';
// the kit's unwrap dims (512×256) — hed.ts owns them headless; render.tsx's
// UNWRAP_W/H is the same contract on the React side
import { HED_TEX_H, HED_TEX_W } from '../../game/figure/hed';
import { editorTunables } from '../tunables';

/** What the canvas is painting ON when a model target is open. Figure parts
 *  are PAINT TARGETS (LIMBPAINT): a part, or one limb segment — "left upper
 *  arm, lower arm, upper leg, lower leg", the user's ruling. */
export type ModelBinding =
  | { family: 'figure'; docId: string; part: PaintTargetId }
  | { family: 'vehicle'; docId: string; part: VehiclePartId };

/** The figure picker's order: the user's segments lead; the shared
 *  all-instance surfaces trail (they remain the broad-stroke targets). */
export const FIGURE_PAINT_TARGETS: PaintTargetId[] = [
  'head', 'torso', 'pelvis',
  'lUpperArm', 'rUpperArm', 'lLowerArm', 'rLowerArm', 'lHand', 'rHand',
  'lUpperLeg', 'rUpperLeg', 'lLowerLeg', 'rLowerLeg', 'lFoot', 'rFoot',
  'pipe', 'hand', 'foot', 'finger',
];

// The model-paint tuning (P2 — registered where the numbers live).
// figure parts paint in the kit's unwrap space (512×256 — face painting
// lands exactly where the head texture samples); vehicle parts paint a
// square canvas box-mapped to each part mesh (the vehicle CAPTURE's pick).
export const MODEL_PAINT = {
  vehicleCanvasPx: 256,
  /** overlay bake grid COLUMNS; rows follow the canvas aspect (RESBAKE-0606:
   *  at the old square-96 bake a torso texel was a fat 5.3×2.7px block —
   *  "even 1px brush size is quite large"; 256 over the 512-wide unwrap =
   *  2px aspect-true texels) */
  bakeRes: 256,
};
editorTunables().register({
  system: 'cutout-modelpaint', route: '/cutout', table: MODEL_PAINT,
  specs: {
    vehicleCanvasPx: { label: 'veh canvas px', min: 64, max: 1024, step: 32, precision: 0 },
    // 512 = 1:1 with the figure unwrap (every canvas pixel its own bake cell);
    // heavy per-layer data — crank deliberately, it's live-tunable in /settings
    bakeRes: { label: 'bake res (cols)', min: 16, max: 512, step: 8, precision: 0 },
  },
});

export function modelCanvasDims(binding: ModelBinding): { w: number; h: number } {
  return binding.family === 'figure'
    ? { w: HED_TEX_W, h: HED_TEX_H }
    : { w: MODEL_PAINT.vehicleCanvasPx, h: MODEL_PAINT.vehicleCanvasPx };
}

const HEX_SHAPE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** Bake a painter document into the overlay the model documents carry:
 *  one color layer per unmuted painted layer — the layer's effective mask
 *  sampled to the bake grid, colored by its look's primary slot. Pixels
 *  only, by ruling — depth never exists here.
 *  RESBAKE-0606: the grid is ASPECT-TRUE — `res` is the column count, rows
 *  follow the canvas shape (a 512×256 unwrap at 256 bakes 256×128, square
 *  texels). The PaintedOverlay format always carried cols+rows separately;
 *  square canvases (vehicles) are unchanged.
 *  PAINTLIVE-0606 (ruled): each layer also bakes its LOOK — the resolved
 *  effect shader + packed header/colors from the painter's one compose
 *  authority (surfaces.ts bakeLayerLook) — so the saved model wears the
 *  same live effect texture the painter showed, not a flattened color. */
export function bakeOverlayFromDocument(doc: PaintDocument, stamp: number, res = MODEL_PAINT.bakeRes): PaintedOverlay {
  const n = doc.dims.w * doc.dims.h;
  const rows = Math.max(1, Math.round((res * doc.dims.h) / Math.max(1, doc.dims.w)));
  const layers: PaintedOverlay['layers'] = [];
  for (const layer of inflatePaintDocument(doc)) {
    if (layer.config.muted) continue;
    // document bases decode 0/1; the band compose reads byte thresholds —
    // scale first (the layers.ts scaleMask law, same as the GPU upload path)
    const effective = effectiveMask(layer.base ? scaleMask(layer.base) : null, layer.brush, n);
    const cells = [...sampleToCells(effective, doc.dims.w, doc.dims.h, res, rows)].sort((a, b) => a - b);
    if (cells.length === 0) continue;
    const slot = layer.config.colors[0];
    const look = bakeLayerLook({
      cols: res, rows,
      mode: layer.config.mode, customSurfaces: doc.customSurfaces ?? [],
      dim: layer.config.dim, hueOffset: layer.config.hueOffset, phaseOffset: layer.config.phaseOffset,
      blend: layer.config.blend ?? 'normal', colors: layer.config.colors,
    });
    layers.push({ color: HEX_SHAPE.test(slot ?? '') ? slot : '#ffffff', cells, look });
  }
  return { version: 1, stamp, cols: res, rows, layers, paintDoc: doc };
}

/** A stroke-less placeholder document for a just-opened model target — what
 *  the OPEN-SLOT write records so the TARGET itself survives a hot update
 *  before the first stroke (the user's "took a torso to the cutout → a hot
 *  update hit → it went away"). Restores treat empty-layer docs as a fresh
 *  canvas (the painter mints its own starter layer). */
export function emptyModelDocument(dims: { w: number; h: number }): PaintDocument {
  return {
    kind: PAINT_DOC_KIND, version: PAINT_DOC_VERSION,
    dims: { w: dims.w, h: dims.h },
    layers: [], activeLayer: -1,
    tool: 'brush', mode: 'erase', brushPx: PAINT_TUNING.brushDefaultPx,
    defaults: stockLookDefaults(), customSurfaces: [],
  };
}

/** Does a slot document carry real strokes? (Empty docs are open-intent
 *  placeholders — restore them as a fresh canvas, never as `initial`.) */
export function slotDocumentHasContent(doc: PaintDocument): boolean {
  return doc.layers.length > 0;
}

/** Reopen a saved overlay as the painter document it was baked from —
 *  validated through the painter's own parse (the re-edit law). A bake-only
 *  overlay (foreign/hand-written) reopens as null → fresh canvas. */
export function reopenOverlayDocument(overlay: PaintedOverlay): PaintDocument | null {
  if (overlay.paintDoc == null) return null;
  return parsePaintDocument(JSON.stringify(overlay.paintDoc));
}

/** The overlay riding a model document for a binding, validated. */
export function overlayOf(binding: ModelBinding, modelPaint: unknown): PaintedOverlay | null {
  const slot = (modelPaint as any)?.[binding.part];
  return slot ? validatePaintedOverlay(slot) : null;
}

/** The underlay base color a model canvas paints over. */
export function modelCanvasBg(binding: ModelBinding, model: { skin?: string } | VehicleDoc | null): string {
  if (!model) return '#808080';
  if (binding.family === 'figure') return (model as { skin?: string }).skin ?? '#caa07a';
  return (model as VehicleDoc).color ?? '#808080';
}

/** Stable working-target id so a model slot reopens into the same Work. */
export function modelWorkId(binding: ModelBinding): string {
  return `model-${binding.family}-${binding.docId}-${binding.part}`;
}

export function modelWorkName(binding: ModelBinding): string {
  return `${binding.docId} · ${binding.part}`;
}

// ── the deep-link mailbox ─────────────────────────────────────────────────────
// "paint texture → /cutout with the model preloaded": the source route sets
// the target, navigates, and CutoutRoute takes it once on mount. One slot,
// one-shot — never persisted (a navigation gesture, not state).

let pendingModelTarget: ModelBinding | null = null;

export function setPendingModelTarget(binding: ModelBinding): void {
  pendingModelTarget = binding;
}

export function takePendingModelTarget(): ModelBinding | null {
  const binding = pendingModelTarget;
  pendingModelTarget = null;
  return binding;
}
