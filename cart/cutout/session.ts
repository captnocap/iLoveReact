// session.ts — working-session payload for the cutout cart.
//
// The cart treats its UI as a stateless view over this payload: every
// meaningful edit gets debounced-flushed to disk, and on mount the cart
// reads the last-saved payload back to rehydrate. Hot reloads, crashes,
// and full ship cycles all survive because the source of truth lives on
// disk, not in React state.
//
// ── v2 (unified layer stack) ──────────────────────────────────────────
// A cutout is ONE stack of layers. Each layer owns a full-resolution mask
// (1 = removed, 0 = kept), its own visual config, and — if smart-select
// was used on it — its own click history. There is no longer a special
// "brush layer" or separate "smart layers": every tool (brush, lasso,
// refine, smart-select) edits whichever layer is active. So the session
// stores a flat `layers: SessionLayer[]` plus the active index, and the
// old top-level `mask` / `hasBrushLayer` / global `clicks` fields are
// gone. v1 sessions are intentionally NOT migrated (they were scratch);
// parseSession rejects them so the cart boots clean.
//
// This is separate from the .sqi.json EXPORT format — .sqi is the shipped
// artifact (base matrix + FX layers); a session is the working state.
//
// On disk:
//   cart/cutout/sessions/_last.txt           — stem of the last-opened session
//   cart/cutout/sessions/<stem>.session.json — full payload (masks RLE'd inline)

import {
  encodeBinaryMask,
  decodeBinaryMask,
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

/** One layer's persisted form. The mask is the full-resolution RLE'd
 *  cut mask (null when the layer has never been painted). `clicks` is the
 *  smart-select history that produced the mask, kept so re-refining
 *  (add/remove a click) still works after a reload. */
export interface SessionLayer {
  id: string;
  name: string;
  groupName: string | null;
  config: LayerConfig;
  mask: RleGrid | null;
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
  // Tools palette / the "Global" target in the Inspector. Per-layer looks
  // live on each SessionLayer.config.
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

/** In-memory layer shape the cart hands to buildSession. The mask is the
 *  decoded full-resolution bytes (readback from the layer's paintable). */
export interface LayerSnapshot {
  id: string;
  name: string;
  groupName: string | null;
  config: LayerConfig;
  mask: Uint8Array | null;
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
      mask: l.mask && w > 0 && h > 0 ? encodeBinaryMask(l.mask, w, h) : null,
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
 *  uploads into each layer's paintable. Returns one entry per layer in
 *  document order. */
export function inflateSessionLayers(doc: SessionDocument): Array<{
  id: string;
  name: string;
  groupName: string | null;
  config: LayerConfig;
  mask: Uint8Array | null;
  clicks: ClickPoint[];
}> {
  return (doc.layers ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    groupName: l.groupName ?? null,
    config: cloneConfig(l.config),
    mask: l.mask ? decodeBinaryMask(l.mask) : null,
    clicks: (l.clicks ?? []).map((c) => ({ x: c.x, y: c.y, label: c.label })),
  }));
}

// RleRows re-export kept for any caller importing the codec shape via this
// module (sqi/state). Avoids a second import line at call sites.
export type { RleGrid, RleRows };
