// .sqi — "shader quad image". Self-contained merge of a cutout (base pixel
// matrix) plus N shader-driven FX layers, each carrying its own mask + WGSL
// surface. Designed so any other cart can drop in <ShaderQuadImage src=… />
// and get back the full composite as a stack of <Effect> quads — no extra
// state, no external palette files, no separate shader assets.
//
// On disk: <stem>.sqi.json. The .sqi.json extension keeps editors happy
// (JSON syntax highlighting, tool-recognizable) while the embedded
// `kind: "sqi"` magic word + `version` lets parsers reject the wrong file
// type without doing structural sniffing.
//
// Storage uses the same RLE-row encoding as cart/cutout/icons.ts (both
// reach into ./rle now) so a base matrix written by exportIcons() round-
// trips byte-for-byte into the `base.rows` slot here. Layer masks reuse
// the same encoding (palette index 0 = "in layer", null = "not").
//
// Self-contained == no path references. The base image lives in the file
// as a quantized pixel matrix; loaders never have to resolve a sibling
// .png. Per-layer surface is inlined too — built-in by name, custom with
// id + label + wgsl — so a consumer doesn't need the cart's gallery.

import {
  encodeCellSet,
  decodeCellSet,
  encodeMatrix,
  decodeMatrix,
  type EncodedMatrix,
  type RleRows,
} from './rle';
import {
  inflateSurface,
  MASK_SURFACES,
  type CustomSurface,
  type LayerConfig,
  type Surface,
  type SurfaceId,
} from './domain';

// Re-export storage primitives so callers that historically imported them
// from sqi keep working. Canonical declarations live in ./rle.
export type { EncodedMatrix, RleRows } from './rle';
export { encodeCellSet as encodeMaskRows, decodeCellSet as decodeMaskRows, encodeMatrix, decodeMatrix } from './rle';

/** Self-contained surface ref. Same shape as the canonical `Surface`
 *  from ./domain — re-exported here so consumers don't have to add a
 *  domain import just for SqiLayer.surface typing. */
export type SqiSurface = Surface;

export interface SqiLayer {
  /** Stable id (used by loaders to key React subtrees + by adoptSurface
   *  to dedupe custom shaders if the consumer reimports). */
  id: string;
  label: string;
  /** Binary mask at the document's `size`. RLE row encoding: each entry
   *  is either a bare value (0 = in-layer, null = out) or [run, value]. */
  mask: RleRows;
  surface: SqiSurface;
  /** Per-layer visual modifiers — same fields as LayerConfig (minus the
   *  in-memory `mode: SurfaceId` indirection; `surface` above is the
   *  inflated self-contained form). */
  hueOffset: number;
  phaseOffset: number;
  dim: number;
  muted: boolean;
  /** Per-slot tint colors (#RRGGBB). Length should match the cart's
   *  NUM_COLOR_SLOTS; short / missing entries are treated as white at
   *  load (identity tint). Optional so older .sqi files still parse. */
  colors?: string[];
}

export interface SqiDocument {
  kind: 'sqi';
  version: 1;
  /** Grid resolution. Base matrix is size × size, every layer mask is
   *  also size × size, so all quads composite cleanly at one shared
   *  coordinate system. */
  size: number;
  /** Stem/source name. Cosmetic; loaders can ignore. */
  stem: string;
  base: EncodedMatrix;
  layers: SqiLayer[];
}

// ── SqiDocument build / parse ─────────────────────────────────────────

export interface BuildSqiArgs {
  size: number;
  stem: string;
  base: EncodedMatrix;
  layerMasks: Set<number>[];
  /** Canonical `LayerConfig` from ./domain. Accepts a structural subset
   *  for forward-compat with extra in-memory-only fields the cart might
   *  add. */
  layerConfigs: Array<Pick<LayerConfig, 'mode' | 'hueOffset' | 'phaseOffset' | 'muted'> & {
    dim?: number;
    colors?: string[];
  }>;
  customSurfaces: CustomSurface[];
  /** Fallback dim if a layerConfig doesn't carry its own. */
  layerDim?: number;
}

export function buildSqi(args: BuildSqiArgs): SqiDocument {
  const layers: SqiLayer[] = [];
  for (let i = 0; i < args.layerMasks.length; i++) {
    const cfg = args.layerConfigs[i];
    if (!cfg) continue;
    layers.push({
      id: `L${i}`,
      label: `Layer ${i + 1}`,
      mask: encodeCellSet(args.layerMasks[i], args.size),
      surface: inflateSurface(cfg.mode, args.customSurfaces),
      hueOffset: cfg.hueOffset,
      phaseOffset: cfg.phaseOffset,
      dim: cfg.dim ?? args.layerDim ?? 0.85,
      muted: cfg.muted,
      colors: cfg.colors ? cfg.colors.slice() : undefined,
    });
  }
  return {
    kind: 'sqi',
    version: 1,
    size: args.size,
    stem: args.stem,
    base: args.base,
    layers,
  };
}

export function parseSqi(text: string): SqiDocument | null {
  let doc: any;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || doc.kind !== 'sqi' || doc.version !== 1) return null;
  if (typeof doc.size !== 'number' || !doc.base || !Array.isArray(doc.layers)) return null;
  if (!Array.isArray(doc.base.palette) || !Array.isArray(doc.base.rows)) return null;
  for (const layer of doc.layers) {
    if (!layer || typeof layer.id !== 'string' || !Array.isArray(layer.mask)) return null;
    if (!layer.surface || (layer.surface.kind !== 'builtin' && layer.surface.kind !== 'custom')) return null;
    if (layer.surface.kind === 'builtin' && !MASK_SURFACES.includes(layer.surface.name)) return null;
    if (layer.surface.kind === 'custom') {
      if (typeof layer.surface.wgsl !== 'string') return null;
      // Older payloads may not have inlined `id` + `label`. Fill in
      // defaults so consumers can rely on the field shape going forward.
      if (typeof layer.surface.id !== 'string') {
        layer.surface.id = `custom:${layer.id}`;
      }
      if (typeof layer.surface.label !== 'string') {
        layer.surface.label = layer.surface.id;
      }
    }
  }
  return doc as SqiDocument;
}

export function serializeSqi(doc: SqiDocument): string {
  return JSON.stringify(doc);
}
