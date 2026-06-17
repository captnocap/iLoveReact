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

/** Seat a wheel from a selected face: centroid = the axle point; the dominant
 *  normal cardinal = the spin axis (so the tire stays VERTICAL and rolls — a wheel
 *  is never tilted to match a slanted fender, exactly like a real car); radius =
 *  the median 3D distance from the centroid to the rim verts. That rim radius is
 *  SLANT-INDEPENDENT (a true 3D distance, not a foreshortened cardinal projection),
 *  so an angled round well still sizes the tire correctly (req_1264). For a round
 *  well (the well's n-gon cap) it's the circle radius; a rectangular face gives the
 *  corner radius (round wells are the intended case). Null on a degenerate face. */
export function faceWheelFit(m: EditMesh, faceIndex: number): { center: V3; radius: number; axis: 0 | 1 | 2 } | null {
  const f = m.faces[faceIndex];
  if (!f || f.loop.length < 3) return null;
  const center = faceCentroid(m, f);
  const n = faceNormal(m, f);
  const a0 = Math.abs(n[0]), a1 = Math.abs(n[1]), a2 = Math.abs(n[2]);
  const axis: 0 | 1 | 2 = a0 >= a1 && a0 >= a2 ? 0 : a1 >= a2 ? 1 : 2;
  const dists: number[] = [];
  for (const idx of f.loop) {
    const v = m.verts[idx];
    if (v) dists.push(Math.hypot(v[0] - center[0], v[1] - center[1], v[2] - center[2]));
  }
  if (dists.length === 0) return null;
  dists.sort((p, q) => p - q);
  const radius = dists[Math.floor(dists.length / 2)]; // median rim distance
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
