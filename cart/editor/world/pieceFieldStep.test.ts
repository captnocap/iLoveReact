// Run:
//   tools/esbuild cart/editor/world/pieceFieldStep.test.ts --bundle \
//     --outfile=/tmp/editor-piece-field-step.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-piece-field-step.test.js

import { stepPieceField } from './pieceFieldStep';
import { setAuthoredPieces } from './authoredRegistry';
import type { PlacedPiece } from './pieces';

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

// One authored prop in the registry so `prop:` ids resolve to the prop kind.
setAuthoredPieces([{ id: 'prop:tv', modelId: 'tv', pkgId: 'studio:tv', label: 'TV', kind: 'prop', hex: '#88aaff' }]);

const gridPiece: PlacedPiece = { id: 'w1', pieceId: 'wall.concrete.common', x: 1.5, y: 0, z: 3, yawDegrees: 90, floor: 0 };
const prop: PlacedPiece = { id: 'p1', pieceId: 'prop:tv', x: 2, y: 0.5, z: 7, yawDegrees: 350, floor: 0 };

// Grid pieces step the 3m module and keep their snap family.
const gx = stepPieceField(gridPiece, 'x', 1);
assert(gx?.kind === 'move' && gx.destination.x === 4.5, 'grid x step must move one 3m module');
// Grid floor steps rebase y by one storey and record the floor.
const gf = stepPieceField(gridPiece, 'floor', 1);
assert(gf?.kind === 'move' && gf.destination.floor === 1 && gf.destination.y === 3, 'floor step must lift one storey');
assert(stepPieceField(gridPiece, 'floor', -1) === null, 'floor below ground must be inert');
// Prop-only fields are inert on grid pieces (a stale press must do nothing).
assert(stepPieceField(gridPiece, 'height', 1) === null, 'grid height step must be inert');
assert(stepPieceField(gridPiece, 'yaw', 1) === null, 'grid free-yaw step must be inert (quarter turns own grid yaw)');
assert(stepPieceField(gridPiece, 'scale', 1) === null, 'grid scale step must be inert');
assert(stepPieceField(gridPiece, 'spin', 1) === null, 'catalog spin step must be inert (loader spins authored meshes only)');

// Props nudge finely and wrap yaw.
const px = stepPieceField(prop, 'x', 1);
assert(px?.kind === 'move' && px.destination.x === 2.1, 'prop x step must nudge 0.1m');
const py = stepPieceField(prop, 'yaw', 1);
assert(py?.kind === 'move' && py.destination.yawDegrees === 5, 'prop yaw must wrap 350+15 → 5');
const ph = stepPieceField({ ...prop, y: 0 }, 'height', -1);
assert(ph?.kind === 'move' && ph.destination.y === 0, 'prop height must clamp at ground');
const ps = stepPieceField({ ...prop, scale: 19.95 }, 'scale', 1);
assert(ps?.kind === 'move' && ps.destination.scale === 20, 'prop scale must clamp at the gizmo limit');
// Authored spin steps by the shared rate step and clamps at a full turn.
const spinUp = stepPieceField(prop, 'spin', 1);
assert(spinUp?.kind === 'spin' && spinUp.rate === 15, 'authored spin must step 15°/s');
const spinClamped = stepPieceField({ ...prop, spinDegPerSec: 180 }, 'spin', 1);
assert(spinClamped?.kind === 'spin' && spinClamped.rate === 180, 'spin must clamp at ±180°/s');

console.error('[pieceFieldStep.test] PASS');
