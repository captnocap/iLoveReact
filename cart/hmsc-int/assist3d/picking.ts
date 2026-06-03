// assist3d/picking.ts — invert the active camera to pick a mesh under the cursor.
//
// screenRay reconstructs the exact view basis framework m4lookAt builds (the same
// math as @reactjit/cameras unprojectGround) and returns the world-space ray.
// pickMesh intersects that ray against each mesh's bounding sphere, nearest wins.
//
// Known limit: bounding-SPHERE picking favours the larger enclosing solid when
// meshes nest (a thin Torus inside a fat Sphere is occluded). The Objects tree is
// the deliberate escape hatch for that — select by id, geometry overlap be damned.

import type { Solved, Rect, Vec3 } from '@reactjit/cameras';
import { boundingRadius, type MeshSpec } from './scene';

export function screenRay(sx: number, sy: number, rect: Rect, cam: Solved): { o: Vec3; d: Vec3 } {
  const { pos, target, fov } = cam;
  let fx = pos[0] - target[0], fy = pos[1] - target[1], fz = pos[2] - target[2];
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  let sxv = fz, syv = 0, szv = -fx;            // s = up × f, up = (0,1,0)
  const sl = Math.hypot(sxv, syv, szv) || 1; sxv /= sl; syv /= sl; szv /= sl;
  const ux = fy * szv - fz * syv;              // u = f × s
  const uy = fz * sxv - fx * szv;
  const uz = fx * syv - fy * sxv;
  const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
  const tanHalf = Math.tan((fov * Math.PI) / 180 / 2);
  const ndcX = (sx / w) * 2 - 1, ndcY = 1 - (sy / h) * 2;
  const vx = ndcX * tanHalf * (w / h), vy = ndcY * tanHalf, vz = -1;
  let dx = vx * sxv + vy * ux + vz * fx;
  let dy = vx * syv + vy * uy + vz * fy;
  let dz = vx * szv + vy * uz + vz * fz;
  const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
  return { o: pos, d: [dx, dy, dz] };
}

export function pickMesh(sx: number, sy: number, rect: Rect, cam: Solved, meshes: MeshSpec[]): number {
  const { o, d } = screenRay(sx, sy, rect, cam);
  let best = -1, bestT = Infinity;
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    const sc = m.scale ?? 1;
    const R = boundingRadius(m.geometry, m.params) * sc;
    const ox = o[0] - m.position[0], oy = o[1] - m.position[1], oz = o[2] - m.position[2];
    const b = ox * d[0] + oy * d[1] + oz * d[2];
    const c = ox * ox + oy * oy + oz * oz - R * R;
    const disc = b * b - c;
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    const t0 = -b - root, t1 = -b + root;
    const t = t0 > 0 ? t0 : (t1 > 0 ? t1 : -1);
    if (t > 0 && t < bestT) { bestT = t; best = i; }
  }
  return best;
}
