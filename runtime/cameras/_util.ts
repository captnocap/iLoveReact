// @reactjit/cameras — shared solver math.
//
// Two recurring moves, factored out so rigs don't re-derive them:
//   • orbitalEye  — place an eye on a sphere around a target (orbit, isometric)
//   • lookForward — point a forward ray from an eye (firstPerson, freeFly)
// Plus the degrees->radians constant. All angle params across the public API are
// DEGREES (the new declarative convention — same as a mesh `rotation` prop); the
// conversion to radians happens here, once.

import type { Vec3 } from './types';

export const DEG = Math.PI / 180;

// Eye position on a sphere of `dist` around `target`. yaw orbits around +Y
// (0 puts the eye on the target's -Z side, looking toward +Z); pitch is the
// elevation angle (0 = level with the target, 90 = directly overhead).
export function orbitalEye(target: Vec3, yawDeg: number, pitchDeg: number, dist: number): Vec3 {
  const yaw = yawDeg * DEG;
  const elev = pitchDeg * DEG;
  const horiz = dist * Math.cos(elev);
  const height = dist * Math.sin(elev);
  return [
    target[0] - Math.sin(yaw) * horiz,
    target[1] + height,
    target[2] - Math.cos(yaw) * horiz,
  ];
}

// A look-target one unit ahead of `eye` along (yaw, pitch).
//
// FPS yaw convention: yaw 0 looks toward +Z; **positive yaw turns the camera to
// its own right** (so dragging the mouse right increases yaw and the view turns
// right, matching every FPS the user has ever played). Pitch lifts the gaze
// (+ up, - down). The math convention (positive yaw = CCW from above) feels
// inverted on a screen drag — we use FPS convention here on purpose.
//
// Note: this is independent of orbitalEye, which uses "compass angle of the eye
// around a target" — a different semantic. Don't conflate the two yaws.
export function lookForward(eye: Vec3, yawDeg: number, pitchDeg: number): Vec3 {
  const yaw = yawDeg * DEG;
  const pit = pitchDeg * DEG;
  return [
    eye[0] - Math.sin(yaw) * Math.cos(pit),
    eye[1] + Math.sin(pit),
    eye[2] + Math.cos(yaw) * Math.cos(pit),
  ];
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
