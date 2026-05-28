import type { TileKind } from '../design';

export type TilePathingProfile = {
  walkable: boolean;
  movementCost: number;
  blocksLineOfSight: boolean;
};

export type TileRenderProfile = {
  color: string;
  heightMeters: number;
};

export type TileKindDefinition = {
  kind: TileKind;
  label: string;
  pathing: TilePathingProfile;
  render: TileRenderProfile;
};

export const TILE_KIND_DEFINITIONS: Record<TileKind, TileKindDefinition> = {
  asphalt: {
    kind: 'asphalt',
    label: 'Asphalt',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    render: { color: '#20242d', heightMeters: 0.08 },
  },
  sidewalk: {
    kind: 'sidewalk',
    label: 'Sidewalk',
    pathing: { walkable: true, movementCost: 1.08, blocksLineOfSight: false },
    render: { color: '#596170', heightMeters: 0.11 },
  },
  wall: {
    kind: 'wall',
    label: 'Wall',
    pathing: { walkable: false, movementCost: Infinity, blocksLineOfSight: true },
    render: { color: '#cbd5e1', heightMeters: 1.6 },
  },
  door: {
    kind: 'door',
    label: 'Door',
    pathing: { walkable: true, movementCost: 1.25, blocksLineOfSight: false },
    render: { color: '#f59e0b', heightMeters: 1.2 },
  },
  marker: {
    kind: 'marker',
    label: 'Marker',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    render: { color: '#22d3ee', heightMeters: 0.095 },
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
