// session.ts — working-session payload for the cutout cart.
//
// The cart treats its UI as a stateless view over this payload: every
// meaningful edit gets debounced-flushed to disk, and on mount the cart
// reads the last-saved payload back to rehydrate. Hot reloads, crashes,
// and full ship cycles all survive because the source of truth lives on
// disk, not in React state.
//
// This is separate from the .sqi.json EXPORT format. .sqi is the artifact
// you ship to consumers (base pixel matrix + RLE'd FX layers, ready to
// load via <ShaderQuadImage />). A session.json is the *working state* —
// it preserves the full-resolution mask, smart-select click history,
// in-progress custom shaders, and tool config so the editor can pick up
// exactly where it left off.
//
// Types in this file are composed against ./domain (canonical layer,
// composition, click shapes) and ./rle (canonical mask codec) so there's
// one declaration per concept — no parallel SessionLayerConfig /
// SessionClick / SessionCompositionLayer / SessionMask drift.
//
// On disk:
//   cart/cutout/sessions/_last.txt           — stem of the last-opened
//                                                session. Cart reads this
//                                                first on mount.
//   cart/cutout/sessions/<stem>.session.json — full payload (mask is
//                                                RLE'd inline so the cart
//                                                doesn't need a binary
//                                                fs hook).

import {
  encodeBinaryMask,
  decodeBinaryMask,
  encodeCellSet,
  decodeCellSet,
  type RleGrid,
  type RleRows,
} from './rle';
import type {
  ClickPoint,
  CompositionLayer,
  CustomSurface,
  LayerConfig,
  SurfaceId,
} from './domain';

export interface SessionDocument {
  kind: 'cutout-session';
  version: 1;
  savedAt: number;

  // Source identity
  stem: string;
  srcPath: string | null;
  srcDims: { w: number; h: number } | null;
  isBlank: boolean;

  // Tool config
  tool: 'brush' | 'smart' | 'hand';
  mode: 'erase' | 'restore';
  brushPx: number;

  // Mask + paint-layer flag. Mask may be null when the cart hasn't yet
  // ingested a source (nothing to save). RleGrid is the canonical
  // rectangular RLE shape from ./rle.
  mask: RleGrid | null;
  hasBrushLayer: boolean;

  // Smart-select. ClickPoint / LayerConfig come straight from ./domain
  // — the session stores the same shapes the cart uses in-memory.
  clicks: ClickPoint[];
  overlayRes: number;
  layers: RleRows[];
  layerConfigs: LayerConfig[];

  // Effects
  effectMode: SurfaceId;
  effectColors: string[];
  effectHueOffset: number;
  effectPhaseOffset: number;
  effectDim: number;
  customSurfaces: CustomSurface[];

  // Composition layers (optional — present once state.ts implements the
  // CompositionLayer stack; serialized as-is so the foundation is ready).
  compositionLayers?: CompositionLayer[];

  // Selection backend + per-backend tunables. Optional so older session
  // files still parse — applyDoc falls back to defaults when missing.
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

export interface BuildSessionArgs {
  stem: string;
  srcPath: string | null;
  srcDims: { w: number; h: number } | null;
  isBlank: boolean;
  tool: 'brush' | 'smart' | 'hand';
  mode: 'erase' | 'restore';
  brushPx: number;
  mask: Uint8Array | null;
  hasBrushLayer: boolean;
  clicks: ClickPoint[];
  overlayRes: number;
  layers: Set<number>[];
  layerConfigs: LayerConfig[];
  effectMode: SurfaceId;
  effectColors: string[];
  effectHueOffset: number;
  effectPhaseOffset: number;
  effectDim: number;
  customSurfaces: CustomSurface[];
  compositionLayers?: CompositionLayer[];
  backend?: 'flood' | 'sam';
  floodFuzz?: number;
  floodRejectFrac?: number;
  samThreshold?: number;
  samMaskIdx?: 0 | 1 | 2;
}

export function buildSession(args: BuildSessionArgs): SessionDocument {
  const maskPayload: RleGrid | null = args.mask && args.srcDims
    ? encodeBinaryMask(args.mask, args.srcDims.w, args.srcDims.h)
    : null;
  return {
    kind: 'cutout-session',
    version: 1,
    savedAt: Date.now(),
    stem: args.stem,
    srcPath: args.srcPath,
    srcDims: args.srcDims,
    isBlank: args.isBlank,
    tool: args.tool,
    mode: args.mode,
    brushPx: args.brushPx,
    mask: maskPayload,
    hasBrushLayer: args.hasBrushLayer,
    clicks: args.clicks.map((c) => ({ x: c.x, y: c.y, label: c.label })),
    overlayRes: args.overlayRes,
    layers: args.layers.map((cells) => encodeCellSet(cells, args.overlayRes)),
    layerConfigs: args.layerConfigs.map((c) => ({
      mode: c.mode,
      hueOffset: c.hueOffset,
      phaseOffset: c.phaseOffset,
      muted: c.muted,
      colors: c.colors.slice(),
      dim: c.dim,
    })),
    effectMode: args.effectMode,
    effectColors: args.effectColors.slice(),
    effectHueOffset: args.effectHueOffset,
    effectPhaseOffset: args.effectPhaseOffset,
    effectDim: args.effectDim,
    customSurfaces: args.customSurfaces.map((cs) => ({ ...cs })),
    compositionLayers: args.compositionLayers ? args.compositionLayers.map((cl) => ({ ...cl })) : undefined,
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
  if (!doc || doc.kind !== 'cutout-session' || doc.version !== 1) return null;
  if (typeof doc.stem !== 'string') return null;
  // Be lenient about everything else — missing fields fall through to
  // defaults at apply time, so a payload written by an older build of
  // the cart still loads. In particular: an older session's `mask` field
  // may carry the legacy `{w, h, rows: number[][]}` flat-pairs shape;
  // upgrade it in-place to the canonical RleGrid format so downstream
  // decoders see one consistent shape.
  if (doc.mask && Array.isArray(doc.mask.rows) && doc.mask.rows.length > 0) {
    const first = doc.mask.rows[0];
    if (Array.isArray(first) && first.length > 0 && typeof first[0] === 'number' && !Array.isArray(first[1] ?? null)) {
      // Legacy flat (count, value, count, value …) — promote to RleEntry
      // [run, value] runs so decodeBinaryMask handles it.
      doc.mask = legacyFlatMaskToRleGrid(doc.mask);
    }
  }
  return doc as SessionDocument;
}

export function serializeSession(doc: SessionDocument): string {
  return JSON.stringify(doc);
}

/** Convenience: decode a session's masks into the in-memory shapes the
 *  cart's React state uses. Centralises the (mask, layers) inflation so
 *  state.ts doesn't have to know about RLE internals. */
export function inflateSessionMasks(doc: SessionDocument): {
  mask: Uint8Array | null;
  layers: Set<number>[];
} {
  const mask = doc.mask ? decodeBinaryMask(doc.mask) : null;
  const layers = (doc.layers ?? []).map((rows) => decodeCellSet(rows, doc.overlayRes));
  return { mask, layers };
}

// ── Legacy mask migration ─────────────────────────────────────────────
// Pre-canonical session files used `rows: number[][]` where each row was
// a flat (count, value, count, value, …) sequence. The canonical RleGrid
// uses the same RleEntry shape as every other grid in the cart. Promote
// the legacy form on parse so downstream decoders see one schema.

function legacyFlatMaskToRleGrid(legacy: { w: number; h: number; rows: number[][] }): RleGrid {
  const rows: RleRows = legacy.rows.map((row) => {
    const out: Array<number | null | [number, number | null]> = [];
    for (let i = 0; i + 1 < row.length; i += 2) {
      const count = row[i] | 0;
      const val = row[i + 1] | 0;
      out.push(count === 1 ? val : [count, val]);
    }
    return out;
  });
  return { w: legacy.w, h: legacy.h, rows };
}
