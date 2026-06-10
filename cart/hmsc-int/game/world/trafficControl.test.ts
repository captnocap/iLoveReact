// trafficControl.test.ts — meaning-tests for right-of-way (TRAFFICGATE-0610,
// req_0554): junction cells cluster into boxes, a control prop governs the
// approach it faces against, the signal cycle matches the lamp's clock, and
// the plan-time gate puts a real full stop (at rest, on the stop line) into
// the deterministic schedule — green lights never split the plan. Pure CPU
// under tools/v8cli.

import { assert, assertClose, assertEqual, finish, test } from '../_testkit';
import { TILE_KIND_INDEX } from '../kinds';
import { TRAFFIC_SIGNAL_CYCLE } from '../../../hmsc/world/traffic';
import type { PaintedGrid } from './navPublish';
import {
  associateTrafficControls, controlApproach, findJunctionBoxes, junctionEntryDelay,
  planMotionWithStops, sampleMotionWithStops, secondsUntilGreen, signalAxisPhase,
  stopLineCrossings, TRAFFIC_TUNING, type ControlledJunction,
} from './trafficControl';

const J = TILE_KIND_INDEX.junction;
const PROFILE = { maxSpeed: 10, accel: 4, decel: 6 };

function gridWith(cols: number, rows: number, cells: Array<[number, number]>): PaintedGrid {
  const kinds = new Int16Array(cols * rows).fill(TILE_KIND_INDEX.asphalt);
  for (const [x, z] of cells) kinds[z * cols + x] = J;
  return { origin: [0, 0], cols, rows, kinds };
}

function junctionAt(minX: number, minZ: number, size: number, controls: ControlledJunction['controls'] = []): ControlledJunction {
  return {
    box: {
      id: 0, minX, minZ, maxX: minX + size, maxZ: minZ + size,
      centerX: minX + size / 2, centerZ: minZ + size / 2, cells: size * size,
    },
    controls,
  };
}

test('junction cells flood-fill into boxes; separate clusters stay separate', () => {
  const cluster1: Array<[number, number]> = [];
  for (let z = 4; z < 7; z++) for (let x = 4; x < 7; x++) cluster1.push([x, z]);
  const boxes = findJunctionBoxes(gridWith(24, 24, [...cluster1, [20, 20], [21, 20]]));
  assertEqual(boxes.length, 2, 'two clusters, two boxes');
  const big = boxes.find((b) => b.cells === 9)!;
  assertEqual(big.minX, 4, 'box min');
  assertEqual(big.maxX, 7, 'box max is exclusive cell edge');
  assertClose(big.centerX, 5.5, 0.001, 'box centre');
});

test('a control governs the approach it faces against (yaw 0 faces -Z)', () => {
  assertEqual(controlApproach(0), 'posZ', 'a north-facing light governs southbound travel');
  assertEqual(controlApproach(180), 'negZ', 'south-facing governs northbound');
  assertEqual(controlApproach(90), 'posX', 'yaw 90 faces -X, governing eastbound (+X) travel');
  assertEqual(controlApproach(270), 'negX', 'yaw 270 faces +X, governing westbound (-X) travel');
});

test('association picks the nearest box within reach; strays govern nothing', () => {
  const boxes = findJunctionBoxes(gridWith(40, 40, [[10, 10], [11, 10], [10, 11], [11, 11]]));
  const out = associateTrafficControls(boxes, [
    { control: 'stopSign', x: 13.5, z: 10.5, yawDegrees: 90 },
    { control: 'signal', x: 35, z: 35, yawDegrees: 0 },
  ]);
  assertEqual(out[0].controls.length, 1, 'the nearby sign attaches; the stray does not');
  assertEqual(out[0].controls[0].control.control, 'stopSign', 'right prop');
});

test('the signal cycle: axes alternate, half a period apart, lamp-synced', () => {
  const cycle = TRAFFIC_SIGNAL_CYCLE;
  assertEqual(signalAxisPhase('z', 0), 'go', 'z opens the period');
  assertEqual(signalAxisPhase('x', 0), 'stop', 'x holds while z runs');
  assertEqual(signalAxisPhase('z', cycle.goSeconds + 0.1), 'caution', 'z cautions after green');
  assertEqual(signalAxisPhase('x', cycle.periodSeconds / 2), 'go', 'x goes at half period');
  assertEqual(secondsUntilGreen('z', 0), 0, 'green now = no wait');
  assertClose(secondsUntilGreen('x', 0), cycle.periodSeconds / 2, 0.001, 'x waits half a period at t=0');
});

test('junctionEntryDelay: stop sign = the full-stop pause; signal = wait for green; uncontrolled = 0', () => {
  const stopJ = junctionAt(10, 10, 3, [{ control: { control: 'stopSign', x: 9, z: 9, yawDegrees: 0 }, approach: 'posZ' }]);
  assertEqual(junctionEntryDelay(stopJ, 'posZ', 0), TRAFFIC_TUNING.stopSignPauseSeconds, 'stop sign holds the pause');
  assertEqual(junctionEntryDelay(stopJ, 'posX', 0), 0, 'the cross approach is ungoverned');
  const sigJ = junctionAt(10, 10, 3, [{ control: { control: 'signal', x: 9, z: 9, yawDegrees: 0 }, approach: 'posZ' }]);
  assertEqual(junctionEntryDelay(sigJ, 'posZ', 0), 0, 'z green at t=0 = flow through');
  assertClose(junctionEntryDelay(sigJ, 'posZ', TRAFFIC_SIGNAL_CYCLE.goSeconds + 1), TRAFFIC_SIGNAL_CYCLE.periodSeconds - (TRAFFIC_SIGNAL_CYCLE.goSeconds + 1), 0.001, 'z mid-red waits out the cycle');
});

test('stopLineCrossings finds the entry into the crosswalk-expanded rect, path-ordered', () => {
  const j = junctionAt(10, 0, 3, [{ control: { control: 'stopSign', x: 9, z: -1, yawDegrees: 90 }, approach: 'posX' }]);
  const crossings = stopLineCrossings([[0, 1.5], [30, 1.5]], [j]);
  assertEqual(crossings.length, 1, 'one entry');
  assertClose(crossings[0].s, 10 - TRAFFIC_TUNING.stopLineMeters, 0.001, 'the stop line sits a crosswalk band before the box');
  assertEqual(crossings[0].approach, 'posX', 'eastbound entry');
});

test('a stop sign puts a REAL full stop into the schedule; the hold parks on the line', () => {
  const j = junctionAt(20, 0, 3, [{ control: { control: 'stopSign', x: 19, z: -1, yawDegrees: 90 }, approach: 'posX' }]);
  const points: [number, number][] = [[0, 1.5], [50, 1.5]];
  const plain = planMotionWithStops(points, { startTime: 100, profile: PROFILE, junctions: [] });
  const gated = planMotionWithStops(points, { startTime: 100, profile: PROFILE, junctions: [j] });
  assertEqual(plain.stops.length, 0, 'no junctions, no stops');
  assertEqual(gated.stops.length, 1, 'one stop at the sign');
  assertClose(gated.stops[0].holdSeconds, TRAFFIC_TUNING.stopSignPauseSeconds, 0.001, 'the sign holds the pause');
  assert(gated.duration > plain.duration + TRAFFIC_TUNING.stopSignPauseSeconds - 0.01, 'the schedule pays the stop AND the re-acceleration');
  // mid-hold: parked AT the stop line, at rest
  const holdT = gated.plans[0].t0 + gated.plans[0].duration + TRAFFIC_TUNING.stopSignPauseSeconds / 2;
  const held = sampleMotionWithStops(gated, holdT);
  assertClose(held.x, 20 - TRAFFIC_TUNING.stopLineMeters, 0.05, 'parked on the stop line');
  assertEqual(held.speed, 0, 'at rest');
  // well after: moving again past the box
  const after = sampleMotionWithStops(gated, gated.t0 + gated.duration - 0.5);
  assert(after.x > 23, 'proceeds through after the stop');
});

test('a green light never splits the plan; a red one waits exactly until green', () => {
  const sig = (approach: 'posX') => junctionAt(20, 0, 3, [{ control: { control: 'signal', x: 19, z: -1, yawDegrees: 90 }, approach }]);
  const points: [number, number][] = [[0, 1.5], [50, 1.5]];
  // x goes green at half period — start so arrival lands inside x's green
  const greenStart = TRAFFIC_SIGNAL_CYCLE.periodSeconds / 2;
  const green = planMotionWithStops(points, { startTime: greenStart, profile: PROFILE, junctions: [sig('posX')] });
  assertEqual(green.stops.length, 0, 'green at arrival = no split, no stop');
  // start at t=0: x is red; the vehicle arrives within the red and waits
  const red = planMotionWithStops(points, { startTime: 0, profile: PROFILE, junctions: [sig('posX')] });
  assertEqual(red.stops.length, 1, 'red at arrival = a hold');
  const arrival = red.plans[0].t0 + red.plans[0].duration;
  assertClose(red.stops[0].holdSeconds, secondsUntilGreen('x', arrival), 0.001, 'holds exactly until the lamp turns');
});

finish('trafficControl');
