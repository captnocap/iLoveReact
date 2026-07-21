// Exported-model collision decomposition. The mesh document records the exact
// authored-group range owned by every Outliner part. Those ranges stay hard
// boundaries; spare rows form a bounded spatial tree inside a range so one
// complex part follows its own shape instead of reverting to a whole-mesh AABB.
import { duplicateNameStem } from '../data/modelOutliner';
import type { MeshDocPartMeta, PackageMeshDoc } from '../data/meshDoc';

export type MeshCollisionBox = {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
};

export type MeshCollisionBake = {
  /** Cheap host broadphase and camera bands. Exact player contact uses triangles. */
  boxes: MeshCollisionBox[];
  /** Visible saved-Outliner triangles, packed local-frame xyz × 3 corners. */
  triangles: Float32Array;
};

export const MESH_COLLISION_TUNING = {
  // world_loader's per-mesh island budget. Reduction happens here so the tail
  // of a long bridge is merged locally instead of being truncated.
  hostBoxBudget: 24,
  // Planes still need a physical skin. Horizontal faces extend downward so the
  // visible top remains the exact walkable height; vertical axes expand evenly.
  minimumThicknessMeters: 0.04,
  // A split must materially tighten its two child hulls. This keeps a true box
  // as one cheap collider while a bend, arch, figure, or rising surface spends
  // the remaining budget following its authored shape.
  minimumSplitGainRatio: 0.02,
  // Coincident centroids are not a spatial boundary. Refusing that cut keeps
  // triangle order from manufacturing an arbitrary seam through one face.
  splitCoordinateEpsilonMeters: 0.0001,
} as const;

type Candidate = {
  box: MeshCollisionBox;
  family: string;
  order: number;
};

type TriangleAtom = {
  box: MeshCollisionBox;
  center: [number, number, number];
  order: number;
};

type ClusterSplit = {
  gainRatio: number;
  left: TriangleAtom[];
  right: TriangleAtom[];
};

type CollisionCluster = Candidate & {
  atoms: TriangleAtom[];
  firstTriangle: number;
  split?: ClusterSplit | null;
};

function volume(box: MeshCollisionBox): number {
  return Math.max(0, box.maxX - box.minX)
    * Math.max(0, box.maxY - box.minY)
    * Math.max(0, box.maxZ - box.minZ);
}
function union(a: MeshCollisionBox, b: MeshCollisionBox): MeshCollisionBox {
  return {
    minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY), maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

function surfaceCost(box: MeshCollisionBox): number {
  const x = Math.max(0, box.maxX - box.minX);
  const y = Math.max(0, box.maxY - box.minY);
  const z = Math.max(0, box.maxZ - box.minZ);
  return x * y + x * z + y * z;
}

function centerDistanceSquared(a: MeshCollisionBox, b: MeshCollisionBox): number {
  const ax = (a.minX + a.maxX) * 0.5, ay = (a.minY + a.maxY) * 0.5, az = (a.minZ + a.maxZ) * 0.5;
  const bx = (b.minX + b.maxX) * 0.5, by = (b.minY + b.maxY) * 0.5, bz = (b.minZ + b.maxZ) * 0.5;
  return (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
}

function thicken(box: MeshCollisionBox): MeshCollisionBox {
  const out = { ...box };
  const minimum = MESH_COLLISION_TUNING.minimumThicknessMeters;
  const x = out.maxX - out.minX;
  if (x < minimum) { const grow = (minimum - x) * 0.5; out.minX -= grow; out.maxX += grow; }
  const z = out.maxZ - out.minZ;
  if (z < minimum) { const grow = (minimum - z) * 0.5; out.minZ -= grow; out.maxZ += grow; }
  const y = out.maxY - out.minY;
  if (y < minimum) out.minY = out.maxY - minimum;
  return out;
}

function candidateFamily(meta: MeshDocPartMeta | undefined, index: number): string {
  if (!meta) return `range:${index}`;
  const stem = duplicateNameStem(meta.name);
  return `${meta.groupId ?? 'root'}:${stem}`;
}

function triangleAtom(vertices: Float32Array, triangle: number): TriangleAtom | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let sumX = 0, sumY = 0, sumZ = 0;
  for (let corner = 0; corner < 3; corner += 1) {
    const at = (triangle * 3 + corner) * 8;
    const x = vertices[at]!, y = vertices[at + 1]!, z = vertices[at + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    sumX += x; sumY += y; sumZ += z;
  }
  return {
    box: { minX, minY, minZ, maxX, maxY, maxZ },
    center: [sumX / 3, sumY / 3, sumZ / 3],
    order: triangle,
  };
}

function atomsBounds(atoms: readonly TriangleAtom[]): MeshCollisionBox {
  let box = atoms[0]!.box;
  for (let index = 1; index < atoms.length; index += 1) box = union(box, atoms[index]!.box);
  return box;
}

function rangeIndexForGroup(ranges: readonly { lo: number; hi: number }[], group: number): number {
  let low = 0, high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const range = ranges[mid]!;
    if (group < range.lo) high = mid - 1;
    else if (group >= range.hi) low = mid + 1;
    else return mid;
  }
  return -1;
}

function bestClusterSplit(cluster: CollisionCluster): ClusterSplit | null {
  if (cluster.split !== undefined) return cluster.split;
  if (cluster.atoms.length < 2) return (cluster.split = null);
  const parentCost = surfaceCost(cluster.box) * cluster.atoms.length;
  if (!(parentCost > 0)) return (cluster.split = null);

  let best: ClusterSplit | null = null;
  for (let axis = 0; axis < 3; axis += 1) {
    const sorted = cluster.atoms.slice().sort((a, b) => a.center[axis]! - b.center[axis]! || a.order - b.order);
    const prefix = new Array<MeshCollisionBox>(sorted.length);
    const suffix = new Array<MeshCollisionBox>(sorted.length);
    prefix[0] = sorted[0]!.box;
    for (let index = 1; index < sorted.length; index += 1) prefix[index] = union(prefix[index - 1]!, sorted[index]!.box);
    suffix[sorted.length - 1] = sorted[sorted.length - 1]!.box;
    for (let index = sorted.length - 2; index >= 0; index -= 1) suffix[index] = union(suffix[index + 1]!, sorted[index]!.box);

    for (let cut = 1; cut < sorted.length; cut += 1) {
      if (sorted[cut]!.center[axis]! - sorted[cut - 1]!.center[axis]! <= MESH_COLLISION_TUNING.splitCoordinateEpsilonMeters) continue;
      const childCost = surfaceCost(prefix[cut - 1]!) * cut
        + surfaceCost(suffix[cut]!) * (sorted.length - cut);
      const gainRatio = (parentCost - childCost) / parentCost;
      if (gainRatio < MESH_COLLISION_TUNING.minimumSplitGainRatio) continue;
      if (!best || gainRatio > best.gainRatio) {
        best = { gainRatio, left: sorted.slice(0, cut), right: sorted.slice(cut) };
      }
    }
  }
  cluster.split = best;
  return best;
}

function clusterOf(atoms: TriangleAtom[], family: string, order: number): CollisionCluster {
  let firstTriangle = atoms[0]!.order;
  for (let index = 1; index < atoms.length; index += 1) firstTriangle = Math.min(firstTriangle, atoms[index]!.order);
  return {
    atoms,
    box: atomsBounds(atoms),
    family,
    order,
    firstTriangle,
  };
}

/** Spend spare collider rows where the authored geometry proves one Outliner
 * range is concave/curved. This is a bounded top-down AABB tree: no runtime
 * geometry generation, and never more rows than the host already budgeted. */
function refineToHostBudget(input: CollisionCluster[]): CollisionCluster[] {
  const clusters = input.slice();
  while (clusters.length < MESH_COLLISION_TUNING.hostBoxBudget) {
    let bestIndex = -1;
    let best: ClusterSplit | null = null;
    for (let index = 0; index < clusters.length; index += 1) {
      const split = bestClusterSplit(clusters[index]!);
      if (split && (!best || split.gainRatio > best.gainRatio)) {
        bestIndex = index;
        best = split;
      }
    }
    if (bestIndex < 0 || !best) break;
    const source = clusters[bestIndex]!;
    clusters.splice(
      bestIndex,
      1,
      clusterOf(best.left, source.family, source.order),
      clusterOf(best.right, source.family, source.order),
    );
  }
  return clusters.sort((a, b) => a.order - b.order || a.firstTriangle - b.firstTriangle);
}

/** Merge the cheapest nearby pair. While any repeated source family remains,
 * only that family may merge: bridge deck strips therefore coarsen with deck
 * strips and rails with rails, never into one tall cross-section wall. */
function reduceToHostBudget(input: Candidate[]): Candidate[] {
  const candidates = input.slice();
  let mergeSerial = 0;
  while (candidates.length > MESH_COLLISION_TUNING.hostBoxBudget) {
    const counts = new Map<string, number>();
    for (const candidate of candidates) counts.set(candidate.family, (counts.get(candidate.family) ?? 0) + 1);
    const hasRepeat = [...counts.values()].some((count) => count > 1);
    let bestA = -1, bestB = -1, bestCost = Infinity;
    for (let a = 0; a < candidates.length; a += 1) {
      for (let b = a + 1; b < candidates.length; b += 1) {
        const ca = candidates[a]!, cb = candidates[b]!;
        const sameFamily = ca.family === cb.family;
        if (hasRepeat && !sameFamily) continue;
        const joined = union(ca.box, cb.box);
        const inflation = Math.max(0, volume(joined) - volume(ca.box) - volume(cb.box));
        const orderGap = Math.abs(ca.order - cb.order);
        const cost = inflation + centerDistanceSquared(ca.box, cb.box) + orderGap * 0.001;
        if (cost < bestCost) { bestCost = cost; bestA = a; bestB = b; }
      }
    }
    if (bestA < 0 || bestB < 0) break;
    const a = candidates[bestA]!, b = candidates[bestB]!;
    const merged: Candidate = {
      box: union(a.box, b.box),
      family: a.family === b.family ? a.family : `merged:${mergeSerial++}`,
      order: Math.min(a.order, b.order),
    };
    candidates.splice(bestB, 1);
    candidates.splice(bestA, 1, merged);
  }
  return candidates.sort((a, b) => a.order - b.order);
}

/** Compile bounded local-frame collision bands from every visible Outliner
 * range. One-row Outliners are decomposed too: the old opt-out made the host
 * replace most props with one whole-mesh widest×tallest AABB. */
export function compileOutlinerCollision(
  vertices: Float32Array,
  doc: PackageMeshDoc | null,
  parts: readonly MeshDocPartMeta[] | null,
): MeshCollisionBake {
  const empty = (): MeshCollisionBake => ({ boxes: [], triangles: new Float32Array() });
  if (!doc || doc.ranges.length === 0 || vertices.length === 0 || vertices.length % 24 !== 0) return empty();
  const triangles = vertices.length / 24;
  if (doc.faceGroups && doc.faceGroups.length !== triangles) return empty();
  const atomsByRange = doc.ranges.map((): TriangleAtom[] => []);
  const collisionTriangles = new Float32Array(triangles * 9);
  let collisionAt = 0;
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const group = doc.faceGroups?.[triangle] ?? triangle;
    const rangeIndex = rangeIndexForGroup(doc.ranges, group);
    if (rangeIndex < 0 || parts?.[rangeIndex]?.visible === false) continue;
    const atom = triangleAtom(vertices, triangle);
    if (!atom) continue;
    atomsByRange[rangeIndex]!.push(atom);
    for (let corner = 0; corner < 3; corner += 1) {
      const source = (triangle * 3 + corner) * 8;
      collisionTriangles[collisionAt++] = vertices[source]!;
      collisionTriangles[collisionAt++] = vertices[source + 1]!;
      collisionTriangles[collisionAt++] = vertices[source + 2]!;
    }
  }
  const roots: CollisionCluster[] = [];
  for (let index = 0; index < atomsByRange.length; index += 1) {
    const atoms = atomsByRange[index]!;
    if (atoms.length === 0) continue;
    roots.push(clusterOf(atoms, candidateFamily(parts?.[index], index), index));
  }
  if (roots.length === 0) return empty();
  const candidates: Candidate[] = roots.length > MESH_COLLISION_TUNING.hostBoxBudget
    ? reduceToHostBudget(roots)
    : refineToHostBudget(roots);
  return {
    boxes: candidates.map((candidate) => thicken(candidate.box)),
    triangles: collisionTriangles.slice(0, collisionAt),
  };
}

/** Compatibility view for callers/tests interested only in the broadphase. */
export function compileOutlinerCollisionBoxes(
  vertices: Float32Array,
  doc: PackageMeshDoc | null,
  parts: readonly MeshDocPartMeta[] | null,
): MeshCollisionBox[] {
  return compileOutlinerCollision(vertices, doc, parts).boxes;
}
