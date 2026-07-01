// runtime/game/build.ts — the editor's build-placement DOOR.
//
// Wraps the host-owned build placement (__game_build_*, framework/game/build.zig,
// ported verbatim from cart/hmsc-int/game/build/*.ts per USER ASK req_2349). This
// is what lets the iso world editor stop cross-importing the entire game cart
// (req_2178) just to place a floor: it calls these host fns instead.
//
// Importing this file is the source-driven gate signal — it flips -Dhas-game-build
// (sdk/dependency-registry.json `game-build`), so a cart pays for the host binding
// only when it actually places build pieces.
//
// Pieces cross as CATALOG INDICES (0..catalog length), never strings — the editor
// mirrors the small id/label list (static data it may clone) and passes indices;
// all placement math stays host-owned.
import { callHost } from '../ffi';

export type Vec3 = { x: number; y: number; z: number };
export type BuildPieceLite = { catalogIndex: number; x: number; y: number; z: number; yawDegrees: number };
export type BuildRay = { origin: Vec3; dir: Vec3 };
export type BuildHit = { pieceIndex: number; t: number; point: Vec3; normal: Vec3 };
export type BuildValidation = {
  valid: boolean;
  unknownPiece: boolean;
  kindAcceptsNoEdits: boolean;
  positionNotFinite: boolean;
};

const RAYCAST_HEADER = 8; // ox,oy,oz, dx,dy,dz, maxDist, count
const PIECE_STRIDE = 5; // catIdx, x, y, z, yaw

/** Nearest placed piece under the ray within maxDistance, or null (host raycast
 *  — the oriented-box slab test lives in Zig). pieceIndex indexes `pieces`. */
export function raycastBuild(ray: BuildRay, pieces: readonly BuildPieceLite[], maxDistance: number): BuildHit | null {
  const buf = new Float32Array(RAYCAST_HEADER + pieces.length * PIECE_STRIDE);
  buf[0] = ray.origin.x; buf[1] = ray.origin.y; buf[2] = ray.origin.z;
  buf[3] = ray.dir.x; buf[4] = ray.dir.y; buf[5] = ray.dir.z;
  buf[6] = maxDistance; buf[7] = pieces.length;
  for (let i = 0; i < pieces.length; i += 1) {
    const b = RAYCAST_HEADER + i * PIECE_STRIDE;
    const p = pieces[i]!;
    buf[b] = p.catalogIndex; buf[b + 1] = p.x; buf[b + 2] = p.y; buf[b + 3] = p.z; buf[b + 4] = p.yawDegrees;
  }
  const ab = callHost<ArrayBuffer | null>('__game_build_raycast', null, buf);
  if (!ab) return null;
  const out = new Float32Array(ab);
  if (out[1]! < 0.5) return null; // hitFlag 0 = clean miss
  return {
    pieceIndex: out[2]!,
    t: out[3]!,
    point: { x: out[4]!, y: out[5]!, z: out[6]! },
    normal: { x: out[7]!, y: out[8]!, z: out[9]! },
  };
}

/** Validate a placement (host validatePlacement). editIndex < 0 ⇒ no edit. */
export function validateBuildPlacement(
  catalogIndex: number,
  x: number,
  y: number,
  z: number,
  yawDegrees: number,
  editIndex = -1,
): BuildValidation {
  const bits = callHost<number>('__game_build_validate', 1, catalogIndex, x, y, z, yawDegrees, editIndex);
  return {
    valid: bits === 0,
    unknownPiece: (bits & 1) !== 0,
    kindAcceptsNoEdits: (bits & 2) !== 0,
    positionNotFinite: (bits & 4) !== 0,
  };
}

/** BUILD_CATALOG length (palette bootstrap). */
export function buildCatalogCount(): number {
  return callHost<number>('__game_build_catalog_count', 0);
}
