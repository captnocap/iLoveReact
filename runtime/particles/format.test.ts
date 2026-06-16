// Behavior tests for the particle data waist (self-contained; runtime/ has no
// shared test kit and must not couple to the game-side one). Assert the format
// holds its contract: the packed artifact matches the declared field order, the
// pool columns stay in sync, presets are well-formed, and the event seam queues
// and drains without leaking.

import {
  EMITTER_FIELD_ORDER,
  PARTICLE_COLUMNS,
  PARTICLE_PRESETS,
  FIRE,
  packEmitter,
  range,
  type EmitterSpec,
} from './index';
import { makeParticleBus } from './index';

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`PASS particles :: ${name}`); }
  catch (e: any) { failed++; console.error(`FAIL particles :: ${name} — ${e?.message ?? e}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m} (expected ${String(b)}, got ${String(a)})`); }
// Float32Array round-trips lose precision (0.05 → 0.05000000074…), so packed
// floats are compared with a tolerance, not strict equality.
function near(a: number, b: number, m: string) { if (Math.abs(a - b) > 1e-6) throw new Error(`${m} (expected ~${b}, got ${a})`); }

test('packEmitter emits exactly one float per declared field, in order', () => {
  const packed = packEmitter(FIRE);
  eq(packed.length, EMITTER_FIELD_ORDER.length, 'packed length equals field count');
  // spot-check the order contract holds at the named offsets
  near(packed[EMITTER_FIELD_ORDER.indexOf('innerRadius')], FIRE.innerRadius, 'innerRadius slot');
  near(packed[EMITTER_FIELD_ORDER.indexOf('lifeMin')], FIRE.life[0], 'lifeMin slot');
  near(packed[EMITTER_FIELD_ORDER.indexOf('lifeMax')], FIRE.life[1], 'lifeMax slot');
  near(packed[EMITTER_FIELD_ORDER.indexOf('colorToB')], FIRE.colorTo[2], 'colorToB slot');
});

test('render selectors pack as their fixed integer codes', () => {
  const packed = packEmitter(FIRE);
  eq(packed[EMITTER_FIELD_ORDER.indexOf('blend')], 0, 'additive = 0');
  eq(packed[EMITTER_FIELD_ORDER.indexOf('billboard')], 0, 'face = 0');
  eq(packed[EMITTER_FIELD_ORDER.indexOf('texture')], 1, 'fire atlas slot = 1');
});

test('range() is the declarative 2-factor: constant degenerates to [n,n]', () => {
  const r = range(5);
  eq(r[0], 5, 'min'); eq(r[1], 5, 'max');
  const ab = range(2, 9);
  eq(ab[0], 2, 'min'); eq(ab[1], 9, 'max');
});

test('every preset is well-formed (life/speed are ranges, colors are rgb triples)', () => {
  for (const [name, spec] of Object.entries(PARTICLE_PRESETS) as [string, EmitterSpec][]) {
    eq(spec.life.length, 2, `${name} life is a range`);
    assert(spec.life[1] >= spec.life[0], `${name} life max ≥ min`);
    eq(spec.speed.length, 2, `${name} speed is a range`);
    eq(spec.colorFrom.length, 3, `${name} colorFrom is rgb`);
    eq(spec.colorTo.length, 3, `${name} colorTo is rgb`);
    assert(packEmitter(spec).every((n) => Number.isFinite(n)), `${name} packs to finite floats`);
  }
});

test('an explosion is rate-0 + a burst; fire is a continuous stream', () => {
  eq(PARTICLE_PRESETS.explosion.ratePerSecond, 0, 'explosion has no stream');
  assert(PARTICLE_PRESETS.explosion.burst > 0, 'explosion bursts');
  assert(PARTICLE_PRESETS.fire.ratePerSecond > 0, 'fire streams');
  eq(PARTICLE_PRESETS.fire.burst, 0, 'fire does not burst');
});

test('the pool columns carry the integrable factors (position, velocity, age, life)', () => {
  for (const need of ['px', 'vy', 'scaleGrowth', 'age', 'life', 'tex', 'billboard']) {
    assert((PARTICLE_COLUMNS as readonly string[]).includes(need), `pool has ${need}`);
  }
});

test('the event bus queues and drains without leaking across frames', () => {
  const bus = makeParticleBus();
  bus.emit({ kind: 'burst', preset: 'explosion', at: [1, 2, 3], scale: 2 });
  bus.emit({ kind: 'light', id: 'cell-0', preset: 'fire', at: [0, 0, 0] });
  const first = bus.drain();
  eq(first.length, 2, 'both events drained');
  const second = bus.drain();
  eq(second.length, 0, 'drain clears the queue — no carry-over');
});

console.log(`particles: ${7 - failed}/7 passed`);
const exit = (globalThis as any).__exit;
if (typeof exit === 'function') exit(failed > 0 ? 1 : 0);
else if (failed > 0) throw new Error(`${failed} particle test(s) failed`);
