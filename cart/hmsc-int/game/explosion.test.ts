// Behavior tests for the blast solver (P4): assert what a blast DOES — falloff
// fades the effect to nothing at the rim, cover shields, mass resists throw but
// not damage, a big body catches a near miss, debris lofts — not what the
// functions are named.

import {
  EXPLOSION_TUNING,
  GAME_EXPLOSION,
  blastAt,
  type BlastParams,
  type BlastTarget,
} from './explosion';
import { assert, assertClose, assertEqual, finish, test } from './_testkit';

const at = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({ x, y, z });

// A plain blast: linear falloff makes the math checkable by hand.
const linearBlast = (over: Partial<BlastParams> = {}): BlastParams => ({
  center: at(0, 0, 0),
  radiusMeters: 10,
  peakImpulse: 20,
  peakDamage: 100,
  falloff: 'linear',
  upwardThrow: 0,
  ...over,
});

const mag = (v: { x: number; y: number; z: number }): number =>
  Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

// ── falloff ──────────────────────────────────────────────────────────────────

test('a target at the center takes the full peak', () => {
  const { hits } = blastAt(linearBlast(), [{ position: at(0, 0, 0) }]);
  assertEqual(hits.length, 1, 'one hit');
  assertClose(hits[0].intensity, 1, 1e-6, 'center intensity is peak');
  assertClose(hits[0].damage, 100, 1e-6, 'center damage is peak');
  assertClose(mag(hits[0].impulse), 20, 1e-6, 'center impulse is peak');
});

test('linear falloff halves the effect at half radius', () => {
  const { hits } = blastAt(linearBlast(), [{ position: at(5, 0, 0) }]);
  assertClose(hits[0].intensity, 0.5, 1e-6, 'half radius → half intensity');
  assertClose(hits[0].damage, 50, 1e-6, 'half radius → half damage');
});

test('a target at or beyond the rim is omitted', () => {
  const { hits } = blastAt(linearBlast({ radiusMeters: 4 }), [
    { position: at(4, 0, 0) }, // exactly at rim → zero effect
    { position: at(9, 0, 0) }, // outside
  ]);
  assertEqual(hits.length, 0, 'rim and beyond contribute nothing');
});

test('a zero-radius blast hits nothing', () => {
  const { hits } = blastAt(linearBlast({ radiusMeters: 0 }), [{ position: at(0, 0, 0) }]);
  assertEqual(hits.length, 0, 'no radius, no blast');
});

// ── cover, mass, size ────────────────────────────────────────────────────────

test('cover scales the whole effect down', () => {
  const { hits } = blastAt(linearBlast(), [{ position: at(0, 0, 0), cover: 0.5 }]);
  assertClose(hits[0].intensity, 0.5, 1e-6, 'half cover → half intensity');
  assertClose(hits[0].damage, 50, 1e-6, 'half cover → half damage');
});

test('mass resists the throw but not the damage', () => {
  const light = blastAt(linearBlast(), [{ position: at(0, 0, 0), mass: 1 }]).hits[0];
  const heavy = blastAt(linearBlast(), [{ position: at(0, 0, 0), mass: 4 }]).hits[0];
  assertClose(mag(heavy.impulse), mag(light.impulse) / 4, 1e-6, 'a 4× mass flies a quarter as fast');
  assertClose(heavy.damage, light.damage, 1e-6, 'mass does not shield damage');
});

test('a wide body catches a blast a point would miss', () => {
  const params = linearBlast({ radiusMeters: 4 });
  const point = blastAt(params, [{ position: at(5, 0, 0) }]).hits;
  const car = blastAt(params, [{ position: at(5, 0, 0), radiusMeters: 2 }]).hits;
  assertEqual(point.length, 0, 'a point 5m out is clear of a 4m blast');
  assertEqual(car.length, 1, 'a 2m-radius body reaches into the blast');
  assertClose(car[0].distanceMeters, 3, 1e-6, 'distance is measured to the near edge');
});

// ── direction ────────────────────────────────────────────────────────────────

test('upward throw lofts a ground-level target up and out', () => {
  const { hits } = blastAt(linearBlast({ upwardThrow: 0.5 }), [{ position: at(5, 0, 0) }]);
  assert(hits[0].impulse.y > 0, 'a sideways target still gets thrown upward');
  assert(hits[0].impulse.x > 0, 'and outward');
});

test('a target sitting on the blast point is thrown straight up', () => {
  const { hits } = blastAt(linearBlast({ upwardThrow: 0.5 }), [{ position: at(0, 0, 0) }]);
  assertClose(hits[0].impulse.x, 0, 1e-6, 'no horizontal bias at the exact center');
  assertClose(hits[0].impulse.z, 0, 1e-6, 'no horizontal bias at the exact center');
  assert(hits[0].impulse.y > 0, 'thrown up');
});

// ── ignition ─────────────────────────────────────────────────────────────────

test('the core ignites, the fringe only shoves', () => {
  const { hits } = blastAt(linearBlast(), [
    { position: at(1, 0, 0) }, // intensity 0.9 — well above the 0.35 default
    { position: at(8, 0, 0) }, // intensity 0.2 — below threshold
  ]);
  const near = hits.find((h) => h.distanceMeters < 2)!;
  const far = hits.find((h) => h.distanceMeters > 7)!;
  assert(near.ignites, 'a target in the core catches fire');
  assert(!far.ignites, 'a target at the fringe is hit but not lit');
});

test('the ignition threshold is tunable per blast', () => {
  const greedy = blastAt(linearBlast({ igniteAboveIntensity: 0.1 }), [{ position: at(8, 0, 0) }]);
  assert(greedy.hits[0].ignites, 'a lower threshold lights the fringe');
});

// ── result shape ─────────────────────────────────────────────────────────────

test('hits come back nearest-first and carry their target index', () => {
  const { hits } = blastAt(linearBlast(), [
    { position: at(8, 0, 0) }, // index 0, far
    { position: at(1, 0, 0) }, // index 1, near
  ]);
  assertEqual(hits[0].index, 1, 'nearest first');
  assertEqual(hits[1].index, 0, 'farthest last');
});

test('the door re-exports the solver and its tuning table', () => {
  assertEqual(GAME_EXPLOSION.blastAt, blastAt, 'door exposes the solver');
  assertEqual(GAME_EXPLOSION.tuning, EXPLOSION_TUNING, 'door exposes the one tuning table');
});

finish('explosion');
