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
import { normalizePaintBrushSettings, type PaintBrushSettings } from './brushKinds';
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

export type PaintLayerImage = {
  path: string;
  name: string;
  dims: { w: number; h: number } | null;
};

/** One layer's metadata. Mask bytes live on the GPU under the two paintable
 *  ids the surface derives from `id` (see paintableIdsFor). */
export type PaintLayer = {
  id: string;
  name: string;
  groupName: string | null;
  config: PaintLayerConfig;
  image: PaintLayerImage | null;
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
  image: PaintLayerImage | null;
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

export function cloneLayerImage(image: PaintLayerImage | null | undefined): PaintLayerImage | null {
  if (!image || typeof image.path !== 'string' || image.path.length === 0) return null;
  const dims = image.dims && Number.isFinite(image.dims.w) && Number.isFinite(image.dims.h)
    ? { w: image.dims.w, h: image.dims.h }
    : null;
  return { path: image.path, name: image.name || image.path.split('/').pop() || 'image', dims };
}

export function makeLayer(seed: PaintLookDefaults, ordinal: number, name?: string): PaintLayer {
  return {
    id: mintLayerId(),
    name: name ?? `Layer ${ordinal + 1}`,
    groupName: null,
    config: defaultLayerConfig(seed, ordinal),
    image: null,
    clicks: [],
  };
}

export type PaintLayerControl =
  | 'select'
  | 'visibility'
  | 'duplicate'
  | 'move-up'
  | 'move-down'
  | 'merge-down'
  | 'cut'
  | 'delete';

export const PAINT_LAYER_CONTROLS: readonly PaintLayerControl[] = Object.freeze([
  'select',
  'visibility',
  'duplicate',
  'move-up',
  'move-down',
  'merge-down',
  'cut',
  'delete',
]);

/** Every row in the paint stack is an operable layer row. Animation-authored
 *  rows such as mouth/eyes may arrive with a group name, but grouping is not
 *  a weaker layer kind and must not drop the layer controls. */
export function controlsForPaintLayer(_layer: Pick<PaintLayer, 'id' | 'name' | 'groupName'>): readonly PaintLayerControl[] {
  return PAINT_LAYER_CONTROLS;
}

export type PaintLayerActionTarget = {
  layers: PaintLayer[];
  setActiveLayer: (i: number) => void;
  toggleLayerMute: (i: number) => void;
  duplicateLayer: (i: number) => void;
  moveLayer: (i: number, dir: -1 | 1) => void;
  moveLayerById?: (id: string, dir: -1 | 1) => void;
  mergeLayer: (i: number) => void;
  cutLayer: (i: number) => void;
  deleteLayer: (i: number) => void;
};

export function paintLayerDisplayOrder(s: Pick<PaintLayerActionTarget, 'layers'>): number[] {
  return s.layers.map((_, k) => s.layers.length - 1 - k);
}

export function paintLayerActionEnabled(s: Pick<PaintLayerActionTarget, 'layers'>, index: number, action: PaintLayerControl): boolean {
  const canTarget = index >= 0 && index < s.layers.length;
  if (!canTarget && action !== 'select') return false;
  switch (action) {
    case 'move-up': return index < s.layers.length - 1;
    case 'move-down': return index > 0;
    case 'merge-down': return index > 0;
    default: return canTarget || action === 'select';
  }
}

export function runPaintLayerAction(s: PaintLayerActionTarget, index: number, action: PaintLayerControl, layerId?: string): void {
  if (!paintLayerActionEnabled(s, index, action)) return;
  switch (action) {
    case 'select': s.setActiveLayer(index); return;
    case 'visibility': s.toggleLayerMute(index); return;
    case 'duplicate': s.duplicateLayer(index); return;
    case 'move-up':
      if (layerId && s.moveLayerById) s.moveLayerById(layerId, 1);
      else s.moveLayer(index, 1);
      return;
    case 'move-down':
      if (layerId && s.moveLayerById) s.moveLayerById(layerId, -1);
      else s.moveLayer(index, -1);
      return;
    case 'merge-down': s.mergeLayer(index); return;
    case 'cut': s.cutLayer(index); return;
    case 'delete': s.deleteLayer(index); return;
  }
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

/** Idempotent anchored move. The layer crosses one specific neighbor, so if a
 *  functional state updater is replayed against its own output, the second pass
 *  sees the layer already on the requested side and returns the same stack. */
export function moveLayerAcrossNeighbor<T extends { id: string }>(
  stack: T[],
  id: string,
  dir: -1 | 1,
  neighborId: string,
): T[] {
  const i = stack.findIndex((l) => l.id === id);
  const j = stack.findIndex((l) => l.id === neighborId);
  if (i < 0 || j < 0 || i === j) return stack;
  if (dir === 1 && i === j + 1) return stack;
  if (dir === -1 && i === j - 1) return stack;
  const next = stack.slice();
  const [layer] = next.splice(i, 1);
  const anchor = next.findIndex((l) => l.id === neighborId);
  if (anchor < 0) return stack;
  next.splice(dir === 1 ? anchor + 1 : anchor, 0, layer);
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
  /** optional bitmap layer source; rendered as a normal stack layer */
  image?: PaintLayerImage | null;
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
  /** Optional in v1 documents; old saves omit it and fall back to hard round. */
  brush?: PaintBrushSettings;
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
  brush?: PaintBrushSettings;
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
      image: cloneLayerImage(l.image),
      base: l.base && w > 0 && h > 0 ? encodeBinaryMask(l.base, w, h) : null,
      brush: l.brush && w > 0 && h > 0 && brushHasContent(l.brush) ? encodeBrush(l.brush, w, h) : null,
      clicks: l.clicks.map((c) => ({ x: c.x, y: c.y, label: c.label })),
    })),
    activeLayer: args.activeLayer,
    tool: args.tool,
    mode: args.mode,
    brushPx: args.brushPx,
    brush: normalizePaintBrushSettings(args.brush),
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
  doc.brush = normalizePaintBrushSettings(doc.brush);
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
    image: cloneLayerImage(l.image),
    base: l.base ? decodeBinaryMask(l.base) : null,
    brush: l.brush ? decodeBrush(l.brush) : null,
    clicks: (l.clicks ?? []).map((c) => ({ x: c.x, y: c.y, label: c.label })),
  }));
}
