// Live UV-layout editing rules. The atlas raster is only the substrate; these
// rectangles are the selectable authored geometry rendered above it.

export const UV_LAYOUT_TUNING = {
  gutterTexels: 2,
  minimumIslandTexels: 1,
  resizeHandlePx: 8,
  middleMouseButtonsMask: 2,
  checkerPx: 20,
  canvasPaddingPx: 16,
  defaultNativeScale: 4,
  minimumZoom: 0.05,
  maximumZoom: 32,
} as const;

export type UvCanvasTool = 'select' | 'pan';

export type UvIslandRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  group: number;
};

const integer = (value: number): number => Math.round(Number.isFinite(value) ? value : 0);
const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

/**
 * ReactJIT pointer events use a one-based `button` value for the primary button,
 * so DOM's `button === 1` middle-button convention is not valid here. The live
 * SDL button mask is unambiguous: bit 1 is the middle button.
 */
export function shouldPanUvCanvas(tool: UvCanvasTool, mouseButtonsMask: number): boolean {
  return tool === 'pan' || (integer(mouseButtonsMask) & UV_LAYOUT_TUNING.middleMouseButtonsMask) !== 0;
}

export function parseUvIslandRects(rects: readonly number[] | undefined, groups: readonly number[] | undefined): UvIslandRect[] {
  if (!rects || rects.length % 4 !== 0) return [];
  const out: UvIslandRect[] = [];
  for (let index = 0; index < rects.length; index += 4) {
    out.push({
      x: integer(rects[index]!),
      y: integer(rects[index + 1]!),
      w: Math.max(1, integer(rects[index + 2]!)),
      h: Math.max(1, integer(rects[index + 3]!)),
      group: integer(groups?.[index / 4] ?? 0xffffffff) >>> 0,
    });
  }
  return out;
}

export function flattenUvIslandRects(rects: readonly UvIslandRect[]): Uint32Array {
  const out = new Uint32Array(rects.length * 4);
  rects.forEach((rect, index) => {
    out[index * 4] = rect.x;
    out[index * 4 + 1] = rect.y;
    out[index * 4 + 2] = rect.w;
    out[index * 4 + 3] = rect.h;
  });
  return out;
}

export function moveUvIsland(rect: UvIslandRect, dx: number, dy: number, atlasW: number, atlasH: number): UvIslandRect {
  return {
    ...rect,
    x: clamp(integer(rect.x + dx), 0, Math.max(0, atlasW - rect.w)),
    y: clamp(integer(rect.y + dy), 0, Math.max(0, atlasH - rect.h)),
  };
}

export function resizeUvIsland(rect: UvIslandRect, dw: number, dh: number, atlasW: number, atlasH: number): UvIslandRect {
  return {
    ...rect,
    w: clamp(integer(rect.w + dw), UV_LAYOUT_TUNING.minimumIslandTexels, Math.max(UV_LAYOUT_TUNING.minimumIslandTexels, atlasW - rect.x)),
    h: clamp(integer(rect.h + dh), UV_LAYOUT_TUNING.minimumIslandTexels, Math.max(UV_LAYOUT_TUNING.minimumIslandTexels, atlasH - rect.y)),
  };
}

export type UvResizeCorner = 'nw' | 'ne' | 'se' | 'sw';

/** Resize from any visible corner while keeping the opposite corner fixed. */
export function resizeUvIslandFromCorner(
  rect: UvIslandRect,
  corner: UvResizeCorner,
  dx: number,
  dy: number,
  atlasW: number,
  atlasH: number,
): UvIslandRect {
  const minSize = UV_LAYOUT_TUNING.minimumIslandTexels;
  const left = corner === 'nw' || corner === 'sw'
    ? clamp(integer(rect.x + dx), 0, rect.x + rect.w - minSize)
    : rect.x;
  const top = corner === 'nw' || corner === 'ne'
    ? clamp(integer(rect.y + dy), 0, rect.y + rect.h - minSize)
    : rect.y;
  const right = corner === 'ne' || corner === 'se'
    ? clamp(integer(rect.x + rect.w + dx), rect.x + minSize, atlasW)
    : rect.x + rect.w;
  const bottom = corner === 'se' || corner === 'sw'
    ? clamp(integer(rect.y + rect.h + dy), rect.y + minSize, atlasH)
    : rect.y + rect.h;
  return { ...rect, x: left, y: top, w: right - left, h: bottom - top };
}

/** Smallest containing island wins, so nested/overlapping UVs stay reachable. */
export function hitUvIsland(rects: readonly UvIslandRect[], x: number, y: number): number {
  let hit = -1;
  let area = Number.POSITIVE_INFINITY;
  rects.forEach((rect, index) => {
    if (x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h) return;
    const nextArea = rect.w * rect.h;
    if (nextArea <= area) { area = nextArea; hit = index; }
  });
  return hit;
}

/** Repack every island into equal cells while preserving the current atlas size. */
export function uniformUvPack(rects: readonly UvIslandRect[], atlasW: number, atlasH: number): UvIslandRect[] {
  if (!rects.length || atlasW < 1 || atlasH < 1) return [];
  const aspect = atlasW / Math.max(1, atlasH);
  const columns = Math.max(1, Math.ceil(Math.sqrt(rects.length * aspect)));
  const rows = Math.max(1, Math.ceil(rects.length / columns));
  const cellW = Math.max(1, Math.floor(atlasW / columns));
  const cellH = Math.max(1, Math.floor(atlasH / rows));
  const gutter = UV_LAYOUT_TUNING.gutterTexels;
  const packedW = Math.max(1, cellW - gutter);
  const packedH = Math.max(1, cellH - gutter);
  return rects.map((rect, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...rect,
      x: column * cellW,
      y: row * cellH,
      w: Math.min(packedW, atlasW - column * cellW),
      h: Math.min(packedH, atlasH - row * cellH),
    };
  });
}

export function uvRectPath(rects: readonly UvIslandRect[], scaleX: number, scaleY: number, offsetX = 0, offsetY = 0): string {
  return rects.map((rect) => {
    const x0 = offsetX + rect.x * scaleX;
    const y0 = offsetY + rect.y * scaleY;
    const x1 = offsetX + (rect.x + rect.w) * scaleX;
    const y1 = offsetY + (rect.y + rect.h) * scaleY;
    return `M ${x0},${y0} L ${x1},${y0} L ${x1},${y1} L ${x0},${y1} Z`;
  }).join(' ');
}
