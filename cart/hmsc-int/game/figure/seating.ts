// game/figure/seating — the contact-pin seating solver ("ass to brass", req_1930).
//
// THE ONE JOB: given a prop's seat PIN (where on the prop the ass goes + which
// way to face) and where that prop is placed in the world, return the
// { yawDeg, lift, offset } you hand straight to <FigureMeshes> so the figure's
// `seat` contact anchor lands exactly on the pin. This is the v1 SINGLE-pin
// case; the multi-pin recline solve (back/head/heels) is later work that reads
// the rest of the contact set defined in rig.ts.
//
// WHY IT INVERTS FigureMeshes: that component renders every rig-local position
// p as  world = R_y(yawDeg)·p + offset  (its `place`/`rotYVec`, render.tsx).
// The `seat` anchor (rig.ts anchorsFromSkeleton) lives in that SAME rig-local
// space, so we read it in the sit pose, pick yawDeg from the prop + pin facing,
// then solve offset = pinWorld − R_y(yawDeg)·anchor. No render layer is imported
// here — the solver is pure and unit-testable headless.
//
// R_y here is rotateEulerVec(v, [0, deg, 0]), which is byte-identical to
// FigureMeshes' own rotYVec (verified) — one rotation convention, no private copy.

import { type V3, addVec, subVec, rotateEulerVec } from './math';
import { buildRigAnchors } from './rig';
import type { BodyShapeId } from './shapes';
import type { RigTimelineAction } from './skeleton';

/** Where on a prop the seated ass lands. X/Z are prop-local meters off the
 *  ground anchor; Y comes from the seat's `seatHeightMeters`. `faceDeg` adds to
 *  the placed prop's yaw. Mirrors the resolved `PropSeat.pin` (game/kinds/props). */
export type SeatPin = { x: number; z: number; faceDeg: number };

/** The seat data the solver needs: the pelvis height + the resolved pin. */
export type SeatSpec = { seatHeightMeters: number; pin: SeatPin };

/** A placed prop in the world: its ground-anchor position + yaw in degrees. */
export type PlacedProp = { position: V3; yawDegrees: number };

/** What <FigureMeshes yawDeg lift offset> needs to seat the figure on the pin. */
export type SeatTransform = { yawDeg: number; lift: number; offset: V3 };

/** Full-sit pose driver: the skeleton reads "sit" from a 'body'/'sit' action
 *  phase (skeleton.ts actionPhase), so a phase-1 sit fully seats the figure. */
export const SIT_ACTIONS: readonly RigTimelineAction[] = [
  { target: 'body', action: 'sit', phase: 1, weight: 1 },
];

/** Y-axis rotation matching FigureMeshes exactly (see file header). */
function rotY(v: V3, yawDeg: number): V3 {
  return rotateEulerVec(v, [0, yawDeg, 0]);
}

/** The `seat` contact anchor's rig-local position for a body shape in the sit
 *  pose — i.e. where this figure's ass is, before any world placement. */
export function seatAnchorLocal(shapeId: BodyShapeId = 'neutral'): V3 {
  const anchors = buildRigAnchors(shapeId, 'stand', 0, SIT_ACTIONS as RigTimelineAction[]);
  const seat = anchors.find((a) => a.id === 'seat');
  if (!seat) throw new Error('seating: rig has no `seat` contact anchor');
  return seat.position;
}

/** Solve the figure transform that lands the `seat` anchor on the prop's pin.
 *  Hand the result straight to <FigureMeshes yawDeg lift offset>. */
export function seatTransformOnProp(
  seat: SeatSpec,
  prop: PlacedProp,
  shapeId: BodyShapeId = 'neutral',
): SeatTransform {
  // Face the prop's forward, rotated by the pin's facing.
  const yawDeg = prop.yawDegrees + seat.pin.faceDeg;
  // Where the ass will be after the body turns by yawDeg (still un-translated).
  const anchorTurned = rotY(seatAnchorLocal(shapeId), yawDeg);
  // The pin, lifted to seat height, carried into world by the prop's placement.
  const pinLocal: V3 = [seat.pin.x, seat.seatHeightMeters, seat.pin.z];
  const pinWorld = addVec(prop.position, rotY(pinLocal, prop.yawDegrees));
  // Translate the whole body so the turned anchor coincides with the pin.
  const offset = subVec(pinWorld, anchorTurned);
  return { yawDeg, lift: 0, offset };
}

/** Convenience: where the seat anchor ENDS UP in world after applying a
 *  SeatTransform — used by tests/tools to confirm it coincides with the pin. */
export function seatedAnchorWorld(shapeId: BodyShapeId, t: SeatTransform): V3 {
  return addVec(rotY(seatAnchorLocal(shapeId), t.yawDeg), t.offset);
}
