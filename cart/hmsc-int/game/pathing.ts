// game/pathing.ts — GAME_PATHING: host A* routes + deterministic motion plans.
//
// V5: pathing_lab's stack is the START of the real traffic/civilian system —
// host A* (`__path_*`, framework/v8_bindings_pathing.zig) with pre-calculated-
// until-disrupted routes, and closed-form motion plans sampled at any t. ALL
// NPC pathing is deterministic until a game-state change; the player's effect
// on the world is what invalidates a plan.
//
// This door fronts the platform modules that already own the capability
// (runtime/pathing.ts speaks the wire; runtime/motion.ts is pure math) —
// importing them is also the metafile-gate signal that compiles the pathing
// bindings in (V18). The lane-discipline capture (snapToLaneCenters /
// straightenJunctions, ruled host-side) lands behind this door in the V5
// capture lane; callers won't move.
//
// P2: profile costs, lane offsets, and motion profiles are caller data —
// nothing here owns a gameplay number.

import {
  PATH_FLOW,
  fillPathRect,
  findPath,
  pathDisrupted,
  pathGeneration,
  publishPathGrid,
  setPathFlows,
  setPathProfile,
  updatePathCells,
} from '@reactjit/pathing';
import type { Path, PathPoint } from '@reactjit/pathing';
import {
  measurePath,
  planMotion,
  pointOnPath,
  sampleMotion,
  slicePath,
  slicePoints,
} from '@reactjit/motion';
import type { MotionPlan, MotionProfile, MotionSample } from '@reactjit/motion';

export type { Path, PathPoint, MotionPlan, MotionProfile, MotionSample };

declare const globalThis: any;

/** True when the host A* bindings are compiled into this binary. */
export function pathingHostReady(): boolean {
  return typeof globalThis.__path_set_grid === 'function';
}

export const GAME_PATHING = Object.freeze({
  hostReady: pathingHostReady,

  // ── the grid (world → host) ────────────────────────────────────────────
  publishGrid: publishPathGrid,
  updateCells: updatePathCells,
  fillRect: fillPathRect,
  setProfile: setPathProfile,
  setFlows: setPathFlows,
  FLOW: PATH_FLOW,

  // ── routes (pre-calculated until disrupted) ────────────────────────────
  find: findPath,
  generation: pathGeneration,
  disrupted: pathDisrupted,

  // ── deterministic motion (position is a pure function of t) ────────────
  planMotion,
  sampleMotion,
  slicePath,
  slicePoints,
  measurePath,
  pointOnPath,
});
