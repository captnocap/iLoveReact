// model/doorModel.ts — the Studio-authored door boundary.
//
// A door is NOT the map's `door` tile. It is a wall-family model explicitly
// exported with a door edit, plus exactly one visible Outliner part whose name
// reads as "Door Leaf". The part name selects geometry; the export declaration
// supplies meaning. Neither alone silently turns an arbitrary model into a door.
//
// The saved mesh document stores part ranges as authored face-group intervals.
// Runtime MESH_PROPS needs one contiguous vertex slot for its movable panel, so
// this module performs the compiler seam: body triangles first, leaf triangles
// last, with a precise trailing slot. Pure and independently testable.
import type { MeshDocPartMeta, PackageMeshDoc } from '../data/meshDoc';

export const DOOR_LEAF_PART_NAME = 'Door Leaf';

// P2 interaction data captured from the ruled hmsc-int door compiler. The Zig
// loader owns swing physics; this boundary only declares its authored contract.
export const DOOR_EXPORT_TUNING = {
  walk: { reachMeters: 2.2, vehicle: false },
  garage: { reachMeters: 2.2, vehicle: true },
} as const;

export type DoorLeafCandidate = { name: string; visible: boolean };
export type DoorLeafResolution =
  | { ok: true; index: number }
  | { ok: false; error: string };

/** Case-insensitive but semantic: both "door" and "leaf" must remain in order. */
export function isDoorLeafPartName(name: string): boolean {
  return /door.*leaf/i.test(name.trim());
}

/** Validate the named-part boundary before any export declaration is written. */
export function resolveDoorLeafPart(parts: readonly DoorLeafCandidate[]): DoorLeafResolution {
  const matches = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.visible && isDoorLeafPartName(part.name));
  if (matches.length === 0) {
    return { ok: false, error: `Door Wall export needs one visible Outliner part named "${DOOR_LEAF_PART_NAME}".` };
  }
  if (matches.length > 1) {
    return { ok: false, error: `Door Wall export found ${matches.length} visible door-leaf parts; keep exactly one named "${DOOR_LEAF_PART_NAME}".` };
  }
  return { ok: true, index: matches[0]!.index };
}

export type CompiledDoorMesh = {
  vertices: Float32Array;
  leaf: { start: number; count: number };
};

export type CompileDoorMeshResult =
  | { ok: true; mesh: CompiledDoorMesh }
  | { ok: false; error: string };

/**
 * Partition a current stride-8 triangle soup by the saved Outliner ranges.
 * `vertices` may carry newer UVs (a painted form), but must retain the meshdoc's
 * triangle order; that lets one group map compile every visual variant safely.
 */
export function compileDoorMesh(
  vertices: Float32Array,
  doc: PackageMeshDoc,
  parts: readonly MeshDocPartMeta[],
): CompileDoorMeshResult {
  const resolved = resolveDoorLeafPart(parts);
  if (!resolved.ok) return resolved;
  if (parts.length !== doc.ranges.length) {
    return { ok: false, error: `Door Wall export cannot pair ${parts.length} Outliner parts with ${doc.ranges.length} saved mesh ranges; save the model and retry.` };
  }
  if (vertices.length === 0 || vertices.length % 24 !== 0) {
    return { ok: false, error: 'Door Wall export needs a non-empty triangle mesh.' };
  }
  const triangleCount = vertices.length / 24;
  if (doc.faceGroups && doc.faceGroups.length !== triangleCount) {
    return { ok: false, error: `Door Wall export face-group count (${doc.faceGroups.length}) does not match its ${triangleCount} triangles.` };
  }

  const leafRange = doc.ranges[resolved.index];
  if (!leafRange || leafRange.hi <= leafRange.lo) {
    return { ok: false, error: `The "${parts[resolved.index]?.name ?? DOOR_LEAF_PART_NAME}" Outliner part has no saved face range.` };
  }

  let leafTriangles = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const group = doc.faceGroups ? doc.faceGroups[triangle]! : triangle;
    if (group >= leafRange.lo && group < leafRange.hi) leafTriangles += 1;
  }
  if (leafTriangles === 0) {
    return { ok: false, error: `The "${parts[resolved.index]?.name ?? DOOR_LEAF_PART_NAME}" Outliner part is empty; give the door panel geometry before export.` };
  }
  if (leafTriangles === triangleCount) {
    return { ok: false, error: 'Door Wall export needs static frame geometry in addition to the Door Leaf.' };
  }

  const bodyTriangles = triangleCount - leafTriangles;
  const bodyFloats = bodyTriangles * 24;
  const out = new Float32Array(vertices.length);
  let bodyAt = 0;
  let leafAt = bodyFloats;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const group = doc.faceGroups ? doc.faceGroups[triangle]! : triangle;
    const sourceAt = triangle * 24;
    const source = vertices.subarray(sourceAt, sourceAt + 24);
    if (group >= leafRange.lo && group < leafRange.hi) {
      out.set(source, leafAt);
      leafAt += 24;
    } else {
      out.set(source, bodyAt);
      bodyAt += 24;
    }
  }

  return {
    ok: true,
    mesh: {
      vertices: out,
      // MESH_PROPS ranges are in VERTICES, not floats.
      leaf: { start: bodyFloats / 8, count: (leafTriangles * 24) / 8 },
    },
  };
}
