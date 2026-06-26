// edges.test.ts — the edge-aware void (USER req_1970): the boundary profile, the
// river/sea split, and the shell continuing a road through the void. Pure modules.

import { assert, assertEqual, finish, test } from '../_testkit';
import type { WorldState } from '../../design';
import type { WorldCore } from './distance';
import { buildEdgeProfile, SEA_SPAN_METERS, type EdgeProfile } from './edges';
import { buildVoidWaterBodies, voidWaterFootprints } from './voidWater';
import { buildShellBatch } from './shell';

const CORE: WorldCore = { minX: 0, minZ: 0, maxX: 240, maxZ: 240, centerX: 120, centerZ: 120 };

// A world stub carrying only what the edge profile reads (no painted tiles, so no
// road exits are sampled — the road path is exercised directly via the shell test).
function waterWorld(bodies: WorldState['waterBodies']): WorldState {
  return {
    cellSizeMeters: 1,
    surfaceRegions: [],
    placedCells: {},
    landforms: [],
    waterBodies: bodies,
  } as unknown as WorldState;
}

test('a small water body at the edge profiles as a RIVER; a wide one as a SEA', () => {
  // Body spanning z 80..160 (span 80) reaching the +X edge → river.
  const river = buildEdgeProfile(waterWorld([
    { id: 'pond', label: 'p', shape: 'rect', x: 180, z: 80, width: 120, depth: 80, surfaceY: 0.5, createdByCommand: 't' },
  ]), CORE);
  assertEqual(river.waterEdges.length, 1, 'one water edge detected at +X');
  assertEqual(river.waterEdges[0]!.nx, 1, 'outward normal points +X');
  assert(river.waterEdges[0]!.span < SEA_SPAN_METERS && !river.waterEdges[0]!.sea, 'span under threshold → river');

  // Body spanning the whole z extent (span 240 ≥ threshold) → sea.
  const sea = buildEdgeProfile(waterWorld([
    { id: 'gulf', label: 'g', shape: 'rect', x: 180, z: 9, width: 120, depth: 222, surfaceY: 0.5, createdByCommand: 't' },
  ]), CORE);
  assert(sea.waterEdges[0]!.span >= SEA_SPAN_METERS && sea.waterEdges[0]!.sea, 'wide span → sea');
});

test('void water continues outward and stays seeded (river chain vs one sea rect)', () => {
  const riverEdge = buildEdgeProfile(waterWorld([
    { id: 'pond', label: 'p', shape: 'rect', x: 180, z: 80, width: 120, depth: 80, surfaceY: 0.5, createdByCommand: 't' },
  ]), CORE);
  const riverA = buildVoidWaterBodies(riverEdge, 8);
  const riverB = buildVoidWaterBodies(riverEdge, 8);
  assert(riverA.length > 1, 'river is a chain of segments stepping outward');
  assert(riverA.every((b) => b.x + b.width > CORE.maxX - 1), 'river segments sit outside the core');
  assert(riverA.every((b, i) => b.x === riverB[i]!.x && b.z === riverB[i]!.z), 'seeded — identical on rebuild');
  // Meander: not every segment shares the same lateral centre (a straight canal would).
  const centres = new Set(riverA.map((b) => Math.round(b.z + b.depth / 2)));
  assert(centres.size > 1, 'the channel wanders (seeded meander), not a straight canal');

  const seaEdge = buildEdgeProfile(waterWorld([
    { id: 'gulf', label: 'g', shape: 'rect', x: 180, z: 9, width: 120, depth: 222, surfaceY: 0.5, createdByCommand: 't' },
  ]), CORE);
  const sea = buildVoidWaterBodies(seaEdge, 8);
  assertEqual(sea.length, 1, 'a sea is one wide opening, not a chain');
  assert(sea[0]!.width >= 8 * 160, 'the sea reaches the horizon ring');
});

// A road exit on the +X edge at z=120, ten metres wide.
const ROAD_EDGE: EdgeProfile = { roadExits: [{ x: 240, z: 120, nx: 1, nz: 0, width: 10 }], waterEdges: [] };
const ROAD_COLOR = [0.13, 0.13, 0.15];
function rows(data: number[]): number[][] {
  return Array.from({ length: data.length / 9 }, (_, i) => data.slice(i * 9, i * 9 + 9));
}
const isRoad = (r: number[]) => Math.abs(r[6]! - ROAD_COLOR[0]!) < 1e-6 && Math.abs(r[7]! - ROAD_COLOR[1]!) < 1e-6 && Math.abs(r[8]! - ROAD_COLOR[2]!) < 1e-6;
const isBuilding = (r: number[]) => r[6]! >= 0.3; // colorForHeight floor; road/ground are darker

test('a road exit seams straight out through the void shell', () => {
  // Focus a couple hundred metres past the +X edge, on the road line.
  const batch = buildShellBatch(440, 120, CORE, 2, ROAD_EDGE, []);
  const corridor = rows(batch.data).filter((r) => isRoad(r) && r[0]! > 240 && Math.abs(r[2]! - 120) < 6);
  assert(corridor.length > 0, 'road boxes continue outward along the corridor centerline');

  // No tower sprouts on the open road seam.
  const onSeam = rows(batch.data).filter((r) => isBuilding(r) && Math.abs(r[2]! - 120) < 10 && r[0]! > 240);
  assertEqual(onSeam.length, 0, 'buildings step aside for the road corridor');

  // Without the edge profile the same window has no road continuation at z=120.
  const blind = rows(buildShellBatch(440, 120, CORE, 2).data).filter((r) => isRoad(r) && Math.abs(r[2]! - 120) < 6 && r[0]! > 240);
  assertEqual(blind.length, 0, 'edge-blind shell draws no corridor (proves the seam is edge-driven)');
});

test('void water suppresses shell buildings inside its footprint', () => {
  // A water rect covering a chunk just past the +X edge.
  const water = [{ minX: 240, minZ: 80, maxX: 560, maxZ: 160 }];
  const batch = buildShellBatch(440, 120, CORE, 2, { roadExits: [], waterEdges: [] }, water);
  const towersInWater = rows(batch.data).filter((r) => isBuilding(r) && r[0]! >= 240 && r[0]! <= 560 && r[2]! >= 80 && r[2]! <= 160);
  assertEqual(towersInWater.length, 0, 'no buildings bake inside the void-water footprint');
});

void voidWaterFootprints; // re-exported helper, exercised via the shell wiring
finish('void edges (req_1970)');
