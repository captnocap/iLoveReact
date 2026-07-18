// Coastal-city document compiler tests.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/coastalCityDocument.test.ts --bundle \
//     --outfile=/tmp/editor-coastal-city-document.test.js --format=iife \
//     --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-coastal-city-document.test.js
import { generateCoastalCity, type CoastalCityPlan } from './coastalCity';
import { coastalCityWorldSave } from './coastalCityDocument';
import { parseWorldSaveText } from './worldStore';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
function rejects(fn: () => void, message: string) {
  let rejected = false;
  try { fn(); } catch { rejected = true; }
  assert(rejected, message);
}

const plan = {
  version: 1,
  seed: 0x1234_abcd,
  name: 'Test Coast',
  bounds: { minX: -60, minZ: -60, maxX: 1020, maxZ: 1020 },
  chunks: [],
  zones: [
    { id: 'downtown', name: 'Downtown', color: '#d7a653' },
    { id: 'residential', name: 'Residential', color: '#83b879' },
  ],
  landUses: [],
  districts: [],
  crossings: [],
  paths: [],
  sites: [
    {
      id: 'site-downtown-1', intendedUse: 'downtownCore', widthM: 9, depthM: 12,
      suggestedMaxFloors: 8, frontagePathId: 'road-main',
      x: 1.5, y: 4.25, z: 4.5, yawDegrees: 90, generationStage: 'buildingSites',
    },
    {
      id: 'site-home-1', intendedUse: 'residential', widthM: 6, depthM: 9,
      suggestedMaxFloors: 2, frontagePathId: 'road-local-7',
      x: 10.5, y: 2, z: 13.5, yawDegrees: 270, generationStage: 'buildingSites',
    },
  ],
  stageOrder: [],
  stats: {},
} as unknown as CoastalCityPlan;

test('one real semantic floor anchor is emitted per accepted site', () => {
  const save = coastalCityWorldSave('coastal-test', 40, plan);
  assert(save.pieces.length === plan.sites.length, 'site count expanded into a carpet or lost an anchor');
  assert(save.pieces.every((piece) => piece.pieceId.startsWith('floor.')), 'generator guessed walls, roofs, or boxes');
  assert(save.pieces.every((piece) => piece.floor === 0), 'generated floor anchor left ground storey');
  assert(save.objects.length === 0 && save.facades.length === 0, 'unrelated world concerns were invented');
  assert(JSON.stringify(save.zones) === JSON.stringify(plan.zones), 'canonical plan zones changed');
});

test('ids are monotonic and seq points beyond every minted id', () => {
  const save = coastalCityWorldSave('coastal-test', 40, plan);
  assert(JSON.stringify(save.pieces.map((piece) => piece.id)) === JSON.stringify(['bp_40', 'bp_41']), 'piece ids drifted');
  assert(new Set(save.pieces.map((piece) => piece.id)).size === save.pieces.length, 'piece ids collided');
  assert(save.seq === 42, 'seq does not name the next unused piece id');
});

test('floor anchors retain exact generated-site provenance', () => {
  const save = coastalCityWorldSave('coastal-test', 7, plan);
  const site = plan.sites[0]!;
  const piece = save.pieces[0]!;
  assert(piece.x === site.x && piece.y === site.y && piece.z === site.z && piece.yawDegrees === site.yawDegrees, 'site transform changed');
  assert(JSON.stringify(piece.generatedSite) === JSON.stringify({
    generator: 'coastal-city',
    version: '1',
    seed: plan.seed,
    siteId: site.id,
    intendedUse: site.intendedUse,
    widthM: site.widthM,
    depthM: site.depthM,
    suggestedMaxFloors: site.suggestedMaxFloors,
    frontagePathId: site.frontagePathId,
  }), 'generated-site metadata drifted');
});

test('generated save survives the strict world parser', () => {
  const save = coastalCityWorldSave('coastal-test', 3, plan);
  const parsed = parseWorldSaveText(JSON.stringify(save), 'coastal-test');
  assert(JSON.stringify(parsed) === JSON.stringify(save), 'world parser did not round-trip generated anchors');
});

test('real planner output crosses the document boundary unchanged', () => {
  const realPlan = generateCoastalCity(0x0bad_f00d);
  const save = coastalCityWorldSave('real-coast', 1, realPlan);
  assert(save.pieces.length === realPlan.sites.length && save.pieces.length > 0, 'accepted planner sites did not become anchors');
  assert(save.seq === realPlan.sites.length + 1, 'real plan sequence allocation drifted');
  assert(save.pieces.every((piece, index) => piece.y === realPlan.sites[index]!.y), 'flattened pad elevation changed at document boundary');
  parseWorldSaveText(JSON.stringify(save), 'real-coast');
});

test('world parser rejects malformed generated-site provenance', () => {
  const save = coastalCityWorldSave('coastal-test', 3, plan);
  const wrongVersion = JSON.parse(JSON.stringify(save));
  wrongVersion.pieces[0].generatedSite.version = '2';
  rejects(() => parseWorldSaveText(JSON.stringify(wrongVersion), 'coastal-test'), 'unknown provenance version was accepted');
  const wrongGenerator = JSON.parse(JSON.stringify(save));
  wrongGenerator.pieces[0].generatedSite.generator = 'generic-parcel-generator';
  rejects(() => parseWorldSaveText(JSON.stringify(wrongGenerator), 'coastal-test'), 'unknown provenance generator was accepted');
  const stringSeed = JSON.parse(JSON.stringify(save));
  stringSeed.pieces[0].generatedSite.seed = String(plan.seed);
  rejects(() => parseWorldSaveText(JSON.stringify(stringSeed), 'coastal-test'), 'string provenance seed was accepted');
  const badFootprint = JSON.parse(JSON.stringify(save));
  badFootprint.pieces[0].generatedSite.widthM = 8;
  rejects(() => parseWorldSaveText(JSON.stringify(badFootprint), 'coastal-test'), 'off-module provenance footprint was accepted');
  const fractionalFloors = JSON.parse(JSON.stringify(save));
  fractionalFloors.pieces[0].generatedSite.suggestedMaxFloors = 2.5;
  rejects(() => parseWorldSaveText(JSON.stringify(fractionalFloors), 'coastal-test'), 'fractional floor suggestion was accepted');
  const extraField = JSON.parse(JSON.stringify(save));
  extraField.pieces[0].generatedSite.parcelGeometry = [];
  rejects(() => parseWorldSaveText(JSON.stringify(extraField), 'coastal-test'), 'parallel parcel payload was accepted');
  const freeYaw = JSON.parse(JSON.stringify(save));
  freeYaw.pieces[0].yawDegrees = 45;
  rejects(() => parseWorldSaveText(JSON.stringify(freeYaw), 'coastal-test'), 'free-yaw generated anchor was accepted on reload');
  const wallAnchor = JSON.parse(JSON.stringify(save));
  wallAnchor.pieces[0].pieceId = 'wall.concrete.common';
  rejects(() => parseWorldSaveText(JSON.stringify(wallAnchor), 'coastal-test'), 'wall carried v1 floor-anchor provenance');
  const wrongFloor = JSON.parse(JSON.stringify(save));
  wrongFloor.pieces[0].pieceId = 'floor.wood.suburb';
  rejects(() => parseWorldSaveText(JSON.stringify(wrongFloor), 'coastal-test'), 'unversioned alternate floor carried v1 anchor provenance');
  const upperStorey = JSON.parse(JSON.stringify(save));
  upperStorey.pieces[0].floor = 1;
  rejects(() => parseWorldSaveText(JSON.stringify(upperStorey), 'coastal-test'), 'upper-storey piece carried v1 floor-anchor provenance');
  const duplicateSite = JSON.parse(JSON.stringify(save));
  duplicateSite.pieces[1].generatedSite.siteId = duplicateSite.pieces[0].generatedSite.siteId;
  rejects(() => parseWorldSaveText(JSON.stringify(duplicateSite), 'coastal-test'), 'duplicate generated site ids survived reload');
});

test('legacy pieces without generated metadata remain valid', () => {
  const oldSave = {
    version: 2,
    document: 'old-map',
    seq: 2,
    pieces: [{ id: 'bp_1', pieceId: 'floor.concrete.common', x: 1.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 }],
    objects: [], zones: [], facades: [],
  };
  const parsed = parseWorldSaveText(JSON.stringify(oldSave), 'old-map');
  assert(parsed.pieces.length === 1 && parsed.pieces[0]!.generatedSite === undefined, 'legacy piece was rejected or rewritten');
});

test('document boundary rejects sites that violate the piece grammar', () => {
  const duplicate = { ...plan, sites: [plan.sites[0]!, { ...plan.sites[1]!, id: plan.sites[0]!.id }] } as CoastalCityPlan;
  rejects(() => coastalCityWorldSave('bad-map', 1, duplicate), 'duplicate site id was accepted');
  const freeYaw = { ...plan, sites: [{ ...plan.sites[0]!, yawDegrees: 45 }] } as unknown as CoastalCityPlan;
  rejects(() => coastalCityWorldSave('bad-map', 1, freeYaw), 'free-yaw building site was accepted');
  const offGrid = { ...plan, sites: [{ ...plan.sites[0]!, x: 2 }] } as CoastalCityPlan;
  rejects(() => coastalCityWorldSave('bad-map', 1, offGrid), 'off-center floor anchor was accepted');
  const offModule = { ...plan, sites: [{ ...plan.sites[0]!, widthM: 8 }] } as CoastalCityPlan;
  rejects(() => coastalCityWorldSave('bad-map', 1, offModule), 'off-module footprint was accepted');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
