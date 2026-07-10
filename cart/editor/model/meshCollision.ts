// Exported-model collision decomposition. The mesh document already records the
// exact authored-group range owned by every Outliner part; those ranges are a
// stronger boundary than a whole-mesh AABB and survive save/export unchanged.
import { duplicateNameStem } from '../data/modelOutliner';
import type { MeshDocPartMeta, PackageMeshDoc } from '../data/meshDoc';

export type MeshCollisionBox = {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
};

export const MESH_COLLISION_TUNING = {
  // world_loader's per-mesh island budget. Reduction happens here so the tail
  // of a long bridge is merged locally instead of being truncated.
  hostBoxBudget: 24,
  // Planes still need a physical skin. Horizontal faces extend downward so the
  // visible top remains the exact walkable height; vertical axes expand evenly.
  minimumThicknessMeters: 0.04,
} as const;

type Candidate = {
  box: MeshCollisionBox;
  family: string;
  order: number;
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

function rangeBounds(
  vertices: Float32Array,
  faceGroups: Uint32Array | null,
  lo: number,
  hi: number,
): MeshCollisionBox | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const triangles = Math.floor(vertices.length / 24);
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const group = faceGroups ? faceGroups[triangle]! : triangle;
    if (group < lo || group >= hi) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const at = (triangle * 3 + corner) * 8;
      const x = vertices[at]!, y = vertices[at + 1]!, z = vertices[at + 2]!;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return Number.isFinite(minX) ? thicken({ minX, minY, minZ, maxX, maxY, maxZ }) : null;
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

/** Compile one local-frame collision band per visible Outliner part. Returns an
 * empty list when the mesh document cannot prove that partition; the host then
 * keeps its connected-island fallback. */
export function compileOutlinerCollisionBoxes(
  vertices: Float32Array,
  doc: PackageMeshDoc | null,
  parts: readonly MeshDocPartMeta[] | null,
): MeshCollisionBox[] {
  if (!doc || doc.ranges.length < 2 || vertices.length === 0 || vertices.length % 24 !== 0) return [];
  const triangles = vertices.length / 24;
  if (doc.faceGroups && doc.faceGroups.length !== triangles) return [];
  const candidates: Candidate[] = [];
  for (let index = 0; index < doc.ranges.length; index += 1) {
    const range = doc.ranges[index]!;
    const meta = parts?.[index];
    if (meta?.visible === false || range.hi <= range.lo) continue;
    const box = rangeBounds(vertices, doc.faceGroups, range.lo, range.hi);
    if (box) candidates.push({ box, family: candidateFamily(meta, index), order: index });
  }
  if (candidates.length < 2) return [];
  return reduceToHostBudget(candidates).map((candidate) => candidate.box);
}
