// Globe — an equirect-unwrapped sphere with a paintable radial DISPLACEMENT
// grid. The sculpting base mesh for "paint a head into existence":
//
//   - The texture space is the standard 2:1 globe unwrap (paint/compose a face
//     onto that rectangle; u=0.5 is the FRONT of the head at -Z, the seam hides
//     at the back, image reads unmirrored from the front — same facing
//     convention as Head.ts and Carve.ts).
//   - `displace` is a dCols×dRows grid in that SAME unwrap space: each vertex
//     pushes outward along its radius by `amount × bilinear(displace, u, v)`.
//     Painted depth strokes and the painted photo therefore stay registered —
//     no separate unwrap step exists anywhere.
//
// Normals are finite-differenced over the displaced surface, so sculpted bumps
// shade correctly. Displacement samples wrap horizontally (seam-safe) and the
// pole rows collapse to their row-average so the caps never crack open.
// `scaleY` squashes/stretches the whole head (skulls aren't spheres).
import { mesh, normalize, type GeometryData, type Vec3 } from './_util';

export type GlobeParams = {
  radius: number;
  segments: number;
  rings: number;
  /** Radial displacement grid (unwrap space, row 0 = top). 0 = base sphere. */
  displace?: number[];
  dCols?: number;
  dRows?: number;
  /** World units added at displace=1. */
  amount?: number;
  /** Vertical stretch of the whole globe (1 = sphere). */
  scaleY?: number;
  /**
   * Silhouette profile: radius multipliers sampled (lerped) top→bottom along
   * v. This is what turns the egg into ANY body part — [0.5, 0.9, 1, 0.9, 0.5]
   * is a limb, [0.7, 1, 1, 0.95, 0.6] a torso — while the unwrap, the paint
   * space, and the displacement grid stay identical. Omit for a sphere.
   *
   * The profile shapes the RADIAL (x/z) silhouette only — length comes from
   * scaleY alone, like a lathe with fixed row heights (which is exactly what
   * the outline editor draws). Thinning a part must never shorten it: body
   * parts are placed by a skeleton with fixed joint spans, and profile-scaled
   * length was how limbs used to detach at the wrists/knees.
   */
  profile?: number[];
  /** Per-axis squash of the whole shape (hands/feet flatten with scaleZ). */
  scaleX?: number;
  scaleZ?: number;
};

export const GLOBE_DEFAULTS: GlobeParams = { radius: 0.5, segments: 32, rings: 16, amount: 0, scaleY: 1 };

const PI = Math.PI;

export function generate(p: GlobeParams): GeometryData {
  const { radius, segments, rings } = p;
  const amount = p.amount ?? 0;
  const scaleY = p.scaleY ?? 1;
  const scaleX = p.scaleX ?? 1;
  const scaleZ = p.scaleZ ?? 1;
  const grid = p.displace;
  const dCols = p.dCols ?? 0;
  const dRows = p.dRows ?? 0;
  const hasGrid = !!grid && dCols > 1 && dRows > 1 && amount !== 0;

  // Silhouette profile: lerped radius multiplier along v (top→bottom).
  const prof = p.profile && p.profile.length > 0 ? p.profile : null;
  const profileAt = (v: number): number => {
    if (!prof) return 1;
    if (prof.length === 1) return prof[0];
    const t = Math.max(0, Math.min(1, v)) * (prof.length - 1);
    const i = Math.min(prof.length - 2, Math.floor(t));
    return prof[i] + (prof[i + 1] - prof[i]) * (t - i);
  };

  // Row-averages for the pole rows: every column converges to one point at a
  // pole, so they must share one displacement or the cap cracks.
  let topAvg = 0;
  let botAvg = 0;
  if (hasGrid) {
    for (let x = 0; x < dCols; x++) {
      topAvg += grid![x];
      botAvg += grid![(dRows - 1) * dCols + x];
    }
    topAvg /= dCols;
    botAvg /= dCols;
  }

  // Bilinear displacement sample; u wraps (seam-safe), v clamps.
  const sample = (u: number, v: number): number => {
    if (!hasGrid) return 0;
    if (v <= 0) return topAvg;
    if (v >= 1) return botAvg;
    const fx = u * dCols - 0.5;
    const fy = v * dRows - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.max(0, Math.min(dRows - 1, Math.floor(fy)));
    const y1 = Math.max(0, Math.min(dRows - 1, y0 + 1));
    const tx = fx - x0;
    const ty = fy - y0;
    const xa = ((x0 % dCols) + dCols) % dCols;
    const xb = (xa + 1) % dCols;
    const d00 = grid![y0 * dCols + xa], d10 = grid![y0 * dCols + xb];
    const d01 = grid![y1 * dCols + xa], d11 = grid![y1 * dCols + xb];
    return (d00 * (1 - tx) + d10 * tx) * (1 - ty) + (d01 * (1 - tx) + d11 * tx) * ty;
  };

  // Displaced position at param (i ring, j segment). phi DECREASES with u so
  // the unwrap reads unmirrored to a viewer facing the front (-Z at u=0.5).
  // Profile shapes the base RADIAL silhouette only (length stays scaleY's);
  // displacement is world-units on top so sculpt strength doesn't shrink
  // where the part is thin.
  const pos = (i: number, j: number): Vec3 => {
    const v = i / rings;
    const u = j / segments;
    const theta = PI * v;
    const phi = PI / 2 - 2 * PI * u;
    const st = Math.sin(theta);
    const d = amount * sample(u, v);
    const rxz = radius * profileAt(v) + d;
    const ry = radius + d;
    return [st * Math.cos(phi) * rxz * scaleX, Math.cos(theta) * ry * scaleY, st * Math.sin(phi) * rxz * scaleZ];
  };

  // Finite-difference outward normal; pole rows fall back to the axis.
  const nrm = (i: number, j: number): Vec3 => {
    if (i <= 0) return [0, 1, 0];
    if (i >= rings) return [0, -1, 0];
    const pu0 = pos(i, j - 1), pu1 = pos(i, j + 1);
    const pv0 = pos(i - 1, j), pv1 = pos(i + 1, j);
    const tu: Vec3 = [pu1[0] - pu0[0], pu1[1] - pu0[1], pu1[2] - pu0[2]];
    const tv: Vec3 = [pv1[0] - pv0[0], pv1[1] - pv0[1], pv1[2] - pv0[2]];
    // cross(tv, tu) points outward with this phi orientation
    return normalize(
      tv[1] * tu[2] - tv[2] * tu[1],
      tv[2] * tu[0] - tv[0] * tu[2],
      tv[0] * tu[1] - tv[1] * tu[0],
    );
  };

  const g = mesh();
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = pos(i, j), na = nrm(i, j);
      const b = pos(i, j + 1), nb = nrm(i, j + 1);
      const c = pos(i + 1, j + 1), nc = nrm(i + 1, j + 1);
      const d = pos(i + 1, j), nd = nrm(i + 1, j);
      const ua: [number, number] = [j / segments, i / rings];
      const ub: [number, number] = [(j + 1) / segments, i / rings];
      const uc: [number, number] = [(j + 1) / segments, (i + 1) / rings];
      const ud: [number, number] = [j / segments, (i + 1) / rings];
      // phi runs opposite to Sphere.ts's loops (mirror), so the outward winding
      // is the reverse of the pattern documented there.
      g.tri(a, na, ua, d, nd, ud, c, nc, uc);
      g.tri(a, na, ua, c, nc, uc, b, nb, ub);
    }
  }
  return g.build();
}
