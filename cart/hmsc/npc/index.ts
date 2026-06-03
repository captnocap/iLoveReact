// The HMSC NPC subsystem. A living actor on three orthogonal axes — kind (what it
// is), faction (who it fights), role (what it means to the player) — each its own
// registry, plus the spawn factory and the two damage paths (geometric aim hit /
// probabilistic chance roll). The entity type itself is in design.ts (NpcState),
// next to the other world layers; everything that gives it behavior is here.
//
// Not yet wired: nv_* commands and rendering (that's the "wire it in" layer). The
// model + locational hitbox an NPC is drawn and shot against live in
// render3d/{NpcFigure,humanoid}.

export { npcKindDefinition, isNpcKind, npcKindNamesForConsole } from './kinds';
export type { NpcKindDef } from './kinds';
export { factionRegard, isHostileTo } from './factions';
export type { FactionRegard, RegardTarget } from './factions';
export { npcRole, isNpcRole, npcRoleNamesForConsole, DEFAULT_NPC_ROLE } from './roles';
export type { NpcRoleDef } from './roles';
export { createNpc, addNpcToWorld, removeNpcFromWorld, npcAt } from './spawn';
export type { CreateNpcParams } from './spawn';
export { hitChance, rollHit, rollZone } from './systems/chance';
export type { ShotFactors } from './systems/chance';
export { zoneDamage, applyDamageToNpc, applyAimHitToNpc, applyZoneShotToNpc } from './systems/damage';
export type { NpcDamageResult } from './systems/damage';
