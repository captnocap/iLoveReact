// game/camera.ts — GAME_CAMERA: the game-facing door over @reactjit/cameras.
//
// V3: the registry is the one camera system. This door exposes its PURE side —
// rigs, solve, modifiers, picking — so game logic, cutscene clocks (V16), and
// headless verify runs solve cameras with no React in sight. Labs that want
// the drop-in <OrbitCamera>-style components keep importing
// '@reactjit/cameras' (platform JSX is platform).
//
// The two V3 graduations have LANDED in runtime/cameras:
//   • Aim — combat_lab's ADS over-the-shoulder rig as a first-class CameraDef
//     (the shipped Follow rig hits an aim ceiling — "could barely hit head
//     height"); aimPivot exported for the game-side camera-collision clamp.
//   • screenRay — the generic pixel→world ray (R7: three carts hand-rolled
//     the same click-into-3D math); unprojectGround is now a consumer.
//
// The crosshair law (combat_lab hazard, carried as a contract): a fire ray is
// the solved camera's exact screen-center axis — normalize(target - pos),
// which IS screenRay at the rect center. Never derive it from yaw/pitch trig.
//
// All angle params are DEGREES (the registry convention).

import { solveCamera } from '@reactjit/cameras/solve';
import { screenRay, unprojectGround, worldToScreen } from '@reactjit/cameras/unproject';
import { sway, shake } from '@reactjit/cameras/modifiers';
import { Orbit } from '@reactjit/cameras/rigs/orbit';
import { Follow } from '@reactjit/cameras/rigs/follow';
import { TopDown } from '@reactjit/cameras/rigs/topDown';
import { Isometric } from '@reactjit/cameras/rigs/isometric';
import { FirstPerson } from '@reactjit/cameras/rigs/firstPerson';
import { FreeFly } from '@reactjit/cameras/rigs/freeFly';
import { Cinematic } from '@reactjit/cameras/rigs/cinematic';
import { Aim, aimPivot } from '@reactjit/cameras/rigs/aim';
import type { AimParams } from '@reactjit/cameras/rigs/aim';
import type { ScreenRay } from '@reactjit/cameras/unproject';
import type { CameraDef, Modifier, Rect, Solved, Vec3 } from '@reactjit/cameras/types';

export type { AimParams, CameraDef, Modifier, Rect, ScreenRay, Solved, Vec3 };

export function normalizeCameraYawDegrees(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

export function orbitPitchToAimPitch(orbitPitchDegrees: number): number {
  return -orbitPitchDegrees;
}

export function aimPitchToOrbitPitch(aimPitchDegrees: number): number {
  return -aimPitchDegrees;
}

export function figureYawForCameraYaw(cameraYawDegrees: number): number {
  return normalizeCameraYawDegrees(cameraYawDegrees + 180);
}

/** The registry, keyed by rig id — tooling, debug panels, rig-switcher UIs. */
export const CAMERA_RIGS: Record<string, CameraDef> = Object.freeze({
  Orbit,
  Follow,
  TopDown,
  Isometric,
  FirstPerson,
  FreeFly,
  Cinematic,
  Aim,
});

export const GAME_CAMERA = Object.freeze({
  /** pure: rig + params (+ modifiers) → { pos, target, fov } */
  solve: solveCamera,
  /** screen point + Solved → the world ray under that pixel (R7 canonical) */
  screenRay,
  /** screen point + Solved → ground point (a screenRay consumer; any rig) */
  unprojectGround,
  /** world point + Solved → screen pixel (screenRay's exact inverse) */
  worldToScreen,
  /** Aim's shoulder pivot — what the camera-collision clamp pulls the eye toward */
  aimPivot,
  rigs: CAMERA_RIGS,
  modifiers: Object.freeze({ sway, shake }),
  orientation: Object.freeze({
    aimPitchToOrbitPitch,
    figureYawForCameraYaw,
    normalizeYaw: normalizeCameraYawDegrees,
    orbitPitchToAimPitch,
  }),
});
