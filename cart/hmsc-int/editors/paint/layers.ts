// editors/paint/layers.ts — the dual-source layer model, headless. A paint
// document is ONE stack of layers; each layer owns two masks that compose:
//
//   base  (smart selection): rebuilt from the layer's click history on every
//          refine. Binary, stored 0/255 (255 = selected/removed).
//   brush (manual override): brush/lasso/refine paint here ON TOP of base.
//          Three states: 0 untouched (defer to base), ~128 force-keep,
//          ~255 force-remove.
//
// Effective mask = override band wins, else base — so a layer can be
// smart-selected, hand-cleaned, then smart-selected AGAIN and the manual
// cleanup survives (the dual-source invariant). All functions here are pure
// CPU byte math; the live surface reads textures back only at discrete
// commit points and hands the bytes in.
//
// Behavior reference: cart/cutout/state.ts + session.ts (read, never
// imported).

import {
  decodeBinaryMask, decodeGrid, encodeBinaryMask, encodeGrid, type RleGrid,
} from '@reactjit/workspace/rle';
import { PAINT_TUNING } from './tuning';
import type { ClickPoint } from './backends/types';
import type { CustomSurface, PaintBlendMode, SurfaceId } from './surfaces';

// ── Vocabulary ────────────────────────────────────────────────────────────────

export type PaintMode = 'erase' | 'restore';
export type PaintTool = 'brush' | 'smart' | 'hand' | 'lasso' | 'refine';

/** Per-layer visual config (the surface system's knobs). */
export type PaintLayerConfig = {
  mode: SurfaceId;
  blend: PaintBlendMode;
  hueOffset: number;
  phaseOffset: number;
  muted: boolean;
  colors: string[];
  dim: number;
};

/** One layer's metadata. Mask bytes live on the GPU under the two paintable
 *  ids the surface derives from `id` (see paintableIdsFor). */
export type PaintLayer = {
  id: string;
  name: string;
  groupName: string | null;
  config: PaintLayerConfig;
  /** smart-select click history that drives `base` (empty = brush-only) */
  clicks: ClickPoint[];
};

/** A layer with its mask bytes attached — the snapshot / clipboard /
 *  document shape. */
export type PaintLayerBytes = PaintLayer & {
  base: Uint8Array | null;
  brush: Uint8Array | null;
};

export type PaintClipping = {
  baseBytes: Uint8Array | null;
  brushBytes: Uint8Array | null;
  config: PaintLayerConfig;
  clicks: ClickPoint[];
  sourceName: string;
};

/** Look defaults that seed new layers (the global FX defaults). */
export type PaintLookDefaults = {
  mode: SurfaceId;
  colors: string[];
  hueOffset: number;
  phaseOffset: number;
  dim: number;
};

export type PaintBackendTunables = {
  floodFuzz: number;
  floodRejectFrac: number;
  samThreshold: number;
  samMaskIdx: 0 | 1 | 2;
};

// ── Ids ───────────────────────────────────────────────────────────────────────

let g_layerCounter = 1;

/** Mint a stack-unique layer id (counter + time tail, the cutout idiom). */
export function mintLayerId(): string {
  return `L${(g_layerCounter++).toString(36)}${Date.now().toString(36).slice(-3)}`;
}

/** The GPU texture ids for a layer, namespaced by the hosting editor's
 *  prefix so multiple embedded painters coexist in one process. */
export function paintableIdsFor(prefix: string, layerId: string): { baseId: string; brushId: string } {
  return { baseId: `${prefix}-base-${layerId}`, brushId: `${prefix}-brush-${layerId}` };
}

// ── Compose rules (MUST match the in-shader compose in surfaces.ts) ──────────

/** The brush value a mode paints (normalized; paintable.circle stores ×255). */
export function overrideBandValue(mode: PaintMode): number {
  return mode === 'erase' ? PAINT_TUNING.bands.remove : PAINT_TUNING.bands.keep;
}

/** Scale a 0/1 (or any non-zero) mask to 0/255 so the R8Unorm sampler reads
 *  1.0, not byte-1 ≈ 0.004. Upload writes RAW bytes — backend 0/1 masks MUST
 *  be scaled or they sample as empty. */
export function scaleMask(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ? 255 : 0;
  return out;
}

/** Compose a layer's effective binary mask (1 = selected/removed) from its
 *  smart base and brush override bytes. */
export function effectiveMask(base: Uint8Array | null, brush: Uint8Array | null, n: number): Uint8Array {
  const { removeByteMin, keepByteMin, baseByteMin } = PAINT_TUNING.bands;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const ov = brush ? brush[i] : 0;
    if (ov >= removeByteMin) out[i] = 1;                        // force remove
    else if (ov >= keepByteMin) out[i] = 0;                     // force keep
    else out[i] = base && base[i] >= baseByteMin ? 1 : 0;       // untouched → base
  }
  return out;
}

/** Union of effective masks (the export compose: every unmuted layer ORed). */
export function unionMasks(effectives: Uint8Array[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (const eff of effectives) {
    for (let i = 0; i < n; i++) if (eff[i]) out[i] = 1;
  }
  return out;
}

/** Invert: bake the effective mask, flip it into base bytes (0/255). The
 *  caller clears the brush + clicks — invert is a whole-layer reset of
 *  intent. */
export function invertIntoBase(effective: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = effective[i] ? 0 : 255;
  return out;
}

/** Merge-down: union two effective masks into base bytes (0/255) for the
 *  lower layer. The caller clears both brushes + the lower layer's clicks. */
export function mergeIntoBase(effAbove: Uint8Array, effBelow: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (effAbove[i] || effBelow[i]) ? 255 : 0;
  return out;
}

// ── Layer construction ────────────────────────────────────────────────────────

/** New-layer visual config: the look defaults walked by the golden-ratio hue
 *  stagger so stacked layers never cycle in unison. */
export function defaultLayerConfig(seed: PaintLookDefaults, ordinal: number): PaintLayerConfig {
  const { hueStagger, phaseStagger, defaultBlend } = PAINT_TUNING.layerLook;
  return {
    mode: seed.mode,
    blend: defaultBlend as PaintBlendMode,
    hueOffset: ((ordinal * hueStagger) + seed.hueOffset) % 1,
    phaseOffset: ordinal * phaseStagger + seed.phaseOffset,
    muted: false,
    colors: seed.colors.slice(),
    dim: seed.dim,
  };
}

export function cloneLayerConfig(c: PaintLayerConfig): PaintLayerConfig {
  return { ...c, colors: c.colors.slice() };
}

export function makeLayer(seed: PaintLookDefaults, ordinal: number, name?: string): PaintLayer {
  return {
    id: mintLayerId(),
    name: name ?? `Layer ${ordinal + 1}`,
    groupName: null,
    config: defaultLayerConfig(seed, ordinal),
    clicks: [],
  };
}

/** Stack reorder (swap i and its neighbor). Returns the same array when the
 *  move is out of range. */
export function moveLayerInStack<T>(stack: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= stack.length || j < 0 || j >= stack.length) return stack;
  const next = stack.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Active-layer index after deleting layer i (cutout's rule: indices above
 *  the deletion shift down, clamp to the new length, -1 when empty). */
export function activeAfterDelete(active: number, deleted: number, newLength: number): number {
  if (newLength === 0) return -1;
  return Math.min(active > deleted ? active - 1 : active, newLength - 1);
}

// ── The paint document (snapshots, undo, persistence — RLE-encoded) ──────────

export const PAINT_DOC_KIND = 'paint-doc';
export const PAINT_DOC_VERSION = 1;

export type PaintDocLayer = {
  id: string;
  name: string;
  groupName: string | null;
  config: PaintLayerConfig;
  /** binary RLE of the smart base (null = empty) */
  base: RleGrid | null;
  /** value-grid RLE of the 3-state override (null = untouched) */
  brush: RleGrid | null;
  clicks: ClickPoint[];
};

/** The painter's self-contained document: what undo snapshots hold and what
 *  a hosting editor persists (workspace file, stream event — its call). */
export type PaintDocument = {
  kind: typeof PAINT_DOC_KIND;
  version: number;
  dims: { w: number; h: number };
  layers: PaintDocLayer[];
  activeLayer: number;
  tool: PaintTool;
  mode: PaintMode;
  brushPx: number;
  defaults: PaintLookDefaults;
  customSurfaces: CustomSurface[];
  /** Optional in v1 documents; old saves omit it and fall back to P2 tuning. */
  backendTunables?: PaintBackendTunables;
};

function brushHasContent(brush: Uint8Array): boolean {
  for (let i = 0; i < brush.length; i++) if (brush[i] !== 0) return true;
  return false;
}

function encodeBrush(brush: Uint8Array, w: number, h: number): RleGrid {
  // 3 distinct values → the binary codec won't do; encodeGrid RLEs arbitrary
  // values (masks have long runs, so it stays compact).
  const values: Array<number | null> = new Array(brush.length);
  for (let i = 0; i < brush.length; i++) values[i] = brush[i];
  return encodeGrid(values, w, h);
}

function decodeBrush(grid: RleGrid): Uint8Array {
  const values = decodeGrid(grid);
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = (values[i] ?? 0) as number;
  return out;
}

export type BuildPaintDocumentArgs = {
  dims: { w: number; h: number };
  layers: PaintLayerBytes[];
  activeLayer: number;
  tool: PaintTool;
  mode: PaintMode;
  brushPx: number;
  defaults: PaintLookDefaults;
  customSurfaces: CustomSurface[];
  backendTunables?: PaintBackendTunables;
};

export function buildPaintDocument(args: BuildPaintDocumentArgs): PaintDocument {
  const { w, h } = args.dims;
  return {
    kind: PAINT_DOC_KIND,
    version: PAINT_DOC_VERSION,
    dims: { w, h },
    layers: args.layers.map((l) => ({
      id: l.id,
      name: l.name,
      groupName: l.groupName,
      config: cloneLayerConfig(l.config),
      base: l.base && w > 0 && h > 0 ? encodeBinaryMask(l.base, w, h) : null,
      brush: l.brush && w > 0 && h > 0 && brushHasContent(l.brush) ? encodeBrush(l.brush, w, h) : null,
      clicks: l.clicks.map((c) => ({ x: c.x, y: c.y, label: c.label })),
    })),
    activeLayer: args.activeLayer,
    tool: args.tool,
    mode: args.mode,
    brushPx: args.brushPx,
    defaults: { ...args.defaults, colors: args.defaults.colors.slice() },
    customSurfaces: args.customSurfaces.map((cs) => ({ ...cs })),
    backendTunables: args.backendTunables ? { ...args.backendTunables } : undefined,
  };
}

export function parsePaintDocument(text: string): PaintDocument | null {
  let doc: any;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || doc.kind !== PAINT_DOC_KIND || doc.version !== PAINT_DOC_VERSION) return null;
  if (!doc.dims || typeof doc.dims.w !== 'number' || typeof doc.dims.h !== 'number') return null;
  if (!Array.isArray(doc.layers)) doc.layers = [];
  if (typeof doc.activeLayer !== 'number') doc.activeLayer = doc.layers.length > 0 ? 0 : -1;
  return doc as PaintDocument;
}

export function serializePaintDocument(doc: PaintDocument): string {
  return JSON.stringify(doc);
}

/** Decode a document's per-layer masks back into upload-ready bytes.
 *  `base` comes back binary 0/1 (scaleMask before upload); `brush` is the
 *  raw 3-state override. */
export function inflatePaintDocument(doc: PaintDocument): PaintLayerBytes[] {
  return (doc.layers ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    groupName: l.groupName ?? null,
    config: cloneLayerConfig(l.config),
    base: l.base ? decodeBinaryMask(l.base) : null,
    brush: l.brush ? decodeBrush(l.brush) : null,
    clicks: (l.clicks ?? []).map((c) => ({ x: c.x, y: c.y, label: c.label })),
  }));
}
