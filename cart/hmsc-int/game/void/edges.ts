// void/edges.ts — the EDGE PROFILE: what authored features touch the core's
// perimeter, so the procedural shell can CONTINUE them outward instead of
// dropping generic filler against them (USER req_1970, SKYBOX_PLAYBOOK §1: the
// road seams contiguously into the void; the water opens to the coast).
//
// Seam 1's shell was edge-BLIND — every void chunk got the same hash ground +
// street-cross + buildings regardless of what it grew out of, which reads as
// "filler slop" the moment a road or a lake hits the map edge and just stops.
// This module reads the boundary once and answers: "a road exits here, headed
// THIS way, THIS wide" and "water reaches the edge here, THIS wide". The shell
// (game/void/shell.ts) and the void-water generator (game/void/voidWater.ts)
// consume it; both the live editor batch and the compiled bake share the ONE
// profile (rule of two — no second copy to drift).
//
// Everything is a pure function of the authored world + core rectangle, so it is
// testable headless and deterministic (discipline #3).

import type { WorldState } from '../../design';
import { footingKindAtWorldPosition, type WorldGridState } from '../world';
import type { WorldCore } from './distance';

// Tile kinds that read as "a road leaves the city here". The sidewalk ISN'T one
// — a sidewalk butting the edge shouldn't sprout a highway — but the drivable
// surfaces and their crossings/lots are. Matches game/kinds/tiles road family.
const ROAD_TILES = new Set(['road', 'asphalt', 'junction', 'crosswalk', 'parking']);

// Perimeter sampling step (m). Fine enough to catch a single-lane road (~9 m)
// without missing it between samples, coarse enough that one profile build is a
// few hundred footing lookups, done once and memoized on the world.
const SAMPLE_STEP_METERS = 4;
// Read the authored surface this far INSIDE the edge — the map's last honest
// cell, never a point already outside the rectangle.
const EDGE_INSET_METERS = 2;
// A water body counts as "reaching" an edge when its far side comes within this
// of the boundary (painted bodies rarely land exactly on it).
const WATER_EDGE_EPS_METERS = 8;
// A road run shorter than this along the edge is noise (a corner clip), not a
// real exit.
const MIN_ROAD_EXIT_METERS = 5;
// Water touching the edge wider than this opens into the SEA / coast (the
// playbook's forbidden crossing); narrower seams into a RIVER. The user's rule:
// "size decides — small→river, big→sea". ~1.5 shell chunks.
export const SEA_SPAN_METERS = 220;

// The four core edges, each with its outward unit normal (axis-aligned — the
// rectangle's sides). Continuations run straight out along these, which reads
// clean against the axis road grid.
export type EdgeSide = 'minX' | 'maxX' | 'minZ' | 'maxZ';
const SIDE_NORMAL: Record<EdgeSide, [number, number]> = {
  minX: [-1, 0], maxX: [1, 0], minZ: [0, -1], maxZ: [0, 1],
};

// A road that leaves the authored map: where it crosses the boundary, the
// outward direction it heads, and how wide it is along the edge.
export type RoadExit = {
  x: number; z: number;     // boundary-crossing midpoint (world metres)
  nx: number; nz: number;   // outward unit normal (axis-aligned)
  width: number;            // road width measured along the edge (m)
};

// Water that reaches the authored map's edge: the crossing midpoint, outward
// direction, how wide it is along the edge, its surface height, and whether it's
// big enough to open into a sea (vs seam into a river).
export type WaterEdge = {
  x: number; z: number;
  nx: number; nz: number;
  span: number;             // water width along the edge (m)
  surfaceY: number;
  sea: boolean;             // span ≥ SEA_SPAN_METERS → coast/sea, else river
};

export type EdgeProfile = { roadExits: RoadExit[]; waterEdges: WaterEdge[] };

export const EMPTY_EDGE_PROFILE: EdgeProfile = { roadExits: [], waterEdges: [] };

// Walk one edge sampling the authored footing kind just inside it; emit a
// RoadExit per contiguous run of road-family tiles. `along` returns the world
// point at parameter t (metres) along that edge's inset line.
function roadExitsOnEdge(
  grid: WorldGridState,
  side: EdgeSide,
  length: number,
  along: (t: number) => { x: number; z: number },
): RoadExit[] {
  const [nx, nz] = SIDE_NORMAL[side];
  const exits: RoadExit[] = [];
  let runStart = -1; // t where the current road run began, -1 = not in a run
  let prevT = 0;
  const close = (endT: number) => {
    if (runStart < 0) return;
    const width = endT - runStart;
    if (width >= MIN_ROAD_EXIT_METERS) {
      const mid = along((runStart + endT) / 2);
      exits.push({ x: mid.x, z: mid.z, nx, nz, width });
    }
    runStart = -1;
  };
  for (let t = 0; t <= length; t += SAMPLE_STEP_METERS) {
    const p = along(t);
    const kind = footingKindAtWorldPosition(grid, { x: p.x, y: 0, z: p.z });
    const isRoad = kind != null && ROAD_TILES.has(kind);
    if (isRoad && runStart < 0) runStart = t;
    else if (!isRoad && runStart >= 0) close(prevT + SAMPLE_STEP_METERS / 2);
    prevT = t;
  }
  close(length);
  return exits;
}

// Every water body that reaches a given edge → one WaterEdge (a body in a corner
// can reach two edges, emitting one each). The crossing span is the body's
// overlap with the core's extent ALONG that edge.
function waterEdgesFor(world: WorldState, core: WorldCore): WaterEdge[] {
  const out: WaterEdge[] = [];
  for (const b of world.waterBodies ?? []) {
    const bMinX = b.x, bMaxX = b.x + b.width;
    const bMinZ = b.z, bMaxZ = b.z + b.depth;
    // Overlap of the body with the core's span on each axis (clamped to the core
    // so a body sticking far past the edge still reports the on-edge width).
    const ozLo = Math.max(bMinZ, core.minZ), ozHi = Math.min(bMaxZ, core.maxZ);
    const oxLo = Math.max(bMinX, core.minX), oxHi = Math.min(bMaxX, core.maxX);
    const push = (side: EdgeSide, x: number, z: number, span: number) => {
      if (span < MIN_ROAD_EXIT_METERS) return;
      const [nx, nz] = SIDE_NORMAL[side];
      out.push({ x, z, nx, nz, span, surfaceY: b.surfaceY, sea: span >= SEA_SPAN_METERS });
    };
    if (bMaxX >= core.maxX - WATER_EDGE_EPS_METERS && bMinX < core.maxX && ozHi > ozLo)
      push('maxX', core.maxX, (ozLo + ozHi) / 2, ozHi - ozLo);
    if (bMinX <= core.minX + WATER_EDGE_EPS_METERS && bMaxX > core.minX && ozHi > ozLo)
      push('minX', core.minX, (ozLo + ozHi) / 2, ozHi - ozLo);
    if (bMaxZ >= core.maxZ - WATER_EDGE_EPS_METERS && bMinZ < core.maxZ && oxHi > oxLo)
      push('maxZ', (oxLo + oxHi) / 2, core.maxZ, oxHi - oxLo);
    if (bMinZ <= core.minZ + WATER_EDGE_EPS_METERS && bMaxZ > core.minZ && oxHi > oxLo)
      push('minZ', (oxLo + oxHi) / 2, core.minZ, oxHi - oxLo);
  }
  return out;
}

// Read the authored boundary once → the edge profile the shell + void-water
// generators continue outward. Pure; memoize on the world where it's called.
export function buildEdgeProfile(world: WorldState, core: WorldCore): EdgeProfile {
  if (!world || !(core.maxX > core.minX) || !(core.maxZ > core.minZ)) return EMPTY_EDGE_PROFILE;
  const grid = world as unknown as WorldGridState;
  const inset = EDGE_INSET_METERS;
  const wSpan = core.maxX - core.minX;
  const dSpan = core.maxZ - core.minZ;
  const roadExits = [
    ...roadExitsOnEdge(grid, 'minX', dSpan, (t) => ({ x: core.minX + inset, z: core.minZ + t })),
    ...roadExitsOnEdge(grid, 'maxX', dSpan, (t) => ({ x: core.maxX - inset, z: core.minZ + t })),
    ...roadExitsOnEdge(grid, 'minZ', wSpan, (t) => ({ x: core.minX + t, z: core.minZ + inset })),
    ...roadExitsOnEdge(grid, 'maxZ', wSpan, (t) => ({ x: core.minX + t, z: core.maxZ - inset })),
  ];
  return { roadExits, waterEdges: waterEdgesFor(world, core) };
}
