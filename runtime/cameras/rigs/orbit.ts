// Orbit — third-person camera that circles a target by yaw/pitch/zoom.
// The GTA / RuneScape register: the player drives yaw (turn) and pitch (tilt),
// zoom pulls the eye in. This is scape3d's `cameraFor`, generalized to any target.

import type { CameraDef, Vec3 } from '../types';
import { orbitalEye } from '../_util';

export type OrbitParams = {
  target: Vec3; // the look point (e.g. the player's chest)
  yaw: number; // degrees around +Y
  pitch: number; // degrees of elevation (0 = horizon, 90 = top-down)
  dist: number; // base eye distance at zoom 1
  zoom: number; // > 1 pulls the eye in (effective dist = dist / zoom)
  fov: number;
};

export const ORBIT_DEFAULTS: OrbitParams = {
  target: [0, 0, 0], yaw: 45, pitch: 35, dist: 15, zoom: 1, fov: 55,
};

function solve(p: OrbitParams) {
  const dist = p.dist / Math.max(0.2, p.zoom);
  return { pos: orbitalEye(p.target, p.yaw, p.pitch, dist), target: p.target, fov: p.fov };
}

export const Orbit: CameraDef<OrbitParams> = { id: 'Orbit', solve, defaults: ORBIT_DEFAULTS };
