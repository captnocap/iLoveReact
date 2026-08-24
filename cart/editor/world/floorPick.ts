// world/floorPick.ts — ray → derived floor plate (req_4739). Exact
// Möller–Trumbore over the engine-emitted top triangles, so the right-click
// floor pick hits precisely what the world renders. A leaf module: the law is
// pure geometry, tested without the live-bake's asset-catalog import chain.

export type FloorPickTriangle = {
  faceSignature: string;
  role: 'top' | 'bottom' | 'rim';
  /** World-space meters, engine-emitted. */
  corners: readonly (readonly [number, number, number])[];
};

/** Nearest walkable (top) plate under the ray, or null. `t` is in units of the
 * ray direction's length — multiply by |dir| for meters. */
export function pickFloorTriangleHit(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  triangles: readonly FloorPickTriangle[],
): { faceSignature: string; t: number } | null {
  let best: { faceSignature: string; t: number } | null = null;
  const EPS = 1e-9;
  for (const triangle of triangles) {
    if (triangle.role !== 'top') continue;
    const [a, b, c] = [triangle.corners[0]!, triangle.corners[1]!, triangle.corners[2]!];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const px = dir.y * e2z - dir.z * e2y;
    const py = dir.z * e2x - dir.x * e2z;
    const pz = dir.x * e2y - dir.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < EPS) continue;
    const inv = 1 / det;
    const tx = origin.x - a[0], ty = origin.y - a[1], tz = origin.z - a[2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -EPS || u > 1 + EPS) continue;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dir.x * qx + dir.y * qy + dir.z * qz) * inv;
    if (v < -EPS || u + v > 1 + EPS) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t <= EPS) continue;
    if (!best || t < best.t) best = { faceSignature: triangle.faceSignature, t };
  }
  return best;
}
