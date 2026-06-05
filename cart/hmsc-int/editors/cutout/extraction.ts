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
import { hexToRgb01, SLOT_DEFAULTS } from '../paint/surfaces';
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
  /** the registry material under the paint, when the canvas was one */
  textureId?: string | null;
  /** the look's color slots at extraction (stencil fill/bg candidates) */
  colors?: string[];
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
    textureId: args.textureId ?? null,
    colors: args.colors?.slice(),
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

// ── Materializing: a cutout as a stencil MATERIAL ────────────────────────────
// The 'cutout-stencil' recipe (cart/hmsc/render3d/textureShaders.ts) renders
// a coarse 0/1 cell grid as fill-inside / background-outside. THIS packer
// builds its data[]; the layout below is the recipe's documented contract
// and is pinned by test against the live catalog.
//
//   data[0] gridW · data[1] gridH · data[2..4] fill rgb · data[5..7] bg rgb
//   data[8] bgAlpha · data[9] reserved · data[10+] cells (row-major 0/1)

export const STENCIL_RECIPE_ID = 'cutout-stencil';
export const STENCIL_CELLS_OFFSET = 10;

export type Rgb01 = [number, number, number];

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

export function packStencilData(args: {
  /** set-cell indices on the grid (a cutout asset's `preview`) */
  cells: Iterable<number>;
  grid: { w: number; h: number };
  fill: Rgb01;
  bg: Rgb01;
  /** 0 = the shape floats on transparency */
  bgAlpha: number;
}): number[] {
  const gw = Math.max(1, Math.round(args.grid.w));
  const gh = Math.max(1, Math.round(args.grid.h));
  const data = new Array<number>(STENCIL_CELLS_OFFSET + gw * gh).fill(0);
  data[0] = gw;
  data[1] = gh;
  data[2] = clamp01(args.fill[0]);
  data[3] = clamp01(args.fill[1]);
  data[4] = clamp01(args.fill[2]);
  data[5] = clamp01(args.bg[0]);
  data[6] = clamp01(args.bg[1]);
  data[7] = clamp01(args.bg[2]);
  data[8] = clamp01(args.bgAlpha);
  for (const idx of args.cells) {
    if (idx >= 0 && idx < gw * gh) data[STENCIL_CELLS_OFFSET + idx] = 1;
  }
  return data;
}

/** A cutout asset → the stencil recipe's data[], using the asset's preview
 *  grid and its extraction-time colors (slot 0 = fill, slot 1 = background;
 *  default: white shape floating on transparency). */
export function stencilDataFromAsset(asset: CutoutAsset, opts?: { bgAlpha?: number }): number[] {
  const res = PAINT_TUNING.overlayRes;
  const fill = hexToRgb01(asset.colors?.[0] ?? '#ffffff');
  const bg = hexToRgb01(asset.colors?.[1] ?? '#000000');
  return packStencilData({
    cells: asset.preview,
    grid: { w: res, h: res },
    fill,
    bg,
    bgAlpha: opts?.bgAlpha ?? 0,
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
