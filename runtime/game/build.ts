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
import { callHost, hasHost } from '../ffi';

// The static BUILD_CATALOG ids, IN THE SAME ORDER as framework/game/build.zig
// BUILD_CATALOG (the index the host fns key on). MUST stay in lockstep with that
// array — a drift mis-picks pieces. The editor may clone this small id list
// (static data); all placement math stays host-owned.
export const BUILD_CATALOG_IDS: readonly string[] = [
  'wall.concrete.common', 'wall.brick.downtown', 'wall.stucco.suburb', 'wall.stucco.motel',
  'wall.metal.industrial', 'wall.plywood.trap_lot', 'wall.storefront.downtown',
  'wall.concrete.doorway', 'wall.concrete.openDoorway', 'wall.metal.garageDoor',
  'wall.stucco.window', 'wall.stucco.doubleWindow', 'wall.plywood.brokenWindow',
  'floor.concrete.common', 'floor.wood.suburb',
  'roof.flat.common', 'roof.gable.suburb', 'roof.gableSteep.suburb', 'roof.shed.common',
  'roof.shedSteep.common', 'roof.shingle.suburb',
  'ramp.concrete.common', 'stairs.wood.common', 'stairs.concrete.common',
  'stairs.metal.industrial', 'stairs.wood.narrow', 'elevator.metal.common',
  'pillar.concrete.common', 'corner.concrete.common', 'arch.concrete.downtown',
  'fence.chainlink.trap_lot', 'fence.wood.suburb', 'railing.metal.motel',
  'trim.cornice.downtown', 'sign.shop.downtown', 'sign.pole.common',
];

const CATALOG_INDEX: ReadonlyMap<string, number> = new Map(BUILD_CATALOG_IDS.map((id, i) => [id, i]));

/** Catalog index for a piece id, or -1 (props/cooked ids aren't in the static catalog). */
export function buildCatalogIndex(pieceId: string): number {
  return CATALOG_INDEX.get(pieceId) ?? -1;
}

/** Whether the host build binding is live (i.e. the framework was built with
 *  -Dhas-game-build). When false, callers should keep their TS path. */
export function buildHostLive(): boolean {
  return hasHost('__game_build_raycast');
}

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

/** Host-raycast a placed-piece list and return the HIT PIECE with its ray
 *  distance + the hit point/outward face normal (world space — what the face
 *  painter classifies into a slot role), or `null` for a genuine miss, or
 *  `undefined` when the host binding isn't live (the framework hasn't been
 *  built with -Dhas-game-build) — callers should keep their existing path in
 *  that case. Non-catalog pieces (authored/props/cooked ids) are skipped since
 *  the static catalog index doesn't cover them — callers with such pieces run
 *  their own pick and merge by distance. */
export function pickBuildPieceHostHit<T extends { pieceId: string; x: number; y: number; z: number; yawDegrees: number }>(
  ray: BuildRay,
  pieces: readonly T[],
  maxDistance: number,
): { piece: T; t: number; point: Vec3; normal: Vec3 } | null | undefined {
  if (!buildHostLive()) return undefined;
  const lite: BuildPieceLite[] = [];
  const orig: number[] = [];
  for (let i = 0; i < pieces.length; i += 1) {
    const ci = buildCatalogIndex(pieces[i]!.pieceId);
    if (ci < 0) continue; // authored/props/cooked: not in the static catalog
    lite.push({ catalogIndex: ci, x: pieces[i]!.x, y: pieces[i]!.y, z: pieces[i]!.z, yawDegrees: pieces[i]!.yawDegrees });
    orig.push(i);
  }
  const hit = raycastBuild(ray, lite, maxDistance);
  if (!hit) return null;
  const piece = pieces[orig[hit.pieceIndex]!];
  return piece ? { piece, t: hit.t, point: hit.point, normal: hit.normal } : null;
}

/** pickBuildPieceHostHit without the distance — the original piece-only shape. */
export function pickBuildPieceHost<T extends { pieceId: string; x: number; y: number; z: number; yawDegrees: number }>(
  ray: BuildRay,
  pieces: readonly T[],
  maxDistance: number,
): T | null | undefined {
  const hit = pickBuildPieceHostHit(ray, pieces, maxDistance);
  return hit === undefined ? undefined : hit?.piece ?? null;
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

// Semantic architecture uses one bounded/versioned Uint8Array protocol. These
// functions deliberately do not parse packets: the active editor owns DTO
// serialization while native owns catalog validation, topology, mutation, and
// compilation. Keeping this door byte-only prevents domain logic from leaking
// into the generic runtime ingredient wrapper.
export type ArchitecturePacket = Uint8Array;

export const ARCHITECTURE_HOST_NAMES = {
  catalogValidate: '__game_build_arch_catalog_validate',
  catalogInstall: '__game_build_arch_catalog_install',
  catalogQuery: '__game_build_arch_catalog_query',
  sourceValidate: '__game_build_arch_source_validate',
  mutate: '__game_build_arch_mutate',
  compile: '__game_build_arch_compile',
  raycast: '__game_build_arch_raycast',
  openingSlots: '__game_build_arch_opening_slots',
  migrateV4: '__game_build_arch_migrate_v4',
  scaleMetadata: '__game_build_arch_scale_metadata',
  catalogRows: '__game_build_arch_catalog_rows',
} as const;

export type ArchitectureHostOperation = keyof typeof ARCHITECTURE_HOST_NAMES;

export function architectureHostLive(): boolean {
  return hasHost(ARCHITECTURE_HOST_NAMES.sourceValidate)
    && hasHost(ARCHITECTURE_HOST_NAMES.mutate)
    && hasHost(ARCHITECTURE_HOST_NAMES.compile);
}

function callArchitecturePacket(
  operation: ArchitectureHostOperation,
  request: ArchitecturePacket,
): ArchitecturePacket | null {
  const hostName = ARCHITECTURE_HOST_NAMES[operation];
  if (!hasHost(hostName)) return null;
  const result = callHost<unknown>(hostName, null, request);
  return result instanceof Uint8Array ? result : null;
}

export function validateArchitectureCatalogPacket(request: ArchitecturePacket): ArchitecturePacket | null {
  return callArchitecturePacket('catalogValidate', request);
}

export function installArchitectureCatalogPacket(request: ArchitecturePacket): ArchitecturePacket | null {
  return callArchitecturePacket('catalogInstall', request);
}

export function queryArchitectureCatalogPacket(request: ArchitecturePacket): ArchitecturePacket | null {
  return callArchitecturePacket('catalogQuery', request);
}

export function validateArchitectureSourcePacket(request: ArchitecturePacket): ArchitecturePacket | null {
  return callArchitecturePacket('sourceValidate', request);
}

export function mutateArchitecturePacket(request: ArchitecturePacket): ArchitecturePacket | null {
  return callArchitecturePacket('mutate', request);
}

export function compileArchitecturePacket(request: ArchitecturePacket): ArchitecturePacket | null {
  return callArchitecturePacket('compile', request);
}

export function raycastArchitecturePacket(request: ArchitecturePacket): ArchitecturePacket | null {
  return callArchitecturePacket('raycast', request);
}

export function enumerateArchitectureOpeningSlotsPacket(request: ArchitecturePacket): ArchitecturePacket | null {
  return callArchitecturePacket('openingSlots', request);
}

export function migrateArchitectureV4Packet(request: ArchitecturePacket): ArchitecturePacket | null {
  return callArchitecturePacket('migrateV4', request);
}

export function readArchitectureScalePacket(request: ArchitecturePacket): ArchitecturePacket | null {
  return callArchitecturePacket('scaleMetadata', request);
}

export function readMeasuredArchitectureCatalogPacket(request: ArchitecturePacket): ArchitecturePacket | null {
  return callArchitecturePacket('catalogRows', request);
}
