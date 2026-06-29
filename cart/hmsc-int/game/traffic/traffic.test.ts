// traffic.test.ts — meaning-tests for the ambient traffic seed (P4): the road
// pool reads back the vehicle-preferred cells of a baked nav grid, a seeded sim
// spawns agents on those cells, routes them with the injected host A*, and reads
// EXACT moving poses from the deterministic plans. Pure CPU under tools/v8cli
// (the host A* is stubbed; planMotion/sampleMotion fall back to their JS path).

import { assert, assertEqual, finish, test } from '../_testkit';
import { TILE_KIND_INDEX } from '../kinds';
import type { NavGrid } from '../world/navGrid';
import type { Path, PathPoint } from '../pathing';
import { createTrafficSim, roadCellsFromNav, type TrafficFindPath } from './index';

/** A grid with one horizontal road strip (z = roadRow) of `cols` cells, mud elsewhere. */
function stripGrid(cols: number, rows: number, roadRow: number): NavGrid {
  const road = TILE_KIND_INDEX.road;
  const mud = TILE_KIND_INDEX.mud;
  const kinds = new Uint16Array(cols * rows).fill(mud);
  for (let x = 0; x < cols; x++) kinds[roadRow * cols + x] = road;
  return { origin: [0, 0], cellSize: 1, cols, rows, kinds };
}

/** A straight-line host A* stub: one segment from→to at a fixed generation. */
const straightFind: TrafficFindPath = (_profile, from, to): Path => ({
  points: [from, to] as PathPoint[],
  generation: 1,
});

test('roadCellsFromNav reads back exactly the vehicle-road cells', () => {
  const grid = stripGrid(40, 10, 5);
  const points = roadCellsFromNav(grid);
  assertEqual(points.length, 40, 'one point per road cell on the strip');
  for (const [, z] of points) assertEqual(z, 5.5, 'every road cell sits on the strip row center');
});

test('a seeded sim spawns agents on the road and drives them along exact plans', () => {
  const grid = stripGrid(40, 10, 5);
  const sim = createTrafficSim({ grid, count: 4, seed: 7, vehicleProfile: 1, find: straightFind });
  assertEqual(sim.agents.length, 4, 'four agents populated');
  assert(sim.roadPointCount === 40, 'road pool is the 40 strip cells');

  sim.advance(0);
  const planned = sim.agents.filter((a) => a.plan).length;
  assert(planned >= 1, 'advance routes at least one agent onto a plan');

  const poses0 = sim.poses(0);
  assert(poses0.length === planned, 'poses are read only for agents with a live plan');
  // Sample the same agent at two times — a closed-form plan must have moved it.
  const first = poses0[0];
  const later = sim.poses(1.5).find((p) => p.id === first.id)!;
  const moved = Math.hypot(later.x - first.x, later.z - first.z);
  assert(moved > 0.1, `agent ${first.id} advanced along its route (moved ${moved.toFixed(2)}m)`);
  assert(later.speed > 0, 'agent is in motion mid-route');
});

test('determinism — same seed + grid reproduces the same spawn cells', () => {
  const grid = stripGrid(40, 10, 5);
  const a = createTrafficSim({ grid, count: 5, seed: 42, vehicleProfile: 1, find: straightFind });
  const b = createTrafficSim({ grid, count: 5, seed: 42, vehicleProfile: 1, find: straightFind });
  for (let i = 0; i < a.agents.length; i++) {
    assertEqual(a.agents[i].at[0], b.agents[i].at[0], `agent ${i} spawn x matches across runs`);
    assertEqual(a.agents[i].at[1], b.agents[i].at[1], `agent ${i} spawn z matches across runs`);
  }
});

test('no route available → agents stay put, poses stay empty (graceful headless)', () => {
  const grid = stripGrid(40, 10, 5);
  const noRoute: TrafficFindPath = () => null;
  const sim = createTrafficSim({ grid, count: 3, seed: 1, vehicleProfile: 1, find: noRoute });
  sim.advance(0);
  assertEqual(sim.poses(0).length, 0, 'no plans means no poses (no crash)');
});

finish('traffic');
