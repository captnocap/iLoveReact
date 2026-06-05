// assist3d/picking.ts — invert the active camera to pick a mesh under the cursor.
//
// The pixel->ray inverse is the registry's screenRay (R7 graduation: this file
// used to carry its own copy of the view-basis math). pickMesh intersects that
// ray against each mesh's axis-aligned bounding box
// (NOT a sphere): a sphere test fails for wide/thin geometry — a flat slab's
// bounding sphere can be many units across while the camera orbits closer, so the
// camera sits INSIDE the sphere and the near hit lands behind the eye, making the
// piece unclickable. An AABB slab test hits the actual face at a proper near t, so
// flat pieces are selectable and small objects in front still win on a direct
// click because their entry t is nearer.
//
// Rotation is ignored (the AABB is axis-aligned in world space) — an approximation
// that's plenty for click-rate selection; the Objects tree remains the exact
// escape hatch for anything geometry overlap makes ambiguous.

import { screenRay, type Solved, type Rect, type Vec3 } from '@reactjit/cameras';

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

// The minimal mesh shape pick needs: geometry + params (for half-extents),
// a world position, and a uniform OR per-axis scale. A MeshSpec satisfies it, and
// so does a render3d/parts.tsx Part (whose scale is often a [x,y,z] array — a wall
// panel or a garage deck is a flat slab, non-uniform on purpose).
export type Pickable = {
  geometry: string;
  params: Record<string, number>;
  position: Vec3;
  scale?: number | [number, number, number];
};

export function pickMesh(sx: number, sy: number, rect: Rect, cam: Solved, meshes: Pickable[]): number {
  const { origin: o, dir: d } = screenRay(sx, sy, rect, cam);
  let best = -1, bestT = Infinity;
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    const s = m.scale ?? 1;
    const sx3 = Array.isArray(s) ? s[0] : s;
    const sy3 = Array.isArray(s) ? s[1] : s;
    const sz3 = Array.isArray(s) ? s[2] : s;
    const he = halfExtents(m.geometry, m.params);
    const half: Vec3 = [he[0] * sx3, he[1] * sy3, he[2] * sz3];
    const t = rayAabb(o, d, m.position, half);
    if (t > 0 && t < bestT) { bestT = t; best = i; }
  }
  return best;
}
