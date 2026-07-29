import {
  uvFaceEdgeSegments,
  uvIslandBoundarySegments,
  type UvIslandRect,
} from './uvLayout';

export const UV_WIREFRAME_EXPORT_TUNING = {
  faceLineWidthPx: 1,
  boundaryLineWidthPx: 2,
  antialiasPx: 0.75,
  faceAlphaByte: 208,
  boundaryAlphaByte: 255,
  lineRgb: [0, 0, 0] as const,
  /** Same 32 MiB RGBA ceiling as the live UV preview. */
  maximumPixels: 8_388_608,
} as const;

export type UvWireframeRaster = Readonly<{
  rgba: Uint8Array;
  width: number;
  height: number;
  authoredEdges: number;
  boundaryEdges: number;
}>;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return Math.hypot(px - ax, py - ay);
  const at = clamp01(((px - ax) * dx + (py - ay) * dy) / lengthSquared);
  return Math.hypot(px - (ax + dx * at), py - (ay + dy * at));
}

function drawSegments(
  rgba: Uint8Array,
  width: number,
  height: number,
  segments: readonly number[],
  lineWidth: number,
  alphaByte: number,
): void {
  const halfWidth = Math.max(0.5, lineWidth * 0.5);
  const antialias = UV_WIREFRAME_EXPORT_TUNING.antialiasPx;
  const inner = Math.max(0, halfWidth - antialias);
  const outer = halfWidth + antialias;
  const feather = Math.max(Number.EPSILON, outer - inner);
  const [red, green, blue] = UV_WIREFRAME_EXPORT_TUNING.lineRgb;
  for (let at = 0; at + 3 < segments.length; at += 4) {
    const ax = segments[at]!;
    const ay = segments[at + 1]!;
    const bx = segments[at + 2]!;
    const by = segments[at + 3]!;
    if (![ax, ay, bx, by].every(Number.isFinite)) continue;
    const lowX = Math.max(0, Math.floor(Math.min(ax, bx) - outer));
    const lowY = Math.max(0, Math.floor(Math.min(ay, by) - outer));
    const highX = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + outer));
    const highY = Math.min(height - 1, Math.ceil(Math.max(ay, by) + outer));
    for (let y = lowY; y <= highY; y += 1) {
      for (let x = lowX; x <= highX; x += 1) {
        const distance = pointSegmentDistance(x + 0.5, y + 0.5, ax, ay, bx, by);
        if (distance >= outer) continue;
        const coverage = distance <= inner ? 1 : (outer - distance) / feather;
        const alpha = Math.round(alphaByte * coverage);
        const pixel = (y * width + x) * 4;
        if (alpha <= rgba[pixel + 3]!) continue;
        rgba[pixel] = red;
        rgba[pixel + 1] = green;
        rgba[pixel + 2] = blue;
        rgba[pixel + 3] = alpha;
      }
    }
  }
}

/**
 * Rasterize the current authored UV edges onto a truly transparent substrate.
 * Face edges use the same quad-aware geometry as the editor, so an authored
 * quad exports four sides rather than reintroducing its resident triangle
 * diagonal. Island boundaries receive a heavier neutral line for legibility.
 */
export function rasterizeUvWireframe(
  rects: readonly UvIslandRect[],
  width: number,
  height: number,
): UvWireframeRaster | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels)
    || pixels > UV_WIREFRAME_EXPORT_TUNING.maximumPixels
    || !Number.isSafeInteger(pixels * 4)) return null;
  const faceSegments = uvFaceEdgeSegments(rects, 1, 1);
  const boundarySegments = uvIslandBoundarySegments(rects, 1, 1);
  if (faceSegments.length === 0 && boundarySegments.length === 0) return null;
  const rgba = new Uint8Array(pixels * 4);
  drawSegments(
    rgba,
    width,
    height,
    faceSegments,
    UV_WIREFRAME_EXPORT_TUNING.faceLineWidthPx,
    UV_WIREFRAME_EXPORT_TUNING.faceAlphaByte,
  );
  drawSegments(
    rgba,
    width,
    height,
    boundarySegments,
    UV_WIREFRAME_EXPORT_TUNING.boundaryLineWidthPx,
    UV_WIREFRAME_EXPORT_TUNING.boundaryAlphaByte,
  );
  return {
    rgba,
    width,
    height,
    authoredEdges: faceSegments.length / 4,
    boundaryEdges: boundarySegments.length / 4,
  };
}
