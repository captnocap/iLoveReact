// Head — a sphere whose UVs put a flat FACE DECAL on the front (-Z) hemisphere.
//
// The Animal Crossing / Mii technique: a 2D face image planar-projected onto the
// front of a ball reads as a face at any game distance, with zero unwrapping. The
// plain Sphere's projection ignores depth, so a decal on it mirrors onto the BACK
// of the head; this sibling fixes that by clamping back-hemisphere UVs outward to
// the decal's border circle (continuous at the silhouette — no seam smear), so the
// back of the head samples the texture's edge pixels. Author face textures with the
// border region as plain skin/hair color and the features inside the inscribed
// circle; the corners are never sampled.
//
// Front is -Z to match the parts-based humanoid (its eyes/nose sit at -Z when
// yaw=0), and `u` runs so the authored image reads UNMIRRORED to a viewer facing
// the figure (image-left = viewer-left). Same params/tessellation as Sphere.
import { mesh, type GeometryData, type Vec3 } from './_util';

export type HeadParams = { radius: number; segments: number; rings: number };
export const HEAD_DEFAULTS: HeadParams = { radius: 0.5, segments: 24, rings: 16 };

const PI = Math.PI;

function pos(r: number, theta: number, phi: number): Vec3 {
  const st = Math.sin(theta);
  return [r * st * Math.cos(phi), r * Math.cos(theta), r * st * Math.sin(phi)];
}
function nrm(theta: number, phi: number): Vec3 {
  const st = Math.sin(theta);
  return [st * Math.cos(phi), Math.cos(theta), st * Math.sin(phi)];
}
// Front (-Z) hemisphere: planar decal, x negated so the image is unmirrored when
// viewed head-on. Back (+Z) hemisphere: push (x,y) to unit length — UVs land on
// the decal's border circle, matching the nz=0 silhouette ring exactly.
function uvDecal(n: Vec3): [number, number] {
  let x = -n[0];
  let y = n[1];
  if (n[2] > 0) {
    const len = Math.hypot(x, y);
    if (len < 1e-6) {
      // exact back pole: sample the top border (hair/shadow region)
      x = 0;
      y = 1;
    } else {
      x /= len;
      y /= len;
    }
  }
  return [(x + 1) * 0.5, (1 - y) * 0.5];
}

export function generate(p: HeadParams): GeometryData {
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
      // Same outward winding as Sphere.ts (see the chirality note there).
      g.tri(a, na, uvDecal(na), c, nc, uvDecal(nc), d, nd, uvDecal(nd));
      g.tri(a, na, uvDecal(na), b, nb, uvDecal(nb), c, nc, uvDecal(nc));
    }
  }
  return g.build();
}
