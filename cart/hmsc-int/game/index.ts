// game/index.ts — THE ONLY DOOR (V17, STRUCTURE).
//
// ★ THE GAME — the one system, the GAME_* ground floor. Every lab and editor
// imports from here ('@game'), never from the files behind it (P3: deep
// interfaces; editors may reach into game/figure/ internals because they
// author it — labs may not). The import rules (STRUCTURE):
//
//   labs/    → game/ only
//   editors/ → game/ + shell/ + data/
//   game/    → framework bindings + runtime/ (never editors, labs, shell)
//
// Importing '@game' is ALSO the metafile-gate signal that compiles the game's
// host bindings into a cart (V18: the game is a gated ingredient — 2D carts
// pay zero bytes for its existence).
//
// The V17 standard import every scaffolded lab carries:
//
//   import { GAME_PHYSICS, GAME_PATHING, GAME_INPUT, GAME_CAMERA, ... } from '@game';
//
// Doors marked capture-pending export `{ status: 'capture-pending' }` until
// their capture lane rewrites the system in behind them — the import line is
// already correct; only what's behind the door grows.

export { GAME_PHYSICS, PHYSICS_LIMITS, physicsHostReady, registerHeightfield, clearHeightfields, stepPhysics } from './physics';
export type {
  CollisionRect,
  Heightfield,
  OrientedCollisionRect,
  PhysicsBody,
  PhysicsStepInput,
  PhysicsStepResult,
  PhysicsTuning,
  SteppedBody,
  SurfaceFeel,
  Vec3,
} from './physics';

export { GAME_PATHING, pathingHostReady } from './pathing';
export type { MotionPlan, MotionProfile, MotionSample, Path, PathPoint } from './pathing';

export { GAME_INPUT, createKeyState, onKeyDown, onKeyUp } from './input';
export type { KeyEvent, KeyState } from './input';

export { GAME_CAMERA, CAMERA_RIGS } from './camera';
export type { CameraDef, Modifier, Rect, Solved } from './camera';

export { GAME_LOOP, STATE_TICKS_PER_MINUTE, stateTickIntervalMs, FALLBACK_FRAME_MS } from './loop';
export type { FrameHandle } from './loop';

export { GAME_COMMANDS, createCommandRegistry, parseCommandValue, tokenizeCommandLine } from './commands';
export type { CommandOutcome, CommandRegistry, CommandSpec, ScriptResult } from './commands';

// ── capture-pending doors (V17: the import line is already the right one) ──
export { GAME_FIGURE, charactersStream, bakeBodyDocument } from './figure';
export type { BodyDocument, BakedFigure, CharactersEvent, CharactersStreamState } from './figure';
export { GAME_VEHICLE, vehiclesStream } from './vehicle';
export type { VehicleDoc, VehiclePartId, VehicleStyleId, VehicleRoleId, VehiclePoseId, DamageLevel, VehicleBuild, VehiclesEvent, VehiclesStreamState } from './vehicle';
export { GAME_ITEMS } from './items';
export { GAME_ANIMATION } from './animation';
export { GAME_KINDS } from './kinds';
export { GAME_CHANCE } from './chance';
export { GAME_PERCEPTION } from './perception';
export { GAME_CUTSCENE } from './cutscene';
export { GAME_STORY } from './story';
export { GAME_MISSIONS } from './missions';
export { GAME_ACTIVITIES } from './activities';
export { GAME_CHROME } from './chrome';
export { GAME_TELEMETRY } from './telemetry';
