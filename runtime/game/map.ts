// runtime/game/map.ts — the editor's map-paint DOOR.
//
// Wraps the host-owned map painter (__map_*, framework/game/map/, ported from
// the cart/hmsc-int 2D tile map painter per USER ASK req_2473). Painting
// terrain height, ground tiles, water, flora, and zones runs host-side; React
// arms the tool and reads stats — it never mutates a cell.
//
// Importing this file is the source-driven gate signal — it flips -Dhas-game-map
// (sdk/dependency-registry.json `game-map`), so a cart pays for the host binding
// only when it actually paints maps.
//
// The stroke functions here exist for chrome-driven strokes and verification;
// the per-dab hot path is the loader's NATIVE input routing (zero JS per event).
// Kind/zone/flora indices are opaque content indices — legends live cart-side.
import { callHost, hasHost } from '../ffi';

export type MapChannel = 'terrain' | 'tile' | 'water' | 'flora' | 'zone' | 'road';
export type MapMode = 'paint' | 'erase';
export type MapTerrainTool = 'brush' | 'ramp' | 'slope' | 'smooth';
export type MapBrushShape = 'circle' | 'square' | 'diamond';
export type MapBrushProfile = 'cone' | 'flat' | 'dome';

const CHANNEL_INDEX: Record<MapChannel, number> = { terrain: 0, tile: 1, water: 2, flora: 3, zone: 4, road: 5 };
const MODE_INDEX: Record<MapMode, number> = { paint: 0, erase: 1 };
const TERRAIN_TOOL_INDEX: Record<MapTerrainTool, number> = { brush: 0, ramp: 1, slope: 2, smooth: 3 };
const SHAPE_INDEX: Record<MapBrushShape, number> = { circle: 0, square: 1, diamond: 2 };
const PROFILE_INDEX: Record<MapBrushProfile, number> = { cone: 0, flat: 1, dome: 2 };

export interface MapTool {
  channel: MapChannel;
  mode?: MapMode;
  terrainTool?: MapTerrainTool;
  shape?: MapBrushShape;
  profile?: MapBrushProfile;
  /** brush radius: meters for terrain/water, tiles for tile/flora/zone */
  radiusM?: number;
  /** height-brush peak, signed (raise vs dig) */
  centerZ?: number;
  rampMin?: number;
  rampMax?: number;
  rampWide?: number;
  rampLong?: number;
  rampAngleDeg?: number;
  smoothStrength?: number;
  /** armed tile kind index (cart legend order) */
  kindIdx?: number;
  /** armed flora kind index + its population lane (0 grass, 1 tree, 2 bush) */
  floraKindIdx?: number;
  floraLane?: number;
  /** armed zone list index */
  zoneIdx?: number;
}

export interface MapStrokeStats {
  samples: number;
  stamps: number;
  /** chunks dirtied by the stroke */
  touched: number;
  /** water stroke found no carved basin to fill (nudge: carve first) */
  waterDry: boolean;
}

/** Whether the host map binding is live (built with -Dhas-game-map). */
export function mapHostLive(): boolean {
  return hasHost('__map_stroke_begin');
}

export function mapReset(): void {
  callHost('__map_reset', undefined);
}

/** Allocate the chunk at (cx,cz). Returns false out-of-window. */
export function mapGrowChunk(cx: number, cz: number): boolean {
  return callHost<number>('__map_grow_chunk', 0, cx, cz) === 1;
}

export function mapChunkCount(): number {
  return callHost<number>('__map_chunk_count', 0);
}

/** The in-bounds, unoccupied neighbour slots of (cx,cz) — where "+" grows. */
export function mapOpenNeighbors(cx: number, cz: number): { cx: number; cz: number }[] {
  const ab = callHost<ArrayBuffer | null>('__map_open_neighbors', null, cx, cz);
  if (!ab) return [];
  const out = new Float32Array(ab);
  const n = out[0]!;
  const slots: { cx: number; cz: number }[] = [];
  for (let i = 0; i < n; i += 1) slots.push({ cx: out[1 + i * 2]!, cz: out[2 + i * 2]! });
  return slots;
}

/** Arm the paint tool. Everything a stroke needs crosses ONCE here (UI rate). */
export function mapSetTool(tool: MapTool): void {
  const buf = new Float32Array(17);
  buf[0] = CHANNEL_INDEX[tool.channel];
  buf[1] = MODE_INDEX[tool.mode ?? 'paint'];
  buf[2] = TERRAIN_TOOL_INDEX[tool.terrainTool ?? 'brush'];
  buf[3] = SHAPE_INDEX[tool.shape ?? 'circle'];
  buf[4] = PROFILE_INDEX[tool.profile ?? 'cone'];
  buf[5] = tool.radiusM ?? 2;
  buf[6] = tool.centerZ ?? 4;
  buf[7] = tool.rampMin ?? 0;
  buf[8] = tool.rampMax ?? 4;
  buf[9] = tool.rampWide ?? 3;
  buf[10] = tool.rampLong ?? 6;
  buf[11] = tool.rampAngleDeg ?? 0;
  buf[12] = tool.smoothStrength ?? 0.5;
  buf[13] = tool.kindIdx ?? -1;
  buf[14] = tool.floraKindIdx ?? -1;
  buf[15] = tool.floraLane ?? 0;
  buf[16] = tool.zoneIdx ?? -1;
  callHost('__map_set_tool', undefined, buf);
}

/** Push the cell channels' shader contract: a WGSL body defining
 *  `fn hf_ground_rgb(uv) -> vec3f` over the engine's D stream (layout v2:
 *  packed tile+flora+zone cells), plus the three palettes (rgb triples in
 *  legend order). Content — push once at UI rate. */
export function mapSetGroundLook(
  formulaWgsl: string,
  tilePaletteRgb: Float32Array,
  floraPaletteRgb: Float32Array,
  zonePaletteRgb: Float32Array,
): void {
  callHost('__map_set_ground_look', undefined, formulaWgsl, tilePaletteRgb, floraPaletteRgb, zonePaletteRgb);
}

/** Re-push just the zone palette (zones are user-authored and change mid-map). */
export function mapSetZonePalette(zonePaletteRgb: Float32Array): void {
  callHost('__map_set_zone_palette', undefined, zonePaletteRgb);
}

/** Delete zone list entry `index`: unzones its cells, shifts higher indices down. */
export function mapDropZone(index: number): void {
  callHost('__map_drop_zone', undefined, index);
}

/** Push the flora population contract: per kind [spec, count, chance] triples
 *  in legend order (spec 0 grass · 1 bush · 2 flowers · 3 palm; count = rows
 *  per painted cell; chance = per-cell spawn gate). The loader's LIVE foliage
 *  preview grows painted cells with this — content, pushed with the look. */
export function mapSetFloraSpecs(specs: Float32Array): void {
  callHost('__map_set_flora_specs', undefined, specs);
}

// ── roads (ROADSTROKE-0610: click-authored recipes, host-compiled) ────────────
// While channel='road', viewport clicks lay draft centerline points host-side;
// these doors manage the draft lifecycle + the content mapping.

export type MapRoadProfile = { lanesF: number; lanesB: number; sidewalks: boolean };

/** The draft profile road clicks author with. */
export function mapRoadSetProfile(p: MapRoadProfile): void {
  callHost('__map_road_set_profile', undefined, p.lanesF, p.lanesB, p.sidewalks ? 1 : 0);
}

/** RoadCellKind → content tile index, in the host enum order:
 *  laneNorth, laneSouth, laneEast, laneWest, median, sidewalk, junction, crosswalk. */
export function mapRoadSetKinds(indices: readonly number[]): void {
  callHost('__map_road_set_kinds', undefined, new Float32Array(indices));
}

/** Commit the click-drafted road; the host replans + restamps every stroke.
 *  Returns the stroke id, or 0 when the draft is too short / the table full. */
export function mapRoadCommit(): number {
  return callHost<number>('__map_road_commit', 0);
}

export function mapRoadCancel(): void {
  callHost('__map_road_cancel', undefined);
}

export function mapRoadDelete(id: number): boolean {
  return callHost<number>('__map_road_delete', 0, id) === 1;
}

/** Save the whole painting to a file — the blob never crosses the bridge (the
 *  host RLE-serializes and writes directly). Roads persist as recipes. */
export function mapSaveFile(path: string): boolean {
  return callHost<number>('__map_save_file', 0, path) === 1;
}

/** Load a painting from a file; the host rebuilds every channel and re-derives
 *  the road stamps. False = missing or malformed file. */
export function mapLoadFile(path: string): boolean {
  return callHost<number>('__map_load_file', 0, path) === 1;
}

export function mapRoadStats(): { strokes: number; draftPoints: number; planTruncated: boolean } {
  const ab = callHost<ArrayBuffer | null>('__map_road_stats', null);
  if (!ab) return { strokes: 0, draftPoints: 0, planTruncated: false };
  const out = new Float32Array(ab);
  return { strokes: out[0]!, draftPoints: out[1]!, planTruncated: out[2]! >= 0.5 };
}

/** Begin a stroke at a world-meter point (chrome-driven path). */
export function mapStrokeBegin(x: number, z: number): void {
  callHost('__map_stroke_begin', undefined, x, z);
}

export function mapStrokeMove(x: number, z: number): void {
  callHost('__map_stroke_move', undefined, x, z);
}

export function mapStrokeEnd(): MapStrokeStats {
  const ab = callHost<ArrayBuffer | null>('__map_stroke_end', null);
  if (!ab) return { samples: 0, stamps: 0, touched: 0, waterDry: false };
  const out = new Float32Array(ab);
  return { samples: out[0]!, stamps: out[1]!, touched: out[2]!, waterDry: out[3]! >= 0.5 };
}

export function mapStats(): { chunkCount: number; dirtyChunks: number } {
  const ab = callHost<ArrayBuffer | null>('__map_stats', null);
  if (!ab) return { chunkCount: 0, dirtyChunks: 0 };
  const out = new Float32Array(ab);
  return { chunkCount: out[0]!, dirtyChunks: out[1]! };
}

/** Copy of a chunk's terrain height samples (241×241, row-major). Readback for
 *  verification/chrome only — the render feed never crosses the bridge. */
export function mapReadHeight(cx: number, cz: number): Float32Array | null {
  const ab = callHost<ArrayBuffer | null>('__map_read_height', null, cx, cz);
  return ab ? new Float32Array(ab.slice(0)) : null;
}

export function mapReadWater(cx: number, cz: number): Float32Array | null {
  const ab = callHost<ArrayBuffer | null>('__map_read_water', null, cx, cz);
  return ab ? new Float32Array(ab.slice(0)) : null;
}

export type MapCellChannel = 'tiles' | 'zones' | 'floraGrass' | 'floraTree' | 'floraBush';
const CELL_CHANNEL_INDEX: Record<MapCellChannel, number> = {
  tiles: 0,
  zones: 1,
  floraGrass: 2,
  floraTree: 3,
  floraBush: 4,
};

/** Copy of a chunk's 120×120 cell grid for one cell channel (-1 = empty). */
export function mapReadCells(cx: number, cz: number, channel: MapCellChannel): Float32Array | null {
  const ab = callHost<ArrayBuffer | null>('__map_read_cells', null, cx, cz, CELL_CHANNEL_INDEX[channel]);
  return ab ? new Float32Array(ab.slice(0)) : null;
}
