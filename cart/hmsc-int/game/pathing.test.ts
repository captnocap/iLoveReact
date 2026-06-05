// pathing.test.ts — P4 behavior tests for GAME_PATHING.
//
// Routes: a fake `__path_*` host returns a straight two-point route; the tests
// assert the V5 doctrine — a path stays valid until a grid change TOUCHES its
// remaining segments, and a change elsewhere disrupts nothing.
// Motion: pure math, tested for the deterministic contract itself — same t,
// same sample; ends at rest; a slice starts exactly where the old sample stood.

import { GAME_PATHING } from './pathing';
import { assert, assertClose, assertEqual, finish, test } from './_testkit';

declare const globalThis: any;

/** Fake host: one grid generation counter + straight-line routes, speaking
 *  the honest __game_pathing_* names the door is wired to. */
let generation = 0;
function installFakeHost(): void {
  generation = 7;
  globalThis.__game_pathing_set_grid = () => ++generation;
  globalThis.__game_pathing_update_cells = () => ++generation;
  globalThis.__game_pathing_fill_rect = () => ++generation;
  globalThis.__game_pathing_set_profile = () => undefined;
  globalThis.__game_pathing_set_flows = () => ++generation;
  globalThis.__game_pathing_set_kind_classes = () => ++generation;
  globalThis.__game_pathing_generation = () => generation;
  globalThis.__game_pathing_find = (_profile: number, x0: number, z0: number, x1: number, z1: number): ArrayBuffer => {
    const out = new Float32Array([generation, 2, x0, z0, x1, z1]);
    return out.buffer;
  };
}

function removeFakeHost(): void {
  for (const name of [
    '__game_pathing_set_grid', '__game_pathing_update_cells', '__game_pathing_fill_rect',
    '__game_pathing_set_profile', '__game_pathing_set_flows', '__game_pathing_set_kind_classes',
    '__game_pathing_generation', '__game_pathing_find', '__game_pathing_plan',
  ]) delete globalThis[name];
}

const WALK = { maxSpeed: 4, accel: 3, decel: 5 };

test('a missing host degrades to no-route, never throws', () => {
  removeFakeHost();
  assertEqual(GAME_PATHING.hostReady(), false, 'hostReady must be false without bindings');
  assertEqual(GAME_PATHING.find(0, [0, 0], [10, 0]), null, 'find must return null without bindings');
  assertEqual(GAME_PATHING.publishGrid({ origin: [0, 0], cellSize: 1, cols: 2, rows: 2, kinds: [0, 0, 0, 0] }), 0, 'publish must report generation 0');
});

test('publish → find returns a typed route carrying its generation', () => {
  installFakeHost();
  assert(GAME_PATHING.hostReady(), 'hostReady must be true with bindings');
  GAME_PATHING.publishGrid({ origin: [0, 0], cellSize: 1, cols: 8, rows: 8, kinds: new Array(64).fill(0) });
  const path = GAME_PATHING.find(0, [0.5, 0.5], [6.5, 0.5]);
  assert(path !== null, 'a route must come back');
  assertEqual(path!.points.length, 2, 'fake host returns endpoints');
  assertEqual(path!.generation, generation, 'the route must carry the grid generation it was computed at');
});

test('a dropped barrier disrupts only the routes through it (V5)', () => {
  installFakeHost();
  GAME_PATHING.publishGrid({ origin: [0, 0], cellSize: 1, cols: 8, rows: 8, kinds: new Array(64).fill(0) });
  const through = GAME_PATHING.find(0, [0.5, 0.5], [6.5, 0.5])!;
  const elsewhere = GAME_PATHING.find(0, [0.5, 6.5], [6.5, 6.5])!;
  assertEqual(GAME_PATHING.disrupted(through, 1), false, 'an untouched grid disrupts nothing');
  // barrier on the first route's lane (cell 3,0) — two cells of margin from the second
  GAME_PATHING.fillRect(3, 0, 1, 1, 99);
  assertEqual(GAME_PATHING.disrupted(through, 1), true, 'the route through the barrier must re-path');
  assertEqual(GAME_PATHING.disrupted(elsewhere, 1), false, 'a route far from the change must keep its plan');
});

test('a change behind the walker leaves the remaining route valid', () => {
  installFakeHost();
  GAME_PATHING.publishGrid({ origin: [0, 0], cellSize: 1, cols: 8, rows: 8, kinds: new Array(64).fill(0) });
  const route = GAME_PATHING.find(0, [0.5, 0.5], [6.5, 0.5])!;
  GAME_PATHING.fillRect(3, 0, 1, 1, 99);
  // nextIndex beyond the last waypoint: every segment is behind the walker...
  // except disruption tests segments from nextIndex-1, so use a 3-point route shape:
  // the 2-point fake route means nextIndex=2 leaves no remaining segment ahead
  // of the change-test window other than the final arrival point.
  assertEqual(GAME_PATHING.disrupted({ ...route, points: [[0.5, 0.5], [1.5, 0.5]] }, 2), false,
    'a change ahead of an almost-done route on another stretch must not re-path it');
  removeFakeHost();
});

test('motion is deterministic: same t, same sample, ends at rest (R6)', () => {
  const points: [number, number][] = [[0, 0], [10, 0], [10, 10]];
  const plan = GAME_PATHING.planMotion(points, { startTime: 100, profile: WALK });
  const a = GAME_PATHING.sampleMotion(plan, 101.5);
  const b = GAME_PATHING.sampleMotion(plan, 101.5);
  assertClose(a.x, b.x, 0, 'same t must give the same x');
  assertClose(a.s, b.s, 0, 'same t must give the same arc distance');
  const end = GAME_PATHING.sampleMotion(plan, 100 + plan.duration + 1);
  assertEqual(end.done, true, 'the plan must finish');
  assertClose(end.speed, 0, 1e-9, 'the plan must end at rest');
  assertClose(end.x, 10, 1e-6, 'the plan must end at the destination x');
  assertClose(end.z, 10, 1e-6, 'the plan must end at the destination z');
});

test('publishing kind classes (the lane-discipline opt-in) bumps the generation', () => {
  installFakeHost();
  const before = GAME_PATHING.generation();
  const gen = GAME_PATHING.setKindClasses([0, GAME_PATHING.CLASS.junction, GAME_PATHING.CLASS.crosswalk]);
  assert(gen > before, 'classes reshape routes — the generation must move');
  removeFakeHost();
});

test('a host-compiled plan unpacks into the sampleable MotionPlan shape', () => {
  installFakeHost();
  // hand-packed plan: (0,0)→(10,0), one 2s cruise phase at 5 m/s
  globalThis.__game_pathing_plan = (): ArrayBuffer => {
    const f = new Float64Array([
      0, 2, 10, 2, 1, // t0, duration, total, npoints, nphases
      0, 0, 10, 0, // points
      0, 10, // cum
      0, 0, 5, 0, 2, // phase t,s,v,a,dt
    ]);
    return f.buffer;
  };
  const plan = GAME_PATHING.planMotion([[0, 0], [10, 0]], { startTime: 0, profile: WALK });
  assertEqual(plan.duration, 2, 'the door must carry the HOST schedule, not rebuild one');
  const mid = GAME_PATHING.sampleMotion(plan, 1);
  assertClose(mid.x, 5, 1e-9, 'JS closed-form sampling must read the host phases');
  assertClose(mid.speed, 5, 1e-9, 'cruise speed comes from the host phase');
  removeFakeHost();
});

test('an interruption slice starts exactly where the old sample stood', () => {
  const points: [number, number][] = [[0, 0], [20, 0]];
  const plan = GAME_PATHING.planMotion(points, { startTime: 0, profile: WALK });
  const mid = GAME_PATHING.sampleMotion(plan, plan.duration / 2);
  const remaining = GAME_PATHING.slicePath(plan, mid.s);
  assertClose(remaining[0][0], mid.x, 1e-6, 'the slice must start at the sampled x');
  assertClose(remaining[0][1], mid.z, 1e-6, 'the slice must start at the sampled z');
  const replanned = GAME_PATHING.planMotion(remaining, { startTime: 50, profile: WALK, startSpeed: mid.speed });
  const resumed = GAME_PATHING.sampleMotion(replanned, 50);
  assertClose(resumed.speed, mid.speed, 1e-6, 'the replanned schedule must keep the carried speed');
});

finish('game/pathing');
