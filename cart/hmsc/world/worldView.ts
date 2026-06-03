import type { GameState, ZoneFlag } from '../design';
import type { WorldLayer } from './placeables';
import { buildingKindDefinition } from './buildingKinds';
import { propKindDefinition } from './propKinds';
import { landformKindDef } from './landforms';

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

// Terrain landmarks — the registry-driven landforms (mountains/hills/estate).
// Each reads its footprint radius from its kind def, so a new landform shows on
// every map for free. Drawn under the 'mountain' map layer (the terrain layer).
function landformMarkers(state: GameState): WorldMarker[] {
  return (state.world.landforms ?? []).map((lf) => {
    const def = landformKindDef(lf.kind);
    const r = def ? def.footprintRadius(lf.params, lf.field) : 1;
    return {
      layer: 'mountain' as const,
      id: lf.id,
      label: lf.label,
      swatchColor: '#8a6d3b',
      x: lf.centerX - r,
      z: lf.centerZ - r,
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

// Prop tint: foliage green, hydrant red, rock grey, the rest (signs/lights/
// signals) amber. Props are point furniture, so the footprint is clamped to at
// least one cell so a thin hydrant still lands a visible marker on the maps.
function propSwatch(kind: string): string {
  if (kind === 'bush' || kind === 'bushLarge') return '#2f6b35';
  if (kind === 'fireHydrant') return '#ef4444';
  if (kind === 'rock') return '#9ca3af';
  return '#f59e0b';
}

function propMarkers(state: GameState): WorldMarker[] {
  return state.world.props.map((p) => {
    const def = propKindDefinition(p.kind);
    const r = Math.max(0.5, def.footprintRadiusMeters);
    return {
      layer: 'prop',
      id: p.id,
      label: def.label,
      swatchColor: propSwatch(p.kind),
      x: p.x - r,
      z: p.z - r,
      width: r * 2,
      depth: r * 2,
    };
  });
}

// Provider LIST — the forward seam from WORLD_AUTHORING_PLAN. Each registered
// provider's markers appear on every map for free; the quest slice pushes an
// objective-pin provider here later.
const MARKER_PROVIDERS: MarkerProvider[] = [buildingMarkers, landformMarkers, zoneMarkers, propMarkers];

export function worldMarkers(state: GameState): WorldMarker[] {
  return MARKER_PROVIDERS.flatMap((provider) => provider(state));
}
