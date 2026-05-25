// availableActions — the pure function behind the action menu. Given whatever the
// player clicked and where the player is standing, it returns the contextual list
// of ActionOptions (design.ts), each already gated by proximity (blocked rows
// carry a reason). No effects here and no React — this just answers "what could I
// attempt on this thing right now?". state/world.ts runs the chosen one.

import type { ActionOption } from '../design';
import type { Ent } from '../state/world';
import type { Door } from './doors';
import type { WorldItem } from './inventory';
import type { DecorKind } from '../world/tiles';
import { INTERACTIONS, PROXIMITY_RANGE, type InteractionKey } from './interactions';

export type ActionTarget =
  | { kind: 'npc'; ent: Ent }
  | { kind: 'storefront'; ent: Ent }
  | { kind: 'sign'; ent: Ent }
  | { kind: 'door'; door: Door }
  | { kind: 'item'; item: WorldItem }
  | { kind: 'prop'; prop: { x: number; y: number; kind: DecorKind } }
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

export function availableActions(t: ActionTarget, playerX: number, playerY: number): ActionOption[] {
  const pos = targetPos(t);
  const d = Math.hypot(pos.x - playerX, pos.y - playerY);
  const out: ActionOption[] = [];

  switch (t.kind) {
    case 'npc':
      out.push(opt('talk', d, t.ent.name ? `Talk to ${t.ent.name}` : 'Talk'));
      out.push(opt('examine', d));
      break;
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
      if (t.prop.kind === 'dumpster') out.push(opt('loot', d, 'Search'));
      out.push(opt('examine', d));
      break;
    case 'tile':
      break;
  }

  // Every menu can fall back to moving — RuneScape's "Walk here" at the bottom.
  out.push(opt('walk', d, 'Walk here'));
  return out;
}
