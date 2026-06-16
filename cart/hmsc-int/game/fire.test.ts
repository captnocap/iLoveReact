// Behavior tests for combustion (P4): assert what fire DOES — a combustible
// burns its fuel then cooks off or dies, a propane tank is an instant boom not
// a fire, and a gasoline trail crawls cell by cell along its fuel and stops
// where the fuel stops — not what the functions are named.

import {
  FIRE_TUNING,
  GAME_FIRE,
  burningCells,
  igniteCell,
  ignite,
  isCellBurning,
  makeCombustible,
  makeFireField,
  stepCombustible,
  stepFireField,
  type FuelPredicate,
} from './fire';
import { GAME_CHANCE } from './chance';
import { assert, assertClose, assertEqual, finish, test } from './_testkit';

// ── combustibles ─────────────────────────────────────────────────────────────

test('an unlit combustible takes no damage and does nothing', () => {
  const c = makeCombustible({ fuelSeconds: 4, damagePerSecond: 8 });
  const step = stepCombustible(c, 1);
  assertEqual(step.damage, 0, 'no damage before it is lit');
  assertEqual(step.event, 'none', 'nothing happens');
  assert(!step.state.burning, 'still unlit');
});

test('a lit combustible deals damage over time, then cooks off at the end', () => {
  let c = ignite(makeCombustible({ fuelSeconds: 4, damagePerSecond: 8, end: 'cookoff' }));
  let total = 0;
  let event = 'none';
  for (let i = 0; i < 4; i++) {
    const step = stepCombustible(c, 1);
    c = step.state;
    total += step.damage;
    event = step.event;
  }
  assertClose(total, 32, 1e-6, '8 hp/s × 4 s of fuel');
  assertEqual(event, 'cookoff', 'a cookoff fires a blast at the end');
  assert(c.spent, 'and the object is spent');
});

test('a propane tank is an instant boom, not a fire', () => {
  // Zero fuel + cookoff = ignite this frame, explode the next, no burn DOT.
  const tank = ignite(makeCombustible({ fuelSeconds: 0, damagePerSecond: 50, end: 'cookoff' }));
  const step = stepCombustible(tank, 1 / 60);
  assertEqual(step.event, 'cookoff', 'it cooks off immediately');
  assertEqual(step.damage, 0, 'no lingering fire damage — just the boom');
  assert(step.state.spent, 'spent in one step');
});

test('a combustible that just burns out extinguishes, no blast', () => {
  let c = ignite(makeCombustible({ fuelSeconds: 2, damagePerSecond: 5, end: 'extinguish' }));
  const mid = stepCombustible(c, 1); // still has 1 s of fuel
  assertEqual(mid.event, 'none', 'still burning at the halfway mark');
  const last = stepCombustible(mid.state, 1); // fuel exhausted
  assertEqual(last.event, 'extinguished', 'no fuel left → it goes out, no blast');
  assert(last.state.spent, 'and it is spent');
});

test('the final partial step only bills the fuel that was left', () => {
  // 3 s fuel, step by 2 s twice: the second step should only burn 1 s of it.
  let c = ignite(makeCombustible({ fuelSeconds: 3, damagePerSecond: 10, end: 'cookoff' }));
  const a = stepCombustible(c, 2);
  c = a.state;
  const b = stepCombustible(c, 2);
  assertClose(a.damage, 20, 1e-6, 'first 2 s of fuel');
  assertClose(b.damage, 10, 1e-6, 'only the last 1 s, not a full 2 s');
  assertEqual(b.event, 'cookoff', 'and it cooks off');
});

test('a spent combustible cannot be relit', () => {
  let c = ignite(makeCombustible({ fuelSeconds: 1, end: 'cookoff' }));
  c = stepCombustible(c, 1).state; // spent
  const relit = ignite(c);
  assert(!relit.burning, 'ignite is a no-op once spent');
  assertEqual(stepCombustible(relit, 1).damage, 0, 'and it deals no more damage');
});

// ── fire field: tile-grid spread ─────────────────────────────────────────────

// A straight gasoline trail along z=0, from x=0 to x=5. Nothing off the line.
const trail: FuelPredicate = (x, z) => z === 0 && x >= 0 && x <= 5;

test('a gasoline trail crawls one cell at a time down its length', () => {
  let field = igniteCell(makeFireField(), 0, 0, trail);
  const tuning = { spreadDelaySeconds: 0.3, burnSeconds: 10, diagonal: false, jitter: 0 };

  let step = stepFireField(field, 0.4, trail, tuning); // (0,0) past delay → lights (1,0)
  field = step.field;
  assert(isCellBurning(field, 1, 0), 'fire reaches the next cell');
  assert(!isCellBurning(field, 2, 0), 'but not two cells in one step');

  step = stepFireField(field, 0.4, trail, tuning); // (1,0) past delay → lights (2,0)
  field = step.field;
  assert(isCellBurning(field, 2, 0), 'the front advances another cell');
});

test('fire stops where the fuel stops', () => {
  // Only two fuelled cells; the front cannot jump the gap to x=2.
  const twoCells: FuelPredicate = (x, z) => z === 0 && (x === 0 || x === 1);
  let field = igniteCell(makeFireField(), 0, 0, twoCells);
  const tuning = { spreadDelaySeconds: 0.3, burnSeconds: 10, diagonal: false, jitter: 0 };
  for (let i = 0; i < 6; i++) field = stepFireField(field, 0.4, twoCells, tuning).field;
  assert(isCellBurning(field, 1, 0), 'the fuelled neighbour caught');
  assert(!isCellBurning(field, 2, 0), 'the dry cell beyond never lights');
});

test('a burning cell goes spent after its burn time', () => {
  const single: FuelPredicate = (x, z) => x === 0 && z === 0;
  let field = igniteCell(makeFireField(), 0, 0, single);
  const step = stepFireField(field, 3.5, single, { burnSeconds: 3, jitter: 0 });
  assert(!isCellBurning(step.field, 0, 0), 'past its burn window it is out');
  assertEqual(step.burnedOut.length, 1, 'and reported as burned out');
});

test('igniteCell refuses a fuelless tile and never double-lights', () => {
  const single: FuelPredicate = (x, z) => x === 0 && z === 0;
  let field = igniteCell(makeFireField(), 9, 9, single); // no fuel there
  assertEqual(burningCells(field).length, 0, 'no fuel, no fire');
  field = igniteCell(field, 0, 0, single);
  const before = burningCells(field).length;
  field = igniteCell(field, 0, 0, single); // already lit
  assertEqual(burningCells(field).length, before, 'lighting it twice changes nothing');
});

test('spread jitter is deterministic under a seeded rng', () => {
  // A 3×3 fuel block so several neighbours compete; jitter makes some hesitate.
  const block: FuelPredicate = (x, z) => x >= -1 && x <= 1 && z >= -1 && z <= 1;
  const run = () => {
    const field = igniteCell(makeFireField(), 0, 0, block);
    return stepFireField(field, 0.5, block, {
      spreadDelaySeconds: 0.3,
      jitter: 0.5,
      rng: GAME_CHANCE.seededRng(7),
    }).ignited;
  };
  const a = run();
  const b = run();
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'same seed → same fire front');
});

test('zero jitter catches every fuelled neighbour on schedule', () => {
  const block: FuelPredicate = (x, z) => x >= -1 && x <= 1 && z >= -1 && z <= 1;
  const field = igniteCell(makeFireField(), 0, 0, block);
  const step = stepFireField(field, 0.5, block, { spreadDelaySeconds: 0.3, diagonal: true, jitter: 0 });
  assertEqual(step.ignited.length, 8, 'all 8 neighbours of the center catch');
});

test('the door re-exports the combustion API and its tuning table', () => {
  assertEqual(GAME_FIRE.stepFireField, stepFireField, 'door exposes the field stepper');
  assertEqual(GAME_FIRE.stepCombustible, stepCombustible, 'door exposes the combustible stepper');
  assertEqual(GAME_FIRE.tuning, FIRE_TUNING, 'door exposes the one tuning table');
});

finish('fire');
