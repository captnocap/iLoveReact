// compile/worldElevators behavior tests (P4) — the ELEVATORS lump (REQ-0652):
// records derive from the SAME shaft/car source the editor rides, the wire
// round-trips byte-exact, and the layout matches what constructor.zig
// decodeElevators reads. Runs under tools/v8cli via `rjit game verify`.

import { assert, assertClose, assertEqual, finish, test } from '../game/_testkit';
import { decodeElevators, elevatorShaftRecords, encodeElevators, ELEVATORS_LUMP_VERSION } from './worldElevators';
import { GAME_BUILD } from '@game';
import type { PlacedBuildPiece } from '@game';

const ELEVATOR_ID = 'elevator.metal.common';
const STOREY = GAME_BUILD.catalog.get(ELEVATOR_ID).size.heightMeters;

let nextId = 0;
function storey(x: number, z: number, y: number): PlacedBuildPiece {
  nextId += 1;
  return { id: `el_${nextId}`, pieceId: ELEVATOR_ID, x, z, y, yawDegrees: 0 };
}

test('records derive from the editor shaft source: one per shaft, a stop per storey, the editor car footprint', () => {
  const pieces = [storey(1.5, 1.5, 0), storey(1.5, 1.5, STOREY), storey(1.5, 1.5, STOREY * 2), storey(10.5, 1.5, 0)];
  const records = elevatorShaftRecords(pieces);
  assertEqual(records.length, 2, 'one record per shaft');
  const tower = records.find((r) => r.stops.length === 3)!;
  assert(tower !== undefined, 'the stacked shaft carries all three stops');
  assertEqual(tower.stops.join(','), `0,${STOREY},${STOREY * 2}`, 'stops are the storey levels, ascending');
  const tuning = GAME_BUILD.placed.tuning;
  const rect = GAME_BUILD.elevators.carRect(GAME_BUILD.elevators.shafts(pieces)[0], 0);
  assertClose(tower.carHalfXMeters, (rect.maxX - rect.minX) / 2, 1e-9, 'the lump car IS the editor car');
  assertClose(tower.carThicknessMeters, tuning.elevatorCarFloorThicknessMeters, 1e-9, 'slab thickness from PLACED_TUNING');
  assertClose(tower.carSpeedMetersPerSecond, tuning.elevatorCarSpeedMetersPerSecond, 1e-9, 'ride speed from PLACED_TUNING');
  assertClose(tower.moduleHalfXMeters, 1.5, 1e-9, 'boarding footprint = the 3m module half');
});

test('the wire round-trips value-exact at f32 precision (the constructor.zig reference)', () => {
  const pieces = [storey(-4.5, 7.5, 0), storey(-4.5, 7.5, STOREY)];
  const records = elevatorShaftRecords(pieces);
  const bytes = encodeElevators(records);
  const back = decodeElevators(bytes);
  assertEqual(back.version, ELEVATORS_LUMP_VERSION, 'version survives');
  // the wire is f32 — compare against the f32-quantized source
  const quantized = records.map((r) => ({
    x: Math.fround(r.x),
    z: Math.fround(r.z),
    carHalfXMeters: Math.fround(r.carHalfXMeters),
    carHalfZMeters: Math.fround(r.carHalfZMeters),
    carThicknessMeters: Math.fround(r.carThicknessMeters),
    carSpeedMetersPerSecond: Math.fround(r.carSpeedMetersPerSecond),
    moduleHalfXMeters: Math.fround(r.moduleHalfXMeters),
    moduleHalfZMeters: Math.fround(r.moduleHalfZMeters),
    stops: r.stops.map(Math.fround),
  }));
  assertEqual(JSON.stringify(back.records), JSON.stringify(quantized), 'records round-trip exactly');
  const empty = decodeElevators(encodeElevators([]));
  assertEqual(empty.records.length, 0, 'an elevator-free map encodes an empty lump');
});

finish('compile-elevators');
