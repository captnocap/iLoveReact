// camera.test.ts — P4 behavior tests for GAME_CAMERA.
//
// Pure math, no fakes: solving is deterministic and side-effect-free, every
// registered rig produces a finite camera, modifiers fold in order, and the
// pick path inverts — a click on the screen center of a solved camera lands on
// the ground point the camera is looking at, whichever rig solved it.

import { GAME_CAMERA, type Solved } from './camera';
import { assert, assertClose, assertEqual, finish, test } from './_testkit';

const VIEWPORT = { x: 0, y: 0, width: 800, height: 600 };

function finiteSolved(s: Solved): boolean {
  return [...s.pos, ...s.target, s.fov].every(Number.isFinite);
}

test('every registered rig solves its own defaults to a finite camera', () => {
  const names = Object.keys(GAME_CAMERA.rigs);
  assert(names.length >= 7, `the seven shipped rigs must be present (got ${names.length})`);
  for (const name of names) {
    const solved = GAME_CAMERA.solve(GAME_CAMERA.rigs[name]);
    assert(finiteSolved(solved), `${name} must solve to finite pos/target/fov`);
    assert(solved.fov > 0 && solved.fov < 180, `${name} fov must be a usable angle`);
  }
});

test('solving is pure: same params, same camera; defaults never mutate', () => {
  const rig = GAME_CAMERA.rigs.Orbit;
  const before = JSON.stringify(rig.defaults);
  const a = GAME_CAMERA.solve(rig, { target: [5, 0, 5], yaw: 30 });
  const b = GAME_CAMERA.solve(rig, { target: [5, 0, 5], yaw: 30 });
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'same params must give the same Solved');
  assertEqual(JSON.stringify(rig.defaults), before, 'solving must not mutate the rig defaults');
});

test('modifiers fold in order over the solved camera', () => {
  const lift = (s: Solved): Solved => ({ ...s, pos: [s.pos[0], s.pos[1] + 1, s.pos[2]] });
  const widen = (s: Solved): Solved => ({ ...s, fov: s.fov * 2 });
  const plain = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit);
  const modded = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {}, [lift, widen]);
  assertClose(modded.pos[1], plain.pos[1] + 1, 1e-9, 'the lift modifier must apply');
  assertClose(modded.fov, plain.fov * 2, 1e-9, 'the widen modifier must apply after it');
});

test('a screen-center pick lands on the ground point the camera looks at', () => {
  for (const name of ['Orbit', 'TopDown', 'Isometric'] as const) {
    const solved = GAME_CAMERA.solve(GAME_CAMERA.rigs[name], { target: [12, 0, 8] });
    const pick = GAME_CAMERA.unprojectGround(VIEWPORT.width / 2, VIEWPORT.height / 2, VIEWPORT, solved);
    assertClose(pick.x, 12, 0.05, `${name}: center pick x must hit the look point`);
    assertClose(pick.y, 8, 0.05, `${name}: center pick z must hit the look point`);
  }
});

test('picking respects the height field (a raised ground catches the ray sooner)', () => {
  const solved = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: [0, 0, 0], pitch: 45 });
  const flat = GAME_CAMERA.unprojectGround(500, 300, VIEWPORT, solved);
  const raised = GAME_CAMERA.unprojectGround(500, 300, VIEWPORT, solved, () => 2);
  const flatDist = Math.hypot(flat.x - solved.pos[0], flat.y - solved.pos[2]);
  const raisedDist = Math.hypot(raised.x - solved.pos[0], raised.y - solved.pos[2]);
  assert(raisedDist < flatDist, 'a raised surface must catch the ray closer to the eye');
});

finish('game/camera');
