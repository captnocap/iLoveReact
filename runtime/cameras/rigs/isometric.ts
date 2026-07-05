// Isometric — fixed-angle ARPG / Schedule-1 view. The classic look: a locked
// elevation (true-iso ~35.264°), the target pans, and there is no pitch control.
// We only have a perspective projection, so a long `dist` + narrow `fov`
// flattens perspective foreshortening into a near-orthographic, iso-ish frame.

import type { CameraDef, Vec3 } from '../types';
import { orbitalEye } from '../_util';

export type IsometricParams = {
  target: Vec3; // the point the view is centred on
  yaw: number; // degrees — the (usually fixed) compass rotation
  dist: number; // long, to flatten perspective
  fov: number; // narrow, to flatten perspective
  pitch?: number; // degrees above the horizon — omit for the true-iso lock (req_2710)
};

// True isometric elevation: atan(1/sqrt(2)) ≈ 35.264°.
const ISO_PITCH = 35.264;

export const ISOMETRIC_DEFAULTS: IsometricParams = {
  target: [0, 0, 0], yaw: 45, dist: 24, fov: 30,
};

function solve(p: IsometricParams) {
  return { pos: orbitalEye(p.target, p.yaw, p.pitch ?? ISO_PITCH, p.dist), target: p.target, fov: p.fov };
}

export const Isometric: CameraDef<IsometricParams> = { id: 'Isometric', solve, defaults: ISOMETRIC_DEFAULTS };
