// runtime/paint/model.ts — the universal paint data model. ONE vocabulary for
// brushes, inks, tools, and blending, shared by every cart and tool so nobody
// re-rolls a private brush shape again (req_1447/1449/1450).
//
// The split that keeps this deep but narrow:
//   • StampSource — what shapes the dab's FOOTPRINT (analytic bristle, an
//     SVG-rasterized alpha mask, a sampled texture, or a procedural shader).
//   • PaintInk    — what the dab DEPOSITS (a solid color, a texture, or a
//     shader surface).
//   • Brush       — footprint + ink + the size/hardness/flow/scatter/blend
//     dial set every tool honors identically.
//
// Pure types + small pure helpers — no React, no host. The host enum numbers
// live here so JS and Zig agree on one mapping.

// ── Blending ─────────────────────────────────────────────────────────────────
// Every brush carries a blend mode; the dab composites against existing pixels
// by this rule. `erase` is a blend, not a separate ink — the eraser tool just
// forces it. Host applies these in paintable.zig's dab pass (Phase B); until
// then `normal` + `erase` are honored and others fall back to `normal`.

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay'
  | 'add' | 'subtract' | 'darken' | 'lighten' | 'erase';

export const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay',
  'add', 'subtract', 'darken', 'lighten', 'erase',
];

const BLEND_INDEX: Record<BlendMode, number> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3,
  add: 4, subtract: 5, darken: 6, lighten: 7, erase: 8,
};

/** Host-side numeric enum for a blend mode (paintable.zig dab pass). */
export function blendModeIndex(m: BlendMode): number {
  return BLEND_INDEX[m] ?? 0;
}

// ── Tools ────────────────────────────────────────────────────────────────────
// The discrete tool family. All share ONE stroke controller and the shift
// modifier (straight line / square-constrain). brush/eraser/line/rect/ellipse/
// eyedropper run JS-side over the existing host dab API; fill/smudge/blur need
// the host dest-sampling pass (Phase B/C) and degrade to no-op until then.

export type BrushTool =
  | 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse'
  | 'fill' | 'eyedropper' | 'smudge' | 'blur' | 'text'
  | 'marquee' | 'lasso';

export const BRUSH_TOOLS: BrushTool[] = [
  'brush', 'eraser', 'line', 'rect', 'ellipse',
  'fill', 'eyedropper', 'smudge', 'blur', 'text', 'marquee', 'lasso',
];

/** Single-key hotkey for each tool (matches the in-app tooltip convention). */
export const TOOL_HOTKEY: Record<BrushTool, string> = {
  brush: 'b', eraser: 'e', line: 'l', rect: 'r', ellipse: 'o',
  fill: 'g', eyedropper: 'i', smudge: 'u', blur: 'h', text: 't',
  marquee: 'm', lasso: 'q',
};

// ── Analytic bristle shapes ──────────────────────────────────────────────────
// The host brush fragment rasterizes these GPU-side (kinds 0..10). Promoted
// from hmsc-int/editors/paint/brushKinds.ts — the numbers are the contract
// with paintable.zig and must not be reordered.

export type BrushShape =
  | 'round' | 'soft' | 'square' | 'flat' | 'angle'
  | 'filbert' | 'rake' | 'fan' | 'dry' | 'spray' | 'knife';

export const BRUSH_SHAPES: BrushShape[] = [
  'round', 'soft', 'square', 'flat', 'angle',
  'filbert', 'rake', 'fan', 'dry', 'spray', 'knife',
];

export const BRUSH_SHAPE_ID: Record<BrushShape, number> = {
  round: 0, soft: 1, square: 2, flat: 3, angle: 4,
  filbert: 5, rake: 6, fan: 7, dry: 8, spray: 9, knife: 10,
};

// ── Stamp source: what shapes the dab footprint ──────────────────────────────
// `analytic` works today (host kinds). `mask`/`texture`/`shader` reference a
// host stamp source by key and require the Phase B stamp pass; the controller
// falls back to the analytic `round` footprint when the host can't stamp yet.

export type StampSource =
  | { kind: 'analytic'; shape: BrushShape }
  | { kind: 'mask'; stampKey: string }       // SVG-path rasterized alpha stamp
  | { kind: 'texture'; textureKey: string }  // sampled RGBA source (a material)
  | { kind: 'shader'; surface: string };     // procedural WGSL surface id

// ── Paint ink: what the dab deposits ─────────────────────────────────────────

export type PaintInk =
  | { kind: 'color'; hex: string }
  | { kind: 'texture'; key: string }
  // A shader "paint bucket": `surface` is the shader-spec id, `data` its tuned params
  // (absent = the spec's defaults), `tiles` how many times the material repeats across a
  // face. The host bakes (surface, data) → pixels a brush samples (paint-with-a-shader).
  | { kind: 'shader'; surface: string; data?: number[]; tiles?: number };

export function inkColorHex(ink: PaintInk): string | null {
  return ink.kind === 'color' ? ink.hex : null;
}

// ── Brush ────────────────────────────────────────────────────────────────────

export interface Brush {
  /** footprint shape source */
  stamp: StampSource;
  /** what the footprint deposits */
  ink: PaintInk;
  /** dab diameter in target pixels */
  size: number;
  /** edge falloff 0 (soft) .. 1 (hard) */
  hardness: number;
  /** per-dab opacity 0..1 */
  flow: number;
  /** jitter, in radius multiples 0..3 */
  scatter: number;
  /** footprint rotation, degrees */
  angleDeg: number;
  /** footprint width/height ratio */
  aspect: number;
  /** dab spacing along a stroke as a fraction of radius */
  spacing: number;
  /** compositing rule */
  blend: BlendMode;
}

export const DEFAULT_BRUSH: Brush = {
  stamp: { kind: 'analytic', shape: 'round' },
  ink: { kind: 'color', hex: '#ffffff' },
  size: 32,
  hardness: 1,
  flow: 1,
  scatter: 0,
  angleDeg: 0,
  aspect: 1,
  spacing: 0.32,
  blend: 'normal',
};

function clamp(n: number, lo: number, hi: number, fb: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : fb));
}

/** Coerce a partial brush into a fully-valid one (clamped, defaulted). */
export function normalizeBrush(raw: Partial<Brush> | null | undefined): Brush {
  const d = DEFAULT_BRUSH;
  return {
    stamp: raw?.stamp ?? d.stamp,
    ink: raw?.ink ?? d.ink,
    size: clamp(Number(raw?.size ?? d.size), 1, 4096, d.size),
    hardness: clamp(Number(raw?.hardness ?? d.hardness), 0, 1, d.hardness),
    flow: clamp(Number(raw?.flow ?? d.flow), 0.02, 1, d.flow),
    scatter: clamp(Number(raw?.scatter ?? d.scatter), 0, 3, d.scatter),
    angleDeg: clamp(Number(raw?.angleDeg ?? d.angleDeg), -180, 180, d.angleDeg),
    aspect: clamp(Number(raw?.aspect ?? d.aspect), 0.2, 8, d.aspect),
    spacing: clamp(Number(raw?.spacing ?? d.spacing), 0.05, 1, d.spacing),
    blend: raw?.blend && BLEND_INDEX[raw.blend] !== undefined ? raw.blend : d.blend,
  };
}

// ── Brush presets ────────────────────────────────────────────────────────────
// Named, ready-to-pick brushes spanning the shape range. A preset is just a
// partial Brush merged over DEFAULT_BRUSH — the same shape carts store.

export interface BrushPreset {
  id: string;
  label: string;
  brush: Partial<Brush>;
}

export const BRUSH_PRESETS: BrushPreset[] = [
  { id: 'round', label: 'Round', brush: { stamp: { kind: 'analytic', shape: 'round' }, hardness: 1 } },
  { id: 'soft', label: 'Soft', brush: { stamp: { kind: 'analytic', shape: 'soft' }, hardness: 0.25, flow: 0.55 } },
  { id: 'marker', label: 'Marker', brush: { stamp: { kind: 'analytic', shape: 'square' }, hardness: 0.95, flow: 0.85 } },
  { id: 'flat', label: 'Flat', brush: { stamp: { kind: 'analytic', shape: 'flat' }, aspect: 2.8, hardness: 0.85 } },
  { id: 'angle', label: 'Angle', brush: { stamp: { kind: 'analytic', shape: 'angle' }, angleDeg: -35, aspect: 2.5 } },
  { id: 'filbert', label: 'Filbert', brush: { stamp: { kind: 'analytic', shape: 'filbert' }, aspect: 1.85, hardness: 0.75 } },
  { id: 'rake', label: 'Rake', brush: { stamp: { kind: 'analytic', shape: 'rake' }, aspect: 2.4, flow: 0.95 } },
  { id: 'fan', label: 'Fan', brush: { stamp: { kind: 'analytic', shape: 'fan' }, aspect: 2.8, hardness: 0.75, scatter: 0.15 } },
  { id: 'dry', label: 'Dry', brush: { stamp: { kind: 'analytic', shape: 'dry' }, angleDeg: 10, aspect: 2.1, flow: 0.75, scatter: 0.35 } },
  { id: 'spray', label: 'Spray', brush: { stamp: { kind: 'analytic', shape: 'spray' }, hardness: 0.35, flow: 0.45, scatter: 1.25 } },
  { id: 'knife', label: 'Knife', brush: { stamp: { kind: 'analytic', shape: 'knife' }, angleDeg: -12, aspect: 4.2 } },
];

export function brushFromPreset(p: BrushPreset): Brush {
  return normalizeBrush({ ...DEFAULT_BRUSH, ...p.brush });
}

/** Apply a footprint preset without leaking settings from the previously
 * selected preset. Size and ink are the user's live instruments; every other
 * dial returns to the named preset's canonical recipe. */
export function applyBrushPreset(current: Brush, preset: BrushPreset): Brush {
  return { ...brushFromPreset(preset), size: current.size, ink: current.ink };
}

// ── Palette ──────────────────────────────────────────────────────────────────
// One palette model that holds BOTH colors and texture/shader inks, plus a
// recents ring — so "the palette accounts for textures" everywhere, not just
// in the editors that bothered to build it.

export interface PaletteEntry {
  id: string;
  ink: PaintInk;
  label?: string;
}

export interface Palette {
  swatches: PaletteEntry[];
  recents: PaletteEntry[];
}

const DEFAULT_SWATCH_HEXES = [
  '#ffffff', '#111827', '#ff4040', '#ff9f43', '#ffdd55',
  '#34d399', '#3da9ff', '#7c5cff', '#ff70cc', '#8b5a2b',
];

export function defaultPalette(): Palette {
  return {
    swatches: DEFAULT_SWATCH_HEXES.map((hex, i) => ({ id: `c${i}`, ink: { kind: 'color', hex } })),
    recents: [],
  };
}

export function inkKey(ink: PaintInk): string {
  switch (ink.kind) {
    case 'color': return `color:${ink.hex.toLowerCase()}`;
    case 'texture': return `texture:${ink.key}`;
    case 'shader': return `shader:${ink.surface}`;
  }
}

/** Push an ink onto the recents ring (most-recent first, deduped, capped). */
export function pushRecent(palette: Palette, ink: PaintInk, cap = 12): Palette {
  const key = inkKey(ink);
  const recents = [{ id: key, ink }, ...palette.recents.filter((e) => inkKey(e.ink) !== key)].slice(0, cap);
  return { ...palette, recents };
}
