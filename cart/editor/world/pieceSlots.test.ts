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

import { faceRoleForHit, pieceSlotRoles, slotRefForBox } from './pieceSlots';
import type { PlacedPiece } from './pieces';

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

// ── slotRefForBox (req_2886) — a painted slot must govern ONLY its own box ──
const pieceWith = (pieceId: string, slots: Record<string, { assetId: string }>): PlacedPiece =>
  ({ id: 'p1', pieceId, x: 0, y: 0, z: 0, yawDegrees: 0, slots } as unknown as PlacedPiece);
const govern = (p: PlacedPiece, slot: Parameters<typeof slotRefForBox>[1]): string | undefined => {
  const ref = slotRefForBox(p, slot);
  return ref && 'assetId' in ref ? ref.assetId : undefined;
};

test('painting a wall front governs the front slab ONLY — back/sides stay bare', () => {
  const p = pieceWith(WALL, { front: { assetId: 'mat.red' } });
  assert(govern(p, 'front') === 'mat.red', 'front slab wears the paint');
  assert(govern(p, 'back') === undefined, 'back slab stays unpainted');
  assert(govern(p, 'sides') === undefined, 'core stays unpainted');
});

test('exterior and interior of one wall hold DIFFERENT materials', () => {
  const p = pieceWith(WALL, { front: { assetId: 'mat.brick' }, back: { assetId: 'mat.plaster' } });
  assert(govern(p, 'front') === 'mat.brick', 'exterior keeps brick');
  assert(govern(p, 'back') === 'mat.plaster', 'interior keeps plaster');
});

test('plate roles reach their boxes: bottom sliver is tagged back, edges are the core', () => {
  const p = pieceWith(FLOOR, { top: { assetId: 'mat.tile' }, bottom: { assetId: 'mat.stucco' } });
  assert(govern(p, 'top') === 'mat.tile', 'top sliver wears top');
  assert(govern(p, 'back') === 'mat.stucco', "the plate's bottom sliver (tagged back) wears bottom");
  assert(govern(p, 'sides') === undefined, 'unpainted edges stay bare');
});

test('single-surface slot covers every box; no slots at all governs nothing', () => {
  const p = pieceWith('stairs.wood.common', { surface: { assetId: 'mat.wood' } });
  assert(govern(p, 'top') === 'mat.wood', 'surface covers a top-tagged box');
  assert(govern(p, 'front') === 'mat.wood', 'surface covers a front-tagged box');
  assert(govern({ ...p, slots: undefined } as PlacedPiece, 'front') === undefined, 'bare piece has no governing ref');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
