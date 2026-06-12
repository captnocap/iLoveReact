// compile/worldDoors tests — the DOORS lump (DOORS-0611, req_0654): the
// compiled game's two-state door leaves derive from the SHARED decomposition
// and round-trip the wire format the Zig loader reads.

import { assert, assertClose, assertEqual, finish, test } from '../game/_testkit';
import { GAME_BUILD, type PlacedBuildPiece } from '@game';
import { doorRecords, encodeDoors, decodeDoors, DOORS_LUMP_VERSION } from './worldDoors';

function wall(edit: string | undefined, doorOpen?: boolean): PlacedBuildPiece {
  return {
    id: `d-${edit ?? 'plain'}`,
    pieceId: 'wall.concrete.common',
    x: 9,
    y: 3,
    z: -6,
    yawDegrees: 90,
    ...(edit !== undefined ? { edit: edit as PlacedBuildPiece['edit'] } : {}),
    ...(doorOpen !== undefined ? { doorOpen } : {}),
  };
}

test('a door wall derives ONE leaf record sized by the collision tuning', () => {
  const records = doorRecords([wall('door')]);
  const tuning = GAME_BUILD.placed.tuning;
  assertEqual(records.length, 1, 'one record per door piece');
  const r = records[0];
  assertClose(r.panelWidthMeters, tuning.walkOpeningWidthMeters, 1e-6, 'leaf spans the walk portal opening');
  assertClose(r.panelHeightMeters, tuning.walkDoorPanelHeightMeters, 1e-6, 'leaf height is the collision panel height');
  assertClose(r.baseY, 3, 1e-6, 'leaf sits on the wall piece base');
  assertClose(r.yawDegrees, 90, 1e-6, 'leaf carries the wall yaw');
  assertClose(r.reachMeters, GAME_BUILD.edits.wall.door.interaction!.reachMeters, 1e-6, 'reach comes from the edit contract');
  assert(!r.vehicle, 'a walk door is not a vehicle portal');
  assert(!r.startOpen, 'default state is closed');
});

test('a garage door derives a vehicle-sized leaf', () => {
  const records = doorRecords([wall('garageDoor')]);
  const tuning = GAME_BUILD.placed.tuning;
  assertEqual(records.length, 1, 'one record');
  assertClose(records[0].panelWidthMeters, tuning.vehicleOpeningWidthMeters, 1e-6, 'leaf spans the vehicle opening');
  assertClose(records[0].panelHeightMeters, tuning.garageDoorPanelHeightMeters, 1e-6, 'leaf is the garage panel height');
  assert(records[0].vehicle, 'flagged vehicle for the prompt');
});

test('arches, windows, and plain walls derive NO leaf (no interaction, no door)', () => {
  assertEqual(doorRecords([wall('arch'), wall('window'), wall('halfHeight'), wall(undefined)]).length, 0, 'no records');
});

test('an authored-OPEN door still ships its (closeable) leaf, flagged startOpen', () => {
  const records = doorRecords([wall('door', true)]);
  assertEqual(records.length, 1, 'the leaf travels even when open');
  assert(records[0].startOpen, 'boots open');
});

test('encode/decode round-trips every field (the Zig reader reference)', () => {
  const records = doorRecords([wall('door'), wall('garageDoor'), wall('door', true)]);
  const decoded = decodeDoors(encodeDoors(records));
  assertEqual(decoded.version, DOORS_LUMP_VERSION, 'version');
  assertEqual(decoded.records.length, records.length, 'count');
  for (let i = 0; i < records.length; i += 1) {
    const a = records[i];
    const b = decoded.records[i];
    assertClose(b.x, a.x, 1e-4, `door ${i} x`);
    assertClose(b.baseY, a.baseY, 1e-4, `door ${i} baseY`);
    assertClose(b.z, a.z, 1e-4, `door ${i} z`);
    assertClose(b.yawDegrees, a.yawDegrees, 1e-4, `door ${i} yaw`);
    assertClose(b.panelWidthMeters, a.panelWidthMeters, 1e-4, `door ${i} w`);
    assertClose(b.panelHeightMeters, a.panelHeightMeters, 1e-4, `door ${i} h`);
    assertClose(b.panelDepthMeters, a.panelDepthMeters, 1e-4, `door ${i} d`);
    assertClose(b.reachMeters, a.reachMeters, 1e-4, `door ${i} reach`);
    assertEqual(b.vehicle, a.vehicle, `door ${i} vehicle`);
    assertEqual(b.startOpen, a.startOpen, `door ${i} startOpen`);
  }
});

test('the COLLIDERS bake leaves the doorway passable — the leaf is the loader\'s live rect', () => {
  // End-to-end boot collision = COLLIDERS lump (liveDoorPanels: no static
  // panel band) + the DOORS lump's live rect (closed = blocking). The static
  // half must NOT double-ship the panel.
  const piece = wall('door');
  const withPanel = GAME_BUILD.placed.colliders([piece]);
  const forBake = GAME_BUILD.placed.colliders([piece], { liveDoorPanels: true });
  assertEqual(forBake.rects.length, withPanel.rects.length - 1, 'exactly the closed-panel band dropped');
});

finish('compile/world-doors');
