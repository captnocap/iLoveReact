// traffic.test.ts — meaning-tests for HAND-AUTHORED ambient traffic (req_2076):
// the author draws a TrafficPath (waypoints + loop flag) and the bake turns it
// into a car that drives that polyline. Covers route construction (the loop-seam
// contract world_loader.zig's sampleRoute needs), the bake (deterministic cars,
// per-path car counts/speeds), and a full TRAFFIC-lump encode/decode round-trip.
// Pure CPU under tools/v8cli (the headless bake path).

import { assert, assertEqual, finish, test } from '../_testkit';
import type { TrafficPath } from '../../design';
import { bakeAuthoredTraffic, routeFromPath } from './index';
import { trafficRecords } from '../../compile/worldTraffic';
import { encodeTraffic, decodeTraffic } from '../../compile/worldTraffic';

function path(over: Partial<TrafficPath> & { points: { x: number; z: number }[] }): TrafficPath {
  return { id: 'tp', label: 'p', loop: true, createdByCommand: 'test', ...over };
}

// A square loop: (0,0)→(40,0)→(40,40)→(0,40).
const SQUARE = [
  { x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 40 }, { x: 0, z: 40 },
];

test('a loop route is the authored points closed back onto the first (seam contract)', () => {
  const r = routeFromPath(path({ points: SQUARE, loop: true }))!;
  assert(r !== null, 'a 4-point loop produces a route');
  assert(r.closed, 'the route is marked closed');
  const first = r.points[0];
  const last = r.points[r.points.length - 1];
  assertEqual(last[0], first[0], 'last point x equals first (sampleRoute wraps with no teleport)');
  assertEqual(last[1], first[1], 'last point z equals first');
  // square perimeter = 4 * 40 = 160
  assert(Math.abs(r.length - 160) < 1e-3, `loop length is the perimeter (${r.length.toFixed(1)}m)`);
});

test('an open path ping-pongs out-and-back and closes onto its start', () => {
  const r = routeFromPath(path({ points: [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 20 }], loop: false }))!;
  // A,B,C -> A,B,C,B,A : ends where it began, length = 2 * one-way
  const first = r.points[0];
  const last = r.points[r.points.length - 1];
  assertEqual(last[0], first[0], 'ping-pong returns to the start x');
  assertEqual(last[1], first[1], 'ping-pong returns to the start z');
  assert(Math.abs(r.length - 2 * (30 + 20)) < 1e-3, `ping-pong length is twice the one-way (${r.length.toFixed(1)}m)`);
});

test('consecutive duplicate waypoints are dropped; a degenerate path bakes nothing', () => {
  const dupes = routeFromPath(path({ points: [{ x: 5, z: 5 }, { x: 5, z: 5 }], loop: true }));
  assertEqual(dupes, null, 'two identical points collapse to one → too short to drive');
  const single = routeFromPath(path({ points: [{ x: 1, z: 1 }], loop: true }));
  assertEqual(single, null, 'a single waypoint is a dot, not a route');
});

test('the bake makes one car per path by default, more on request, spread by phase', () => {
  const one = bakeAuthoredTraffic({ paths: [path({ points: SQUARE })] });
  assertEqual(one.length, 1, 'default is one car per path');
  const many = bakeAuthoredTraffic({ paths: [path({ points: SQUARE, cars: 3 })] });
  assertEqual(many.length, 3, 'cars:3 → three cars on the one path');
  const phases = many.map((v) => v.phase).sort((a, b) => a - b);
  assert(phases[1] - phases[0] > 1 && phases[2] - phases[1] > 1, 'the three cars are spread along the loop, not stacked');
  for (const v of many) {
    assert(v.speed > 0, 'each car has a cruise speed');
    assert(v.phase >= 0 && v.phase < v.route.length, 'phase is a head start within the loop');
  }
});

test('a per-path speed overrides the default', () => {
  const v = bakeAuthoredTraffic({ paths: [path({ points: SQUARE, speed: 12 })] })[0];
  assertEqual(v.speed, 12, 'the authored speed is honoured');
});

test('the bake is deterministic for a seed', () => {
  const a = bakeAuthoredTraffic({ paths: [path({ points: SQUARE, cars: 2 })], seed: 7 });
  const b = bakeAuthoredTraffic({ paths: [path({ points: SQUARE, cars: 2 })], seed: 7 });
  assertEqual(b.length, a.length, 'same seed → same car count');
  assertEqual(b[0].route.length, a[0].route.length, 'same seed → same route');
  assertEqual(b[1].phase, a[1].phase, 'same seed → same phase spread');
});

test('no authored paths bakes no traffic (graceful)', () => {
  assertEqual(trafficRecords({ paths: [] }).length, 0, 'empty paths → no vehicles, no crash');
});

test('authored paths round-trip through the TRAFFIC lump', () => {
  const records = trafficRecords({ paths: [path({ points: SQUARE, cars: 2, speed: 8 })] });
  assertEqual(records.length, 2, 'two cars baked into records');
  const decoded = decodeTraffic(encodeTraffic(records));
  assertEqual(decoded.records.length, records.length, 'count survives the wire round-trip');
  // route is the closed square (5 points: 4 corners + return) → 10 floats
  assertEqual(decoded.records[0].route.length, records[0].route.length, 'route geometry survives');
  assertEqual(decoded.records[0].speed, 8, 'speed survives');
  assert(decoded.records[0].rows.length > 0, 'the vehicle prototype rows survive');
});

finish('traffic');
