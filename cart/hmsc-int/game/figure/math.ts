// game/figure/math.ts — the kit's small vector/euler toolbox (internal).
//
// One rule everything here honors: host mesh rotations compose Ry·Rx·Rz
// (framework 3d.zig), and every euler in the figure kit is DEGREES. The
// rotate/align helpers below are the single home of that convention — the
// detached-wrist class of bug came from re-rolling it per call site.

export type V3 = [number, number, number];

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** Rotate a local vector by euler degrees in the HOST order (Ry·Rx·Rz). */
export function rotateEulerVec(v: V3, r: V3): V3 {
  let [x, y, z] = v;

  const rz = r[2] * DEG2RAD;
  let c = Math.cos(rz), s = Math.sin(rz);
  let nx = x * c - y * s;
  let ny = x * s + y * c;
  x = nx; y = ny;

  const rx = r[0] * DEG2RAD;
  c = Math.cos(rx); s = Math.sin(rx);
  ny = y * c - z * s;
  let nz = y * s + z * c;
  y = ny; z = nz;

  const ry = r[1] * DEG2RAD;
  c = Math.cos(ry); s = Math.sin(ry);
  nx = x * c + z * s;
  nz = -x * s + z * c;
  return [nx, y, nz];
}

export const addVec = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const subVec = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const addRot = (parent: V3, local: V3): V3 => [parent[0] + local[0], parent[1] + local[1], parent[2] + local[2]];
export const len3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const mid3 = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
export const lerp3 = (a: V3, b: V3, t: number): V3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const span3 = (a: V3, b: V3): number => len3(subVec(b, a));

/** Blend `p` toward `target` in place by clamped t. */
export function blendVecInto(p: V3, target: V3, t: number): void {
  const k = Math.max(0, Math.min(1, t));
  p[0] += (target[0] - p[0]) * k;
  p[1] += (target[1] - p[1]) * k;
  p[2] += (target[2] - p[2]) * k;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Shortest-arc wrap of a degree delta into (−180, 180]. */
export const wrap180 = (d: number): number => ((d + 180) % 360 + 360) % 360 - 180;

/** Euler degrees ([rx, ry, 0], host order) pointing local +Y along d —
 *  enough for radially-symmetric limb pipes (no twist tracking needed). */
export function alignY(d: V3): V3 {
  const l = len3(d) || 1;
  return [Math.acos(Math.max(-1, Math.min(1, d[1] / l))) * RAD2DEG, Math.atan2(d[0], d[2]) * RAD2DEG, 0];
}

/** Darken '#RRGGBB' by factor f (garment trims, shoes, shading). */
export function darkenHex(hex: string, f: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#1f2937';
  const c = (i: number) => Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * f).toString(16).padStart(2, '0');
  return `#${c(0)}${c(1)}${c(2)}`;
}
