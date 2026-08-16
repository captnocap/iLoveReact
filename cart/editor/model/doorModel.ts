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

// P2 interaction data for the editor-owned door contract. The Zig
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

export type DoorHingeInference =
  | { hingeMaxX: boolean; inferred: true; knobRegion: string }
  | { hingeMaxX: false; inferred: false; reason: string };

/** The model's named KNOB decides the hinge side (req_4537 — "my knobed side
 * is the one that should not be the hinge"): the knob's faces sit on one half
 * of the leaf's X extent, and the hinge takes the OPPOSITE edge. The knob is
 * the semantic face region named exactly 'knob' (the mesh editor's Name
 * Selection lane — semantics live in the RJMD doc, never a sidecar). No knob
 * region → the engine's historic min-X hinge stands. */
export function resolveDoorHinge(
  doc: {
    vertices: Float32Array;
    faceGroups: Uint32Array | null;
    semanticRegions?: Uint32Array | null;
    semanticTable?: { regions: readonly { id: number; name: string }[] } | null;
    ranges: readonly { lo: number; hi: number }[];
  },
  leafPartIndex: number,
): DoorHingeInference {
  const regions = doc.semanticRegions;
  const table = doc.semanticTable;
  if (!regions || !table) return { hingeMaxX: false, inferred: false, reason: 'no named face regions in the document' };
  const knob = table.regions.find((region) => region.name.trim().toLowerCase() === 'knob');
  if (!knob) return { hingeMaxX: false, inferred: false, reason: "no face region named 'knob'" };
  const faceCount = Math.floor(doc.vertices.length / 24);
  const leafRange = doc.ranges[leafPartIndex] ?? null;
  const inLeaf = (face: number): boolean => {
    if (!leafRange || !doc.faceGroups) return true;
    const group = doc.faceGroups[face]!;
    return group >= leafRange.lo && group < leafRange.hi;
  };
  let knobX = 0;
  let knobWeight = 0;
  let leafMinX = Infinity;
  let leafMaxX = -Infinity;
  for (let face = 0; face < Math.min(faceCount, regions.length); face += 1) {
    const base = face * 24;
    if (regions[face] === knob.id) {
      knobX += doc.vertices[base]! + doc.vertices[base + 8]! + doc.vertices[base + 16]!;
      knobWeight += 3;
    }
    if (inLeaf(face)) {
      for (let corner = 0; corner < 3; corner += 1) {
        const x = doc.vertices[base + corner * 8]!;
        if (x < leafMinX) leafMinX = x;
        if (x > leafMaxX) leafMaxX = x;
      }
    }
  }
  if (knobWeight === 0) return { hingeMaxX: false, inferred: false, reason: "the 'knob' region names no faces" };
  if (!(leafMaxX > leafMinX)) return { hingeMaxX: false, inferred: false, reason: 'the leaf has no X extent' };
  const knobCenterX = knobX / knobWeight;
  const leafMidX = (leafMinX + leafMaxX) / 2;
  // Knob on the max-X half → hinge stays min-X (the engine default);
  // knob on the min-X half → hinge flips to max-X.
  return { hingeMaxX: knobCenterX < leafMidX, inferred: true, knobRegion: knob.name };
}

export type CompiledDoorMesh = {
  vertices: Float32Array;
  leaf: { start: number; count: number };
  /** Transparent trailing portion of the leaf, when Studio marked window faces as glass. */
  leafGlass?: { start: number; count: number };
  /** Static wall-frame boxes with the leaf aperture deliberately left empty. */
  collisionBoxes: DoorCollisionBox[];
};

export type DoorCollisionBox = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type CompileDoorMeshResult =
  | { ok: true; mesh: CompiledDoorMesh }
  | { ok: false; error: string };

type VertexBounds = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };

function vertexBounds(vertices: Float32Array, start: number, count: number): VertexBounds | null {
  if (count <= 0 || start < 0 || start + count > vertices.length / 8) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let vertex = start; vertex < start + count; vertex += 1) {
    const at = vertex * 8;
    const x = vertices[at]!, y = vertices[at + 1]!, z = vertices[at + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return Number.isFinite(minX) ? { minX, minY, minZ, maxX, maxY, maxZ } : null;
}

/**
 * A door wall cannot use the generic welded-island fallback: jambs touching a
 * header geometrically weld into one U-shaped component, whose AABB seals the
 * portal. The semantic leaf already measures the aperture, so compile the
 * static frame as left jamb + right jamb + lintel bands around that aperture.
 */
function doorFrameCollisionBoxes(vertices: Float32Array, bodyCount: number, leafStart: number, leafCount: number): DoorCollisionBox[] | null {
  const body = vertexBounds(vertices, 0, bodyCount);
  const leaf = vertexBounds(vertices, leafStart, leafCount);
  if (!body || !leaf) return null;
  const depth = body.maxZ - body.minZ;
  const leafWidth = leaf.maxX - leaf.minX;
  const leafDepth = leaf.maxZ - leaf.minZ;
  if (depth <= 0.001 || leafWidth <= 0.001 || leafWidth < leafDepth) return null;

  const apertureMinX = Math.max(body.minX, leaf.minX);
  const apertureMaxX = Math.min(body.maxX, leaf.maxX);
  const apertureTop = Math.min(body.maxY, leaf.maxY);
  if (apertureMaxX - apertureMinX <= 0.001 || apertureTop - body.minY <= 0.001) return null;

  const boxes: DoorCollisionBox[] = [];
  const add = (minX: number, minY: number, maxX: number, maxY: number) => {
    if (maxX - minX <= 0.001 || maxY - minY <= 0.001) return;
    boxes.push({ minX, minY, minZ: body.minZ, maxX, maxY, maxZ: body.maxZ });
  };
  add(body.minX, body.minY, apertureMinX, apertureTop); // left jamb
  add(apertureMaxX, body.minY, body.maxX, apertureTop); // right jamb
  add(body.minX, apertureTop, body.maxX, body.maxY); // lintel/header
  return boxes.length > 0 ? boxes : null;
}

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
  const vertexCount = vertices.length / 8;
  const glassFirstVertex = doc.glassFirstVertex ?? vertexCount;
  if (glassFirstVertex < 0 || glassFirstVertex > vertexCount || glassFirstVertex % 3 !== 0) {
    return { ok: false, error: 'Door Wall export has an invalid saved glass-face boundary; save the model again and retry.' };
  }
  const glassFirstTriangle = glassFirstVertex / 3;

  const leafRange = doc.ranges[resolved.index];
  if (!leafRange || leafRange.hi <= leafRange.lo) {
    return { ok: false, error: `The "${parts[resolved.index]?.name ?? DOOR_LEAF_PART_NAME}" Outliner part has no saved face range.` };
  }

  let leafTriangles = 0;
  let leafGlassTriangles = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const group = doc.faceGroups ? doc.faceGroups[triangle]! : triangle;
    if (group >= leafRange.lo && group < leafRange.hi) {
      leafTriangles += 1;
      if (triangle >= glassFirstTriangle) leafGlassTriangles += 1;
    }
  }
  if (leafTriangles === 0) {
    return { ok: false, error: `The "${parts[resolved.index]?.name ?? DOOR_LEAF_PART_NAME}" Outliner part is empty; give the door panel geometry before export.` };
  }
  if (leafTriangles === triangleCount) {
    return { ok: false, error: 'Door Wall export needs static frame geometry in addition to the Door Leaf.' };
  }
  const leafOpaqueTriangles = leafTriangles - leafGlassTriangles;
  if (leafOpaqueTriangles === 0) {
    return { ok: false, error: 'Door Wall export needs opaque Door Leaf geometry around any glass window faces.' };
  }

  const bodyTriangles = triangleCount - leafTriangles;
  const bodyFloats = bodyTriangles * 24;
  const leafOpaqueFloats = leafOpaqueTriangles * 24;
  const out = new Float32Array(vertices.length);
  let bodyAt = 0;
  let leafAt = bodyFloats;
  let leafGlassAt = bodyFloats + leafOpaqueFloats;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const group = doc.faceGroups ? doc.faceGroups[triangle]! : triangle;
    const sourceAt = triangle * 24;
    const source = vertices.subarray(sourceAt, sourceAt + 24);
    if (group >= leafRange.lo && group < leafRange.hi) {
      if (triangle >= glassFirstTriangle) {
        out.set(source, leafGlassAt);
        leafGlassAt += 24;
      } else {
        out.set(source, leafAt);
        leafAt += 24;
      }
    } else {
      out.set(source, bodyAt);
      bodyAt += 24;
    }
  }

  const leaf = { start: bodyFloats / 8, count: (leafTriangles * 24) / 8 };
  const leafGlass = leafGlassTriangles > 0
    ? { start: (bodyFloats + leafOpaqueFloats) / 8, count: (leafGlassTriangles * 24) / 8 }
    : undefined;
  const collisionBoxes = doorFrameCollisionBoxes(out, leaf.start, leaf.start, leaf.count);
  if (!collisionBoxes) {
    return { ok: false, error: 'Door Wall export could not derive an open frame around the Door Leaf; keep the leaf inside a wall frame and aligned across local X.' };
  }

  return {
    ok: true,
    mesh: {
      vertices: out,
      // MESH_PROPS ranges are in VERTICES, not floats.
      leaf,
      ...(leafGlass ? { leafGlass } : {}),
      collisionBoxes,
    },
  };
}
