// wheelMount.test.ts — pins "wheel from a face" (req_1261): a well's back face →
// axle point (centroid) + spin axis (normal) + a radius from the face opening, and
// the wheel built as a pivoted part seated at that hub. Pure + headless.

import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';
import { cuboid, hasPivot, pivotOf, type EditMesh } from './editMesh';
import { axleSpinAxis, buildWheelPart, faceWheelFit, mirroredCenters } from './wheelMount';

// a single quad facing −X at x=2, spanning z∈[-1,1], y∈[0,3] → in-plane extent 2×3.
function xFace(): EditMesh {
  return {
    verts: [[2, 0, -1], [2, 0, 1], [2, 3, 1], [2, 3, -1]],
    faces: [{ loop: [0, 1, 2, 3] }],
  };
}

test('faceWheelFit: centroid is the axle point, radius = half the SMALLER in-plane extent', () => {
  const fit = faceWheelFit(xFace(), 0);
  assert(!!fit, 'a valid face yields a fit');
  assertEqual(fit!.axis, 0, 'a face facing ±X → axle about X');
  assertClose(fit!.center[1], 1.5, 1e-6, 'centroid y = mid of [0,3]');
  assertClose(fit!.center[2], 0, 1e-6, 'centroid z = mid of [-1,1]');
  // in-plane extents are 2 (z) and 3 (y); radius = min/2 = 1 (fits the opening, not
  // the corner-to-corner diagonal a circle fit would give).
  assertClose(fit!.radius, 1, 1e-6, 'radius = half the smaller opening dimension');
});

test('faceWheelFit: a degenerate face returns null', () => {
  assertEqual(faceWheelFit({ verts: [[0, 0, 0], [1, 0, 0]], faces: [{ loop: [0, 1] }] }, 0), null, 'a <3-corner loop is not a face');
});

test('axleSpinAxis: the unit roll axis for each coordinate', () => {
  assertEqual(JSON.stringify(axleSpinAxis(0)), JSON.stringify([1, 0, 0]), 'X');
  assertEqual(JSON.stringify(axleSpinAxis(2)), JSON.stringify([0, 0, 1]), 'Z');
});

test('buildWheelPart: a pivoted tire seated at the hub', () => {
  const fit = faceWheelFit(xFace(), 0)!;
  const part = buildWheelPart(fit, 0.5, 12);
  assert(part.verts.length > 0 && part.faces.length > 0, 'the tire has geometry');
  assert(hasPivot(part), 'the wheel carries a pivot (its rotation origin)');
  const p = pivotOf(part);
  assertClose(p[0], fit.center[0], 1e-6, 'pivot at the hub x (the axle)');
  assertClose(p[1], fit.center[1], 1e-6, 'pivot at the hub y');
  // the tire is seated AT the center, not left at the origin.
  let cx = 0; for (const v of part.verts) cx += v[0]; cx /= part.verts.length;
  assertClose(cx, fit.center[0], 1e-6, 'the tire verts are centered on the hub, not the origin');
});

test('mirroredCenters: original + reflections across the enabled planes', () => {
  const c: [number, number, number] = [3, 1, 2];
  assertEqual(mirroredCenters(c, []).length, 1, 'no mirror → just the original');
  const x = mirroredCenters(c, [0]);
  assertEqual(x.length, 2, 'one plane → original + 1 reflection');
  assertEqual(JSON.stringify(x[1]), JSON.stringify([-3, 1, 2]), 'X mirror flips x');
  const xz = mirroredCenters(c, [0, 2]);
  assertEqual(xz.length, 4, 'two planes → all four (original + X + Z + XZ)');
  assert(xz.some((p) => p[0] === -3 && p[2] === -2), 'the diagonal (XZ) corner is present');
});

finish('wheelMount');
