// Sphere — UV sphere with planar UV projection onto the +Z hemisphere (a texture
// behaves like a flat decal stuck to the front; good for a face-on-head). This is
// ONE specific sphere, not THE sphere — an icosphere or cube-sphere is a sibling
// file, not a flag here. Byte-equivalent port of the old native generateSphere
// (default 24 segments × 16 rings, matching framework/gpu/3d.zig:1127).
import { mesh, type GeometryData, type Vec3 } from './_util';

export type SphereParams = { radius: number; segments: number; rings: number };
export const SPHERE_DEFAULTS: SphereParams = { radius: 0.5, segments: 24, rings: 16 };

const PI = Math.PI;

function pos(r: number, theta: number, phi: number): Vec3 {
  const st = Math.sin(theta);
  return [r * st * Math.cos(phi), r * Math.cos(theta), r * st * Math.sin(phi)];
}
function nrm(theta: number, phi: number): Vec3 {
  const st = Math.sin(theta);
  return [st * Math.cos(phi), Math.cos(theta), st * Math.sin(phi)];
}
// Planar UV: u = (nx+1)/2, v = (1-ny)/2 — front-hemisphere decal.
function uv(n: Vec3): [number, number] {
  return [(n[0] + 1) * 0.5, (1 - n[1]) * 0.5];
}

export function generate(p: SphereParams): GeometryData {
  const g = mesh();
  const { radius: r, segments, rings } = p;
  for (let i = 0; i < rings; i++) {
    const t1 = (PI * i) / rings;
    const t2 = (PI * (i + 1)) / rings;
    for (let j = 0; j < segments; j++) {
      const p1 = (2 * PI * j) / segments;
      const p2 = (2 * PI * (j + 1)) / segments;
      const a = pos(r, t1, p1), b = pos(r, t1, p2), c = pos(r, t2, p2), d = pos(r, t2, p1);
      const na = nrm(t1, p1), nb = nrm(t1, p2), nc = nrm(t2, p2), nd = nrm(t2, p1);
      // Tri 1: a, d, c   Tri 2: a, c, b  (matches Zig winding)
      g.tri(a, na, uv(na), d, nd, uv(nd), c, nc, uv(nc));
      g.tri(a, na, uv(na), c, nc, uv(nc), b, nb, uv(nb));
    }
  }
  return g.build();
}
