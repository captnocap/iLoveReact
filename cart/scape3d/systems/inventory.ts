import type { Id, ItemInstance, Key, Player } from '../design';
import { itemModule, ITEMS, type ScapeItemModule } from '../registries/items';

export type WorldItem = {
  id: Id;
  instanceId: Id;
  x: number;
  y: number;
};

export type InventoryState = {
  nextInstanceId: Id;
  nextWorldItemId: Id;
  instances: ItemInstance[];
  worldItems: WorldItem[];
};

export type InventorySlot = {
  instance: ItemInstance;
  module: ScapeItemModule;
};

function defaultCharges(typeKey: Key): number | undefined {
  return ITEMS[typeKey]?.type.charges;
}

function addInstance(state: InventoryState, typeKey: Key, opts: Partial<ItemInstance> = {}): ItemInstance {
  const instance: ItemInstance = {
    id: state.nextInstanceId++,
    typeKey,
    charges: opts.charges ?? defaultCharges(typeKey),
    burned: opts.burned,
    quality: opts.quality,
  };
  state.instances.push(instance);
  return instance;
}

export function spawnWorldItem(state: InventoryState, typeKey: Key, x: number, y: number, opts: Partial<ItemInstance> = {}): WorldItem {
  const instance = addInstance(state, typeKey, opts);
  const worldItem: WorldItem = { id: state.nextWorldItemId++, instanceId: instance.id, x, y };
  state.worldItems.push(worldItem);
  return worldItem;
}

export function createInitialInventoryState(): InventoryState {
  const state: InventoryState = {
    nextInstanceId: 1,
    nextWorldItemId: 1,
    instances: [],
    worldItems: [],
  };
  spawnWorldItem(state, 'knife', 23.5, 24.5);
  spawnWorldItem(state, 'lockpick', 19.5, 22.5);
  spawnWorldItem(state, 'blue_hoodie', 25.5, 20.5);
  spawnWorldItem(state, 'bomb', 31.5, 25.5);
  spawnWorldItem(state, 'pistol', 22.5, 26.5);
  spawnWorldItem(state, 'crowbar', 24.5, 23.5); // near spawn — grab it, then go pry boards
  return state;
}

export function instanceById(state: InventoryState, id: Id): ItemInstance | undefined {
  return state.instances.find((item) => item.id === id);
}

export function worldItemSlot(state: InventoryState, item: WorldItem): InventorySlot | null {
  const instance = instanceById(state, item.instanceId);
  if (!instance) return null;
  const module = itemModule(instance.typeKey);
  return module ? { instance, module } : null;
}

export function inventorySlots(player: Player, state: InventoryState): InventorySlot[] {
  const out: InventorySlot[] = [];
  for (const id of player.pockets) {
    const instance = instanceById(state, id);
    if (!instance) continue;
    const module = itemModule(instance.typeKey);
    if (module) out.push({ instance, module });
  }
  return out;
}

export function inHandSlot(player: Player, state: InventoryState): InventorySlot | null {
  if (player.inHand == null) return null;
  const instance = instanceById(state, player.inHand);
  if (!instance) return null;
  const module = itemModule(instance.typeKey);
  return module ? { instance, module } : null;
}

export function nearestWorldItem(items: WorldItem[], x: number, y: number, radius: number): WorldItem | null {
  let best: WorldItem | null = null;
  let bestD = radius;
  for (const item of items) {
    const d = Math.hypot(item.x - x, item.y - y);
    if (d < bestD) {
      bestD = d;
      best = item;
    }
  }
  return best;
}

export function equipInventoryItem(player: Player, state: InventoryState, instanceId: Id): string | null {
  if (!player.pockets.includes(instanceId)) return null;
  const instance = instanceById(state, instanceId);
  if (!instance) return null;
  const module = itemModule(instance.typeKey);
  if (!module) return null;
  player.inHand = instanceId;
  module.inventory?.onEquip?.({ player, instance, module });
  return module.inventory?.equipText ?? `${module.type.label} in hand.`;
}

export function pickupWorldItem(player: Player, state: InventoryState, worldItemId: Id): string | null {
  const index = state.worldItems.findIndex((item) => item.id === worldItemId);
  if (index < 0) return null;
  const [worldItem] = state.worldItems.splice(index, 1);
  if (!player.pockets.includes(worldItem.instanceId)) player.pockets = player.pockets.concat(worldItem.instanceId);
  const instance = instanceById(state, worldItem.instanceId);
  const module = instance ? itemModule(instance.typeKey) : undefined;
  if (!player.inHand) equipInventoryItem(player, state, worldItem.instanceId);
  return module ? `Picked up ${module.type.label}.` : 'Picked up item.';
}

export function dropInHand(player: Player, state: InventoryState, x: number, y: number): string | null {
  if (player.inHand == null) return null;
  const instanceId = player.inHand;
  const instance = instanceById(state, instanceId);
  const module = instance ? itemModule(instance.typeKey) : undefined;
  player.pockets = player.pockets.filter((id) => id !== instanceId);
  player.inHand = player.pockets[0];
  state.worldItems.push({ id: state.nextWorldItemId++, instanceId, x, y });
  return module ? `Dropped ${module.type.label}.` : 'Dropped item.';
}

// ── stash containers (toilet/bed/dumpster …) — deposit & withdraw ────────────
// A stash is just another list of instance ids, like pockets. The instance never
// leaves state.instances, so charges/quality/burned survive being stashed.
type StashCache = { stash?: number; stashed?: number[] };

// Move the in-hand item into a stash, if it has a free slot. Returns a message, or
// null if there's nothing in hand / no room.
export function stashInHand(player: Player, state: InventoryState, cache: StashCache): string | null {
  if (player.inHand == null || cache.stash == null) return null;
  const stashed = cache.stashed ?? (cache.stashed = []);
  if (stashed.length >= cache.stash) return null; // full
  const instanceId = player.inHand;
  const instance = instanceById(state, instanceId);
  const module = instance ? itemModule(instance.typeKey) : undefined;
  player.pockets = player.pockets.filter((id) => id !== instanceId);
  player.inHand = player.pockets[0];
  stashed.push(instanceId);
  return module ? `Stashed the ${module.type.label}.` : 'Stashed it.';
}

// Pull everything out of a stash back into pockets. Returns the labels taken (for the
// toast). Leaves the container empty + reusable.
export function emptyStash(player: Player, state: InventoryState, cache: StashCache): string[] {
  const taken: string[] = [];
  for (const id of cache.stashed ?? []) {
    if (!player.pockets.includes(id)) player.pockets = player.pockets.concat(id);
    if (player.inHand == null) player.inHand = id;
    const inst = instanceById(state, id);
    const mod = inst ? itemModule(inst.typeKey) : undefined;
    if (mod) taken.push(mod.type.label);
  }
  cache.stashed = [];
  return taken;
}
