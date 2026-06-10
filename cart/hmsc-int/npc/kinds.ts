import type { NpcFaction, NpcKind } from '../design';

// What an NPC IS — the kind axis. Mirrors world/tileKinds & world/propKinds: the
// struct stores `kind`, this registry gives it meaning. Body/health/speed and the
// default faction a fresh spawn of this kind belongs to live here, so spawn.ts
// stays a thin factory and tuning is one table. `canFight` gates whether this kind
// ever shoots back — a civilian is a body that flees, not a combatant.

// How a kind perceives the world — Hitman-style directional awareness. Vision
// is a forward FoV cone gated by line-of-sight cover sampling; hearing is
// omnidirectional, radius = the noise's carry distance × this listener's
// acuity (the noise itself scales by the emitter's movement mode and the
// tile's `npc.noise` underfoot — see world/tileKinds). Awareness escalates
// upward by kind: a civilian doesn't fight, it runs to notify an officer.
// Reference cart: combat_lab (states calm→spooked→alert→hostile/panic).
export type NpcPerceptionProfile = {
  visionRangeMeters: number;
  // Full cone angle, degrees. Outside the cone an NPC is blind — no more
  // eyes in the back of the head.
  visionFovDegrees: number;
  // 0..1 multiplier on how far a noise carries for this listener.
  hearingAcuity: number;
  // Seconds of fully-exposed point-blank sight to go calm → hostile. Partial
  // exposure and distance stretch it (suspicion fills slower).
  reactionSeconds: number;
};

export type NpcKindDef = {
  kind: NpcKind;
  label: string;
  maxHealth: number;
  walkSpeedMetersPerSecond: number;
  runSpeedMetersPerSecond: number;
  // The faction a bare `nv_spawn <kind>` gets when none is named.
  defaultFaction: NpcFaction;
  // Does this kind return fire? Drives whether the AI ever rolls to shoot.
  canFight: boolean;
  // Base outgoing damage when it does fire, before the chance roll's zone pick.
  weaponDamage: number;
  perception: NpcPerceptionProfile;
};

const KINDS: Record<NpcKind, NpcKindDef> = {
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

export function npcKindDefinition(kind: NpcKind): NpcKindDef {
  return KINDS[kind];
}

export function isNpcKind(value: string): value is NpcKind {
  return value === 'civilian' || value === 'paramedic' || value === 'thug' || value === 'police';
}

export function npcKindNamesForConsole(): string {
  return (Object.keys(KINDS) as NpcKind[]).join(', ');
}
