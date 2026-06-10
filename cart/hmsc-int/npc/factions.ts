import type { NpcFaction } from '../design';

// Who an NPC FIGHTS — the faction axis. Combat allegiance is a closed set
// (design.ts NpcFaction); how each faction REGARDS every other is this matrix.
// One table is the whole social contract: gangs and police are mutually hostile,
// civilians are wary of gangs, everyone tolerates everyone they have no quarrel
// with. The player is a special column so a wanted level can later shift the
// city's regard without touching faction-vs-faction rules.
//
// This answers "will A open fire on B?" — it is NOT damage. Damage (and whether a
// shot actually lands) is the chance roll in systems/chance.ts. Faction only
// decides intent.

// 'player' is a regard target but never a faction an NPC belongs to.
export type RegardTarget = NpcFaction | 'player';

export type FactionRegard = 'hostile' | 'wary' | 'neutral' | 'friendly';

// matrix[viewer][subject] = how `viewer` regards `subject`.
const MATRIX: Record<NpcFaction, Record<RegardTarget, FactionRegard>> = {
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
  return MATRIX[viewer][subject];
}

// Does `viewer` treat `subject` as an enemy to engage? Hostile only — wary is
// "keep distance / flee", not "open fire". The role layer can override this
// (a `target` role can mark an otherwise-friendly civilian as a mark); that
// override lives in roles.ts, not here.
export function isHostileTo(viewer: NpcFaction, subject: RegardTarget): boolean {
  return MATRIX[viewer][subject] === 'hostile';
}
