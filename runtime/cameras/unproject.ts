// @reactjit/cameras — the inverse path: screen pixel -> world ray -> ground.
//
// This is the camera analog of the geometry meshOf bridge — what makes rigs
// genuinely drop-in. Both functions depend ONLY on the resolved camera
// (Solved), never on which rig produced it, so picking keeps working when you
// swap <OrbitCamera> for <TopDownCamera> with zero per-rig code.
//
// screenRay is THE canonical pixel->ray (R7: three carts hand-rolled this
// exact math before it was exported — voxel face picking, assist3d AABB
// picking, ground unprojection). It reconstructs the view basis the
// framework's m4lookAt builds (f = normalize(eye - target), s = up × f,
// u = f × s, up = +Y), shoots the pixel's view ray, and returns it in world
// space. Anything intersectable (AABB slab, sphere, heightfield march) is a
// consumer — unprojectGround below is the in-house one.
//
// The crosshair law falls out: at the rect center, screenRay's dir IS
// normalize(target - pos) — what's under the crosshair is what gets hit.

import type { Rect, Solved, Vec3 } from './types';

export type ScreenRay = { origin: Vec3; dir: Vec3 };

export function screenRay(sx: number, sy: number, rect: Rect, cam: Solved): ScreenRay {
  const { pos, target, fov } = cam;

  // view basis (mirrors framework/math/mat4.zig m4lookAt exactly)
  let fx = pos[0] - target[0];
  let fy = pos[1] - target[1];
  let fz = pos[2] - target[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  // s = up × f, up = (0,1,0)
  let sxv = fz;
  let syv = 0;
  let szv = -fx;
  const sl = Math.hypot(sxv, syv, szv) || 1;
  sxv /= sl; syv /= sl; szv /= sl;
  // u = f × s
  const ux = fy * szv - fz * syv;
  const uy = fz * sxv - fx * szv;
  const uz = fx * syv - fy * sxv;

  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const aspect = w / h;
  const tanHalf = Math.tan((fov * Math.PI) / 180 / 2);
  const ndcX = (sx / w) * 2 - 1;
  const ndcY = 1 - (sy / h) * 2;
  const vx = ndcX * tanHalf * aspect;
  const vy = ndcY * tanHalf;
  const vz = -1;
  // world ray dir = vx*s + vy*u + vz*f
  let dx = vx * sxv + vy * ux + vz * fx;
  let dy = vx * syv + vy * uy + vz * fy;
  let dz = vx * szv + vy * uz + vz * fz;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;

  return { origin: [pos[0], pos[1], pos[2]], dir: [dx, dy, dz] };
}

// March the pixel's ray against the height field, then bisect for a clean
// landing. Returns scape world coords {x, y} where the 3D z axis maps back to
// y (1 tile = 1 unit). Picking is click-rate, so the step budget is irrelevant.
export function unprojectGround(
  sx: number,
  sy: number,
  rect: Rect,
  cam: Solved,
  heightAt: (x: number, z: number) => number = () => 0,
): { x: number; y: number } {
  const { origin, dir } = screenRay(sx, sy, rect, cam);
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = dir;

  const STEP = 0.2;
  const MAX_T = 400;
  let prevT = 0;
  for (let t = STEP; t < MAX_T; t += STEP) {
    const wx = ox + t * dx;
    const wz = oz + t * dz;
    const gap = oy + t * dy - heightAt(wx, wz);
    if (gap <= 0) {
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        const mx = ox + mid * dx;
        const mz = oz + mid * dz;
        if (oy + mid * dy - heightAt(mx, mz) <= 0) hi = mid;
        else lo = mid;
      }
      const ft = (lo + hi) / 2;
      return { x: ox + ft * dx, y: oz + ft * dz };
    }
    prevT = t;
  }
  return { x: cam.target[0], y: cam.target[2] }; // ray never met the ground
}
