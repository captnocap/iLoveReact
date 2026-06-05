// @reactjit/cameras — the shared registry of drop-in camera rigs.
//
// The third leg of the declarative 3D stack, alongside @reactjit/effects (WGSL
// shaders) and @reactjit/geometries (shape generators). A camera rig is a PURE
// solver params -> Solved; this module wraps each one in a named drop-in
// component so a cart swaps its whole camera in one line:
//
//   import { OrbitCamera, TopDownCamera } from '@reactjit/cameras';
//   <Scene3D>
//     <OrbitCamera   target={[px, 0, pz]} yaw={45} pitch={35} zoom={1.1} />
//     ...or...
//     <TopDownCamera target={[px, 0, pz]} height={22} />
//   </Scene3D>
//
// All angle params are DEGREES (the new declarative convention). Picking inverts
// through unprojectGround, which depends only on Solved — so click-to-world
// keeps working across any rig swap with zero extra code. See ./README.md.

import { useRef } from 'react';
import { Scene3D } from '../primitives';
import type { CameraDef, Modifier, Solved } from './types';

import { Orbit } from './rigs/orbit';
import { Follow } from './rigs/follow';
import { TopDown } from './rigs/topDown';
import { Isometric } from './rigs/isometric';
import { FirstPerson } from './rigs/firstPerson';
import { FreeFly } from './rigs/freeFly';
import { Cinematic } from './rigs/cinematic';

// ── Types + per-rig defs (re-exported so carts import everything from here) ──
export type { Vec3, Rect, Solved, Rig, CameraDef, Modifier } from './types';

export { Orbit, ORBIT_DEFAULTS, type OrbitParams } from './rigs/orbit';
export { Follow, FOLLOW_DEFAULTS, type FollowParams } from './rigs/follow';
export { TopDown, TOPDOWN_DEFAULTS, type TopDownParams } from './rigs/topDown';
export { Isometric, ISOMETRIC_DEFAULTS, type IsometricParams } from './rigs/isometric';
export { FirstPerson, FIRSTPERSON_DEFAULTS, type FirstPersonParams } from './rigs/firstPerson';
export { FreeFly, FREEFLY_DEFAULTS, type FreeFlyParams } from './rigs/freeFly';
export { Cinematic, CINEMATIC_DEFAULTS, SHOTS, type CinematicParams, type Shot, type Subject } from './rigs/cinematic';

export { sway, shake } from './modifiers';
export { unprojectGround } from './unproject';

// ── The spine: resolve a rig + params (+ modifiers) to a Solved ──────────────
// Lives in ./solve.ts (a pure, React-free home) so game logic and headless
// runs can solve cameras without JSX; re-exported here so carts never notice.
export { solveCamera } from './solve';
import { solveCamera } from './solve';

// ── The generic component + named drop-ins ───────────────────────────────────

// Emits one <Scene3D.Camera>. `rig` is any CameraDef; `modifiers` is an optional
// Solved->Solved stack; everything else is the rig's params.
export function CameraRig({ rig, modifiers = [], ...params }: any) {
  const s = solveCamera(rig, params, modifiers);
  return <Scene3D.Camera position={s.pos} target={s.target} fov={s.fov} />;
}

export const OrbitCamera = (p: any) => <CameraRig rig={Orbit} {...p} />;
export const FollowCamera = (p: any) => <CameraRig rig={Follow} {...p} />;
export const TopDownCamera = (p: any) => <CameraRig rig={TopDown} {...p} />;
export const IsometricCamera = (p: any) => <CameraRig rig={Isometric} {...p} />;
export const FirstPersonCamera = (p: any) => <CameraRig rig={FirstPerson} {...p} />;
export const FreeFlyCamera = (p: any) => <CameraRig rig={FreeFly} {...p} />;
export const CinematicCamera = (p: any) => <CameraRig rig={Cinematic} {...p} />;

// The registry, keyed by id — for tooling, debug panels, and rig-switcher UIs
// that pick a CameraDef by name (e.g. CAMERAS[mode].solve for picking).
export const CAMERAS: Record<string, CameraDef> = {
  Orbit, Follow, TopDown, Isometric, FirstPerson, FreeFly, Cinematic,
};

// ── Smoothing hook (state, so not a pure modifier) ───────────────────────────

// Critically-damped-ish exponential follow toward `target`. Call it every tick
// with the freshly-solved camera; it lerps the previous frame's Solved toward it
// by `alpha` (0..1; higher = snappier) and returns the smoothed value. Use it to
// take the jitter out of a Follow cam or to ease between rig swaps.
export function useSmoothed(target: Solved, alpha = 0.15): Solved {
  const prev = useRef<Solved | null>(null);
  if (prev.current === null) {
    prev.current = { pos: [...target.pos], target: [...target.target], fov: target.fov };
    return prev.current;
  }
  const p = prev.current;
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  const next: Solved = {
    pos: [lerp(p.pos[0], target.pos[0]), lerp(p.pos[1], target.pos[1]), lerp(p.pos[2], target.pos[2])],
    target: [lerp(p.target[0], target.target[0]), lerp(p.target[1], target.target[1]), lerp(p.target[2], target.target[2])],
    fov: lerp(p.fov, target.fov),
  };
  prev.current = next;
  return next;
}
