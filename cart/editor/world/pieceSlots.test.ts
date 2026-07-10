// cart/editor/world/pieceSlots.test.ts — faceRoleForHit (req_2879 Paint Faces):
// the host raycast's hit normal must name the SAME slot role the skin renderer
// reads for the slab you touched, including the odd-quarter-turn front/back swap
// pieceShapes carries (its frontSlot/backSlot) — paint what you touch, exactly.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/pieceSlots.test.ts --bundle \
//     --outfile=/tmp/editor-pieceSlots.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-pieceSlots.test.js

import { faceRoleForHit, pieceSlotRoles } from './pieceSlots';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

const WALL = 'wall.brick.downtown';
const FLOOR = 'floor.concrete.common';

test('wall at yaw 0 — the world +z face is the front slot, -z the back', () => {
  assert(faceRoleForHit(WALL, 0, { x: 0, y: 0, z: 1 }) === 'front', '+z is front');
  assert(faceRoleForHit(WALL, 0, { x: 0, y: 0, z: -1 }) === 'back', '-z is back');
});

test('wall at yaw 0 — width ends and the top rim are the core, slot sides', () => {
  assert(faceRoleForHit(WALL, 0, { x: 1, y: 0, z: 0 }) === 'sides', '+x end is sides');
  assert(faceRoleForHit(WALL, 0, { x: -1, y: 0, z: 0 }) === 'sides', '-x end is sides');
  assert(faceRoleForHit(WALL, 0, { x: 0, y: 1, z: 0 }) === 'sides', 'top rim is sides');
});

test('wall at yaw 90 — the quarter-turn swap: the world +x slab wears BACK', () => {
  // pieceShapes places the geometric front slab toward world +x at yaw 90 and
  // (odd quarter) tags it 'back'; the host frame lands on the same name.
  assert(faceRoleForHit(WALL, 90, { x: 1, y: 0, z: 0 }) === 'back', '+x slab reads slots.back');
  assert(faceRoleForHit(WALL, 90, { x: -1, y: 0, z: 0 }) === 'front', '-x slab reads slots.front');
  assert(faceRoleForHit(WALL, 90, { x: 0, y: 0, z: 1 }) === 'sides', 'the turned width end is sides');
});

test('wall at yaw 180/270 — front/back keep tracking the touched slab', () => {
  assert(faceRoleForHit(WALL, 180, { x: 0, y: 0, z: -1 }) === 'front', 'yaw 180: -z slab is front');
  assert(faceRoleForHit(WALL, 180, { x: 0, y: 0, z: 1 }) === 'back', 'yaw 180: +z slab is back');
  assert(faceRoleForHit(WALL, 270, { x: -1, y: 0, z: 0 }) === 'back', 'yaw 270: -x slab is back');
  assert(faceRoleForHit(WALL, 270, { x: 1, y: 0, z: 0 }) === 'front', 'yaw 270: +x slab is front');
});

test('floor plate — top / bottom / edges by the hit normal', () => {
  assert(faceRoleForHit(FLOOR, 0, { x: 0, y: 1, z: 0 }) === 'top', 'up is top');
  assert(faceRoleForHit(FLOOR, 0, { x: 0, y: -1, z: 0 }) === 'bottom', 'down is bottom (ceiling paint)');
  assert(faceRoleForHit(FLOOR, 0, { x: 1, y: 0, z: 0 }) === 'edges', 'a rim hit is edges');
  assert(faceRoleForHit(FLOOR, 90, { x: 0, y: 0, z: 1 }) === 'edges', 'a turned rim hit is edges');
});

test('single-surface kinds take their one role from any face', () => {
  assert(faceRoleForHit('stairs.wood.common', 0, { x: 0, y: 1, z: 0 }) === 'surface', 'stairs top');
  assert(faceRoleForHit('stairs.wood.common', 90, { x: 1, y: 0, z: 0 }) === 'surface', 'stairs side');
  assert(faceRoleForHit('sign.shop.downtown', 0, { x: 0, y: 0, z: 1 }) === 'face', 'sign face');
});

test('non-catalog ids expose no slots — nothing to paint', () => {
  assert(pieceSlotRoles('model:exported-wall').length === 0, 'authored ids have no catalog roles');
  assert(faceRoleForHit('model:exported-wall', 0, { x: 0, y: 0, z: 1 }) === null, 'authored hit is a no-op');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
