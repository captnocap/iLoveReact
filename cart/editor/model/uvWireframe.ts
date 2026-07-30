import {
  groupUvTextureFootprints,
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
  /** gpt-image reference substrate proven visible by the user's A/B test: 6% pink. */
  generationBackgroundRgb: [255, 64, 160] as const,
  generationBackgroundAlphaByte: Math.round(255 * 0.06),
  generationLabelBackgroundRgb: [255, 238, 248] as const,
  generationLabelBackgroundAlphaByte: 240,
  generationLabelRgb: [75, 0, 42] as const,
  generationLabelAlphaByte: 255,
  generationLabelPaddingPx: 1,
  generationLabelMaximumScalePx: 3,
  /** Same 32 MiB RGBA ceiling as the live UV preview. */
  maximumPixels: 8_388_608,
} as const;

export type UvWireframeRasterKind = 'transparent' | 'generation';

export type UvWireframeRasterOptions = Readonly<{
  kind?: UvWireframeRasterKind;
}>;

export type UvWireframeRaster = Readonly<{
  rgba: Uint8Array;
  width: number;
  height: number;
  authoredEdges: number;
  boundaryEdges: number;
  numberedFootprints: number;
}>;

const DIGIT_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function fillRaster(
  rgba: Uint8Array,
  rgb: readonly [number, number, number],
  alphaByte: number,
): void {
  for (let pixel = 0; pixel < rgba.length; pixel += 4) {
    rgba[pixel] = rgb[0];
    rgba[pixel + 1] = rgb[1];
    rgba[pixel + 2] = rgb[2];
    rgba[pixel + 3] = alphaByte;
  }
}

function fillRect(
  rgba: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  rgb: readonly [number, number, number],
  alphaByte: number,
): void {
  const lowX = Math.max(0, Math.floor(x));
  const lowY = Math.max(0, Math.floor(y));
  const highX = Math.min(width, Math.ceil(x + rectWidth));
  const highY = Math.min(height, Math.ceil(y + rectHeight));
  for (let py = lowY; py < highY; py += 1) {
    for (let px = lowX; px < highX; px += 1) {
      const pixel = (py * width + px) * 4;
      rgba[pixel] = rgb[0];
      rgba[pixel + 1] = rgb[1];
      rgba[pixel + 2] = rgb[2];
      rgba[pixel + 3] = alphaByte;
    }
  }
}

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

function islandLabelPoint(rect: UvIslandRect): { x: number; y: number } {
  let largestArea = -1;
  let point = { x: rect.x + rect.w * 0.5, y: rect.y + rect.h * 0.5 };
  for (const triangle of rect.triangles ?? []) {
    const ax = rect.x + triangle.points[0] * rect.w;
    const ay = rect.y + triangle.points[1] * rect.h;
    const bx = rect.x + triangle.points[2] * rect.w;
    const by = rect.y + triangle.points[3] * rect.h;
    const cx = rect.x + triangle.points[4] * rect.w;
    const cy = rect.y + triangle.points[5] * rect.h;
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
    if (area <= largestArea) continue;
    largestArea = area;
    point = { x: (ax + bx + cx) / 3, y: (ay + by + cy) / 3 };
  }
  return point;
}

function drawNumber(
  rgba: Uint8Array,
  width: number,
  height: number,
  value: number,
  centerX: number,
  centerY: number,
  availableWidth: number,
  availableHeight: number,
): void {
  const text = String(value);
  const glyphWidth = text.length * 3 + Math.max(0, text.length - 1);
  const padding = UV_WIREFRAME_EXPORT_TUNING.generationLabelPaddingPx;
  const scale = Math.max(1, Math.min(
    UV_WIREFRAME_EXPORT_TUNING.generationLabelMaximumScalePx,
    Math.floor((Math.max(1, availableWidth) - padding * 2) / glyphWidth),
    Math.floor((Math.max(1, availableHeight) - padding * 2) / 5),
  ));
  const textWidth = glyphWidth * scale;
  const textHeight = 5 * scale;
  const labelWidth = textWidth + padding * 2;
  const labelHeight = textHeight + padding * 2;
  const labelX = Math.round(Math.max(0, Math.min(width - labelWidth, centerX - labelWidth * 0.5)));
  const labelY = Math.round(Math.max(0, Math.min(height - labelHeight, centerY - labelHeight * 0.5)));
  fillRect(
    rgba,
    width,
    height,
    labelX,
    labelY,
    labelWidth,
    labelHeight,
    UV_WIREFRAME_EXPORT_TUNING.generationLabelBackgroundRgb,
    UV_WIREFRAME_EXPORT_TUNING.generationLabelBackgroundAlphaByte,
  );
  let cursorX = labelX + padding;
  for (const digit of text) {
    const glyph = DIGIT_GLYPHS[digit]!;
    glyph.forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column += 1) {
        if (row[column] !== '1') continue;
        fillRect(
          rgba,
          width,
          height,
          cursorX + column * scale,
          labelY + padding + rowIndex * scale,
          scale,
          scale,
          UV_WIREFRAME_EXPORT_TUNING.generationLabelRgb,
          UV_WIREFRAME_EXPORT_TUNING.generationLabelAlphaByte,
        );
      }
    });
    cursorX += 4 * scale;
  }
}

function drawFootprintNumbers(
  rgba: Uint8Array,
  width: number,
  height: number,
  rects: readonly UvIslandRect[],
): number {
  const visibleFootprints = groupUvTextureFootprints(rects).filter((footprint) => {
    const rect = rects[footprint.representative]!;
    return rect.x + rect.w > 0 && rect.y + rect.h > 0 && rect.x < width && rect.y < height;
  });
  visibleFootprints.forEach((footprint, index) => {
    const rect = rects[footprint.representative]!;
    const center = islandLabelPoint(rect);
    drawNumber(rgba, width, height, index + 1, center.x, center.y, rect.w, rect.h);
  });
  return visibleFootprints.length;
}

/**
 * Rasterize the current authored UV edges onto a truly transparent substrate.
 * Face edges use the same quad-aware geometry as the editor, so an authored
 * quad exports four sides rather than reintroducing its resident triangle
 * diagonal. Island boundaries receive a heavier neutral line for legibility.
 *
 * The generation preset preserves that geometry but adds one stable number per
 * exact texture footprint and a 6%-alpha pink canvas signal. The transparent
 * preset remains byte-transparent away from lines for compositing workflows.
 */
export function rasterizeUvWireframe(
  rects: readonly UvIslandRect[],
  width: number,
  height: number,
  options: UvWireframeRasterOptions = {},
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
  const kind = options.kind ?? 'transparent';
  if (kind === 'generation') {
    fillRaster(
      rgba,
      UV_WIREFRAME_EXPORT_TUNING.generationBackgroundRgb,
      UV_WIREFRAME_EXPORT_TUNING.generationBackgroundAlphaByte,
    );
  }
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
  const numberedFootprints = kind === 'generation'
    ? drawFootprintNumbers(rgba, width, height, rects)
    : 0;
  return {
    rgba,
    width,
    height,
    authoredEdges: faceSegments.length / 4,
    boundaryEdges: boundarySegments.length / 4,
    numberedFootprints,
  };
}
