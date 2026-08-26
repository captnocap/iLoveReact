// Cross-boundary contract for the editor-emitted prefix consumed by compiled Zig.
// Run with the ordinary editor test bundler + tools/v8cli.

import { BLUEPRINT_UNITS, type BlueprintTable } from '../model/blueprintTable';
import {
  encodeFartRacerLogic,
  FART_RACER_WIRE_MAGIC,
  FART_RACER_WIRE_NUMBER_COUNT as NUMBER_COUNT,
  FART_RACER_WIRE_VERSION,
  validateDriveThruBlueprints,
} from './fartRacerWire';
import { buildFartRacerAudioExport } from './fartRacerAudio';
import { loadFartRacerTarget, validateVehicleRatingDistribution } from './fartRacerTarget';
import { driveThruMarker } from '../world/worldMarkers';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function ascii(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

const blueprint: BlueprintTable = {
  version: 1,
  units: BLUEPRINT_UNITS,
  namespaces: ['rj.profile.vehicle', 'rj.core.item', 'com.captnocap.fartracer'],
  profiles: [{ id: 'rj.profile.vehicle', version: 1 }, { id: 'rj.core.item', version: 1 }],
  stats: [
    {
      scope: { kind: 'document' },
      profile: { id: 'rj.profile.vehicle', version: 1 },
      driveRating: 0.71,
      gripRating: 0.62,
      handlingRating: 0.53,
      topSpeedRating: 0.84,
      accelerationRating: 0.76,
    },
    {
      scope: { kind: 'document' },
      profile: { id: 'rj.core.item', version: 1 },
      durabilityCapacity: 145,
    },
  ],
  physics: [],
  extensions: {
    'com.captnocap.fartracer': {
      tankCapacityL: 31,
      burnRatePerSec: 0.82,
      fillEfficiency: 0.77,
      leakRatePerDamage: 0.0014,
    },
  },
};

test('wire emits the fixed 78-number prefix and bounded catalog', () => {
  const target = loadFartRacerTarget();
  const encoded = encodeFartRacerLogic(target, [{ packageId: 'vehicle-a', modelId: 'vehicle-a', blueprint }], [{ id: 'home' }]);
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  assert(view.getUint32(0, true) === FART_RACER_WIRE_MAGIC, 'magic drifted');
  assert(view.getUint32(4, true) === FART_RACER_WIRE_VERSION, 'version drifted');
  assert(view.getUint32(8, true) === NUMBER_COUNT, 'numeric prefix count drifted');
  const catalogBytes = view.getUint32(12, true);
  assert(encoded.byteLength === 16 + NUMBER_COUNT * 4 + catalogBytes, 'catalog length did not bound the stream');
  const catalog = JSON.parse(ascii(encoded.subarray(16 + NUMBER_COUNT * 4)));
  assert(catalog.target.id === 'fart-racer', 'target identity was not baked');
  assert(catalog.vehiclePackageId === 'vehicle-a', 'runtime vehicle mesh identity was not baked');
  assert(catalog.vehicleVisualPackageId === 'vehicle-a', 'default visual identity did not follow the gameplay vehicle');
  assert(catalog.blueprints[0].packageId === 'vehicle-a', 'blueprint catalog was dropped');
  assert(catalog.markers[0].id === 'home', 'marker catalog was dropped');
});

test('authored presence/value pairs preserve zero separately from unset', () => {
  const target = loadFartRacerTarget();
  const encoded = encodeFartRacerLogic(target, [{ packageId: 'vehicle-a', modelId: 'vehicle-a', blueprint }], []);
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  const number = (index: number) => view.getFloat32(16 + index * 4, true);
  assert(number(57) === 1 && Math.abs(number(58) - 0.71) < 1e-5, 'drive rating presence/value pair drifted');
  assert(number(69) === 1 && number(70) === 31, 'tank capacity presence/value pair drifted');
});

test('the car you drive is the car you see, when the target names one', () => {
  const target = loadFartRacerTarget();
  // A declared visual package that ALSO carries vehicle stats becomes the
  // player's car. Taking the stats from whichever roster entry came first put
  // the player behind one car's tank while looking at another's body.
  const roster = [
    { packageId: 'vehicle-first', modelId: 'vehicle-first', blueprint },
    { packageId: 'vehicle-visual', modelId: 'vehicle-visual', blueprint },
  ];
  const chosen = JSON.parse(ascii(encodeFartRacerLogic(target, roster, [], 'vehicle-visual').subarray(16 + NUMBER_COUNT * 4)));
  assert(chosen.vehiclePackageId === 'vehicle-visual', 'the declared visual car did not become the car being driven');
  assert(chosen.vehicleVisualPackageId === 'vehicle-visual', 'rendered package identity drifted from the declared visual');

  // A declared visual with no vehicle stats of its own (a pure shell) leaves
  // the gameplay car where it was, rather than shipping a car with no stats.
  const shell = JSON.parse(ascii(encodeFartRacerLogic(target, roster, [], 'body-only').subarray(16 + NUMBER_COUNT * 4)));
  assert(shell.vehiclePackageId === 'vehicle-first', 'a stats-free visual shell stole the gameplay identity');
  assert(shell.vehicleVisualPackageId === 'body-only', 'rendered package identity did not follow the declaration');
});

test('agent stat batches must preserve a useful vehicle distribution', () => {
  const target = loadFartRacerTarget();
  const varied = validateVehicleRatingDistribution(target, [
    { id: 'junker', topSpeedRating: 0.2, accelerationRating: 0.2 },
    { id: 'sedan', topSpeedRating: 0.5, accelerationRating: 0.5 },
    { id: 'hotrod', topSpeedRating: 0.85, accelerationRating: 0.85 },
  ]);
  assert(varied.ok, varied.reason ?? 'varied batch was rejected');
  const flattened = validateVehicleRatingDistribution(target, [
    { id: 'a', topSpeedRating: 0.50, accelerationRating: 0.48 },
    { id: 'b', topSpeedRating: 0.51, accelerationRating: 0.50 },
    { id: 'c', topSpeedRating: 0.52, accelerationRating: 0.51 },
  ]);
  assert(!flattened.ok && flattened.reason?.includes('span'), 'flattened batch escaped the distribution gate');
});

test('drive-thru export resolves a complete package-authored food tuple', () => {
  const marker = driveThruMarker('food-stop', { x: 1, y: 0, z: 2 }, 'food-a');
  const foodBlueprint: BlueprintTable = {
    version: 1,
    units: BLUEPRINT_UNITS,
    namespaces: ['com.captnocap.fartracer'],
    profiles: [], stats: [], physics: [],
    extensions: { 'com.captnocap.fartracer': { gasYieldL: 10, digestSeconds: 2, bowelLoad: 12 } },
  };
  assert(validateDriveThruBlueprints([{ packageId: 'food-a', modelId: 'food-a', blueprint: foodBlueprint }], [marker]).ok, 'complete food package was rejected');
  const incomplete = { ...foodBlueprint, extensions: { 'com.captnocap.fartracer': { gasYieldL: 10 } } } as BlueprintTable;
  const report = validateDriveThruBlueprints([{ packageId: 'food-a', modelId: 'food-a', blueprint: incomplete }], [marker]);
  assert(!report.ok && report.reason.includes('food-stop'), 'incomplete food package escaped export validation');
});

test('audio export resolves package clips and preserves engine curves', () => {
  const audioProfile = { id: 'rj.core.audio' as const, version: 1 as const };
  const vehicleAudio: BlueprintTable = {
    ...blueprint,
    namespaces: [...blueprint.namespaces, 'rj.core.audio'],
    profiles: [...blueprint.profiles, audioProfile],
    stats: [...blueprint.stats, {
      scope: { kind: 'document' }, profile: audioProfile,
      events: {
        'vehicle.engine': { kind: 'loop', clips: ['idle', 'rev'], param: 'vehicle.rpmNormalized', blendCurve: [[0, 0], [1, 1]], pitchCurve: [[0, 0.8], [1, 1.6]] },
        'vehicle.skid': { clips: ['skid'] },
        'impact.body': { clips: ['crash'] },
        'vehicle.tankFill': { clips: ['fill'] },
      },
    }],
  };
  const foodAudio: BlueprintTable = {
    version: 1, units: BLUEPRINT_UNITS, namespaces: ['rj.core.audio', 'com.captnocap.fartracer'], profiles: [audioProfile],
    stats: [{ scope: { kind: 'document' }, profile: audioProfile, events: {
      'item.eat': { clips: ['eat'] },
      'driveThru.speaker': { clips: ['speaker'] },
    } }],
    physics: [], extensions: { 'com.captnocap.fartracer': { gasYieldL: 10, digestSeconds: 2, bowelLoad: 12 } },
  };
  const baked = buildFartRacerAudioExport([
    { packageId: 'vehicle-a', modelId: 'vehicle-a', blueprint: vehicleAudio },
    { packageId: 'food-a', modelId: 'food-a', blueprint: foodAudio },
  ], [driveThruMarker('food-stop', { x: 4, y: 1, z: 9 }, 'food-a')]);
  assert(baked.assets.length === 7, 'referenced package clips were not deduplicated into the export');
  assert(baked.manifest.events['vehicle.engine']?.pitchCurve?.[1]?.[1] === 1.6, 'engine pitch curve was dropped');
  assert(baked.manifest.events['driveThru.speaker']?.position?.z === 9, 'speaker lost its world marker position');
});

log(`\nfart racer wire: ${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} Fart Racer wire test(s) failed`);
