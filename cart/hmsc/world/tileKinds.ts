import type { TileKind } from '../design';
import { HMSC_TILE_TEXTURE_KEYS } from './tileTextureKeys';

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
  material: 'water' | 'district' | 'road' | 'concrete' | 'soil' | 'sand' | 'wall' | 'door' | 'dev';
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

export type TileKindDefinition = {
  kind: TileKind;
  label: string;
  pathing: TilePathingProfile;
  npc: TileNpcProfile;
  cover: TileCoverProfile;
  door: TileDoorProfile;
  visibility: TileVisibilityProfile;
  traversal: TileTraversalProfile;
  surface: TileSurfaceProfile;
  render: TileRenderProfile;
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

const HIGH_COVER: TileCoverProfile = {
  height: 'high',
  protection: 0.72,
  concealment: 0.68,
  shootOver: false,
  leanAround: true,
  crouchRequired: false,
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

const DISTRICT_VISIBILITY: TileVisibilityProfile = {
  opacity: 0.15,
  concealment: 0.25,
  lightTransmission: 0.82,
  soundOcclusion: 0.16,
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

export const TILE_KIND_DEFINITIONS: Record<TileKind, TileKindDefinition> = {
  water: {
    kind: 'water',
    label: 'Water',
    pathing: { walkable: false, movementCost: Infinity, blocksLineOfSight: false },
    npc: { traversable: false, walkCost: Infinity, runCost: Infinity, vehicleCost: Infinity, preferredByVehicles: false, cover: 'none', noise: 0.15 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: { ...OPEN_VISIBILITY, opacity: 0.05, concealment: 0.1, lightTransmission: 0.88, soundOcclusion: 0.18 },
    traversal: { ...BLOCKED_TRAVERSAL, allowedModes: ['swim'], width: 'open', vehicleGripMultiplier: 0 },
    surface: { material: 'water', walkSpeedMultiplier: 0.42, runSpeedMultiplier: 0.28, vehicleSpeedMultiplier: 0, accelerationMultiplier: 0.35, friction: 0.96, lateralGrip: 0.22, restitution: 0.02 },
    render: { color: '#4ea0df', heightMeters: 0.02, textureKey: HMSC_TILE_TEXTURE_KEYS.water },
  },
  residential: {
    kind: 'residential',
    label: 'Residential District',
    pathing: { walkable: true, movementCost: 1.06, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.04, vehicleCost: 1.1, preferredByVehicles: false, cover: 'low', noise: 0.55 },
    cover: LOW_COVER,
    door: NO_DOOR,
    visibility: DISTRICT_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 0.82 },
    surface: { material: 'district', walkSpeedMultiplier: 0.98, runSpeedMultiplier: 0.95, vehicleSpeedMultiplier: 0.82, accelerationMultiplier: 0.95, friction: 0.28, lateralGrip: 0.82, restitution: 0.72 },
    render: { color: '#184a68', heightMeters: 0.11, textureKey: HMSC_TILE_TEXTURE_KEYS.residential },
  },
  downtown: {
    kind: 'downtown',
    label: 'Downtown District',
    pathing: { walkable: true, movementCost: 1.28, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.25, runCost: 1.34, vehicleCost: 1.25, preferredByVehicles: false, cover: 'high', noise: 0.95 },
    cover: HIGH_COVER,
    door: NO_DOOR,
    visibility: { ...DISTRICT_VISIBILITY, opacity: 0.28, concealment: 0.42, lightTransmission: 0.68, soundOcclusion: 0.28 },
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 0.72 },
    surface: { material: 'district', walkSpeedMultiplier: 0.92, runSpeedMultiplier: 0.88, vehicleSpeedMultiplier: 0.72, accelerationMultiplier: 0.86, friction: 0.34, lateralGrip: 0.76, restitution: 0.68 },
    render: { color: '#662f32', heightMeters: 0.13, textureKey: HMSC_TILE_TEXTURE_KEYS.downtown },
  },
  mixed: {
    kind: 'mixed',
    label: 'Dense Mixed District',
    pathing: { walkable: true, movementCost: 1.16, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.12, runCost: 1.18, vehicleCost: 1.35, preferredByVehicles: false, cover: 'low', noise: 0.72 },
    cover: LOW_COVER,
    door: NO_DOOR,
    visibility: { ...DISTRICT_VISIBILITY, opacity: 0.22, concealment: 0.36, lightTransmission: 0.74, soundOcclusion: 0.24 },
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 0.68 },
    surface: { material: 'district', walkSpeedMultiplier: 0.95, runSpeedMultiplier: 0.9, vehicleSpeedMultiplier: 0.68, accelerationMultiplier: 0.9, friction: 0.32, lateralGrip: 0.78, restitution: 0.7 },
    render: { color: '#064414', heightMeters: 0.12, textureKey: HMSC_TILE_TEXTURE_KEYS.mixed },
  },
  road: {
    kind: 'road',
    label: 'Road',
    pathing: { walkable: true, movementCost: 0.95, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.02, runCost: 1.0, vehicleCost: 0.72, preferredByVehicles: true, cover: 'none', noise: 0.7 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 1 },
    surface: { material: 'road', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.18, lateralGrip: 0.92, restitution: 0.84 },
    render: { color: '#1f2530', heightMeters: 0.08, textureKey: HMSC_TILE_TEXTURE_KEYS.road },
  },
  asphalt: {
    kind: 'asphalt',
    label: 'Asphalt',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.05, runCost: 1.0, vehicleCost: 0.78, preferredByVehicles: true, cover: 'none', noise: 0.65 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 0.95 },
    surface: { material: 'road', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 0.95, accelerationMultiplier: 1.0, friction: 0.2, lateralGrip: 0.9, restitution: 0.82 },
    render: { color: '#20242d', heightMeters: 0.08, textureKey: HMSC_TILE_TEXTURE_KEYS.asphalt },
  },
  sidewalk: {
    kind: 'sidewalk',
    label: 'Sidewalk',
    pathing: { walkable: true, movementCost: 1.08, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.05, vehicleCost: 1.8, preferredByVehicles: false, cover: 'none', noise: 0.4 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 0.55 },
    surface: { material: 'concrete', walkSpeedMultiplier: 0.98, runSpeedMultiplier: 0.96, vehicleSpeedMultiplier: 0.55, accelerationMultiplier: 0.96, friction: 0.24, lateralGrip: 0.86, restitution: 0.78 },
    render: { color: '#596170', heightMeters: 0.11, textureKey: HMSC_TILE_TEXTURE_KEYS.sidewalk },
  },
  mud: {
    kind: 'mud',
    label: 'Mud',
    pathing: { walkable: true, movementCost: 2.1, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 2.15, runCost: 2.65, vehicleCost: 3.2, preferredByVehicles: false, cover: 'low', noise: 0.25 },
    cover: LOW_COVER,
    door: NO_DOOR,
    visibility: { ...OPEN_VISIBILITY, concealment: 0.18, lightTransmission: 0.94, soundOcclusion: 0.08 },
    traversal: { ...OPEN_TRAVERSAL, maxStepUpMeters: 0.24, slopeLimitDegrees: 24, vehicleGripMultiplier: 0.38 },
    surface: { material: 'soil', walkSpeedMultiplier: 0.68, runSpeedMultiplier: 0.52, vehicleSpeedMultiplier: 0.38, accelerationMultiplier: 0.45, friction: 0.86, lateralGrip: 0.55, restitution: 0.16 },
    render: { color: '#5b4636', heightMeters: 0.075, textureKey: HMSC_TILE_TEXTURE_KEYS.mud },
  },
  sand: {
    kind: 'sand',
    label: 'Sand',
    pathing: { walkable: true, movementCost: 1.7, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.7, runCost: 2.05, vehicleCost: 2.45, preferredByVehicles: false, cover: 'none', noise: 0.35 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: { ...OPEN_VISIBILITY, concealment: 0.1, lightTransmission: 0.96, soundOcclusion: 0.05 },
    traversal: { ...OPEN_TRAVERSAL, maxStepUpMeters: 0.26, slopeLimitDegrees: 28, vehicleGripMultiplier: 0.48 },
    surface: { material: 'sand', walkSpeedMultiplier: 0.78, runSpeedMultiplier: 0.62, vehicleSpeedMultiplier: 0.48, accelerationMultiplier: 0.58, friction: 0.74, lateralGrip: 0.45, restitution: 0.12 },
    render: { color: '#c8b66f', heightMeters: 0.075, textureKey: HMSC_TILE_TEXTURE_KEYS.sand },
  },
  wall: {
    kind: 'wall',
    label: 'Wall',
    pathing: { walkable: false, movementCost: Infinity, blocksLineOfSight: true },
    npc: { traversable: false, walkCost: Infinity, runCost: Infinity, vehicleCost: Infinity, preferredByVehicles: false, cover: 'high', noise: 1.0 },
    cover: FULL_COVER,
    door: NO_DOOR,
    visibility: BLOCKED_VISIBILITY,
    traversal: BLOCKED_TRAVERSAL,
    surface: { material: 'wall', walkSpeedMultiplier: 0, runSpeedMultiplier: 0, vehicleSpeedMultiplier: 0, accelerationMultiplier: 0, friction: 0.5, lateralGrip: 0, restitution: 0.45 },
    render: { color: '#cbd5e1', heightMeters: 1.6, textureKey: HMSC_TILE_TEXTURE_KEYS.wall },
  },
  door: {
    kind: 'door',
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
    render: { color: '#f59e0b', heightMeters: 1.2, textureKey: HMSC_TILE_TEXTURE_KEYS.door },
  },
  marker: {
    kind: 'marker',
    label: 'Marker',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.0, vehicleCost: 1.0, preferredByVehicles: false, cover: 'none', noise: 0.0 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: OPEN_TRAVERSAL,
    surface: { material: 'dev', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.2, lateralGrip: 0.9, restitution: 0.8 },
    render: { color: '#22d3ee', heightMeters: 0.095, textureKey: HMSC_TILE_TEXTURE_KEYS.marker },
  },
};

export const TILE_KINDS = Object.keys(TILE_KIND_DEFINITIONS) as TileKind[];

export function isTileKind(value: string): value is TileKind {
  return Object.prototype.hasOwnProperty.call(TILE_KIND_DEFINITIONS, value);
}

export function tileKindDefinition(kind: TileKind): TileKindDefinition {
  return TILE_KIND_DEFINITIONS[kind];
}

export function tileKindNamesForConsole(): string {
  return TILE_KINDS.join(', ');
}
