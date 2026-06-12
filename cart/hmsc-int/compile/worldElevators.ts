// worldElevators.ts — bake the ELEVATOR SHAFTS (REQ-0652) into the ELEVATORS
// map lump so the compiled game gets /test's ride: walk onto the car, E rides
// up a stop per press (wrapping down from the top), E at a landing calls the
// car (USER ASK req_0652 — "it works only in the test route. next add the
// method to the compiled game loader").
//
// THE GAP THIS FIXES: the first compiled delivery parked a STATIC car rect at
// each shaft's bottom stop — standable, but "a painted statue" exactly like
// the pre-KICKPROP balls. The host integrator already carries a player on a
// rect whose top rises within step height (framework/game/physics.zig
// groundAt + the downhill snap); the compiled path just never shipped WHICH
// rects are cars and where their stops are.
//
// SHAPE: per shaft — the car's footprint half-spans + slab thickness + ride
// speed (PLACED_TUNING via game/build/elevators.ts, ONE source), the MODULE
// half-spans (the boarding/call footprint test), and one stop level per
// stacked storey. The loader appends one live car rect per shaft to its
// physics buffer and re-aims it in place per frame — the same mechanism
// PlayRoute's editor ride uses.

import { GAME_BUILD } from '@game';
import type { PlacedBuildPiece } from '@game';

export const ELEVATORS_LUMP_VERSION = 1;

export type ElevatorShaftRecord = {
  x: number;
  z: number;
  /** the CAR platform's footprint half-spans, meters */
  carHalfXMeters: number;
  carHalfZMeters: number;
  /** the car slab's thickness — its standable top = stop + this */
  carThicknessMeters: number;
  carSpeedMetersPerSecond: number;
  /** the storey MODULE's half-spans — the boarding/call footprint */
  moduleHalfXMeters: number;
  moduleHalfZMeters: number;
  /** ascending storey base levels — one stop per stacked storey */
  stops: number[];
};

/** Derive the lump records from the placed pieces — same shaft derivation +
 *  car geometry the editor rides (GAME_BUILD.elevators), so the compiled car
 *  and /test's car are the same object at every height. */
export function elevatorShaftRecords(pieces: readonly PlacedBuildPiece[]): ElevatorShaftRecord[] {
  const tuning = GAME_BUILD.placed.tuning;
  return GAME_BUILD.elevators.shafts(pieces).map((shaft) => {
    const rect = GAME_BUILD.elevators.carRect(shaft, shaft.stops[0]);
    return {
      x: shaft.x,
      z: shaft.z,
      carHalfXMeters: (rect.maxX - rect.minX) / 2,
      carHalfZMeters: (rect.maxZ - rect.minZ) / 2,
      carThicknessMeters: tuning.elevatorCarFloorThicknessMeters,
      carSpeedMetersPerSecond: tuning.elevatorCarSpeedMetersPerSecond,
      moduleHalfXMeters: shaft.size.widthMeters / 2,
      moduleHalfZMeters: shaft.size.depthMeters / 2,
      stops: [...shaft.stops],
    };
  });
}

/** Encode the ELEVATORS lump.
 *
 *  Layout (version 1, little-endian):
 *    u32 version
 *    u32 shaftCount
 *    per shaft:
 *      f32 x | f32 z |
 *      f32 carHalfX | f32 carHalfZ | f32 carThickness | f32 carSpeed |
 *      f32 moduleHalfX | f32 moduleHalfZ |
 *      u32 stopCount | f32[stopCount] stops (ascending) */
export function encodeElevators(records: readonly ElevatorShaftRecord[]): Uint8Array {
  let bytes = 8;
  for (const r of records) bytes += 8 * 4 + 4 + r.stops.length * 4;
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, ELEVATORS_LUMP_VERSION, true);
  view.setUint32(4, records.length, true);
  let at = 8;
  for (const r of records) {
    view.setFloat32(at, r.x, true);
    view.setFloat32(at + 4, r.z, true);
    view.setFloat32(at + 8, r.carHalfXMeters, true);
    view.setFloat32(at + 12, r.carHalfZMeters, true);
    view.setFloat32(at + 16, r.carThicknessMeters, true);
    view.setFloat32(at + 20, r.carSpeedMetersPerSecond, true);
    view.setFloat32(at + 24, r.moduleHalfXMeters, true);
    view.setFloat32(at + 28, r.moduleHalfZMeters, true);
    at += 32;
    view.setUint32(at, r.stops.length, true);
    at += 4;
    for (const stop of r.stops) {
      view.setFloat32(at, stop, true);
      at += 4;
    }
  }
  return out;
}

/** Wire-format twin of encodeElevators — the round-trip test's reader and the
 *  reference for constructor.zig decodeElevators. */
export function decodeElevators(bytes: Uint8Array): { version: number; records: ElevatorShaftRecord[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0, true);
  if (version !== ELEVATORS_LUMP_VERSION) throw new Error(`unsupported elevators version ${version}`);
  const shaftCount = view.getUint32(4, true);
  let at = 8;
  const records: ElevatorShaftRecord[] = [];
  for (let i = 0; i < shaftCount; i += 1) {
    const record: ElevatorShaftRecord = {
      x: view.getFloat32(at, true),
      z: view.getFloat32(at + 4, true),
      carHalfXMeters: view.getFloat32(at + 8, true),
      carHalfZMeters: view.getFloat32(at + 12, true),
      carThicknessMeters: view.getFloat32(at + 16, true),
      carSpeedMetersPerSecond: view.getFloat32(at + 20, true),
      moduleHalfXMeters: view.getFloat32(at + 24, true),
      moduleHalfZMeters: view.getFloat32(at + 28, true),
      stops: [],
    };
    at += 32;
    const stopCount = view.getUint32(at, true);
    at += 4;
    for (let k = 0; k < stopCount; k += 1) {
      record.stops.push(view.getFloat32(at, true));
      at += 4;
    }
    records.push(record);
  }
  return { version, records };
}
