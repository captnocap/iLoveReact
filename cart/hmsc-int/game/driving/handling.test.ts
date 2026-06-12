// handling.test.ts - P4 behavior tests for VEHICLE_HANDLING (req_0694):
// every body style has its own complete, distinct, physically coherent feel.

import { VEHICLE_STYLES, type VehicleStyleId } from '../vehicle';
import { GAME_DRIVING, makeCarState, stepCar, type CarTuning } from './index';
import { VEHICLE_HANDLING, WHEELBASE_FRACTION, tuningForStyle, wheelBaseOf } from './handling';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

const STYLES = Object.keys(VEHICLE_STYLES) as VehicleStyleId[];
const GRAV = 9.81;

test('every style has a handling entry and a complete finite tuning', () => {
  assertEqual(Object.keys(VEHICLE_HANDLING).length, STYLES.length, 'one handling entry per style');
  for (const style of STYLES) {
    const t = tuningForStyle(style);
    for (const [key, value] of Object.entries(t)) {
      assert(typeof value === 'number' && Number.isFinite(value), `${style}.${key} is a finite number`);
    }
    assert(t.enginePower > 0 && t.brakePower > 0 && t.topSpeed > 0 && t.grip > 0, `${style} core knobs positive`);
  }
});

test('wheelbase and track come from the body dims', () => {
  for (const style of STYLES) {
    const t = tuningForStyle(style);
    const dims = VEHICLE_STYLES[style];
    assertClose(t.wheelBase, dims.length * WHEELBASE_FRACTION, 1e-9, `${style} wheelbase from length`);
    assert(t.wheelBase < dims.length, `${style} wheelbase shorter than the body`);
    assertEqual(t.trackWidth, dims.width, `${style} track = body width`);
    assertEqual(wheelBaseOf(style), t.wheelBase, `${style} wheelBaseOf agrees`);
  }
});

test('no two styles share the same feel (the point of the table)', () => {
  const signature = (t: CarTuning) =>
    [t.enginePower, t.topSpeed, t.brakePower, t.grip, t.maxSteer, t.steerSpeed, t.maxLatG, t.cgHeight, t.corneringDrag].join('|');
  const seen = new Map<string, VehicleStyleId>();
  for (const style of STYLES) {
    const sig = signature(tuningForStyle(style));
    assert(!seen.has(sig), `${style} duplicates ${seen.get(sig) ?? '?'}'s feel`);
    seen.set(sig, style);
  }
});

test('the speed/agility order reads: sports fastest, fire truck slowest', () => {
  const top = (s: VehicleStyleId) => tuningForStyle(s).topSpeed;
  for (const style of STYLES) {
    if (style !== 'sports') assert(top('sports') > top(style), `sports outruns ${style}`);
    if (style !== 'fire_truck') assert(top('fire_truck') < top(style), `fire truck slower than ${style}`);
  }
  assert(tuningForStyle('sports').steerSpeed > tuningForStyle('van').steerSpeed, 'sports turns in quicker than the van');
  assert(tuningForStyle('police_car').topSpeed > tuningForStyle('sedan').topSpeed, 'the pursuit car outruns the sedan it chases');
  assert(tuningForStyle('sports').cgHeight < tuningForStyle('van').cgHeight, 'sports sits lower than the van');
});

test('tippability is designed: tall boxes can roll, the sports car cannot', () => {
  // The model trips when the grip-capped lateral accel (maxLatG·g) beats
  // gravity's moment about the outer wheels (g·halfTrack/cgHeight).
  const tipsInCornering = (s: VehicleStyleId) => {
    const t = tuningForStyle(s);
    return t.maxLatG * GRAV > GRAV * (t.trackWidth * 0.5) / t.cgHeight;
  };
  for (const style of ['van', 'ambulance', 'fire_truck'] as const) {
    assert(tipsInCornering(style), `${style} can be rolled`);
  }
  assert(!tipsInCornering('sports'), 'sports car grips, spins, but never trips itself');
});

test('full-throttle drag race: the table changes what actually happens', () => {
  const race = (style: VehicleStyleId, seconds: number) => {
    const car = makeCarState(0, 0, 0);
    const t = tuningForStyle(style);
    const input = { throttle: 1, brake: 0, steer: 0, handbrake: false };
    const dt = 1 / 60;
    for (let i = 0; i < seconds * 60; i++) stepCar(car, input, t, dt);
    return car.z; // heading 0 drives +Z
  };
  const sports = race('sports', 8);
  const sedan = race('sedan', 8);
  const fire = race('fire_truck', 8);
  assert(sports > sedan && sedan > fire, `8s drag order sports(${sports.toFixed(1)}) > sedan(${sedan.toFixed(1)}) > fire(${fire.toFixed(1)})`);
});

test('the door exposes the table', () => {
  assert(typeof GAME_DRIVING.step === 'function', 'GAME_DRIVING door intact');
  assertEqual(tuningForStyle('sedan').topSpeed, GAME_DRIVING.defaultTuning(wheelBaseOf('sedan')).topSpeed, 'sedan IS the baseline register');
});

finish('driving/handling');
