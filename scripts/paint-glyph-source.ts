// scripts/paint-glyph-source.ts — bake-time geometry source for the paint kit's
// brush/tool glyphs. Bundled by `tools/esbuild --format=cjs` and eval'd by the
// icon baker (cli/commands/bake-icons.ts), exactly like firecracker recipes.
//
// Why this exists: BrushKit drew its ~21 tool/brush icons as live <Graph.Path>
// surfaces, each re-parsing its SVG d-string and re-tessellating curves EVERY
// FRAME (framework/gpu/sdf_icons.zig spells out the cost). Paint mode therefore
// tanked fps; object mode (no kit) sat at 240. The fix is the framework's own
// baked path: rasterize these glyphs ONCE into the SDF atlas and draw each as a
// single textured quad. This module is the single source of truth for the glyph
// geometry — it re-uses runtime/paint/icons.ts so the picker and the bake never
// drift, flattening each layer's SVG path into polylines the baker can raster.
//
// Output coordinate space: viewBox 0..24 (matching Lucide / VIEWBOX in the
// baker). icons.ts authors in a ±12 centred space, so we add 12 to every point.

import { BRUSH_SHAPES } from '../runtime/paint/model';
import { BRUSH_TOOLS } from '../runtime/paint/model';
import { brushIconLayers, toolIconLayers, type IconLayer } from '../runtime/paint/icons';
import { BUILD_CATEGORY_ICONS, categoryIconLayers } from '../runtime/paint/category-icons';

/** One baked glyph: closed polygons to fill + polylines to stroke, in 0..24. */
export interface PaintGlyph {
  name: string;
  fills: number[][];   // each: flat [x0,y0,x1,y1,...] closed polygon
  strokes: number[][]; // each: flat [x0,y0,x1,y1,...] polyline
}

const CENTER = 12; // ±12 authored space → 0..24 viewBox

// ── SVG arc → polyline (endpoint to centre parameterisation, per the SVG spec).
// icons.ts only emits full circles/ellipses as two 180° arcs, but this handles
// the general case so any future glyph path bakes correctly.
function arcToPoints(
  x0: number, y0: number, rx: number, ry: number, phiDeg: number,
  largeArc: number, sweep: number, x: number, y: number,
): [number, number][] {
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = largeArc !== sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x0 + x) / 2;
  const cy = sinP * cxp + cosP * cyp + (y0 + y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number): number => {
    const d = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let c = d === 0 ? 1 : (ux * vx + uy * vy) / d;
    c = Math.max(-1, Math.min(1, c));
    let a = Math.acos(c);
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const segs = Math.max(2, Math.ceil((Math.abs(dTheta) / (Math.PI / 2)) * 8));
  const pts: [number, number][] = [];
  for (let i = 1; i <= segs; i += 1) {
    const t = theta1 + (dTheta * i) / segs;
    const ex = cx + rx * Math.cos(t) * cosP - ry * Math.sin(t) * sinP;
    const ey = cy + rx * Math.cos(t) * sinP + ry * Math.sin(t) * cosP;
    pts.push([ex, ey]);
  }
  return pts;
}

// Parse the SVG subset icons.ts emits (absolute M/L/A/Z) into subpaths. Each
// subpath is a list of points in the authored ±12 space.
function parsePath(d: string): [number, number][][] {
  const toks = d.match(/[MLAZmlaz]|-?\d*\.?\d+/g) ?? [];
  const subs: [number, number][][] = [];
  let cur: [number, number][] = [];
  let cx = 0, cy = 0, i = 0;
  const num = () => parseFloat(toks[i++]!);
  while (i < toks.length) {
    const cmd = toks[i++];
    switch (cmd) {
      case 'M': cx = num(); cy = num(); if (cur.length) subs.push(cur); cur = [[cx, cy]]; break;
      case 'L': cx = num(); cy = num(); cur.push([cx, cy]); break;
      case 'A': {
        const rx = num(), ry = num(), rot = num(), la = num(), sw = num(), ex = num(), ey = num();
        for (const p of arcToPoints(cx, cy, rx, ry, rot, la, sw, ex, ey)) cur.push(p);
        cx = ex; cy = ey;
        break;
      }
      case 'Z': case 'z': if (cur.length) { subs.push(cur); cur = []; } break;
      default: break; // unsupported command token — skip
    }
  }
  if (cur.length) subs.push(cur);
  return subs;
}

function flat(sub: [number, number][]): number[] {
  const out: number[] = [];
  for (const [x, y] of sub) { out.push(x + CENTER, y + CENTER); }
  return out;
}

function glyphFromLayers(name: string, layers: IconLayer[]): PaintGlyph {
  const fills: number[][] = [];
  const strokes: number[][] = [];
  for (const layer of layers) {
    for (const sub of parsePath(layer.d)) {
      (layer.fill ? fills : strokes).push(flat(sub));
    }
  }
  return { name, fills, strokes };
}

const glyphs: PaintGlyph[] = [
  ...BRUSH_SHAPES.map((s) => glyphFromLayers(`brush.${s}`, brushIconLayers(s))),
  ...BRUSH_TOOLS.map((t) => glyphFromLayers(`tool.${t}`, toolIconLayers(t))),
  // Build-piece category glyphs (req_1925): `cat.<id>` wireframe icons that
  // replace the floor/wall/ramp/… text pills in the editor rail.
  ...BUILD_CATEGORY_ICONS.map((c) => glyphFromLayers(`cat.${c}`, categoryIconLayers(c))),
];

export default glyphs;
