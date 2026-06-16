// PathTube — sweep a tapered round tube along a DRAWN spine curve. This is the
// "SVG path → tree trunk" idea: author a trunk (or a branch, a vine, a root) as a
// path the same way the neon prop authors tubes, sample it to a spine polyline,
// and this geometry sweeps a circular cross-section up it, tapering base→tip. A
// branching tree is just several PathTube subpaths.
//
// The spine is a flat [x0,y0, x1,y1, …] polyline in unit space: x is the sideways
// offset, y runs base(0)→tip(1) up the trunk (normalize your path into this box;
// cart/tree_probe shows it from an SVG `d` via neon.ts flattenPathD). Rings stay
// horizontal (x–z plane) at each spine point — right for the mostly-vertical
// trunks/branches this is for; a near-horizontal run would pinch. uv.v = base→tip.
import { mesh, normalize, type GeometryData, type Vec3 } from './_util';

export type PathTubeParams = {
  /** flat [x,y] pairs, unit space, ordered base→tip (y≈0 → y≈1). */
  spine: number[];
  /** radius at the base of the path. */
  baseRadius: number;
  /** radius at the tip — taper. */
  tipRadius: number;
  /** radial sides of the tube cross-section. */
  sides: number;
};

export const PATH_TUBE_DEFAULTS: PathTubeParams = {
  // a gently S-curved default trunk spine, base→tip
  spine: [0, 0, 0.02, 0.25, 0.08, 0.5, 0.06, 0.75, 0.12, 1],
  baseRadius: 0.12, tipRadius: 0.07, sides: 10,
};

const TAU = Math.PI * 2;

export function generate(p: PathTubeParams): GeometryData {
  const g = mesh();
  const sp = p.spine;
  const n = Math.floor(sp.length / 2);
  if (n < 2) return g.build();
  const sides = Math.max(3, Math.floor(p.sides));

  // Tip param per spine point = its y normalized over the spine's y-span, so the
  // taper tracks height however the path was drawn.
  let y0 = sp[1]!, y1 = sp[1]!;
  for (let i = 0; i < n; i += 1) { const y = sp[i * 2 + 1]!; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const yspan = Math.max(1e-4, y1 - y0);

  const ring = (i: number): { pos: Vec3; nrm: Vec3; u: number }[] => {
    const cx = sp[i * 2]!;
    const cy = sp[i * 2 + 1]!;
    const t = (cy - y0) / yspan;
    const r = p.baseRadius + (p.tipRadius - p.baseRadius) * t;
    const out: { pos: Vec3; nrm: Vec3; u: number }[] = [];
    for (let s = 0; s <= sides; s += 1) {
      const a = (s / sides) * TAU;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      out.push({ pos: [cx + dx * r, cy, dz * r], nrm: normalize(dx, 0.12, dz), u: s / sides });
    }
    return out;
  };

  let lower = ring(0);
  for (let i = 1; i < n; i += 1) {
    const upper = ring(i);
    const v0 = (sp[(i - 1) * 2 + 1]! - y0) / yspan;
    const v1 = (sp[i * 2 + 1]! - y0) / yspan;
    for (let s = 0; s < sides; s += 1) {
      const bl = lower[s]!, br = lower[s + 1]!, tr = upper[s + 1]!, tl = upper[s]!;
      g.tri(bl.pos, bl.nrm, [bl.u, v0], br.pos, br.nrm, [br.u, v0], tr.pos, tr.nrm, [tr.u, v1]);
      g.tri(bl.pos, bl.nrm, [bl.u, v0], tr.pos, tr.nrm, [tr.u, v1], tl.pos, tl.nrm, [tl.u, v1]);
    }
    lower = upper;
  }

  return g.build();
}
