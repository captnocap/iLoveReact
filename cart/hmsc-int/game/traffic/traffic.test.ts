// traffic.test.ts — meaning-tests for the goal-oriented route generator (P4):
// junctions are the goal nodes, a car drives a tour of distant intersections and
// home (a closed loop, no teleport), holding lane discipline; the bake populates
// deterministic vehicles. Pure CPU under tools/v8cli (the headless bake path).

import { assert, assertEqual, finish, test } from '../_testkit';
import { TILE_KIND_INDEX } from '../kinds';
import type { NavGrid } from '../world/navGrid';
import { bakeTrafficVehicles, junctionCells, traceGoalTour } from './index';
import { seededRng } from '../chance';

// A clockwise one-way ring on the border of a `side`×`side` grid (+X right, +Z
// down): top→laneEast, right→laneSouth, bottom→laneWest, left→laneNorth, corners
// junction (the intersections / goal nodes). Interior is mud.
function ringGrid(side: number): NavGrid {
  const k = TILE_KIND_INDEX;
  const kinds = new Uint16Array(side * side).fill(k.mud);
  const set = (x: number, z: number, v: number) => { kinds[z * side + x] = v; };
  for (let i = 1; i < side - 1; i++) {
    set(i, 0, k.laneEast);
    set(side - 1, i, k.laneSouth);
    set(i, side - 1, k.laneWest);
    set(0, i, k.laneNorth);
  }
  set(0, 0, k.junction);
  set(side - 1, 0, k.junction);
  set(side - 1, side - 1, k.junction);
  set(0, side - 1, k.junction);
  return { origin: [0, 0], cellSize: 1, cols: side, rows: side, kinds };
}

test('junctionCells finds the intersections (the goal nodes)', () => {
  const cells = junctionCells(ringGrid(8));
  assertEqual(cells.length, 4, 'the ring has four corner junctions');
});

test('a goal tour drives distant intersections and returns home (closed loop)', () => {
  const grid = ringGrid(8);
  const route = traceGoalTour(grid, [2, 0], junctionCells(grid), seededRng(3));
  assert(route !== null, 'a lane start produces a route');
  assert(route!.closed, 'the tour makes it home → a closed loop (no teleport wrap)');
  assert(route!.length > 24, `the tour covers ground (${route!.length.toFixed(1)}m)`);
});

test('the tour holds lane discipline — every leg is axis-aligned with the flow', () => {
  const grid = ringGrid(8);
  const route = traceGoalTour(grid, [3, 0], junctionCells(grid), seededRng(1))!;
  for (let i = 1; i < route.points.length; i++) {
    const dx = route.points[i][0] - route.points[i - 1][0];
    const dz = route.points[i][1] - route.points[i - 1][1];
    assert((dx === 0) !== (dz === 0), `leg ${i} is axis-aligned (one of dx/dz is zero)`);
  }
});

test('bake populates deterministic vehicles on goal tours', () => {
  const grid = ringGrid(10);
  const a = bakeTrafficVehicles({ grid, count: 4, seed: 9, garage: undefined });
  assert(a.length >= 1, 'at least one vehicle routes on the ring');
  for (const v of a) {
    assert(v.route.length >= 24, 'each vehicle drives a worthwhile tour');
    assert(v.speed > 0, 'each vehicle has a cruise speed');
    assert(v.phase >= 0 && v.phase <= v.route.length, 'phase is a head start within the loop');
  }
  const b = bakeTrafficVehicles({ grid, count: 4, seed: 9 });
  assertEqual(b.length, a.length, 'same seed → same vehicle count');
  assertEqual(b[0].speed, a[0].speed, 'same seed → same cruise speed');
  assertEqual(b[0].route.length, a[0].route.length, 'same seed → same route');
});

test('a map with no lanes bakes no traffic (graceful)', () => {
  const k = TILE_KIND_INDEX;
  const kinds = new Uint16Array(36).fill(k.mud);
  const grid: NavGrid = { origin: [0, 0], cellSize: 1, cols: 6, rows: 6, kinds };
  assertEqual(bakeTrafficVehicles({ grid, count: 5, seed: 1 }).length, 0, 'no roads → no vehicles, no crash');
  assertEqual(traceGoalTour(grid, [3, 3], [], seededRng(1)), null, 'a non-road start traces nothing');
});

finish('traffic');
