// scape3d projection. The 2D oblique projection (`project`) is retained ONLY for
// the minimap shader's sprite blips. The world is now rendered by a real
// perspective camera (Scene3D → framework/gpu/3d.zig), so screen→world picking
// is a ray/ground-plane intersection that EXACTLY inverts the framework's
// `m4lookAt` + `m4perspective`. cameraFor() is the single source of truth: the
// Scene component and unproject() both derive the eye/target/fov from it, so a
// click always lands on the tile the cursor is over.

export const TILE_PX = 30;

export interface Cam {
  px: number;
  py: number;
  yaw: number;
  pitch: number;
  zoom: number;
}

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

// Eye, look-target, and fov for the current camera state. The renderer feeds this
// straight into <Scene3D.Camera>; unproject() inverts it.
export function cameraFor(c: Cam): { pos: V3; target: V3; fov: number } {
  const target: V3 = [c.px, TARGET_Y, c.py];
  const dist = BASE_DIST / Math.max(0.35, c.zoom);
  const elev = elevationFor(c.pitch);
  const horiz = dist * Math.cos(elev);
  const height = dist * Math.sin(elev) + TARGET_Y;
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
  const dx = vx * sxv + vy * ux + vz * fx;
  const dy = vx * syv + vy * uy + vz * fy;
  const dz = vx * szv + vy * uz + vz * fz;

  // intersect ground plane y = 0
  if (Math.abs(dy) < 1e-6) return { x: c.px, y: c.py };
  const t = -pos[1] / dy;
  if (t < 0) return { x: c.px, y: c.py }; // ray points at sky — fall back to player
  return { x: pos[0] + t * dx, y: pos[2] + t * dz };
}
