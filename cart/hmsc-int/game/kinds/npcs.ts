// game/kinds/npcs — the NPC KIND axis (what an NPC IS) and the FACTION axis
// (who it FIGHTS). THE TABLES ARE THE DATA (P2). The struct stores `kind` and
// `faction`; these registries give them meaning. The third NPC axis — role,
// what an NPC MEANS to the player — is the open registry in ./roles.ts.
//
// Fresh capture of cart/hmsc/npc/kinds.ts + cart/hmsc/npc/factions.ts
// (behavior references only — see the capture note). Consumers go through
// game/kinds/index.ts (P3).

export type NpcKind = 'civilian' | 'paramedic' | 'thug' | 'police';
export type NpcFaction = 'civilian' | 'gang' | 'police';

// ── perception (user-specified Hitman-style directional awareness) ───────────
// Vision is a forward FoV cone gated by line-of-sight cover sampling; hearing
// is omnidirectional, radius = the noise's carry distance × this listener's
// acuity (the noise itself scales by the emitter's movement mode and the
// tile's npc.noise underfoot — see ./tiles.ts). Awareness escalates UPWARD by
// kind: a civilian doesn't fight, it runs to notify an officer. Reference:
// combat_lab (states calm→spooked→alert→hostile/panic).
export type NpcPerceptionProfile = {
  visionRangeMeters: number;
  // Full cone angle, degrees. Outside the cone an NPC is blind — no eyes in
  // the back of the head.
  visionFovDegrees: number;
  // 0..1 multiplier on how far a noise carries for this listener.
  hearingAcuity: number;
  // Seconds of fully-exposed point-blank sight to go calm → hostile. Partial
  // exposure and distance stretch it (suspicion fills slower).
  reactionSeconds: number;
};

export type NpcKindDefinition = {
  kind: NpcKind;
  label: string;
  maxHealth: number;
  walkSpeedMetersPerSecond: number;
  runSpeedMetersPerSecond: number;
  // The faction a bare spawn of this kind gets when none is named.
  defaultFaction: NpcFaction;
  // Does this kind return fire? A civilian is a body that flees, not a
  // combatant — it escalates by notifying a kind that CAN fight.
  canFight: boolean;
  // Base outgoing damage when it does fire, before the chance roll's zone pick.
  weaponDamage: number;
  perception: NpcPerceptionProfile;
};

export const NPC_KIND_DEFINITIONS: Record<NpcKind, NpcKindDefinition> = {
  civilian: {
    kind: 'civilian',
    label: 'Civilian',
    maxHealth: 70,
    walkSpeedMetersPerSecond: 1.6,
    runSpeedMetersPerSecond: 4.5,
    defaultFaction: 'civilian',
    canFight: false,
    weaponDamage: 0,
    perception: { visionRangeMeters: 16, visionFovDegrees: 100, hearingAcuity: 0.8, reactionSeconds: 1.4 },
  },
  // First responder: unarmed, sharp ears, runs TOWARD trouble's aftermath —
  // tends downed bodies once the shooting stops, notifies officers like any
  // civilian while it hasn't.
  paramedic: {
    kind: 'paramedic',
    label: 'Paramedic',
    maxHealth: 90,
    walkSpeedMetersPerSecond: 2.0,
    runSpeedMetersPerSecond: 5.0,
    defaultFaction: 'civilian',
    canFight: false,
    weaponDamage: 0,
    perception: { visionRangeMeters: 16, visionFovDegrees: 100, hearingAcuity: 0.9, reactionSeconds: 1.2 },
  },
  thug: {
    kind: 'thug',
    label: 'Thug',
    maxHealth: 100,
    walkSpeedMetersPerSecond: 2.0,
    runSpeedMetersPerSecond: 5.2,
    defaultFaction: 'gang',
    canFight: true,
    weaponDamage: 18,
    perception: { visionRangeMeters: 20, visionFovDegrees: 110, hearingAcuity: 0.85, reactionSeconds: 0.9 },
  },
  police: {
    kind: 'police',
    label: 'Police',
    maxHealth: 120,
    walkSpeedMetersPerSecond: 2.2,
    runSpeedMetersPerSecond: 5.6,
    defaultFaction: 'police',
    canFight: true,
    weaponDamage: 22,
    perception: { visionRangeMeters: 24, visionFovDegrees: 120, hearingAcuity: 1.0, reactionSeconds: 0.7 },
  },
};

export const NPC_KINDS = Object.keys(NPC_KIND_DEFINITIONS) as NpcKind[];

export function isNpcKind(value: string): value is NpcKind {
  return Object.prototype.hasOwnProperty.call(NPC_KIND_DEFINITIONS, value);
}

export function npcKindDefinition(kind: NpcKind): NpcKindDefinition {
  return NPC_KIND_DEFINITIONS[kind];
}

export function npcKindNamesForConsole(): string {
  return NPC_KINDS.join(', ');
}

// ── the faction regard matrix (who fights whom) ──────────────────────────────
// One table is the whole social contract: gangs and police are mutually
// hostile, civilians are wary of gangs, everyone tolerates everyone they have
// no quarrel with. 'player' is a regard TARGET but never a faction an NPC
// belongs to — a special column so a wanted level can later shift the city's
// regard without touching faction-vs-faction rules.
//
// This answers "will A open fire on B?" — it is NOT damage. Whether a shot
// lands is the chance engine's business. Faction only decides intent. The role
// layer (./roles.ts hostileOnSight) can override this per-NPC.

export type RegardTarget = NpcFaction | 'player';
export type FactionRegard = 'hostile' | 'wary' | 'neutral' | 'friendly';

// FACTION_REGARD[viewer][subject] = how `viewer` regards `subject`.
export const FACTION_REGARD: Record<NpcFaction, Record<RegardTarget, FactionRegard>> = {
  civilian: {
    civilian: 'friendly',
    gang: 'wary',
    police: 'friendly',
    player: 'neutral',
  },
  gang: {
    civilian: 'neutral',
    gang: 'friendly',
    police: 'hostile',
    player: 'neutral',
  },
  police: {
    civilian: 'friendly',
    gang: 'hostile',
    police: 'friendly',
    player: 'neutral',
  },
};

export function factionRegard(viewer: NpcFaction, subject: RegardTarget): FactionRegard {
  return FACTION_REGARD[viewer][subject];
}

// Does `viewer` treat `subject` as an enemy to engage? Hostile only — wary is
// "keep distance / flee", not "open fire".
export function isHostileTo(viewer: NpcFaction, subject: RegardTarget): boolean {
  return FACTION_REGARD[viewer][subject] === 'hostile';
}
