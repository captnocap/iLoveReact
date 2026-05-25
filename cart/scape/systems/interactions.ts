// The interaction catalog — the vocabulary the action menu is built from. Each
// entry is one verb the player can attempt on a target. This is the load-bearing
// primitive: talk, examine, loot, open/close a door, (later) every attack and
// murder, are all just entries here. Pure data + metadata; the EFFECT of running
// one lives in state/world.ts (resolveAction), and which entries APPLY to a given
// target is decided by systems/actions.ts (availableActions).
//
// Mirrors design.ts `InteractionType` but kept lean for the first slice.

export type InteractionKey =
  | 'walk'
  | 'examine'
  | 'talk'
  | 'pickup'
  | 'drop'
  | 'open'
  | 'close'
  | 'loot'
  | 'shoot'
  | 'slash';

export type Proximity = 'adjacent' | 'near' | 'any';

export interface InteractionDef {
  key: InteractionKey;
  label: string; // the menu verb; targets may override (e.g. "Talk to Roach")
  proximity: Proximity; // how close the player must be for it to be enabled
}

// Distances (tiles) for each proximity band. `near` ≈ within a couple tiles.
export const PROXIMITY_RANGE: Record<Proximity, number> = {
  adjacent: 1.7,
  near: 2.4,
  any: Infinity,
};

export const INTERACTIONS: Record<InteractionKey, InteractionDef> = {
  walk: { key: 'walk', label: 'Walk here', proximity: 'any' },
  examine: { key: 'examine', label: 'Examine', proximity: 'any' },
  talk: { key: 'talk', label: 'Talk', proximity: 'near' },
  pickup: { key: 'pickup', label: 'Pick up', proximity: 'near' },
  drop: { key: 'drop', label: 'Drop', proximity: 'any' },
  open: { key: 'open', label: 'Open door', proximity: 'adjacent' },
  close: { key: 'close', label: 'Close door', proximity: 'adjacent' },
  loot: { key: 'loot', label: 'Search', proximity: 'adjacent' },
  // Attacks. `shoot` is range-gated by the weapon's maxRange + line of sight (in
  // systems/chance.ts), not by a proximity band, so it stays 'any' here; `slash` is
  // a melee verb and must be adjacent.
  shoot: { key: 'shoot', label: 'Shoot', proximity: 'any' },
  slash: { key: 'slash', label: 'Slash', proximity: 'adjacent' },
};
