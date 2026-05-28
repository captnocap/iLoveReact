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
      // a=top@p1, b=top@p2, c=bottom@p2, d=bottom@p1. The pipeline is
      // cull_mode=.back / front_face=.ccw, and `a` being the TOP corner (opposite
      // sign of `a` in Cylinder/Cone, where it's the BOTTOM) flips chirality —
      // so the outward winding is (a,c,d) + (a,b,c), NOT the (a,d,c)+(a,c,b) the
      // original Zig generateSphere used. That bug went unnoticed until a large
      // sphere had geometry behind it (camera_lab character head + neck) and the
      // far hemisphere bled through what should have been the occluding front.
      g.tri(a, na, uv(na), c, nc, uv(nc), d, nd, uv(nd));
      g.tri(a, na, uv(na), b, nb, uv(nb), c, nc, uv(nc));
    }
  }
  return g.build();
}
