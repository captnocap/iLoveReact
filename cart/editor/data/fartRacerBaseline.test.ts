// Fart Racer editable baseline compiler tests.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/fartRacerBaseline.test.ts --bundle \
//     --outfile=/tmp/editor-fart-racer-baseline.test.js --format=iife \
//     --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-fart-racer-baseline.test.js
import type { BlueprintTable } from '../model/blueprintTable';
import { parseWorldSaveText } from './worldStore';
import {
  FART_RACER_BASELINE_TUNING,
  chooseFartRacerBaselineAssets,
  fartRacerBaselineWorldSave,
  fartRacerGroundHeight,
  packFartRacerBaselinePainting,
  type FartRacerBaselineCandidate,
  type FartRacerLegend,
} from './fartRacerBaseline';
import { authoredLapLengthM, trackProximity } from './fartRacerTrack';
import { TERRAIN_TUNING } from './fartRacerTerrain';
import { cityArchitecture, cityBlocks } from './fartRacerCity';

// Stand-in legend: slot i resolves to index i + 40 so a mis-slotted lookup
// shows up as a wrong number rather than a coincidental match.
const LEGEND: FartRacerLegend = {
  tiles: [40, 41, 42, 43, 44],
  grass: [50, 51, 52, 53, 54],
  tree: [60, 61, 62, 63, 64],
  bush: [70, 71, 72, 73],
};

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function test(name: string, run: () => void) {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function candidate(id: string, topSpeed: number, acceleration: number): FartRacerBaselineCandidate {
  const blueprint: BlueprintTable = {
    version: 1,
    units: { length: 'm', mass: 'kg', time: 's', angle: 'rad' },
    namespaces: ['rj.profile.vehicle'],
    profiles: [{ id: 'rj.profile.vehicle', version: 1 }],
    stats: [{
      profile: { id: 'rj.profile.vehicle', version: 1 },
      scope: { kind: 'document' },
      topSpeedRating: topSpeed,
      accelerationRating: acceleration,
    }],
    physics: [],
    extensions: {},
  };
  return { packageId: id, pieceId: `prop:${id}`, blueprint };
}

const food: FartRacerBaselineCandidate = {
  packageId: 'food:burrito',
  pieceId: 'prop:food:burrito',
  blueprint: {
    version: 1,
    units: { length: 'm', mass: 'kg', time: 's', angle: 'rad' },
    namespaces: ['com.captnocap.fartracer'],
    profiles: [],
    stats: [],
    physics: [],
    extensions: { 'com.captnocap.fartracer': { gasYieldL: 18, digestSeconds: 4, bowelLoad: 38 } },
  },
};

test('semantic package data chooses the widest distinct three-car roster', () => {
  const assets = chooseFartRacerBaselineAssets([
    candidate('vehicle:middle', 0.5, 0.5),
    candidate('vehicle:slow', 0.1, 0.2),
    candidate('vehicle:quick', 0.75, 0.9),
    candidate('vehicle:fast', 0.95, 0.6),
    food,
  ]);
  const ids = new Set(assets.vehicles.map((row) => row.packageId));
  assert(ids.size === 3, 'vehicle roster contains duplicate packages');
  assert(ids.has('vehicle:slow') && ids.has('vehicle:quick') && ids.has('vehicle:fast'), 'rating-span optimizer chose the wrong triple');
  assert(assets.food.packageId === food.packageId, 'food blueprint did not resolve');
});

test('world save carries three cars, food, one package-bound drive-thru, and a city', () => {
  const assets = chooseFartRacerBaselineAssets([
    candidate('vehicle:a', 0.1, 0.2),
    candidate('vehicle:b', 0.5, 0.55),
    candidate('vehicle:c', 0.9, 0.85),
    food,
  ]);
  const save = fartRacerBaselineWorldSave('fart-racer-baseline', 11, assets);
  const authored = save.pieces.filter((piece) => piece.pieceId.startsWith('prop:'));
  assert(authored.length === 4, `expected 4 authored model placements, got ${authored.length}`);
  const built = save.pieces.filter((piece) => !piece.pieceId.startsWith('prop:'));
  assert(built.length > 400, `Gastown collapsed to ${built.length} placed pieces`);
  assert(save.architecture.walls.edges.length === cityBlocks().length * 4,
    `Gastown's shells are ${save.architecture.walls.edges.length} wall edges, not four per block`);
  assert(new Set(save.pieces.map((piece) => piece.id)).size === save.pieces.length, 'placed piece ids collide');
  assert(save.markers.length === 1, 'baseline should defer race markers until native road installation');
  assert(save.markers[0]!.trigger.event.sourceId === food.packageId, 'drive-thru copied tuning instead of referencing its package');
  assert(save.seq === 16, `next id sequence drifted to ${save.seq}`);
  parseWorldSaveText(JSON.stringify(save), 'fart-racer-baseline');
});

test('the starting grid sits on the road, and the city does not', () => {
  for (const at of FART_RACER_BASELINE_TUNING.placements.vehicles) {
    const near = trackProximity(at.x, at.z);
    assert(near.distanceM < 10, `a starting slot is ${near.distanceM.toFixed(1)} m off the racing line`);
  }
  for (const block of cityBlocks()) {
    // The FOOTPRINT has to clear the road, not just the anchor point.
    const halfDiagonal = Math.hypot(block.modulesX * 1.5, block.modulesZ * 1.5);
    const clearance = trackProximity(block.x, block.z).distanceM - halfDiagonal;
    assert(clearance > 14, `city block ${block.id} clears the racing line by only ${clearance.toFixed(1)} m — it is on the track`);
    assert(clearance < 60, `city block ${block.id} is ${clearance.toFixed(1)} m off the racing line — too far away to read at speed`);
  }
});

test('the road corridor is exactly the authored elevation; the land around it is not', () => {
  // Anything the car drives on must match the elevation a checkpoint is
  // sampled at, or triggers float above/below the surface.
  for (const point of FART_RACER_BASELINE_TUNING.track.points) {
    const height = fartRacerGroundHeight(point.x, point.z);
    assert(Math.abs(height - point.elevationM) < 0.001,
      `corridor at (${point.x},${point.z}) is ${height.toFixed(2)} m, authored ${point.elevationM} m`);
  }
  // And the world beyond the corridor actually has shape to it.
  let lowest = Infinity;
  let highest = -Infinity;
  for (let x = 10; x < 470; x += 23) {
    for (let z = 10; z < 470; z += 23) {
      if (trackProximity(x, z).distanceM < TERRAIN_TUNING.reliefBlendM) continue;
      const height = fartRacerGroundHeight(x, z);
      lowest = Math.min(lowest, height);
      highest = Math.max(highest, height);
    }
  }
  assert(highest - lowest > 6, `the landscape is flat (${(highest - lowest).toFixed(1)} m of relief)`);
});

test('the whole circuit fits inside the painted chunks', () => {
  const bounds = FART_RACER_BASELINE_TUNING.chunks;
  const span = 120;
  const minX = bounds.minX * span - span / 2;
  const maxX = bounds.maxX * span + span / 2;
  const minZ = bounds.minZ * span - span / 2;
  const maxZ = bounds.maxZ * span + span / 2;
  // A road is wider than its centreline, and its cells stamp into chunks that
  // must exist or the ground under them is never painted.
  const margin = 24;
  for (const point of FART_RACER_BASELINE_TUNING.track.points) {
    assert(point.x - margin > minX && point.x + margin < maxX, `track point x=${point.x} leaves the painted world [${minX}, ${maxX}]`);
    assert(point.z - margin > minZ && point.z + margin < maxZ, `track point z=${point.z} leaves the painted world [${minZ}, ${maxZ}]`);
  }
});

test('the lap is a real lap', () => {
  const lap = authoredLapLengthM();
  assert(lap > 1000 && lap < 2000, `authored lap length ${lap.toFixed(0)} m is not a circuit`);
});

test('the native stream is twenty-five shaped chunks plus one closed road', () => {
  const stream = packFartRacerBaselinePainting(LEGEND);
  assert(stream.chunkCount === 25 && stream.manifest.length === 52, '5x5 chunk manifest drifted');
  assert(stream.paths[0] === 1 && stream.paths[1] === 1 && stream.paths[2] === 0, 'road path header is malformed');
  const pointCount = stream.paths[9]!;
  assert(pointCount === FART_RACER_BASELINE_TUNING.track.points.length, 'path point count drifted');
  const pointStart = 10;
  const lastStart = pointStart + (pointCount - 1) * 3;
  assert(stream.paths[pointStart] === stream.paths[lastStart]
    && stream.paths[pointStart + 1] === stream.paths[lastStart + 1], 'road is not explicitly closed');

  const first = stream.packChunk(0);
  assert(first.length === 2 + 241 * 241 * 2 + 120 * 120 * 5, 'native chunk stride drifted');
  assert(first[0] === 0 && first[1] === 0, 'first chunk coordinate is malformed');
  const last = stream.packChunk(24);
  assert(first === last, 'stream retained one allocation per chunk');
  assert(last[0] === 4 && last[1] === 4, 'last chunk coordinate is malformed');

  const heightStart = 2;
  const sampleCount = 241 * 241;
  const tileStart = heightStart + sampleCount * 2;
  const zoneStart = tileStart + 120 * 120;
  const grassStart = zoneStart + 120 * 120;
  const treeStart = grassStart + 120 * 120;

  // A shaped chunk, not a flat plate.
  const chunk = stream.packChunk(6);
  let low = Infinity;
  let high = -Infinity;
  for (let i = heightStart; i < heightStart + sampleCount; i += 97) {
    low = Math.min(low, chunk[i]!);
    high = Math.max(high, chunk[i]!);
  }
  assert(high - low > 2, `chunk 6 is flat (${(high - low).toFixed(2)} m)`);

  // Water is still flat and zones are still unpainted.
  assert(chunk[heightStart + sampleCount] === 0, 'water lane picked up terrain');
  assert(chunk[zoneStart] === -1, 'zone lane lost its sentinel');

  // Ground and foliage come from the supplied legend, never a hardcoded index.
  const tiles = new Set<number>();
  const trees = new Set<number>();
  const grasses = new Set<number>();
  for (let i = 0; i < 120 * 120; i += 1) {
    tiles.add(chunk[tileStart + i]!);
    trees.add(chunk[treeStart + i]!);
    grasses.add(chunk[grassStart + i]!);
  }
  for (const value of tiles) assert(LEGEND.tiles.includes(value), `tile lane wrote ${value}, which is not in the legend`);
  for (const value of trees) assert(value === -1 || LEGEND.tree.includes(value), `tree lane wrote ${value}, which is not in the legend`);
  for (const value of grasses) assert(value === -1 || LEGEND.grass.includes(value), `grass lane wrote ${value}, which is not in the legend`);
  assert(tiles.size > 1, 'the whole world is one ground tile');
  assert(trees.size > 1, 'no trees were planted anywhere in the north-woods chunk');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
