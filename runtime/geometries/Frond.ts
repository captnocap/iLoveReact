// Frond — one arched palm/leaf card the ~frond~ shader paints, the same FluffyGrass
// move GrassBlade uses (a dumb card, not sculpted leaflets): the fragment alpha-cuts
// the leaf shape, gradients root→tip, and the pipeline bends it by wind. The card
// runs base (y=0) → tip (y=1) and ARCHES forward in +z as it rises (palm droop baked
// in; wind sway adds to it). 1 unit long — the per-instance scale sets the real
// length, so ONE interned frond serves every tree (geometry_intern rule: unit params
// + scale transform).
//
// uv.v = 0 at the base → 1 at the tip (drives the gradient + tip-weighted wind).
// uv.u carries the LEAF STYLE in its integer part and the across-width position in
// its fraction: u ∈ [style, style+1]. The shader reads `floor(u)` to pick the cutout
// (0 = feathered coconut frond — a rachis with many leaflets; 1 = broad split leaf)
// and `fract(u)` as the 0..1 width coordinate. Encoding style in the geometry's UV
// keeps it to ONE pipeline with no per-instance style channel (the 12-stride has none).
//
// Emitted double-sided (both windings, flipped normals) because the scene3d pipeline
// back-face culls and a frond must read from every direction.
import { mesh, normalize, type GeometryData, type Vec3 } from './_util';

export type FrondStyle = 'feathered' | 'broad';

export type FrondParams = {
  /** which leaf cutout the shader paints (baked into uv.u's integer part). */
  style: FrondStyle;
  /** root half-width in unit space (length is 1). */
  width: number;
  /** tip width as a fraction of root width — the taper toward the point. */
  tipTaper: number;
  /** how far the tip arches forward in +z (unit space) — the palm droop. */
  arc: number;
  /** how far the tip sags DOWN in -y by the tip (unit space). Low = stiff palm
   *  that arcs out; high = long flowing/weeping frond that hangs toward the
   *  ground. This is the knob that separates a coconut palm from a weeping palm. */
  sag: number;
  /** lengthwise segments the arch is built from (more = smoother curve). */
  segments: number;
};

// Classic coconut palm — arcs out and gently down.
export const FROND_DEFAULTS: FrondParams = { style: 'feathered', width: 0.5, tipTaper: 0.1, arc: 0.8, sag: 0.18, segments: 12 };
// Weeping/flowing palm — long tips that curl down and flow toward the ground.
export const FLOWING_FROND_DEFAULTS: FrondParams = { style: 'feathered', width: 0.46, tipTaper: 0.08, arc: 1.05, sag: 0.95, segments: 14 };
// Broad split leaf (banana/fan).
export const BROAD_FROND_DEFAULTS: FrondParams = { style: 'broad', width: 0.66, tipTaper: 0.16, arc: 0.6, sag: 0.22, segments: 12 };

// Style lives in uv.u's offset, decoded shader-side as `style = step(5, u)` and
// `width-u = u - style*10`. Far-apart bands (0 vs 10) so neither the right edge
// (u=1) nor interpolation ever crosses the threshold or wraps a fract().
const STYLE_OFFSET: Record<FrondStyle, number> = { feathered: 0, broad: 10 };

export function generate(p: FrondParams): GeometryData {
  const g = mesh();
  const segs = Math.max(2, Math.floor(p.segments));
  const uOff = STYLE_OFFSET[p.style] ?? 0;

  // Sample the arch spine at each segment: y rises 0→1, z arches forward by arc·v².
  // (v² front-loads the curve toward the tip so the base leaves the trunk straight.)
  const spine = (t: number): { y: number; z: number; halfW: number } => ({
    y: t - p.sag * t * t,
    z: p.arc * t * t,
    halfW: p.width * 0.5 * (1 - (1 - p.tipTaper) * t),
  });

  for (let s = 0; s < segs; s += 1) {
    const t0 = s / segs;
    const t1 = (s + 1) / segs;
    const a = spine(t0);
    const b = spine(t1);
    // Face normal ≈ the card's local up (roughly +z front as it arches, blended
    // with the segment slope) so lighting reads; the shader's half-lambert keeps
    // the back lit too.
    const slope = normalize(0, b.y - a.y, b.z - a.z); // tangent along the spine
    const nf: Vec3 = normalize(0, -slope[2], slope[1]); // perpendicular, faces forward/up
    const nb: Vec3 = [-nf[0], -nf[1], -nf[2]];

    const bl: Vec3 = [-a.halfW, a.y, a.z];
    const br: Vec3 = [a.halfW, a.y, a.z];
    const tr: Vec3 = [b.halfW, b.y, b.z];
    const tl: Vec3 = [-b.halfW, b.y, b.z];

    const uL = uOff + 0;
    const uR = uOff + 1;
    // Front face: v runs base→tip, u spans the leaf width (with the style offset).
    g.tri(bl, nf, [uL, t0], br, nf, [uR, t0], tr, nf, [uR, t1]);
    g.tri(bl, nf, [uL, t0], tr, nf, [uR, t1], tl, nf, [uL, t1]);
    // Back face: reversed winding + flipped normal — two-sided.
    g.tri(bl, nb, [uL, t0], tr, nb, [uR, t1], br, nb, [uR, t0]);
    g.tri(bl, nb, [uL, t0], tl, nb, [uL, t1], tr, nb, [uR, t1]);
  }

  return g.build();
}
