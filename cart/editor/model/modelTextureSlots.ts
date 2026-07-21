import type { ModelTextureSlot } from '../data/types';

export const NO_FACE_MATERIAL = 0xffffffff;

export type CompiledTextureSlotMesh = {
  vertices: Float32Array;
  /** Face-local [0,1] UVs, in `vertices` order, for live slot materials only.
   *  The interleaved UV channel stays paint-atlas-owned so an unassigned slot
   *  can still fall back to the model's painting. V is host-texture oriented. */
  materialUvs?: Float32Array;
  slots: { start: number; count: number }[];
};

type FaceProjection = {
  axis: 0 | 1 | 2;
  minU: number;
  minV: number;
  spanU: number;
  spanV: number;
};

function projected(vertex: Float32Array, at: number, axis: 0 | 1 | 2): [number, number] {
  if (axis === 0) return [vertex[at + 2]!, vertex[at + 1]!];
  if (axis === 1) return [vertex[at]!, vertex[at + 2]!];
  return [vertex[at]!, vertex[at + 1]!];
}

/** Build one coherent box projection per authored face group. Triangle-local
 *  projection would make the hidden triangulation visible in the texture. */
function faceProjections(vertices: Float32Array, faceGroups: Uint32Array): Map<number, FaceProjection> {
  type Acc = { nx: number; ny: number; nz: number; points: number[] };
  const groups = new Map<number, Acc>();
  for (let triangle = 0; triangle < faceGroups.length; triangle += 1) {
    const source = triangle * 24;
    const ax = vertices[source]!, ay = vertices[source + 1]!, az = vertices[source + 2]!;
    const bx = vertices[source + 8]!, by = vertices[source + 9]!, bz = vertices[source + 10]!;
    const cx = vertices[source + 16]!, cy = vertices[source + 17]!, cz = vertices[source + 18]!;
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const group = faceGroups[triangle]!;
    const acc = groups.get(group) ?? { nx: 0, ny: 0, nz: 0, points: [] };
    acc.nx += aby * acz - abz * acy;
    acc.ny += abz * acx - abx * acz;
    acc.nz += abx * acy - aby * acx;
    acc.points.push(source, source + 8, source + 16);
    groups.set(group, acc);
  }

  const out = new Map<number, FaceProjection>();
  for (const [group, acc] of groups) {
    const nx = Math.abs(acc.nx), ny = Math.abs(acc.ny), nz = Math.abs(acc.nz);
    const axis: 0 | 1 | 2 = nx >= ny && nx >= nz ? 0 : ny >= nz ? 1 : 2;
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const at of acc.points) {
      const [u, v] = projected(vertices, at, axis);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    out.set(group, {
      axis,
      minU,
      minV,
      spanU: maxU - minU || 1,
      spanV: maxV - minV || 1,
    });
  }
  return out;
}

/** Lower stable per-face role indices into the resident mesh-prop contract:
 * unslotted triangles first, followed by one contiguous range per named role.
 * Vertex contents (including painted-atlas UVs) are copied byte-for-byte. */
export function compileTextureSlotMesh(
  vertices: Float32Array,
  faceMaterials: Uint32Array | null | undefined,
  faceGroups: Uint32Array | null | undefined,
  slots: readonly ModelTextureSlot[],
): CompiledTextureSlotMesh {
  const triangleCount = Math.floor(vertices.length / 24);
  if (vertices.length !== triangleCount * 24) throw new Error('texture-slot mesh is not triangle-aligned stride-8 geometry');
  if (slots.length === 0) return { vertices, slots: [] };
  // RJMD deliberately omits an all-NO_MATERIAL table. Keep loading legacy
  // manifests that contain empty roles, even though current authoring refuses to
  // create one; their indices stay stable until the user removes them.
  if (!faceMaterials) {
    const end = triangleCount * 3;
    return { vertices, slots: slots.map(() => ({ start: end, count: 0 })) };
  }
  if (faceMaterials.length !== triangleCount) {
    throw new Error(`texture-slot mesh has ${triangleCount} triangles but ${faceMaterials?.length ?? 0} face-role rows`);
  }
  if (!faceGroups || faceGroups.length !== triangleCount) {
    throw new Error(`texture-slot mesh has ${triangleCount} triangles but ${faceGroups?.length ?? 0} authored-face rows`);
  }

  const projections = faceProjections(vertices, faceGroups);

  const buckets: number[][] = Array.from({ length: slots.length + 1 }, () => []);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const material = faceMaterials[triangle]!;
    const bucket = material !== NO_FACE_MATERIAL && material < slots.length ? material + 1 : 0;
    buckets[bucket]!.push(triangle);
  }

  const out = new Float32Array(vertices.length);
  const materialUvs = new Float32Array(triangleCount * 3 * 2);
  let outFloat = 0;
  const appendBucket = (triangles: readonly number[]) => {
    for (const triangle of triangles) {
      const source = triangle * 24;
      out.set(vertices.subarray(source, source + 24), outFloat);
      const projection = projections.get(faceGroups[triangle]!)!;
      const outVertex = outFloat / 8;
      for (let corner = 0; corner < 3; corner += 1) {
        const [u, v] = projected(vertices, source + corner * 8, projection.axis);
        materialUvs[(outVertex + corner) * 2] = (u - projection.minU) / projection.spanU;
        // Keyed material textures use the host texture orientation. Store the
        // flip once here; never allocate/copy this resident geometry per frame.
        materialUvs[(outVertex + corner) * 2 + 1] = 1 - (v - projection.minV) / projection.spanV;
      }
      outFloat += 24;
    }
  };
  appendBucket(buckets[0]!);
  let vertexStart = buckets[0]!.length * 3;
  const ranges = slots.map((_, index) => {
    const triangles = buckets[index + 1]!;
    const range = { start: vertexStart, count: triangles.length * 3 };
    appendBucket(triangles);
    vertexStart += range.count;
    return range;
  });
  return { vertices: out, materialUvs, slots: ranges };
}
