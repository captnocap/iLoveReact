// Linked city-map model tests.
//
//   tools/esbuild cart/editor/stage/cityMapModel.test.ts --bundle \
//     --outfile=/tmp/editor-city-map.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-city-map.test.js
import type { MapPathSnapshot } from '../../../runtime/game/map';
import type { PlacedPiece } from '../world/pieces';
import {
  cityMapBounds,
  cityMapChunkPath,
  cityMapPathBatches,
  cityMapSiteRects,
  coastalCityMapGeography,
  coastalSeedFromPieces,
} from './cityMapModel';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function test(name: string, run: () => void) {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const topology = { maxCol: 25, maxRow: 25, chunks: [{ cx: 0, cz: 0 }, { cx: 1, cz: 2 }] };
const snapshot: MapPathSnapshot = {
  version: 1,
  paths: [
    { id: 1, kind: 'road', profile: { lanesF: 1, lanesB: 1, sidewalks: true, tracks: 0, curveRadiusM: 8, speedLimitKph: 50 }, points: [{ x: -20, z: 10, elevationM: 0 }, { x: 160, z: 10, elevationM: 0 }] },
    { id: 2, kind: 'road', profile: { lanesF: 1, lanesB: 1, sidewalks: true, tracks: 0, curveRadiusM: 8, speedLimitKph: 50 }, points: [{ x: 40, z: 20, elevationM: 0 }, { x: 40, z: 280, elevationM: 0 }] },
    { id: 3, kind: 'lightRail', profile: { lanesF: 0, lanesB: 0, sidewalks: false, tracks: 2, curveRadiusM: 18, speedLimitKph: 0 }, points: [{ x: 0, z: 0, elevationM: 0 }, { x: 120, z: 120, elevationM: 3 }] },
  ],
};
const sitePiece: PlacedPiece = {
  id: 'site', pieceId: 'floor.concrete.common', x: 30, y: 0, z: 40, yawDegrees: 90, floor: 0,
  generatedSite: {
    generator: 'coastal-city', version: '1', seed: 42069, siteId: 'site-1', intendedUse: 'mixedUse',
    widthM: 9, depthM: 15, suggestedMaxFloors: 4, frontagePathId: 'road-1',
  },
};

test('bounds use native chunk world coordinates and include every live source', () => {
  const bounds = cityMapBounds(topology, snapshot, [sitePiece]);
  assert(bounds.minX === -60 && bounds.maxX === 180, `unexpected X bounds ${bounds.minX}..${bounds.maxX}`);
  assert(bounds.minZ === -60 && bounds.maxZ === 300, `unexpected Z bounds ${bounds.minZ}..${bounds.maxZ}`);
  const d = cityMapChunkPath(topology);
  assert(d.includes('M -60 -60') && d.includes('M 60 180'), 'chunk wire did not retain the -60m author origin');
  const solid = cityMapChunkPath({ maxCol: 2, maxRow: 2, chunks: [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }, { cx: 0, cz: 1 }, { cx: 1, cz: 1 }] });
  assert((solid.match(/M /g) ?? []).length === 6, 'solid chunk rectangle did not collapse to shared grid lines');
});

test('building sites remain one batched footprint and quarter turns swap axes', () => {
  const bounds = cityMapBounds(topology, snapshot, [sitePiece]);
  const rects = cityMapSiteRects([sitePiece], bounds);
  assert(rects.length === 1, 'site was not represented once');
  assert(rects[0]!.w === 15 && rects[0]!.h === 9, `quarter turn did not swap 9x15 footprint: ${rects[0]!.w}x${rects[0]!.h}`);
  assert(coastalSeedFromPieces([sitePiece]) === 42069, 'coastal seed was not recovered from provenance');
});

test('transport paths batch by visual contract without losing independent polylines', () => {
  const batches = cityMapPathBatches(snapshot);
  const roads = batches.filter((batch) => batch.kind === 'road');
  const rails = batches.filter((batch) => batch.kind === 'lightRail');
  assert(roads.length === 1, `matching road profiles did not batch (${roads.length})`);
  assert((roads[0]!.d.match(/M /g) ?? []).length === 2, 'batched roads were accidentally connected together');
  assert(roads[0]!.innerWidthM === 7 && roads[0]!.outerWidthM === 11, 'native 1+1 road/sidewalk widths drifted');
  assert(rails.length === 1 && rails[0]!.innerWidthM > 0, 'light rail disappeared from the overview');
});

test('coastal geography is deterministic context, not a second transport plan', () => {
  const a = coastalCityMapGeography(42069);
  const b = coastalCityMapGeography(42069);
  assert(JSON.stringify(a) === JSON.stringify(b), 'overview geography changed for the same seed');
  assert(a.seaD.length > 100 && a.riverD.length > 100, 'coast or river context is empty');
  assert(a.districts.length === 7 && a.protectedAreas.length === 3, 'district/protected context drifted');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
