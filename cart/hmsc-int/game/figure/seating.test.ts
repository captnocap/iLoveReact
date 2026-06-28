// seating.test.ts — the contact-pin seating solver (req_1930, "ass to brass").
//
// Contract under test: seatTransformOnProp returns a { yawDeg, lift, offset }
// such that the figure's `seat` contact anchor, once placed by FigureMeshes'
// transform, coincides EXACTLY with the prop's seat pin in world space — for
// every body shape, any prop position/yaw, and any pin offset/facing. The test
// re-derives the pin's world position with an INDEPENDENT copy of FigureMeshes'
// place transform (turnPlace, same as rig.test.ts) so a regression in the
// solver's own rotation can't hide behind a shared helper.

import { deriveSeatFromFaces, seatAnchorLocal, seatTransformForPin, seatTransformOnProp, seatedAnchorWorld, type PlacedProp, type RiggedFace, type SeatBodyPart, type SeatSpec } from './seating';
import type { BodyShapeId } from './shapes';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

// FigureMeshes' place transform, re-derived: world = R_y(yawDeg)·p + offset.
function turnPlace(p: readonly number[], yawDeg: number, off: readonly number[]): [number, number, number] {
  const rad = yawDeg * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return [p[0] * c + p[2] * s + off[0], p[1] + off[1], -p[0] * s + p[2] * c + off[2]];
}

const SHAPES: BodyShapeId[] = ['neutral', 'female', 'male', 'tall', 'short', 'heavy', 'skinny', 'bodybuilder'];

type Case = { seatHeightMeters: number; pin: SeatSpec['pin']; prop: PlacedProp };
const CASES: Case[] = [
  { seatHeightMeters: 0.45, pin: { x: 0, z: 0, faceDeg: 0 }, prop: { position: [0, 0, 0], yawDegrees: 0 } },
  { seatHeightMeters: 0.45, pin: { x: 0, z: 0, faceDeg: 0 }, prop: { position: [3, 0, -2], yawDegrees: 90 } },
  { seatHeightMeters: 0.5, pin: { x: 0.2, z: -0.1, faceDeg: 30 }, prop: { position: [10, 1.5, 4], yawDegrees: 215 } },
  { seatHeightMeters: 0.9, pin: { x: -0.15, z: 0.25, faceDeg: -110 }, prop: { position: [-7, 0.3, 12], yawDegrees: 47 } },
];

test('the seat anchor lands exactly on the prop pin across shapes/yaws/pins', () => {
  for (const shape of SHAPES) {
    for (const c of CASES) {
      const seat: SeatSpec = { seatHeightMeters: c.seatHeightMeters, pin: c.pin };
      const t = seatTransformOnProp(seat, c.prop, shape);
      const got = seatedAnchorWorld(shape, t);
      const pinWorld = turnPlace([c.pin.x, c.seatHeightMeters, c.pin.z], c.prop.yawDegrees, c.prop.position);
      for (let i = 0; i < 3; i += 1) {
        assertClose(got[i], pinWorld[i], 1e-6, `${shape} pin landing comp ${i} (yaw ${c.prop.yawDegrees})`);
      }
      assertClose(t.yawDeg, c.prop.yawDegrees + c.pin.faceDeg, 1e-9, 'yawDeg = propYaw + faceDeg');
    }
  }
});

test('a default-centered pin seats the ass at seat height over the anchor', () => {
  const seat: SeatSpec = { seatHeightMeters: 0.45, pin: { x: 0, z: 0, faceDeg: 0 } };
  const t = seatTransformOnProp(seat, { position: [0, 0, 0], yawDegrees: 0 }, 'neutral');
  const got = seatedAnchorWorld('neutral', t);
  assertClose(got[1], 0.45, 1e-6, 'ass at seat height');
  assertClose(got[0], 0, 1e-6, 'centered in x');
  assertClose(got[2], 0, 1e-6, 'centered in z');
});

test('the seat anchor is a real finite point in the sit pose', () => {
  const a = seatAnchorLocal('neutral');
  assert(Number.isFinite(a[0] + a[1] + a[2]), 'seat anchor position is finite');
});

// ── face-rig derivation (req_2028-2030) ──────────────────────────────────────

type V3 = [number, number, number];
// a horizontal quad face centered at (cx,cz) at height h, w along X, d along Z.
function horizFace(bodyPart: SeatBodyPart, cx: number, cz: number, h: number, w: number, d: number): RiggedFace {
  const verts: V3[] = [[cx - w / 2, h, cz - d / 2], [cx + w / 2, h, cz - d / 2], [cx + w / 2, h, cz + d / 2], [cx - w / 2, h, cz + d / 2]];
  return { bodyPart, verts };
}
// a vertical quad (a backrest/headboard) at z=cz, spanning y h..h+ht, w along X.
function vertFace(bodyPart: SeatBodyPart, cx: number, cz: number, h: number, ht: number, w: number): RiggedFace {
  const verts: V3[] = [[cx - w / 2, h, cz], [cx + w / 2, h, cz], [cx + w / 2, h + ht, cz], [cx - w / 2, h + ht, cz]];
  return { bodyPart, verts };
}

test('a chair (seat + back) → one sit slot, facing away from the back', () => {
  const seat = deriveSeatFromFaces([
    horizFace('seat', 0, 0, 0.45, 0.5, 0.5),
    vertFace('back', 0, 0.23, 0.45, 0.5, 0.5), // backrest at +Z
  ])!;
  assertEqual(seat.pose, 'sit', 'no head → sit');
  assertEqual(seat.capacity, 1, 'a single chair');
  assertEqual(seat.pins.length, 1, 'one pin');
  assertClose(seat.seatHeightMeters, 0.45, 1e-6, 'seat height = the seat face Y');
  assertClose(seat.pins[0].faceDeg, 0, 1e-4, 'back at +Z → face -Z (away from back)');
});

test('a booth bench (long seat + back) → multiple evenly-spaced slots, same facing', () => {
  const seat = deriveSeatFromFaces([
    horizFace('seat', 0, 0, 0.45, 2.2, 0.5), // 2.2m bench along X
    vertFace('back', 0, 0.25, 0.45, 0.5, 2.2),
  ])!;
  assertEqual(seat.pose, 'sit', 'sit');
  assertEqual(seat.capacity, 4, '2.2m / 0.55 ≈ 4 seats');
  assertEqual(seat.pins.length, 4, 'four pins');
  for (const p of seat.pins) {
    assertClose(p.faceDeg, 0, 1e-4, 'every booth seat faces the same way');
    assertClose(p.z, 0, 1e-6, 'slots run along X, centered on Z');
  }
  // spread along X, centered on 0, ordered
  assert(seat.pins[0].x < seat.pins[3].x, 'slots spread along the bench');
  assertClose((seat.pins[0].x + seat.pins[3].x) / 2, 0, 1e-6, 'centered on the face');
});

test('a bed (seat + back + head) → lay pose, packs across the width, head-ward facing', () => {
  const seat = deriveSeatFromFaces([
    horizFace('seat', 0, 0, 0.5, 1.4, 2.0), // double bed: 1.4 wide (X), 2.0 long (Z)
    horizFace('back', 0, 0, 0.5, 1.4, 2.0),
    vertFace('head', 0, -1.0, 0.5, 0.4, 1.4), // pillow end at -Z
  ])!;
  assertEqual(seat.pose, 'lay', 'head tagged → lay');
  assertEqual(seat.capacity, 2, '1.4m width / 0.7 = 2 sleepers');
  for (const p of seat.pins) {
    assertClose(p.faceDeg, 0, 1e-4, 'head at -Z → orient toward -Z');
    assertClose(p.z, 0, 1e-6, 'sleepers pack across X (the width), not down the length');
  }
});

test('a backless stool (seat only) → one slot, default facing', () => {
  const seat = deriveSeatFromFaces([horizFace('seat', 0, 0, 0.6, 0.4, 0.4)])!;
  assertEqual(seat.capacity, 1, 'one perch');
  assertEqual(seat.pose, 'sit', 'sit');
  assertClose(seat.pins[0].faceDeg, 0, 1e-4, 'no directional contact → default facing');
});

test('no seat face → no seat', () => {
  assertEqual(deriveSeatFromFaces([vertFace('back', 0, 0, 0, 0.5, 0.5)]), null, 'a back alone is not a seat');
});

test('every derived booth pin lands its occupant exactly (multi-seat solve)', () => {
  const seat = deriveSeatFromFaces([
    horizFace('seat', 0, 0, 0.45, 2.2, 0.5),
    vertFace('back', 0, 0.25, 0.45, 0.5, 2.2),
  ])!;
  const prop: PlacedProp = { position: [5, 0.2, -3], yawDegrees: 65 };
  for (const pin of seat.pins) {
    const t = seatTransformForPin(pin, seat.seatHeightMeters, seat.pose, prop, 'neutral');
    const got = seatedAnchorWorld('neutral', t, seat.pose);
    const want = turnPlace([pin.x, seat.seatHeightMeters, pin.z], prop.yawDegrees, prop.position);
    for (let i = 0; i < 3; i += 1) assertClose(got[i], want[i], 1e-6, `booth occupant landing comp ${i}`);
  }
});

finish('seating');
