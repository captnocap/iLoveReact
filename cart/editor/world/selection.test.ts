// Run:
//   tools/esbuild cart/editor/world/selection.test.ts --bundle \
//     --outfile=/tmp/editor-selection.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-selection.test.js

import { connectedPieceIds, pieceSelectionVolume, pieceVolumesTouch } from './selection';
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

console.log('selection.test.ts: ok');
