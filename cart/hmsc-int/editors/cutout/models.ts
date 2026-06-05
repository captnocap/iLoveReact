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
import { effectiveMask, inflatePaintDocument, parsePaintDocument, scaleMask, type PaintDocument } from '../paint/layers';
import { sampleToCells } from '../paint/strokes';
import type { PaintedOverlay } from '@game';
import { validatePaintedOverlay } from '@game';
import type { PartId } from '../../game/figure/shapes';
import type { VehicleDoc, VehiclePartId } from '../../game/vehicle';
// the kit's unwrap dims (512×256) — hed.ts owns them headless; render.tsx's
// UNWRAP_W/H is the same contract on the React side
import { HED_TEX_H, HED_TEX_W } from '../../game/figure/hed';
import { editorTunables } from '../tunables';

/** What the canvas is painting ON when a model target is open. */
export type ModelBinding =
  | { family: 'figure'; docId: string; part: PartId }
  | { family: 'vehicle'; docId: string; part: VehiclePartId };

// The model-paint tuning (P2 — registered where the numbers live).
// figure parts paint in the kit's unwrap space (512×256 — face painting
// lands exactly where the head texture samples); vehicle parts paint a
// square canvas box-mapped to each part mesh (the vehicle CAPTURE's pick).
export const MODEL_PAINT = {
  vehicleCanvasPx: 256,
  /** overlay bake grid (cells across each axis; square — sampleToCells) */
  bakeRes: 96,
};
editorTunables().register({
  system: 'cutout-modelpaint', route: '/cutout', table: MODEL_PAINT,
  specs: {
    vehicleCanvasPx: { label: 'veh canvas px', min: 64, max: 1024, step: 32, precision: 0 },
    bakeRes: { label: 'bake res', min: 16, max: 256, step: 8, precision: 0 },
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
 *  only, by ruling — depth never exists here. */
export function bakeOverlayFromDocument(doc: PaintDocument, stamp: number, res = MODEL_PAINT.bakeRes): PaintedOverlay {
  const n = doc.dims.w * doc.dims.h;
  const layers: PaintedOverlay['layers'] = [];
  for (const layer of inflatePaintDocument(doc)) {
    if (layer.config.muted) continue;
    // document bases decode 0/1; the band compose reads byte thresholds —
    // scale first (the layers.ts scaleMask law, same as the GPU upload path)
    const effective = effectiveMask(layer.base ? scaleMask(layer.base) : null, layer.brush, n);
    const cells = [...sampleToCells(effective, doc.dims.w, doc.dims.h, res)].sort((a, b) => a - b);
    if (cells.length === 0) continue;
    const slot = layer.config.colors[0];
    layers.push({ color: HEX_SHAPE.test(slot ?? '') ? slot : '#ffffff', cells });
  }
  return { version: 1, stamp, cols: res, rows: res, layers, paintDoc: doc };
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
