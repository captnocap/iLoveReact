// game/build/edits — the edit vocabulary (V24: "edits are meaningful").
//
// A WallEdit is a SEMANTIC cutout, not a mesh operation: "a WallEdit is
// solid/door/window/doubleWindow/brokenWindow/garageDoor/arch/halfHeight."
// Each edit declares what the cutout MEANS — which gameplay tags it overrides
// on the host piece and what the opening is to the bake (portal kind,
// sightline, traversal). The Build Mode edit key cycles this table.
//
// The vocabulary is extensible BY TABLE ROW (P2): a new cutout is a new entry
// here, never a special case in logic. Door open/close state machines live
// with the door system (the kinds capture deliberately dropped speculative
// door state fields; same discipline here — the edit declares the OPENING).

import type { BuildGameplayTags } from './pieces';

export type WallEdit =
  | 'solid'
  | 'door'
  | 'window'
  | 'doubleWindow'
  | 'brokenWindow'
  | 'garageDoor'
  | 'arch'
  | 'halfHeight';

// What the opening admits through the nav graph. 'walk' = bodies, 'vehicle' =
// bodies and vehicles (a garage door), 'none' = no nav route (a window is a
// sightline, not a corridor).
export type EditPortalKind = 'none' | 'walk' | 'vehicle';

export type DoorInteractionDefinition = {
  action: 'toggle';
  defaultState: 'closed';
  states: readonly ['closed', 'open'];
  reachMeters: number;
  openSeconds: number;
  blocksMovementWhenClosed: boolean;
  blocksSightWhenClosed: boolean;
  blocksSoundWhenClosed: boolean;
};

export type WallEditDefinition = {
  edit: WallEdit;
  label: string;
  meaning: string;
  // Tag deltas layered over the catalog entry's tags (catalog.effectiveTags).
  overrides: Partial<BuildGameplayTags>;
  // The opening's bake meaning:
  portalKind: EditPortalKind;
  // Can perception/chance trace line of sight through the opening?
  sightline: boolean;
  // Can a body pass through the opening (walking or vaulting)?
  traversable: boolean;
  // The live interaction contract. Door-like cutouts expose an E/F toggle;
  // open archways/windows do not.
  interaction: DoorInteractionDefinition | null;
};

const WALK_DOOR_INTERACTION: DoorInteractionDefinition = {
  action: 'toggle',
  defaultState: 'closed',
  states: ['closed', 'open'],
  reachMeters: 2.2,
  openSeconds: 0.35,
  blocksMovementWhenClosed: true,
  blocksSightWhenClosed: true,
  blocksSoundWhenClosed: true,
};

const GARAGE_DOOR_INTERACTION: DoorInteractionDefinition = {
  ...WALK_DOOR_INTERACTION,
  openSeconds: 0.65,
};

export const WALL_EDIT_DEFINITIONS: Record<WallEdit, WallEditDefinition> = {
  solid: {
    edit: 'solid',
    label: 'Solid',
    meaning: 'The uncut wall — the identity edit.',
    overrides: {},
    portalKind: 'none',
    sightline: false,
    traversable: false,
    interaction: null,
  },
  door: {
    edit: 'door',
    label: 'Door',
    meaning: 'A doorway knows it connects rooms: a body-sized portal with a toggleable door panel.',
    overrides: { portal: true },
    portalKind: 'walk',
    sightline: true, // the opening exists; the door system's closed state re-seals it
    traversable: true,
    interaction: WALK_DOOR_INTERACTION,
  },
  window: {
    edit: 'window',
    label: 'Window',
    meaning: 'Sightline but not traversal: see and shoot through, never walk through.',
    overrides: { blocksSight: false },
    portalKind: 'none',
    sightline: true,
    traversable: false,
    interaction: null,
  },
  doubleWindow: {
    edit: 'doubleWindow',
    label: 'Double Window',
    meaning: 'The wide window: the same sightline-not-traversal semantics over more of the face.',
    overrides: { blocksSight: false },
    portalKind: 'none',
    sightline: true,
    traversable: false,
    interaction: null,
  },
  brokenWindow: {
    edit: 'brokenWindow',
    label: 'Broken Window',
    meaning: 'A window something already went through: sightline plus a vault entry.',
    overrides: { blocksSight: false, vaultable: true },
    // Vault traversal, not a standing corridor: agents that can mantle may
    // route through; the path graph treats it as gated, not open.
    portalKind: 'none',
    sightline: true,
    traversable: true,
    interaction: null,
  },
  garageDoor: {
    edit: 'garageDoor',
    label: 'Garage Door',
    meaning: 'A vehicle-sized portal — the toggleable roller door a car drives through.',
    overrides: { portal: true },
    portalKind: 'vehicle',
    sightline: true,
    traversable: true,
    interaction: GARAGE_DOOR_INTERACTION,
  },
  arch: {
    edit: 'arch',
    label: 'Arch',
    meaning: 'A doorway with no door: a permanently open walk portal.',
    overrides: { portal: true },
    portalKind: 'walk',
    sightline: true,
    traversable: true,
    interaction: null,
  },
  halfHeight: {
    edit: 'halfHeight',
    label: 'Half Height',
    meaning: 'The wall drops to waist height: low cover, sight and shots over the top, vault across.',
    overrides: { blocksSight: false, cover: 'low', vaultable: true },
    portalKind: 'none',
    sightline: true,
    traversable: true, // by vault — the overrides carry vaultable
    interaction: null,
  },
};

export const WALL_EDITS = Object.keys(WALL_EDIT_DEFINITIONS) as WallEdit[];

export function isWallEdit(value: string): value is WallEdit {
  return Object.prototype.hasOwnProperty.call(WALL_EDIT_DEFINITIONS, value);
}

export function wallEditDefinition(edit: WallEdit): WallEditDefinition {
  return WALL_EDIT_DEFINITIONS[edit];
}

/** The edit's tag deltas layered over a piece's base tags — pure, the one
 *  place edit semantics apply (catalog.effectiveTags and the bake both call
 *  through here so authored meaning and baked meaning cannot drift). */
export function applyWallEdit(base: BuildGameplayTags, edit: WallEdit): BuildGameplayTags {
  return { ...base, ...WALL_EDIT_DEFINITIONS[edit].overrides };
}

export function wallEditNamesForConsole(): string {
  return WALL_EDITS.join(', ');
}
