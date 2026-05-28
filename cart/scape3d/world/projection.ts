// scape3d projection. The 2D oblique projection (`project`) is retained ONLY for
// the minimap shader's sprite blips. The world is now rendered by a real
// perspective camera (Scene3D → framework/gpu/3d.zig), so screen→world picking
// is a ray/ground-plane intersection that EXACTLY inverts the framework's
// `m4lookAt` + `m4perspective`. cameraFor() is the single source of truth: the
// Scene component and unproject() both derive the eye/target/fov from it, so a
// click always lands on the tile the cursor is over.

import { heightAt } from './terrain';

export const TILE_PX = 30;

// Two camera modes share the same Cam record so unproject() / cameraFor() / the
// renderer all stay one code path. `tp` is the orbit that scape3d shipped with;
// `fp` puts the eye at the player's head and uses `lookPitch` for free up/down
// look (TP's `pitch` is camera elevation, [0.40,0.86], so we keep them separate
// — toggling back to TP preserves the framing you had).
export type CamMode = 'tp' | 'fp';

export interface Cam {
  px: number;
  py: number;
  yaw: number;
  pitch: number;
  zoom: number;
  mode: CamMode;
  lookPitch: number; // FP only: radians; >0 = look up, <0 = look down
}

// Eye height in metres above the foot point — matches the humanoid head box centre
// in Characters3D (head pos y = 1.78). Sitting AT 1.78 means the FP eye is exactly
// where the (now-hidden) head model used to be, so other players see no offset.
export const FP_EYE_HEIGHT = 1.78;
export const FP_LOOK_PITCH_LIMIT = 1.2; // ~69° up/down — enough to see your own feet

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type V3 = [number, number, number];

// World mapping: scape ground coords (wx, wy) → 3D (x = wx, z = wy), up = +Y.
// The camera orbits the player by `yaw`; `pitch` (0.40 shallow .. 0.86 steep)
// becomes the elevation angle; `zoom` pulls the eye in.
export const CAM_FOV = 55;
const TARGET_Y = 0.95; // look at the player's chest, not their feet
const BASE_DIST = 15.0; // eye distance at zoom 1.0
const ELEV_LO = 0.40; // radians at pitch 0.40 (near horizon — long Miami shadows)
const ELEV_HI = 1.18; // radians at pitch 0.86 (steep, near top-down)
const PITCH_LO = 0.40;
const PITCH_HI = 0.86;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function elevationFor(pitch: number): number {
  const frac = clamp((pitch - PITCH_LO) / (PITCH_HI - PITCH_LO), 0, 1);
  return ELEV_LO + (ELEV_HI - ELEV_LO) * frac;
}

// FP forward direction in world space — same yaw convention the TP eye uses so
// that toggling modes doesn't spin you: TP eye is `c.px - sin(yaw)*horiz`, so the
// camera looks down `(+sin(yaw), 0, +cos(yaw))` horizontally. `lookPitch` adds the
// vertical component.
export function fpForward(yaw: number, lookPitch: number): V3 {
  const cp = Math.cos(lookPitch);
  return [Math.sin(yaw) * cp, Math.sin(lookPitch), Math.cos(yaw) * cp];
}

const FP_FOV = 75; // wider than TP — typical FP feel, also stops fisheye/zoom mismatch

// Eye, look-target, and fov for the current camera state. The renderer feeds this
// straight into <Scene3D.Camera>; unproject() inverts it. Both eye and target
// ride the player's ground elevation so the framing holds as you climb the hill.
export function cameraFor(c: Cam): { pos: V3; target: V3; fov: number } {
  const ground = heightAt(c.px, c.py);
  if (c.mode === 'fp') {
    const eye: V3 = [c.px, ground + FP_EYE_HEIGHT, c.py];
    const f = fpForward(c.yaw, c.lookPitch);
    return { pos: eye, target: [eye[0] + f[0], eye[1] + f[1], eye[2] + f[2]], fov: FP_FOV };
  }
  const target: V3 = [c.px, ground + TARGET_Y, c.py];
  const dist = BASE_DIST / Math.max(0.35, c.zoom);
  const elev = elevationFor(c.pitch);
  const horiz = dist * Math.cos(elev);
  const height = ground + dist * Math.sin(elev) + TARGET_Y;
  const pos: V3 = [
    c.px - Math.sin(c.yaw) * horiz,
    height,
    c.py - Math.cos(c.yaw) * horiz,
  ];
  return { pos, target, fov: CAM_FOV };
}

// ── 2D oblique (minimap only) ────────────────────────────────────────────
export const centerX = (r: Rect) => r.width * 0.5;
export const centerY = (r: Rect) => r.height * 0.56;

export function project(wx: number, wy: number, c: Cam, r: Rect) {
  const cs = Math.cos(c.yaw);
  const sn = Math.sin(c.yaw);
  const dx = wx - c.px;
  const dy = wy - c.py;
  const rx = dx * cs - dy * sn;
  const ry = dx * sn + dy * cs;
  return {
    x: centerX(r) + rx * TILE_PX * c.zoom,
    y: centerY(r) + ry * TILE_PX * c.zoom * c.pitch,
    depth: ry,
  };
}

export function hazeOpacity(depth: number): number {
  return Math.max(0, Math.min(1, (Math.abs(depth) - 15) / 9));
}

// ── screen → ground ray pick (the real one) ───────────────────────────────
//
// Reconstructs the same view basis m4lookAt builds (f = normalize(eye−target),
// s = up × f, u = f × s), shoots the pixel's view ray, and intersects the y=0
// ground plane. Returns scape world coords (x, y) where 3D z maps back to y.
export function unproject(sx: number, sy: number, c: Cam, r: Rect) {
  const { pos, target, fov } = cameraFor(c);
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

  const w = Math.max(1, r.width);
  const h = Math.max(1, r.height);
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

  // March the ray against the height field (terrain.heightAt). Flat ground is
  // height 0, so over most of the map this resolves on the first crossing; the
  // hill bump is caught by stepping until the ray dips below the surface, then
  // bisecting. Picking is click-rate, so the step budget is irrelevant.
  const STEP = 0.2;
  const MAX_T = 200;
  let prevT = 0;
  let prevGap = pos[1] - heightAt(pos[0], pos[2]); // >0 = above ground
  for (let t = STEP; t < MAX_T; t += STEP) {
    const wx = pos[0] + t * dx;
    const wz = pos[2] + t * dz;
    const gap = (pos[1] + t * dy) - heightAt(wx, wz);
    if (gap <= 0) {
      // crossed the surface between prevT and t — bisect for a clean landing
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        const mx = pos[0] + mid * dx;
        const mz = pos[2] + mid * dz;
        if ((pos[1] + mid * dy) - heightAt(mx, mz) <= 0) hi = mid;
        else lo = mid;
      }
      const ft = (lo + hi) / 2;
      return { x: pos[0] + ft * dx, y: pos[2] + ft * dz };
    }
    prevT = t;
    prevGap = gap;
  }
  void prevGap;
  return { x: c.px, y: c.py }; // ray never met the ground — fall back to player
}
