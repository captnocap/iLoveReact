// Fart Racer's authored starter world — Gastown.
//
// The generated RMAP owns the circuit, the landscape it cuts through, and the
// ground/foliage painting; the sibling WorldSave owns the placed model
// packages, the city's build pieces, and the drive-thru trigger. Home and
// checkpoint markers are added after installation from the NATIVE path sampler
// (AppFrame), so this module never carries a second approximation of the
// committed road geometry.
//
// Shape of the world, in one place:
//   fartRacerTrack.ts    the circuit, and every query derived from it
//   fartRacerTerrain.ts  relief, ground tiles, foliage — all keyed off the track
//   fartRacerCity.ts     Gastown's blocks, lots, and street furniture
//   this file            packs those into the native wire and the world save
import { MAP_GENERATED_WIRE } from '../../../runtime/game/map';
import type { BlueprintTable, VehicleAttachment } from '../model/blueprintTable';
import { emptyWorldSave, type WorldSave } from './worldStore';
import { driveThruMarker } from '../world/worldMarkers';
import { TRACK_POINTS, TRACK_PROFILE, trackProximity } from './fartRacerTrack';
import { surfacePaintAt, terrainHeightAt, type TerrainPad } from './fartRacerTerrain';
import { cityArchitecture, cityPads, cityPieces } from './fartRacerCity';

export type FartRacerBaselineCandidate = Readonly<{
  packageId: string;
  pieceId: string;
  blueprint: BlueprintTable;
}>;

export type FartRacerBaselineAssets = Readonly<{
  vehicles: readonly [FartRacerBaselineCandidate, FartRacerBaselineCandidate, FartRacerBaselineCandidate];
  food: FartRacerBaselineCandidate;
}>;

export type FartRacerBaselinePaintingStream = Readonly<{
  manifest: Float32Array;
  paths: Float32Array;
  chunkCount: number;
  packChunk(index: number): Float32Array;
}>;

/** Legend indices resolved against the LIVE append-only catalogs by the caller.
 *  Order matches TERRAIN_TILE_KINDS / TERRAIN_FLORA_KINDS — the data compiler
 *  never hardcodes a catalog index. */
export type FartRacerLegend = Readonly<{
  tiles: readonly number[];
  grass: readonly number[];
  tree: readonly number[];
  bush: readonly number[];
}>;

type RatedVehicle = Readonly<{
  candidate: FartRacerBaselineCandidate;
  topSpeedRating: number;
  accelerationRating: number;
}>;

/** Every behavior-affecting baseline number lives here: world extent, grid, and
 * placement policy remain reviewable without hunting through the packer. */
export const FART_RACER_BASELINE_TUNING = Object.freeze({
  wire: Object.freeze({
    emptyCell: -1,
    chunkMeters: 120,
    sampleColumns: 241,
    tileColumns: 120,
    cellChannelCount: 5,
    pathKindRoad: 0,
    pathPointFloats: 3,
  }),
  /** 4x4 chunks = a 480 m square. The circuit uses the middle of it and the
   *  landscape runs out to the edges, so the horizon is never the map's end. */
  chunks: Object.freeze({
    minX: 0,
    maxX: 3,
    minZ: 0,
    maxZ: 3,
  }),
  track: Object.freeze({
    id: TRACK_PROFILE.id,
    points: TRACK_POINTS,
    lanesForward: TRACK_PROFILE.lanesForward,
    lanesBackward: TRACK_PROFILE.lanesBackward,
    sidewalks: TRACK_PROFILE.sidewalks,
    tracks: TRACK_PROFILE.tracks,
    curveRadiusM: TRACK_PROFILE.curveRadiusM,
    speedLimitKph: TRACK_PROFILE.speedLimitKph,
  }),
  placements: Object.freeze({
    /** A staggered grid behind the start/finish line on the main straight,
     *  facing +X down the straight. */
    vehicles: Object.freeze([
      Object.freeze({ x: 84, z: 86, yawDegrees: 90 }),
      Object.freeze({ x: 84, z: 94, yawDegrees: 90 }),
      Object.freeze({ x: 98, z: 90, yawDegrees: 90 }),
    ]),
    /** The drive-thru sits in its own apron off the east back straight, one
     *  car-width from the racing line so a stop costs real time. */
    driveThru: Object.freeze({ x: 452, z: 214 }),
  }),
});

/** The drive-thru apron, flattened like a building lot so the prop and its
 *  trigger sit on level ground. */
const DRIVE_THRU_PAD: TerrainPad = Object.freeze({
  x: FART_RACER_BASELINE_TUNING.placements.driveThru.x,
  z: FART_RACER_BASELINE_TUNING.placements.driveThru.z,
  halfX: 14,
  halfZ: 16,
  heightM: trackProximity(
    FART_RACER_BASELINE_TUNING.placements.driveThru.x,
    FART_RACER_BASELINE_TUNING.placements.driveThru.z,
  ).elevationM,
});

let padCache: readonly TerrainPad[] | null = null;

/** Every flattened lot in the world — the city's blocks plus the drive-thru
 *  apron. Built once: the terrain sampler visits it a million times. */
export function fartRacerPads(): readonly TerrainPad[] {
  if (!padCache) padCache = [...cityPads(), DRIVE_THRU_PAD];
  return padCache;
}

/** Ground height at a world point in this world. The single sampler every
 *  placement, pad, and packed height agrees with. */
export function fartRacerGroundHeight(x: number, z: number): number {
  return terrainHeightAt(x, z, fartRacerPads());
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function documentVehicle(candidate: FartRacerBaselineCandidate): RatedVehicle | null {
  const attachment = candidate.blueprint.stats.find((row) =>
    row.profile.id === 'rj.profile.vehicle' && row.scope.kind === 'document') as VehicleAttachment | undefined;
  if (!attachment || !finiteNonnegative(attachment.topSpeedRating) || !finiteNonnegative(attachment.accelerationRating)) return null;
  return {
    candidate,
    topSpeedRating: attachment.topSpeedRating,
    accelerationRating: attachment.accelerationRating,
  };
}

function completeFood(candidate: FartRacerBaselineCandidate): boolean {
  const extension = candidate.blueprint.extensions['com.captnocap.fartracer'];
  if (!extension || typeof extension !== 'object' || Array.isArray(extension)) return false;
  const row = extension as Record<string, unknown>;
  return finiteNonnegative(row.gasYieldL)
    && finiteNonnegative(row.digestSeconds)
    && finiteNonnegative(row.bowelLoad);
}

/** Resolve package-authored content without names, model ids, or source-tool
 * assumptions. The chosen vehicle triple maximizes both gameplay-rating spans;
 * final target-specific minimums remain enforced by the exporter. */
export function chooseFartRacerBaselineAssets(
  candidates: readonly FartRacerBaselineCandidate[],
): FartRacerBaselineAssets {
  const unique = new Map<string, FartRacerBaselineCandidate>();
  for (const candidate of candidates) {
    if (!candidate.packageId || !candidate.pieceId || unique.has(candidate.packageId)) continue;
    unique.set(candidate.packageId, candidate);
  }
  const ordered = [...unique.values()].sort((left, right) => left.packageId.localeCompare(right.packageId));
  const vehicles = ordered.map(documentVehicle).filter((row): row is RatedVehicle => row !== null);
  if (vehicles.length < 3) throw new Error(`needs three placeable document-scoped vehicle blueprints; found ${vehicles.length}`);
  const foods = ordered.filter(completeFood);
  if (foods.length < 1) throw new Error('needs one placeable food blueprint with gasYieldL, digestSeconds, and bowelLoad');

  let best: readonly [RatedVehicle, RatedVehicle, RatedVehicle] | null = null;
  let bestScore = -1;
  for (let first = 0; first < vehicles.length - 2; first += 1) {
    for (let second = first + 1; second < vehicles.length - 1; second += 1) {
      for (let third = second + 1; third < vehicles.length; third += 1) {
        const triple = [vehicles[first]!, vehicles[second]!, vehicles[third]!] as const;
        const speeds = triple.map((row) => row.topSpeedRating);
        const accelerations = triple.map((row) => row.accelerationRating);
        const score = Math.max(...speeds) - Math.min(...speeds)
          + Math.max(...accelerations) - Math.min(...accelerations);
        if (score > bestScore) { best = triple; bestScore = score; }
      }
    }
  }
  if (!best) throw new Error('could not choose a distinct vehicle triple');
  return {
    vehicles: [best[0].candidate, best[1].candidate, best[2].candidate],
    food: foods[0]!,
  };
}

export function fartRacerBaselineWorldSave(
  stem: string,
  startingSeq: number,
  assets: FartRacerBaselineAssets,
): WorldSave {
  if (!Number.isSafeInteger(startingSeq) || startingSeq < 1) {
    throw new Error('Fart Racer starting sequence must be a positive safe integer');
  }
  const city = cityPieces(fartRacerGroundHeight);
  const save = emptyWorldSave(stem, startingSeq + assets.vehicles.length + 2);
  save.pieces = assets.vehicles.map((vehicle, index) => {
    const at = FART_RACER_BASELINE_TUNING.placements.vehicles[index]!;
    return {
      id: `fart-racer-vehicle-${startingSeq + index}`,
      pieceId: vehicle.pieceId,
      x: at.x,
      y: fartRacerGroundHeight(at.x, at.z),
      z: at.z,
      yawDegrees: at.yawDegrees,
      floor: 0,
    };
  });
  const foodSeq = startingSeq + assets.vehicles.length;
  const driveThru = FART_RACER_BASELINE_TUNING.placements.driveThru;
  const driveThruAt = { x: driveThru.x, y: fartRacerGroundHeight(driveThru.x, driveThru.z), z: driveThru.z };
  save.pieces.push({
    id: `fart-racer-food-${foodSeq}`,
    pieceId: assets.food.pieceId,
    ...driveThruAt,
    yawDegrees: 0,
    floor: 0,
  });
  // Gastown itself. Its shells are ordinary architecture wall edges and its
  // roofs ordinary placed pieces — the editor opens this map and every wall of
  // it is draggable.
  save.architecture = cityArchitecture(fartRacerGroundHeight);
  for (const piece of city) {
    save.pieces.push({
      id: piece.id,
      pieceId: piece.pieceId,
      x: piece.x,
      y: piece.y,
      z: piece.z,
      yawDegrees: piece.yawDegrees,
      floor: piece.floor,
    });
  }
  save.markers = [driveThruMarker(
    `fart-racer-drive-thru-${foodSeq + 1}`,
    driveThruAt,
    assets.food.packageId,
  )];
  return save;
}

function baselineChunks(): readonly Readonly<{ cx: number; cz: number }>[] {
  const bounds = FART_RACER_BASELINE_TUNING.chunks;
  const chunks: { cx: number; cz: number }[] = [];
  for (let cz = bounds.minZ; cz <= bounds.maxZ; cz += 1) {
    for (let cx = bounds.minX; cx <= bounds.maxX; cx += 1) chunks.push({ cx, cz });
  }
  return chunks;
}

function packPaths(): Float32Array {
  const track = FART_RACER_BASELINE_TUNING.track;
  const wire = FART_RACER_BASELINE_TUNING.wire;
  const rows = new Float32Array(MAP_GENERATED_WIRE.pathHeaderFloats
    + MAP_GENERATED_WIRE.pathRecordHeaderFloats
    + track.points.length * wire.pathPointFloats);
  let at = 0;
  rows[at++] = MAP_GENERATED_WIRE.version;
  rows[at++] = 1;
  rows[at++] = wire.pathKindRoad;
  rows[at++] = track.lanesForward;
  rows[at++] = track.lanesBackward;
  rows[at++] = track.sidewalks ? 1 : 0;
  rows[at++] = track.tracks;
  rows[at++] = track.curveRadiusM;
  rows[at++] = track.speedLimitKph;
  rows[at++] = track.points.length;
  for (const point of track.points) {
    rows[at++] = point.x;
    rows[at++] = point.z;
    rows[at++] = point.elevationM;
  }
  if (at !== rows.length) throw new Error(`Fart Racer path pack wrote ${at} floats into ${rows.length}`);
  return rows;
}

function legendIndex(table: readonly number[], slot: number, what: string): number {
  const index = table[slot];
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    throw new Error(`Fart Racer world needs ${what} legend slot ${slot}`);
  }
  return index;
}

/** Compile the bounded native stream: relief keyed off the circuit, ground
 *  tiles and foliage painted from the same field, water left flat and empty. */
export function packFartRacerBaselinePainting(legend: FartRacerLegend): FartRacerBaselinePaintingStream {
  const chunks = baselineChunks();
  const manifest = new Float32Array(2 + chunks.length * 2);
  manifest[0] = MAP_GENERATED_WIRE.version;
  manifest[1] = chunks.length;
  chunks.forEach((chunk, index) => {
    manifest[2 + index * 2] = chunk.cx;
    manifest[3 + index * 2] = chunk.cz;
  });
  const reusable = new Float32Array(MAP_GENERATED_WIRE.chunkStride);
  const heightStart = 2;
  const waterStart = heightStart + MAP_GENERATED_WIRE.sampleCount;
  const tileStart = waterStart + MAP_GENERATED_WIRE.sampleCount;
  const zoneStart = tileStart + MAP_GENERATED_WIRE.tileCount;
  const grassStart = zoneStart + MAP_GENERATED_WIRE.tileCount;
  const treeStart = grassStart + MAP_GENERATED_WIRE.tileCount;
  const bushStart = treeStart + MAP_GENERATED_WIRE.tileCount;
  const wire = FART_RACER_BASELINE_TUNING.wire;
  const sampleColumns = wire.sampleColumns;
  const tileColumns = wire.tileColumns;
  const chunkMeters = wire.chunkMeters;
  const sampleStepM = chunkMeters / (sampleColumns - 1);
  const pads = fartRacerPads();

  return {
    manifest,
    paths: packPaths(),
    chunkCount: chunks.length,
    packChunk(index: number): Float32Array {
      if (!Number.isInteger(index) || index < 0 || index >= chunks.length) {
        throw new Error(`Fart Racer chunk index ${index} is out of range`);
      }
      const { cx, cz } = chunks[index]!;
      const originX = cx * chunkMeters;
      const originZ = cz * chunkMeters;
      reusable[0] = cx;
      reusable[1] = cz;
      reusable.fill(0, waterStart, tileStart);
      reusable.fill(wire.emptyCell, zoneStart, grassStart);

      for (let row = 0; row < sampleColumns; row += 1) {
        const z = originZ + row * sampleStepM;
        const base = heightStart + row * sampleColumns;
        for (let column = 0; column < sampleColumns; column += 1) {
          reusable[base + column] = terrainHeightAt(originX + column * sampleStepM, z, pads);
        }
      }

      for (let row = 0; row < tileColumns; row += 1) {
        const cellZ = originZ + row;
        const base = row * tileColumns;
        for (let column = 0; column < tileColumns; column += 1) {
          const cellX = originX + column;
          // The cell's own centre height, read from the field just packed.
          const sample = Math.min(sampleColumns - 1, Math.round((column + 0.5) / sampleStepM));
          const sampleRow = Math.min(sampleColumns - 1, Math.round((row + 0.5) / sampleStepM));
          const height = reusable[heightStart + sampleRow * sampleColumns + sample]!;
          const paint = surfacePaintAt(cellX, cellZ, height, pads);
          reusable[tileStart + base + column] = legendIndex(legend.tiles, paint.tile, 'tile');
          reusable[grassStart + base + column] = paint.grass < 0 ? wire.emptyCell : legendIndex(legend.grass, paint.grass, 'grass flora');
          reusable[treeStart + base + column] = paint.tree < 0 ? wire.emptyCell : legendIndex(legend.tree, paint.tree, 'tree flora');
          reusable[bushStart + base + column] = paint.bush < 0 ? wire.emptyCell : legendIndex(legend.bush, paint.bush, 'bush flora');
        }
      }
      return reusable;
    },
  };
}
