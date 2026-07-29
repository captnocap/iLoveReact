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
  /** Inclusive tolerance for authored UV silhouette hit/intersection tests. */
  geometryEpsilon: 0.00001,
  /** Coalesce high-rate pointer samples without limiting a 240 Hz display to 60 Hz. */
  dragPreviewIntervalMs: 4,
  /** Every fourth snap line is a stronger visual ruler. */
  majorGridEvery: 4,
  /** Screen-space tolerance for promoting a visible grid line into a guide. */
  guideHitPx: 6,
  /** Preserve a small blank target between neighboring selectable grid lines. */
  guideHitCellFraction: 0.45,
  /** Screen-space magnetic radius for selection edges, centres, and vertices. */
  guideSnapPx: 9,
  rotationHandleOffsetPx: 21,
  rotationHandleHitPx: 11,
  scaleHandleOffsetPx: 7,
  scaleHandleHitPx: 9,
  rotationSnapDegrees: 1,
  axisSnapToleranceDegrees: 1,
  minimumSelectionScale: 0.05,
  cornerIdentityHandlePx: 11,
  cornerIdentityMaxFaceTriangles: 256,
  cornerIdentityHueStepDegrees: 137,
  cornerIdentityChromaByte: 184,
  cornerIdentityValueByte: 255,
  /** Reject numerically explosive seam fits instead of folding an island into noise. */
  stitchMinimumScale: 0.05,
  stitchMaximumScale: 20,
  /** A model edge/point with more owners is non-manifold and not an automatic seam. */
  stitchUnambiguousOwnerCount: 2,
  /** Bound visible grid geometry under pathological zoom without bounding space. */
  maximumVisibleGridLines: 4096,
} as const;

/** Explicit authoring precision. Zoom may raise the effective step so a snap
 * cell never becomes smaller than the pointer can visibly distinguish. */
export const UV_SNAP_STEPS = [1, 2, 4, 8, 16] as const;
export type UvSnapStep = typeof UV_SNAP_STEPS[number];

export const NO_UV_GROUP = 0xffffffff;

export type UvCanvasTool = 'select' | 'pan';
export type UvSelectionMode = 'island' | 'face';
export type UvCanvasView = { x: number; y: number; scale: number };
export type UvCanvasPoint = { x: number; y: number };
export type UvCanvasRect = UvCanvasPoint & { width: number; height: number };

export type UvTrianglePoints = readonly [number, number, number, number, number, number];

/** One rendered face triangle, normalized inside its island's transform bounds. */
export type UvIslandTriangle = {
  /** Stable render-face row in the host's complete corner-UV table. */
  face: number;
  /** Authored face shared by render triangles (a quad), or 0xffffffff when loose. */
  group: number;
  points: UvTrianglePoints;
  /** Welded 3D vertex identity for each triangle corner. */
  vertices?: readonly [number, number, number];
};

export type UvIslandVertex = { x: number; y: number };

export type UvFaceTarget = { face: number; group: number };
export type UvFlipAxis = 'u' | 'v';
export type UvSelectionBounds = { x: number; y: number; w: number; h: number; cx: number; cy: number };
export type UvAxisGuide = { axis: 'horizontal' | 'vertical'; coordinate: number };
export type UvGuideSnap = Readonly<{ dx: number; dy: number; guides: UvAxisGuide[] }>;
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

/** Cursor-anchored zoom: the atlas texel beneath the wheel stays beneath it. */
export function zoomUvCanvasViewAt(view: UvCanvasView, point: UvCanvasPoint, factor: number): UvCanvasView {
  const nextScale = clamp(
    view.scale * (Number.isFinite(factor) && factor > 0 ? factor : 1),
    UV_LAYOUT_TUNING.minimumZoom,
    UV_LAYOUT_TUNING.maximumZoom,
  );
  const atlasX = (point.x - view.x) / Math.max(UV_LAYOUT_TUNING.minimumZoom, view.scale);
  const atlasY = (point.y - view.y) / Math.max(UV_LAYOUT_TUNING.minimumZoom, view.scale);
  return {
    x: point.x - atlasX * nextScale,
    y: point.y - atlasY * nextScale,
    scale: nextScale,
  };
}

/** Pan from an immutable gesture seed so high-rate mouse samples never accumulate drift. */
export function panUvCanvasView(seed: UvCanvasView, start: UvCanvasPoint, current: UvCanvasPoint): UvCanvasView {
  return {
    x: seed.x + current.x - start.x,
    y: seed.y + current.y - start.y,
    scale: seed.scale,
  };
}

/**
 * `useContextMenu` captures window coordinates, but the UV popup is rendered
 * inside the inspector. Convert to that containing block and keep the menu on
 * panel; subtracting its width makes a right-edge menu open toward the stage.
 */
export function uvContextMenuPosition(
  windowPoint: UvCanvasPoint,
  container: UvCanvasRect,
  menu: { width: number; height: number },
  edgePx: number,
): UvCanvasPoint {
  const edge = Math.max(0, Number.isFinite(edgePx) ? edgePx : 0);
  const maxX = Math.max(edge, container.width - menu.width - edge);
  const maxY = Math.max(edge, container.height - menu.height - edge);
  return {
    x: clamp(windowPoint.x - container.x - menu.width, edge, maxX),
    y: clamp(windowPoint.y - container.y, edge, maxY),
  };
}

/** Double-click is a reversible scope toggle: island -> authored face -> island. */
export function uvSelectionModeAfterDoubleClick(mode: UvSelectionMode, hitFace: boolean): UvSelectionMode {
  if (!hitFace) return mode;
  return mode === 'face' ? 'island' : 'face';
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
export function uvTranslationSnapStep(viewScale: number, minimumStep = UV_LAYOUT_TUNING.vertexSnapTexels): number {
  const scale = Math.max(UV_LAYOUT_TUNING.minimumZoom, Number.isFinite(viewScale) ? viewScale : 1);
  let step = Math.max(UV_LAYOUT_TUNING.vertexSnapTexels, integer(minimumStep));
  while (step * scale < UV_LAYOUT_TUNING.minimumTranslationSnapPx) step *= 2;
  return step;
}

/**
 * Hit-test only the grid lines currently visible at `step`. Atlas borders remain
 * bounds, not selectable guides. The radius is capped below half a grid cell so
 * one click can never ambiguously claim two parallel lines while zoomed out.
 */
export function hitUvGridGuide(
  point: UvCanvasPoint,
  _atlasW: number,
  _atlasH: number,
  step: number,
  maxDistance: number,
): UvAxisGuide | null {
  const safeStep = Math.max(UV_LAYOUT_TUNING.vertexSnapTexels, integer(step));
  const radius = Math.min(
    Math.max(0, Number.isFinite(maxDistance) ? maxDistance : 0),
    safeStep * UV_LAYOUT_TUNING.guideHitCellFraction,
  );
  const verticalCoordinate = Math.round(point.x / safeStep) * safeStep;
  const horizontalCoordinate = Math.round(point.y / safeStep) * safeStep;
  const verticalDistance = Math.abs(point.x - verticalCoordinate);
  const horizontalDistance = Math.abs(point.y - horizontalCoordinate);
  return hitUvGuide(
    point,
    _atlasW,
    _atlasH,
    [
      ...(Number.isFinite(verticalDistance) ? [{ axis: 'vertical' as const, coordinate: verticalCoordinate }] : []),
      ...(Number.isFinite(horizontalDistance) ? [{ axis: 'horizontal' as const, coordinate: horizontalCoordinate }] : []),
    ],
    radius,
  );
}

/** Hit-test already-promoted guides even if a zoom or grid-step change hid their source line. */
export function hitUvGuide(
  point: UvCanvasPoint,
  _atlasW: number,
  _atlasH: number,
  guides: readonly UvAxisGuide[],
  maxDistance: number,
): UvAxisGuide | null {
  const tolerance = Math.max(0, Number.isFinite(maxDistance) ? maxDistance : 0);
  let best: { guide: UvAxisGuide; distance: number } | null = null;
  for (const guide of guides) {
    const distance = Math.abs((guide.axis === 'vertical' ? point.x : point.y) - guide.coordinate);
    if (distance > tolerance || (best && distance >= best.distance)) continue;
    best = { guide, distance };
  }
  return best?.guide ?? null;
}

/** Grid geometry for only the currently visible slice of the signed workspace. */
export function uvWorkspaceGridSegments(
  view: UvCanvasView,
  surfaceWidth: number,
  surfaceHeight: number,
  step: number,
): { minor: number[]; major: number[] } {
  if (!(surfaceWidth > 0) || !(surfaceHeight > 0) || !(view.scale > 0)) return { minor: [], major: [] };
  const safeStep = Math.max(UV_LAYOUT_TUNING.vertexSnapTexels, integer(step));
  const left = -view.x / view.scale;
  const top = -view.y / view.scale;
  const right = (surfaceWidth - view.x) / view.scale;
  const bottom = (surfaceHeight - view.y) / view.scale;
  const minor: number[] = [];
  const major: number[] = [];
  let emitted = 0;
  const firstX = Math.floor(left / safeStep) * safeStep;
  for (let x = firstX; x <= right && emitted < UV_LAYOUT_TUNING.maximumVisibleGridLines; x += safeStep, emitted += 1) {
    const target = Math.round(x / safeStep) % UV_LAYOUT_TUNING.majorGridEvery === 0 ? major : minor;
    target.push(x, top, x, bottom);
  }
  const firstY = Math.floor(top / safeStep) * safeStep;
  for (let y = firstY; y <= bottom && emitted < UV_LAYOUT_TUNING.maximumVisibleGridLines; y += safeStep, emitted += 1) {
    const target = Math.round(y / safeStep) % UV_LAYOUT_TUNING.majorGridEvery === 0 ? major : minor;
    target.push(left, y, right, y);
  }
  return { minor, major };
}

/** Click once to promote a grid line, and click the same line again to remove it. */
export function toggleUvGridGuide(guides: readonly UvAxisGuide[], guide: UvAxisGuide): UvAxisGuide[] {
  const found = guides.some((item) => item.axis === guide.axis && item.coordinate === guide.coordinate);
  if (found) return guides.filter((item) => item.axis !== guide.axis || item.coordinate !== guide.coordinate);
  return [...guides, guide].sort((left, right) => (
    (left.axis === right.axis ? 0 : left.axis === 'vertical' ? -1 : 1)
    || left.coordinate - right.coordinate
  ));
}

/**
 * Find the smallest translation that magnetically aligns a selection boundary,
 * centre, or point with the nearest selected guide on each axis.
 */
export function snapUvBoundsToGuides(
  bounds: UvSelectionBounds,
  guides: readonly UvAxisGuide[],
  maxDistance: number,
): UvGuideSnap {
  const tolerance = Math.max(0, Number.isFinite(maxDistance) ? maxDistance : 0);
  const xAnchors = [bounds.x, bounds.cx, bounds.x + bounds.w];
  const yAnchors = [bounds.y, bounds.cy, bounds.y + bounds.h];
  let bestX: { delta: number; guide: UvAxisGuide } | null = null;
  let bestY: { delta: number; guide: UvAxisGuide } | null = null;
  for (const guide of guides) {
    const anchors = guide.axis === 'vertical' ? xAnchors : yAnchors;
    for (const anchor of anchors) {
      const delta = guide.coordinate - anchor;
      if (Math.abs(delta) > tolerance) continue;
      if (guide.axis === 'vertical') {
        if (!bestX || Math.abs(delta) < Math.abs(bestX.delta)) bestX = { delta, guide };
      } else if (!bestY || Math.abs(delta) < Math.abs(bestY.delta)) {
        bestY = { delta, guide };
      }
    }
  }
  return {
    dx: bestX?.delta ?? 0,
    dy: bestY?.delta ?? 0,
    guides: [
      ...(bestX ? [bestX.guide] : []),
      ...(bestY ? [bestY.guide] : []),
    ],
  };
}

/**
 * Resolve one drag from its immutable seed: ordinary movement first lands on
 * the active grid, then its moved bounds may magnetically nudge to selected
 * guides. Alt-style free movement bypasses both in one boundary decision.
 */
export function snapUvTranslationToGridAndGuides(
  bounds: UvSelectionBounds,
  dx: number,
  dy: number,
  snapStep: number,
  guides: readonly UvAxisGuide[],
  guideDistance: number,
  freeMove = false,
): UvGuideSnap {
  if (freeMove) return { dx, dy, guides: [] };
  const gridDx = snapUvVertex(bounds.x + dx, snapStep) - bounds.x;
  const gridDy = snapUvVertex(bounds.y + dy, snapStep) - bounds.y;
  const movedBounds = {
    ...bounds,
    x: bounds.x + gridDx,
    y: bounds.y + gridDy,
    cx: bounds.cx + gridDx,
    cy: bounds.cy + gridDy,
  };
  const guideSnap = snapUvBoundsToGuides(movedBounds, guides, guideDistance);
  return {
    dx: gridDx + guideSnap.dx,
    dy: gridDy + guideSnap.dy,
    guides: guideSnap.guides,
  };
}

export function parseUvIslandRects(
  rects: readonly number[] | undefined,
  groups: readonly number[] | undefined,
  triangles?: readonly number[],
  cornerVertices?: readonly number[],
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
      const face = index / triangleStride;
      const vertexOffset = face * 3;
      const vertices = cornerVertices
        && Number.isInteger(cornerVertices[vertexOffset])
        && Number.isInteger(cornerVertices[vertexOffset + 1])
        && Number.isInteger(cornerVertices[vertexOffset + 2])
        ? [
          integer(cornerVertices[vertexOffset]) >>> 0,
          integer(cornerVertices[vertexOffset + 1]) >>> 0,
          integer(cornerVertices[vertexOffset + 2]) >>> 0,
        ] as const
        : undefined;
      if (local.length === 6) island.triangles!.push({
        // __model_atlas_read emits every face in render-face order. Keeping that
        // row identity is what lets a deformed triangle round-trip exactly.
        face,
        group,
        points: [local[0]!, local[1]!, local[2]!, local[3]!, local[4]!, local[5]!],
        ...(vertices ? { vertices } : {}),
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
  _atlasW: number,
  _atlasH: number,
  snapStep = UV_LAYOUT_TUNING.vertexSnapTexels,
  freeMove = false,
): UvIslandRect {
  const requestedX = rect.x + dx;
  const requestedY = rect.y + dy;
  const x = freeMove ? requestedX : snapUvVertex(requestedX, snapStep);
  const y = freeMove ? requestedY : snapUvVertex(requestedY, snapStep);
  if (x === rect.x && y === rect.y) return rect;
  return {
    ...rect,
    x,
    y,
  };
}

function uniqueUvIslandIndices(rects: readonly UvIslandRect[], indices: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= rects.length || seen.has(index)) continue;
    seen.add(index);
    out.push(index);
  }
  return out;
}

/** Aggregate transform frame for a temporary multi-island selection. Rect
 * bounds are intentional here: whole-island transforms translate that frame
 * without rewriting the exact triangle-local UV geometry inside it. */
export function uvIslandSetBounds(rects: readonly UvIslandRect[], indices: readonly number[]): UvSelectionBounds | null {
  const selected = uniqueUvIslandIndices(rects, indices);
  if (!selected.length) return null;
  let x = Number.POSITIVE_INFINITY;
  let y = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const index of selected) {
    const rect = rects[index]!;
    const bounds = uvSelectionBounds(rect) ?? {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      cx: rect.x + rect.w * 0.5,
      cy: rect.y + rect.h * 0.5,
    };
    x = Math.min(x, bounds.x);
    y = Math.min(y, bounds.y);
    right = Math.max(right, bounds.x + bounds.w);
    bottom = Math.max(bottom, bounds.y + bounds.h);
  }
  return { x, y, w: right - x, h: bottom - y, cx: (x + right) * 0.5, cy: (y + bottom) * 0.5 };
}

/** Translate a selected set as one rigid UV group in the signed workspace.
 * The texture rectangle is a sampling region, not a movement boundary. */
export function moveUvIslands(
  rects: readonly UvIslandRect[],
  indices: readonly number[],
  dx: number,
  dy: number,
  _atlasW: number,
  _atlasH: number,
  snapStep = UV_LAYOUT_TUNING.vertexSnapTexels,
  freeMove = false,
): UvIslandRect[] {
  const selected = uniqueUvIslandIndices(rects, indices);
  const bounds = uvIslandSetBounds(rects, selected);
  if (!bounds) return [...rects];
  const requestedX = bounds.x + dx;
  const requestedY = bounds.y + dy;
  const targetX = freeMove ? requestedX : snapUvVertex(requestedX, snapStep);
  const targetY = freeMove ? requestedY : snapUvVertex(requestedY, snapStep);
  const translatedX = targetX - bounds.x;
  const translatedY = targetY - bounds.y;
  if (Math.abs(translatedX) <= UV_LAYOUT_TUNING.pointMatchEpsilon && Math.abs(translatedY) <= UV_LAYOUT_TUNING.pointMatchEpsilon) return [...rects];
  const selectedSet = new Set(selected);
  return rects.map((rect, index) => selectedSet.has(index)
    ? { ...rect, x: rect.x + translatedX, y: rect.y + translatedY }
    : rect);
}

export type UvChainAxis = 'horizontal' | 'vertical';
export type UvChainResult = Readonly<{ rects: UvIslandRect[]; fits: boolean }>;

/** Place selected islands into a deterministic grid-aligned chain. Horizontal
 * chains sort left-to-right and share a top edge; vertical chains sort top-to-
 * bottom and share a left edge. Exact face UVs remain inside each moved frame. */
export function chainUvIslands(
  rects: readonly UvIslandRect[],
  indices: readonly number[],
  axis: UvChainAxis,
  atlasW: number,
  atlasH: number,
  snapStep = UV_LAYOUT_TUNING.vertexSnapTexels,
  gap = snapStep,
): UvChainResult {
  const selected = uniqueUvIslandIndices(rects, indices);
  const bounds = uvIslandSetBounds(rects, selected);
  if (!bounds || selected.length < 2) return { rects: [...rects], fits: false };
  const step = Math.max(UV_LAYOUT_TUNING.vertexSnapTexels, integer(snapStep));
  const safeGap = Math.max(0, integer(gap));
  const ordered = [...selected].sort((a, b) => {
    const left = rects[a]!;
    const right = rects[b]!;
    return axis === 'horizontal'
      ? left.x - right.x || left.y - right.y || a - b
      : left.y - right.y || left.x - right.x || a - b;
  });
  const offsets: number[] = [];
  let cursor = 0;
  for (let at = 0; at < ordered.length; at += 1) {
    const rect = rects[ordered[at]!]!;
    offsets.push(cursor);
    if (at < ordered.length - 1) {
      const extent = axis === 'horizontal' ? rect.w : rect.h;
      cursor = Math.ceil((cursor + extent + safeGap) / step) * step;
    }
  }
  const last = rects[ordered[ordered.length - 1]!]!;
  const chainExtent = cursor + (axis === 'horizontal' ? last.w : last.h);
  const available = axis === 'horizontal' ? atlasW : atlasH;
  if (chainExtent > available) return { rects: [...rects], fits: false };

  const maxStart = available - chainExtent;
  const requestedStart = axis === 'horizontal' ? bounds.x : bounds.y;
  const start = clamp(snapUvVertex(requestedStart, step), 0, Math.floor(maxStart / step) * step);
  const crossExtent = Math.max(...ordered.map((index) => axis === 'horizontal' ? rects[index]!.h : rects[index]!.w));
  const crossAvailable = axis === 'horizontal' ? atlasH : atlasW;
  if (crossExtent > crossAvailable) return { rects: [...rects], fits: false };
  const requestedCross = axis === 'horizontal' ? bounds.y : bounds.x;
  const maxCross = crossAvailable - crossExtent;
  const cross = clamp(snapUvVertex(requestedCross, step), 0, Math.floor(maxCross / step) * step);
  const placements = new Map<number, { x: number; y: number }>();
  ordered.forEach((index, at) => placements.set(index, axis === 'horizontal'
    ? { x: start + offsets[at]!, y: cross }
    : { x: cross, y: start + offsets[at]! }));
  return {
    fits: true,
    rects: rects.map((rect, index) => {
      const placement = placements.get(index);
      if (!placement || (placement.x === rect.x && placement.y === rect.y)) return rect;
      return { ...rect, ...placement };
    }),
  };
}

export function resizeUvIsland(rect: UvIslandRect, dw: number, dh: number, _atlasW: number, _atlasH: number): UvIslandRect {
  return {
    ...rect,
    w: Math.max(UV_LAYOUT_TUNING.minimumIslandTexels, integer(rect.w + dw)),
    h: Math.max(UV_LAYOUT_TUNING.minimumIslandTexels, integer(rect.h + dh)),
  };
}

export type UvResizeCorner = 'nw' | 'ne' | 'se' | 'sw';

/** Resize from any visible corner while keeping the opposite corner fixed. */
export function resizeUvIslandFromCorner(
  rect: UvIslandRect,
  corner: UvResizeCorner,
  dx: number,
  dy: number,
  _atlasW: number,
  _atlasH: number,
): UvIslandRect {
  const minSize = UV_LAYOUT_TUNING.minimumIslandTexels;
  const left = corner === 'nw' || corner === 'sw'
    ? Math.min(integer(rect.x + dx), rect.x + rect.w - minSize)
    : rect.x;
  const top = corner === 'nw' || corner === 'ne'
    ? Math.min(integer(rect.y + dy), rect.y + rect.h - minSize)
    : rect.y;
  const right = corner === 'ne' || corner === 'se'
    ? Math.max(integer(rect.x + rect.w + dx), rect.x + minSize)
    : rect.x + rect.w;
  const bottom = corner === 'se' || corner === 'sw'
    ? Math.max(integer(rect.y + rect.h + dy), rect.y + minSize)
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

type AbsoluteUvTriangle = {
  face: number;
  group: number;
  points: [number, number, number, number, number, number];
  vertices?: readonly [number, number, number];
};

const triangleMatchesTarget = (triangle: Pick<UvIslandTriangle, 'face' | 'group'>, target?: UvFaceTarget): boolean => (
  !target || (target.group !== NO_UV_GROUP ? triangle.group === target.group : triangle.face === target.face)
);

function absoluteTriangles(rect: UvIslandRect): AbsoluteUvTriangle[] {
  return (rect.triangles ?? []).map((triangle) => ({
    face: triangle.face,
    group: triangle.group,
    points: [...absoluteTrianglePoints(rect, triangle)] as AbsoluteUvTriangle['points'],
    ...(triangle.vertices ? { vertices: triangle.vertices } : {}),
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
  const x = Math.floor(lowX);
  const y = Math.floor(lowY);
  const right = Math.max(x + 1, Math.ceil(highX));
  const bottom = Math.max(y + 1, Math.ceil(highY));
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
      ...(triangle.vertices ? { vertices: triangle.vertices } : {}),
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

export type UvCornerIdentityMarker = {
  x: number;
  y: number;
  vertex: number;
};

/** Shared deterministic palette key for one welded mesh vertex. */
export function uvCornerIdentityColor(vertex: number): string {
  const hueDegrees = (Math.imul(integer(vertex) >>> 0, UV_LAYOUT_TUNING.cornerIdentityHueStepDegrees) >>> 0) % 360;
  const sector = Math.floor(hueDegrees / 60);
  const remainder = hueDegrees % 60;
  const chroma = UV_LAYOUT_TUNING.cornerIdentityChromaByte;
  const rising = Math.floor(chroma * remainder / 60);
  const falling = Math.floor(chroma * (60 - remainder) / 60);
  const x = sector % 2 === 0 ? rising : falling;
  const m = UV_LAYOUT_TUNING.cornerIdentityValueByte - chroma;
  const channels = sector === 0 ? [chroma, x, 0]
    : sector === 1 ? [x, chroma, 0]
      : sector === 2 ? [0, chroma, x]
        : sector === 3 ? [0, x, chroma]
          : sector === 4 ? [x, 0, chroma]
            : [chroma, 0, x];
  return `#${channels.map((channel) => (channel + m).toString(16).padStart(2, '0')).join('')}`;
}

/** Exact UV copies of every selected 3D face corner. A torn seam may expose one
 * welded vertex twice; both copies intentionally retain the same identity color. */
export function uvFaceCornerIdentityMarkers(
  rects: readonly UvIslandRect[],
  selectedFaces: readonly number[],
): UvCornerIdentityMarker[] {
  const selected = new Set(selectedFaces.filter((face) => Number.isInteger(face) && face >= 0));
  if (selected.size === 0 || selected.size > UV_LAYOUT_TUNING.cornerIdentityMaxFaceTriangles) return [];
  const rows: Array<{ rect: UvIslandRect; triangle: UvIslandTriangle }> = [];
  for (const rect of rects) {
    for (const triangle of rect.triangles ?? []) {
      if (selected.has(triangle.face)) rows.push({ rect, triangle });
    }
  }
  rows.sort((a, b) => a.triangle.face - b.triangle.face);
  const seen = new Set<string>();
  const markers: UvCornerIdentityMarker[] = [];
  for (const row of rows) {
    if (!row.triangle.vertices) continue;
    const points = absoluteTrianglePoints(row.rect, row.triangle);
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = row.triangle.vertices[corner];
      const x = points[corner * 2]!;
      const y = points[corner * 2 + 1]!;
      const key = `${vertex}:${Math.round(x / UV_LAYOUT_TUNING.pointMatchEpsilon)}:${Math.round(y / UV_LAYOUT_TUNING.pointMatchEpsilon)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push({ x, y, vertex });
    }
  }
  return markers;
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
  if (Math.abs(snappedDx) <= UV_LAYOUT_TUNING.pointMatchEpsilon && Math.abs(snappedDy) <= UV_LAYOUT_TUNING.pointMatchEpsilon) return rect;
  const triangles = absoluteTriangles(rect);
  translateAbsoluteSelection(triangles, target, snappedDx, snappedDy);
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
  return rebuildUvRect(rect, triangles, atlasW, atlasH);
}

export type UvSizeMatch = 'width' | 'height' | 'both';

function wholeIslandBounds(rect: UvIslandRect): UvSelectionBounds {
  return uvSelectionBounds(rect) ?? {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    cx: rect.x + rect.w * 0.5,
    cy: rect.y + rect.h * 0.5,
  };
}

/** Match every selected island to the active island's authored width, height,
 * or complete size. Each silhouette scales inside its own transform frame; the
 * atlas bitmap remains fixed. */
export function matchUvIslandSize(
  rects: readonly UvIslandRect[],
  indices: readonly number[],
  activeIndex: number,
  mode: UvSizeMatch,
  atlasW: number,
  atlasH: number,
): UvIslandRect[] {
  const selected = uniqueUvIslandIndices(rects, indices);
  if (selected.length < 2 || !selected.includes(activeIndex)) return [...rects];
  const active = rects[activeIndex];
  if (!active) return [...rects];
  const target = wholeIslandBounds(active);
  const selectedSet = new Set(selected);
  return rects.map((rect, index) => {
    if (!selectedSet.has(index) || index === activeIndex) return rect;
    const bounds = wholeIslandBounds(rect);
    const scaleX = mode === 'height' ? 1 : target.w / Math.max(UV_LAYOUT_TUNING.pointMatchEpsilon, bounds.w);
    const scaleY = mode === 'width' ? 1 : target.h / Math.max(UV_LAYOUT_TUNING.pointMatchEpsilon, bounds.h);
    if (Math.abs(scaleX - 1) <= UV_LAYOUT_TUNING.pointMatchEpsilon && Math.abs(scaleY - 1) <= UV_LAYOUT_TUNING.pointMatchEpsilon) return rect;
    if (rect.triangles?.length) return scaleUvSelection(rect, undefined, scaleX, scaleY, atlasW, atlasH);
    const width = Math.max(UV_LAYOUT_TUNING.minimumIslandTexels, rect.w * scaleX);
    const height = Math.max(UV_LAYOUT_TUNING.minimumIslandTexels, rect.h * scaleY);
    return {
      ...rect,
      w: width,
      h: height,
    };
  });
}

export type UvStackResult = Readonly<{
  rects: UvIslandRect[];
  compatible: number;
  skipped: number;
}>;

const sameTrianglePoints = (left: UvTrianglePoints, right: UvTrianglePoints): boolean => (
  left.every((value, index) => value === right[index])
);

/**
 * Copy the active island's exact triangle-corner coordinates onto every compatible
 * selected island. This deliberately does not join mesh topology: source face rows,
 * authored groups, and welded vertex identities remain independently selectable,
 * while their UV coordinates become byte-for-byte the active footprint.
 *
 * Islands with different render-triangle counts are not approximately scaled into
 * place. They are left unchanged and reported to the caller as incompatible.
 */
export function stackUvIslands(
  rects: readonly UvIslandRect[],
  indices: readonly number[],
  activeIndex: number,
): UvStackResult {
  const selected = uniqueUvIslandIndices(rects, indices);
  if (selected.length < 2 || !selected.includes(activeIndex)) {
    return { rects: [...rects], compatible: 0, skipped: 0 };
  }
  const active = rects[activeIndex];
  if (!active) return { rects: [...rects], compatible: 0, skipped: 0 };
  const activeTriangles = active.triangles ?? [];
  const selectedSet = new Set(selected);
  let compatible = 0;
  let skipped = 0;
  const next = rects.map((rect, index) => {
    if (!selectedSet.has(index) || index === activeIndex) return rect;
    const sourceTriangles = rect.triangles ?? [];
    if (sourceTriangles.length !== activeTriangles.length) {
      skipped += 1;
      return rect;
    }
    compatible += 1;
    const unchanged = rect.x === active.x
      && rect.y === active.y
      && rect.w === active.w
      && rect.h === active.h
      && sourceTriangles.every((triangle, triangleIndex) => (
        sameTrianglePoints(triangle.points, activeTriangles[triangleIndex]!.points)
      ));
    if (unchanged) return rect;
    if (sourceTriangles.length === 0) {
      return { ...rect, x: active.x, y: active.y, w: active.w, h: active.h };
    }
    return {
      ...rect,
      x: active.x,
      y: active.y,
      w: active.w,
      h: active.h,
      triangles: sourceTriangles.map((triangle, triangleIndex) => ({
        ...triangle,
        points: [
          activeTriangles[triangleIndex]!.points[0],
          activeTriangles[triangleIndex]!.points[1],
          activeTriangles[triangleIndex]!.points[2],
          activeTriangles[triangleIndex]!.points[3],
          activeTriangles[triangleIndex]!.points[4],
          activeTriangles[triangleIndex]!.points[5],
        ],
      })),
    };
  });
  return { rects: next, compatible, skipped };
}

export type UvStitchResult = Readonly<{
  rects: UvIslandRect[];
  /** Selected islands fitted into the active island's connected seam component. */
  stitched: number;
  /** Selected islands with no welded boundary identity in the active component. */
  unmatched: number;
  /** Matching islands whose exact seam fit would be degenerate or explode in scale. */
  blocked: number;
  seamEdges: number;
  seamVertices: number;
  /** Number of indexed island-pair fits evaluated by this sweep. */
  evaluatedCandidates: number;
}>;

type UvStitchPoint = Readonly<{ vertex: number; x: number; y: number }>;
type UvStitchEdge = Readonly<{
  topologyKey: string;
  a: UvStitchPoint;
  b: UvStitchPoint;
}>;
type UvBoundaryTopology = Readonly<{
  edges: Map<string, UvStitchEdge[]>;
  vertices: Map<number, UvStitchPoint[]>;
}>;
type UvStitchPair = Readonly<{ source: UvStitchPoint; target: UvStitchPoint }>;
type UvStitchCandidate = Readonly<{
  moving: number;
  fixed: number;
  pairs: UvStitchPair[];
  seamEdges: number;
  seamVertices: number;
}>;
type UvStitchRelation = {
  edges: Set<string>;
  vertices: Set<number>;
};

const stitchCoordinateKey = (value: number): number => Math.round(value / UV_LAYOUT_TUNING.pointMatchEpsilon);
const stitchPointKey = (point: UvStitchPoint): string => (
  `${point.vertex}:${stitchCoordinateKey(point.x)}:${stitchCoordinateKey(point.y)}`
);
const stitchEdgeCoordinateKey = (a: UvStitchPoint, b: UvStitchPoint): string => {
  const ak = `${stitchCoordinateKey(a.x)},${stitchCoordinateKey(a.y)}`;
  const bk = `${stitchCoordinateKey(b.x)},${stitchCoordinateKey(b.y)}`;
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
};
const stitchTopologyEdgeKey = (a: number, b: number): string => (
  a < b ? `${a}:${b}` : `${b}:${a}`
);

/**
 * Recover only the topology boundary carried by welded vertex identities.
 * Internal render diagonals and connected face edges occur twice at the same
 * UV coordinates and cancel. A UV seam survives once on each separate island.
 */
function uvBoundaryTopology(rect: UvIslandRect): UvBoundaryTopology {
  const rows = new Map<string, { count: number; edge: UvStitchEdge }>();
  for (const triangle of rect.triangles ?? []) {
    if (!triangle.vertices) continue;
    const points = absoluteTrianglePoints(rect, triangle);
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const nextIndex = (edgeIndex + 1) % 3;
      const a: UvStitchPoint = {
        vertex: triangle.vertices[edgeIndex]!,
        x: points[edgeIndex * 2]!,
        y: points[edgeIndex * 2 + 1]!,
      };
      const b: UvStitchPoint = {
        vertex: triangle.vertices[nextIndex]!,
        x: points[nextIndex * 2]!,
        y: points[nextIndex * 2 + 1]!,
      };
      if (a.vertex === b.vertex) continue;
      const topologyKey = stitchTopologyEdgeKey(a.vertex, b.vertex);
      const rowKey = `${topologyKey}|${stitchEdgeCoordinateKey(a, b)}`;
      const existing = rows.get(rowKey);
      if (existing) existing.count += 1;
      else rows.set(rowKey, { count: 1, edge: { topologyKey, a, b } });
    }
  }

  const edges = new Map<string, UvStitchEdge[]>();
  const vertices = new Map<number, UvStitchPoint[]>();
  const seenVertices = new Set<string>();
  for (const row of rows.values()) {
    if (row.count !== 1) continue;
    const matches = edges.get(row.edge.topologyKey);
    if (matches) matches.push(row.edge);
    else edges.set(row.edge.topologyKey, [row.edge]);
    for (const point of [row.edge.a, row.edge.b]) {
      const key = stitchPointKey(point);
      if (seenVertices.has(key)) continue;
      seenVertices.add(key);
      const points = vertices.get(point.vertex);
      if (points) points.push(point);
      else vertices.set(point.vertex, [point]);
    }
  }
  for (const matches of edges.values()) matches.sort((left, right) => (
    stitchEdgeCoordinateKey(left.a, left.b).localeCompare(stitchEdgeCoordinateKey(right.a, right.b))
  ));
  for (const points of vertices.values()) points.sort((left, right) => (
    left.x - right.x || left.y - right.y
  ));
  return { edges, vertices };
}

function matchingEdgePair(
  sourceEdges: readonly UvStitchEdge[],
  targetEdges: readonly UvStitchEdge[],
): Readonly<{ source: UvStitchEdge; target: UvStitchEdge }> | null {
  let best: { source: UvStitchEdge; target: UvStitchEdge; densityDelta: number } | null = null;
  for (const source of sourceEdges) {
    const sourceLength = Math.hypot(source.b.x - source.a.x, source.b.y - source.a.y);
    if (sourceLength <= UV_LAYOUT_TUNING.pointMatchEpsilon) continue;
    for (const target of targetEdges) {
      const targetLength = Math.hypot(target.b.x - target.a.x, target.b.y - target.a.y);
      if (targetLength <= UV_LAYOUT_TUNING.pointMatchEpsilon) continue;
      const densityDelta = Math.abs(Math.log(targetLength / sourceLength));
      if (!best || densityDelta < best.densityDelta) best = { source, target, densityDelta };
    }
  }
  return best;
}

function endpointForVertex(edge: UvStitchEdge, vertex: number): UvStitchPoint | null {
  if (edge.a.vertex === vertex) return edge.a;
  if (edge.b.vertex === vertex) return edge.b;
  return null;
}

function stitchCandidate(
  moving: number,
  fixed: number,
  source: UvBoundaryTopology,
  target: UvBoundaryTopology,
  relation: UvStitchRelation,
): UvStitchCandidate | null {
  const pairs = new Map<string, UvStitchPair>();
  let seamEdges = 0;
  const topologyKeys = [...relation.edges].sort();
  for (const topologyKey of topologyKeys) {
    const sourceEdges = source.edges.get(topologyKey);
    const targetEdges = target.edges.get(topologyKey);
    if (!sourceEdges || !targetEdges) continue;
    const match = matchingEdgePair(sourceEdges, targetEdges);
    if (!match) continue;
    seamEdges += 1;
    for (const sourcePoint of [match.source.a, match.source.b]) {
      const targetPoint = endpointForVertex(match.target, sourcePoint.vertex);
      if (!targetPoint) continue;
      const key = stitchPointKey(sourcePoint);
      const existing = pairs.get(key);
      if (!existing || stitchPointKey(targetPoint) < stitchPointKey(existing.target)) {
        pairs.set(key, { source: sourcePoint, target: targetPoint });
      }
    }
  }

  // Pole tips and deliberately point-cut pieces share no complete edge. When
  // each island exposes exactly one copy of the welded boundary vertex, a pure
  // translation is still unambiguous and useful.
  if (pairs.size === 0) {
    const sharedVertices = [...relation.vertices].sort((a, b) => a - b);
    for (const vertex of sharedVertices) {
      const sourcePoints = source.vertices.get(vertex);
      const targetPoints = target.vertices.get(vertex);
      if (!sourcePoints || !targetPoints) continue;
      if (sourcePoints.length !== 1 || targetPoints.length !== 1) continue;
      pairs.set(stitchPointKey(sourcePoints[0]!), { source: sourcePoints[0]!, target: targetPoints[0]! });
    }
  }
  if (pairs.size === 0) return null;
  const orderedPairs = [...pairs.values()].sort((left, right) => (
    left.source.vertex - right.source.vertex
    || left.source.x - right.source.x
    || left.source.y - right.source.y
  ));
  return {
    moving,
    fixed,
    pairs: orderedPairs,
    seamEdges,
    seamVertices: new Set(orderedPairs.map((pair) => pair.source.vertex)).size,
  };
}

function stitchRelations(
  selected: readonly number[],
  topologies: ReadonlyMap<number, UvBoundaryTopology>,
): Map<number, Map<number, UvStitchRelation>> {
  const edgeOwners = new Map<string, number[]>();
  const vertexOwners = new Map<number, number[]>();
  for (const index of selected) {
    const topology = topologies.get(index);
    if (!topology) continue;
    for (const edge of topology.edges.keys()) {
      const owners = edgeOwners.get(edge);
      if (owners) owners.push(index);
      else edgeOwners.set(edge, [index]);
    }
    for (const vertex of topology.vertices.keys()) {
      const owners = vertexOwners.get(vertex);
      if (owners) owners.push(index);
      else vertexOwners.set(vertex, [index]);
    }
  }

  const relations = new Map<number, Map<number, UvStitchRelation>>();
  const relationFor = (left: number, right: number): UvStitchRelation => {
    let neighbours = relations.get(left);
    if (!neighbours) {
      neighbours = new Map();
      relations.set(left, neighbours);
    }
    const existing = neighbours.get(right);
    if (existing) return existing;
    const relation = { edges: new Set<string>(), vertices: new Set<number>() };
    neighbours.set(right, relation);
    let reverse = relations.get(right);
    if (!reverse) {
      reverse = new Map();
      relations.set(right, reverse);
    }
    reverse.set(left, relation);
    return relation;
  };

  for (const [edge, owners] of edgeOwners) {
    if (owners.length !== UV_LAYOUT_TUNING.stitchUnambiguousOwnerCount) continue;
    relationFor(owners[0]!, owners[1]!).edges.add(edge);
  }
  for (const [vertex, owners] of vertexOwners) {
    if (owners.length !== UV_LAYOUT_TUNING.stitchUnambiguousOwnerCount) continue;
    relationFor(owners[0]!, owners[1]!).vertices.add(vertex);
  }
  return relations;
}

function stitchCandidateHasPriority(left: UvStitchCandidate, right: UvStitchCandidate): boolean {
  if (left.seamEdges !== right.seamEdges) return left.seamEdges > right.seamEdges;
  if (left.seamVertices !== right.seamVertices) return left.seamVertices > right.seamVertices;
  if (left.moving !== right.moving) return left.moving < right.moving;
  return left.fixed < right.fixed;
}

function pushStitchCandidate(heap: UvStitchCandidate[], candidate: UvStitchCandidate): void {
  heap.push(candidate);
  let child = heap.length - 1;
  while (child > 0) {
    const parent = Math.floor((child - 1) / 2);
    if (!stitchCandidateHasPriority(heap[child]!, heap[parent]!)) break;
    [heap[parent], heap[child]] = [heap[child]!, heap[parent]!];
    child = parent;
  }
}

function popStitchCandidate(heap: UvStitchCandidate[]): UvStitchCandidate | null {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last) return first ?? null;
  if (heap.length === 0) return first;
  heap[0] = last;
  let parent = 0;
  while (true) {
    const left = parent * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && stitchCandidateHasPriority(heap[right]!, heap[left]!)
      ? right
      : left;
    if (!stitchCandidateHasPriority(heap[child]!, heap[parent]!)) break;
    [heap[parent], heap[child]] = [heap[child]!, heap[parent]!];
    parent = child;
  }
  return first;
}

type UvSimilarity = Readonly<{ a: number; b: number; tx: number; ty: number }>;

function stitchSimilarity(pairs: readonly UvStitchPair[]): UvSimilarity | null {
  if (pairs.length === 0) return null;
  if (pairs.length === 1) {
    const pair = pairs[0]!;
    return {
      a: 1,
      b: 0,
      tx: pair.target.x - pair.source.x,
      ty: pair.target.y - pair.source.y,
    };
  }
  let sourceX = 0;
  let sourceY = 0;
  let targetX = 0;
  let targetY = 0;
  for (const pair of pairs) {
    sourceX += pair.source.x;
    sourceY += pair.source.y;
    targetX += pair.target.x;
    targetY += pair.target.y;
  }
  sourceX /= pairs.length;
  sourceY /= pairs.length;
  targetX /= pairs.length;
  targetY /= pairs.length;
  let numeratorA = 0;
  let numeratorB = 0;
  let denominator = 0;
  for (const pair of pairs) {
    const sx = pair.source.x - sourceX;
    const sy = pair.source.y - sourceY;
    const tx = pair.target.x - targetX;
    const ty = pair.target.y - targetY;
    numeratorA += sx * tx + sy * ty;
    numeratorB += sx * ty - sy * tx;
    denominator += sx * sx + sy * sy;
  }
  if (denominator <= UV_LAYOUT_TUNING.pointMatchEpsilon) {
    return { a: 1, b: 0, tx: targetX - sourceX, ty: targetY - sourceY };
  }
  const a = numeratorA / denominator;
  const b = numeratorB / denominator;
  const scale = Math.hypot(a, b);
  if (!Number.isFinite(scale)
    || scale < UV_LAYOUT_TUNING.stitchMinimumScale
    || scale > UV_LAYOUT_TUNING.stitchMaximumScale) return null;
  return {
    a,
    b,
    tx: targetX - (a * sourceX - b * sourceY),
    ty: targetY - (b * sourceX + a * sourceY),
  };
}

function stitchIslandToCandidate(
  rect: UvIslandRect,
  candidate: UvStitchCandidate,
  atlasW: number,
  atlasH: number,
): UvIslandRect | null {
  const similarity = stitchSimilarity(candidate.pairs);
  if (!similarity || !rect.triangles?.length) return null;
  const overrides = new Map(candidate.pairs.map((pair) => [stitchPointKey(pair.source), pair.target] as const));
  const triangles = absoluteTriangles(rect);
  let changed = false;
  for (const triangle of triangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      const at = corner * 2;
      const sourceX = triangle.points[at]!;
      const sourceY = triangle.points[at + 1]!;
      const vertex = triangle.vertices?.[corner];
      const override = vertex === undefined ? undefined : overrides.get(stitchPointKey({ vertex, x: sourceX, y: sourceY }));
      const targetX = override?.x ?? similarity.a * sourceX - similarity.b * sourceY + similarity.tx;
      const targetY = override?.y ?? similarity.b * sourceX + similarity.a * sourceY + similarity.ty;
      if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return null;
      changed ||= Math.abs(targetX - sourceX) > UV_LAYOUT_TUNING.pointMatchEpsilon
        || Math.abs(targetY - sourceY) > UV_LAYOUT_TUNING.pointMatchEpsilon;
      triangle.points[at] = targetX;
      triangle.points[at + 1] = targetY;
    }
  }
  return changed ? rebuildUvRect(rect, triangles, atlasW, atlasH) : rect;
}

/**
 * Join a selected UV seam without proximity guessing. The active island stays
 * fixed; every selected island reachable through matching welded boundary
 * identities is fitted in deterministic graph order. Complete shared edges
 * define rotation and scale, while their endpoint copies are made exact so the
 * host can reconstruct one connected island on commit.
 */
export function stitchUvIslands(
  rects: readonly UvIslandRect[],
  indices: readonly number[],
  activeIndex: number,
  atlasW: number,
  atlasH: number,
): UvStitchResult {
  const selected = uniqueUvIslandIndices(rects, indices);
  if (selected.length < 2 || !selected.includes(activeIndex) || atlasW < 1 || atlasH < 1) {
    return {
      rects: [...rects],
      stitched: 0,
      unmatched: Math.max(0, selected.length - 1),
      blocked: 0,
      seamEdges: 0,
      seamVertices: 0,
      evaluatedCandidates: 0,
    };
  }
  const next = [...rects];
  const topologies = new Map<number, UvBoundaryTopology>();
  for (const index of selected) topologies.set(index, uvBoundaryTopology(next[index]!));
  const relations = stitchRelations(selected, topologies);
  const fixed = new Set<number>([activeIndex]);
  const remaining = new Set(selected.filter((index) => index !== activeIndex));
  const matchedIdentity = new Set<number>();
  const candidates: UvStitchCandidate[] = [];
  let stitched = 0;
  let seamEdges = 0;
  let seamVertices = 0;
  let evaluatedCandidates = 0;

  const enqueueNeighbours = (fixedIndex: number) => {
    const target = topologies.get(fixedIndex);
    if (!target) return;
    for (const [moving, relation] of relations.get(fixedIndex) ?? []) {
      if (!remaining.has(moving)) continue;
      const source = topologies.get(moving);
      if (!source) continue;
      evaluatedCandidates += 1;
      const candidate = stitchCandidate(moving, fixedIndex, source, target, relation);
      if (!candidate) continue;
      matchedIdentity.add(moving);
      pushStitchCandidate(candidates, candidate);
    }
  };

  enqueueNeighbours(activeIndex);
  while (candidates.length > 0) {
    const candidate = popStitchCandidate(candidates);
    if (!candidate || !fixed.has(candidate.fixed) || !remaining.has(candidate.moving)) continue;
    const changed = stitchIslandToCandidate(next[candidate.moving]!, candidate, atlasW, atlasH);
    if (!changed) continue;
    next[candidate.moving] = changed;
    topologies.set(candidate.moving, uvBoundaryTopology(changed));
    fixed.add(candidate.moving);
    remaining.delete(candidate.moving);
    stitched += 1;
    seamEdges += candidate.seamEdges;
    seamVertices += candidate.seamVertices;
    enqueueNeighbours(candidate.moving);
  }

  let blocked = 0;
  let unmatched = 0;
  for (const moving of remaining) {
    if (matchedIdentity.has(moving)) blocked += 1;
    else unmatched += 1;
  }
  return { rects: next, stitched, unmatched, blocked, seamEdges, seamVertices, evaluatedCandidates };
}

export type UvTransformFrame = Readonly<{ x: number; y: number; w: number; h: number }>;

/** Apply a copied transform frame (position + size) onto one island or one isolated
 * face (req_3427 Copy/Paste Transform): the selection scales to the frame's width and
 * height, then its north-west corner lands on the frame's signed workspace origin.
 * Texture pixels never move — only sampling coordinates. */
export function pasteUvTransform(
  rect: UvIslandRect,
  target: UvFaceTarget | undefined,
  frame: UvTransformFrame,
  atlasW: number,
  atlasH: number,
): UvIslandRect {
  if (!(frame.w > 0) || !(frame.h > 0) || atlasW < 1 || atlasH < 1) return rect;
  const bounds = target ? uvSelectionBounds(rect, target) : wholeIslandBounds(rect);
  if (!bounds) return rect;
  if (!target && !rect.triangles?.length) {
    const width = Math.max(frame.w, UV_LAYOUT_TUNING.minimumIslandTexels);
    const height = Math.max(frame.h, UV_LAYOUT_TUNING.minimumIslandTexels);
    return { ...rect, x: frame.x, y: frame.y, w: width, h: height };
  }
  const scaleX = frame.w / Math.max(UV_LAYOUT_TUNING.pointMatchEpsilon, bounds.w);
  const scaleY = frame.h / Math.max(UV_LAYOUT_TUNING.pointMatchEpsilon, bounds.h);
  const scaled = scaleUvSelection(rect, target, scaleX, scaleY, atlasW, atlasH);
  const scaledBounds = target ? uvSelectionBounds(scaled, target) : wholeIslandBounds(scaled);
  if (!scaledBounds) return scaled;
  const triangles = absoluteTriangles(scaled);
  translateAbsoluteSelection(triangles, target, frame.x - scaledBounds.x, frame.y - scaledBounds.y);
  return rebuildUvRect(scaled, triangles, atlasW, atlasH);
}

/** Reflect a complete island or one authored face through its own transform
 * center. Rotation cannot change UV handedness; this is the operation that
 * makes mirrored text and logos read forward without moving texture pixels. */
export function flipUvSelection(
  rect: UvIslandRect,
  target: UvFaceTarget | undefined,
  axis: UvFlipAxis,
  atlasW: number,
  atlasH: number,
): UvIslandRect {
  const bounds = uvSelectionBounds(rect, target);
  if (!bounds) return rect;
  const triangles = absoluteTriangles(rect);
  for (const triangle of triangles) {
    if (!triangleMatchesTarget(triangle, target)) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const at = corner * 2;
      if (axis === 'u') triangle.points[at] = bounds.cx * 2 - triangle.points[at]!;
      else triangle.points[at + 1] = bounds.cy * 2 - triangle.points[at + 1]!;
    }
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

  const rotatedBounds = uvSelectionBounds(rebuildUvRect(rect, triangles, atlasW, atlasH), target);
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
  const requestedX = selected.x + dx;
  const requestedY = selected.y + dy;
  const targetX = freeMove ? requestedX : snapUvVertex(requestedX, snapStep);
  const targetY = freeMove ? requestedY : snapUvVertex(requestedY, snapStep);
  if (sameUvPoint(targetX, targetY, selected.x, selected.y)) return rect;

  const absolute = rect.triangles.map((triangle) => {
    const points = [...absoluteTrianglePoints(rect, triangle)] as [number, number, number, number, number, number];
    const identity = triangle.vertices ? { vertices: triangle.vertices } : {};
    if (!triangleMatchesTarget(triangle, target)) return { face: triangle.face, group: triangle.group, points, ...identity };
    for (let corner = 0; corner < 3; corner += 1) {
      const at = corner * 2;
      if (!sameUvPoint(points[at]!, points[at + 1]!, selected.x, selected.y)) continue;
      points[at] = targetX;
      points[at + 1] = targetY;
    }
    return { face: triangle.face, group: triangle.group, points, ...identity };
  });

  return rebuildUvRect(rect, absolute, atlasW, atlasH);
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
  const epsilon = UV_LAYOUT_TUNING.geometryEpsilon;
  const hasNegative = d0 < -epsilon || d1 < -epsilon || d2 < -epsilon;
  const hasPositive = d0 > epsilon || d1 > epsilon || d2 > epsilon;
  return !(hasNegative && hasPositive);
}

type UvMarqueeBounds = Readonly<{ left: number; top: number; right: number; bottom: number }>;

const marqueeBounds = (start: UvCanvasPoint, end: UvCanvasPoint): UvMarqueeBounds => ({
  left: Math.min(start.x, end.x),
  top: Math.min(start.y, end.y),
  right: Math.max(start.x, end.x),
  bottom: Math.max(start.y, end.y),
});

const boundsOverlap = (a: UvMarqueeBounds, b: UvMarqueeBounds): boolean => (
  a.left <= b.right + UV_LAYOUT_TUNING.geometryEpsilon
  && a.right + UV_LAYOUT_TUNING.geometryEpsilon >= b.left
  && a.top <= b.bottom + UV_LAYOUT_TUNING.geometryEpsilon
  && a.bottom + UV_LAYOUT_TUNING.geometryEpsilon >= b.top
);

const pointInMarquee = (bounds: UvMarqueeBounds, x: number, y: number): boolean => (
  x >= bounds.left - UV_LAYOUT_TUNING.geometryEpsilon
  && x <= bounds.right + UV_LAYOUT_TUNING.geometryEpsilon
  && y >= bounds.top - UV_LAYOUT_TUNING.geometryEpsilon
  && y <= bounds.bottom + UV_LAYOUT_TUNING.geometryEpsilon
);

function uvSegmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const firstBounds = marqueeBounds({ x: ax, y: ay }, { x: bx, y: by });
  const secondBounds = marqueeBounds({ x: cx, y: cy }, { x: dx, y: dy });
  if (!boundsOverlap(firstBounds, secondBounds)) return false;
  const cross = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number => (
    (qx - px) * (ry - py) - (qy - py) * (rx - px)
  );
  const abC = cross(ax, ay, bx, by, cx, cy);
  const abD = cross(ax, ay, bx, by, dx, dy);
  const cdA = cross(cx, cy, dx, dy, ax, ay);
  const cdB = cross(cx, cy, dx, dy, bx, by);
  const epsilon = UV_LAYOUT_TUNING.geometryEpsilon;
  if ((abC > epsilon && abD > epsilon) || (abC < -epsilon && abD < -epsilon)) return false;
  if ((cdA > epsilon && cdB > epsilon) || (cdA < -epsilon && cdB < -epsilon)) return false;
  return true;
}

function triangleIntersectsMarquee(triangle: UvTrianglePoints, bounds: UvMarqueeBounds): boolean {
  const triangleBounds: UvMarqueeBounds = {
    left: Math.min(triangle[0], triangle[2], triangle[4]),
    top: Math.min(triangle[1], triangle[3], triangle[5]),
    right: Math.max(triangle[0], triangle[2], triangle[4]),
    bottom: Math.max(triangle[1], triangle[3], triangle[5]),
  };
  if (!boundsOverlap(triangleBounds, bounds)) return false;
  for (let corner = 0; corner < 3; corner += 1) {
    if (pointInMarquee(bounds, triangle[corner * 2]!, triangle[corner * 2 + 1]!)) return true;
  }
  const marqueeCorners = [
    bounds.left, bounds.top,
    bounds.right, bounds.top,
    bounds.right, bounds.bottom,
    bounds.left, bounds.bottom,
  ] as const;
  for (let corner = 0; corner < 4; corner += 1) {
    if (pointInTriangle(triangle, marqueeCorners[corner * 2]!, marqueeCorners[corner * 2 + 1]!)) return true;
  }
  const marqueeEdges = [
    bounds.left, bounds.top, bounds.right, bounds.top,
    bounds.right, bounds.top, bounds.right, bounds.bottom,
    bounds.right, bounds.bottom, bounds.left, bounds.bottom,
    bounds.left, bounds.bottom, bounds.left, bounds.top,
  ] as const;
  for (let triangleEdge = 0; triangleEdge < 3; triangleEdge += 1) {
    const nextCorner = (triangleEdge + 1) % 3;
    for (let marqueeEdge = 0; marqueeEdge < 4; marqueeEdge += 1) {
      if (uvSegmentsIntersect(
        triangle[triangleEdge * 2]!,
        triangle[triangleEdge * 2 + 1]!,
        triangle[nextCorner * 2]!,
        triangle[nextCorner * 2 + 1]!,
        marqueeEdges[marqueeEdge * 4]!,
        marqueeEdges[marqueeEdge * 4 + 1]!,
        marqueeEdges[marqueeEdge * 4 + 2]!,
        marqueeEdges[marqueeEdge * 4 + 3]!,
      )) return true;
    }
  }
  return false;
}

/**
 * Return every UV island whose actual authored triangle silhouette crosses an
 * inclusive signed-workspace marquee. Legacy rectangle-only rows retain a
 * rectangular fallback, but triangle-backed islands never select through empty
 * space inside a rotated or narrow bounding box.
 */
export function uvIslandsIntersectingMarquee(
  rects: readonly UvIslandRect[],
  start: UvCanvasPoint,
  end: UvCanvasPoint,
): number[] {
  const bounds = marqueeBounds(start, end);
  const hits: number[] = [];
  rects.forEach((rect, index) => {
    const rectBounds = marqueeBounds(
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
    );
    if (!boundsOverlap(rectBounds, bounds)) return;
    if (rect.triangles?.length) {
      if (!rect.triangles.some((triangle) => triangleIntersectsMarquee(absoluteTrianglePoints(rect, triangle), bounds))) return;
    }
    hits.push(index);
  });
  return hits;
}

/** Smallest actual silhouette wins, so empty triangle bounds never masquerade as UVs. */
export function hitUvIsland(rects: readonly UvIslandRect[], x: number, y: number): number {
  let hit = -1;
  let area = Number.POSITIVE_INFINITY;
  rects.forEach((rect, index) => {
    if (rect.triangles?.length) {
      if (!rect.triangles.some((triangle) => pointInTriangle(absoluteTrianglePoints(rect, triangle), x, y))) return;
    } else if (x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h) {
      return;
    }
    const bounds = uvSelectionBounds(rect);
    const nextArea = bounds ? bounds.w * bounds.h : rect.w * rect.h;
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
export function uniformUvPack(
  rects: readonly UvIslandRect[],
  atlasW: number,
  atlasH: number,
  originX = 0,
  originY = 0,
): UvIslandRect[] {
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
      x: originX + column * cellW,
      y: originY + row * cellH,
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
