import { blueHoodie } from './items/blue_hoodie';
import { bomb } from './items/bomb';
import { knife } from './items/knife';
import { lockpick } from './items/lockpick';
import type { Key } from '../design';
import type { ItemLookup, ScapeItemModule } from './items/types';

export type { ScapeItemModule } from './items/types';

export const ITEM_MODULES: ScapeItemModule[] = [
  bomb,
  knife,
  lockpick,
  blueHoodie,
];

export const ITEMS: ItemLookup = Object.fromEntries(
  ITEM_MODULES.map((item) => [item.type.key, item]),
) as ItemLookup;

export const ITEM_SPRITE_WGSL = ITEM_MODULES.map((item) => item.world.wgsl).join('\n');

export function itemModule(typeKey: Key): ScapeItemModule | undefined {
  return ITEMS[typeKey];
}
