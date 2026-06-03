import type { NpcFaction, NpcState, Vec3, WorldState } from '../design';
import { npcKindDefinition } from './kinds';
import { DEFAULT_NPC_ROLE } from './roles';

// The NPC factory. createNpc builds a fresh NpcState from a kind (pulling its
// health/faction defaults from npc/kinds) plus an explicit id and position. It
// takes the id rather than minting one so the serial counter lives with the
// command layer, not here — this stays a pure builder. add/remove return a new
// WorldState (the npcs map is immutable like every other world layer).

export type CreateNpcParams = {
  id: string;
  kind: NpcState['kind'];
  faction?: NpcFaction;
  role?: string;
  position: Vec3;
  yawDegrees?: number;
  createdByCommand?: string;
};

// Stagger each NPC's gait clock by a stable per-id offset so a spawned crowd
// isn't in lockstep, without needing randomness. Same hash the humanoid palette
// uses, kept local so spawn doesn't depend on the renderer.
function gaitPhaseOffsetSeconds(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

export function createNpc(params: CreateNpcParams): NpcState {
  const def = npcKindDefinition(params.kind);
  return {
    id: params.id,
    kind: params.kind,
    faction: params.faction ?? def.defaultFaction,
    role: params.role ?? DEFAULT_NPC_ROLE,
    position: { ...params.position },
    yawDegrees: params.yawDegrees ?? 0,
    stance: 'stand',
    posture: 'idle',
    health: { current: def.maxHealth, max: def.maxHealth },
    animationSeconds: gaitPhaseOffsetSeconds(params.id),
    velocity: { x: 0, y: 0, z: 0 },
    grounded: false,
    createdByCommand: params.createdByCommand ?? 'createNpc',
  };
}

export function addNpcToWorld(world: WorldState, npc: NpcState): WorldState {
  return { ...world, npcs: { ...world.npcs, [npc.id]: npc } };
}

export function removeNpcFromWorld(world: WorldState, id: string): WorldState {
  if (!world.npcs[id]) return world;
  const next = { ...world.npcs };
  delete next[id];
  return { ...world, npcs: next };
}

export function npcAt(world: WorldState, id: string): NpcState | null {
  return world.npcs[id] ?? null;
}
