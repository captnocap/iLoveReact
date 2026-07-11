// Editor-owned DECAL document model (DECALEDIT-0606).
//
// The locked art→material vocabulary's third source, as DATA: a decal is a
// look authored in React (Box/Text/Image) and baked to a texture — what
// building facades and street signs always were, except those were hand-coded.
// This document is the EDITABLE form: the /compose route authors it, the
// stored material carries it (materials.ts `decal` records), and the registry
// hydrates it into a regular react-source TextureDef (registry.tsx →
// decalRender.tsx). Re-edit law: the doc rides the material, so reopening a
// saved decal is lossless.
//
// Coordinates are PIXELS on the doc's own width×height canvas; the renderer
// scales to any capture size (a billboard face stretches to fill its bucket).
// Text nodes carry the full font surface (fontFamily/fontWeight/letterSpacing)
// NOW so the planned custom-font work (graffiti faces) is a host-side family
// addition, never a schema migration — fontFamily is a free CSS-style string
// the host maps to a face id (v8_app.zig fontFamilyIdFor).
//
// Data only — no React imports (the materials store embeds these records; the
// render half is decalRender.tsx, the painted.ts / paintedRender.tsx split).

export const DECAL_DOC_VERSION = 1;

export type DecalAlign = 'left' | 'center' | 'right';

export type DecalRectNode = {
  id: string;
  name?: string;
  hidden?: boolean;
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  /** background color — '' means no fill (border-only frame) */
  bg: string;
  borderRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  /** optional material effect fill: shader id from game/textures/shaders */
  fillShaderId?: string;
  /** frozen shader recipe data[] for fillShaderId */
  fillData?: number[];
  opacity?: number;
};

export type DecalTextNode = {
  id: string;
  name?: string;
  hidden?: boolean;
  kind: 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  fontSize: number;
  /** CSS-style weight (400/700/…) — the host picks bold faces at >=600 */
  fontWeight?: number;
  /** CSS-style family string ('monospace', 'serif', 'roboto', a future
   *  graffiti face, …) — host-mapped; unknown names fall back to default */
  fontFamily?: string;
  letterSpacing?: number;
  align?: DecalAlign;
  opacity?: number;
};

export type DecalImageNode = {
  id: string;
  name?: string;
  hidden?: boolean;
  kind: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** image path the Image primitive loads */
  src: string;
  borderRadius?: number;
  opacity?: number;
};

// PARAMETRIC neon (req_0893, ask #2): a STROKE-shaped node — the "SVG" side of
// the user's line-vs-shader vocabulary (Graph.Path, not <Effect>). `d` is an SVG
// path string in the doc's pixel space (paste a logo's path, or a pen tool emits
// M/L commands); the renderer draws it as a glowing neon tube via layered
// Graph.Path strokes (wide soft glow under a bright core). One panel wears it for
// a single-faced sign, two back-to-back panels for a double-sided one.
export type DecalPathNode = {
  id: string;
  name?: string;
  hidden?: boolean;
  kind: 'path';
  /** bounding-box hint for the editor (move/select); the path itself uses the
   *  ABSOLUTE doc-pixel coordinates in `d`, so a Graph overlay can span the canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** SVG path data in doc-pixel coords (M/L/H/V/C/Q/Z, abs or rel) */
  d: string;
  /** the lit tube color (the neon core) */
  stroke: string;
  /** core tube width in px */
  strokeWidth: number;
  /** glow halo color — defaults to `stroke` */
  glow?: string;
  /** glow halo width in px — defaults to strokeWidth × 3.5 */
  glowWidth?: number;
  /** glow strength 0..1 — defaults to 0.5 */
  glowOpacity?: number;
  /** optional filled interior (a solid logo body behind the tube); '' / absent = none */
  fill?: string;
  opacity?: number;
};

export type DecalNode = DecalRectNode | DecalTextNode | DecalImageNode | DecalPathNode;

export type DecalDoc = {
  version: typeof DECAL_DOC_VERSION;
  /** the doc's own pixel canvas — captures scale from this */
  width: number;
  height: number;
  /** canvas background — '' means transparent (the shape floats) */
  bg: string;
  /** paint order: later nodes draw on top (the layers panel shows reversed) */
  nodes: DecalNode[];
};

/** Texture-friendly canvas presets (billboards leading — the user's ask). */
export const DECAL_SIZE_PRESETS: { label: string; width: number; height: number }[] = [
  { label: 'billboard 512×256', width: 512, height: 256 },
  { label: 'wall fit 3m 768×768', width: 768, height: 768 },
  { label: 'wide 1024×256', width: 1024, height: 256 },
  { label: 'square 512×512', width: 512, height: 512 },
  { label: 'poster 256×512', width: 256, height: 512 },
  { label: 'small 256×256', width: 256, height: 256 },
];

export function emptyDecalDoc(width = 512, height = 256): DecalDoc {
  return { version: DECAL_DOC_VERSION, width, height, bg: '#0b1320', nodes: [] };
}

// ── boundary validation ──────────────────────────────────────────────────────
// The store (materials.ts) and the editor both rehydrate through this — a
// corrupt record degrades to null, never a half-doc that crashes a capture.

function num(v: unknown, lo: number, hi: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function numArray(v: unknown, maxLen: number): number[] | null {
  if (!Array.isArray(v) || v.length > maxLen) return null;
  const out: number[] = [];
  for (const x of v) {
    const n = Number(x);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

const MAX_DIM = 4096;
const MAX_NODES = 256;
// A neon path's `d` — generous (a detailed logo has many curves), but bounded so
// a corrupt blob can't choke the capture. See [[feedback_juice_limits_dont_set_low]].
const MAX_PATH_D_CHARS = 20000;

function validateNode(raw: any): DecalNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id);
  const x = num(raw.x, -MAX_DIM, MAX_DIM);
  const y = num(raw.y, -MAX_DIM, MAX_DIM);
  const w = num(raw.w, 1, MAX_DIM);
  const h = num(raw.h, 1, MAX_DIM);
  if (id === null || x === null || y === null || w === null || h === null) return null;
  const name = raw.name === undefined ? undefined : str(raw.name);
  if (name === null) return null;
  const base = { id, name, hidden: raw.hidden === true ? true : undefined, x, y, w, h };
  const opacity = num(raw.opacity, 0, 1) ?? undefined;
  if (raw.kind === 'rect') {
    const bg = str(raw.bg);
    if (bg === null) return null;
    const fillShaderId = raw.fillShaderId === undefined ? undefined : str(raw.fillShaderId);
    const fillData = raw.fillData === undefined ? undefined : numArray(raw.fillData, 64);
    if (fillShaderId === null || fillData === null) return null;
    return {
      ...base, kind: 'rect', bg,
      borderRadius: num(raw.borderRadius, 0, MAX_DIM) ?? undefined,
      borderWidth: num(raw.borderWidth, 0, 256) ?? undefined,
      borderColor: str(raw.borderColor) ?? undefined,
      fillShaderId,
      fillData,
      opacity,
    };
  }
  if (raw.kind === 'text') {
    const text = str(raw.text);
    const color = str(raw.color);
    const fontSize = num(raw.fontSize, 4, 1024);
    if (text === null || color === null || fontSize === null) return null;
    const align = raw.align === 'left' || raw.align === 'center' || raw.align === 'right' ? raw.align : undefined;
    return {
      ...base, kind: 'text', text, color, fontSize,
      fontWeight: num(raw.fontWeight, 100, 900) ?? undefined,
      fontFamily: str(raw.fontFamily) ?? undefined,
      letterSpacing: num(raw.letterSpacing, -32, 64) ?? undefined,
      align,
      opacity,
    };
  }
  if (raw.kind === 'image') {
    const src = str(raw.src);
    if (src === null) return null;
    return {
      ...base, kind: 'image', src,
      borderRadius: num(raw.borderRadius, 0, MAX_DIM) ?? undefined,
      opacity,
    };
  }
  if (raw.kind === 'path') {
    const d = str(raw.d);
    const stroke = str(raw.stroke);
    const strokeWidth = num(raw.strokeWidth, 0.1, 512);
    // A path string longer than this is almost certainly junk, not a logo —
    // reject the whole doc rather than choke the capture (loud, not silent).
    if (d === null || d.length > MAX_PATH_D_CHARS || stroke === null || strokeWidth === null) return null;
    const glowFill = raw.fill === undefined ? undefined : str(raw.fill);
    if (glowFill === null) return null;
    return {
      ...base, kind: 'path', d, stroke, strokeWidth,
      glow: raw.glow === undefined ? undefined : (str(raw.glow) ?? undefined),
      glowWidth: num(raw.glowWidth, 0, 1024) ?? undefined,
      glowOpacity: num(raw.glowOpacity, 0, 1) ?? undefined,
      fill: glowFill,
      opacity,
    };
  }
  return null;
}

/** Strict boundary parse: a valid DecalDoc or null — never a partial. */
export function validateDecalDoc(raw: any): DecalDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.version !== DECAL_DOC_VERSION) return null;
  const width = num(raw.width, 8, MAX_DIM);
  const height = num(raw.height, 8, MAX_DIM);
  const bg = str(raw.bg);
  if (width === null || height === null || bg === null) return null;
  if (!Array.isArray(raw.nodes) || raw.nodes.length > MAX_NODES) return null;
  const nodes: DecalNode[] = [];
  for (const n of raw.nodes) {
    const node = validateNode(n);
    if (node === null) return null; // one bad node = a corrupt doc, reject whole
    nodes.push(node);
  }
  return { version: DECAL_DOC_VERSION, width, height, bg, nodes };
}
