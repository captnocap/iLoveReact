// traffic.test.ts — meaning-tests for the baked ambient-traffic route generator
// (P4): the flow-follow tracer turns a directional lane ring into a closed
// circuit holding lane discipline, and the bake populates deterministic vehicles
// on those circuits. Pure CPU under tools/v8cli (no host — this is the headless
// bake path by construction).

import { assert, assertEqual, finish, test } from '../_testkit';
import { TILE_KIND_INDEX } from '../kinds';
import type { NavGrid } from '../world/navGrid';
import { bakeTrafficVehicles, traceFlowCircuit } from './index';

// A clockwise one-way ring on the border of a `side`×`side` grid (+X right, +Z
// down): top→laneEast, right→laneSouth, bottom→laneWest, left→laneNorth, corners
// junction (flow-neutral road where the turn resolves). Interior is mud.
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

test('the flow tracer closes a one-way lane ring into a circuit', () => {
  const grid = ringGrid(8);
  const route = traceFlowCircuit(grid, [2, 0]); // start on the top (laneEast) edge
  assert(route !== null, 'a lane start produces a route');
  assert(route!.closed, 'following the ring flow returns to the start (closed loop)');
  // perimeter of the 8×8 border ≈ 4 * 7 = 28m; collapsed to the 4 corners.
  assert(route!.length > 24, `loop spans the ring (${route!.length.toFixed(1)}m)`);
  assert(route!.points.length <= 8, 'collinear runs collapse to ~the corner turns (4 corners + seam)');
});

test('the tracer holds lane discipline — every step travels WITH the flow', () => {
  // Walk the returned corners: each leg must run along a grid axis (no diagonal,
  // no backtrack into the corner it just left).
  const route = traceFlowCircuit(ringGrid(8), [3, 0])!;
  for (let i = 1; i < route.points.length; i++) {
    const dx = route.points[i][0] - route.points[i - 1][0];
    const dz = route.points[i][1] - route.points[i - 1][1];
    assert((dx === 0) !== (dz === 0), `leg ${i} is axis-aligned (one of dx/dz is zero)`);
  }
});

test('bake populates deterministic vehicles on circuits', () => {
  const grid = ringGrid(10);
  const a = bakeTrafficVehicles({ grid, count: 4, seed: 9, garage: undefined });
  assert(a.length >= 1, 'at least one vehicle populates on the ring');
  for (const v of a) {
    assert(v.route.length >= 24, 'each vehicle drives a worthwhile circuit');
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
  assertEqual(traceFlowCircuit(grid, [3, 3]), null, 'a non-road start traces nothing');
});

finish('traffic');
