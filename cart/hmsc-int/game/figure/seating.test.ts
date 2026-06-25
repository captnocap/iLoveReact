// seating.test.ts — the contact-pin seating solver (req_1930, "ass to brass").
//
// Contract under test: seatTransformOnProp returns a { yawDeg, lift, offset }
// such that the figure's `seat` contact anchor, once placed by FigureMeshes'
// transform, coincides EXACTLY with the prop's seat pin in world space — for
// every body shape, any prop position/yaw, and any pin offset/facing. The test
// re-derives the pin's world position with an INDEPENDENT copy of FigureMeshes'
// place transform (turnPlace, same as rig.test.ts) so a regression in the
// solver's own rotation can't hide behind a shared helper.

import { seatAnchorLocal, seatTransformOnProp, seatedAnchorWorld, type PlacedProp, type SeatSpec } from './seating';
import type { BodyShapeId } from './shapes';
import { assert, assertClose, finish, test } from '../_testkit';

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

finish('seating');
