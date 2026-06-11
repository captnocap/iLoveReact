// compile/worldColliders tests — the no-V8 loader steps against THESE baked
// colliders (the editor's +-join-aware solids), so the wire layout the Zig
// decoder (framework/world/constructor.zig decodeColliders / decodePhysicsConfig)
// reads must round-trip exactly here, and a "+" of walls must survive the bake.

import { assert, assertClose, assertEqual, finish, test } from '../game/_testkit';
import { GAME_BUILD, type PlacedBuildPiece } from '@game';
import {
  buildBakedColliders,
  encodeCollidersLump,
  encodePhysicsConfigLump,
  paintedFloorTopAt,
  type BakedPhysicsConfig,
} from './worldColliders';
import { CHUNK_TILES } from '../chunks';
import type { ChunkFloor } from '../chunkFloor';

function anEdgeWall(): string {
  for (const id of GAME_BUILD.catalog.ids as readonly string[]) {
    try {
      const d = GAME_BUILD.catalog.get(id);
      if (d.kind === 'wall' && d.snap === 'edge') return id;
    } catch {
      // unknown id — skip
    }
  }
  return (GAME_BUILD.catalog.ids as readonly string[])[0];
}

const f32eq = (a: number, b: number) => Math.fround(a) === Math.fround(b);

test('a "+" of perpendicular walls bakes to authored solids', () => {
  const wall = anEdgeWall();
  const pieces: PlacedBuildPiece[] = [
    { id: 'bp_1', pieceId: wall, x: 0, y: 0, z: 0, yawDegrees: 0 },
    { id: 'bp_2', pieceId: wall, x: 0, y: 0, z: 0, yawDegrees: 90 },
  ];
  const baked = buildBakedColliders(pieces, [], 0);
  assertEqual(baked.rects.length % 9, 0, 'rects pack as 9-float host rects');
  assertEqual(baked.oriented.length % 12, 0, 'oriented pack as 12-float host rects');
  const solids = baked.rects.length / 9 + baked.oriented.length / 12;
  assert(solids >= 2, 'the + produced a solid per wall arm');
});

test('a flat painted chunk bakes to ONE collision heightfield, not per-cell rects', () => {
  // A 4×4 flat painted chunk (tileData header: cols, rows, palCount, palette…, idx…)
  const tcols = 4;
  const trows = 4;
  const palette = [0.4, 0.4, 0.4];
  const idx = new Array(tcols * trows).fill(0);
  const flatChunk = {
    cx: 0,
    cz: 0,
    tileData: [tcols, trows, 1, ...palette, ...idx],
    heights: new Array(4 * 4).fill(0), // all equal → flat
    hcols: 4,
    hrows: 4,
    hver: 0,
  } as unknown as Parameters<typeof buildBakedColliders>[1][number];
  const baked = buildBakedColliders([], [flatChunk], 0);
  assertEqual(baked.rects.length, 0, 'flat ground adds ZERO per-cell rects');
  assertEqual(baked.ramps.length, 1, 'flat chunk → exactly one collision heightfield');
  assert(baked.ramps[0]!.cols >= 2 && baked.ramps[0]!.rows >= 2, 'heightfield grid is valid');
});

test('COLLIDERS lump round-trips (mirrors constructor.zig decodeColliders)', () => {
  const wall = anEdgeWall();
  const baked = buildBakedColliders(
    [
      { id: 'bp_1', pieceId: wall, x: 0, y: 0, z: 0, yawDegrees: 0 },
      { id: 'bp_2', pieceId: wall, x: 0, y: 0, z: 0, yawDegrees: 90 },
    ],
    [],
    3,
  );
  const lump = encodeCollidersLump(baked);
  const dv = new DataView(lump.buffer, lump.byteOffset, lump.byteLength);
  let at = 0;
  const u32 = () => { const v = dv.getUint32(at, true); at += 4; return v; };
  const f32 = () => { const v = dv.getFloat32(at, true); at += 4; return v; };

  assertEqual(u32(), 1, 'COLLIDERS version');
  const rc = u32();
  assertEqual(rc, baked.rects.length / 9, 'rect count');
  const decRects: number[] = [];
  for (let i = 0; i < rc * 9; i += 1) decRects.push(f32());
  const oc = u32();
  assertEqual(oc, baked.oriented.length / 12, 'oriented count');
  const decOriented: number[] = [];
  for (let i = 0; i < oc * 12; i += 1) decOriented.push(f32());
  const rampN = u32();
  assertEqual(rampN, baked.ramps.length, 'ramp count');
  for (let r = 0; r < rampN; r += 1) {
    f32(); f32(); f32();
    const cols = u32(); const rows = u32();
    f32(); f32(); f32(); f32(); f32();
    for (let i = 0; i < cols * rows; i += 1) f32();
  }
  assertEqual(at, lump.byteLength, 'decoder consumes exactly the lump');
  assert(decRects.every((v, i) => f32eq(v, baked.rects[i])), 'rect floats survive (f32)');
  assert(decOriented.every((v, i) => f32eq(v, baked.oriented[i])), 'oriented floats survive (f32)');
  if (rc > 0) {
    assert(decRects[0] < decRects[2], 'rect minX < maxX (host wire order)');
    assert(decRects[1] < decRects[3], 'rect minZ < maxZ (host wire order)');
  }
});

test('PHYSICS_CONFIG lump round-trips field order', () => {
  const cfg: BakedPhysicsConfig = {
    tuning: {
      gravityMetersPerSecondSquared: 13.5,
      jumpSpeedMetersPerSecond: 5.65,
      playerCapsuleRadiusMeters: 0.34,
      playerCapsuleHeightMeters: 1.65,
      playerStepHeightMeters: 0.35,
      wallRestitution: 0.08,
      bodyRestitution: 0.72,
      walkableRectSidePushGraceMeters: 0.08,
    },
    accelerationMultiplier: 1,
    surfaceFriction: 0.2,
    surfaceRestitution: 0,
    walkSpeedMetersPerSecond: 2.4,
    runSpeedMetersPerSecond: 5.8,
  };
  const pc = encodePhysicsConfigLump(cfg);
  const pv = new DataView(pc.buffer, pc.byteOffset, pc.byteLength);
  assertEqual(pc.byteLength, 4 + 13 * 4, 'version + 13 floats');
  assertEqual(pv.getUint32(0, true), 1, 'PHYSICS_CONFIG version');
  // Field order must match constructor.zig decodePhysicsConfig.
  assertClose(pv.getFloat32(4 + 0 * 4, true), 13.5, 1e-6, 'gravity at slot 0');
  assertClose(pv.getFloat32(4 + 2 * 4, true), 0.34, 1e-6, 'player radius at slot 2');
  assertClose(pv.getFloat32(4 + 11 * 4, true), 2.4, 1e-6, 'walk speed at slot 11');
  assertClose(pv.getFloat32(4 + 12 * 4, true), 5.8, 1e-6, 'run speed at slot 12');
});

test('paintedFloorTopAt mirrors the collider surface law (req_0630)', () => {
  // 3×3 height samples spanning the chunk; a 9.6m peak at the grid center.
  const relief: ChunkFloor = {
    cx: 0,
    cz: 0,
    tileData: [2, 2, 1, 0.5, 0.5, 0.5, 0, 0, 0, 0],
    heights: [0, 0, 0, 0, 9.6, 0, 0, 0, 0],
    hcols: 3,
    hrows: 3,
    hver: 1,
  };
  const flat: ChunkFloor = {
    cx: 1,
    cz: 0,
    tileData: [2, 2, 1, 0.5, 0.5, 0.5, 0, 0, 0, 0],
    heights: [2, 2, 2, 2],
    hcols: 2,
    hrows: 2,
    hver: 1,
  };
  const floors = [relief, flat];
  const mid = CHUNK_TILES / 2;
  assertClose(paintedFloorTopAt(floors, mid, mid)!, 9.6, 1e-6, 'relief chunk stands you on the height grid (the hill the tree rests on)');
  assertClose(paintedFloorTopAt(floors, CHUNK_TILES + mid, mid)!, 2.1, 1e-6, 'flat chunk stands you on the slab top (level + 0.1)');
  assert(paintedFloorTopAt(floors, -10, -10) === null, 'outside every painted chunk is void');
});

finish('worldColliders');
