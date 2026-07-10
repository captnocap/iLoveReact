// stage/mapPaint.ts — the Map Paint tool's state model + host-door controller
// (MAPPAINT req_2473/req_2484). React owns only this chrome mirror; strokes,
// stamps, render, and colliders are host-side (framework/game/map). The action
// bar (MapPaintBar.tsx) owns the paint toggle; the viewport dock
// (MapPaintDock.tsx) owns brush footprint and channel palettes/options.
// AppFrame owns the state and calls applyMapPaintEffects on every patch so the
// host tool tracks chrome.
import {
  mapChunkCount, mapGetTileBindings, mapGrowChunk, mapHostLive, mapLoadFile, mapSaveFile, mapSetAutosaveFile,
  mapSetGroundLook, mapSetTileBindings, mapSetTool, mapSetZonePalette, mapSetFloraSpecs, mapRoadSetKinds,
  mapRoadSetProfile, mapSetBrushGizmo,
  type MapBrushGizmo, type MapBrushProfile, type MapBrushShape, type MapTerrainTool,
} from '../../../runtime/game/map';
import {
  EDITOR_GROUND_FORMULA, TILE_KIND_PALETTE, FLORA_KIND_PALETTE, zonePaletteOf,
  bindingsToFloats, floatsToBindings, type TileMaterialBinding,
} from '../render3d/groundFormula';
import { FLORA_KIND_DEFINITIONS, FLORA_LANE_INDEX, FLORA_SPECS, ZONE_COLORS } from '../world/floraKinds';
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
  /** in-world brush gizmo and matching dab footprint */
  gizmo: MapBrushGizmo;
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
  /** the map's palette of hand-picked looks (req_2693) — mirror of the host
   *  tile-binding table (persisted in the RMAP). Painted cells reference
   *  entries by index, so two sidewalks can wear different materials. */
  tileBindings: TileMaterialBinding[];
  /** armed binding — index into tileBindings; -1 = the kind's curated default */
  tileBindIdx: number;
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
    gizmo: 'profile',
    radiusM: 4,
    heightM: 6,
    raise: true,
    rampMin: 0,
    rampMax: 4,
    rampWide: 3,
    smoothStrength: 0.5,
    tileKindIdx: Math.max(0, TILE_KINDS.indexOf('sidewalk')),
    tileBindings: [],
    tileBindIdx: -1,
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
  const gizmo = s.gizmo ?? 'profile';
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
    bindIdx: s.tileBindIdx,
  });
  mapSetBrushGizmo(gizmo);
}

/** One-time map-layer setup: load the saved painting (fresh seed chunk when
 *  none) and push the ground look (formula + palettes), road kind mapping, and
 *  flora specs. Extracted from the arming branch (req_2651 gap XX) so the world
 *  viewport can seed it at BOOT — before this, no chunk existed until the user
 *  armed Map Paint and the editor booted into a groundless void. Returns false
 *  when the host map doors aren't live yet (callers retry). */
export function ensureMapSeeded(zones: readonly MapZoneDef[] = []): boolean {
  if (!mapHostLive()) return false;
  if (mapChunkCount() === 0 && !mapLoadFile(EDITOR_MAP_FILE)) mapGrowChunk(0, 0, false);
  // Micro-save from here on (req_2765): every gesture rewrites the map file
  // host-side — painting done without the Save button survives a restart.
  // False on a binary predating the door; the manual Save still covers those.
  if (!mapSetAutosaveFile(EDITOR_MAP_FILE)) console.warn('[map-seed] autosave door missing — rebuild the host for micro-saves; manual Save still works');
  mapSetGroundLook(EDITOR_GROUND_FORMULA, TILE_KIND_PALETTE, FLORA_KIND_PALETTE, zonePaletteOf(zones));
  mapRoadSetKinds(ROAD_KIND_INDICES);
  mapSetFloraSpecs(FLORA_SPECS); // req_2497: painting flora grows LITERAL foliage live
  console.warn(`[map-seed] ground seeded — ${mapChunkCount()} chunk(s) live`);
  return true;
}

/** The one place chrome state reaches the host — AppFrame calls this on every
 *  mapPaint patch. Arming loads the saved painting (fresh seed chunk when none)
 *  and pushes the ground look (STATIC formula + palettes) + road kind mapping;
 *  a changed binding list re-pushes the table (pure data — the 10-15s per-pick
 *  shader rebuild is gone, req_2693); a changed zone list re-pushes just the
 *  zone palette; the armed tool always re-pushes. Returns a state patch when
 *  the HOST is the truth-holder (the loaded map's binding table on arm) —
 *  callers merge it into the next state. */
export function applyMapPaintEffects(prev: MapPaintState, next: MapPaintState): Partial<MapPaintState> | null {
  if (!mapHostLive() || !next.active) return null;
  if (!prev.active) {
    ensureMapSeeded(next.zones);
    // The RMAP carries the painting's binding table — mirror it out so the
    // picker shows the map's real palette of looks after a reload.
    const hostBindings = floatsToBindings(mapGetTileBindings());
    if (hostBindings.length > 0 && next.tileBindings.length === 0) {
      pushMapTool({ ...next, tileBindings: hostBindings });
      return { tileBindings: hostBindings };
    }
    // A fresh map (or a chrome that already mirrors) — push the chrome's table.
    if (next.tileBindings.length > 0) mapSetTileBindings(bindingsToFloats(next.tileBindings), false);
  } else if (prev.tileBindings !== next.tileBindings) {
    mapSetTileBindings(bindingsToFloats(next.tileBindings), true);
  } else if (prev.zones !== next.zones) {
    mapSetZonePalette(zonePaletteOf(next.zones));
  }
  pushMapTool(next);
  return null;
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
