// FirstPerson — eye at the subject, looking along its facing.
// `position` is the subject's ground origin; the eye floats `eyeHeight` above it.
// `facing` is the look yaw (degrees), `pitch` aims up/down. For an in-building or
// aim-down-sights view.

import type { CameraDef, Vec3 } from '../types';
import { lookForward } from '../_util';

export type FirstPersonParams = {
  position: Vec3; // subject ground origin (feet)
  eyeHeight: number; // eye offset above the origin
  facing: number; // degrees — look yaw
  pitch: number; // degrees — look up (+) / down (-)
  fov: number;
};

export const FIRSTPERSON_DEFAULTS: FirstPersonParams = {
  position: [0, 0, 0], eyeHeight: 1.7, facing: 0, pitch: 0, fov: 70,
};

function solve(p: FirstPersonParams) {
  const eye: Vec3 = [p.position[0], p.position[1] + p.eyeHeight, p.position[2]];
  return { pos: eye, target: lookForward(eye, p.facing, p.pitch), fov: p.fov };
}

export const FirstPerson: CameraDef<FirstPersonParams> = {
  id: 'FirstPerson', solve, defaults: FIRSTPERSON_DEFAULTS,
};
