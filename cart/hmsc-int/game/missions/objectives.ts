// game/missions/objectives.ts — the completion-predicate vocabulary, evaluated
// against the QUERYABLE WORLD AS DATA (V22: "completion predicate — methods
// stay free"; the activities capture's explicit deferral: "completion-by-
// world-query belongs to missions").
//
// Reference: cart/scape/design.ts Objective/ObjectiveTarget (the corpus's ONE
// objective shape — contract-first, never consumed; the oracle's hazard). The
// kinds (kill/reach/earn/acquire/talk/evade/use_site), the explicit target
// union, amount ("$ goal, or notoriety ceiling for 'evade'"), itemKey, and
// marker ("the world blip you path to in order to engage") carry over.
// Recasts, surfaced in CAPTURE.md:
//   - `done: boolean` moves OFF the def into the run (defs are frozen tables);
//   - scape's 2D Tile {x,y} becomes hmsc world meters {x,z} (the perception
//     capture's convention);
//   - target kind 'position' is ADDED per V22's Hitman identity model — the
//     world is a roster of POSITIONS, people are seeded OCCUPANTS; a position
//     target resolves to its occupant at evaluation time (facts.occupants).
//
// EVALUATION IS A PURE READ: evaluateObjective(objective, facts) consults a
// plain JSON snapshot the caller supplies each tick — no host calls, no clock.
// An absent fact answers FALSE (unknown is never true): the engine can only
// know what the world told it this tick (the V22 event-sourced doctrine,
// applied to the predicate side).

import { MISSION_TUNING } from './tuning';

export type ObjectiveKind =
  | 'kill' | 'reach' | 'earn' | 'acquire' | 'talk' | 'evade' | 'use_site';

/** Explicit target so npc-by-id and zone/site-by-key can't be silently
 *  confused (scape's own stated reason for the union). 'point' is scape's
 *  'tile', in world meters; 'position' is the V22 post (occupant-resolved). */
export type ObjectiveTarget =
  | { kind: 'npc'; id: string }
  | { kind: 'position'; id: string }
  | { kind: 'zone'; key: string }
  | { kind: 'site'; key: string }
  | { kind: 'point'; x: number; z: number };

export type MissionObjective = {
  kind: ObjectiveKind;
  /** one line of player-facing meaning */
  brief: string;
  target?: ObjectiveTarget;
  /** $ goal for 'earn'; notoriety ceiling for 'evade' (scape verbatim) */
  amount?: number;
  itemKey?: string;
  /** the world blip you path to in order to engage (the GAME_PATHING seam) */
  marker?: { x: number; z: number };
};

/**
 * The queryable world, as data — what the validator calls "the queryable
 * future" arrives at the engine as a per-tick snapshot. Every field optional:
 * the caller answers what it knows, and an unanswered question holds nothing.
 */
export type MissionFacts = {
  playerPosition?: { x: number; z: number };
  playerCash?: number;
  notoriety?: number;
  /** item keys currently held */
  inventory?: readonly string[];
  /** npc ids down/dead (cumulative — the perception/story feed) */
  npcsDown?: readonly string[];
  /** npc ids the player has spoken to */
  talkedTo?: readonly string[];
  /** site keys the player has used */
  sitesUsed?: readonly string[];
  /** zone keys the player currently stands in */
  zonesIn?: readonly string[];
  /** position id → occupying npc id (the V22 roster; resolves 'position' targets) */
  occupants?: Readonly<Record<string, string>>;
};

/** Which target kinds each objective kind accepts — the validation table
 *  defineMission/validateRow enforce (a kill aimed at a zone is an authoring
 *  bug, never a mid-mission surprise). null entry = no target allowed. */
export const OBJECTIVE_TARGET_KINDS: Readonly<Record<ObjectiveKind, readonly ObjectiveTarget['kind'][] | null>> =
  Object.freeze({
    kill: ['npc', 'position'],
    reach: ['point', 'zone'],
    earn: null,
    acquire: null,
    talk: ['npc', 'position'],
    evade: null,
    use_site: ['site'],
  });

/** Resolve a target to the npc id it means right now — positions resolve to
 *  their occupant (facts.occupants), npcs to themselves, everything else null. */
export function resolveTargetNpc(target: ObjectiveTarget | undefined, facts: MissionFacts): string | null {
  if (!target) return null;
  if (target.kind === 'npc') return target.id;
  if (target.kind === 'position') return facts.occupants?.[target.id] ?? null;
  return null;
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Does this objective hold against the snapshot? Pure; absent facts = false. */
export function evaluateObjective(objective: MissionObjective, facts: MissionFacts): boolean {
  switch (objective.kind) {
    case 'kill': {
      const npcId = resolveTargetNpc(objective.target, facts);
      return npcId !== null && (facts.npcsDown ?? []).includes(npcId);
    }
    case 'reach': {
      const target = objective.target;
      if (!target) return false;
      if (target.kind === 'zone') return (facts.zonesIn ?? []).includes(target.key);
      if (target.kind === 'point') {
        return facts.playerPosition !== undefined
          && distance(facts.playerPosition, target) <= MISSION_TUNING.reachRadiusMeters;
      }
      return false;
    }
    case 'earn':
      return facts.playerCash !== undefined && objective.amount !== undefined
        && facts.playerCash >= objective.amount;
    case 'acquire':
      return objective.itemKey !== undefined && (facts.inventory ?? []).includes(objective.itemKey);
    case 'talk': {
      const npcId = resolveTargetNpc(objective.target, facts);
      return npcId !== null && (facts.talkedTo ?? []).includes(npcId);
    }
    case 'evade':
      return facts.notoriety !== undefined && objective.amount !== undefined
        && facts.notoriety <= objective.amount;
    case 'use_site':
      return objective.target?.kind === 'site' && (facts.sitesUsed ?? []).includes(objective.target.key);
  }
}

/** The pathing seam: where the world blip for this objective sits — the
 *  explicit marker, else a point target's own coordinates. The consumer hands
 *  this to GAME_PATHING (find/planMotion); nothing here paths. */
export function objectiveMarker(objective: MissionObjective): { x: number; z: number } | null {
  if (objective.marker) return objective.marker;
  if (objective.target?.kind === 'point') return { x: objective.target.x, z: objective.target.z };
  return null;
}
