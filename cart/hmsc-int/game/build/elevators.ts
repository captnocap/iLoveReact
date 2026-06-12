// game/build/elevators — the ELEVATOR shaft + car semantics (REQ-0647).
//
// USER ASK (req_0641/req_0647, verbatim shape): "an elevator method … it just
// has a stop at every floor and is only 1 wide wall and floor space so it fits
// right in" — "a 'ramp' that is really an elevator". NOT a prefab (USER: "i
// kept saying dont put it in prefabs"): the elevator is a first-class catalog
// PIECE in the ramp/stairs vertical-link family. One placed piece = one storey
// of shaft; STACKING pieces grows the shaft, and every stacked storey IS a
// stop — no floor-count dialog, the world is the configuration.
//
// This module is the PURE layer over the placed pieces:
//   • elevatorShafts     stacked elevator pieces → shaft records (stops list)
//   • elevatorCarRect    the car's live collision rect at a given height
//   • elevatorCarBox     the car's render box (same footprint, one source)
//   • updateElevatorCarRect  in-place re-aim of a live rect (per-frame ride)
//   • nextElevatorStop / nearestElevatorStop  stop arithmetic for E-interact
//   • elevatorRestCarRects  cars at their rest stop — what the COMPILE bake
//     ships (the compiled game gets a standable car; live motion is the play
//     route's layer, the same split the dynamic props use)
//
// The shaft frame's STATIC colliders live with the other piece colliders
// (placed.ts pushElevatorShaftRects); all numbers are PLACED_TUNING rows.

import { catalogEntry, type BuildPieceSize } from './catalog';
import { PLACED_TUNING, placedPieceDef, type PlacedBuildPiece } from './placed';
import type { CollisionRect } from '../physics';

export type ElevatorShaft = {
  /** the shaft's identity = its lowest storey's piece id (stable per derive) */
  key: string;
  x: number;
  z: number;
  yawDegrees: number;
  /** ascending storey base levels — the car serves one stop per storey */
  stops: number[];
  /** world top of the highest storey piece */
  topY: number;
  /** the storey module's catalog size (uniform across the shaft) */
  size: BuildPieceSize;
};

/** Group placed elevator pieces into shafts: same x/z column, vertically
 *  contiguous storeys (seam within elevatorStackToleranceMeters). A gap splits
 *  the column into separate shafts — each runs its own car. */
export function elevatorShafts(pieces: readonly PlacedBuildPiece[]): ElevatorShaft[] {
  const columns = new Map<string, PlacedBuildPiece[]>();
  for (const piece of pieces) {
    if (placedPieceDef(piece).kind !== 'elevator') continue;
    const key = `${piece.x.toFixed(3)}|${piece.z.toFixed(3)}`;
    const column = columns.get(key);
    if (column) column.push(piece);
    else columns.set(key, [piece]);
  }
  const tolerance = PLACED_TUNING.elevatorStackToleranceMeters;
  const shafts: ElevatorShaft[] = [];
  for (const column of columns.values()) {
    column.sort((a, b) => a.y - b.y);
    let current: PlacedBuildPiece[] = [];
    const flush = () => {
      if (current.length === 0) return;
      const base = current[0];
      const size = catalogEntry(base.pieceId).size;
      shafts.push({
        key: base.id,
        x: base.x,
        z: base.z,
        yawDegrees: base.yawDegrees,
        stops: current.map((piece) => piece.y),
        topY: current[current.length - 1].y + size.heightMeters,
        size,
      });
      current = [];
    };
    for (const piece of column) {
      const prev = current[current.length - 1];
      if (prev && Math.abs(piece.y - (prev.y + catalogEntry(prev.pieceId).size.heightMeters)) > tolerance) flush();
      current.push(piece);
    }
    flush();
  }
  return shafts;
}

/** The car's standable TOP surface for a stop level (the slab rides above the
 *  stop so it meets the 0.2m floor-plate top at each storey within a step). */
export function elevatorCarTop(carY: number): number {
  return carY + PLACED_TUNING.elevatorCarFloorThicknessMeters;
}

function carHalfSpans(shaft: ElevatorShaft): { halfX: number; halfZ: number } {
  const inset = PLACED_TUNING.elevatorShaftWallThicknessMeters + PLACED_TUNING.elevatorCarInsetMeters;
  // The storey module is a square plate (3×3), so the axis-aligned footprint
  // is yaw-independent at the build grammar's quarter turns.
  return {
    halfX: shaft.size.widthMeters / 2 - inset,
    halfZ: shaft.size.depthMeters / 2 - inset,
  };
}

/** The car's live collision rect with carY = the stop level it is serving (or
 *  any height in between, mid-ride). The play route mutates this object in
 *  place per frame — the host reads rects per step, so the ride is free. */
export function elevatorCarRect(shaft: ElevatorShaft, carY: number): CollisionRect {
  const { halfX, halfZ } = carHalfSpans(shaft);
  return {
    minX: shaft.x - halfX,
    maxX: shaft.x + halfX,
    minZ: shaft.z - halfZ,
    maxZ: shaft.z + halfZ,
    topMeters: elevatorCarTop(carY),
    floorMeters: carY,
    blocksPlayer: true,
    friction: PLACED_TUNING.pieceFriction,
    restitution: PLACED_TUNING.pieceRestitution,
  };
}

/** Re-aim a live car rect at a new height WITHOUT replacing the object — the
 *  physics step holds the same array, so in-place is the ride. */
export function updateElevatorCarRect(rect: CollisionRect, carY: number): void {
  rect.topMeters = elevatorCarTop(carY);
  rect.floorMeters = carY;
}

/** The car's render box (cy is the box CENTER): same footprint as the rect. */
export function elevatorCarBox(
  shaft: ElevatorShaft,
  carY: number,
): { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number; yawDegrees: number } {
  const { halfX, halfZ } = carHalfSpans(shaft);
  const thickness = PLACED_TUNING.elevatorCarFloorThicknessMeters;
  return {
    cx: shaft.x,
    cy: carY + thickness / 2,
    cz: shaft.z,
    sx: halfX * 2,
    sy: thickness,
    sz: halfZ * 2,
    yawDegrees: shaft.yawDegrees,
  };
}

/** The next stop the car serves from carY: the closest stop ABOVE, wrapping to
 *  the bottom from the top — E rides the loop. Null for a one-stop shaft. */
export function nextElevatorStop(shaft: ElevatorShaft, carY: number): number | null {
  if (shaft.stops.length < 2) return null;
  const tolerance = PLACED_TUNING.elevatorArriveToleranceMeters;
  for (const stop of shaft.stops) {
    if (stop > carY + tolerance) return stop;
  }
  return shaft.stops[0];
}

/** The stop level nearest a body's y (boarding/calling resolves against it). */
export function nearestElevatorStop(shaft: ElevatorShaft, y: number): number {
  let best = shaft.stops[0];
  for (const stop of shaft.stops) {
    if (Math.abs(stop - y) < Math.abs(best - y)) best = stop;
  }
  return best;
}

/** Every shaft's car at its REST stop (the bottom storey) — the static twin
 *  the compile bake ships so the compiled game has a standable car. The play
 *  route does NOT use this: its live rects move. */
export function elevatorRestCarRects(pieces: readonly PlacedBuildPiece[]): CollisionRect[] {
  return elevatorShafts(pieces).map((shaft) => elevatorCarRect(shaft, shaft.stops[0]));
}
