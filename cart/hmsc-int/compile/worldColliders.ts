// worldColliders.ts — bake the AUTHORED physics colliders + player config into
// map lumps the no-V8 loader steps against, so the shipped game's collision and
// movement are byte-identical to the editor's play view.
//
// THE BUG THIS FIXES: world_loader.zig used to re-derive wall colliders by
// guessing from the render boxes (core + face slabs), which has NONE of the
// authored meaning — no wall-join at a "+", no door opening, no half-height, no
// ramp-trim — and it hardcoded its own player radius/speed/gravity. So a "+"
// wall collided where the boxes happened to land, not where the wall looked
// (invisible walls), and the player moved at a different speed than in /test.
//
// THE FIX: ship the SAME solids the editor's live play steps against —
// GAME_BUILD.placed.colliders (placedPieceColliders, the +-join-aware bands) and
// GAME_BUILD.placed.ramps (placedPieceRamps slopes) — packed in the host's exact
// wire order, plus the editor's player tuning + walk/run speeds. world_loader
// consumes these directly; the instance-derived path stays only as a fallback
// for game-files baked before this lump existed.

import { GAME_BUILD, type CollisionRect, type Heightfield, type OrientedCollisionRect, type PhysicsTuning, type PlacedBuildPiece } from '@game';
import { CHUNK_TILES } from '../chunks';
import { floorHasRelief } from './worldGeometry';
import type { ChunkFloor } from '../chunkFloor';

export const COLLIDERS_LUMP_VERSION = 1;
export const PHYSICS_CONFIG_LUMP_VERSION = 1;

// Host wire order (mirrors hmsc-int/game/physics.ts writeRect + the host step):
// a blocking rect is 9 floats, an oriented rect is those 9 + pivot/yaw.
const RECT_FLOATS = 9;
const ORIENTED_FLOATS = 12;
// floorMeters sentinel for "solid all the way to the ground" — matches the host.
const SOLID_TO_GROUND = -1e9;
// The painted-floor render slab (pushPaintedFloors in worldGeometry.ts) sits 0.1m
// tall on the height sample, so its WALKABLE TOP is height + 0.1. A flat chunk's
// collision heightfield must put its surface there so you stand on the floor you
// see, not 10cm inside it.
const PAINTED_FLOOR_SLAB_TOP_METERS = 0.1;
// Matches the relief-floor heightfield walkable-slope gate in worldGeometry.ts.
const FLOOR_WALKABLE_SLOPE_COS = Math.cos((38 * Math.PI) / 180);

/** The player physics config the editor's play view uses, gathered for the bake
 *  so the shipped game shares one source of truth. `walk`/`run` are the active
 *  player's locomotion speeds (m/s); the rest is the PhysicsTuning every step
 *  feeds the host. Surface accel/friction/restitution are the flat baseline the
 *  loader applies (per-tile surface feel is a /test-only refinement for now). */
export type BakedPhysicsConfig = {
  tuning: PhysicsTuning;
  accelerationMultiplier: number;
  surfaceFriction: number;
  surfaceRestitution: number;
  walkSpeedMetersPerSecond: number;
  runSpeedMetersPerSecond: number;
};

function rectFloats(rect: CollisionRect): number[] {
  return [
    rect.minX,
    rect.minZ,
    rect.maxX,
    rect.maxZ,
    rect.topMeters,
    rect.blocksPlayer ? 1 : 0,
    rect.friction,
    rect.restitution,
    rect.floorMeters ?? SOLID_TO_GROUND,
  ];
}

function orientedFloats(rect: OrientedCollisionRect): number[] {
  return [...rectFloats(rect), rect.pivotX, rect.pivotZ, rect.yawRadians];
}

export type BakedColliders = {
  rects: number[]; // flat, RECT_FLOATS per rect
  oriented: number[]; // flat, ORIENTED_FLOATS per oriented rect
  ramps: Heightfield[];
};

/** One collision heightfield for a FLAT painted chunk — the same per-chunk
 *  ground /test colliders against, so the loader never has to rasterize the
 *  painted floor into thousands of per-cell rects (which blew the host's rect
 *  cap and forced spatial windowing on even a small map). Relief chunks already
 *  ship as heightfields in the HEIGHTFIELDS lump; this is ONLY the flat ones. */
function flatChunkField(f: ChunkFloor, slot: number): Heightfield | null {
  const tcols = f.tileData[0] | 0;
  const trows = f.tileData[1] | 0;
  if (tcols <= 0 || trows <= 0) return null; // nothing painted — no ground here
  // A flat chunk is a plane, so a 2×2 grid spanning the whole chunk is exact and
  // keeps the lump tiny (4 samples vs a full tile-res grid). The level is the
  // chunk's height (≈uniform by definition of flat); the surface is lifted to the
  // painted slab top so you stand on the floor you see.
  const level = f.heights && f.heights.length > 0 ? (f.heights[0] ?? 0) : 0;
  return {
    slot,
    originX: f.cx * CHUNK_TILES,
    originZ: f.cz * CHUNK_TILES,
    cellSizeMeters: CHUNK_TILES, // (cols-1)=1 cell spans the whole chunk
    cols: 2,
    rows: 2,
    baseY: level + PAINTED_FLOOR_SLAB_TOP_METERS,
    walkableSlopeCos: FLOOR_WALKABLE_SLOPE_COS,
    heights: new Float32Array([0, 0, 0, 0]),
    yawRadians: 0,
    pivotX: f.cx * CHUNK_TILES,
    pivotZ: f.cz * CHUNK_TILES,
  };
}

/** The PAINTED-FLOOR walkable surface at (x, z), or null when no chunk covers
 *  the point — the same per-chunk law the colliders above ship: a FLAT chunk
 *  stands you on its slab top (level + PAINTED_FLOOR_SLAB_TOP_METERS), a
 *  relief/road chunk on its height grid (the draped heightfield surface).
 *  This is the terrain the bake's piece/prop lifts must rest things on
 *  (req_0630: a tree on a painted hill shipped buried at y=0 because the lift
 *  sampled only state.world.landforms — the live painted hill exists ONLY in
 *  the session floors). Nearest-sample, matching the loader's ground walk. */
export function paintedFloorTopAt(floors: readonly ChunkFloor[], x: number, z: number): number | null {
  let best: number | null = null;
  for (const f of floors) {
    const originX = f.cx * CHUNK_TILES;
    const originZ = f.cz * CHUNK_TILES;
    if (x < originX || z < originZ || x > originX + CHUNK_TILES || z > originZ + CHUNK_TILES) continue;
    const tcols = f.tileData[0] | 0;
    const trows = f.tileData[1] | 0;
    if (tcols <= 0 || trows <= 0) continue; // nothing painted — void
    let top: number;
    if (floorHasRelief(f)) {
      const hcols = Math.max(1, f.hcols);
      const hrows = Math.max(1, f.hrows);
      if (!f.heights || f.heights.length < hcols * hrows) continue;
      const hCell = hcols > 1 ? CHUNK_TILES / (hcols - 1) : CHUNK_TILES;
      const hi = Math.min(hcols - 1, Math.max(0, Math.round((x - originX) / hCell)));
      const hj = Math.min(hrows - 1, Math.max(0, Math.round((z - originZ) / hCell)));
      top = f.heights[hj * hcols + hi] ?? 0;
    } else {
      const level = f.heights && f.heights.length > 0 ? (f.heights[0] ?? 0) : 0;
      top = level + PAINTED_FLOOR_SLAB_TOP_METERS;
    }
    if (best === null || top > best) best = top;
  }
  return best;
}

/** Build the authored colliders for the placed pieces (the +-join-aware wall /
 *  floor / pillar bands + the ramp/stair slopes) PLUS one collision heightfield
 *  per FLAT painted chunk. The painted ground travels as heightfields, NOT
 *  per-cell rects, so a barely-built map stays far under the host rect cap.
 *  `fieldStartSlot` is where these heightfields' host slots begin (after the
 *  relief-floor heightfields the HEIGHTFIELDS lump already owns). */
export function buildBakedColliders(
  pieces: readonly PlacedBuildPiece[],
  floors: readonly ChunkFloor[] = [],
  fieldStartSlot = 0,
): BakedColliders {
  const { rects, orientedRects } = GAME_BUILD.placed.colliders(pieces);
  // Elevator cars are NOT here (REQ-0652): placed.colliders omits the car
  // (live collision) and the ELEVATORS lump ships the shafts — the loader
  // appends one LIVE car rect per shaft and rides it, exactly like /test.
  const ramps = GAME_BUILD.placed.ramps(pieces, fieldStartSlot);
  const flatFields: Heightfield[] = [];
  let slot = fieldStartSlot + ramps.length;
  for (const f of floors) {
    if (floorHasRelief(f)) continue; // relief chunks ship in the HEIGHTFIELDS lump
    const field = flatChunkField(f, slot);
    if (field) {
      flatFields.push(field);
      slot += 1;
    }
  }
  return {
    rects: rects.flatMap(rectFloats),
    oriented: orientedRects.flatMap(orientedFloats),
    ramps: [...ramps, ...flatFields],
  };
}

/** Encode the COLLIDERS lump (see runtime/workspace/lumps.ts for the layout). */
export function encodeCollidersLump(colliders: BakedColliders): Uint8Array {
  const rectCount = Math.floor(colliders.rects.length / RECT_FLOATS);
  const orientedCount = Math.floor(colliders.oriented.length / ORIENTED_FLOATS);
  let rampFloats = 0;
  for (const ramp of colliders.ramps) rampFloats += 8 + ramp.cols * ramp.rows; // 8 scalar f32 (+2 u32 cols/rows fit the same 4 bytes)

  // bytes: version(4) | rectCount(4) | rects | orientedCount(4) | oriented |
  //        rampCount(4) | per ramp: 3 f32 + 2 u32 + 5 f32 + cols*rows f32
  const headerFloats = 1 /*version*/ + 1 /*rectCount*/ + colliders.rects.length + 1 /*orientedCount*/ + colliders.oriented.length + 1 /*rampCount*/;
  const rampScalarFloatsPerRamp = 10; // originX,originZ,cellSize,(cols),(rows),baseY,walkCos,yawRad,pivotX,pivotZ
  const totalFloats = headerFloats + colliders.ramps.length * rampScalarFloatsPerRamp + colliders.ramps.reduce((n, r) => n + r.cols * r.rows, 0);
  void rampFloats;

  const out = new Uint8Array(totalFloats * 4);
  const view = new DataView(out.buffer);
  let at = 0;
  const f32 = (v: number) => { view.setFloat32(at, v, true); at += 4; };
  const u32 = (v: number) => { view.setUint32(at, v >>> 0, true); at += 4; };

  u32(COLLIDERS_LUMP_VERSION);
  u32(rectCount);
  for (const v of colliders.rects) f32(v);
  u32(orientedCount);
  for (const v of colliders.oriented) f32(v);
  u32(colliders.ramps.length);
  for (const ramp of colliders.ramps) {
    f32(ramp.originX);
    f32(ramp.originZ);
    f32(ramp.cellSizeMeters);
    u32(ramp.cols);
    u32(ramp.rows);
    f32(ramp.baseY);
    f32(ramp.walkableSlopeCos);
    f32(ramp.yawRadians ?? 0);
    f32(ramp.pivotX ?? ramp.originX);
    f32(ramp.pivotZ ?? ramp.originZ);
    for (let i = 0; i < ramp.cols * ramp.rows; i += 1) f32(ramp.heights[i] ?? 0);
  }
  return out;
}

/** Encode the PHYSICS_CONFIG lump (see runtime/workspace/lumps.ts). */
export function encodePhysicsConfigLump(config: BakedPhysicsConfig): Uint8Array {
  const t = config.tuning;
  const floats = [
    t.gravityMetersPerSecondSquared,
    t.jumpSpeedMetersPerSecond,
    t.playerCapsuleRadiusMeters,
    t.playerCapsuleHeightMeters,
    t.playerStepHeightMeters,
    t.wallRestitution,
    t.bodyRestitution,
    t.walkableRectSidePushGraceMeters ?? 0.08,
    config.accelerationMultiplier,
    config.surfaceFriction,
    config.surfaceRestitution,
    config.walkSpeedMetersPerSecond,
    config.runSpeedMetersPerSecond,
  ];
  const out = new Uint8Array(4 + floats.length * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, PHYSICS_CONFIG_LUMP_VERSION, true);
  for (let i = 0; i < floats.length; i += 1) view.setFloat32(4 + i * 4, floats[i], true);
  return out;
}
