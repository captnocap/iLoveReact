// stage/mapPaint.ts — the Map Paint tool's state model + host-door controller
// (MAPPAINT req_2473/req_2484). React owns only this chrome mirror; strokes,
// stamps, render, and colliders are host-side (framework/game/map). The BAR
// (MapPaintBar.tsx, in the workspace action bar) renders it; AppFrame owns the
// state and calls applyMapPaintEffects on every patch so the host tool always
// tracks the chrome.
import {
  mapChunkCount, mapGrowChunk, mapHostLive, mapLoadFile, mapSaveFile, mapSetGroundLook,
  mapSetTool, mapSetZonePalette, mapRoadSetKinds, mapRoadSetProfile,
  type MapBrushProfile, type MapBrushShape, type MapTerrainTool,
} from '../../../runtime/game/map';
import { editorGroundFormula, TILE_KIND_PALETTE, FLORA_KIND_PALETTE, zonePaletteOf, type TileMaterialOverrides } from '../render3d/groundFormula';
import { FLORA_KIND_DEFINITIONS, FLORA_LANE_INDEX, ZONE_COLORS } from '../world/floraKinds';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';

export type MapZoneDef = { id: string; name: string; color: string };
export type MapPaintChannel = 'terrain' | 'tile' | 'water' | 'flora' | 'zone' | 'road';

export type MapPaintState = {
  active: boolean;
  channel: MapPaintChannel;
  mode: 'paint' | 'erase';
  terrainTool: MapTerrainTool;
  shape: MapBrushShape;
  profile: MapBrushProfile;
  radiusM: number;
  /** height-brush peak, meters (signed via the RAISE/DIG toggle) */
  heightM: number;
  raise: boolean;
  rampMin: number;
  rampMax: number;
  rampWide: number;
  smoothStrength: number;
  /** armed ground tile kind — index into TILE_KINDS (the engine legend order) */
  tileKindIdx: number;
  /** per-kind material rebinds (kind → catalog material fn + variant) — the
   *  "paint THIS texture" control (req_2494). Empty = the curated defaults. */
  tileMaterialOverrides: TileMaterialOverrides;
  /** the tile-texture picker popover (rendered late by AppFrame) */
  texturePickerOpen: boolean;
  /** armed flora kind — index into FLORA_KIND_DEFINITIONS */
  floraKindIdx: number;
  /** the zone list (names/colors are cart content; cells live host-side) */
  zones: MapZoneDef[];
  /** armed zone — index into zones */
  zoneIdx: number;
  // road draft profile (lanesB 0 = one-way)
  roadLanesF: number;
  roadLanesB: number;
  roadSidewalks: boolean;
};

export function defaultMapPaint(): MapPaintState {
  return {
    active: false,
    channel: 'terrain',
    mode: 'paint',
    terrainTool: 'brush',
    shape: 'circle',
    profile: 'cone',
    radiusM: 4,
    heightM: 6,
    raise: true,
    rampMin: 0,
    rampMax: 4,
    rampWide: 3,
    smoothStrength: 0.5,
    tileKindIdx: Math.max(0, TILE_KINDS.indexOf('sidewalk')),
    tileMaterialOverrides: {},
    texturePickerOpen: false,
    floraKindIdx: 1, // 'Grass'
    zones: [],
    zoneIdx: 0,
    roadLanesF: 1,
    roadLanesB: 1,
    roadSidewalks: true,
  };
}

// The paintable GROUND kinds for the bar's palette — TERRAIN SURFACES only
// (req_2496). The old 2D painter flattened everything into tiles; those
// non-terrain kinds are dead here and never return:
//   · placement 'embedded' (wall/door/bush) — building tools own walls/doors
//     (the piece system), flora owns bushes (its own channel)
//   · placement 'gameplay'/'dev' (spawn/save/vehicleSpawn/marker) — semantic
//     overlay NODES per the V24 ruling, never ground paint
//   · the road-grammar kinds (lanes/junction/crosswalk/median) — authored by
//     the road channel's stroke compiler, not the hand brush
//   · 'water' — its own channel (painted depth, not a surface swatch)
const ROAD_GRAMMAR_KINDS = ['laneNorth', 'laneSouth', 'laneEast', 'laneWest', 'junction', 'crosswalk', 'median'];
export const PAINTABLE_TILE_KINDS: readonly number[] = TILE_KINDS
  .map((k, i) => [k, i] as const)
  .filter(([k]) => tileKindDefinition(k).placement === 'surface')
  .filter(([k]) => !ROAD_GRAMMAR_KINDS.includes(k) && k !== 'water')
  .map(([, i]) => i);

// RoadCellKind → this cart's TILE_KINDS indices, in the host enum order
// (laneNorth, laneSouth, laneEast, laneWest, median, sidewalk, junction,
// crosswalk). The grammar is content-free; this is where the content binds.
const ROAD_KIND_INDICES = (['laneNorth', 'laneSouth', 'laneEast', 'laneWest', 'median', 'sidewalk', 'junction', 'crosswalk'] as const)
  .map((k) => TILE_KINDS.indexOf(k));

// The painted map's save file — beside the gamefile it will compile into.
// RLE blob written/read host-side (__map_save_file).
export const EDITOR_MAP_FILE = 'zig-out/game/editor/painted-map.rmap';

/** Push the chrome state into the host map painter as the ONE armed tool. The
 *  height dial + RAISE/DIG toggle collapse into the engine's signed centerZ. */
function pushMapTool(s: MapPaintState): void {
  const flora = FLORA_KIND_DEFINITIONS[s.floraKindIdx];
  mapRoadSetProfile({ lanesF: s.roadLanesF, lanesB: s.roadLanesB, sidewalks: s.roadSidewalks });
  mapSetTool({
    channel: s.channel,
    mode: s.mode,
    terrainTool: s.terrainTool,
    shape: s.shape,
    profile: s.profile,
    radiusM: s.radiusM,
    centerZ: s.raise ? s.heightM : -s.heightM,
    rampMin: s.rampMin,
    rampMax: s.rampMax,
    rampWide: s.rampWide,
    smoothStrength: s.smoothStrength,
    kindIdx: s.tileKindIdx,
    floraKindIdx: s.floraKindIdx,
    floraLane: flora ? FLORA_LANE_INDEX[flora.lane] : 0,
    zoneIdx: s.zones.length ? Math.min(s.zoneIdx, s.zones.length - 1) : -1,
  });
}

/** The one place chrome state reaches the host — AppFrame calls this on every
 *  mapPaint patch. Arming loads the saved painting (fresh seed chunk when none),
 *  pushes the ground look (formula + palettes) + road kind mapping; a changed
 *  zone list re-pushes just the zone palette; the armed tool always re-pushes. */
export function applyMapPaintEffects(prev: MapPaintState, next: MapPaintState): void {
  if (!mapHostLive() || !next.active) return;
  if (!prev.active) {
    if (mapChunkCount() === 0 && !mapLoadFile(EDITOR_MAP_FILE)) mapGrowChunk(0, 0);
    mapSetGroundLook(editorGroundFormula(next.tileMaterialOverrides), TILE_KIND_PALETTE, FLORA_KIND_PALETTE, zonePaletteOf(next.zones));
    mapRoadSetKinds(ROAD_KIND_INDICES);
  } else if (prev.tileMaterialOverrides !== next.tileMaterialOverrides) {
    // A rebind regenerates the formula (the kind→material tables are baked
    // into the WGSL) — one shader rebuild per pick, authoring-rate.
    mapSetGroundLook(editorGroundFormula(next.tileMaterialOverrides), TILE_KIND_PALETTE, FLORA_KIND_PALETTE, zonePaletteOf(next.zones));
  } else if (prev.zones !== next.zones) {
    mapSetZonePalette(zonePaletteOf(next.zones));
  }
  pushMapTool(next);
}

/** A zone patch: mint the next zone def (ZONE_COLORS cycle) and arm it. */
export function addZonePatch(s: MapPaintState): Partial<MapPaintState> {
  const zone: MapZoneDef = {
    id: `z_${s.zones.length + 1}`,
    name: `Zone ${s.zones.length + 1}`,
    color: ZONE_COLORS[s.zones.length % ZONE_COLORS.length]!,
  };
  return { zones: [...s.zones, zone], zoneIdx: s.zones.length, mode: 'paint' };
}

/** SAVE writes the whole painting host-side (RLE blob; roads as recipes). */
export function saveMapFile(): void {
  if (!mapSaveFile(EDITOR_MAP_FILE)) console.error(`[map-paint] SAVE FAILED: ${EDITOR_MAP_FILE}`);
}
