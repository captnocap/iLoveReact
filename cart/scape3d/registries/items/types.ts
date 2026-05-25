import type { ItemInstance, ItemModule, Key, Player } from '../../design';

export type ItemInventoryContext = {
  player: Player;
  instance: ItemInstance;
  module: ScapeItemModule;
};

export type ScapeItemModule = ItemModule & {
  world: ItemModule['world'] & {
    wgsl: string;
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
