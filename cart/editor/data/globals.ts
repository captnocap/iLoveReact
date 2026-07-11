// editor/data/globals.ts — the world's GLOBAL tunables (GLOBALS req_2770).
//
// One canonical table for the physics/player globals: field ids, labels, editing
// ranges, and the game's defaults. This is GAME DATA (V28: a game is data) — the
// editor owns the values, the playtest tab pushes them live through the
// __compiled_world_set_physics door, and the future Compile bake writes the SAME
// 13 floats into the gamefile's PHYSICS_CONFIG lump.
//
// FLOAT ORDER IS A WIRE CONTRACT: packPhysicsGlobals emits the lump order the
// host reads (world_loader.zig setPhysicsConfig / constructor.PhysicsConfig,
// itself the gamefile PHYSICS_CONFIG layout). Reorder NOTHING without
// changing both sides.
//
// Defaults are the editor's tuned game values and scale contract (R4: collider
// height 1.65 m, radius 0.34 m, step 0.5 m).
import type { OverridableProp } from '../inspector/overridables';

export type PhysicsGlobals = {
  gravity: number;
  jumpSpeed: number;
  playerRadius: number;
  playerHeight: number;
  stepHeight: number;
  wallRestitution: number;
  bodyRestitution: number;
  sidePushGrace: number;
  accelMult: number;
  surfaceFriction: number;
  surfaceRestitution: number;
  walkSpeed: number;
  runSpeed: number;
};

export type WorldGlobals = {
  physics: PhysicsGlobals;
};

export const DEFAULT_PHYSICS_GLOBALS: PhysicsGlobals = {
  gravity: 13.5,
  jumpSpeed: 5.65,
  playerRadius: 0.34,
  playerHeight: 1.65,
  stepHeight: 0.5,
  wallRestitution: 0.08,
  bodyRestitution: 0.72,
  sidePushGrace: 0.08,
  accelMult: 1.0,
  surfaceFriction: 0.55,
  surfaceRestitution: 0.0,
  walkSpeed: 2.4,
  runSpeed: 5.8,
};

export function defaultWorldGlobals(): WorldGlobals {
  return { physics: { ...DEFAULT_PHYSICS_GLOBALS } };
}

// The focus-panel field specs — OverridableProp so the panel reuses the ONE
// stepper control (inspector/OverrideField, the shared column grid). `path` is
// the PhysicsGlobals key; `base` is the game default a reset returns to. Ranges
// mirror the host's safety clamps where it has them (physics.zig: radius ≥ 0.05,
// height ≥ 0.2, restitutions 0..1, accel 0.05..4) so the panel never authors a
// value the step would silently clamp away.
export const PHYSICS_GLOBAL_SPECS: OverridableProp[] = [
  { path: 'walkSpeed', label: 'walk speed m/s', ctl: 'num', group: 'MOVEMENT', base: DEFAULT_PHYSICS_GLOBALS.walkSpeed, min: 0, max: 15, step: 0.1 },
  { path: 'runSpeed', label: 'run speed m/s', ctl: 'num', group: 'MOVEMENT', base: DEFAULT_PHYSICS_GLOBALS.runSpeed, min: 0, max: 25, step: 0.1 },
  { path: 'accelMult', label: 'acceleration ×', ctl: 'num', group: 'MOVEMENT', base: DEFAULT_PHYSICS_GLOBALS.accelMult, min: 0.05, max: 4, step: 0.05 },
  { path: 'surfaceFriction', label: 'ground friction', ctl: 'num', group: 'MOVEMENT', base: DEFAULT_PHYSICS_GLOBALS.surfaceFriction, min: 0, max: 2, step: 0.05 },
  { path: 'gravity', label: 'gravity m/s²', ctl: 'num', group: 'JUMP + GRAVITY', base: DEFAULT_PHYSICS_GLOBALS.gravity, min: 0, max: 60, step: 0.25 },
  { path: 'jumpSpeed', label: 'jump speed m/s', ctl: 'num', group: 'JUMP + GRAVITY', base: DEFAULT_PHYSICS_GLOBALS.jumpSpeed, min: 0, max: 30, step: 0.05 },
  { path: 'playerRadius', label: 'body radius m', ctl: 'num', group: 'PLAYER BODY', base: DEFAULT_PHYSICS_GLOBALS.playerRadius, min: 0.05, max: 1, step: 0.01 },
  { path: 'playerHeight', label: 'body height m', ctl: 'num', group: 'PLAYER BODY', base: DEFAULT_PHYSICS_GLOBALS.playerHeight, min: 0.2, max: 4, step: 0.05 },
  { path: 'stepHeight', label: 'step height m', ctl: 'num', group: 'PLAYER BODY', base: DEFAULT_PHYSICS_GLOBALS.stepHeight, min: 0, max: 2, step: 0.05 },
  { path: 'wallRestitution', label: 'wall bounce', ctl: 'num', group: 'COLLISION RESPONSE', base: DEFAULT_PHYSICS_GLOBALS.wallRestitution, min: 0, max: 1, step: 0.02 },
  { path: 'bodyRestitution', label: 'body bounce', ctl: 'num', group: 'COLLISION RESPONSE', base: DEFAULT_PHYSICS_GLOBALS.bodyRestitution, min: 0, max: 1, step: 0.02 },
  { path: 'surfaceRestitution', label: 'ground bounce', ctl: 'num', group: 'COLLISION RESPONSE', base: DEFAULT_PHYSICS_GLOBALS.surfaceRestitution, min: 0, max: 1, step: 0.02 },
  { path: 'sidePushGrace', label: 'ledge grace m', ctl: 'num', group: 'COLLISION RESPONSE', base: DEFAULT_PHYSICS_GLOBALS.sidePushGrace, min: 0, max: 0.5, step: 0.01 },
];

/** The specs grouped by their `group`, in first-seen order (panel sections). */
export function physicsGlobalGroups(): { group: string; props: OverridableProp[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, OverridableProp[]>();
  for (const p of PHYSICS_GLOBAL_SPECS) {
    if (!byGroup.has(p.group)) { byGroup.set(p.group, []); order.push(p.group); }
    byGroup.get(p.group)!.push(p);
  }
  return order.map((group) => ({ group, props: byGroup.get(group)! }));
}

/** The 13-float wire payload for __compiled_world_set_physics — LUMP ORDER. */
export function packPhysicsGlobals(p: PhysicsGlobals): Float32Array {
  return new Float32Array([
    p.gravity,
    p.jumpSpeed,
    p.playerRadius,
    p.playerHeight,
    p.stepHeight,
    p.wallRestitution,
    p.bodyRestitution,
    p.sidePushGrace,
    p.accelMult,
    p.surfaceFriction,
    p.surfaceRestitution,
    p.walkSpeed,
    p.runSpeed,
  ]);
}

/** A loaded/partial physics record merged over the defaults — unknown keys drop,
 *  missing keys keep their default, non-finite values are rejected loudly. */
export function revivePhysicsGlobals(raw: unknown): PhysicsGlobals {
  const out = { ...DEFAULT_PHYSICS_GLOBALS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(out) as (keyof PhysicsGlobals)[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (v !== undefined) console.error(`[globals] ${key} in the save is not a finite number (${String(v)}) — keeping the default ${out[key]}`);
  }
  return out;
}
