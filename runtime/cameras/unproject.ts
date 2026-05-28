// @reactjit/cameras — generic screen -> ground pick.
//
// This is the camera analog of the geometry meshOf bridge: the inverse path that
// makes rigs genuinely drop-in. It depends ONLY on the resolved camera (Solved),
// never on which rig produced it — so click-picking keeps working when you swap
// <OrbitCamera> for <TopDownCamera> with zero per-rig code.
//
// Lifted from cart/scape3d/world/projection.ts:unproject and parameterized on
// Solved + Rect. It reconstructs the exact view basis the framework's m4lookAt
// builds (f = normalize(eye - target), s = up × f, u = f × s, up = +Y), shoots
// the pixel's view ray, and marches it against the height field. Returns scape
// world coords {x, y} where the 3D z axis maps back to y (1 tile = 1 unit).

import type { Rect, Solved } from './types';

export function unprojectGround(
  sx: number,
  sy: number,
  rect: Rect,
  cam: Solved,
  heightAt: (x: number, z: number) => number = () => 0,
): { x: number; y: number } {
  const { pos, target, fov } = cam;

  // view basis (mirrors framework/math/mat4.zig m4lookAt exactly)
  let fx = pos[0] - target[0];
  let fy = pos[1] - target[1];
  let fz = pos[2] - target[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  // s = up × f, up = (0,1,0)
  let sxv = 1 * fz - 0 * fy;
  let syv = 0 * fx - 0 * fz;
  let szv = 0 * fy - 1 * fx;
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

  // March the ray against the surface, then bisect for a clean landing. Picking
  // is click-rate, so the step budget is irrelevant.
  const STEP = 0.2;
  const MAX_T = 400;
  let prevT = 0;
  for (let t = STEP; t < MAX_T; t += STEP) {
    const wx = pos[0] + t * dx;
    const wz = pos[2] + t * dz;
    const gap = pos[1] + t * dy - heightAt(wx, wz);
    if (gap <= 0) {
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        const mx = pos[0] + mid * dx;
        const mz = pos[2] + mid * dz;
        if (pos[1] + mid * dy - heightAt(mx, mz) <= 0) hi = mid;
        else lo = mid;
      }
      const ft = (lo + hi) / 2;
      return { x: pos[0] + ft * dx, y: pos[2] + ft * dz };
    }
    prevT = t;
  }
  return { x: target[0], y: target[2] }; // ray never met the ground
}
