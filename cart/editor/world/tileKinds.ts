// Editor-owned semantic tile catalog.
import type { TileKind } from '../design';
import { EDITOR_TILE_TEXTURE_KEYS } from './tileTextureKeys';

export type TilePathingProfile = {
  walkable: boolean;
  movementCost: number;
  blocksLineOfSight: boolean;
};

export type TileCoverHeight = 'none' | 'low' | 'high' | 'full';

export type TileCoverProfile = {
  height: TileCoverHeight;
  protection: number;
  concealment: number;
  shootOver: boolean;
  leanAround: boolean;
  crouchRequired: boolean;
};

export type TileDoorProfile = {
  isDoor: boolean;
  defaultState: 'none' | 'open' | 'closed' | 'locked';
  interaction: 'none' | 'open' | 'unlock' | 'trigger';
  widthMeters: number;
  blocksMovementWhenClosed: boolean;
  blocksLineOfSightWhenClosed: boolean;
  vehiclePassable: boolean;
  openCost: number;
};

export type TileVisibilityProfile = {
  opacity: number;
  concealment: number;
  lightTransmission: number;
  soundOcclusion: number;
  blocksLineOfSight: boolean;
};

export type TileTraversalWidth = 'open' | 'narrow' | 'blocked';
export type TileTraversalMode = 'walk' | 'run' | 'drive' | 'swim' | 'mantle';

export type TileTraversalProfile = {
  allowedModes: TileTraversalMode[];
  width: TileTraversalWidth;
  maxStepUpMeters: number;
  minClearanceMeters: number;
  slopeLimitDegrees: number;
  requiresCrouch: boolean;
  requiresMantle: boolean;
  vehicleGripMultiplier: number;
};

export type TileNpcProfile = {
  traversable: boolean;
  walkCost: number;
  runCost: number;
  vehicleCost: number;
  preferredByVehicles: boolean;
  cover: 'none' | 'low' | 'high';
  noise: number;
};

export type TileSurfaceProfile = {
  material: 'water' | 'road' | 'concrete' | 'soil' | 'sand' | 'wall' | 'door' | 'dev';
  walkSpeedMultiplier: number;
  runSpeedMultiplier: number;
  vehicleSpeedMultiplier: number;
  accelerationMultiplier: number;
  friction: number;
  lateralGrip: number;
  restitution: number;
};

export type TileRenderProfile = {
  color: string;
  heightMeters: number;
  textureKey: string;
};

export type TileAltitudeProfile = {
  sample: 'heightfieldSurface' | 'cellBase';
  followsHeightfield: boolean;
  surfaceOffsetMeters: number;
};

// How a tile kind is allowed to enter the world — the registry is two things in
// one list, and this is what tells them apart:
//   'surface'  — a real paintable ground surface (water/road/sidewalk/…). These
//                are the only kinds the editor's tile palette should offer.
//   'embedded' — a gameplay profile that comes as a PROPERTY of something else
//                and is never freely placed: a building's wall (`wallTileKind`),
//                a solid prop's footprint (`tileKind`), a doorway, foliage. It
//                supplies cover / line-of-sight / friction, not a paint swatch.
//   'gameplay' — a single placed cell WITH identity that means something to the
//                game loop (spawn / save checkpoint). Not bulk-painted ground and
//                not a property of something else: authored one cell at a time in
//                the editor's MARKERS palette, lowered to a placedCell on compile.
//   'dev'      — debug-only (the cyan marker); not part of authored worlds.
export type TilePlacement = 'surface' | 'embedded' | 'gameplay' | 'dev';

export type TileKindDefinition = {
  kind: TileKind;
  placement: TilePlacement;
  label: string;
  pathing: TilePathingProfile;
  npc: TileNpcProfile;
  cover: TileCoverProfile;
  door: TileDoorProfile;
  visibility: TileVisibilityProfile;
  traversal: TileTraversalProfile;
  surface: TileSurfaceProfile;
  render: TileRenderProfile;
  altitude: TileAltitudeProfile;
};

const NO_COVER: TileCoverProfile = {
  height: 'none',
  protection: 0,
  concealment: 0,
  shootOver: false,
  leanAround: false,
  crouchRequired: false,
};

const LOW_COVER: TileCoverProfile = {
  height: 'low',
  protection: 0.35,
  concealment: 0.3,
  shootOver: true,
  leanAround: true,
  crouchRequired: true,
};

const FULL_COVER: TileCoverProfile = {
  height: 'full',
  protection: 1,
  concealment: 1,
  shootOver: false,
  leanAround: true,
  crouchRequired: false,
};

const NO_DOOR: TileDoorProfile = {
  isDoor: false,
  defaultState: 'none',
  interaction: 'none',
  widthMeters: 0,
  blocksMovementWhenClosed: false,
  blocksLineOfSightWhenClosed: false,
  vehiclePassable: false,
  openCost: 0,
};

const OPEN_VISIBILITY: TileVisibilityProfile = {
  opacity: 0,
  concealment: 0,
  lightTransmission: 1,
  soundOcclusion: 0,
  blocksLineOfSight: false,
};

const BLOCKED_VISIBILITY: TileVisibilityProfile = {
  opacity: 1,
  concealment: 1,
  lightTransmission: 0,
  soundOcclusion: 0.82,
  blocksLineOfSight: true,
};

const OPEN_TRAVERSAL: TileTraversalProfile = {
  allowedModes: ['walk', 'run', 'drive'],
  width: 'open',
  maxStepUpMeters: 0.35,
  minClearanceMeters: 2.1,
  slopeLimitDegrees: 38,
  requiresCrouch: false,
  requiresMantle: false,
  vehicleGripMultiplier: 1,
};

const PEDESTRIAN_TRAVERSAL: TileTraversalProfile = {
  ...OPEN_TRAVERSAL,
  allowedModes: ['walk', 'run'],
  vehicleGripMultiplier: 0,
};

const BLOCKED_TRAVERSAL: TileTraversalProfile = {
  allowedModes: [],
  width: 'blocked',
  maxStepUpMeters: 0,
  minClearanceMeters: 0,
  slopeLimitDegrees: 0,
  requiresCrouch: false,
  requiresMantle: false,
  vehicleGripMultiplier: 0,
};

const HEIGHTFIELD_ALTITUDE: TileAltitudeProfile = {
  sample: 'heightfieldSurface',
  followsHeightfield: true,
  surfaceOffsetMeters: 0,
};

const CELL_BASE_ALTITUDE: TileAltitudeProfile = {
  sample: 'cellBase',
  followsHeightfield: false,
  surfaceOffsetMeters: 0,
};

// One definition per lane flow direction — identical drivable profile, the
// NAME is the data (host pathing maps kind -> flow; see design.ts TileKind).
// vehicleCost undercuts plain road so vehicle A* prefers the painted lane
// line over the shoulder tiles beside it.
function laneKindDefinition(kind: TileKind, label: string): TileKindDefinition {
  return {
    kind,
    placement: 'surface',
    label,
    pathing: { walkable: true, movementCost: 0.95, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.02, runCost: 1.0, vehicleCost: 0.6, preferredByVehicles: true, cover: 'none', noise: 0.7 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 1 },
    surface: { material: 'road', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.18, lateralGrip: 0.92, restitution: 0.84 },
    render: { color: '#232936', heightMeters: 0.08, textureKey: EDITOR_TILE_TEXTURE_KEYS.road },
    altitude: HEIGHTFIELD_ALTITUDE,
  };
}

export const TILE_KIND_DEFINITIONS: Record<TileKind, TileKindDefinition> = {
  water: {
    kind: 'water',
    placement: 'surface',
    label: 'Water',
    pathing: { walkable: false, movementCost: Infinity, blocksLineOfSight: false },
    npc: { traversable: false, walkCost: Infinity, runCost: Infinity, vehicleCost: Infinity, preferredByVehicles: false, cover: 'none', noise: 0.15 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: { ...OPEN_VISIBILITY, opacity: 0.05, concealment: 0.1, lightTransmission: 0.88, soundOcclusion: 0.18 },
    traversal: { ...BLOCKED_TRAVERSAL, allowedModes: ['swim'], width: 'open', vehicleGripMultiplier: 0 },
    surface: { material: 'water', walkSpeedMultiplier: 0.42, runSpeedMultiplier: 0.28, vehicleSpeedMultiplier: 0, accelerationMultiplier: 0.35, friction: 0.96, lateralGrip: 0.22, restitution: 0.02 },
    render: { color: '#4ea0df', heightMeters: 0.02, textureKey: EDITOR_TILE_TEXTURE_KEYS.water },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  road: {
    kind: 'road',
    placement: 'surface',
    label: 'Road',
    pathing: { walkable: true, movementCost: 0.95, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.02, runCost: 1.0, vehicleCost: 0.72, preferredByVehicles: true, cover: 'none', noise: 0.7 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 1 },
    surface: { material: 'road', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.18, lateralGrip: 0.92, restitution: 0.84 },
    render: { color: '#1f2530', heightMeters: 0.08, textureKey: EDITOR_TILE_TEXTURE_KEYS.road },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  asphalt: {
    kind: 'asphalt',
    placement: 'surface',
    label: 'Asphalt',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.05, runCost: 1.0, vehicleCost: 0.78, preferredByVehicles: true, cover: 'none', noise: 0.65 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 0.95 },
    surface: { material: 'road', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 0.95, accelerationMultiplier: 1.0, friction: 0.2, lateralGrip: 0.9, restitution: 0.82 },
    render: { color: '#20242d', heightMeters: 0.08, textureKey: EDITOR_TILE_TEXTURE_KEYS.asphalt },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  sidewalk: {
    kind: 'sidewalk',
    placement: 'surface',
    label: 'Sidewalk',
    pathing: { walkable: true, movementCost: 1.08, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.05, vehicleCost: 1.8, preferredByVehicles: false, cover: 'none', noise: 0.4 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 0.55 },
    surface: { material: 'concrete', walkSpeedMultiplier: 0.98, runSpeedMultiplier: 0.96, vehicleSpeedMultiplier: 0.55, accelerationMultiplier: 0.96, friction: 0.24, lateralGrip: 0.86, restitution: 0.78 },
    render: { color: '#596170', heightMeters: 0.11, textureKey: EDITOR_TILE_TEXTURE_KEYS.sidewalk },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  mud: {
    kind: 'mud',
    placement: 'surface',
    label: 'Mud',
    pathing: { walkable: true, movementCost: 2.1, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 2.15, runCost: 2.65, vehicleCost: 3.2, preferredByVehicles: false, cover: 'low', noise: 0.25 },
    cover: LOW_COVER,
    door: NO_DOOR,
    visibility: { ...OPEN_VISIBILITY, concealment: 0.18, lightTransmission: 0.94, soundOcclusion: 0.08 },
    traversal: { ...OPEN_TRAVERSAL, maxStepUpMeters: 0.24, slopeLimitDegrees: 24, vehicleGripMultiplier: 0.38 },
    surface: { material: 'soil', walkSpeedMultiplier: 0.68, runSpeedMultiplier: 0.52, vehicleSpeedMultiplier: 0.38, accelerationMultiplier: 0.45, friction: 0.86, lateralGrip: 0.55, restitution: 0.16 },
    render: { color: '#5b4636', heightMeters: 0.075, textureKey: EDITOR_TILE_TEXTURE_KEYS.mud },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  sand: {
    kind: 'sand',
    placement: 'surface',
    label: 'Sand',
    pathing: { walkable: true, movementCost: 1.7, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.7, runCost: 2.05, vehicleCost: 2.45, preferredByVehicles: false, cover: 'none', noise: 0.35 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: { ...OPEN_VISIBILITY, concealment: 0.1, lightTransmission: 0.96, soundOcclusion: 0.05 },
    traversal: { ...OPEN_TRAVERSAL, maxStepUpMeters: 0.26, slopeLimitDegrees: 28, vehicleGripMultiplier: 0.48 },
    surface: { material: 'sand', walkSpeedMultiplier: 0.78, runSpeedMultiplier: 0.62, vehicleSpeedMultiplier: 0.48, accelerationMultiplier: 0.58, friction: 0.74, lateralGrip: 0.45, restitution: 0.12 },
    render: { color: '#c8b66f', heightMeters: 0.075, textureKey: EDITOR_TILE_TEXTURE_KEYS.sand },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  wall: {
    kind: 'wall',
    placement: 'embedded',
    label: 'Wall',
    pathing: { walkable: false, movementCost: Infinity, blocksLineOfSight: true },
    npc: { traversable: false, walkCost: Infinity, runCost: Infinity, vehicleCost: Infinity, preferredByVehicles: false, cover: 'high', noise: 1.0 },
    cover: FULL_COVER,
    door: NO_DOOR,
    visibility: BLOCKED_VISIBILITY,
    traversal: BLOCKED_TRAVERSAL,
    surface: { material: 'wall', walkSpeedMultiplier: 0, runSpeedMultiplier: 0, vehicleSpeedMultiplier: 0, accelerationMultiplier: 0, friction: 0.5, lateralGrip: 0, restitution: 0.45 },
    render: { color: '#cbd5e1', heightMeters: 1.6, textureKey: EDITOR_TILE_TEXTURE_KEYS.wall },
    altitude: CELL_BASE_ALTITUDE,
  },
  door: {
    kind: 'door',
    placement: 'embedded',
    label: 'Door',
    pathing: { walkable: true, movementCost: 1.25, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.35, runCost: 1.5, vehicleCost: Infinity, preferredByVehicles: false, cover: 'low', noise: 0.8 },
    cover: { ...LOW_COVER, protection: 0.28, concealment: 0.45, shootOver: false },
    door: {
      isDoor: true,
      defaultState: 'open',
      interaction: 'trigger',
      widthMeters: 1,
      blocksMovementWhenClosed: true,
      blocksLineOfSightWhenClosed: true,
      vehiclePassable: false,
      openCost: 0.45,
    },
    visibility: { ...OPEN_VISIBILITY, opacity: 0.12, concealment: 0.25, lightTransmission: 0.72, soundOcclusion: 0.36 },
    traversal: { ...PEDESTRIAN_TRAVERSAL, width: 'narrow', minClearanceMeters: 2.05, vehicleGripMultiplier: 0 },
    surface: { material: 'door', walkSpeedMultiplier: 0.82, runSpeedMultiplier: 0.74, vehicleSpeedMultiplier: 0, accelerationMultiplier: 0.75, friction: 0.42, lateralGrip: 0.7, restitution: 0.42 },
    render: { color: '#f59e0b', heightMeters: 1.2, textureKey: EDITOR_TILE_TEXTURE_KEYS.door },
    altitude: CELL_BASE_ALTITUDE,
  },
  bush: {
    kind: 'bush',
    placement: 'embedded',
    label: 'Bush',
    // GTA-style foliage: you walk straight into it (non-solid), it rustles, and
    // it hides you without stopping a bullet. So it is walkable with high
    // concealment but near-zero protection, and it dims line of sight without
    // fully blocking it. Vehicles do not path through it.
    pathing: { walkable: true, movementCost: 1.18, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.2, runCost: 1.3, vehicleCost: Infinity, preferredByVehicles: false, cover: 'high', noise: 0.6 },
    cover: { height: 'high', protection: 0.1, concealment: 0.82, shootOver: false, leanAround: true, crouchRequired: false },
    door: NO_DOOR,
    visibility: { opacity: 0.5, concealment: 0.82, lightTransmission: 0.6, soundOcclusion: 0.2, blocksLineOfSight: false },
    traversal: { ...PEDESTRIAN_TRAVERSAL, maxStepUpMeters: 0.3 },
    surface: { material: 'soil', walkSpeedMultiplier: 0.9, runSpeedMultiplier: 0.84, vehicleSpeedMultiplier: 0, accelerationMultiplier: 0.85, friction: 0.5, lateralGrip: 0.7, restitution: 0.2 },
    render: { color: '#2f6b35', heightMeters: 0.05, textureKey: EDITOR_TILE_TEXTURE_KEYS.bush },
    altitude: CELL_BASE_ALTITUDE,
  },
  marker: {
    kind: 'marker',
    placement: 'dev',
    label: 'Marker',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.0, vehicleCost: 1.0, preferredByVehicles: false, cover: 'none', noise: 0.0 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: OPEN_TRAVERSAL,
    surface: { material: 'dev', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.2, lateralGrip: 0.9, restitution: 0.8 },
    render: { color: '#22d3ee', heightMeters: 0.095, textureKey: EDITOR_TILE_TEXTURE_KEYS.marker },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // Where the player (re)appears. Ordinary walkable ground underneath a marker
  // look — physics treats it like a normal flat surface so standing/spawning on
  // it feels like any other tile.
  spawn: {
    kind: 'spawn',
    placement: 'gameplay',
    label: 'Spawn Point',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.0, vehicleCost: 1.0, preferredByVehicles: false, cover: 'none', noise: 0.0 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: OPEN_TRAVERSAL,
    surface: { material: 'dev', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.2, lateralGrip: 0.9, restitution: 0.8 },
    render: { color: '#22c55e', heightMeters: 0.05, textureKey: EDITOR_TILE_TEXTURE_KEYS.spawn },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // A save checkpoint. Stepping on it persists the game and arms the respawn at
  // its paired spawn cell (PlacedCell.spawnKey). Walkable, marker look.
  save: {
    kind: 'save',
    placement: 'gameplay',
    label: 'Save Point',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.0, vehicleCost: 1.0, preferredByVehicles: false, cover: 'none', noise: 0.0 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: OPEN_TRAVERSAL,
    surface: { material: 'dev', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.2, lateralGrip: 0.9, restitution: 0.8 },
    render: { color: '#a855f7', heightMeters: 0.05, textureKey: EDITOR_TILE_TEXTURE_KEYS.save },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // ── directional lanes + the junction resolver (see design.ts TileKind) ────
  // Appended LAST so existing kind indices stay stable for any session-scoped
  // index-keyed grid (host pathing ships kind indices in TILE_KINDS order).
  laneNorth: laneKindDefinition('laneNorth', 'Lane (north, -Z)'),
  laneSouth: laneKindDefinition('laneSouth', 'Lane (south, +Z)'),
  laneEast: laneKindDefinition('laneEast', 'Lane (east, +X)'),
  laneWest: laneKindDefinition('laneWest', 'Lane (west, -X)'),
  junction: {
    kind: 'junction',
    placement: 'surface',
    label: 'Junction',
    pathing: { walkable: true, movementCost: 0.95, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.04, runCost: 1.0, vehicleCost: 0.7, preferredByVehicles: true, cover: 'none', noise: 0.7 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 1 },
    surface: { material: 'road', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.18, lateralGrip: 0.92, restitution: 0.84 },
    render: { color: '#272c37', heightMeters: 0.08, textureKey: EDITOR_TILE_TEXTURE_KEYS.road },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // The zebra crossing (see design.ts) — drivable like road, pleasantly
  // walkable so pedestrian cost shaping funnels every road crossing here.
  crosswalk: {
    kind: 'crosswalk',
    placement: 'surface',
    label: 'Crosswalk',
    pathing: { walkable: true, movementCost: 0.95, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 0.9, runCost: 0.95, vehicleCost: 0.75, preferredByVehicles: false, cover: 'none', noise: 0.55 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 1 },
    surface: { material: 'road', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.19, lateralGrip: 0.92, restitution: 0.84 },
    render: { color: '#3a4250', heightMeters: 0.085, textureKey: EDITOR_TILE_TEXTURE_KEYS.road },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // The double-yellow centerline strip between opposing lane groups (stamped by
  // the road-stroke painter, ROADSTROKE-0610). Walkable — jaywalking across is
  // legal pathing — but vehicleCost prices out driving ALONG it: crossing one
  // cell to turn adds ~6, driving 100m down the middle adds ~600 vs ~60 on a
  // lane. That per-cell tax closes the flow-less-drivable wrong-way loophole
  // a cheap neutral center tile would open.
  median: {
    kind: 'median',
    placement: 'surface',
    label: 'Median (centerline)',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.3, runCost: 1.35, vehicleCost: 6.0, preferredByVehicles: false, cover: 'none', noise: 0.7 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 1 },
    surface: { material: 'road', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.18, lateralGrip: 0.92, restitution: 0.84 },
    render: { color: '#46431f', heightMeters: 0.085, textureKey: EDITOR_TILE_TEXTURE_KEYS.median },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // ── living ground: plain lawn surface. Growth is flora, not ground. ────────
  grass: {
    kind: 'grass',
    placement: 'surface',
    label: 'Grass',
    pathing: { walkable: true, movementCost: 1.15, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.12, runCost: 1.1, vehicleCost: 1.9, preferredByVehicles: false, cover: 'none', noise: 0.2 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: { ...OPEN_VISIBILITY, concealment: 0.12, lightTransmission: 0.97, soundOcclusion: 0.04 },
    traversal: { ...OPEN_TRAVERSAL, maxStepUpMeters: 0.28, slopeLimitDegrees: 30, vehicleGripMultiplier: 0.5 },
    surface: { material: 'soil', walkSpeedMultiplier: 0.95, runSpeedMultiplier: 0.92, vehicleSpeedMultiplier: 0.5, accelerationMultiplier: 0.7, friction: 0.6, lateralGrip: 0.6, restitution: 0.2 },
    render: { color: '#3f7d33', heightMeters: 0.06, textureKey: EDITOR_TILE_TEXTURE_KEYS.grass },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // ── parking + vehicle spawn (PARKSPAWN-0612, req_0694) — appended LAST ─────
  // Painted parking-lot ground: asphalt that wears white stall lines (the tile
  // surface shaders draw 3m bays). Drivable but priced as a destination, not a
  // thoroughfare — vehicles path in to park, never through as a shortcut.
  parking: {
    kind: 'parking',
    placement: 'surface',
    label: 'Parking',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.05, runCost: 1.0, vehicleCost: 1.4, preferredByVehicles: false, cover: 'none', noise: 0.6 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 0.95 },
    surface: { material: 'road', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 0.85, accelerationMultiplier: 0.95, friction: 0.2, lateralGrip: 0.9, restitution: 0.82 },
    render: { color: '#2a2f3a', heightMeters: 0.08, textureKey: EDITOR_TILE_TEXTURE_KEYS.parking },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // Where the traffic system may materialize a vehicle. Ordinary drivable
  // ground under a marker look; WHICH vehicle is the garage's per-style
  // spawnRate weighting (editors/vehicles), not the cell's business.
  vehicleSpawn: {
    kind: 'vehicleSpawn',
    placement: 'gameplay',
    label: 'Vehicle Spawn',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.0, vehicleCost: 1.0, preferredByVehicles: false, cover: 'none', noise: 0.0 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: OPEN_TRAVERSAL,
    surface: { material: 'dev', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.2, lateralGrip: 0.9, restitution: 0.8 },
    render: { color: '#f97316', heightMeters: 0.05, textureKey: EDITOR_TILE_TEXTURE_KEYS.vehicleSpawn },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // Parking rotated 90° (req_0710): identical lot ground to 'parking', its bay
  // lines just run the perpendicular axis (the tile surface shaders branch the
  // stall direction on the kind). Appended LAST — indices stay stable.
  parkingCross: {
    kind: 'parkingCross',
    placement: 'surface',
    label: 'Parking ⟂',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.05, runCost: 1.0, vehicleCost: 1.4, preferredByVehicles: false, cover: 'none', noise: 0.6 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 0.95 },
    surface: { material: 'road', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 0.85, accelerationMultiplier: 0.95, friction: 0.2, lateralGrip: 0.9, restitution: 0.82 },
    render: { color: '#2a2f3a', heightMeters: 0.08, textureKey: EDITOR_TILE_TEXTURE_KEYS.parkingCross },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
};

export const TILE_KINDS = Object.keys(TILE_KIND_DEFINITIONS) as TileKind[];

// The kinds a user may actually paint as ground — the editor's tile palette
// reads THIS, not the raw registry, so embedded profiles (wall/door/bush) and
// dev markers never show up as if they were placeable surfaces.
export const PAINTABLE_TILE_KINDS = TILE_KINDS.filter(
  (k) => TILE_KIND_DEFINITIONS[k].placement === 'surface',
);

// Embedded profiles — the kinds that come as a property of something else
// (wall/door/bush) and are never freely painted. The editor lists these in a
// separate "Embedded Tiles" group so they're inspectable without polluting the
// paint palette. Mirror of PAINTABLE_TILE_KINDS.
export const EMBEDDED_TILE_KINDS = TILE_KINDS.filter(
  (k) => TILE_KIND_DEFINITIONS[k].placement === 'embedded',
);

// Gameplay markers (spawn/save) — single placed cells with identity. The editor
// lists these in their own MARKERS palette; they are placed one cell at a time
// (not bulk-painted), and a save cell links to a spawn cell it respawns you at.
export const GAMEPLAY_TILE_KINDS = TILE_KINDS.filter(
  (k) => TILE_KIND_DEFINITIONS[k].placement === 'gameplay',
);

export function isTileKind(value: string): value is TileKind {
  return Object.prototype.hasOwnProperty.call(TILE_KIND_DEFINITIONS, value);
}

export function tileKindDefinition(kind: TileKind): TileKindDefinition {
  return TILE_KIND_DEFINITIONS[kind];
}

export function tileKindNamesForConsole(): string {
  return TILE_KINDS.join(', ');
}
