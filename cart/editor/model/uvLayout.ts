// Live UV-layout editing rules. The atlas raster is the fixed substrate; exact
// face-corner coordinates are the authored geometry rendered above it.

export const UV_LAYOUT_TUNING = {
  gutterTexels: 2,
  minimumIslandTexels: 1,
  vertexHandleHitPx: 8,
  middleMouseButtonsMask: 2,
  checkerPx: 20,
  canvasPaddingPx: 16,
  defaultNativeScale: 4,
  minimumZoom: 0.05,
  maximumZoom: 32,
  /** UV vertices land on whole texture pixels unless Alt temporarily disables snapping. */
  vertexSnapTexels: 1,
  /** Keep translation latches perceptible even when a large atlas is zoomed far out. */
  minimumTranslationSnapPx: 4,
  pointMatchEpsilon: 0.0001,
  doubleClickMs: 350,
  doubleClickDistancePx: 6,
  dragActivationPx: 4,
  /** Coalesce high-rate pointer samples without limiting a 240 Hz display to 60 Hz. */
  dragPreviewIntervalMs: 4,
  minimumGridSpacingPx: 18,
  rotationHandleOffsetPx: 21,
  rotationHandleHitPx: 11,
  scaleHandleOffsetPx: 7,
  scaleHandleHitPx: 9,
  rotationSnapDegrees: 1,
  axisSnapToleranceDegrees: 1,
  minimumSelectionScale: 0.05,
} as const;

export const NO_UV_GROUP = 0xffffffff;

export type UvCanvasTool = 'select' | 'pan';

export type UvTrianglePoints = readonly [number, number, number, number, number, number];

/** One rendered face triangle, normalized inside its island's transform bounds. */
export type UvIslandTriangle = {
  /** Stable render-face row in the host's complete corner-UV table. */
  face: number;
  /** Authored face shared by render triangles (a quad), or 0xffffffff when loose. */
  group: number;
  points: UvTrianglePoints;
};

export type UvIslandVertex = { x: number; y: number };

export type UvFaceTarget = { face: number; group: number };
export type UvSelectionBounds = { x: number; y: number; w: number; h: number; cx: number; cy: number };
export type UvAxisGuide = { axis: 'horizontal' | 'vertical'; coordinate: number };
export type UvRotationResult = { rect: UvIslandRect; angleDegrees: number; guide: UvAxisGuide | null };
export type UvClickStamp = { at: number; x: number; y: number };

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

export function isUvDoubleClick(previous: UvClickStamp | null, current: UvClickStamp): boolean {
  return Boolean(
    previous
    && current.at - previous.at >= 0
    && current.at - previous.at <= UV_LAYOUT_TUNING.doubleClickMs
    && Math.hypot(current.x - previous.x, current.y - previous.y) <= UV_LAYOUT_TUNING.doubleClickDistancePx,
  );
}

/** A click may select without nudging UVs. Translation begins only after the
 * pointer has deliberately crossed the same activation radius used to classify
 * click versus drag on release. */
export function shouldActivateUvDrag(dxPx: number, dyPx: number): boolean {
  return Math.hypot(dxPx, dyPx) > UV_LAYOUT_TUNING.dragActivationPx;
}

/** Power-of-two texture steps keep snapping physically legible at every zoom:
 * 1 texel when it is visible, progressively coarser while zoomed out. */
export function uvTranslationSnapStep(viewScale: number): number {
  const scale = Math.max(UV_LAYOUT_TUNING.minimumZoom, Number.isFinite(viewScale) ? viewScale : 1);
  let step = UV_LAYOUT_TUNING.vertexSnapTexels;
  while (step * scale < UV_LAYOUT_TUNING.minimumTranslationSnapPx) step *= 2;
  return step;
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
  const triangleStride = triangles && triangles.length % 8 === 0 ? 8 : triangles && triangles.length % 7 === 0 ? 7 : 0;
  if (triangles && triangleStride) {
    for (let index = 0; index < triangles.length; index += triangleStride) {
      const islandIndex = integer(triangles[index]!);
      const island = out[islandIndex];
      if (!island) continue;
      const group = triangleStride === 8 ? integer(triangles[index + 1]!) >>> 0 : island.group;
      const pointOffset = triangleStride === 8 ? 2 : 1;
      const local: number[] = [];
      for (let corner = 0; corner < 3; corner += 1) {
        const x = Number(triangles[index + pointOffset + corner * 2]);
        const y = Number(triangles[index + pointOffset + corner * 2 + 1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) { local.length = 0; break; }
        local.push((x - island.x) / island.w, (y - island.y) / island.h);
      }
      if (local.length === 6) island.triangles!.push({
        // __model_atlas_read emits every face in render-face order. Keeping that
        // row identity is what lets a deformed triangle round-trip exactly.
        face: index / triangleStride,
        group,
        points: [local[0]!, local[1]!, local[2]!, local[3]!, local[4]!, local[5]!],
      });
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

/**
 * Serialize the exact UV of every render-face corner, in host face order.
 * Rectangles remain useful transform bounds, but are not the authored geometry:
 * a triangle vertex can move without inventing a rectangular face around it.
 */
export function flattenUvFaceCorners(rects: readonly UvIslandRect[]): Float32Array | null {
  let faceCount = 0;
  for (const rect of rects) {
    for (const triangle of rect.triangles ?? []) faceCount = Math.max(faceCount, triangle.face + 1);
  }
  if (faceCount === 0) return null;
  const seen = new Uint8Array(faceCount);
  const out = new Float32Array(faceCount * 6);
  for (const rect of rects) {
    for (const triangle of rect.triangles ?? []) {
      if (!Number.isInteger(triangle.face) || triangle.face < 0 || triangle.face >= faceCount || seen[triangle.face]) return null;
      seen[triangle.face] = 1;
      for (let corner = 0; corner < 3; corner += 1) {
        const x = rect.x + triangle.points[corner * 2]! * rect.w;
        const y = rect.y + triangle.points[corner * 2 + 1]! * rect.h;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        out[triangle.face * 6 + corner * 2] = x;
        out[triangle.face * 6 + corner * 2 + 1] = y;
      }
    }
  }
  for (const present of seen) if (!present) return null;
  return out;
}

export function moveUvIsland(
  rect: UvIslandRect,
  dx: number,
  dy: number,
  atlasW: number,
  atlasH: number,
  snapStep = UV_LAYOUT_TUNING.vertexSnapTexels,
  freeMove = false,
): UvIslandRect {
  const requestedX = rect.x + dx;
  const requestedY = rect.y + dy;
  const x = clamp(freeMove ? requestedX : snapUvVertex(requestedX, snapStep), 0, Math.max(0, atlasW - rect.w));
  const y = clamp(freeMove ? requestedY : snapUvVertex(requestedY, snapStep), 0, Math.max(0, atlasH - rect.h));
  if (x === rect.x && y === rect.y) return rect;
  return {
    ...rect,
    x,
    y,
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

function absoluteTrianglePoints(rect: UvIslandRect, triangle: UvIslandTriangle): UvTrianglePoints {
  return [
    rect.x + triangle.points[0] * rect.w,
    rect.y + triangle.points[1] * rect.h,
    rect.x + triangle.points[2] * rect.w,
    rect.y + triangle.points[3] * rect.h,
    rect.x + triangle.points[4] * rect.w,
    rect.y + triangle.points[5] * rect.h,
  ];
}

type AbsoluteUvTriangle = { face: number; group: number; points: [number, number, number, number, number, number] };

const triangleMatchesTarget = (triangle: Pick<UvIslandTriangle, 'face' | 'group'>, target?: UvFaceTarget): boolean => (
  !target || (target.group !== NO_UV_GROUP ? triangle.group === target.group : triangle.face === target.face)
);

function absoluteTriangles(rect: UvIslandRect): AbsoluteUvTriangle[] {
  return (rect.triangles ?? []).map((triangle) => ({
    face: triangle.face,
    group: triangle.group,
    points: [...absoluteTrianglePoints(rect, triangle)] as AbsoluteUvTriangle['points'],
  }));
}

function rebuildUvRect(rect: UvIslandRect, triangles: readonly AbsoluteUvTriangle[], atlasW: number, atlasH: number): UvIslandRect {
  if (!triangles.length || atlasW < 1 || atlasH < 1) return rect;
  let lowX = Number.POSITIVE_INFINITY;
  let lowY = Number.POSITIVE_INFINITY;
  let highX = Number.NEGATIVE_INFINITY;
  let highY = Number.NEGATIVE_INFINITY;
  for (const triangle of triangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      lowX = Math.min(lowX, triangle.points[corner * 2]!);
      lowY = Math.min(lowY, triangle.points[corner * 2 + 1]!);
      highX = Math.max(highX, triangle.points[corner * 2]!);
      highY = Math.max(highY, triangle.points[corner * 2 + 1]!);
    }
  }
  const x = clamp(Math.floor(lowX), 0, atlasW - 1);
  const y = clamp(Math.floor(lowY), 0, atlasH - 1);
  const right = clamp(Math.max(x + 1, Math.ceil(highX)), x + 1, atlasW);
  const bottom = clamp(Math.max(y + 1, Math.ceil(highY)), y + 1, atlasH);
  const w = right - x;
  const h = bottom - y;
  return {
    ...rect,
    x,
    y,
    w,
    h,
    triangles: triangles.map((triangle) => ({
      face: triangle.face,
      group: triangle.group,
      points: [
        (triangle.points[0] - x) / w, (triangle.points[1] - y) / h,
        (triangle.points[2] - x) / w, (triangle.points[3] - y) / h,
        (triangle.points[4] - x) / w, (triangle.points[5] - y) / h,
      ],
    })),
  };
}

export function uvSelectionBounds(rect: UvIslandRect, target?: UvFaceTarget): UvSelectionBounds | null {
  let x = Number.POSITIVE_INFINITY;
  let y = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const triangle of rect.triangles ?? []) {
    if (!triangleMatchesTarget(triangle, target)) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const px = rect.x + triangle.points[corner * 2]! * rect.w;
      const py = rect.y + triangle.points[corner * 2 + 1]! * rect.h;
      x = Math.min(x, px);
      y = Math.min(y, py);
      right = Math.max(right, px);
      bottom = Math.max(bottom, py);
    }
  }
  if (!Number.isFinite(x)) return null;
  return { x, y, w: right - x, h: bottom - y, cx: (x + right) * 0.5, cy: (y + bottom) * 0.5 };
}

function clampSelectionTranslation(bounds: UvSelectionBounds, dx: number, dy: number, atlasW: number, atlasH: number): [number, number] {
  return [
    clamp(dx, -bounds.x, atlasW - bounds.x - bounds.w),
    clamp(dy, -bounds.y, atlasH - bounds.y - bounds.h),
  ];
}

function translateAbsoluteSelection(
  triangles: AbsoluteUvTriangle[],
  target: UvFaceTarget | undefined,
  dx: number,
  dy: number,
): void {
  for (const triangle of triangles) {
    if (!triangleMatchesTarget(triangle, target)) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      triangle.points[corner * 2] += dx;
      triangle.points[corner * 2 + 1] += dy;
    }
  }
}

/** Move one authored face out of a connected island. Its render triangles stay
 * together; the host's shared-edge reconstruction turns the broken edge into a seam. */
export function moveUvFace(
  rect: UvIslandRect,
  target: UvFaceTarget,
  dx: number,
  dy: number,
  atlasW: number,
  atlasH: number,
  snapStep = UV_LAYOUT_TUNING.vertexSnapTexels,
  freeMove = false,
): UvIslandRect {
  const bounds = uvSelectionBounds(rect, target);
  if (!bounds) return rect;
  const snappedDx = freeMove ? dx : snapUvVertex(bounds.x + dx, snapStep) - bounds.x;
  const snappedDy = freeMove ? dy : snapUvVertex(bounds.y + dy, snapStep) - bounds.y;
  const [safeDx, safeDy] = clampSelectionTranslation(bounds, snappedDx, snappedDy, atlasW, atlasH);
  if (Math.abs(safeDx) <= UV_LAYOUT_TUNING.pointMatchEpsilon && Math.abs(safeDy) <= UV_LAYOUT_TUNING.pointMatchEpsilon) return rect;
  const triangles = absoluteTriangles(rect);
  translateAbsoluteSelection(triangles, target, safeDx, safeDy);
  return rebuildUvRect(rect, triangles, atlasW, atlasH);
}

/** Scale a complete island or one authored face from the opposite (north-west)
 * corner of its transform frame. Texture pixels remain fixed; only sample UVs move. */
export function scaleUvSelection(
  rect: UvIslandRect,
  target: UvFaceTarget | undefined,
  scaleX: number,
  scaleY: number,
  atlasW: number,
  atlasH: number,
): UvIslandRect {
  const bounds = uvSelectionBounds(rect, target);
  if (!bounds) return rect;
  const sx = Math.max(UV_LAYOUT_TUNING.minimumSelectionScale, Number.isFinite(scaleX) ? scaleX : 1);
  const sy = Math.max(UV_LAYOUT_TUNING.minimumSelectionScale, Number.isFinite(scaleY) ? scaleY : 1);
  const triangles = absoluteTriangles(rect);
  for (const triangle of triangles) {
    if (!triangleMatchesTarget(triangle, target)) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const at = corner * 2;
      triangle.points[at] = bounds.x + (triangle.points[at]! - bounds.x) * sx;
      triangle.points[at + 1] = bounds.y + (triangle.points[at + 1]! - bounds.y) * sy;
    }
  }
  const transformedBounds = uvSelectionBounds(rebuildUvRect(rect, triangles, atlasW, atlasH), target);
  if (transformedBounds) {
    const [dx, dy] = clampSelectionTranslation(transformedBounds, 0, 0, atlasW, atlasH);
    translateAbsoluteSelection(triangles, target, dx, dy);
  }
  return rebuildUvRect(rect, triangles, atlasW, atlasH);
}

function normalizedHalfTurn(angleDegrees: number): number {
  return ((angleDegrees % 180) + 180) % 180;
}

function axisCorrection(triangles: readonly AbsoluteUvTriangle[], target: UvFaceTarget | undefined): { delta: number; axis: UvAxisGuide['axis'] } | null {
  let best: { delta: number; axis: UvAxisGuide['axis'] } | null = null;
  for (const triangle of triangles) {
    if (!triangleMatchesTarget(triangle, target)) continue;
    for (let edge = 0; edge < 3; edge += 1) {
      const a = edge * 2;
      const b = ((edge + 1) % 3) * 2;
      const angle = normalizedHalfTurn(Math.atan2(triangle.points[b + 1]! - triangle.points[a + 1]!, triangle.points[b]! - triangle.points[a]!) * 180 / Math.PI);
      const horizontal = angle <= 90 ? -angle : 180 - angle;
      const vertical = 90 - angle;
      const candidate = Math.abs(horizontal) <= Math.abs(vertical)
        ? { delta: horizontal, axis: 'horizontal' as const }
        : { delta: vertical, axis: 'vertical' as const };
      if (Math.abs(candidate.delta) > UV_LAYOUT_TUNING.axisSnapToleranceDegrees) continue;
      if (!best || Math.abs(candidate.delta) < Math.abs(best.delta)) best = candidate;
    }
  }
  return best;
}

function rotateAbsoluteSelection(
  triangles: AbsoluteUvTriangle[],
  target: UvFaceTarget | undefined,
  center: UvIslandVertex,
  angleDegrees: number,
): void {
  const radians = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  for (const triangle of triangles) {
    if (!triangleMatchesTarget(triangle, target)) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const at = corner * 2;
      const dx = triangle.points[at]! - center.x;
      const dy = triangle.points[at + 1]! - center.y;
      triangle.points[at] = center.x + dx * cosine - dy * sine;
      triangle.points[at + 1] = center.y + dx * sine + dy * cosine;
    }
  }
}

/** Free rotation with one-degree motion and magnetic horizontal/vertical edges.
 * The returned guide is rendered through the aligned edge for explicit feedback. */
export function rotateUvSelection(
  rect: UvIslandRect,
  target: UvFaceTarget | undefined,
  requestedAngleDegrees: number,
  atlasW: number,
  atlasH: number,
): UvRotationResult {
  const bounds = uvSelectionBounds(rect, target);
  if (!bounds) return { rect, angleDegrees: 0, guide: null };
  const baseAngle = Math.round(requestedAngleDegrees / UV_LAYOUT_TUNING.rotationSnapDegrees) * UV_LAYOUT_TUNING.rotationSnapDegrees;
  const preview = absoluteTriangles(rect);
  rotateAbsoluteSelection(preview, target, { x: bounds.cx, y: bounds.cy }, baseAngle);
  const correction = axisCorrection(preview, target);
  const angleDegrees = baseAngle + (correction?.delta ?? 0);
  const triangles = absoluteTriangles(rect);
  rotateAbsoluteSelection(triangles, target, { x: bounds.cx, y: bounds.cy }, angleDegrees);

  let rotatedBounds = uvSelectionBounds(rebuildUvRect(rect, triangles, atlasW, atlasH), target);
  if (rotatedBounds) {
    const [dx, dy] = clampSelectionTranslation(rotatedBounds, 0, 0, atlasW, atlasH);
    translateAbsoluteSelection(triangles, target, dx, dy);
    rotatedBounds = { ...rotatedBounds, x: rotatedBounds.x + dx, y: rotatedBounds.y + dy, cx: rotatedBounds.cx + dx, cy: rotatedBounds.cy + dy };
  }
  const changed = rebuildUvRect(rect, triangles, atlasW, atlasH);
  const guide = correction && rotatedBounds
    ? { axis: correction.axis, coordinate: correction.axis === 'horizontal' ? rotatedBounds.cy : rotatedBounds.cx }
    : null;
  return { rect: changed, angleDegrees, guide };
}

const sameUvPoint = (ax: number, ay: number, bx: number, by: number): boolean => (
  Math.abs(ax - bx) <= UV_LAYOUT_TUNING.pointMatchEpsilon
  && Math.abs(ay - by) <= UV_LAYOUT_TUNING.pointMatchEpsilon
);

/** Unique real UV vertices, with fan/shared-edge duplicates collapsed. */
export function uvSelectionVertices(rect: UvIslandRect, target?: UvFaceTarget): UvIslandVertex[] {
  const vertices: UvIslandVertex[] = [];
  // The old `vertices.some(...)` de-duplicator made selecting a dense island
  // quadratic (600 faces means millions of point comparisons on every preview).
  // Epsilon-sized spatial buckets preserve the same tolerant equality while
  // keeping the walk linear for ordinary mesh topology. Adjacent buckets are
  // checked because two epsilon-equal coordinates can straddle a cell edge.
  const cellSize = UV_LAYOUT_TUNING.pointMatchEpsilon;
  const buckets = new Map<string, UvIslandVertex[]>();
  for (const triangle of rect.triangles ?? []) {
    if (!triangleMatchesTarget(triangle, target)) continue;
    const points = absoluteTrianglePoints(rect, triangle);
    for (let corner = 0; corner < 3; corner += 1) {
      const x = points[corner * 2]!;
      const y = points[corner * 2 + 1]!;
      const cellX = Math.floor(x / cellSize);
      const cellY = Math.floor(y / cellSize);
      let duplicate = false;
      for (let ox = -1; ox <= 1 && !duplicate; ox += 1) {
        for (let oy = -1; oy <= 1 && !duplicate; oy += 1) {
          const candidates = buckets.get(`${cellX + ox}:${cellY + oy}`);
          duplicate = Boolean(candidates?.some((vertex) => sameUvPoint(vertex.x, vertex.y, x, y)));
        }
      }
      if (duplicate) continue;
      const vertex = { x, y };
      vertices.push(vertex);
      const key = `${cellX}:${cellY}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(vertex);
      else buckets.set(key, [vertex]);
    }
  }
  return vertices;
}

export function uvIslandVertices(rect: UvIslandRect): UvIslandVertex[] {
  return uvSelectionVertices(rect);
}

const snapUvVertex = (value: number, step = UV_LAYOUT_TUNING.vertexSnapTexels): number => (
  Math.round(value / Math.max(UV_LAYOUT_TUNING.vertexSnapTexels, step))
  * Math.max(UV_LAYOUT_TUNING.vertexSnapTexels, step)
);

/**
 * Move one actual UV vertex. Every coincident corner in the selected authored
 * island follows, so a quad's internal triangle seam cannot tear. The island
 * rectangle is then re-derived as transform metadata; it never becomes geometry.
 */
export function moveUvSelectionVertex(
  rect: UvIslandRect,
  target: UvFaceTarget | undefined,
  vertexIndex: number,
  dx: number,
  dy: number,
  atlasW: number,
  atlasH: number,
  freeMove = false,
  snapStep = UV_LAYOUT_TUNING.vertexSnapTexels,
): UvIslandRect {
  if (atlasW < 1 || atlasH < 1 || !rect.triangles?.length) return rect;
  const vertices = uvSelectionVertices(rect, target);
  const selected = vertices[vertexIndex];
  if (!selected) return rect;
  const minX = Math.min(0.5, atlasW * 0.5);
  const minY = Math.min(0.5, atlasH * 0.5);
  const requestedX = selected.x + dx;
  const requestedY = selected.y + dy;
  const targetX = clamp(freeMove ? requestedX : snapUvVertex(requestedX, snapStep), minX, atlasW - minX);
  const targetY = clamp(freeMove ? requestedY : snapUvVertex(requestedY, snapStep), minY, atlasH - minY);
  if (sameUvPoint(targetX, targetY, selected.x, selected.y)) return rect;

  const absolute = rect.triangles.map((triangle) => {
    const points = [...absoluteTrianglePoints(rect, triangle)] as [number, number, number, number, number, number];
    if (!triangleMatchesTarget(triangle, target)) return { face: triangle.face, group: triangle.group, points };
    for (let corner = 0; corner < 3; corner += 1) {
      const at = corner * 2;
      if (!sameUvPoint(points[at]!, points[at + 1]!, selected.x, selected.y)) continue;
      points[at] = targetX;
      points[at + 1] = targetY;
    }
    return { face: triangle.face, group: triangle.group, points };
  });

  let lowX = Number.POSITIVE_INFINITY;
  let lowY = Number.POSITIVE_INFINITY;
  let highX = Number.NEGATIVE_INFINITY;
  let highY = Number.NEGATIVE_INFINITY;
  for (const triangle of absolute) {
    for (let corner = 0; corner < 3; corner += 1) {
      lowX = Math.min(lowX, triangle.points[corner * 2]!);
      lowY = Math.min(lowY, triangle.points[corner * 2 + 1]!);
      highX = Math.max(highX, triangle.points[corner * 2]!);
      highY = Math.max(highY, triangle.points[corner * 2 + 1]!);
    }
  }
  const x = clamp(Math.floor(lowX), 0, atlasW - 1);
  const y = clamp(Math.floor(lowY), 0, atlasH - 1);
  const right = clamp(Math.max(x + 1, Math.ceil(highX)), x + 1, atlasW);
  const bottom = clamp(Math.max(y + 1, Math.ceil(highY)), y + 1, atlasH);
  const w = right - x;
  const h = bottom - y;
  return {
    ...rect,
    x,
    y,
    w,
    h,
    triangles: absolute.map((triangle) => ({
      face: triangle.face,
      group: triangle.group,
      points: [
        (triangle.points[0] - x) / w, (triangle.points[1] - y) / h,
        (triangle.points[2] - x) / w, (triangle.points[3] - y) / h,
        (triangle.points[4] - x) / w, (triangle.points[5] - y) / h,
      ],
    })),
  };
}

export function moveUvIslandVertex(
  rect: UvIslandRect,
  vertexIndex: number,
  dx: number,
  dy: number,
  atlasW: number,
  atlasH: number,
  freeMove = false,
  snapStep = UV_LAYOUT_TUNING.vertexSnapTexels,
): UvIslandRect {
  return moveUvSelectionVertex(rect, undefined, vertexIndex, dx, dy, atlasW, atlasH, freeMove, snapStep);
}

function pointInTriangle(triangle: UvTrianglePoints, u: number, v: number): boolean {
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
      if (!rect.triangles.some((triangle) => pointInTriangle(triangle.points, u, v))) return;
    }
    const nextArea = rect.w * rect.h;
    if (nextArea <= area) { area = nextArea; hit = index; }
  });
  return hit;
}

/** Exact authored face under the pointer. A quad's two render triangles report the
 * same group, so face-mode transforms keep the quad intact; loose faces use row id. */
export function hitUvFace(rects: readonly UvIslandRect[], x: number, y: number): { island: number; target: UvFaceTarget } | null {
  let hit: { island: number; target: UvFaceTarget } | null = null;
  let area = Number.POSITIVE_INFINITY;
  rects.forEach((rect, island) => {
    for (const triangle of rect.triangles ?? []) {
      const points = absoluteTrianglePoints(rect, triangle);
      if (!pointInTriangle(points, x, y)) continue;
      const twiceArea = Math.abs(
        (points[2] - points[0]) * (points[5] - points[1])
        - (points[3] - points[1]) * (points[4] - points[0]),
      );
      if (twiceArea > area) continue;
      area = twiceArea;
      hit = { island, target: { face: triangle.face, group: triangle.group } };
    }
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

function uvRectSegments(rects: readonly UvIslandRect[], scaleX: number, scaleY: number, offsetX: number, offsetY: number): number[] {
  const segments: number[] = [];
  for (const rect of rects) {
    const x0 = offsetX + rect.x * scaleX;
    const y0 = offsetY + rect.y * scaleY;
    const x1 = offsetX + (rect.x + rect.w) * scaleX;
    const y1 = offsetY + (rect.y + rect.h) * scaleY;
    segments.push(x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0);
  }
  return segments;
}

function segmentPath(segments: readonly number[]): string {
  let path = '';
  for (let index = 0; index + 3 < segments.length; index += 4) {
    path += `M ${segments[index]},${segments[index + 1]} L ${segments[index + 2]},${segments[index + 3]} `;
  }
  return path;
}

const normalizedEdgeKey = (a: readonly [number, number], b: readonly [number, number]): string => {
  const ak = `${a[0].toFixed(5)},${a[1].toFixed(5)}`;
  const bk = `${b[0].toFixed(5)},${b[1].toFixed(5)}`;
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
};

function trianglePoint(rect: UvIslandRect, triangle: UvTrianglePoints, corner: number, scaleX: number, scaleY: number, offsetX: number, offsetY: number): [number, number] {
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
      const a = trianglePoint(rect, triangle.points, 0, scaleX, scaleY, offsetX, offsetY);
      const b = trianglePoint(rect, triangle.points, 1, scaleX, scaleY, offsetX, offsetY);
      const c = trianglePoint(rect, triangle.points, 2, scaleX, scaleY, offsetX, offsetY);
      return `M ${a[0]},${a[1]} L ${b[0]},${b[1]} L ${c[0]},${c[1]} Z`;
    }).join(' ');
  }).join(' ');
}

/** Authored-island perimeter with shared triangulation edges removed. */
export function uvIslandBoundarySegments(rects: readonly UvIslandRect[], scaleX: number, scaleY: number, offsetX = 0, offsetY = 0): number[] {
  const segments: number[] = [];
  for (const rect of rects) {
    if (!rect.triangles?.length) {
      segments.push(...uvRectSegments([rect], scaleX, scaleY, offsetX, offsetY));
      continue;
    }
    const edges = new Map<string, { count: number; a: [number, number]; b: [number, number] }>();
    rect.triangles.forEach((triangle) => {
      const trianglePoints = triangle.points;
      const points: [number, number][] = [
        [trianglePoints[0], trianglePoints[1]],
        [trianglePoints[2], trianglePoints[3]],
        [trianglePoints[4], trianglePoints[5]],
      ];
      for (let edge = 0; edge < 3; edge += 1) {
        const a = points[edge]!;
        const b = points[(edge + 1) % 3]!;
        const key = normalizedEdgeKey(a, b);
        const existing = edges.get(key);
        if (existing) existing.count += 1;
        else edges.set(key, { count: 1, a, b });
      }
    });
    edges.forEach((edge) => {
      if (edge.count !== 1) return;
      const ax = offsetX + (rect.x + edge.a[0] * rect.w) * scaleX;
      const ay = offsetY + (rect.y + edge.a[1] * rect.h) * scaleY;
      const bx = offsetX + (rect.x + edge.b[0] * rect.w) * scaleX;
      const by = offsetY + (rect.y + edge.b[1] * rect.h) * scaleY;
      segments.push(ax, ay, bx, by);
    });
  }
  return segments;
}

export function uvIslandBoundaryPath(rects: readonly UvIslandRect[], scaleX: number, scaleY: number, offsetX = 0, offsetY = 0): string {
  return segmentPath(uvIslandBoundarySegments(rects, scaleX, scaleY, offsetX, offsetY));
}

/** Every authored face edge, while hiding only the render-triangle diagonal inside
 * one authored quad. Connected fan wedges therefore remain individually legible even
 * though their shared UV edges correctly make the cap one transformable island. */
export function uvFaceEdgeSegments(rects: readonly UvIslandRect[], scaleX: number, scaleY: number, offsetX = 0, offsetY = 0): number[] {
  const segments: number[] = [];
  for (const rect of rects) {
    if (!rect.triangles?.length) {
      segments.push(...uvRectSegments([rect], scaleX, scaleY, offsetX, offsetY));
      continue;
    }
    const edges = new Map<string, { a: [number, number]; b: [number, number]; faces: Set<string>; count: number }>();
    rect.triangles.forEach((triangle) => {
      const points: [number, number][] = [
        [triangle.points[0], triangle.points[1]],
        [triangle.points[2], triangle.points[3]],
        [triangle.points[4], triangle.points[5]],
      ];
      const authoredFace = triangle.group === NO_UV_GROUP ? `face:${triangle.face}` : `group:${triangle.group}`;
      for (let edge = 0; edge < 3; edge += 1) {
        const a = points[edge]!;
        const b = points[(edge + 1) % 3]!;
        const key = normalizedEdgeKey(a, b);
        const existing = edges.get(key);
        if (existing) {
          existing.count += 1;
          existing.faces.add(authoredFace);
        } else {
          edges.set(key, { a, b, faces: new Set([authoredFace]), count: 1 });
        }
      }
    });
    edges.forEach((edge) => {
      // Two render triangles in one authored quad share a diagonal. That is the only
      // edge hidden here; a shared edge between two authored fan wedges stays visible.
      if (edge.count > 1 && edge.faces.size === 1) return;
      const ax = offsetX + (rect.x + edge.a[0] * rect.w) * scaleX;
      const ay = offsetY + (rect.y + edge.a[1] * rect.h) * scaleY;
      const bx = offsetX + (rect.x + edge.b[0] * rect.w) * scaleX;
      const by = offsetY + (rect.y + edge.b[1] * rect.h) * scaleY;
      segments.push(ax, ay, bx, by);
    });
  }
  return segments;
}

export function uvFaceEdgePath(rects: readonly UvIslandRect[], scaleX: number, scaleY: number, offsetX = 0, offsetY = 0): string {
  return segmentPath(uvFaceEdgeSegments(rects, scaleX, scaleY, offsetX, offsetY));
}
