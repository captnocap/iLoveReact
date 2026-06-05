// Aim — the over-the-shoulder ADS rig (V3 graduation from cart/combat_lab).
//
// Why Follow can't aim: it pitches by sliding its look TARGET around a
// fixed-height eye — a look camera. Composed, its screen axis can never rise
// above the horizon ("could barely hit head height before hitting a ceiling" —
// the aim ceiling). Aim instead orbits a shoulder-shifted, crouch-aware pivot
// with a GENUINELY pitched forward axis: the screen axis elevation equals the
// pitch param, so full vertical authority and ADS-style closer framing.
//
// The crosshair law rides on this: the fire ray must be the camera's exact
// screen-center axis — normalize(target - pos) of THIS Solved (which is also
// what screenRay returns at the rect center). Never derive a fire ray from
// yaw/pitch directly; here that is safe only because the camera axis is
// constructed FROM them.
//
// Conventions: all angles DEGREES (registry rule). Pitch is elevation
// (+ up, − down — same as Orbit), clamped to [minPitch, maxPitch] inside
// solve; the reference's radian clamps carry over exactly through DEG.
// Yaw matches Follow's heading sense: forward = [sin yaw, 0, cos yaw]
// (yaw 0 faces +Z, positive yaw swings toward +X — the hmsc gameplay frame).
//
// `aimPivot` is exported for the camera-collision consumer: the reference
// clamps the eye toward the pivot when cover blocks the pivot→eye segment.
// That clamp needs physics, so it stays game-side — but the pivot it clamps
// toward is this rig's business, computed here once.

import type { CameraDef, Vec3 } from '../types';
import { DEG } from '../_util';

export type AimParams = {
  target: Vec3; // subject origin (feet); the pivot rises pivotHeight above it
  yaw: number; // degrees; forward = [sin yaw, 0, cos yaw]
  pitch: number; // degrees of elevation (+ up, − down); clamped to the limits below
  crouch: number; // 0..1 crouch tween — pulls the pivot down by crouchDrop
  shoulderShift: number; // meters along the right axis (over-the-shoulder framing)
  pivotHeight: number; // meters above target — standing eye-ish
  crouchDrop: number; // meters the pivot drops at full crouch
  distance: number; // meters the eye sits back along the aim axis (ADS framing)
  lookAhead: number; // meters the look target sits ahead along the aim axis
  minPitch: number; // degrees, the down clamp (negative)
  maxPitch: number; // degrees, the up clamp — wider than Follow: aiming needs the sky
  fov: number;
};

// The reference values, verbatim: combat_lab AIM_CAMERA + hmsc gameplay/camera's
// aimShoulderShiftMeters/aimFovDegrees. The clamps were radians there (max down
// 1.15, max up 1.0) — expressed through DEG so the limits are bit-identical.
export const AIM_DEFAULTS: AimParams = {
  target: [0, 0, 0],
  yaw: 0,
  pitch: 0,
  crouch: 0,
  shoulderShift: 0.62,
  pivotHeight: 1.62,
  crouchDrop: 0.42,
  distance: 2.4,
  lookAhead: 12,
  minPitch: -1.15 / DEG, // ~66° down
  maxPitch: 1.0 / DEG, // ~57° up
  fov: 47,
};

function pivotOf(p: AimParams): Vec3 {
  const yaw = p.yaw * DEG;
  // right = forward × up — the shoulder the camera frames over
  const rightX = -Math.cos(yaw);
  const rightZ = Math.sin(yaw);
  return [
    p.target[0] + rightX * p.shoulderShift,
    p.target[1] + p.pivotHeight - p.crouch * p.crouchDrop,
    p.target[2] + rightZ * p.shoulderShift,
  ];
}

// The shoulder pivot for a param set (defaults applied) — the point the
// game-side camera-collision clamp pulls the eye toward when cover intrudes.
export function aimPivot(params: Partial<AimParams> = {}): Vec3 {
  return pivotOf({ ...AIM_DEFAULTS, ...params });
}

function solve(p: AimParams) {
  const pitchDeg = Math.min(p.maxPitch, Math.max(p.minPitch, p.pitch));
  const yaw = p.yaw * DEG;
  const pitch = pitchDeg * DEG;
  const cp = Math.cos(pitch);
  const fwd: Vec3 = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
  const pivot = pivotOf(p);
  const pos: Vec3 = [
    pivot[0] - fwd[0] * p.distance,
    pivot[1] - fwd[1] * p.distance,
    pivot[2] - fwd[2] * p.distance,
  ];
  const target: Vec3 = [
    pivot[0] + fwd[0] * p.lookAhead,
    pivot[1] + fwd[1] * p.lookAhead,
    pivot[2] + fwd[2] * p.lookAhead,
  ];
  return { pos, target, fov: p.fov };
}

export const Aim: CameraDef<AimParams> = { id: 'Aim', solve, defaults: AIM_DEFAULTS };
