// game/kinds — THE DOOR (P3). The kind registries are the V4 ground floor's
// data layer: kind → meaning tables for tiles, props, NPCs (kind + faction),
// roles, and landforms. Consumers import from HERE (or receive GAME_KINDS via
// game/index.ts); they never reach into the family files.
//
// The road grammar carried by the tile table is LOCKED (lane trios, junction
// tiles, crosswalks) — see ./tiles.ts. The tables ARE the data (P2): tuning a
// kind is editing its table entry, never a constant in logic.

export {
  TILE_KIND_DEFINITIONS,
  TILE_KINDS,
  TILE_KIND_INDEX,
  TILE_FLOW_VECTORS,
  PAINTABLE_TILE_KINDS,
  EMBEDDED_TILE_KINDS,
  GAMEPLAY_TILE_KINDS,
  isTileKind,
  tileKindDefinition,
  tileFlowVector,
  tileKindNamesForConsole,
} from './tiles';
export type {
  TileKind,
  TilePlacement,
  TileFlow,
  TileKindDefinition,
  TilePathingProfile,
  TileNpcProfile,
  TileCoverProfile,
  TileCoverHeight,
  TileDoorProfile,
  TileVisibilityProfile,
  TileTraversalProfile,
  TileTraversalMode,
  TileTraversalWidth,
  TileSurfaceProfile,
  TileSurfaceMaterial,
  TileRenderProfile,
  TileAltitudeProfile,
} from './tiles';

export {
  PROP_KIND_DEFINITIONS,
  PROP_KINDS,
  isPropKind,
  propContainer,
  propCoverClass,
  propDynamics,
  propKindDefinition,
  propKindNamesForConsole,
  propMount,
  propSeat,
} from './props';
export type {
  PropContainer, PropContainerAccess, PropCoverClass, PropDynamics, PropKind,
  PropKindDefinition, PropLootCategory, PropMount, PropSeat, PropTrafficControl,
} from './props';

export {
  NPC_KIND_DEFINITIONS,
  NPC_KINDS,
  FACTION_REGARD,
  isNpcKind,
  npcKindDefinition,
  npcKindNamesForConsole,
  factionRegard,
  isHostileTo,
} from './npcs';
export type {
  NpcKind,
  NpcFaction,
  NpcKindDefinition,
  NpcPerceptionProfile,
  RegardTarget,
  FactionRegard,
} from './npcs';

export {
  NPC_ROLE_DEFINITIONS,
  NPC_ROLES,
  DEFAULT_NPC_ROLE,
  npcRole,
  isNpcRole,
  npcRoleNamesForConsole,
} from './roles';
export type { NpcRoleDefinition } from './roles';

export {
  LANDFORM_KIND_DEFINITIONS,
  LANDFORM_KINDS,
  LANDFORM_TUNING,
  registerLandformKind,
  landformKindDefinition,
  landformKindNamesForConsole,
  landformSurfaceTop,
  landformRoadHalfWidth,
  landformRoadCenterline,
  mountainCraterLake,
  mountainTrailheadPoint,
} from './landforms';
export type { LandformKindDefinition, LandformInstance, LandformField } from './landforms';

import {
  TILE_KIND_DEFINITIONS,
  TILE_KINDS,
  TILE_KIND_INDEX,
  TILE_FLOW_VECTORS,
  PAINTABLE_TILE_KINDS,
  EMBEDDED_TILE_KINDS,
  GAMEPLAY_TILE_KINDS,
  isTileKind,
  tileKindDefinition,
  tileFlowVector,
} from './tiles';
import { PROP_KIND_DEFINITIONS, PROP_KINDS, isPropKind, propKindDefinition } from './props';
import {
  NPC_KIND_DEFINITIONS,
  NPC_KINDS,
  FACTION_REGARD,
  isNpcKind,
  npcKindDefinition,
  factionRegard,
  isHostileTo,
} from './npcs';
import { NPC_ROLE_DEFINITIONS, NPC_ROLES, DEFAULT_NPC_ROLE, npcRole, isNpcRole } from './roles';
import {
  LANDFORM_KIND_DEFINITIONS,
  LANDFORM_KINDS,
  LANDFORM_TUNING,
  registerLandformKind,
  landformKindDefinition,
  landformSurfaceTop,
} from './landforms';

// The V14/V17 ground-floor handle: `import { GAME_KINDS } from '@game'`.
// One object, five families; the same tables the named exports carry.
export const GAME_KINDS = {
  tiles: {
    definitions: TILE_KIND_DEFINITIONS,
    kinds: TILE_KINDS,
    index: TILE_KIND_INDEX,
    flowVectors: TILE_FLOW_VECTORS,
    paintable: PAINTABLE_TILE_KINDS,
    embedded: EMBEDDED_TILE_KINDS,
    gameplay: GAMEPLAY_TILE_KINDS,
    is: isTileKind,
    get: tileKindDefinition,
    flowVector: tileFlowVector,
  },
  props: {
    definitions: PROP_KIND_DEFINITIONS,
    kinds: PROP_KINDS,
    is: isPropKind,
    get: propKindDefinition,
  },
  npcs: {
    definitions: NPC_KIND_DEFINITIONS,
    kinds: NPC_KINDS,
    is: isNpcKind,
    get: npcKindDefinition,
    regardMatrix: FACTION_REGARD,
    factionRegard,
    isHostileTo,
  },
  roles: {
    definitions: NPC_ROLE_DEFINITIONS,
    roles: NPC_ROLES,
    defaultRole: DEFAULT_NPC_ROLE,
    is: isNpcRole,
    get: npcRole,
  },
  landforms: {
    definitions: LANDFORM_KIND_DEFINITIONS,
    kinds: LANDFORM_KINDS,
    tuning: LANDFORM_TUNING,
    get: landformKindDefinition,
    register: registerLandformKind,
    surfaceTop: landformSurfaceTop,
  },
} as const;
