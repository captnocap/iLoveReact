// Follow — chase camera that trails a moving subject along its heading.
// Unlike Orbit, the author does not control yaw: the camera sits a fixed
// `distance` behind the subject's facing and `height` above it, always looking
// at the subject. Feed it the subject's heading each frame and it follows.

import type { CameraDef, Vec3 } from '../types';
import { DEG } from '../_util';

export type FollowParams = {
  target: Vec3; // subject position (origin / feet)
  heading: number; // degrees the subject faces/moves; forward = [sin, 0, cos]
  distance: number; // how far behind the subject the eye sits
  height: number; // how far above the subject the eye sits
  lookHeight: number; // look at target + this Y (aim at the chest, not the feet)
  fov: number;
};

export const FOLLOW_DEFAULTS: FollowParams = {
  target: [0, 0, 0], heading: 0, distance: 8, height: 4, lookHeight: 1.2, fov: 55,
};

function solve(p: FollowParams) {
  const h = p.heading * DEG;
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  const [tx, ty, tz] = p.target;
  const pos: Vec3 = [tx - fx * p.distance, ty + p.height, tz - fz * p.distance];
  const target: Vec3 = [tx, ty + p.lookHeight, tz];
  return { pos, target, fov: p.fov };
}

export const Follow: CameraDef<FollowParams> = { id: 'Follow', solve, defaults: FOLLOW_DEFAULTS };
