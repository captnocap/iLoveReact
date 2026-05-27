// Torus — ring of radius `radius` swept by a tube of `tube`. (A twisted or
// square-section torus is a sibling file, not a flag.) Byte-equivalent port of
// the old native generateTorus (default 24 segments × 16 sides).
import { mesh, type GeometryData, type Vec3 } from './_util';

export type TorusParams = { radius: number; tube: number; segments: number; sides: number };
export const TORUS_DEFAULTS: TorusParams = { radius: 0.5, tube: 0.25, segments: 24, sides: 16 };

const PI = Math.PI;

function pos(r: number, tr: number, u: number, v: number): Vec3 {
  const ring = r + tr * Math.cos(v);
  return [ring * Math.cos(u), tr * Math.sin(v), ring * Math.sin(u)];
}
function nrm(u: number, v: number): Vec3 {
  return [Math.cos(u) * Math.cos(v), Math.sin(v), Math.sin(u) * Math.cos(v)];
}

export function generate(p: TorusParams): GeometryData {
  const { radius: r, tube: tr, segments, sides } = p;
  const g = mesh();
  for (let i = 0; i < segments; i++) {
    const u1 = (2 * PI * i) / segments;
    const u2 = (2 * PI * (i + 1)) / segments;
    for (let j = 0; j < sides; j++) {
      const v1 = (2 * PI * j) / sides;
      const v2 = (2 * PI * (j + 1)) / sides;
      const a = pos(r, tr, u1, v1), b = pos(r, tr, u2, v1), c = pos(r, tr, u2, v2), d = pos(r, tr, u1, v2);
      const na = nrm(u1, v1), nb = nrm(u2, v1), nc = nrm(u2, v2), nd = nrm(u1, v2);
      g.tri(a, na, [0, 0], d, nd, [0, 1], c, nc, [1, 1]);
      g.tri(a, na, [0, 0], c, nc, [1, 1], b, nb, [1, 0]);
    }
  }
  return g.build();
}
