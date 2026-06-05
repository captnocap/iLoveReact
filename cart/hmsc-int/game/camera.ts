// game/camera.ts — GAME_CAMERA: the game-facing door over @reactjit/cameras.
//
// V3: the registry is the one camera system. This door exposes its PURE side —
// rigs, solve, modifiers, ground picking — so game logic, cutscene clocks
// (V16), and headless verify runs solve cameras with no React in sight. Labs
// that want the drop-in <OrbitCamera>-style components keep importing
// '@reactjit/cameras' (platform JSX is platform).
//
// V3 also rules two graduations INTO runtime/cameras that surface here when
// their capture lands: the combat_lab ADS aim rig (the shipped Follow rig hits
// an aim ceiling — "could barely hit head height") and the generic screenRay
// (R7: three carts hand-rolled the same click-into-3D math; unprojectGround
// becomes a consumer). Until then this door carries the seven shipped rigs.
//
// All angle params are DEGREES (the registry convention).

import { solveCamera } from '@reactjit/cameras/solve';
import { unprojectGround } from '@reactjit/cameras/unproject';
import { sway, shake } from '@reactjit/cameras/modifiers';
import { Orbit } from '@reactjit/cameras/rigs/orbit';
import { Follow } from '@reactjit/cameras/rigs/follow';
import { TopDown } from '@reactjit/cameras/rigs/topDown';
import { Isometric } from '@reactjit/cameras/rigs/isometric';
import { FirstPerson } from '@reactjit/cameras/rigs/firstPerson';
import { FreeFly } from '@reactjit/cameras/rigs/freeFly';
import { Cinematic } from '@reactjit/cameras/rigs/cinematic';
import type { CameraDef, Modifier, Rect, Solved, Vec3 } from '@reactjit/cameras/types';

export type { CameraDef, Modifier, Rect, Solved, Vec3 };

/** The registry, keyed by rig id — tooling, debug panels, rig-switcher UIs. */
export const CAMERA_RIGS: Record<string, CameraDef> = Object.freeze({
  Orbit,
  Follow,
  TopDown,
  Isometric,
  FirstPerson,
  FreeFly,
  Cinematic,
});

export const GAME_CAMERA = Object.freeze({
  /** pure: rig + params (+ modifiers) → { pos, target, fov } */
  solve: solveCamera,
  /** screen point + Solved → ground point (works across any rig swap) */
  unprojectGround,
  rigs: CAMERA_RIGS,
  modifiers: Object.freeze({ sway, shake }),
});
