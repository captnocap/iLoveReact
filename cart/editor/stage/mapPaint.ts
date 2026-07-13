// stage/mapPaint.ts — the Map Paint tool's state model + host-door controller
// (MAPPAINT req_2473/req_2484). React owns only this chrome mirror; strokes,
// stamps, render, and colliders are host-side (framework/game/map). The action
// bar (MapPaintBar.tsx) owns the paint toggle; the viewport dock
// (MapPaintDock.tsx) owns brush footprint and channel palettes/options.
// AppFrame owns the state and calls applyMapPaintEffects on every patch so the
// host tool tracks chrome.
import {
  mapChunkCount, mapGetTileBindings, mapGrowChunk, mapHostLive, mapLoadFile, mapReset, mapSaveFile, mapSetAutosaveFile,
  mapSetGroundLook, mapSetTileBindings, mapSetTool, mapSetZonePalette, mapSetFloraSpecs, mapRoadSetKinds,
  mapPathSetProfile, mapSetBrushGizmo,
  mapPathSetLevel, mapPathSetTool,
  type MapBrushGizmo, type MapBrushProfile, type MapBrushShape, type MapTerrainTool,
} from '../../../runtime/game/map';
import { exists } from '../../../runtime/hooks/fs';
import {
  EDITOR_GROUND_FORMULA, TILE_KIND_PALETTE, FLORA_KIND_PALETTE, zonePaletteOf,
  bindingsToFloats, floatsToBindings, type TileMaterialBinding,
} from '../render3d/groundFormula';
import { FLORA_KIND_DEFINITIONS, FLORA_LANE_INDEX, FLORA_SPECS, ZONE_COLORS } from '../world/floraKinds';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import {
  LEGACY_MAP_FILE,
  activeMapDocumentStem,
  finishLegacyMapImport,
  hasLegacyMapImport,
  mapDocumentPaths,
} from '../data/mapDocuments';
import { pathProfileOf, type TransportPathChrome } from './transportPathUi';

export type MapZoneDef = { id: string; name: string; color: string };
export type MapPaintChannel = 'terrain' | 'tile' | 'water' | 'flora' | 'zone' | 'road';

export type MapPaintState = TransportPathChrome & {
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
    pathKind: 'road',
    pathTool: 'draw',
    pathLevel: 0,
    pathCurveRadiusM: 8,
    railTracks: 1,
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

// The live native map is one concern inside the ACTIVE named document. Never
// use a process-global fixed path here: that was how a fresh terrain reset got
// paired with the previous map's placed pieces.
let liveMapStem: string | null = null;

export function editorMapFile(stem = activeMapDocumentStem()): string {
  return mapDocumentPaths(stem).painting;
}

let mapAutosaveEnabled = true;

/** Background persistence policy for the native map engine. An empty path is
 * the engine's explicit "do not autosave" state; manual Save remains available. */
export function setMapDocumentAutosave(enabled: boolean): boolean {
  mapAutosaveEnabled = enabled;
  if (!mapHostLive()) return true;
  return mapSetAutosaveFile(enabled && liveMapStem ? editorMapFile(liveMapStem) : '');
}

export type MapPaintingActivation =
  | { ok: true; bindings: TileMaterialBinding[]; seeded: boolean }
  | { ok: false; error: string };

function configureMapContent(zones: readonly MapZoneDef[]): void {
  mapSetGroundLook(EDITOR_GROUND_FORMULA, TILE_KIND_PALETTE, FLORA_KIND_PALETTE, zonePaletteOf(zones));
  mapRoadSetKinds(ROAD_KIND_INDICES);
  mapSetFloraSpecs(FLORA_SPECS);
}

/** Replace the host map with one named document. Existing malformed RMAPs are
 * refused (the caller can reload the just-flushed outgoing map); a genuinely
 * missing painting is a valid empty concern and receives one seed chunk. */
export function activateMapDocumentPainting(stem: string, zones: readonly MapZoneDef[]): MapPaintingActivation {
  if (!mapHostLive()) return { ok: false, error: 'map host is not live in this binary' };
  const paths = mapDocumentPaths(stem);
  // This door is the transaction's first hard gate. On an older host, reset +
  // grow could otherwise still autosave the fresh target into the outgoing
  // document before the later bind attempt tells us the door is unavailable.
  if (!mapSetAutosaveFile('')) {
    return { ok: false, error: 'map autosave door is unavailable; rebuild the editor host' };
  }

  let seeded = false;
  if (exists(paths.painting)) {
    if (!mapLoadFile(paths.painting)) return { ok: false, error: `${paths.painting} is malformed` };
  } else if (hasLegacyMapImport(paths.stem) && exists(LEGACY_MAP_FILE)) {
    if (!mapLoadFile(LEGACY_MAP_FILE)) return { ok: false, error: `${LEGACY_MAP_FILE} is malformed` };
    if (!mapSaveFile(paths.painting)) return { ok: false, error: `could not import painting into ${paths.painting}` };
  } else {
    mapReset();
    if (!mapGrowChunk(0, 0, false)) return { ok: false, error: 'could not seed chunk (0, 0)' };
    seeded = true;
  }

  configureMapContent(zones);
  if (!mapSetAutosaveFile(mapAutosaveEnabled ? paths.painting : '')) {
    return { ok: false, error: 'map autosave door is unavailable; rebuild the editor host' };
  }
  if (seeded && !mapSaveFile(paths.painting)) return { ok: false, error: `could not create ${paths.painting}` };
  finishLegacyMapImport(paths.stem);
  liveMapStem = paths.stem;
  return { ok: true, bindings: floatsToBindings(mapGetTileBindings()), seeded };
}

/** Durably flush the current host painting to the named outgoing document. */
export function flushMapDocumentPainting(stem: string): boolean {
  const expected = mapDocumentPaths(stem).stem;
  // Never serialize an unidentified/other live host map into this document.
  // A hot reload re-establishes identity through ensureMapSeeded before edits.
  if (!mapHostLive() || liveMapStem !== expected || mapChunkCount() === 0) return false;
  const path = editorMapFile(stem);
  if (!mapSaveFile(path)) return false;
  return mapSetAutosaveFile(mapAutosaveEnabled ? path : '');
}

/** Push the chrome state into the host map painter as the ONE armed tool. The
 *  height dial + RAISE/DIG toggle collapse into the engine's signed centerZ. */
function pushMapTool(s: MapPaintState): void {
  const flora = FLORA_KIND_DEFINITIONS[s.floraKindIdx];
  const gizmo = s.gizmo ?? 'profile';
  mapPathSetProfile(pathProfileOf(s));
  mapPathSetTool(s.pathTool);
  mapPathSetLevel(s.pathLevel);
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
export function ensureMapSeeded(
  zones: readonly MapZoneDef[] = [],
  stem = activeMapDocumentStem(),
): boolean {
  if (!mapHostLive()) return false;
  if (liveMapStem !== stem || mapChunkCount() === 0) {
    const activation = activateMapDocumentPainting(stem, zones);
    if (!activation.ok) {
      console.error(`[map-seed] ${activation.error}`);
      return false;
    }
  } else {
    if (!mapSetAutosaveFile(mapAutosaveEnabled ? editorMapFile(stem) : '')) return false;
    configureMapContent(zones);
  }
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
  const path = editorMapFile();
  if (!mapSaveFile(path)) console.error(`[map-paint] SAVE FAILED: ${path}`);
}
