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

/** One rendered triangle, normalized inside its island's transform bounds. */
export type UvIslandTriangle = readonly [number, number, number, number, number, number];

export type UvIslandRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  group: number;
  /** Exact authored-face silhouette. Empty only when talking to an older host. */
  triangles?: UvIslandTriangle[];
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

export function parseUvIslandRects(
  rects: readonly number[] | undefined,
  groups: readonly number[] | undefined,
  triangles?: readonly number[],
): UvIslandRect[] {
  if (!rects || rects.length % 4 !== 0) return [];
  const out: UvIslandRect[] = [];
  for (let index = 0; index < rects.length; index += 4) {
    out.push({
      x: integer(rects[index]!),
      y: integer(rects[index + 1]!),
      w: Math.max(1, integer(rects[index + 2]!)),
      h: Math.max(1, integer(rects[index + 3]!)),
      group: integer(groups?.[index / 4] ?? 0xffffffff) >>> 0,
      triangles: [],
    });
  }
  if (triangles && triangles.length % 7 === 0) {
    for (let index = 0; index < triangles.length; index += 7) {
      const islandIndex = integer(triangles[index]!);
      const island = out[islandIndex];
      if (!island) continue;
      const local: number[] = [];
      for (let corner = 0; corner < 3; corner += 1) {
        const x = Number(triangles[index + 1 + corner * 2]);
        const y = Number(triangles[index + 2 + corner * 2]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) { local.length = 0; break; }
        local.push((x - island.x) / island.w, (y - island.y) / island.h);
      }
      if (local.length === 6) island.triangles!.push([
        local[0]!, local[1]!, local[2]!, local[3]!, local[4]!, local[5]!,
      ]);
    }
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

function pointInTriangle(triangle: UvIslandTriangle, u: number, v: number): boolean {
  const edge = (ax: number, ay: number, bx: number, by: number) => (u - bx) * (ay - by) - (ax - bx) * (v - by);
  const d0 = edge(triangle[0], triangle[1], triangle[2], triangle[3]);
  const d1 = edge(triangle[2], triangle[3], triangle[4], triangle[5]);
  const d2 = edge(triangle[4], triangle[5], triangle[0], triangle[1]);
  const epsilon = 1e-5;
  const hasNegative = d0 < -epsilon || d1 < -epsilon || d2 < -epsilon;
  const hasPositive = d0 > epsilon || d1 > epsilon || d2 > epsilon;
  return !(hasNegative && hasPositive);
}

/** Smallest actual silhouette wins, so empty triangle bounds never masquerade as UVs. */
export function hitUvIsland(rects: readonly UvIslandRect[], x: number, y: number): number {
  let hit = -1;
  let area = Number.POSITIVE_INFINITY;
  rects.forEach((rect, index) => {
    if (x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h) return;
    if (rect.triangles?.length) {
      const u = (x - rect.x) / Math.max(1, rect.w);
      const v = (y - rect.y) / Math.max(1, rect.h);
      if (!rect.triangles.some((triangle) => pointInTriangle(triangle, u, v))) return;
    }
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

function trianglePoint(rect: UvIslandRect, triangle: UvIslandTriangle, corner: number, scaleX: number, scaleY: number, offsetX: number, offsetY: number): [number, number] {
  return [
    offsetX + (rect.x + triangle[corner * 2]! * rect.w) * scaleX,
    offsetY + (rect.y + triangle[corner * 2 + 1]! * rect.h) * scaleY,
  ];
}

/** Closed triangles for exact silhouette fills; rectangle fallback keeps older hosts usable. */
export function uvTrianglePath(rects: readonly UvIslandRect[], scaleX: number, scaleY: number, offsetX = 0, offsetY = 0): string {
  return rects.map((rect) => {
    if (!rect.triangles?.length) return uvRectPath([rect], scaleX, scaleY, offsetX, offsetY);
    return rect.triangles.map((triangle) => {
      const a = trianglePoint(rect, triangle, 0, scaleX, scaleY, offsetX, offsetY);
      const b = trianglePoint(rect, triangle, 1, scaleX, scaleY, offsetX, offsetY);
      const c = trianglePoint(rect, triangle, 2, scaleX, scaleY, offsetX, offsetY);
      return `M ${a[0]},${a[1]} L ${b[0]},${b[1]} L ${c[0]},${c[1]} Z`;
    }).join(' ');
  }).join(' ');
}

/** Authored-island perimeter with shared triangulation edges removed. */
export function uvIslandBoundaryPath(rects: readonly UvIslandRect[], scaleX: number, scaleY: number, offsetX = 0, offsetY = 0): string {
  return rects.map((rect) => {
    if (!rect.triangles?.length) return uvRectPath([rect], scaleX, scaleY, offsetX, offsetY);
    const edges = new Map<string, { count: number; a: [number, number]; b: [number, number] }>();
    const keyFor = (a: [number, number], b: [number, number]) => {
      const ak = `${a[0].toFixed(5)},${a[1].toFixed(5)}`;
      const bk = `${b[0].toFixed(5)},${b[1].toFixed(5)}`;
      return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
    };
    rect.triangles.forEach((triangle) => {
      const points: [number, number][] = [
        [triangle[0], triangle[1]],
        [triangle[2], triangle[3]],
        [triangle[4], triangle[5]],
      ];
      for (let edge = 0; edge < 3; edge += 1) {
        const a = points[edge]!;
        const b = points[(edge + 1) % 3]!;
        const key = keyFor(a, b);
        const existing = edges.get(key);
        if (existing) existing.count += 1;
        else edges.set(key, { count: 1, a, b });
      }
    });
    let path = '';
    edges.forEach((edge) => {
      if (edge.count !== 1) return;
      const ax = offsetX + (rect.x + edge.a[0] * rect.w) * scaleX;
      const ay = offsetY + (rect.y + edge.a[1] * rect.h) * scaleY;
      const bx = offsetX + (rect.x + edge.b[0] * rect.w) * scaleX;
      const by = offsetY + (rect.y + edge.b[1] * rect.h) * scaleY;
      path += `M ${ax},${ay} L ${bx},${by} `;
    });
    return path;
  }).join(' ');
}
