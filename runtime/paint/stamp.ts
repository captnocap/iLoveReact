// runtime/paint/stamp.ts — the ONE place a brush dab becomes a host paint op.
// Both the universal stroke controller (useBrushStroke — flat canvases + atlas
// dabs) and 3D surface painters (which interpolate in SCREEN space and stamp the
// same dab onto MANY faces, each in its own UV island) pack the identical 17-arg
// `brushColor` call here — so brush shape / angle / aspect / hardness / flow /
// scatter / erase behave the same no matter who drives the stroke (req_1580).

import type { PaintableOps } from '../hooks/usePaintable';
import { type Brush, type BrushTool, BRUSH_SHAPE_ID } from './model';
import { hexToRgb01 } from './colors';

/** A clip rect in texture pixels — the UV island a dab is scissored to so a round
 *  brush can't bleed onto the neighbour island packed beside it in the atlas. */
export interface ClipRect { x: number; y: number; w: number; h: number }

/** Stable per-texel jitter seed (scatter brushes) — position-hashed so a dab
 *  paints the same on every redraw rather than crawling. */
export function jitterSeed(x: number, y: number): number {
  const h = (Math.floor(x) * 73856093) ^ (Math.floor(y) * 19349663);
  return ((h >>> 0) % 1000) / 1000;
}

/** The 0..1 RGB a brush lays down: the eraser writes the texture's base coat, a
 *  colour ink its hex, texture/shader inks resolve to white until the host
 *  dest-sampling pass (Phase B). */
export function brushDabRgb(brush: Brush, tool: BrushTool, eraseColor?: string): [number, number, number] {
  if (tool === 'eraser') return hexToRgb01(eraseColor ?? '#0c0e14');
  if (brush.ink.kind === 'color') return hexToRgb01(brush.ink.hex);
  return [1, 1, 1];
}

/** Stamp one brush dab — a disc carrying the brush's shape/angle/aspect/hardness/
 *  flow/scatter — into `paint` at texture-pixel (x,y), scissored to `clip`. The
 *  single chokepoint for the host brush op so every stroke driver matches exactly. */
export function stampBrushDab(
  paint: PaintableOps, brush: Brush, rgb: [number, number, number],
  x: number, y: number, radius: number, clip: ClipRect | null,
): void {
  const shape = brush.stamp.kind === 'analytic' ? brush.stamp.shape : 'round';
  const kindId = BRUSH_SHAPE_ID[shape] ?? 0;
  paint.brushColor(
    x, y, radius, rgb[0], rgb[1], rgb[2],
    kindId, (brush.angleDeg * Math.PI) / 180, brush.aspect, brush.hardness, brush.flow, brush.scatter,
    jitterSeed(x, y),
    clip?.x ?? 0, clip?.y ?? 0, clip?.w ?? 0, clip?.h ?? 0,
  );
}
