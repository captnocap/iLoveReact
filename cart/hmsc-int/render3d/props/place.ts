import type { WorldProp } from '../../design';

// Shared placement math for prop models. A prop is sculpted in its own local
// space (origin on the ground, +Y up, -Z the facing direction at yaw 0, the
// same convention as PlayerFigure and world/traffic.ts), then `at()` lifts each
// part into world space around the prop's anchor and yaw. Keeping this pure and
// JSX-free lets every model file stay a thin list of placed meshes.

export type V3 = [number, number, number];

export function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function rotateYaw(v: V3, yawDegrees: number): V3 {
  const yaw = yawDegrees * Math.PI / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

// The world-space base of a prop: its ground anchor.
export function propBase(prop: WorldProp): V3 {
  return [prop.x, prop.y, prop.z];
}

// A local part offset placed into world space around the prop's anchor + yaw.
export function at(prop: WorldProp, local: V3): V3 {
  return add(propBase(prop), rotateYaw(local, prop.yawDegrees));
}
