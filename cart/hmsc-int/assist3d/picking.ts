// assist3d/picking.ts — invert the active camera to pick a mesh under the cursor.
//
// screenRay reconstructs the exact view basis framework m4lookAt builds (the same
// math as @reactjit/cameras unprojectGround) and returns the world-space ray.
// pickMesh intersects that ray against each mesh's axis-aligned bounding box
// (NOT a sphere): a sphere test fails for the flat ground slab — its bounding
// sphere is ~14 units while the camera orbits at ~12, so the camera sits INSIDE
// it and the near hit lands behind the eye, making the ground unclickable. An AABB
// slab test hits the slab's top face at a proper near t, so the ground (and every
// wide/thin box) is selectable, and small objects resting on it still win on a
// direct click because their entry t is nearer.
//
// Rotation is ignored (the AABB is axis-aligned in world space) — an approximation
// that's plenty for click-rate selection; the Objects tree remains the exact
// escape hatch for anything geometry overlap makes ambiguous.

import type { Solved, Rect, Vec3 } from '@reactjit/cameras';
import { type MeshSpec } from './scene';

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

// World-space axis-aligned half-extents per geometry (before scale). The ground
// (a wide thin Box) and a Plane both collapse to a flat slab in Y — exactly what
// makes them selectable from above.
export function halfExtents(geometry: string, p: Record<string, number>): Vec3 {
  switch (geometry) {
    case 'Box': return [(p.width ?? 1) / 2, (p.height ?? 1) / 2, (p.depth ?? 1) / 2];
    case 'Sphere': { const r = p.radius ?? 0.5; return [r, r, r]; }
    case 'Cylinder':
    case 'Cone': { const r = p.radius ?? 0.5; return [r, (p.height ?? 1) / 2, r]; }
    case 'Torus': { const R = (p.radius ?? 0.5) + (p.tube ?? 0.2); return [R, (p.tube ?? 0.2), R]; }
    case 'Plane': return [(p.width ?? 1) / 2, 0.02, (p.height ?? 1) / 2];
    default: return [0.6, 0.6, 0.6];
  }
}

// Slab method. Returns the nearest positive hit distance, or -1 for a miss.
function rayAabb(o: Vec3, d: Vec3, c: Vec3, half: Vec3): number {
  let tmin = -Infinity, tmax = Infinity;
  for (let a = 0; a < 3; a++) {
    const lo = c[a] - half[a], hi = c[a] + half[a];
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo || o[a] > hi) return -1;     // parallel & outside the slab
    } else {
      let t1 = (lo - o[a]) / d[a], t2 = (hi - o[a]) / d[a];
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  if (tmax < 0) return -1;                        // box entirely behind the eye
  return tmin > 0 ? tmin : tmax;                  // inside the box → use the exit
}

export function pickMesh(sx: number, sy: number, rect: Rect, cam: Solved, meshes: MeshSpec[]): number {
  const { o, d } = screenRay(sx, sy, rect, cam);
  let best = -1, bestT = Infinity;
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    const sc = m.scale ?? 1;
    const he = halfExtents(m.geometry, m.params);
    const half: Vec3 = [he[0] * sc, he[1] * sc, he[2] * sc];
    const t = rayAabb(o, d, m.position, half);
    if (t > 0 && t < bestT) { bestT = t; best = i; }
  }
  return best;
}
