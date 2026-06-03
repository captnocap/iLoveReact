import type { NpcFaction, NpcKind } from '../design';

// What an NPC IS — the kind axis. Mirrors world/tileKinds & world/propKinds: the
// struct stores `kind`, this registry gives it meaning. Body/health/speed and the
// default faction a fresh spawn of this kind belongs to live here, so spawn.ts
// stays a thin factory and tuning is one table. `canFight` gates whether this kind
// ever shoots back — a civilian is a body that flees, not a combatant.

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
  },
};

export function npcKindDefinition(kind: NpcKind): NpcKindDef {
  return KINDS[kind];
}

export function isNpcKind(value: string): value is NpcKind {
  return value === 'civilian' || value === 'thug' || value === 'police';
}

export function npcKindNamesForConsole(): string {
  return (Object.keys(KINDS) as NpcKind[]).join(', ');
}
