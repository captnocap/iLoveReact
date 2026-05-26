// availableActions — the pure function behind the action menu. Given whatever the
// player clicked and where the player is standing, it returns the contextual list
// of ActionOptions (design.ts), each already gated by proximity (blocked rows
// carry a reason). No effects here and no React — this just answers "what could I
// attempt on this thing right now?". state/world.ts runs the chosen one.

import type { ActionOption, RangeProfile } from '../design';
import type { Ent } from '../state/world';
import type { Door } from './doors';
import type { WorldItem } from './inventory';
import type { DecorKind } from '../world/tiles';
import type { Feature } from '../world/entity';
import { INTERACTIONS, PROXIMITY_RANGE, type InteractionKey } from './interactions';
import { attackChance, lineOfSight } from './chance';

// The held weapon, resolved into what an attack row needs. Null when unarmed.
export type WeaponContext = {
  ranged: boolean;
  profile: RangeProfile | null;
  key: 'shoot' | 'slash';
  label: string; // the menu verb, e.g. 'Shoot — Cheap pistol'
};

// Everything availableActions needs beyond the target: where the player is, what
// they're holding, their condition, the time of day, and the live door blockers
// (for line-of-sight). The chance math lives in systems/chance.ts.
export type AttackContext = {
  px: number;
  py: number;
  weapon: WeaponContext | null;
  combat: number; // 0..1
  health01: number; // 0..1
  hour: number; // 0..23
  closedDoors: Set<string>;
  heldKey?: string; // typeKey of the in-hand item — gates tool actions like 'pry'
};

export type ActionTarget =
  | { kind: 'npc'; ent: Ent }
  | { kind: 'storefront'; ent: Ent }
  | { kind: 'sign'; ent: Ent }
  | { kind: 'door'; door: Door }
  | { kind: 'item'; item: WorldItem }
  | { kind: 'prop'; prop: { x: number; y: number; kind: DecorKind } }
  | { kind: 'feature'; feature: Feature }
  | { kind: 'tile'; x: number; y: number };

/** The world-space point a target occupies, for distance/proximity tests. */
export function targetPos(t: ActionTarget): { x: number; y: number } {
  switch (t.kind) {
    case 'npc':
    case 'storefront':
    case 'sign':
      return { x: t.ent.x, y: t.ent.y };
    case 'door':
      return { x: t.door.x + 0.5, y: t.door.y + 0.5 };
    case 'item':
      return { x: t.item.x, y: t.item.y };
    case 'prop':
      return { x: t.prop.x, y: t.prop.y };
    case 'feature':
      return { x: t.feature.x + t.feature.w / 2, y: t.feature.y + t.feature.h / 2 };
    case 'tile':
      return { x: t.x + 0.5, y: t.y + 0.5 };
  }
}

/** A short label naming the target, for the menu header. */
export function targetLabel(t: ActionTarget): string {
  switch (t.kind) {
    case 'npc':
      return t.ent.name ?? 'Someone';
    case 'storefront':
      return 'Storefront';
    case 'sign':
      return 'Neon sign';
    case 'door':
      return 'Door';
    case 'item':
      return 'Item';
    case 'prop':
      return t.prop.kind === 'palm' ? 'Palm' : t.prop.kind === 'dumpster' ? 'Dumpster' : 'Sign';
    case 'feature': {
      const k = t.feature.kind;
      return k.charAt(0).toUpperCase() + k.slice(1);
    }
    case 'tile':
      return 'Ground';
  }
}

function opt(key: InteractionKey, dist: number, labelOverride?: string): ActionOption {
  const def = INTERACTIONS[key];
  const blocked = dist > PROXIMITY_RANGE[def.proximity];
  return {
    interactionKey: key,
    label: labelOverride ?? def.label,
    blocked,
    reason: blocked ? 'too far — get closer' : undefined,
  };
}

// Build the attack row for an NPC, if the player is holding a weapon. The chance is
// GROUND TRUTH (systems/chance.ts) — distance, line of sight, the shooter's health
// and the time of day all fold into it; the menu may DISPLAY a warped value under
// high, but `chance` here stays honest so the dice roll is fair.
function attackOption(ctx: AttackContext, pos: { x: number; y: number }, d: number): ActionOption | null {
  const w = ctx.weapon;
  if (!w) return null;
  const los = w.ranged ? lineOfSight(ctx.px, ctx.py, pos.x, pos.y, ctx.closedDoors) : 'clear';
  const breakdown = attackChance(w.profile, w.ranged, d, los, {
    combat: ctx.combat,
    health01: ctx.health01,
    hour: ctx.hour,
    awareness: 'unaware',
  });
  const blocked = breakdown.final <= 0;
  let reason: string | undefined;
  if (blocked) {
    if (w.ranged && los === 'none') reason = 'no line of sight';
    else if (w.ranged && w.profile && d > w.profile.maxRange) reason = 'out of range';
    else if (!w.ranged && d > PROXIMITY_RANGE.adjacent) reason = 'too far — get closer';
    else reason = 'no shot';
  }
  return {
    interactionKey: w.key,
    label: w.label,
    chance: breakdown.final,
    breakdown,
    blocked,
    reason,
  };
}

export function availableActions(t: ActionTarget, ctx: AttackContext): ActionOption[] {
  const pos = targetPos(t);
  const d = Math.hypot(pos.x - ctx.px, pos.y - ctx.py);
  const out: ActionOption[] = [];

  switch (t.kind) {
    case 'npc': {
      const attack = attackOption(ctx, pos, d);
      if (attack) out.push(attack);
      out.push(opt('talk', d, t.ent.name ? `Talk to ${t.ent.name}` : 'Talk'));
      out.push(opt('examine', d));
      break;
    }
    case 'storefront':
    case 'sign':
      out.push(opt('examine', d));
      break;
    case 'door':
      out.push(t.door.open ? opt('close', d) : opt('open', d));
      out.push(opt('examine', d));
      break;
    case 'item':
      out.push(opt('pickup', d));
      out.push(opt('examine', d));
      break;
    case 'prop':
      // Stashable props (dumpster) resolve as features now; a bare prop only examines.
      out.push(opt('examine', d));
      break;
    case 'feature': {
      const c = t.feature.cache;
      // A stash is searchable until it's been opened. A GATED stash (needs a tool)
      // offers 'pry'; an ungated one offers 'Search'. An empty declared stash is still
      // searchable — you just find nothing. That's the whole point of a potential spot.
      const stashable = !c.opened && (!!c.stash || !!c.money || !!c.items?.length || c.needs != null);
      if (stashable) {
        if (c.needs != null) {
          // gated by BOTH proximity and holding the required tool; the reason names it
          const tooFar = d > PROXIMITY_RANGE.adjacent;
          const missingTool = ctx.heldKey !== c.needs;
          out.push({
            interactionKey: 'pry',
            label: t.feature.kind === 'floorboard' ? 'Pry up floorboard' : 'Force it open',
            blocked: tooFar || missingTool,
            reason: tooFar ? 'too far — get closer' : missingTool ? `need a ${c.needs}` : undefined,
          });
        } else {
          out.push(opt('loot', d, 'Search'));
        }
      }
      out.push(opt('examine', d));
      break;
    }
    case 'tile':
      break;
  }

  // Every menu can fall back to moving — RuneScape's "Walk here" at the bottom.
  out.push(opt('walk', d, 'Walk here'));
  return out;
}
