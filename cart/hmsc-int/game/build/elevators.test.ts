// game/build elevator behavior tests (P4) — MEANING tests for REQ-0647's
// moving vertical link: stacked storeys ARE a shaft with a stop per storey, a
// gap splits shafts, the static colliders are an OPEN-FRONT frame (a body
// walks in; the car is live, not static), and stop arithmetic rides the loop.
// The compiled twin (the ELEVATORS lump) is covered in
// compile/worldElevators.test.ts. Runs under tools/v8cli via `rjit game verify`.

import { assert, assertClose, assertEqual, finish, test } from '../_testkit';
import {
  elevatorCarBox,
  elevatorCarRect,
  elevatorCarTop,
  elevatorShafts,
  nearestElevatorStop,
  nextElevatorStop,
  updateElevatorCarRect,
} from './elevators';
import { PLACED_TUNING, placedPieceColliders, type PlacedBuildPiece } from './placed';
import { catalogEntry } from './catalog';

const ELEVATOR_ID = 'elevator.metal.common';
const STOREY = catalogEntry(ELEVATOR_ID).size.heightMeters;

let nextId = 0;
function storey(x: number, z: number, y: number, over: Partial<PlacedBuildPiece> = {}): PlacedBuildPiece {
  nextId += 1;
  return { id: `el_${nextId}`, pieceId: ELEVATOR_ID, x, z, y, yawDegrees: 0, ...over };
}

test('stacked storeys are ONE shaft with a stop at every floor', () => {
  const shafts = elevatorShafts([storey(1.5, 1.5, 0), storey(1.5, 1.5, STOREY), storey(1.5, 1.5, STOREY * 2)]);
  assertEqual(shafts.length, 1, 'one column = one shaft');
  assertEqual(shafts[0].stops.join(','), `0,${STOREY},${STOREY * 2}`, 'every storey is a stop');
  assertClose(shafts[0].topY, STOREY * 3, 1e-9, 'the shaft tops out at the highest storey');
});

test('a vertical gap splits the column into separate shafts; columns at different x/z never merge', () => {
  const gapped = elevatorShafts([storey(1.5, 1.5, 0), storey(1.5, 1.5, STOREY * 3)]);
  assertEqual(gapped.length, 2, 'a missing storey breaks the shaft');
  const twoColumns = elevatorShafts([storey(1.5, 1.5, 0), storey(4.5, 1.5, 0)]);
  assertEqual(twoColumns.length, 2, 'side-by-side elevators are independent');
});

test('the static colliders are an open-front frame: back + two sides, the front face admits a body', () => {
  const piece = storey(1.5, 1.5, 0);
  const { rects, orientedRects } = placedPieceColliders([piece]);
  assertEqual(orientedRects.length, 0, 'quarter-turn shafts land as plain rects');
  assertEqual(rects.length, 3, 'left + right + back walls — no car, no fourth wall');
  const size = catalogEntry(ELEVATOR_ID).size;
  const frontEdgeZ = piece.z - size.depthMeters / 2; // open front faces local −v (world −z at yaw 0)
  // nothing blocks the doorway: any rect reaching the front edge is a thin
  // SIDE wall (u-axis thickness = the shaft wall), never a front band
  for (const rect of rects) {
    if (rect.minZ > frontEdgeZ + 1e-6) continue;
    assert(rect.maxX - rect.minX <= PLACED_TUNING.elevatorShaftWallThicknessMeters + 1e-6, 'only the thin side walls reach the open front');
  }
  // the player's walk-in lane through the center of the front face is clear
  const laneClear = rects.every((rect) => !(piece.x >= rect.minX && piece.x <= rect.maxX && frontEdgeZ + 0.01 >= rect.minZ && frontEdgeZ + 0.01 <= rect.maxZ));
  assert(laneClear, 'the center of the open front admits a body');
});

test('the car rect serves the stop level and re-aims in place for the ride', () => {
  const shaft = elevatorShafts([storey(1.5, 1.5, 0), storey(1.5, 1.5, STOREY)])[0];
  const rect = elevatorCarRect(shaft, 0);
  assertClose(rect.topMeters, elevatorCarTop(0), 1e-9, 'standable top = stop + slab thickness');
  const inset = PLACED_TUNING.elevatorShaftWallThicknessMeters + PLACED_TUNING.elevatorCarInsetMeters;
  assertClose(rect.maxX - rect.minX, shaft.size.widthMeters - inset * 2, 1e-9, 'the car clears the shaft walls');
  updateElevatorCarRect(rect, STOREY);
  assertClose(rect.topMeters, elevatorCarTop(STOREY), 1e-9, 'the SAME rect object now serves the next floor');
  assertClose(rect.floorMeters!, STOREY, 1e-9, 'the slab rides whole');
  const box = elevatorCarBox(shaft, STOREY);
  assertClose(box.cy, STOREY + PLACED_TUNING.elevatorCarFloorThicknessMeters / 2, 1e-9, 'render box centers on the slab');
});

test('stop arithmetic rides the loop: up through the stops, wrap to the bottom from the top', () => {
  const shaft = elevatorShafts([storey(1.5, 1.5, 0), storey(1.5, 1.5, STOREY), storey(1.5, 1.5, STOREY * 2)])[0];
  assertEqual(nextElevatorStop(shaft, 0), STOREY, 'from the ground, next is floor 2');
  assertEqual(nextElevatorStop(shaft, STOREY), STOREY * 2, 'then the top');
  assertEqual(nextElevatorStop(shaft, STOREY * 2), 0, 'from the top, the loop returns to ground');
  assertEqual(nearestElevatorStop(shaft, STOREY + 0.4), STOREY, 'a body just above a landing resolves to it');
  const single = elevatorShafts([storey(10.5, 1.5, 0)])[0];
  assertEqual(nextElevatorStop(single, 0), null, 'a one-storey shaft has nowhere to go');
});

finish('build-elevators');
