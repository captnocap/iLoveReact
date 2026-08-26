import type { MeshDocPartMeta, PackageMeshDoc } from '../data/meshDoc';

export const FART_RACER_VEHICLE_PART_NAMES = [
  'body.chassis',
  'wheel.front.left',
  'wheel.front.right',
  'wheel.rear.left',
  'wheel.rear.right',
  'light.head.left',
  'light.head.right',
  'light.brake.left',
  'light.brake.right',
  'light.reverse.center',
] as const;

export type VehiclePartSlot = Readonly<{ start: number; count: number }>;
export type PartitionedVehicleMesh = Readonly<{ vertices: Float32Array; slots: readonly VehiclePartSlot[] }>;

type VehicleDoc = Pick<PackageMeshDoc, 'ranges' | 'rangeObjectIds'>;

/** Resolve each schema part NAME to its saved range, through the durable object
 *  id both tables carry (RJMD v5 `rangeObjectIds`, parts.json `objectId`).
 *
 *  The schema is a set of named parts, not an array layout: parts.json stores
 *  its rows in host-part order and the blob stores its ranges in the same
 *  order, neither of which is the order a modeller sees or controls. Matching
 *  by array position made a correctly-built car — right names, right outliner
 *  order — fail the check for no reason a modeller could see or fix. */
function resolveVehicleRanges(
  doc: VehicleDoc | null | undefined,
  parts: readonly MeshDocPartMeta[] | null | undefined,
): { lo: number; hi: number }[] | null {
  if (!doc || !parts) return null;
  const { ranges, rangeObjectIds } = doc;
  if (ranges.length !== FART_RACER_VEHICLE_PART_NAMES.length) return null;
  if (parts.length !== FART_RACER_VEHICLE_PART_NAMES.length) return null;
  if (!rangeObjectIds || rangeObjectIds.length !== ranges.length) return null;
  const rangeByObjectId = new Map(rangeObjectIds.map((objectId, index) => [objectId, ranges[index]!]));
  const objectIdByName = new Map(parts.map((part) => [part.name, part.objectId]));
  const resolved: { lo: number; hi: number }[] = [];
  for (const name of FART_RACER_VEHICLE_PART_NAMES) {
    const objectId = objectIdByName.get(name);
    const range = objectId ? rangeByObjectId.get(objectId) : undefined;
    if (!range) return null;
    resolved.push(range);
  }
  return resolved;
}

/** The runtime animation contract is deliberately a single strict ten-part
 * schema. A package either satisfies it exactly or remains an ordinary prop. */
export function isFartRacerVehicleVisual(
  doc: VehicleDoc | null | undefined,
  parts: readonly MeshDocPartMeta[] | null | undefined,
): boolean {
  return resolveVehicleRanges(doc, parts) !== null;
}

/** Repack triangle soup in semantic-part order. MESH_PROPS slots must be
 * contiguous vertex spans, while RJMD face groups are allowed to be interleaved. */
export function partitionFartRacerVehicleMesh(
  doc: Pick<PackageMeshDoc, 'vertices' | 'faceGroups' | 'ranges' | 'rangeObjectIds'>,
  parts: readonly MeshDocPartMeta[] | null | undefined,
): PartitionedVehicleMesh {
  const ranges = resolveVehicleRanges(doc, parts);
  if (!ranges) {
    throw new Error(
      `Fart Racer vehicle visual needs the ${FART_RACER_VEHICLE_PART_NAMES.length} schema parts, each with a saved object-id range; found ${doc.ranges.length} range(s) across ${parts?.length ?? 0} part(s)`,
    );
  }
  const { vertices, faceGroups } = doc;
  if (vertices.length === 0 || vertices.length % 24 !== 0) {
    throw new Error('Fart Racer vehicle visual must be non-empty stride-8 triangle geometry');
  }
  const triangleCount = vertices.length / 24;
  if (!faceGroups || faceGroups.length !== triangleCount) {
    throw new Error(`Fart Racer vehicle visual needs one authored face-group row per triangle; found ${faceGroups?.length ?? 0} for ${triangleCount}`);
  }
  const trianglesByPart = ranges.map((): number[] => []);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const group = faceGroups[triangle]!;
    const part = ranges.findIndex((range) => group >= range.lo && group < range.hi);
    if (part < 0) throw new Error(`Fart Racer vehicle triangle ${triangle} has face group ${group} outside every saved part range`);
    trianglesByPart[part]!.push(triangle);
  }
  if (trianglesByPart.some((triangles) => triangles.length === 0)) {
    const empty = trianglesByPart.findIndex((triangles) => triangles.length === 0);
    throw new Error(`Fart Racer vehicle part ${FART_RACER_VEHICLE_PART_NAMES[empty]} has no geometry`);
  }
  const out = new Float32Array(vertices.length);
  const slots: VehiclePartSlot[] = [];
  let vertexAt = 0;
  for (const triangles of trianglesByPart) {
    const start = vertexAt;
    for (const triangle of triangles) {
      out.set(vertices.subarray(triangle * 24, triangle * 24 + 24), vertexAt * 8);
      vertexAt += 3;
    }
    slots.push({ start, count: vertexAt - start });
  }
  return { vertices: out, slots };
}
