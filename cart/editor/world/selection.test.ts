// Run:
//   tools/esbuild cart/editor/world/selection.test.ts --bundle \
//     --outfile=/tmp/editor-selection.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-selection.test.js

import { connectedPieceIds, pieceSelectionVolume, pieceVolumesTouch, rotatePieceSelection } from './selection';
import type { PlacedPiece } from './pieces';

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const piece = (id: string, pieceId: string, x: number, y: number, z: number, yawDegrees = 0): PlacedPiece =>
  ({ id, pieceId, x, y, z, yawDegrees });

const pieces = [
  piece('floor-a', 'floor.concrete.common', 1.5, 0, 1.5),
  piece('floor-b', 'floor.concrete.common', 4.5, 0, 1.5),
  piece('wall-b', 'wall.concrete.common', 4.5, 0.05, 1.5),
  piece('wall-upper', 'wall.concrete.common', 4.5, 3.05, 1.5),
  piece('island', 'floor.concrete.common', 10, 0, 10),
];

assert(connectedPieceIds(pieces, 'floor-a').join('|') === 'floor-a|floor-b|wall-b|wall-upper', 'touching selection was not transitive or stable');
assert(connectedPieceIds(pieces, 'island').join('|') === 'island', 'disconnected island leaked into component');
assert(connectedPieceIds(pieces, 'missing').length === 0, 'missing root invented a selection');

const exactA = pieceSelectionVolume(piece('a', 'floor.concrete.common', 0, 0, 0))!;
const exactB = pieceSelectionVolume(piece('b', 'floor.concrete.common', 3, 0, 0))!;
const gap = pieceSelectionVolume(piece('gap', 'floor.concrete.common', 3.02, 0, 0))!;
assert(pieceVolumesTouch(exactA, exactB), 'face contact did not count as touching');
assert(!pieceVolumesTouch(exactA, gap), 'a visible gap was treated as contact');

const rotated = pieceSelectionVolume(piece('rotated', 'sign.shop.downtown', 0, 0, 0, 45))!;
const nearby = pieceSelectionVolume(piece('nearby', 'sign.shop.downtown', 0, 0, 1.5, 45))!;
assert(!pieceVolumesTouch(rotated, nearby), 'rotated broad-phase AABB glued separated props together');

const unit = [
  { ...piece('pivot', 'floor.concrete.common', 4.5, 0, 1.5), floor: 0 },
  { ...piece('west', 'wall.concrete.common', 1.5, 0.05, 1.5), yawDegrees: 90, floor: 0 },
  piece('north', 'wall.concrete.common', 4.5, 0.05, 4.5),
  piece('outside', 'floor.concrete.common', 20, 0, 20),
];
const turned = rotatePieceSelection(unit, ['pivot', 'west', 'north'], 'pivot', 1);
assert(turned[0]!.x === 4.5 && turned[0]!.z === 1.5 && turned[0]!.yawDegrees === 90, 'active piece did not remain the shared pivot');
assert(turned[1]!.x === 4.5 && turned[1]!.z === 4.5 && turned[1]!.yawDegrees === 180, 'west piece did not orbit with the selection');
assert(turned[2]!.x === 7.5 && turned[2]!.z === 1.5 && turned[2]!.yawDegrees === 90, 'north piece did not orbit with the selection');
assert(turned[1]!.y === unit[1]!.y && turned[1]!.floor === unit[1]!.floor, 'unit rotation changed vertical placement metadata');
assert(turned[3] === unit[3], 'unit rotation copied or changed an unselected piece');

let fullTurn = unit;
for (let turn = 0; turn < 4; turn += 1) {
  fullTurn = rotatePieceSelection(fullTurn, ['pivot', 'west', 'north'], 'pivot', 1);
}
for (let index = 0; index < unit.length; index += 1) {
  assert(fullTurn[index]!.x === unit[index]!.x && fullTurn[index]!.z === unit[index]!.z, `four turns drifted piece ${index}`);
  assert(fullTurn[index]!.yawDegrees === unit[index]!.yawDegrees, `four turns drifted yaw ${index}`);
}

console.log('selection.test.ts: ok');
