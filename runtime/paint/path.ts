// Shared pen-path geometry. Paint fills and mesh-plane authoring both consume
// the same flattened polygon, so their preview and committed edge can never
// disagree about what the user drew.

export const PEN_PATH_TUNING = {
  maxAnchors: 32,
  maxPolygonPoints: 64,
  curveStepPx: 12,
  maxCurveSteps: 16,
  anchorHitPx: 10,
  handleHitPx: 9,
} as const;

export type PenPoint = { x: number; y: number };

/** Absolute local-surface coordinates. Missing handles mean a sharp corner. */
export type PenAnchor = PenPoint & {
  in?: PenPoint;
  out?: PenPoint;
};

function finitePoint(point: PenPoint | undefined): point is PenPoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointAtCubic(a: PenPoint, c1: PenPoint, c2: PenPoint, b: PenPoint, t: number): PenPoint {
  const it = 1 - t;
  const aa = it * it * it;
  const bb = 3 * it * it * t;
  const cc = 3 * it * t * t;
  const dd = t * t * t;
  return {
    x: a.x * aa + c1.x * bb + c2.x * cc + b.x * dd,
    y: a.y * aa + c1.y * bb + c2.y * cc + b.y * dd,
  };
}

function segmentEstimate(a: PenAnchor, b: PenAnchor): number {
  const c1 = finitePoint(a.out) ? a.out : a;
  const c2 = finitePoint(b.in) ? b.in : b;
  return Math.hypot(c1.x - a.x, c1.y - a.y)
    + Math.hypot(c2.x - c1.x, c2.y - c1.y)
    + Math.hypot(b.x - c2.x, b.y - c2.y);
}

function resampleOpen(points: readonly PenPoint[], count: number): PenPoint[] {
  if (points.length <= count) return points.map((point) => ({ ...point }));
  const distances = new Array<number>(points.length).fill(0);
  for (let index = 1; index < points.length; index += 1) {
    distances[index] = distances[index - 1]! + Math.hypot(
      points[index]!.x - points[index - 1]!.x,
      points[index]!.y - points[index - 1]!.y,
    );
  }
  const total = distances[distances.length - 1]!;
  if (total <= 1e-6) return points.slice(0, count).map((point) => ({ ...point }));
  const result: PenPoint[] = [];
  let segment = 1;
  for (let sample = 0; sample < count; sample += 1) {
    const target = (sample / Math.max(1, count - 1)) * total;
    while (segment < distances.length - 1 && distances[segment]! < target) segment += 1;
    const before = distances[segment - 1]!;
    const after = distances[segment]!;
    const amount = after > before ? (target - before) / (after - before) : 0;
    const a = points[segment - 1]!;
    const b = points[segment]!;
    result.push({ x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount });
  }
  return result;
}

/** Flatten the exact displayed cubic path into a bounded polygon. The closing
 * endpoint is omitted because every consumer closes the polygon itself. */
export function flattenClosedPenPath(
  anchors: readonly PenAnchor[],
  maxPoints = PEN_PATH_TUNING.maxPolygonPoints,
): PenPoint[] {
  if (anchors.length < 3 || maxPoints < 3) return [];
  const dense: PenPoint[] = [{ x: anchors[0]!.x, y: anchors[0]!.y }];
  for (let index = 0; index < anchors.length; index += 1) {
    const a = anchors[index]!;
    const b = anchors[(index + 1) % anchors.length]!;
    const c1 = finitePoint(a.out) ? a.out : a;
    const c2 = finitePoint(b.in) ? b.in : b;
    const steps = Math.max(1, Math.min(
      PEN_PATH_TUNING.maxCurveSteps,
      Math.ceil(segmentEstimate(a, b) / PEN_PATH_TUNING.curveStepPx),
    ));
    for (let step = 1; step <= steps; step += 1) {
      // The final point of the closing segment duplicates anchor zero.
      if (index === anchors.length - 1 && step === steps) continue;
      dense.push(pointAtCubic(a, c1, c2, b, step / steps));
    }
  }
  if (dense.length <= maxPoints) return dense;
  // Close the dense loop just for equal-distance resampling, then remove its
  // duplicate endpoint again.
  const closed = [...dense, dense[0]!];
  return resampleOpen(closed, maxPoints + 1).slice(0, maxPoints);
}

/** Flatten an OPEN pen path — same cubic sampling, but the last anchor is a real
 * endpoint and no return segment exists. The Pen Edges tool commits these. */
export function flattenOpenPenPath(
  anchors: readonly PenAnchor[],
  maxPoints = PEN_PATH_TUNING.maxPolygonPoints,
): PenPoint[] {
  if (anchors.length < 2 || maxPoints < 2) return [];
  const dense: PenPoint[] = [{ x: anchors[0]!.x, y: anchors[0]!.y }];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const a = anchors[index]!;
    const b = anchors[index + 1]!;
    const c1 = finitePoint(a.out) ? a.out : a;
    const c2 = finitePoint(b.in) ? b.in : b;
    const steps = Math.max(1, Math.min(
      PEN_PATH_TUNING.maxCurveSteps,
      Math.ceil(segmentEstimate(a, b) / PEN_PATH_TUNING.curveStepPx),
    ));
    for (let step = 1; step <= steps; step += 1) {
      dense.push(pointAtCubic(a, c1, c2, b, step / steps));
    }
  }
  if (dense.length <= maxPoints) return dense;
  return resampleOpen(dense, maxPoints);
}

function normalizePoints(points: readonly PenPoint[], width: number, height: number): Float32Array {
  const out = new Float32Array(points.length * 2);
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  points.forEach((point, index) => {
    out[index * 2] = Math.max(0, Math.min(1, point.x / w));
    out[index * 2 + 1] = Math.max(0, Math.min(1, point.y / h));
  });
  return out;
}

export function normalizedPenPolygon(
  anchors: readonly PenAnchor[],
  width: number,
  height: number,
  maxPoints = PEN_PATH_TUNING.maxPolygonPoints,
): Float32Array {
  return normalizePoints(flattenClosedPenPath(anchors, maxPoints), width, height);
}

/** The open/closed-aware twin of normalizedPenPolygon for edge-only consumers. */
export function normalizedPenPath(
  anchors: readonly PenAnchor[],
  closed: boolean,
  width: number,
  height: number,
  maxPoints = PEN_PATH_TUNING.maxPolygonPoints,
): Float32Array {
  const points = closed ? flattenClosedPenPath(anchors, maxPoints) : flattenOpenPenPath(anchors, maxPoints);
  return normalizePoints(points, width, height);
}

export function penPathD(anchors: readonly PenAnchor[], closed: boolean): string {
  if (!anchors.length) return '';
  let d = `M ${anchors[0]!.x},${anchors[0]!.y}`;
  const segmentCount = closed ? anchors.length : anchors.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const a = anchors[index]!;
    const b = anchors[(index + 1) % anchors.length]!;
    const c1 = finitePoint(a.out) ? a.out : a;
    const c2 = finitePoint(b.in) ? b.in : b;
    d += ` C ${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`;
  }
  return closed ? `${d} Z` : d;
}

export function penHandleLinesD(anchors: readonly PenAnchor[]): string {
  return anchors.map((anchor) => {
    const lines: string[] = [];
    if (finitePoint(anchor.in)) lines.push(`M ${anchor.x},${anchor.y} L ${anchor.in.x},${anchor.in.y}`);
    if (finitePoint(anchor.out)) lines.push(`M ${anchor.x},${anchor.y} L ${anchor.out.x},${anchor.out.y}`);
    return lines.join(' ');
  }).join(' ');
}
