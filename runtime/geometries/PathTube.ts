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

  // Taper runs by index along the path (t = i/(n-1)) so it works for a vertical
  // trunk, a diagonal branch, OR a horizontal stick alike — not just monotonic-y.
  // Local tangent from the neighbours; the ring is a circle in the plane PERPEN-
  // DICULAR to that tangent, spanned by the in-plane normal (-Ty,Tx,0) and Z —
  // a proper sweep frame, so the tube never pinches whatever angle the path runs.
  const tangent = (i: number): [number, number] => {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const tx = sp[b * 2]! - sp[a * 2]!;
    const ty = sp[b * 2 + 1]! - sp[a * 2 + 1]!;
    const L = Math.hypot(tx, ty) || 1;
    return [tx / L, ty / L];
  };

  const ring = (i: number): { pos: Vec3; nrm: Vec3; u: number }[] => {
    const cx = sp[i * 2]!;
    const cy = sp[i * 2 + 1]!;
    const t = i / (n - 1);
    const r = p.baseRadius + (p.tipRadius - p.baseRadius) * t;
    const [tx, ty] = tangent(i);
    const nx = -ty, ny = tx; // in-plane perpendicular to the tangent
    const out: { pos: Vec3; nrm: Vec3; u: number }[] = [];
    for (let s = 0; s <= sides; s += 1) {
      const ang = (s / sides) * TAU;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // ring point = center + r·(ca·N + sa·Z); N=(nx,ny,0), Z=(0,0,1)
      out.push({ pos: [cx + r * ca * nx, cy + r * ca * ny, r * sa], nrm: normalize(ca * nx, ca * ny, sa), u: s / sides });
    }
    return out;
  };

  let lower = ring(0);
  for (let i = 1; i < n; i += 1) {
    const upper = ring(i);
    const v0 = (i - 1) / (n - 1);
    const v1 = i / (n - 1);
    for (let s = 0; s < sides; s += 1) {
      const bl = lower[s]!, br = lower[s + 1]!, tr = upper[s + 1]!, tl = upper[s]!;
      g.tri(bl.pos, bl.nrm, [bl.u, v0], br.pos, br.nrm, [br.u, v0], tr.pos, tr.nrm, [tr.u, v1]);
      g.tri(bl.pos, bl.nrm, [bl.u, v0], tr.pos, tr.nrm, [tr.u, v1], tl.pos, tl.nrm, [tl.u, v1]);
    }
    lower = upper;
  }

  return g.build();
}
