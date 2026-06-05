// index.test.ts — P4 inventory test for the door itself.
//
// V17 rules the 19 GAME_* names STANDARD — a lab written today against any of
// them must keep compiling forever. This suite pins the full inventory, that
// every door is sealed (frozen), and that live doors are live while
// capture-pending doors say so honestly.

import * as door from './index';
import { assert, assertEqual, finish, test } from './_testkit';

const STANDARD_NAMES = [
  'GAME_PHYSICS', 'GAME_PATHING', 'GAME_INPUT', 'GAME_CAMERA', 'GAME_FIGURE',
  'GAME_VEHICLE', 'GAME_ITEMS', 'GAME_ANIMATION', 'GAME_KINDS', 'GAME_LOOP',
  'GAME_CHANCE', 'GAME_PERCEPTION', 'GAME_CUTSCENE', 'GAME_STORY',
  'GAME_MISSIONS', 'GAME_ACTIVITIES', 'GAME_COMMANDS', 'GAME_CHROME',
  'GAME_TELEMETRY',
] as const;

test('the door exports all 19 standard GAME_* names (V17)', () => {
  assertEqual(STANDARD_NAMES.length, 19, 'the standard list itself must be 19 names');
  for (const name of STANDARD_NAMES) {
    const value = (door as any)[name];
    assert(value != null && typeof value === 'object', `${name} must be exported from the door`);
    assert(Object.isFrozen(value), `${name} must be sealed (Object.freeze)`);
  }
});

test('live doors are live; capture-pending doors say so honestly', () => {
  const live = ['GAME_PHYSICS', 'GAME_PATHING', 'GAME_INPUT', 'GAME_CAMERA', 'GAME_LOOP', 'GAME_COMMANDS'];
  for (const name of live) {
    assert(!('status' in (door as any)[name]), `${name} must not claim capture-pending`);
  }
  for (const name of STANDARD_NAMES) {
    if (live.includes(name)) continue;
    assertEqual((door as any)[name].status, 'capture-pending', `${name} must declare capture-pending`);
  }
});

test('the live doors carry their interface, not a grab-bag', () => {
  assertEqual(typeof door.GAME_PHYSICS.step, 'function', 'GAME_PHYSICS.step');
  assertEqual(typeof door.GAME_PATHING.find, 'function', 'GAME_PATHING.find');
  assertEqual(typeof door.GAME_INPUT.createKeyState, 'function', 'GAME_INPUT.createKeyState');
  assertEqual(typeof door.GAME_CAMERA.solve, 'function', 'GAME_CAMERA.solve');
  assertEqual(typeof door.GAME_LOOP.scheduleFrame, 'function', 'GAME_LOOP.scheduleFrame');
  assertEqual(typeof door.GAME_COMMANDS.createRegistry, 'function', 'GAME_COMMANDS.createRegistry');
});

finish('game/index');
