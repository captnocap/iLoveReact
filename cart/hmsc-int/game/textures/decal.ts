// game/textures/decal.ts — the DECAL document model (DECALEDIT-0606).
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
  opacity?: number;
};

export type DecalTextNode = {
  id: string;
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

export type DecalNode = DecalRectNode | DecalTextNode | DecalImageNode;

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

const MAX_DIM = 4096;
const MAX_NODES = 256;

function validateNode(raw: any): DecalNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id);
  const x = num(raw.x, -MAX_DIM, MAX_DIM);
  const y = num(raw.y, -MAX_DIM, MAX_DIM);
  const w = num(raw.w, 1, MAX_DIM);
  const h = num(raw.h, 1, MAX_DIM);
  if (id === null || x === null || y === null || w === null || h === null) return null;
  const base = { id, x, y, w, h };
  const opacity = num(raw.opacity, 0, 1) ?? undefined;
  if (raw.kind === 'rect') {
    const bg = str(raw.bg);
    if (bg === null) return null;
    return {
      ...base, kind: 'rect', bg,
      borderRadius: num(raw.borderRadius, 0, MAX_DIM) ?? undefined,
      borderWidth: num(raw.borderWidth, 0, 256) ?? undefined,
      borderColor: str(raw.borderColor) ?? undefined,
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
