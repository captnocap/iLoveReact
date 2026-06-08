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
  /**
   * Per-v ring-center Z offset (lerped top→bottom like `profile`), in units
   * of `radius` (scaled by scaleZ with the rest of the depth axis). Bends the
   * lathe's axis fore/aft without touching length or the radial silhouette —
   * boot toes, jaw chins, banana limbs. FOOTMESH-0606: the foot's toe-box
   * lean is the first consumer. Omit for a straight axis (today's parts).
   */
  shiftZ?: number[];
  /**
   * Flat-cut floor (FOOTMESH-0606): clamp the base skin's local Y to
   * ≥ -radius·scaleY·floorY (0..1; omit or 1 = full dome). Every vertex
   * below the plane lands ON it — a flat sole with no downward pole spike,
   * by construction. Normals finite-difference over the clamped skin, so the
   * sole shades flat and the cut edge stays crisp.
   */
  floorY?: number;
};

export const GLOBE_DEFAULTS: GlobeParams = { radius: 0.5, segments: 32, rings: 16, amount: 0, scaleY: 1 };

const PI = Math.PI;

/**
 * The analytic displaced surface: (u, v) -> local-space point. THE one source
 * of truth for where the globe's skin sits — generate() below builds every
 * vertex through it, and the character editor's 3D grab tool samples it to
 * place handles and ray-pick cells, so the pickable surface can never drift
 * from the rendered one.
 *
 * `extraDisplace` adds to the sampled grid value before scaling by `amount` —
 * the grab tool's "where would this point be at value g±δ" probe (and how it
 * derives the radial drag axis numerically).
 */
export function globeSurface(p: GlobeParams): (u: number, v: number, extraDisplace?: number) => Vec3 {
  const { radius } = p;
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

  // Per-v ring-center Z shift: lerped like the profile, units of radius
  // (scaled by scaleZ below so it tracks the depth axis). null = straight.
  const shz = p.shiftZ && p.shiftZ.length > 0 ? p.shiftZ : null;
  const shiftAt = (v: number): number => {
    if (!shz) return 0;
    if (shz.length === 1) return shz[0];
    const t = Math.max(0, Math.min(1, v)) * (shz.length - 1);
    const i = Math.min(shz.length - 2, Math.floor(t));
    return shz[i] + (shz[i + 1] - shz[i]) * (t - i);
  };

  // Flat-cut floor plane in local Y (FOOTMESH-0606); +Infinity disables.
  const floorCut = p.floorY != null && p.floorY < 1 ? -radius * scaleY * p.floorY : -Infinity;

  // The UNDISPLACED skin at (u, v) — profile + per-axis scale, no grid.
  // phi DECREASES with u so the unwrap reads unmirrored to a viewer facing
  // the front (-Z at u=0.5). Profile shapes the base RADIAL silhouette only
  // (length stays scaleY's). shiftZ bends the lathe axis fore/aft; floorY
  // clamps the bottom dome onto one flat plane (the sole).
  const base = (u: number, v: number): Vec3 => {
    const theta = PI * v;
    const phi = PI / 2 - 2 * PI * u;
    const st = Math.sin(theta);
    const rxz = radius * profileAt(v);
    const y = Math.max(floorCut, Math.cos(theta) * radius * scaleY);
    return [
      st * Math.cos(phi) * rxz * scaleX,
      y,
      (st * Math.sin(phi) * rxz + radius * shiftAt(v)) * scaleZ,
    ];
  };

  // The base skin's outward NORMAL at (u, v), finite-differenced. This is the
  // direction displacement GROWS along (see the return fn below); pole rows
  // collapse to the axis like the cap law.
  const NEPS = 1e-3;
  const baseNormal = (u: number, v: number): Vec3 => {
    if (v <= NEPS) return [0, 1, 0];
    if (v >= 1 - NEPS) return [0, -1, 0];
    const pu0 = base(u - NEPS, v), pu1 = base(u + NEPS, v);
    const pv0 = base(u, v - NEPS), pv1 = base(u, v + NEPS);
    const tu: Vec3 = [pu1[0] - pu0[0], pu1[1] - pu0[1], pu1[2] - pu0[2]];
    const tv: Vec3 = [pv1[0] - pv0[0], pv1[1] - pv0[1], pv1[2] - pv0[2]];
    // cross(tv, tu) points outward with this phi orientation
    return normalize(
      tv[1] * tu[2] - tv[2] * tu[1],
      tv[2] * tu[0] - tv[0] * tu[2],
      tv[0] * tu[1] - tv[1] * tu[0],
    );
  };

  // Displaced position at unwrap (u, v): the base skin plus `amount × sample`
  // world units along the base skin's NORMAL. On a sphere the normal IS the
  // radius, so heads sculpt exactly as before — but on a profiled/flattened
  // part (the torso's scaleZ squash) the old radial push made every
  // off-meridian bump veer SIDEWAYS toward the side it sits on (the user's
  // "directional split" report: a chest pull always came out at an angle).
  // Growing along the normal is what every sculpt tool does: a chest pull
  // comes out the chest. Displacement is world-units so sculpt strength
  // doesn't shrink where the part is thin. `extraDisplace` rides the grid
  // sample (0 for every rendered vertex — generate() never passes it); the
  // grab tool's ±probe through it makes the drag axis the normal too.
  return (u: number, v: number, extraDisplace = 0): Vec3 => {
    const b = base(u, v);
    const d = amount * (sample(u, v) + extraDisplace);
    if (d === 0) return b;
    const n = baseNormal(u, v);
    return [b[0] + n[0] * d, b[1] + n[1] * d, b[2] + n[2] * d];
  };
}

export function generate(p: GlobeParams): GeometryData {
  const { segments, rings } = p;
  const surf = globeSurface(p);
  const pos = (i: number, j: number): Vec3 => surf(j / segments, i / rings);

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
