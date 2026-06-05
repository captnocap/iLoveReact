// editors/cutout/extraction.ts — cutout extraction bookkeeping, pure. The
// route reads the painter's composed export mask (union of unmuted layers'
// effective masks) at the Extract action; everything here is CPU byte math
// over that mask — no GPU, no React, no fs — so the whole contract is
// meaning-testable headless (cutout.test.ts).
//
// The asset shape it mints is the ONE in-app landing for the original app's
// exports (PNG / pixel-icon / .sqi files, deliberately not carried — see
// CAPTURE.md): a named region as game data on the route's stream, with the
// full-resolution mask for consumers and a coarse preview for the library
// rail. Behavior reference: cart/cutout/state.ts export paths (read, never
// imported).

// Imports reach the painter's HEADLESS core modules directly (the
// paint.test.ts idiom) — the door also exports the live React half, which
// headless consumers (this file is verify-bundled) must not pull in.
import { decodeBinaryMask, encodeBinaryMask } from '@reactjit/workspace/rle';
import { PAINT_TUNING } from '../paint/tuning';
import { sampleToCells } from '../paint/strokes';
import { buildPaintDocument, makeLayer, type PaintDocument, type PaintLookDefaults } from '../paint/layers';
import { SLOT_DEFAULTS } from '../paint/surfaces';
import type { CutoutAsset } from './stream';

/** Mint a working-document id: time-sortable, collision-safe at authoring
 *  rate (the mintSessionId idiom). */
export function mintDocumentId(): string {
  return `cd-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

/** Mint a cutout-asset id (same idiom, its own namespace). */
export function mintCutoutId(): string {
  return `cut-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

/** Selected-pixel count of a binary mask. */
export function countSelected(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n += 1;
  return n;
}

export type ExtractArgs = {
  name: string;
  dims: { w: number; h: number };
  /** the painter's composed export mask (1 = selected) at source resolution */
  mask: Uint8Array;
  srcPath: string | null;
  docId: string | null;
};

/** Build a cutout asset from a composed selection. Returns null when the
 *  selection is empty — an empty cutout is a user mistake to surface, never
 *  an asset to store. */
export function extractCutout(args: ExtractArgs): CutoutAsset | null {
  const { w, h } = args.dims;
  if (w <= 0 || h <= 0 || args.mask.length < w * h) return null;
  const pixels = countSelected(args.mask);
  if (pixels === 0) return null;
  const res = PAINT_TUNING.overlayRes;
  const preview = Array.from(sampleToCells(args.mask, w, h, res)).sort((a, b) => a - b);
  return {
    id: mintCutoutId(),
    name: args.name,
    dims: { w, h },
    mask: encodeBinaryMask(args.mask, w, h),
    preview,
    pixels,
    srcPath: args.srcPath,
    docId: args.docId,
  };
}

/** Decode an asset's full-resolution binary mask (1 = in the cutout). */
export function inflateCutoutMask(asset: CutoutAsset): Uint8Array {
  return decodeBinaryMask(asset.mask);
}

/** The asset's preview as the cell set PaintQuad's cells mode renders. */
export function previewCells(asset: CutoutAsset): Set<number> {
  return new Set(asset.preview);
}

/** The painter's stock look defaults (what seeds a fresh document's layers). */
export function stockLookDefaults(): PaintLookDefaults {
  return {
    mode: PAINT_TUNING.layerLook.defaultSurface,
    colors: SLOT_DEFAULTS.slice(),
    hueOffset: 0,
    phaseOffset: 0,
    dim: PAINT_TUNING.layerLook.defaultDim,
  };
}

/** Reopen a cutout as a working document: one layer whose smart base IS the
 *  asset's mask, on the asset's source — the composability path (a stored
 *  cutout is editable again, refinable, extendable with more layers). */
export function cutoutToDocument(asset: CutoutAsset): PaintDocument {
  const defaults = stockLookDefaults();
  const layer = makeLayer(defaults, 0, asset.name);
  return buildPaintDocument({
    dims: { w: asset.dims.w, h: asset.dims.h },
    layers: [{ ...layer, base: inflateCutoutMask(asset), brush: null }],
    activeLayer: 0,
    tool: 'brush',
    mode: 'erase',
    brushPx: PAINT_TUNING.brushDefaultPx,
    defaults,
    customSurfaces: [],
  });
}

/** A collision-free library name: "<base>", then "<base> 2", "<base> 3", … */
export function uniqueAssetName(base: string, taken: Iterable<string>): string {
  const clean = base.trim() || 'cutout';
  const set = new Set<string>();
  for (const t of taken) set.add(t);
  if (!set.has(clean)) return clean;
  let n = 2;
  while (set.has(`${clean} ${n}`)) n += 1;
  return `${clean} ${n}`;
}
