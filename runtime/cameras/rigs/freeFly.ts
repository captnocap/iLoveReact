// FreeFly — unconstrained debug / spectator camera. `position` IS the eye (no
// eye-height offset, no subject to orbit); yaw/pitch are the free look direction.
// Drive position with movement keys and yaw/pitch with the mouse to fly anywhere.

import type { CameraDef, Vec3 } from '../types';
import { lookForward } from '../_util';

export type FreeFlyParams = {
  position: Vec3; // the eye, directly
  yaw: number; // degrees — look yaw
  pitch: number; // degrees — look up (+) / down (-)
  fov: number;
};

export const FREEFLY_DEFAULTS: FreeFlyParams = {
  position: [0, 5, 14], yaw: 180, pitch: -12, fov: 60,
};

function solve(p: FreeFlyParams) {
  const eye: Vec3 = [p.position[0], p.position[1], p.position[2]];
  return { pos: eye, target: lookForward(eye, p.yaw, p.pitch), fov: p.fov };
}

export const FreeFly: CameraDef<FreeFlyParams> = { id: 'FreeFly', solve, defaults: FREEFLY_DEFAULTS };
