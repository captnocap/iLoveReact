import type { ReactNode } from 'react';
import type { ItemInstance, ItemModule, Key, Player } from '../../design';
import type { ItemAnchor } from './itemMesh';

export type ItemInventoryContext = {
  player: Player;
  instance: ItemInstance;
  module: ScapeItemModule;
};

export type ScapeItemModule = ItemModule & {
  world: ItemModule['world'] & {
    wgsl: string;                            // 2D SDF — still drives the HUD weapon box
    model?: (a: ItemAnchor) => ReactNode;    // 3D geometry — the dropped/held item (authored in cm)
  };
  inventory?: {
    shortLabel?: string;
    equipText?: string;
    onEquip?: (ctx: ItemInventoryContext) => void;
  };
};

export type ItemLookup = Record<Key, ScapeItemModule>;

export function defineItem(module: ScapeItemModule): ScapeItemModule {
  return module;
}
