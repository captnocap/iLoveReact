import { TILE_KIND_DEFINITIONS, TILE_KINDS } from './tileKinds';
import { BUILDING_KIND_DEFINITIONS, BUILDING_KINDS } from './buildingKinds';

// The Placeable registry: the SINGLE list the painter palette, the map color
// table, and the world tree all iterate. Adding an authorable world thing is one
// entry here — never a new switch in three different files. `swatchColor` is the
// one source of truth for a kind's map/palette color, replacing the per-map
// duplicate tables (the old minimapTileCode switch + hmsc-int's own mapping).

export type WorldLayer = 'tile' | 'zone' | 'building' | 'road' | 'prop' | 'mountain';

// How the painter brushes this layer: per-cell (tiles), as a rectangle (zones),
// or not paintable here (buildings are footprint objects placed via wv_building;
// the palette still lists them for color/legend).
export type PaintMode = 'cell' | 'rect' | 'none';

// A rectangular selection in cells (the painter's brush/drag output). `name` and
// `flags` carry layer-specific authoring data — zones need a name; future layers
// may add their own without changing the painter.
export type PlaceableSelection = {
  x: number;
  z: number;
  width: number;
  depth: number;
  y?: number;
  name?: string;
  flags?: string[];
};

export type Placeable = {
  id: string;       // 'tile:sand', 'zone', 'building:house'
  layer: WorldLayer;
  kind: string;     // TileKind | BuildingKind | 'zone'
  label: string;
  swatchColor: string;
  paint: PaintMode;
  // Pure command-string construction (no runtime coupling to the command
  // existing yet) — the painter joins these into the copy-pasta on export.
  emit(sel: PlaceableSelection): string[];
};

const tilePlaceables: Placeable[] = TILE_KINDS.map((kind) => {
  const def = TILE_KIND_DEFINITIONS[kind];
  return {
    id: `tile:${kind}`,
    layer: 'tile',
    kind,
    label: def.label,
    swatchColor: def.render.color,
    paint: 'cell',
    emit: (s) => [`wv_fill ${kind} ${s.x} ${s.z} ${s.width} ${s.depth}${s.y != null ? ` ${s.y}` : ''}`],
  };
});

const buildingPlaceables: Placeable[] = BUILDING_KINDS.map((kind) => {
  const def = BUILDING_KIND_DEFINITIONS[kind];
  return {
    id: `building:${kind}`,
    layer: 'building',
    kind,
    label: def.label,
    swatchColor: def.facadeColor,
    paint: 'none',
    emit: (s) => [`wv_building ${kind} ${s.x} ${s.z} ${def.defaultEnclosure} ${s.width} ${s.depth}`],
  };
});

// Zone is a rect-painted layer. Phase 2 adds the wv_zone command + Zone state;
// emit here only builds the string, so it carries no dependency on that yet.
const zonePlaceable: Placeable = {
  id: 'zone',
  layer: 'zone',
  kind: 'zone',
  label: 'Zone',
  swatchColor: '#a060ff',
  paint: 'rect',
  emit: (s) => [
    `wv_zone ${s.name ?? 'zone'} ${s.x} ${s.z} ${s.width} ${s.depth}${s.flags?.length ? ` ${s.flags.join(' ')}` : ''}`,
  ],
};

export const PLACEABLES: Placeable[] = [...tilePlaceables, ...buildingPlaceables, zonePlaceable];

const PLACEABLE_BY_ID = new Map(PLACEABLES.map((placeable) => [placeable.id, placeable]));

export function placeableById(id: string): Placeable | undefined {
  return PLACEABLE_BY_ID.get(id);
}

export function placeablesForLayer(layer: WorldLayer): Placeable[] {
  return PLACEABLES.filter((placeable) => placeable.layer === layer);
}

// Map/palette color for a layer:kind id, falling back to a neutral grey so a new
// kind without a registry entry never renders invisible.
export function swatchColorForId(id: string): string {
  return PLACEABLE_BY_ID.get(id)?.swatchColor ?? '#64748b';
}

// Hex -> linear-ish 0..1 rgb. Lives here, next to the one color source, so every
// map converts the same way instead of re-rolling the parse (kills the old
// per-map color tables). Accepts #rgb / #rrggbb with or without the leading #.
export function hexToRgb01(hex: string): [number, number, number] {
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function swatchRgb01ForId(id: string): [number, number, number] {
  return hexToRgb01(swatchColorForId(id));
}
