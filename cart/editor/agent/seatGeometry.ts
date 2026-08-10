// editor/agent/seatGeometry.ts — the arithmetic the Agent Seat used to make agents
// do for themselves.
//
// The disease this cures: every measurement an agent needed — a part's extent, the
// gap between a leg and a floor, whether a body is symmetric, how long the edges in
// a retopology band are — had no verb, so agents piped `tools/seat look` into
// python3 and did the math by hand. A survey of the Claude + Codex transcripts
// (req_4052) found 461 such escapes across 132 sessions: 89 doing geometry math,
// 155 parsing saved blobs, 24 hunting anomalies, 23 checking symmetry. Hand math on
// seat output is not merely verbose; it is UNVERSIONED. When the editor's meaning of
// a number changes, the agent's private arithmetic keeps returning a confident wrong
// answer and nothing warns anyone.
//
// So the rule is: the editor computes, the agent reads. Everything here is pure —
// boxes and points in, answers out — so it is testable without a live mesh, and
// seatApi supplies the live data. Distances are METERS (R4: 1 unit = 1 meter).

/** min x,y,z then max x,y,z — the same order the percept's region bboxes use. */
export type SeatBox = [number, number, number, number, number, number];
export type SeatPoint = [number, number, number];

export const AXIS_NAMES = ['x', 'y', 'z'] as const;
export type AxisName = (typeof AXIS_NAMES)[number];

/** A hair under a tenth of a millimeter. Below this two positions are the same place:
 *  it is finer than any modelling decision but coarser than float32 round-trip noise,
 *  which a saved-and-reloaded vertex accumulates. */
export const CONTACT_EPSILON = 1e-4;

export function axisIndexOf(name: unknown): 0 | 1 | 2 | null {
  const at = AXIS_NAMES.indexOf(String(name ?? '').toLowerCase() as AxisName);
  return at < 0 ? null : (at as 0 | 1 | 2);
}

export function isBox(value: unknown): value is SeatBox {
  return Array.isArray(value) && value.length === 6 && value.every((n) => Number.isFinite(n));
}

export function boxOfPoints(points: readonly SeatPoint[]): SeatBox | null {
  if (points.length === 0) return null;
  const box: SeatBox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = point[axis]!;
      if (!Number.isFinite(value)) return null;
      if (value < box[axis]!) box[axis] = value;
      if (value > box[axis + 3]!) box[axis + 3] = value;
    }
  }
  return box;
}

export function unionBoxes(boxes: readonly SeatBox[]): SeatBox | null {
  const corners: SeatPoint[] = [];
  for (const box of boxes) {
    corners.push([box[0], box[1], box[2]], [box[3], box[4], box[5]]);
  }
  return boxOfPoints(corners);
}

export function boxSize(box: SeatBox): SeatPoint {
  return [box[3] - box[0], box[4] - box[1], box[5] - box[2]];
}

export function boxCenter(box: SeatBox): SeatPoint {
  return [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2];
}

export type SeatBoxFacts = {
  bbox: SeatBox;
  size: SeatPoint;
  center: SeatPoint;
  /** Longest side first — the answer to "which way does this part run?". */
  longestAxis: AxisName;
  volume: number;
};

export function boxFacts(box: SeatBox): SeatBoxFacts {
  const size = boxSize(box);
  let longest: 0 | 1 | 2 = 0;
  if (size[1] > size[longest]) longest = 1;
  if (size[2] > size[longest]) longest = 2;
  return {
    bbox: box,
    size,
    center: boxCenter(box),
    longestAxis: AXIS_NAMES[longest],
    volume: size[0] * size[1] * size[2],
  };
}

export type SeatAxisRelation = {
  axis: AxisName;
  moving: [number, number];
  target: [number, number];
  /** Positive = the intervals share this much length. Negative = an empty gap. */
  overlap: number;
  gap: number;
  /** Where the moving box sits relative to the target along this axis. */
  side: 'above' | 'below' | 'straddling';
  verdict: 'touching' | 'gap' | 'overlapping';
};

export function axisRelation(
  moving: SeatBox,
  target: SeatBox,
  axis: 0 | 1 | 2,
  epsilon = CONTACT_EPSILON,
): SeatAxisRelation {
  const movingSpan: [number, number] = [moving[axis]!, moving[axis + 3]!];
  const targetSpan: [number, number] = [target[axis]!, target[axis + 3]!];
  const overlap = Math.min(movingSpan[1], targetSpan[1]) - Math.max(movingSpan[0], targetSpan[0]);
  const movingCenter = (movingSpan[0] + movingSpan[1]) / 2;
  const targetCenter = (targetSpan[0] + targetSpan[1]) / 2;
  const side = movingSpan[0] >= targetSpan[1] - epsilon
    ? 'above'
    : movingSpan[1] <= targetSpan[0] + epsilon
      ? 'below'
      : movingCenter === targetCenter ? 'straddling' : movingCenter > targetCenter ? 'above' : 'below';
  return {
    axis: AXIS_NAMES[axis],
    moving: movingSpan,
    target: targetSpan,
    overlap,
    gap: -overlap,
    side: overlap > epsilon ? 'straddling' : side,
    verdict: Math.abs(overlap) <= epsilon ? 'touching' : overlap > 0 ? 'overlapping' : 'gap',
  };
}

export type SeatDistanceReport = {
  axes: SeatAxisRelation[];
  /** Straight-line distance between the two boxes; 0 when they interpenetrate. */
  separation: number;
  centerDistance: number;
  verdict: 'touching' | 'gap' | 'overlapping';
};

export function measureDistance(moving: SeatBox, target: SeatBox, epsilon = CONTACT_EPSILON): SeatDistanceReport {
  const axes = [0, 1, 2].map((axis) => axisRelation(moving, target, axis as 0 | 1 | 2, epsilon));
  const gaps = axes.map((row) => Math.max(0, row.gap));
  const separation = Math.hypot(gaps[0]!, gaps[1]!, gaps[2]!);
  const movingCenter = boxCenter(moving);
  const targetCenter = boxCenter(target);
  return {
    axes,
    separation,
    centerDistance: Math.hypot(
      movingCenter[0] - targetCenter[0],
      movingCenter[1] - targetCenter[1],
      movingCenter[2] - targetCenter[2],
    ),
    // Separated on ANY axis means the volumes do not touch, however deeply the
    // other two axes overlap — that is what makes a floating leg "a gap" and not
    // "overlapping" just because it shares the floor's x/z footprint.
    verdict: axes.some((row) => row.verdict === 'gap')
      ? 'gap'
      : axes.every((row) => row.verdict === 'overlapping') ? 'overlapping' : 'touching',
  };
}

/** The axis a contact is actually ABOUT. Separated boxes contact along the axis that
 *  separates them most; interpenetrating boxes resolve along their shallowest
 *  penetration, which is the same minimum-translation choice a physics solver makes. */
export function contactAxis(moving: SeatBox, target: SeatBox, epsilon = CONTACT_EPSILON): 0 | 1 | 2 {
  const axes = [0, 1, 2].map((axis) => axisRelation(moving, target, axis as 0 | 1 | 2, epsilon));
  const separated = axes.filter((row) => row.gap > epsilon);
  const pool = separated.length > 0 ? separated : axes;
  const score = (row: SeatAxisRelation) => (separated.length > 0 ? row.gap : -row.overlap);
  let best = pool[0]!;
  for (const row of pool) if (score(row) > score(best)) best = row;
  return axisIndexOf(best.axis)!;
}

export type SeatContactReport = SeatDistanceReport & {
  contact: {
    axis: AxisName;
    /** Signed meters to move `moving` so its facing plane lands on the target's.
     *  This is exactly the `stationaryPlane - movingPlane` the transcripts computed
     *  by hand — the seat now hands it over already computed. */
    delta: number;
    movingPlane: number;
    targetPlane: number;
    side: 'above' | 'below' | 'straddling';
  };
  /** Shared extent on the two axes that are NOT the contact axis. A contact whose
   *  footprint is zero on either is two boxes meeting at an edge, not a seat. */
  footprint: { axis: AxisName; overlap: number }[];
};

export function measureContact(moving: SeatBox, target: SeatBox, epsilon = CONTACT_EPSILON): SeatContactReport {
  const report = measureDistance(moving, target, epsilon);
  const axis = contactAxis(moving, target, epsilon);
  const relation = report.axes[axis]!;
  // Seat the near faces: a box sitting above rests its floor on the target's ceiling.
  const above = relation.side !== 'below';
  const movingPlane = above ? relation.moving[0] : relation.moving[1];
  const targetPlane = above ? relation.target[1] : relation.target[0];
  return {
    ...report,
    contact: {
      axis: relation.axis,
      delta: targetPlane - movingPlane,
      movingPlane,
      targetPlane,
      side: relation.side,
    },
    footprint: report.axes
      .filter((row) => row.axis !== relation.axis)
      .map((row) => ({ axis: row.axis, overlap: row.overlap })),
  };
}

export type SeatAlignPlan = {
  axis: AxisName;
  delta: SeatPoint;
  movingPlane: number;
  targetPlane: number;
  side: 'above' | 'below' | 'straddling';
  /** What the moving box's relation becomes once the delta is applied. */
  before: SeatAxisRelation;
};

/** Where to move `moving` so it rests exactly on `target`. Returns the delta only —
 *  applying it is the caller's transaction, so a dry run and a real align share one
 *  arithmetic and can never disagree. */
export function planAlign(
  moving: SeatBox,
  target: SeatBox,
  axis: 0 | 1 | 2 | null = null,
  epsilon = CONTACT_EPSILON,
): SeatAlignPlan {
  const chosen = axis ?? contactAxis(moving, target, epsilon);
  const relation = axisRelation(moving, target, chosen, epsilon);
  const above = relation.side !== 'below';
  const movingPlane = above ? relation.moving[0] : relation.moving[1];
  const targetPlane = above ? relation.target[1] : relation.target[0];
  const delta: SeatPoint = [0, 0, 0];
  delta[chosen] = targetPlane - movingPlane;
  return { axis: AXIS_NAMES[chosen], delta, movingPlane, targetPlane, side: relation.side, before: relation };
}

// ── statistics over real topology ──────────────────────────────────────────────

export type SeatSpread = {
  count: number;
  min: number;
  median: number;
  max: number;
  mean: number;
  /** max/min — 1 is a perfectly even band; large values are the stretched quads a
   *  retopology pass is trying to find. */
  ratio: number | null;
};

export function spread(values: readonly number[]): SeatSpread | null {
  const clean = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const middle = clean.length >> 1;
  const median = clean.length % 2 === 1 ? clean[middle]! : (clean[middle - 1]! + clean[middle]!) / 2;
  const min = clean[0]!;
  const max = clean[clean.length - 1]!;
  return {
    count: clean.length,
    min,
    median,
    max,
    mean: clean.reduce((sum, value) => sum + value, 0) / clean.length,
    ratio: min > 0 ? max / min : null,
  };
}

export function pointDistance(a: SeatPoint, b: SeatPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function triangleArea(a: SeatPoint, b: SeatPoint, c: SeatPoint): number {
  const u: SeatPoint = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: SeatPoint = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ) / 2;
}

export type SeatSymmetryReport = {
  axis: AxisName;
  /** The mirror plane is the MODEL ORIGIN, never a bounds-derived centerline — a
   *  bounds plane drifts with every asymmetric edit and would silently redefine what
   *  "symmetric" means between two calls (the persistent-plane ruling, req_3795). */
  plane: 0;
  tolerance: number;
  vertices: number;
  /** Vertices sitting on the plane. They are their own partner and always match. */
  onPlane: number;
  mirrored: number;
  unmatched: number;
  ratio: number;
  offenders: { id: number; at: SeatPoint; nearest: number | null }[];
};

export function measureSymmetry(
  vertices: readonly { id: number; at: SeatPoint }[],
  axis: 0 | 1 | 2,
  tolerance = CONTACT_EPSILON,
  offenderLimit = 24,
): SeatSymmetryReport {
  // Bucket by the two axes that the mirror preserves, so a partner search is a
  // local lookup instead of an O(n²) sweep over the whole body.
  const keep = [0, 1, 2].filter((index) => index !== axis) as [number, number];
  const quantize = (value: number) => Math.round(value / Math.max(tolerance, Number.EPSILON));
  const buckets = new Map<string, { id: number; at: SeatPoint }[]>();
  for (const vertex of vertices) {
    const key = `${quantize(vertex.at[keep[0]]!)}|${quantize(vertex.at[keep[1]]!)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(vertex);
    else buckets.set(key, [vertex]);
  }
  let onPlane = 0;
  let mirrored = 0;
  const offenders: SeatSymmetryReport['offenders'] = [];
  for (const vertex of vertices) {
    const value = vertex.at[axis]!;
    if (Math.abs(value) <= tolerance) { onPlane += 1; mirrored += 1; continue; }
    // A neighbouring bucket can hold the partner when the pair straddles a boundary,
    // so probe the 3×3 block rather than trusting one exact key.
    let nearest: number | null = null;
    let matched = false;
    for (let du = -1; du <= 1 && !matched; du += 1) {
      for (let dv = -1; dv <= 1 && !matched; dv += 1) {
        const key = `${quantize(vertex.at[keep[0]]!) + du}|${quantize(vertex.at[keep[1]]!) + dv}`;
        for (const candidate of buckets.get(key) ?? []) {
          if (candidate.id === vertex.id) continue;
          const distance = pointDistance(candidate.at, mirrorPoint(vertex.at, axis));
          if (nearest === null || distance < nearest) nearest = distance;
          if (distance <= tolerance) { matched = true; break; }
        }
      }
    }
    if (matched) mirrored += 1;
    else if (offenders.length < offenderLimit) offenders.push({ id: vertex.id, at: vertex.at, nearest });
  }
  const total = vertices.length;
  return {
    axis: AXIS_NAMES[axis],
    plane: 0,
    tolerance,
    vertices: total,
    onPlane,
    mirrored,
    unmatched: total - mirrored,
    ratio: total === 0 ? 1 : mirrored / total,
    offenders,
  };
}

export function mirrorPoint(point: SeatPoint, axis: 0 | 1 | 2): SeatPoint {
  const out: SeatPoint = [point[0], point[1], point[2]];
  out[axis] = -out[axis];
  return out;
}

export type SeatAnomalyReport = {
  triangles: number;
  degenerate: { id: number; area: number }[];
  duplicateVertices: { ids: number[]; at: SeatPoint }[];
  nonManifoldEdges: { id: number; vertices: [number, number]; faces: number }[];
  openEdges: number;
  counts: { degenerate: number; duplicateVertices: number; nonManifoldEdges: number };
};

export function findAnomalies(
  triangles: readonly { id: number; vertices: [number, number, number] }[],
  vertices: readonly { id: number; at: SeatPoint }[],
  edges: readonly { id: number; vertices: [number, number]; faces: number; open: boolean }[],
  epsilon = CONTACT_EPSILON,
  listLimit = 24,
): SeatAnomalyReport {
  const positions = new Map(vertices.map((vertex) => [vertex.id, vertex.at] as const));
  const degenerate: SeatAnomalyReport['degenerate'] = [];
  // Area, not edge length: a sliver with three distinct corners still renders nothing
  // and still eats a UV island, so length checks miss the ones that actually hurt.
  const areaFloor = epsilon * epsilon;
  for (const triangle of triangles) {
    const [a, b, c] = triangle.vertices.map((id) => positions.get(id));
    if (!a || !b || !c) continue;
    const area = triangleArea(a, b, c);
    if (area <= areaFloor) degenerate.push({ id: triangle.id, area });
  }
  const byPosition = new Map<string, { id: number; at: SeatPoint }[]>();
  const quantize = (value: number) => Math.round(value / Math.max(epsilon, Number.EPSILON));
  for (const vertex of vertices) {
    const key = `${quantize(vertex.at[0])}|${quantize(vertex.at[1])}|${quantize(vertex.at[2])}`;
    const bucket = byPosition.get(key);
    if (bucket) bucket.push(vertex);
    else byPosition.set(key, [vertex]);
  }
  const duplicateVertices: SeatAnomalyReport['duplicateVertices'] = [];
  for (const bucket of byPosition.values()) {
    if (bucket.length > 1) duplicateVertices.push({ ids: bucket.map((v) => v.id), at: bucket[0]!.at });
  }
  const nonManifoldEdges = edges.filter((edge) => edge.faces > 2)
    .map((edge) => ({ id: edge.id, vertices: edge.vertices, faces: edge.faces }));
  return {
    triangles: triangles.length,
    degenerate: degenerate.slice(0, listLimit),
    duplicateVertices: duplicateVertices.slice(0, listLimit),
    nonManifoldEdges: nonManifoldEdges.slice(0, listLimit),
    openEdges: edges.filter((edge) => edge.open).length,
    counts: {
      degenerate: degenerate.length,
      duplicateVertices: duplicateVertices.length,
      nonManifoldEdges: nonManifoldEdges.length,
    },
  };
}

/** Every distinct undirected edge of a triangle set, with its length. */
export function triangleEdgeLengths(
  triangles: readonly { vertices: [number, number, number] }[],
  vertices: readonly { id: number; at: SeatPoint }[],
): number[] {
  const positions = new Map(vertices.map((vertex) => [vertex.id, vertex.at] as const));
  const seen = new Set<string>();
  const lengths: number[] = [];
  for (const triangle of triangles) {
    const corners = triangle.vertices;
    for (let corner = 0; corner < 3; corner += 1) {
      const a = corners[corner]!;
      const b = corners[(corner + 1) % 3]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const from = positions.get(a);
      const to = positions.get(b);
      if (from && to) lengths.push(pointDistance(from, to));
    }
  }
  return lengths;
}

/** How many separate closed rims a set of boundary edges forms. One hole is one loop;
 *  a tube open at both ends is two. Counting them is what turns "37 boundary edges" —
 *  a number an agent cannot act on — into "two holes", which it can. */
export function boundaryLoopCount(
  edges: readonly { vertices: [number, number] }[],
): number {
  const adjacency = new Map<number, number[]>();
  for (const edge of edges) {
    for (const [from, to] of [edge.vertices, [edge.vertices[1], edge.vertices[0]] as const]) {
      adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
    }
  }
  const seen = new Set<number>();
  let loops = 0;
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    loops += 1;
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return loops;
}
