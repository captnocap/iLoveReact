// game/figure/seating — the contact-pin seating solver + face-rig derivation
// (req_1930 / req_2028-2030, "ass to brass").
//
// TWO halves, both geometry-blind and pure:
//
// 1) deriveSeatFromFaces — the AUTHORING model. You rig FACES of a prop by what
//    body part touches them (seat / back / head / legs); EVERYTHING else falls
//    out of the faces you picked, nothing is guessed:
//      • position + height  ← the seat face
//      • capacity (booth!)  ← the seat face's LENGTH (one slot per ~shoulder width)
//      • facing             ← you face AWAY from your back (back→seat), or toward
//                             the pillow when laying (seat→head), or over the leg
//                             edge (seat→legs) when there is no back
//      • sit vs lay         ← head tagged ⇒ lay, else sit
//    One verb ("what touches this face") covers chair / stool / bench / booth /
//    recliner / bed.
//
// 2) seatTransformForPin / seatTransformOnProp — land a figure's `seat` contact
//    anchor (rig.ts) on a pin and orient it, by INVERTING FigureMeshes' transform
//    (world = R_y(yawDeg)·p + offset, render.tsx). Hand the result straight to
//    <FigureMeshes yawDeg lift offset>. R_y here is rotateEulerVec(v,[0,deg,0]),
//    byte-identical to FigureMeshes' own rotYVec (verified) — one convention.

import { type V3, addVec, subVec, rotateEulerVec, RAD2DEG } from './math';
import { buildRigAnchors } from './rig';
import type { BodyShapeId } from './shapes';
import type { RigTimelineAction } from './skeleton';

/** Where on a prop one seated ass lands. X/Z are prop-local meters off the
 *  ground anchor; Y is the seat height. `faceDeg` adds to the placed prop's yaw. */
export type SeatPin = { x: number; z: number; faceDeg: number };

/** The seat data the single-pin solver needs (the v1 path). */
export type SeatSpec = { seatHeightMeters: number; pin: SeatPin };

/** A placed prop in the world: its ground-anchor position + yaw in degrees. */
export type PlacedProp = { position: V3; yawDegrees: number };

/** What <FigureMeshes yawDeg lift offset> needs to seat the figure on the pin. */
export type SeatTransform = { yawDeg: number; lift: number; offset: V3 };

/** The posture a seat puts the figure in — sit (chair) or lay (bed). */
export type SeatPose = 'sit' | 'lay';

/** Full-pose drivers: the skeleton reads sit/lay from a 'body' action phase
 *  (skeleton.ts actionPhase), so a phase-1 action fully poses the figure. */
export const SIT_ACTIONS: readonly RigTimelineAction[] = [{ target: 'body', action: 'sit', phase: 1, weight: 1 }];
export const LAY_ACTIONS: readonly RigTimelineAction[] = [{ target: 'body', action: 'lay', phase: 1, weight: 1 }];

function poseActions(pose: SeatPose): RigTimelineAction[] {
  return [...(pose === 'lay' ? LAY_ACTIONS : SIT_ACTIONS)];
}

/** Y-axis rotation matching FigureMeshes exactly (see file header). */
function rotY(v: V3, yawDeg: number): V3 {
  return rotateEulerVec(v, [0, yawDeg, 0]);
}

/** The `seat` contact anchor's rig-local position for a shape in a given pose —
 *  i.e. where this figure's ass is, before any world placement. */
export function seatAnchorLocal(shapeId: BodyShapeId = 'neutral', pose: SeatPose = 'sit'): V3 {
  const anchors = buildRigAnchors(shapeId, 'stand', 0, poseActions(pose));
  const seat = anchors.find((a) => a.id === 'seat');
  if (!seat) throw new Error('seating: rig has no `seat` contact anchor');
  return seat.position;
}

/** Solve the figure transform that lands the `seat` anchor on ONE pin in the
 *  given posture. The general primitive — single seats and every slot of a booth
 *  both go through here. */
export function seatTransformForPin(
  pin: SeatPin,
  seatHeightMeters: number,
  pose: SeatPose,
  prop: PlacedProp,
  shapeId: BodyShapeId = 'neutral',
): SeatTransform {
  const yawDeg = prop.yawDegrees + pin.faceDeg;
  const anchorTurned = rotY(seatAnchorLocal(shapeId, pose), yawDeg);
  const pinLocal: V3 = [pin.x, seatHeightMeters, pin.z];
  const pinWorld = addVec(prop.position, rotY(pinLocal, prop.yawDegrees));
  return { yawDeg, lift: 0, offset: subVec(pinWorld, anchorTurned) };
}

/** Single-pin convenience (the v1 'seat' bundle, sit posture). */
export function seatTransformOnProp(
  seat: SeatSpec,
  prop: PlacedProp,
  shapeId: BodyShapeId = 'neutral',
): SeatTransform {
  return seatTransformForPin(seat.pin, seat.seatHeightMeters, 'sit', prop, shapeId);
}

/** Where the seat anchor ENDS UP in world after a SeatTransform — for
 *  tests/tools to confirm it coincides with the pin. */
export function seatedAnchorWorld(shapeId: BodyShapeId, t: SeatTransform, pose: SeatPose = 'sit'): V3 {
  return addVec(rotY(seatAnchorLocal(shapeId, pose), t.yawDeg), t.offset);
}

// ── the face-rig derivation ──────────────────────────────────────────────────

/** Which body part a rigged face is for. `legs` = the back of the thighs/calves
 *  (a backless stool/booth lip), the directional fallback when there is no back. */
export type SeatBodyPart = 'seat' | 'back' | 'head' | 'legs';

/** One rigged face: the body part + the face's vertices in the ASSET-local frame
 *  (prop yaw 0, ground anchor = origin), meters. The Studio cook fills `verts`
 *  by transforming each face's mesh loop into that frame. */
export type RiggedFace = { bodyPart: SeatBodyPart; verts: V3[] };

/** The AUTHORED seat-rig link (req_2028-2030): a face of a model part tagged by
 *  the body part that touches it. The Studio "Rig" tool produces these and they
 *  persist on the model; the cook resolves each to ground-lifted verts (a
 *  RiggedFace) and runs deriveSeatFromFaces. `part` is the StoredPart id, `face`
 *  the index into that part's mesh.faces. */
export type SeatRigFace = { part: string; face: number; bodyPart: SeatBodyPart };

/** A seat derived from rigged faces — exactly the fields a cooked PropSeat needs. */
export type DerivedSeat = {
  pose: SeatPose;
  seatHeightMeters: number;
  capacity: number;
  pins: SeatPin[];
};

/** ~shoulder width — one SIT slot per this much seat-face length (booth spacing). */
export const SEAT_SLOT_METERS = 0.55;
/** ~body width — one LAY slot per this much seat-face WIDTH (a double bed ≈ 2). */
export const LAY_SLOT_METERS = 0.7;

function centroid(verts: V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (const v of verts) { x += v[0]; y += v[1]; z += v[2]; }
  const n = Math.max(1, verts.length);
  return [x / n, y / n, z / n];
}

type FaceAxis = { dirX: number; dirZ: number; length: number };

/** The X/Z bounding-box axes of the seat verts — `long` (the wider span = bench
 *  length) and `short` (depth). Robust to a seat made of MANY faces (a sculpted,
 *  curved seat), unlike per-edge axes which assume a single quad loop. Occupants
 *  pack along `long` when sitting (a booth bench), along `short` when laying. */
function seatBoxAxes(verts: V3[]): { long: FaceAxis; short: FaceAxis } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of verts) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const xAxis: FaceAxis = { dirX: 1, dirZ: 0, length: Math.max(0, maxX - minX) };
  const zAxis: FaceAxis = { dirX: 0, dirZ: 1, length: Math.max(0, maxZ - minZ) };
  return xAxis.length >= zAxis.length ? { long: xAxis, short: zAxis } : { long: zAxis, short: xAxis };
}

/** Figure faces -Z at yaw 0 (render.tsx). Convert a horizontal facing direction
 *  into the figure yaw that points its forward along it. */
function faceDegFromDir(dx: number, dz: number): number {
  if (Math.hypot(dx, dz) < 1e-6) return 0;
  return Math.atan2(-dx, -dz) * RAD2DEG;
}

/** Derive a seat from the rigged faces, or null if no seat face was tagged.
 *  Pure — the cook and any probe both call this (rule-of-two; no parallel logic). */
export function deriveSeatFromFaces(faces: RiggedFace[]): DerivedSeat | null {
  // Aggregate ALL faces of each tag — a sculpted seat/backrest is many faces, and
  // reading just the FIRST one skews the centroid so the model sits crooked
  // (req_2043). The combined centroid of every back face gives a centered facing.
  const vertsOf = (bp: SeatBodyPart): V3[] => faces.filter((f) => f.bodyPart === bp).flatMap((f) => f.verts);
  const seatVerts = vertsOf('seat');
  if (!seatVerts.length) return null;
  const seatC = centroid(seatVerts);
  const partCentroid = (bp: SeatBodyPart): V3 | null => { const v = vertsOf(bp); return v.length ? centroid(v) : null; };
  const backC = partCentroid('back');
  const headC = partCentroid('head');
  const legsC = partCentroid('legs');

  // Pose: a head contact means the head rests on a surface — that's laying down.
  const pose: SeatPose = headC ? 'lay' : 'sit';

  // Facing: orient head→pillow when laying; else face AWAY from the back; else out
  // over the leg edge. Uses the COMBINED centroid of every tagged face, so a wide
  // or multi-face backrest yields a centered (un-crooked) direction.
  let dx = 0, dz = 0;
  if (headC) { dx = headC[0] - seatC[0]; dz = headC[2] - seatC[2]; }
  else if (backC) { dx = seatC[0] - backC[0]; dz = seatC[2] - backC[2]; }
  else if (legsC) { dx = legsC[0] - seatC[0]; dz = legsC[2] - seatC[2]; }
  const faceDeg = faceDegFromDir(dx, dz);

  // Capacity: occupants pack along the seat. SITTING they sit side by side down the
  // LONG axis (a booth bench); LAYING the body runs down the long axis, so sleepers
  // pack across the SHORT axis (a bed). Slots are centered on the seat.
  const { long, short } = seatBoxAxes(seatVerts);
  const slotAxis = pose === 'lay' ? short : long;
  const slotMeters = pose === 'lay' ? LAY_SLOT_METERS : SEAT_SLOT_METERS;
  const capacity = Math.max(1, Math.round(slotAxis.length / slotMeters));
  const step = capacity > 1 ? slotAxis.length / capacity : 0;
  const pins: SeatPin[] = [];
  for (let i = 0; i < capacity; i += 1) {
    const t = (i - (capacity - 1) / 2) * step;
    pins.push({ x: seatC[0] + slotAxis.dirX * t, z: seatC[2] + slotAxis.dirZ * t, faceDeg });
  }

  return { pose, seatHeightMeters: seatC[1], capacity, pins };
}
