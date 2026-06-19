// PalmTrunk — a real palm log, not a Black & Mild: a tapered tube that gently
// curves (palms lean), fattens low, and wears the horizontal SCAR RINGS a palm
// trunk has (a small radius ripple up its length that catches light as banding).
// Built 1 unit tall (base y=0 → top y=1); the per-instance scale sets the real
// height, so one interned trunk serves every tree (geometry_intern rule).
//
// uv.v = 0 at the base → 1 at the top (for an optional root→crown gradient);
// uv.u wraps around. Outward radial normals so it lights like a cylinder.
import { mesh, normalize, type GeometryData, type Vec3 } from './_util';

export type PalmTrunkParams = {
  /** radius at the base, unit space (the bulge sits just above this). */
  baseRadius: number;
  /** radius just under the crown — palms narrow upward. */
  topRadius: number;
  /** sideways lean of the top, unit space (palms rarely stand straight). */
  curve: number;
  /** number of scar rings up the trunk. */
  rings: number;
  /** how pronounced the scar-ring ripple is, as a fraction of radius. */
  ringDepth: number;
  /** radial sides (cross-section resolution). */
  sides: number;
  /** vertical segments (more = smoother curve + rings). */
  segments: number;
};

export const PALM_TRUNK_DEFAULTS: PalmTrunkParams = {
  baseRadius: 0.13, topRadius: 0.08, curve: 0.16, rings: 11, ringDepth: 0.12, sides: 10, segments: 28,
};

const TAU = Math.PI * 2;

export function generate(p: PalmTrunkParams): GeometryData {
  const g = mesh();
  const segs = Math.max(2, Math.floor(p.segments));
  const sides = Math.max(3, Math.floor(p.sides));

  // Spine + radius at height t∈[0,1]: taper base→top, a low bulge, the scar-ring
  // ripple, and a gentle forward lean that grows toward the top.
  const at = (t: number) => {
    const taper = p.baseRadius + (p.topRadius - p.baseRadius) * t;
    const bulge = 1 + 0.18 * Math.exp(-((t - 0.12) * (t - 0.12)) / 0.01); // fatten just above the base
    const ring = 1 + p.ringDepth * Math.cos(t * p.rings * TAU);
    const r = taper * bulge * ring;
    const cx = p.curve * (t * t * 0.7 + Math.sin(t * 2.8) * 0.05); // lean, slight S
    return { r, cx };
  };

  const ringVerts = (t: number): { pos: Vec3; nrm: Vec3; u: number }[] => {
    const { r, cx } = at(t);
    const out: { pos: Vec3; nrm: Vec3; u: number }[] = [];
    for (let s = 0; s <= sides; s += 1) {
      const a = (s / sides) * TAU;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      out.push({ pos: [cx + dx * r, t, dz * r], nrm: normalize(dx, 0.15, dz), u: s / sides });
    }
    return out;
  };

  let lower = ringVerts(0);
  for (let i = 1; i <= segs; i += 1) {
    const t = i / segs;
    const upper = ringVerts(t);
    const v0 = (i - 1) / segs;
    const v1 = t;
    for (let s = 0; s < sides; s += 1) {
      const bl = lower[s]!, br = lower[s + 1]!, tr = upper[s + 1]!, tl = upper[s]!;
      // CCW outward winding so the OUTER wall is front-facing (cull_mode .back) and
      // the trunk reads solid, not a hollow shell you see the back wall through.
      g.tri(bl.pos, bl.nrm, [bl.u, v0], tl.pos, tl.nrm, [tl.u, v1], tr.pos, tr.nrm, [tr.u, v1]);
      g.tri(bl.pos, bl.nrm, [bl.u, v0], tr.pos, tr.nrm, [tr.u, v1], br.pos, br.nrm, [br.u, v0]);
    }
    lower = upper;
  }

  return g.build();
}
