// TopDown — tactical overhead camera (Hitman / Schedule-1 register).
// Looks down at the target from `height`, tilted `tilt` degrees off vertical so
// the world has a little depth and the lookAt never degenerates (a perfectly
// vertical view has an undefined up vector). `heading` spins which way "north"
// faces; pan by moving `target`.

import type { CameraDef, Vec3 } from '../types';
import { DEG } from '../_util';

export type TopDownParams = {
  target: Vec3; // ground point under the camera
  height: number; // how high the eye floats
  tilt: number; // degrees off straight-down (0 = vertical; clamped to a safe min)
  heading: number; // degrees — which compass direction the tilt leans toward
  fov: number;
};

export const TOPDOWN_DEFAULTS: TopDownParams = {
  target: [0, 0, 0], height: 20, tilt: 8, heading: 0, fov: 50,
};

function solve(p: TopDownParams) {
  const h = p.heading * DEG;
  const t = Math.max(1.5, p.tilt) * DEG; // min tilt avoids the vertical-lookAt singularity
  const horiz = p.height * Math.tan(t);
  const [tx, ty, tz] = p.target;
  const pos: Vec3 = [tx - Math.sin(h) * horiz, ty + p.height, tz - Math.cos(h) * horiz];
  return { pos, target: p.target, fov: p.fov };
}

export const TopDown: CameraDef<TopDownParams> = { id: 'TopDown', solve, defaults: TOPDOWN_DEFAULTS };
