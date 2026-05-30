import type { GameState, ZoneFlag } from '../design';
import type { WorldLayer } from './placeables';
import { buildingKindDefinition } from './buildingKinds';

// The shared map read-model. Both the in-game minimap (render/Hud.tsx) and the
// internal map (cart/hmsc-int) draw landmarks from worldMarkers() instead of each
// re-deriving a subset of layers — that re-derivation is exactly why buildings
// never showed on either map and why the two could drift from the 3D world.
//
// Cell-kind resolution lives in world/grid.ts:tileKindAtCell (shared with NPC
// A* pathing); this file adds the LANDMARK layer the maps paint over that raster.

// A landmark drawn over the tile raster; footprint is in cells (1 tile = 1 m).
export type WorldMarker = {
  layer: WorldLayer;
  id: string;
  label: string;
  swatchColor: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  icon?: string;
};

export type MarkerProvider = (state: GameState) => WorldMarker[];

function buildingMarkers(state: GameState): WorldMarker[] {
  return state.world.buildings.map((b) => ({
    layer: 'building',
    id: b.id,
    label: b.label || buildingKindDefinition(b.kind).label,
    swatchColor: buildingKindDefinition(b.kind).facadeColor,
    x: b.x,
    z: b.z,
    width: b.widthTiles,
    depth: b.depthTiles,
  }));
}

function mountainMarkers(state: GameState): WorldMarker[] {
  return state.world.mountains.map((m) => {
    const r = m.baseRadiusMeters;
    return {
      layer: 'mountain',
      id: m.id,
      label: m.label,
      swatchColor: '#6b7280',
      x: m.centerX - r,
      z: m.centerZ - r,
      width: r * 2,
      depth: r * 2,
      icon: '^',
    };
  });
}

// Zone tint by flag so private property reads red, safe green, hostile orange,
// etc. — the maps and the painter palette share this one mapping.
export function zoneSwatch(flags: ZoneFlag[]): string {
  if (flags.includes('private')) return '#ff5e5e';
  if (flags.includes('hostile')) return '#ff9f43';
  if (flags.includes('restricted')) return '#ffd166';
  if (flags.includes('safe')) return '#5fe08c';
  return '#a060ff';
}

function zoneMarkers(state: GameState): WorldMarker[] {
  return state.world.zones.map((zone) => ({
    layer: 'zone',
    id: zone.id,
    label: zone.name,
    swatchColor: zoneSwatch(zone.flags),
    x: zone.x,
    z: zone.z,
    width: zone.width,
    depth: zone.depth,
  }));
}

// Provider LIST — the forward seam from WORLD_AUTHORING_PLAN. Phase 2 pushes the
// zone provider here; the quest slice pushes an objective-pin provider. Every
// registered provider's markers appear on every map for free.
const MARKER_PROVIDERS: MarkerProvider[] = [buildingMarkers, mountainMarkers, zoneMarkers];

export function worldMarkers(state: GameState): WorldMarker[] {
  return MARKER_PROVIDERS.flatMap((provider) => provider(state));
}
