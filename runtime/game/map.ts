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
export type MapBrushGizmo = 'beam' | 'decal' | 'rings' | 'profile' | 'handles';

const CHANNEL_INDEX: Record<MapChannel, number> = { terrain: 0, tile: 1, water: 2, flora: 3, zone: 4, road: 5 };
const MODE_INDEX: Record<MapMode, number> = { paint: 0, erase: 1 };
const TERRAIN_TOOL_INDEX: Record<MapTerrainTool, number> = { brush: 0, ramp: 1, slope: 2, smooth: 3 };
const SHAPE_INDEX: Record<MapBrushShape, number> = { circle: 0, square: 1, diamond: 2 };
const PROFILE_INDEX: Record<MapBrushProfile, number> = { cone: 0, flat: 1, dome: 2 };
const GIZMO_INDEX: Record<MapBrushGizmo, number> = { beam: 0, decal: 1, rings: 2, profile: 3, handles: 4 };
const CHANNELS: readonly MapChannel[] = ['terrain', 'tile', 'water', 'flora', 'zone', 'road'];
const MODES: readonly MapMode[] = ['paint', 'erase'];
const TERRAIN_TOOLS: readonly MapTerrainTool[] = ['brush', 'ramp', 'slope', 'smooth'];
const SHAPES: readonly MapBrushShape[] = ['circle', 'square', 'diamond'];
const PROFILES: readonly MapBrushProfile[] = ['cone', 'flat', 'dome'];

const GENERATED_SAMPLE_COUNT = 241 * 241;
const GENERATED_TILE_COUNT = 120 * 120;

/** Versioned Float32 bulk-install layout. The generator compiles source data
 * into these two numeric wires; path triples use centered editor-world x/z.
 * Native code validates and installs them into the canonical chunk and
 * semantic-path owners without a JSON/RMAP detour. */
export const MAP_GENERATED_WIRE = {
  version: 1,
  chunkHeaderFloats: 5,
  sampleCount: GENERATED_SAMPLE_COUNT,
  tileCount: GENERATED_TILE_COUNT,
  chunkStride: 2 + GENERATED_SAMPLE_COUNT * 2 + GENERATED_TILE_COUNT * 5,
  pathHeaderFloats: 2,
  pathRecordHeaderFloats: 8,
} as const;

const NATIVE_GENERATED_INSTALL_ERRORS = [
  'none',
  'chunkHeader',
  'chunkVersion',
  'chunkCount',
  'chunkStride',
  'chunkSampleCount',
  'chunkTileCount',
  'chunkShape',
  'chunkNonFinite',
  'chunkCoordinate',
  'chunkBounds',
  'chunkDuplicate',
  'heightRange',
  'waterDepth',
  'cellIndex',
  'pathHeader',
  'pathVersion',
  'pathCount',
  'pathShape',
  'pathNonFinite',
  'pathKind',
  'pathProfile',
  'pathPointCount',
  'pathBounds',
  'pathSegmentTooShort',
  'pathCurveTooTight',
  'pathGradeTooSteep',
  'chunkAllocation',
  'pathCommit',
  'roadPlanTruncated',
] as const;

export type MapGeneratedInstallError =
  | typeof NATIVE_GENERATED_INSTALL_ERRORS[number]
  | 'hostUnavailable'
  | 'hostFailure';

export type MapGeneratedInstallResult = {
  ok: boolean;
  error: MapGeneratedInstallError;
  chunks: number;
  paths: number;
  roads: number;
  rails: number;
};

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
  /** armed material binding (tile-binding table index; -1 = the kind's
   *  default look). Stamped per cell — neighboring tiles of one kind can
   *  wear different materials (req_2693). */
  bindIdx?: number;
}

export interface MapStrokeStats {
  samples: number;
  stamps: number;
  /** chunks dirtied by the stroke */
  touched: number;
  /** water stroke found no carved basin to fill (nudge: carve first) */
  waterDry: boolean;
}

export type MapAuthoringEventKind = 'stroke' | 'road.commit' | 'road.delete' | 'chunk.grow' | 'zone.drop' | 'tile.bindings' | 'path.control.add' | 'path.control.delete';
export type MapAuthoringEvent = {
  kind: MapAuthoringEventKind;
  tool: Required<MapTool>;
  stats: MapStrokeStats;
  start: { x: number; z: number };
  end: { x: number; z: number };
  durationMs: number;
  id: number;
  auxA: number;
  auxB: number;
  droppedBefore: number;
};

const AUTHORING_EVENT_KINDS: readonly MapAuthoringEventKind[] = ['stroke', 'road.commit', 'road.delete', 'chunk.grow', 'zone.drop', 'tile.bindings', 'path.control.add', 'path.control.delete'];
const MAP_EVENT_FLOATS = 32;

function enumValue<T>(items: readonly T[], raw: number | undefined, fallback: T): T {
  const idx = Math.max(0, Math.min(items.length - 1, Number.isFinite(raw) ? Math.trunc(raw!) : 0));
  return items[idx] ?? fallback;
}

function intValue(raw: number | undefined): number {
  return Number.isFinite(raw) ? Math.trunc(raw!) : 0;
}

/** Whether the host map binding is live (built with -Dhas-game-map). */
export function mapHostLive(): boolean {
  return hasHost('__map_stroke_begin');
}

/** Drop every authored map concern and DISABLE the prior autosave target. The
 * caller must explicitly bind a new target after loading/seeding a document. */
export function mapReset(): void {
  callHost('__map_reset', undefined);
}

/** Replace the native painting from one fully compiled generated-map payload.
 * Invalid input leaves the current map untouched. A failure after replacement
 * starts leaves an empty, unbound map; on success the caller explicitly saves
 * and binds the named map document. */
export function mapInstallGenerated(
  chunkRows: Float32Array,
  pathRows: Float32Array,
): MapGeneratedInstallResult {
  const empty = { chunks: 0, paths: 0, roads: 0, rails: 0 };
  if (!hasHost('__map_install_generated')) {
    return { ok: false, error: 'hostUnavailable', ...empty };
  }
  const buffer = callHost<ArrayBuffer | null>('__map_install_generated', null, chunkRows, pathRows);
  if (!buffer) return { ok: false, error: 'hostFailure', ...empty };
  const out = new Float32Array(buffer);
  if (out.length < 6) return { ok: false, error: 'hostFailure', ...empty };
  const errorCode = Math.trunc(out[1] ?? -1);
  const error = NATIVE_GENERATED_INSTALL_ERRORS[errorCode] ?? 'hostFailure';
  const ok = (out[0] ?? 0) >= 0.5 && error === 'none';
  return {
    ok,
    error: ok ? 'none' : error,
    chunks: Math.trunc(out[2] ?? 0),
    paths: Math.trunc(out[3] ?? 0),
    roads: Math.trunc(out[4] ?? 0),
    rails: Math.trunc(out[5] ?? 0),
  };
}

/** Allocate the chunk at (cx,cz). Returns false out-of-window. */
export function mapGrowChunk(cx: number, cz: number, record = true): boolean {
  return callHost<number>('__map_grow_chunk', 0, cx, cz, record ? 1 : 0) === 1;
}

export function mapChunkCount(): number {
  return callHost<number>('__map_chunk_count', 0);
}

/** Whether the host carries the chunk-list door (req_2703) — a hot-reloaded
 *  bundle on an older binary doesn't; the Add Chunk dialog says so honestly. */
export function mapChunkListLive(): boolean {
  return hasHost('__map_chunk_list');
}

/** Every grown chunk's coords plus the address window — the Add Chunk
 *  topology dialog's read (req_2703). */
export function mapChunkList(): { maxCol: number; maxRow: number; chunks: { cx: number; cz: number }[] } {
  const ab = callHost<ArrayBuffer | null>('__map_chunk_list', null);
  if (!ab) return { maxCol: 0, maxRow: 0, chunks: [] };
  const out = new Float32Array(ab);
  const count = out[2] ?? 0;
  const chunks: { cx: number; cz: number }[] = [];
  for (let i = 0; i < count; i += 1) chunks.push({ cx: out[3 + i * 2]!, cz: out[4 + i * 2]! });
  return { maxCol: out[0] ?? 0, maxRow: out[1] ?? 0, chunks };
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
  const buf = new Float32Array(18);
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
  buf[17] = tool.bindIdx ?? -1;
  callHost('__map_set_tool', undefined, buf);
}

/** The in-world brush gizmo and matching dab footprint. */
export function mapSetBrushGizmo(gizmo: MapBrushGizmo): void {
  callHost('__map_set_brush_gizmo', undefined, GIZMO_INDEX[gizmo]);
}

/** Push the cell channels' shader contract: a WGSL body defining
 *  `fn hf_ground_rgb(uv) -> vec3f` over the engine's D stream (layout v3:
 *  packed tile+flora+zone cells + the binding table + per-cell materials),
 *  plus the three palettes (rgb triples in legend order). Content — push once
 *  at UI rate. The formula is STATIC; picking materials rides
 *  mapSetTileBindings, never a formula re-push (req_2693). */
export function mapSetGroundLook(
  formulaWgsl: string,
  tilePaletteRgb: Float32Array,
  floraPaletteRgb: Float32Array,
  zonePaletteRgb: Float32Array,
): void {
  callHost('__map_set_ground_look', undefined, formulaWgsl, tilePaletteRgb, floraPaletteRgb, zonePaletteRgb);
}

/** Push the painted-material table (req_2693): count×4 opaque rows the ground
 *  formula dispatches on ([materialId, boardIndex, variant, jointFlag] for the
 *  editor catalog). Pure DATA — re-encodes chunk streams, never a shader
 *  rebuild. Persisted in the map file; mirror with mapGetTileBindings. */
export function mapSetTileBindings(rows: Float32Array, record = false): void {
  callHost('__map_set_tile_bindings', undefined, rows, record ? 1 : 0);
}

/** Read the live tile-binding table back (count×4 rows) — the chrome's mirror
 *  after mapLoadFile. */
export function mapGetTileBindings(): Float32Array {
  const ab = callHost<ArrayBuffer | null>('__map_get_tile_bindings', null);
  if (!ab) return new Float32Array(0);
  const raw = new Float32Array(ab);
  const count = raw[0] ?? 0;
  return raw.slice(1, 1 + count * 4);
}

/** Re-push just the zone palette (zones are user-authored and change mid-map). */
export function mapSetZonePalette(zonePaletteRgb: Float32Array): void {
  callHost('__map_set_zone_palette', undefined, zonePaletteRgb);
}

/** Delete zone list entry `index`: unzones its cells, shifts higher indices down. */
export function mapDropZone(index: number, record = true): void {
  callHost('__map_drop_zone', undefined, index, record ? 1 : 0);
}

/** Push the flora population contract: per kind [spec, count, chance] triples
 *  in append-only legend order. Recipe ids are validated by
 *  framework/world/foliage.zig; count is rows per painted cell for ground
 *  flora, chance is the per-cell whole-plant spawn gate. The loader's LIVE preview
 *  grows painted cells from this cart-owned content. */
export function mapSetFloraSpecs(specs: Float32Array): void {
  callHost('__map_set_flora_specs', undefined, specs);
}

// ── roads (ROADSTROKE-0610: click-authored recipes, host-compiled) ────────────
// While channel='road', viewport clicks lay draft centerline points host-side;
// these doors manage the draft lifecycle + the content mapping.

export type MapRoadProfile = { lanesF: number; lanesB: number; sidewalks: boolean };

export type MapPathKind = 'road' | 'lightRail' | 'railway';
export type MapPathProfile = MapRoadProfile & {
  kind: MapPathKind;
  tracks: number;
  curveRadiusM: number;
};
export type MapPathInvalidReason = 'none' | 'tooFewPoints' | 'segmentTooShort' | 'curveTooTight' | 'gradeTooSteep';
export type MapPathAuthoringTool = 'draw' | 'stop';

const PATH_KIND_INDEX: Record<MapPathKind, number> = { road: 0, lightRail: 1, railway: 2 };
const PATH_KINDS: readonly MapPathKind[] = ['road', 'lightRail', 'railway'];
const PATH_INVALID_REASONS: readonly MapPathInvalidReason[] = ['none', 'tooFewPoints', 'segmentTooShort', 'curveTooTight', 'gradeTooSteep'];

/** Arm the shared semantic path pen. Roads and rails share gesture/curve data;
 * their compiler/render policies remain distinct behind this boundary. */
export function mapPathSetProfile(profile: MapPathProfile): void {
  if (hasHost('__map_path_set_profile')) {
    callHost(
      '__map_path_set_profile', undefined,
      PATH_KIND_INDEX[profile.kind], profile.lanesF, profile.lanesB,
      profile.sidewalks ? 1 : 0, profile.tracks, profile.curveRadiusM,
    );
    return;
  }
  // Honest hot-reload fallback: an older host can still author roads, but it
  // cannot pretend to persist/render rail paths it does not understand.
  if (profile.kind === 'road') mapRoadSetProfile(profile);
}

export function mapPathSetTool(tool: MapPathAuthoringTool): void {
  callHost('__map_path_set_tool', undefined, tool === 'stop' ? 1 : 0);
}

/** Signed 3 m storey carried by the next accepted rail anchor. */
export function mapPathSetLevel(level: number): void {
  callHost('__map_path_set_level', undefined, Math.round(Number.isFinite(level) ? level : 0));
}

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

export function mapPathCommit(): number {
  return callHost<number>(hasHost('__map_path_commit') ? '__map_path_commit' : '__map_road_commit', 0);
}

export function mapPathCancel(): void {
  callHost(hasHost('__map_path_cancel') ? '__map_path_cancel' : '__map_road_cancel', undefined);
}

export function mapPathUndoPoint(): boolean {
  return callHost<number>('__map_path_undo', 0) === 1;
}

export function mapPathDelete(id: number): boolean {
  return callHost<number>(hasHost('__map_path_delete') ? '__map_path_delete' : '__map_road_delete', 0, id) === 1;
}

export function mapPathControlDelete(id: number): boolean {
  return callHost<number>('__map_path_control_delete', 0, id) === 1;
}

/** Save the whole painting to a file — the blob never crosses the bridge (the
 *  host RLE-serializes and writes directly). Roads persist as recipes. */
export function mapSaveFile(path: string): boolean {
  return callHost<number>('__map_save_file', 0, path) === 1;
}

/** Read inactive-map header stats without loading it into the host. */
export function mapInspectFile(path: string): { version: number; chunkCount: number } | null {
  if (!hasHost('__map_inspect_file')) return null;
  const ab = callHost<ArrayBuffer | null>('__map_inspect_file', null, path);
  if (!ab) return null;
  const out = new Float32Array(ab);
  if (out.length < 2 || !Number.isFinite(out[0]) || !Number.isFinite(out[1])) return null;
  return { version: Math.trunc(out[0]!), chunkCount: Math.trunc(out[1]!) };
}

/** Load a painting from a file; the host rebuilds every channel and re-derives
 *  the road stamps. False = missing or malformed file. */
export function mapLoadFile(path: string): boolean {
  return callHost<number>('__map_load_file', 0, path) === 1;
}

/** Register the painting's micro-save target (req_2765): from here on every
 *  mutating gesture — stroke end, road commit/delete, binding edit, zone drop,
 *  chunk growth — rewrites this file atomically host-side. False on a binary
 *  that predates the door (the manual Save button still works there). */
export function mapSetAutosaveFile(path: string): boolean {
  return callHost<number>('__map_set_autosave_file', 0, path) === 1;
}

export function mapRoadStats(): { strokes: number; draftPoints: number; planTruncated: boolean } {
  const ab = callHost<ArrayBuffer | null>('__map_road_stats', null);
  if (!ab) return { strokes: 0, draftPoints: 0, planTruncated: false };
  const out = new Float32Array(ab);
  return { strokes: out[0]!, draftPoints: out[1]!, planTruncated: out[2]! >= 0.5 };
}

export type MapPathStats = {
  paths: number;
  roads: number;
  rails: number;
  draftPoints: number;
  planTruncated: boolean;
  draftKind: MapPathKind | null;
  valid: boolean;
  invalidReason: MapPathInvalidReason;
  minCurveM: number | null;
  lastPathId: number;
  curveRadiusM: number;
  maxGrade: number;
  controls: number;
  lastControlId: number;
  controlPreviewPathId: number | null;
  controlPreviewDistanceM: number | null;
  controlPreviewValid: boolean;
  authoringTool: MapPathAuthoringTool;
  level: number;
};

export function mapPathStats(): MapPathStats {
  const ab = callHost<ArrayBuffer | null>('__map_path_stats', null);
  if (!ab) {
    const road = mapRoadStats();
    return {
      paths: road.strokes, roads: road.strokes, rails: 0,
      draftPoints: road.draftPoints, planTruncated: road.planTruncated,
      draftKind: road.draftPoints > 0 ? 'road' : null,
      valid: road.draftPoints >= 2, invalidReason: road.draftPoints >= 2 ? 'none' : 'tooFewPoints',
      minCurveM: null, lastPathId: 0, curveRadiusM: 0, maxGrade: 0,
      controls: 0, lastControlId: 0, controlPreviewPathId: null,
      controlPreviewDistanceM: null, controlPreviewValid: false,
      authoringTool: 'draw', level: 0,
    };
  }
  const out = new Float32Array(ab);
  const kindIndex = Math.trunc(out[5] ?? -1);
  const reasonIndex = Math.max(0, Math.min(PATH_INVALID_REASONS.length - 1, Math.trunc(out[7] ?? 0)));
  const minCurve = out[8] ?? -1;
  return {
    paths: Math.trunc(out[0] ?? 0),
    roads: Math.trunc(out[1] ?? 0),
    rails: Math.trunc(out[2] ?? 0),
    draftPoints: Math.trunc(out[3] ?? 0),
    planTruncated: (out[4] ?? 0) >= 0.5,
    draftKind: kindIndex >= 0 ? (PATH_KINDS[kindIndex] ?? null) : null,
    valid: (out[6] ?? 0) >= 0.5,
    invalidReason: PATH_INVALID_REASONS[reasonIndex]!,
    minCurveM: minCurve >= 0 ? minCurve : null,
    lastPathId: Math.trunc(out[9] ?? 0),
    curveRadiusM: out[10] ?? 0,
    maxGrade: out[11] ?? 0,
    controls: Math.trunc(out[12] ?? 0),
    lastControlId: Math.trunc(out[13] ?? 0),
    controlPreviewPathId: (out[14] ?? -1) >= 0 ? Math.trunc(out[14]!) : null,
    controlPreviewDistanceM: (out[15] ?? -1) >= 0 ? out[15]! : null,
    controlPreviewValid: (out[16] ?? 0) >= 0.5,
    authoringTool: (out[17] ?? 0) >= 0.5 ? 'stop' : 'draw',
    level: Math.trunc(out[18] ?? 0),
  };
}

export type MapHistoryKind = 'paintStroke' | 'pathCommit' | 'pathDelete' | 'controlAdd' | 'controlDelete' | 'tileBindings' | 'zoneDrop' | 'chunkGrow';
export type MapHistoryStats = { undo: number; redo: number; bytes: number; dropped: number };
export type MapHistoryResult = MapHistoryStats & { ok: boolean; kind: MapHistoryKind };

const MAP_HISTORY_KINDS: readonly MapHistoryKind[] = [
  'paintStroke', 'pathCommit', 'pathDelete', 'controlAdd',
  'controlDelete', 'tileBindings', 'zoneDrop', 'chunkGrow',
];

export function mapHistory(): MapHistoryStats {
  const ab = callHost<ArrayBuffer | null>('__map_history', null);
  if (!ab) return { undo: 0, redo: 0, bytes: 0, dropped: 0 };
  const out = new Float32Array(ab);
  return {
    undo: Math.trunc(out[0] ?? 0),
    redo: Math.trunc(out[1] ?? 0),
    bytes: Math.trunc(out[2] ?? 0),
    dropped: Math.trunc(out[3] ?? 0),
  };
}

function mapHistoryMutation(name: '__map_undo' | '__map_redo'): MapHistoryResult {
  const ab = callHost<ArrayBuffer | null>(name, null);
  if (!ab) return { ok: false, kind: 'paintStroke', undo: 0, redo: 0, bytes: 0, dropped: 0 };
  const out = new Float32Array(ab);
  const current = mapHistory();
  return {
    ok: (out[0] ?? 0) >= 0.5,
    kind: MAP_HISTORY_KINDS[Math.max(0, Math.min(MAP_HISTORY_KINDS.length - 1, Math.trunc(out[1] ?? 0)))]!,
    undo: Math.trunc(out[2] ?? current.undo),
    redo: Math.trunc(out[3] ?? current.redo),
    bytes: current.bytes,
    dropped: Math.trunc(out[4] ?? current.dropped),
  };
}

export function mapUndo(): MapHistoryResult {
  return mapHistoryMutation('__map_undo');
}

export function mapRedo(): MapHistoryResult {
  return mapHistoryMutation('__map_redo');
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

/** Completed native map-authoring actions since the last drain. Strokes land
 *  here whether they came through the JS stroke doors or the host-native
 *  WorldLoader pointer path. */
export function mapEventDrain(): MapAuthoringEvent[] {
  if (!hasHost('__map_event_drain')) return [];
  const ab = callHost<ArrayBuffer | null>('__map_event_drain', null);
  if (!ab) return [];
  const raw = new Float32Array(ab);
  const count = Math.max(0, Math.min(intValue(raw[0]), Math.floor((raw.length - 1) / MAP_EVENT_FLOATS)));
  const events: MapAuthoringEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = 1 + i * MAP_EVENT_FLOATS;
    events.push({
      kind: enumValue(AUTHORING_EVENT_KINDS, raw[base + 0], 'stroke'),
      tool: {
        channel: enumValue(CHANNELS, raw[base + 1], 'terrain'),
        mode: enumValue(MODES, raw[base + 2], 'paint'),
        terrainTool: enumValue(TERRAIN_TOOLS, raw[base + 3], 'brush'),
        shape: enumValue(SHAPES, raw[base + 4], 'circle'),
        profile: enumValue(PROFILES, raw[base + 5], 'cone'),
        radiusM: raw[base + 6] ?? 0,
        centerZ: raw[base + 7] ?? 0,
        rampMin: raw[base + 8] ?? 0,
        rampMax: raw[base + 9] ?? 0,
        rampWide: raw[base + 10] ?? 0,
        rampLong: raw[base + 11] ?? 0,
        rampAngleDeg: raw[base + 12] ?? 0,
        smoothStrength: raw[base + 13] ?? 0,
        kindIdx: intValue(raw[base + 14]),
        bindIdx: intValue(raw[base + 15]),
        floraKindIdx: intValue(raw[base + 16]),
        floraLane: intValue(raw[base + 17]),
        zoneIdx: intValue(raw[base + 18]),
      },
      start: { x: raw[base + 19] ?? 0, z: raw[base + 20] ?? 0 },
      end: { x: raw[base + 21] ?? 0, z: raw[base + 22] ?? 0 },
      stats: {
        samples: intValue(raw[base + 23]),
        stamps: intValue(raw[base + 24]),
        touched: intValue(raw[base + 25]),
        waterDry: (raw[base + 26] ?? 0) >= 0.5,
      },
      durationMs: raw[base + 27] ?? 0,
      id: intValue(raw[base + 28]),
      auxA: intValue(raw[base + 29]),
      auxB: intValue(raw[base + 30]),
      droppedBefore: intValue(raw[base + 31]),
    });
  }
  return events;
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
