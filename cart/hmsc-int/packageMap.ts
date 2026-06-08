// packageMap.ts — hmsc-int Compile transcode to the platform package shape.

import type { GameState, GridCell, TileKind } from '../hmsc/design';
import { surfaceRegionAtCell } from '../hmsc/world/grid';
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
  writeLumpContainer,
} from '@reactjit/workspace';
import { mkdir, writeFile, writeFileBase64Atomic } from '@reactjit/hooks/fs';
import { buildWorldInstances, encodeInstanceLump } from './compile/worldGeometry';
import { DEFAULT_SCENE_ENVIRONMENT, encodeEnvironmentLump, type SceneEnvironment } from './compile/sceneEnv';
import type { PlacedBuildPiece } from '@game';

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
  env: SceneEnvironment = DEFAULT_SCENE_ENVIRONMENT,
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

  // The authored world's 3D geometry: the painted GameState layers PLUS the
  // build stream's placed pieces (the towers/structures /test renders). The
  // piece count rides in the lump so the loader frames the camera on the city.
  const geometry = buildWorldInstances(state, pieces);
  const instances = encodeInstanceLump(geometry.instances, geometry.pieces);

  return writeLumpContainer([
    { type: MAP_LUMP.STRINGS, encoding: 'text', data: textBytes(stringsText(strings)) },
    { type: MAP_LUMP.TILES, encoding: 'rle16', data: encodeBinaryRleGrid(tiles, 16) },
    { type: MAP_LUMP.HEIGHTS, encoding: 'rle16', data: encodeBinaryRleGrid(heights.quantized, 16) },
    { type: MAP_LUMP.ZONES, encoding: 'text', data: textBytes(sortedJson(zones)) },
    { type: MAP_LUMP.PLACEMENTS, encoding: 'text', data: textBytes(sortedJson(placements)) },
    { type: MAP_LUMP.ENTITIES, encoding: 'text', data: textBytes(entitiesText(state, bounds)) },
    // The authored world's 3D geometry, lowered to a packed instance buffer the
    // stateless loader renders with zero V8 (compile/worldGeometry.ts).
    { type: MAP_LUMP.INSTANCES, encoding: 'raw', data: instances },
    // The scene render environment (lighting / sky / camera) as DATA — the
    // loader reads this instead of hardcoding the look (compile/sceneEnv.ts).
    { type: MAP_LUMP.ENVIRONMENT, encoding: 'raw', data: encodeEnvironmentLump(env) },
  ]);
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
