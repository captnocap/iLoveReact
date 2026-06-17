// editors/model/wheelMount.ts — "wheel from a face" (req_1261). The user's insight:
// a wheel well's flat back FACE already gives you everything to seat a wheel — its
// CENTROID is the axle point and its NORMAL is the spin axis — so one function can
// drop the axle joint at the center and generate a wheel connected right there.
//
// This is the wheel-specific shortcut of the general pivot↔joint connection: the
// body gets an axle socket at the face center; the wheel comes in as its OWN part
// with a pivot at that same hub (its rotation origin), ready for the articulation
// runtime to spin. Distinct from `fitWheelCenter`, which fits a CIRCLE to picked
// ARCH verts — a flat rectangular face's corners would give the circumscribed
// circle (too big), so the radius here comes from the face's in-plane extent.
//
// Pure + headless (the editMesh idiom), unit-testable.

import { faceCentroid, faceNormal, mergeMesh, setPivot, wheelMesh, type EditMesh, type V3 } from './editMesh';

/** The two in-plane coordinate axes for a face whose dominant normal is `axis`. */
function inPlaneCoords(axis: 0 | 1 | 2): [number, number] {
  return axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
}

/** Seat a wheel from a selected face: centroid = the axle point, dominant normal =
 *  the spin axis, radius = HALF the smaller in-plane extent (the well opening, so
 *  the tire fits the hole rather than the corner-to-corner diagonal). Null on a
 *  degenerate face. */
export function faceWheelFit(m: EditMesh, faceIndex: number): { center: V3; radius: number; axis: 0 | 1 | 2 } | null {
  const f = m.faces[faceIndex];
  if (!f || f.loop.length < 3) return null;
  const center = faceCentroid(m, f);
  const n = faceNormal(m, f);
  const a0 = Math.abs(n[0]), a1 = Math.abs(n[1]), a2 = Math.abs(n[2]);
  const axis: 0 | 1 | 2 = a0 >= a1 && a0 >= a2 ? 0 : a1 >= a2 ? 1 : 2;
  const [iu, iv] = inPlaneCoords(axis);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const idx of f.loop) {
    const v = m.verts[idx];
    if (!v) continue;
    if (v[iu] < minU) minU = v[iu]; if (v[iu] > maxU) maxU = v[iu];
    if (v[iv] < minV) minV = v[iv]; if (v[iv] > maxV) maxV = v[iv];
  }
  const radius = Math.min(maxU - minU, maxV - minV) / 2;
  if (!(radius > 0)) return null;
  return { center, radius, axis };
}

/** The spin axis (unit V3) for an axle about coordinate `axis` — the joint's `axis`
 *  and the wheel's roll axis, so the tire rolls correctly however the car faces. */
export function axleSpinAxis(axis: 0 | 1 | 2): V3 {
  return [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
}

/** Build the wheel as its OWN part, seated at `center` with a pivot at the hub (its
 *  rotation origin = the axle). `wheelMesh` mints the tire at the origin; we merge
 *  it into an empty mesh translated to `center` so the part sits in the body's local
 *  frame, then stamp the pivot. Pure. */
export function buildWheelPart(fit: { center: V3; radius: number; axis: 0 | 1 | 2 }, widthFraction: number, sides: number): EditMesh {
  const tire = wheelMesh(fit.radius, fit.radius * widthFraction, sides, fit.axis);
  const seated = mergeMesh({ verts: [], faces: [] }, tire, fit.center);
  return setPivot(seated, [fit.center[0], fit.center[1], fit.center[2]]);
}

/** Reflect a center point across every non-empty subset of the mirror planes (each
 *  `= 0`) — one well face → both sides / all four corners, mirroring the
 *  addMountReflections idiom so the joints and wheels stay in sync. Includes the
 *  original as the first entry. Pure. */
export function mirroredCenters(center: V3, axes: (0 | 1 | 2)[]): V3[] {
  const out: V3[] = [[center[0], center[1], center[2]]];
  for (let mask = 1; mask < (1 << axes.length); mask += 1) {
    const c: V3 = [center[0], center[1], center[2]];
    for (let k = 0; k < axes.length; k += 1) if (mask & (1 << k)) c[axes[k]] = -c[axes[k]];
    out.push(c);
  }
  return out;
}
