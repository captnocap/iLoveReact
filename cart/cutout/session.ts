// session.ts — working-session payload for the cutout cart.
//
// The cart treats its UI as a stateless view over this payload: every
// meaningful edit gets debounced-flushed to disk, and on mount the cart
// reads the last-saved payload back to rehydrate. Hot reloads, crashes,
// and full ship cycles all survive because the source of truth lives on
// disk, not in React state.
//
// ── v2 (unified layer stack, dual-source masks) ───────────────────────
// A cutout is ONE stack of layers. Each layer carries TWO masks that
// compose:
//   - `base`  — the smart-select selection (binary, 1 = removed), rebuilt
//               whenever the layer's clicks change.
//   - `brush` — manual brush/lasso overrides ON TOP of the base. Three
//               states per pixel: 0 = untouched (defer to base), 128 =
//               force-keep, 255 = force-remove.
// Effective mask = brush==force ? brush : base. This is what lets you
// smart-select, clean up with the brush, and smart-select AGAIN on the
// same layer without losing the brush work.
//
// Every tool (brush, lasso, refine, smart-select) edits whichever layer is
// active. v1 sessions are intentionally NOT migrated (they were scratch).
//
// On disk:
//   cart/cutout/sessions/_last.txt           — stem of the last-opened session
//   cart/cutout/sessions/<stem>.session.json — full payload (masks RLE'd inline)

import {
  encodeBinaryMask,
  decodeBinaryMask,
  encodeGrid,
  decodeGrid,
  type RleGrid,
  type RleRows,
} from './rle';
import type {
  ClickPoint,
  CustomSurface,
  LayerConfig,
  SurfaceId,
} from './domain';

export const SESSION_VERSION = 2 as const;

/** One layer's persisted form. `base` is the binary smart-selection mask;
 *  `brush` is the 3-state manual override grid (0/128/255). Either may be
 *  null when the layer hasn't been touched in that channel. `clicks` is the
 *  smart-select history that produced the base, kept so re-refining still
 *  works after a reload. */
export interface SessionLayer {
  id: string;
  name: string;
  groupName: string | null;
  config: LayerConfig;
  base: RleGrid | null;
  brush: RleGrid | null;
  clicks: ClickPoint[];
}

export interface SessionDocument {
  kind: 'cutout-session';
  version: typeof SESSION_VERSION;
  savedAt: number;

  // Source identity
  stem: string;
  srcPath: string | null;
  srcDims: { w: number; h: number } | null;
  isBlank: boolean;

  // Tool config
  tool: 'brush' | 'smart' | 'hand' | 'lasso' | 'refine';
  mode: 'erase' | 'restore';
  brushPx: number;

  // The layer stack + which one tools currently edit.
  layers: SessionLayer[];
  activeLayer: number;

  // Effect defaults — applied to NEWLY created layers and edited by the
  // Tools palette / the "Global" target in the Inspector.
  effectMode: SurfaceId;
  effectColors: string[];
  effectHueOffset: number;
  effectPhaseOffset: number;
  effectDim: number;
  customSurfaces: CustomSurface[];

  // Selection backend + per-backend tunables. Optional so a payload from a
  // slightly older v2 build still parses; applyDoc falls back to defaults.
  backend?: 'flood' | 'sam';
  floodFuzz?: number;
  floodRejectFrac?: number;
  samThreshold?: number;
  samMaskIdx?: 0 | 1 | 2;
}

export const SESSION_DIR = 'cart/cutout/sessions';
export const SESSION_LAST_POINTER = `${SESSION_DIR}/_last.txt`;
export function sessionPathFor(stem: string): string {
  return `${SESSION_DIR}/${stem}.session.json`;
}

// ── Build / parse ─────────────────────────────────────────────────────

/** In-memory layer shape the cart hands to buildSession. `base` is the
 *  decoded smart mask bytes (0/255 or 0/1 — encodeBinaryMask treats any
 *  non-zero as 1); `brush` is the raw 3-state override bytes. */
export interface LayerSnapshot {
  id: string;
  name: string;
  groupName: string | null;
  config: LayerConfig;
  base: Uint8Array | null;
  brush: Uint8Array | null;
  clicks: ClickPoint[];
}

export interface BuildSessionArgs {
  stem: string;
  srcPath: string | null;
  srcDims: { w: number; h: number } | null;
  isBlank: boolean;
  tool: 'brush' | 'smart' | 'hand' | 'lasso' | 'refine';
  mode: 'erase' | 'restore';
  brushPx: number;
  layers: LayerSnapshot[];
  activeLayer: number;
  effectMode: SurfaceId;
  effectColors: string[];
  effectHueOffset: number;
  effectPhaseOffset: number;
  effectDim: number;
  customSurfaces: CustomSurface[];
  backend?: 'flood' | 'sam';
  floodFuzz?: number;
  floodRejectFrac?: number;
  samThreshold?: number;
  samMaskIdx?: 0 | 1 | 2;
}

function cloneConfig(c: LayerConfig): LayerConfig {
  return {
    mode: c.mode,
    blend: c.blend ?? 'normal',
    hueOffset: c.hueOffset,
    phaseOffset: c.phaseOffset,
    muted: c.muted,
    colors: c.colors.slice(),
    dim: c.dim,
  };
}

/** Is the override grid all-untouched (no manual edits)? Lets us skip
 *  persisting an empty brush channel. */
function brushHasContent(brush: Uint8Array): boolean {
  for (let i = 0; i < brush.length; i++) if (brush[i] !== 0) return true;
  return false;
}

function encodeBrush(brush: Uint8Array, w: number, h: number): RleGrid {
  // The override has 3 distinct values, so the binary codec won't do —
  // encodeGrid runs-length-encodes arbitrary values (masks have long runs,
  // so it stays compact).
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

export function buildSession(args: BuildSessionArgs): SessionDocument {
  const w = args.srcDims?.w ?? 0;
  const h = args.srcDims?.h ?? 0;
  return {
    kind: 'cutout-session',
    version: SESSION_VERSION,
    savedAt: Date.now(),
    stem: args.stem,
    srcPath: args.srcPath,
    srcDims: args.srcDims,
    isBlank: args.isBlank,
    tool: args.tool,
    mode: args.mode,
    brushPx: args.brushPx,
    layers: args.layers.map((l) => ({
      id: l.id,
      name: l.name,
      groupName: l.groupName,
      config: cloneConfig(l.config),
      base: l.base && w > 0 && h > 0 ? encodeBinaryMask(l.base, w, h) : null,
      brush: l.brush && w > 0 && h > 0 && brushHasContent(l.brush) ? encodeBrush(l.brush, w, h) : null,
      clicks: l.clicks.map((c) => ({ x: c.x, y: c.y, label: c.label })),
    })),
    activeLayer: args.activeLayer,
    effectMode: args.effectMode,
    effectColors: args.effectColors.slice(),
    effectHueOffset: args.effectHueOffset,
    effectPhaseOffset: args.effectPhaseOffset,
    effectDim: args.effectDim,
    customSurfaces: args.customSurfaces.map((cs) => ({ ...cs })),
    backend: args.backend,
    floodFuzz: args.floodFuzz,
    floodRejectFrac: args.floodRejectFrac,
    samThreshold: args.samThreshold,
    samMaskIdx: args.samMaskIdx,
  };
}

export function parseSession(text: string): SessionDocument | null {
  let doc: any;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || doc.kind !== 'cutout-session' || doc.version !== SESSION_VERSION) return null;
  if (typeof doc.stem !== 'string') return null;
  if (!Array.isArray(doc.layers)) doc.layers = [];
  if (typeof doc.activeLayer !== 'number') doc.activeLayer = doc.layers.length > 0 ? 0 : -1;
  return doc as SessionDocument;
}

export function serializeSession(doc: SessionDocument): string {
  return JSON.stringify(doc);
}

/** Decode a session's per-layer masks into the in-memory bytes the cart
 *  uploads into each layer's paintables. `base` is binary (0/1); `brush`
 *  is the raw 3-state override (0/128/255). */
export function inflateSessionLayers(doc: SessionDocument): Array<{
  id: string;
  name: string;
  groupName: string | null;
  config: LayerConfig;
  base: Uint8Array | null;
  brush: Uint8Array | null;
  clicks: ClickPoint[];
}> {
  return (doc.layers ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    groupName: l.groupName ?? null,
    config: cloneConfig(l.config),
    base: l.base ? decodeBinaryMask(l.base) : null,
    brush: l.brush ? decodeBrush(l.brush) : null,
    clicks: (l.clicks ?? []).map((c) => ({ x: c.x, y: c.y, label: c.label })),
  }));
}

export type { RleGrid, RleRows };
