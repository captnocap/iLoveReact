// packageMap.ts — hmsc-int Compile transcode to the platform package shape.

import type { GameState, GridCell, TileKind } from './design';
import { surfaceRegionAtCell } from './world/grid';
import {
  MAP_LUMP,
  base64ToBytes,
  bytesText,
  bytesToBase64,
  decodeBinaryRleGrid,
  decodeGrid,
  encodeBinaryRleGrid,
  encodeGrid,
  findLump,
  quantizeHeightfield,
  readLumpContainer,
  textBytes,
  type LumpInput,
  writeLumpContainer,
} from '@reactjit/workspace';
import { mkdir, writeFile, writeFileBase64Atomic } from '@reactjit/hooks/fs';
import { buildWorldInstances, encodeFloorHeightfields, encodeInstanceLump, encodeMaterialRefs, encodeMaterials, encodeMeshProps, encodeWaterBodies } from './compile/worldGeometry';
import type { DecalAssetSink } from './compile/decalAssets';
import { buildBakedColliders, encodeCollidersLump, encodePhysicsConfigLump, paintedFloorTopAt, type BakedPhysicsConfig } from './compile/worldColliders';
import { encodeStatsConfigLump } from './compile/playerStats';
import { encodeInteractables } from './compile/worldInteractables';
import { encodeDynamicProps } from './compile/worldDynamicProps';
import { elevatorShaftRecords, encodeElevators } from './compile/worldElevators';
import { doorRecords, encodeDoors } from './compile/worldDoors';
import { tickerRecords, encodeTickers } from './compile/worldTicker';
import { DEFAULT_SCENE_ENVIRONMENT, encodeEnvironmentLump, type SceneEnvironment } from './compile/sceneEnv';
import { buildDefaultPlayerAnimation, buildDefaultPlayerModel, encodePlayerAnimationLump, encodePlayerModelLump } from './compile/playerModel';
import type { ChunkFloor } from './chunkFloor';
import { GAME_BUILD, GAME_WORLD, type PlacedBuildPiece } from '@game';

// Terrain top (metres) under a world point — the SAME column the editor's
// groundColumnTop computes (surface-region tops + landform field), replicated here so
// the compile doesn't pull the React editor module. Buildings bake onto THIS so the
// shipped game stands them exactly where the build pane drew them (req_0444 flat pad).
function compileTerrainTopAt(world: GameState['world'], x: number, z: number): number {
  let top = 0;
  const c = world.cellSizeMeters;
  for (const r of world.surfaceRegions) {
    if (x >= r.x * c && x <= (r.x + r.width) * c && z >= r.z * c && z <= (r.z + r.depth) * c) {
      top = Math.max(top, GAME_WORLD.surfaceRegionTopMeters(r as Parameters<typeof GAME_WORLD.surfaceRegionTopMeters>[0], c));
    }
  }
  return Math.max(top, GAME_WORLD.landformGroundTopAt(world as Parameters<typeof GAME_WORLD.landformGroundTopAt>[0], x, z) ?? top);
}

export const DEFAULT_HMSC_PACKAGE_DIR = 'cart/hmsc-int/exports/hmsc.rjpkg';
export const DEFAULT_HMSC_MAP_NAME = 'city';

export type HmscPackageManifest = {
  id: string;
  name: string;
  version: number;
  minPlatformVersion: string;
  entryMap: string;
  bundle: string;
  maps: string[];
  assets: string[];
};

export type HmscMapBounds = {
  minX: number;
  minZ: number;
  width: number;
  depth: number;
};

export type HmscMapFacts = {
  sessionName: string;
  layoutKey: string;
  bounds: HmscMapBounds;
  surfaceRegions: number;
  placedCells: number;
  props: number;
  zones: string[];
  tileSamples: string[];
  heightSamples: number[];
};

function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
}

function mapBounds(state: GameState): HmscMapBounds {
  let minX = 0;
  let minZ = 0;
  let maxX = state.world.layout.widthCells;
  let maxZ = state.world.layout.depthCells;
  for (const region of state.world.surfaceRegions) {
    minX = Math.min(minX, region.x);
    minZ = Math.min(minZ, region.z);
    maxX = Math.max(maxX, region.x + region.width);
    maxZ = Math.max(maxZ, region.z + region.depth);
  }
  for (const cell of Object.values(state.world.placedCells)) {
    minX = Math.min(minX, cell.cell.x);
    minZ = Math.min(minZ, cell.cell.z);
    maxX = Math.max(maxX, cell.cell.x + 1);
    maxZ = Math.max(maxZ, cell.cell.z + 1);
  }
  return { minX, minZ, width: maxX - minX, depth: maxZ - minZ };
}

function tileKindAt(state: GameState, cell: GridCell): TileKind | null {
  const placed = state.world.placedCells[`${cell.x},${cell.y},${cell.z}`];
  if (placed) return placed.kind;
  return surfaceRegionAtCell(state, cell)?.kind ?? null;
}

function stringTable(state: GameState): string[] {
  const strings = new Set<string>();
  for (const region of state.world.surfaceRegions) strings.add(region.kind);
  for (const cell of Object.values(state.world.placedCells)) strings.add(cell.kind);
  for (const zone of state.world.zones) strings.add(zone.id);
  for (const zone of state.world.zones) strings.add(zone.name);
  for (const prop of state.world.props) strings.add(prop.id);
  return ['null', ...Array.from(strings).filter((value) => value !== 'null').sort()];
}

function stringsText(strings: string[]): string {
  return strings.map((value, index) => `${index}\t${value}`).join('\n') + '\n';
}

function parseStrings(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    out[Number(line.slice(0, tab))] = line.slice(tab + 1);
  }
  return out;
}

function tileGrid(state: GameState, bounds: HmscMapBounds, strings: string[]): Array<number | null> {
  const stringIndex = new Map(strings.map((value, index) => [value, index]));
  const values: Array<number | null> = [];
  for (let z = bounds.minZ; z < bounds.minZ + bounds.depth; z += 1) {
    for (let x = bounds.minX; x < bounds.minX + bounds.width; x += 1) {
      const kind = tileKindAt(state, { x, y: 0, z });
      values.push(kind ? stringIndex.get(kind) ?? null : null);
    }
  }
  return values;
}

function zeroHeights(bounds: HmscMapBounds): number[] {
  return new Array(bounds.width * bounds.depth).fill(0);
}

function entitiesText(state: GameState, bounds: HmscMapBounds): string {
  const stateJson = sortedJson(state);
  return [
    'format=hmsc.entities.v0',
    `state_json_base64=${bytesToBase64(textBytes(stateJson))}`,
    `bounds=${JSON.stringify(bounds)}`,
    '',
  ].join('\n');
}

export function hmscStateFromEntitiesText(text: string): GameState | null {
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    if (key !== 'state_json_base64') continue;
    return JSON.parse(bytesText(base64ToBytes(line.slice(eq + 1)))) as GameState;
  }
  return null;
}

export function createHmscMapfile(
  state: GameState,
  pieces: readonly PlacedBuildPiece[] = [],
  floors: readonly ChunkFloor[] = [],
  env: SceneEnvironment = DEFAULT_SCENE_ENVIRONMENT,
  opts: { includePlayerLumps?: boolean; decalAssets?: DecalAssetSink } = {},
): Uint8Array {
  const bounds = mapBounds(state);
  const strings = stringTable(state);
  const tiles = encodeGrid(tileGrid(state, bounds, strings), bounds.width, bounds.depth);
  const heights = quantizeHeightfield(zeroHeights(bounds), bounds.width, bounds.depth);
  const zones = {
    bounds,
    zones: state.world.zones,
  };
  const placements = {
    props: state.world.props,
    placedCells: Object.values(state.world.placedCells).sort((a, b) => a.key.localeCompare(b.key)),
    landforms: state.world.landforms,
  };

  // Flat-pad terrain lift (req_0444): stamp-grouped buildings bake onto the terrain
  // under their footprint, the SAME idempotent transform the build pane draws with — so
  // the shipped game stands every building exactly where the editor showed it. Applied
  // ONCE here so BOTH the render geometry and the physics colliders below use the lifted
  // positions (see-it == walk-it). Loose single pieces keep their authored y.
  // The bake's ONE terrain surface (req_0630): the GameState landform tops
  // joined with the PAINTED FLOORS' walkable surface — the live painted hill
  // exists ONLY in the session floors (the same grids the HEIGHTFIELDS lump
  // ships), so a lift that samples landforms alone leaves a tree on a hill
  // buried at y=0.
  const bakeTerrainTopAt = (x: number, z: number): number =>
    Math.max(compileTerrainTopAt(state.world, x, z), paintedFloorTopAt(floors, x, z) ?? 0);
  const liftedBuildings = GAME_BUILD.placed.liftToTerrain(pieces, bakeTerrainTopAt);
  // Props are free-standing objects (req_0625, USER report "props in general
  // are not respecting heightfields"): a stored y=0 prop under a painted hill
  // rests ON the terrain at its anchor — the SAME per-prop lift /test applies
  // (PlayRoute liftPropsToTerrain), so render, colliders, interactables, and
  // dynamic-body anchors below all see the lifted y.
  const liftedPieces = GAME_BUILD.placed.liftPropsToTerrain(liftedBuildings, bakeTerrainTopAt);

  // The authored world's 3D geometry: the placed pieces (structures) PLUS the
  // painted floor (the user's real ground, from chunk tile fields). The piece
  // count rides in the lump so the loader frames the camera on the structures.
  // `decalAssets` (DECALIMG-0610) collects decal image payloads as content-
  // addressed assets while the materials intern — the gamefile bake ships them.
  const geometry = buildWorldInstances(state, liftedPieces, floors, { decalAssets: opts.decalAssets });
  const instances = encodeInstanceLump(geometry.instances, geometry.pieces);
  const materials = encodeMaterials(geometry.materials);
  const materialRefs = encodeMaterialRefs(geometry.materialRefs);
  const heightfields = encodeFloorHeightfields(floors);

  // The AUTHORED physics colliders — the same +-join-aware solids the editor's
  // play view steps against (placedPieceColliders / placedPieceRamps), so a "+"
  // wall collides where it looks instead of where the render boxes happened to
  // land — PLUS one collision heightfield per FLAT painted chunk, so the painted
  // ground travels as a handful of heightfields instead of thousands of per-cell
  // rects (which blew the host rect cap). Field slots start after the relief
  // heightfields the HEIGHTFIELDS lump owns. See compile/worldColliders.ts.
  const colliders = encodeCollidersLump(buildBakedColliders(liftedPieces, floors, floors.length));
  // The player physics config the editor play view uses (state.config.physics +
  // the active player's walk/run speed), baked so the shipped game moves and
  // collides identically instead of re-declaring constants in world_loader.zig.
  const ph = state.config.physics;
  const physicsConfig: BakedPhysicsConfig = {
    tuning: {
      gravityMetersPerSecondSquared: ph.gravityMetersPerSecondSquared,
      jumpSpeedMetersPerSecond: ph.jumpSpeedMetersPerSecond,
      playerCapsuleRadiusMeters: ph.playerCapsuleRadiusMeters,
      playerCapsuleHeightMeters: ph.playerCapsuleHeightMeters,
      playerStepHeightMeters: ph.playerStepHeightMeters,
      wallRestitution: ph.wallRestitution,
      bodyRestitution: ph.bodyRestitution,
      walkableRectSidePushGraceMeters: 0.08,
    },
    // Flat surface baseline; per-tile surface feel (movementSurfaceForPlayer) is
    // a /test refinement not yet carried into the shipped path.
    accelerationMultiplier: 1.0,
    surfaceFriction: 0.2,
    surfaceRestitution: 0.0,
    walkSpeedMetersPerSecond: state.player.walkSpeedMetersPerSecond,
    runSpeedMetersPerSecond: state.player.runSpeedMetersPerSecond,
  };
  const physics = encodePhysicsConfigLump(physicsConfig);

  const includePlayerLumps = opts.includePlayerLumps ?? true;
  const playerModelData = includePlayerLumps ? buildDefaultPlayerModel() : null;
  const playerModel = playerModelData ? encodePlayerModelLump(playerModelData) : null;
  const playerAnimation = playerModelData ? encodePlayerAnimationLump(buildDefaultPlayerAnimation(playerModelData.groups.length)) : null;

  const lumps: LumpInput[] = [
    { type: MAP_LUMP.STRINGS, encoding: 'text', data: textBytes(stringsText(strings)) },
    { type: MAP_LUMP.TILES, encoding: 'rle16', data: encodeBinaryRleGrid(tiles, 16) },
    { type: MAP_LUMP.HEIGHTS, encoding: 'rle16', data: encodeBinaryRleGrid(heights.quantized, 16) },
    { type: MAP_LUMP.ZONES, encoding: 'text', data: textBytes(sortedJson(zones)) },
    { type: MAP_LUMP.PLACEMENTS, encoding: 'text', data: textBytes(sortedJson(placements)) },
    { type: MAP_LUMP.ENTITIES, encoding: 'text', data: textBytes(entitiesText(state, bounds)) },
    // The authored world's 3D geometry, lowered to a packed instance buffer the
    // stateless loader renders with zero V8 (compile/worldGeometry.ts).
    { type: MAP_LUMP.INSTANCES, encoding: 'raw', data: instances },
    // The materials the faces wear, shipped as SHADER RECIPES (not pixels), plus
    // the per-row reference into them. The loader runs each shader to a texture
    // at load and samples it on the referencing faces (compile/worldGeometry.ts).
    { type: MAP_LUMP.MATERIALS, encoding: 'raw', data: materials },
    { type: MAP_LUMP.MATERIAL_REFS, encoding: 'raw', data: materialRefs },
    // The scene render environment (lighting / sky / camera) as DATA — the
    // loader reads this instead of hardcoding the look (compile/sceneEnv.ts).
    { type: MAP_LUMP.ENVIRONMENT, encoding: 'raw', data: encodeEnvironmentLump(env) },
    { type: MAP_LUMP.HEIGHTFIELDS, encoding: 'raw', data: heightfields },
    // The authored physics solids + player config (see above) — the loader steps
    // against THESE, not a guess re-derived from the render boxes.
    { type: MAP_LUMP.COLLIDERS, encoding: 'raw', data: colliders },
    { type: MAP_LUMP.PHYSICS_CONFIG, encoding: 'raw', data: physics },
    // The prop interaction layer (seat/container archetypes + instance refs) —
    // E-to-sit/search in the compiled game (compile/worldInteractables.ts).
    { type: MAP_LUMP.INTERACTABLES, encoding: 'raw', data: encodeInteractables(geometry.interactables) },
    // Kickable dynamic props (sphere bodies + local render parts) — balls
    // roll and cones shove in the compiled game (compile/worldDynamicProps.ts).
    { type: MAP_LUMP.DYNAMIC_PROPS, encoding: 'raw', data: encodeDynamicProps(geometry.dynamicProps) },
    // Elevator shafts (REQ-0652) — the loader appends one LIVE car rect per
    // shaft and rides it: E to ride/call, /test parity (compile/worldElevators.ts).
    { type: MAP_LUMP.ELEVATORS, encoding: 'raw', data: encodeElevators(elevatorShaftRecords(liftedPieces)) },
    // Door panels (DOORS-0611) — the loader appends one LIVE toggleable rect +
    // panel node per door: E opens/closes, /test parity (compile/worldDoors.ts).
    { type: MAP_LUMP.DOORS, encoding: 'raw', data: encodeDoors(doorRecords(liftedPieces)) },
    // LED ticker boards (req_0893 #3) — the loader scrolls the message + draws
    // the lit LEDs per frame, the elevator-car pattern (compile/worldTicker.ts).
    { type: MAP_LUMP.TICKER, encoding: 'raw', data: encodeTickers(tickerRecords(liftedPieces)) },
    // Imported OBJ/GLB props — arbitrary baked vertex buffers as static prop
    // assets, referenced by transform rows so repeated desks share one mesh.
    { type: MAP_LUMP.MESH_PROPS, encoding: 'raw', data: encodeMeshProps(geometry.meshProps) },
    // Bodies of water (world/water) — the loader renders each as a translucent
    // heightfield with a host-clock travelling wave (animated ripples).
    { type: MAP_LUMP.WATER, encoding: 'raw', data: encodeWaterBodies(state.world.waterBodies) },
    // Player-stats config (GAME_STATS) — the flat stat tuning the loader seeds
    // the compiled player's stats from (compile/playerStats.ts). The config
    // carries end to end; the engine stays dumb.
    { type: MAP_LUMP.STATS_CONFIG, encoding: 'raw', data: encodeStatsConfigLump() },
  ];
  if (playerModel) {
    // The compiled player figure from @game/figure. Runtime movement changes
    // only the player transform; the model itself is data.
    lumps.push({ type: MAP_LUMP.PLAYER_MODEL, encoding: 'raw', data: playerModel });
  }
  if (playerAnimation) {
    // Content-addressed transform clips for the compiled player figure.
    lumps.push({ type: MAP_LUMP.PLAYER_ANIMATION, encoding: 'raw', data: playerAnimation });
  }
  return writeLumpContainer(lumps);
}

export function hmscManifest(): HmscPackageManifest {
  return {
    id: 'hmsc',
    name: 'Hitman Shitcity',
    version: 0,
    minPlatformVersion: 'platmod-slice1-v0',
    entryMap: `${DEFAULT_HMSC_MAP_NAME}.map`,
    bundle: 'bundle.js',
    maps: [`maps/${DEFAULT_HMSC_MAP_NAME}.map`],
    assets: [],
  };
}

export function writeHmscPackageFromState(state: GameState, packageDir = DEFAULT_HMSC_PACKAGE_DIR): HmscPackageManifest {
  const manifest = hmscManifest();
  mkdir(packageDir);
  mkdir(`${packageDir}/maps`);
  mkdir(`${packageDir}/assets`);
  writeFile(`${packageDir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  const mapBytes = createHmscMapfile(state);
  if (!writeFileBase64Atomic(`${packageDir}/maps/${DEFAULT_HMSC_MAP_NAME}.map`, bytesToBase64(mapBytes))) {
    throw new Error(`failed to write binary mapfile: ${packageDir}/maps/${DEFAULT_HMSC_MAP_NAME}.map`);
  }
  return manifest;
}

export function factsFromGameState(state: GameState): HmscMapFacts {
  const bounds = mapBounds(state);
  const sampleCells = [
    { x: bounds.minX, y: 0, z: bounds.minZ },
    { x: 0, y: 0, z: 0 },
    { x: bounds.minX + bounds.width - 1, y: 0, z: bounds.minZ + bounds.depth - 1 },
  ];
  return {
    sessionName: state.sessionName,
    layoutKey: state.world.layout.key,
    bounds,
    surfaceRegions: state.world.surfaceRegions.length,
    placedCells: Object.keys(state.world.placedCells).length,
    props: state.world.props.length,
    zones: state.world.zones.map((zone) => zone.id).sort(),
    tileSamples: sampleCells.map((cell) => tileKindAt(state, cell) ?? 'null'),
    heightSamples: [0, 0, 0],
  };
}

export function factsFromMapfile(bytes: Uint8Array): HmscMapFacts {
  const records = readLumpContainer(bytes, { knownTypes: new Set(Object.values(MAP_LUMP)) });
  const strings = parseStrings(bytesText(findLump(records, MAP_LUMP.STRINGS)!.data));
  const zones = JSON.parse(bytesText(findLump(records, MAP_LUMP.ZONES)!.data)) as { bounds: HmscMapBounds; zones: Array<{ id: string }> };
  const placements = JSON.parse(bytesText(findLump(records, MAP_LUMP.PLACEMENTS)!.data)) as {
    props: unknown[];
    placedCells: unknown[];
  };
  const state = hmscStateFromEntitiesText(bytesText(findLump(records, MAP_LUMP.ENTITIES)!.data));
  if (!state) throw new Error('mapfile missing hmsc state entity payload');
  const tileValues = decodeGrid(decodeBinaryRleGrid(findLump(records, MAP_LUMP.TILES)!.data, 16));
  const heightValues = decodeGrid(decodeBinaryRleGrid(findLump(records, MAP_LUMP.HEIGHTS)!.data, 16));
  const bounds = zones.bounds;
  const sampleOffsets = [
    0,
    (0 - bounds.minZ) * bounds.width + (0 - bounds.minX),
    bounds.width * bounds.depth - 1,
  ];
  return {
    sessionName: state.sessionName,
    layoutKey: state.world.layout.key,
    bounds,
    surfaceRegions: state.world.surfaceRegions.length,
    placedCells: placements.placedCells.length,
    props: placements.props.length,
    zones: zones.zones.map((zone) => zone.id).sort(),
    tileSamples: sampleOffsets.map((index) => {
      const value = tileValues[index];
      return value === null || value === undefined ? 'null' : strings[value] ?? 'null';
    }),
    heightSamples: sampleOffsets.map((index) => heightValues[index] ?? 0),
  };
}
