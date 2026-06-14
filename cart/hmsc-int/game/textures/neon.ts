// game/textures/neon — turn an SVG into a NEON DECAL (req_0893 #2, req_0899).
//
// Accepts EITHER a single path `d` OR a whole multi-<path> SVG (paste a logo's
// markup — every <path d="…" fill="…"> becomes its own glowing tube, in its own
// fill color). All paths are flattened to polylines, their COMBINED bounding box
// is fit to the decal canvas (so a logo authored at any viewBox/offset fills the
// face — the earlier max-coordinate sizing left off-origin logos tiny in a black
// canvas), and each becomes a DecalPathNode the renderer strokes with glow.
// decalRender draws them via Graph.Path (editor) and decal_raster strokes them
// (compiled) — the SAME nodes, both renderers.
//
// Data only (the decal.ts law: no React imports).

import { DECAL_DOC_VERSION, type DecalDoc, type DecalPathNode } from './decal';

export type NeonOptions = {
  /** canvas size (square); the logo is fit into it with a margin */
  size?: number;
  /** override tube color for EVERY path (else each path keeps its own fill) */
  stroke?: string;
  /** core tube width in px (defaults to a fraction of the canvas) */
  strokeWidth?: number;
  glow?: string;
  glowWidth?: number;
  glowOpacity?: number;
  /** canvas backing — neon reads against near-black; '' = transparent */
  bg?: string;
};

const DEFAULT_CANVAS = 512;
const FIT_MARGIN_FRAC = 0.08; // empty border around the fit logo
const CURVE_STEPS = 12;
const MAX_NEON_PATHS = 240; // < decal MAX_NODES (256); loud truncation past it

type Pt = { x: number; y: number };
type ParsedPath = { subpaths: Pt[][]; fill: string | null };

// ── color ────────────────────────────────────────────────────────────────────
function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
/** "rgb(6,25,217)" / "#rgb" / "#rrggbb" → "#rrggbb"; "none"/"" / unparseable → null. */
export function parseSvgColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === '' || s === 'none' || s === 'transparent') return null;
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgb) {
    const hex = (v: string) => clampByte(Number(v)).toString(16).padStart(2, '0');
    return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
  }
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  return null;
}

// ── extract <path> elements (or a single bare d) ─────────────────────────────
export function extractSvgPaths(input: string): { d: string; fill: string | null }[] {
  const text = input.trim();
  if (!/<path\b/i.test(text)) {
    // a single bare path `d` — keep the whole input
    return text.length ? [{ d: text, fill: null }] : [];
  }
  const out: { d: string; fill: string | null }[] = [];
  const re = /<path\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    const dm = attrs.match(/\bd\s*=\s*"([^"]*)"/i) ?? attrs.match(/\bd\s*=\s*'([^']*)'/i);
    if (!dm || !dm[1].trim()) continue;
    const fm = attrs.match(/\bfill\s*=\s*"([^"]*)"/i) ?? attrs.match(/\bfill\s*=\s*'([^']*)'/i);
    out.push({ d: dm[1], fill: parseSvgColor(fm?.[1]) });
  }
  return out;
}

// ── path → flat polylines (mirror framework/gpu/decal_raster.zig parsePath) ──
function flattenPathD(d: string): Pt[][] {
  const subpaths: Pt[][] = [];
  let cur: Pt[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  // tokenize into commands with their number args
  const tokens = d.match(/[a-zA-Z]|[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0;
  let cmd = '';
  const readNum = (): number => Number(tokens[i++]);
  const moveTo = (x: number, y: number) => {
    if (cur.length > 1) subpaths.push(cur);
    cur = [{ x, y }];
    cx = x; cy = y; sx = x; sy = y;
  };
  const lineTo = (x: number, y: number) => { cur.push({ x, y }); cx = x; cy = y; };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    for (let s = 1; s <= CURVE_STEPS; s += 1) {
      const t = s / CURVE_STEPS;
      const u = 1 - t;
      const px = u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x;
      const py = u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y;
      cur.push({ x: px, y: py });
    }
    cx = x; cy = y;
  };
  const quad = (x1: number, y1: number, x: number, y: number) => {
    for (let s = 1; s <= CURVE_STEPS; s += 1) {
      const t = s / CURVE_STEPS;
      const u = 1 - t;
      cur.push({ x: u * u * cx + 2 * u * t * x1 + t * t * x, y: u * u * cy + 2 * u * t * y1 + t * t * y });
    }
    cx = x; cy = y;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) { cmd = tokens[i]; i += 1; }
    else if (cmd === '') break;
    const rel = cmd >= 'a' && cmd <= 'z';
    const lo = cmd.toLowerCase();
    if (lo === 'm') {
      const x = readNum(); const y = readNum();
      moveTo(rel ? cx + x : x, rel ? cy + y : y);
      cmd = rel ? 'l' : 'L'; // implicit lineto for following pairs
    } else if (lo === 'l') {
      const x = readNum(); const y = readNum();
      lineTo(rel ? cx + x : x, rel ? cy + y : y);
    } else if (lo === 'h') {
      const x = readNum(); lineTo(rel ? cx + x : x, cy);
    } else if (lo === 'v') {
      const y = readNum(); lineTo(cx, rel ? cy + y : y);
    } else if (lo === 'c') {
      const x1 = readNum(), y1 = readNum(), x2 = readNum(), y2 = readNum(), x = readNum(), y = readNum();
      cubic(rel ? cx + x1 : x1, rel ? cy + y1 : y1, rel ? cx + x2 : x2, rel ? cy + y2 : y2, rel ? cx + x : x, rel ? cy + y : y);
    } else if (lo === 's') {
      const x2 = readNum(), y2 = readNum(), x = readNum(), y = readNum();
      cubic(cx, cy, rel ? cx + x2 : x2, rel ? cy + y2 : y2, rel ? cx + x : x, rel ? cy + y : y);
    } else if (lo === 'q') {
      const x1 = readNum(), y1 = readNum(), x = readNum(), y = readNum();
      quad(rel ? cx + x1 : x1, rel ? cy + y1 : y1, rel ? cx + x : x, rel ? cy + y : y);
    } else if (lo === 't') {
      const x = readNum(), y = readNum();
      quad(cx, cy, rel ? cx + x : x, rel ? cy + y : y);
    } else if (lo === 'a') {
      readNum(); readNum(); readNum(); readNum(); readNum(); // rx ry rot large sweep
      const x = readNum(), y = readNum();
      lineTo(rel ? cx + x : x, rel ? cy + y : y); // arc → line to endpoint
    } else if (lo === 'z') {
      cur.push({ x: sx, y: sy });
      cx = sx; cy = sy;
    } else {
      break; // unknown command
    }
  }
  if (cur.length > 1) subpaths.push(cur);
  return subpaths;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build the neon decal from a single `d` OR a full multi-<path> SVG. */
export function neonDecalDoc(input: string, opts: NeonOptions = {}): DecalDoc {
  const canvas = opts.size ?? DEFAULT_CANVAS;
  const bg = opts.bg ?? '#07070d';
  let raw = extractSvgPaths(input);
  if (raw.length > MAX_NEON_PATHS) {
    console.warn(`[neon] ${raw.length} paths — capping at ${MAX_NEON_PATHS}`);
    raw = raw.slice(0, MAX_NEON_PATHS);
  }
  const parsed: ParsedPath[] = raw.map((p) => ({ subpaths: flattenPathD(p.d), fill: p.fill }))
    .filter((p) => p.subpaths.length > 0);

  // combined bounding box over every point
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of parsed) for (const sp of p.subpaths) for (const pt of sp) {
    if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const span = Math.max(spanX, spanY, 1e-3);
  const margin = canvas * FIT_MARGIN_FRAC;
  const scale = (canvas - margin * 2) / span;
  // center the fit logo in the canvas
  const offX = margin + (canvas - margin * 2 - spanX * scale) / 2;
  const offY = margin + (canvas - margin * 2 - spanY * scale) / 2;
  const tx = (x: number) => round2((x - minX) * scale + offX);
  const ty = (y: number) => round2((y - minY) * scale + offY);

  const strokeWidth = opts.strokeWidth ?? Math.max(2, Math.round(canvas * 0.014));
  const nodes: DecalPathNode[] = [];
  parsed.forEach((p, idx) => {
    // reserialize the (now framed) polylines as a simple M/L `d`
    let d = '';
    for (const sp of p.subpaths) {
      if (sp.length < 2) continue;
      d += `M${tx(sp[0].x)},${ty(sp[0].y)}`;
      for (let k = 1; k < sp.length; k += 1) d += `L${tx(sp[k].x)},${ty(sp[k].y)}`;
    }
    if (!d) return;
    const stroke = opts.stroke ?? p.fill ?? '#ff3bd0';
    nodes.push({
      id: `neon${idx}`,
      kind: 'path',
      x: 0, y: 0, w: canvas, h: canvas,
      d,
      stroke,
      strokeWidth,
      glow: opts.glow,
      glowWidth: opts.glowWidth,
      glowOpacity: opts.glowOpacity ?? 0.55,
    });
  });
  // a bare fallback so an empty/garbage paste still produces a (blank) doc
  return { version: DECAL_DOC_VERSION, width: canvas, height: canvas, bg, nodes };
}
