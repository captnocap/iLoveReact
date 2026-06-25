// mapReport.test.ts — pins the / dashboard spatial census math (req_1875): chunk
// extent, asset coverage vs open space, walk/run traversal, and the landmark
// pick. Pure + headless. CHUNK_TILES = 120 so a chunk = 14,400 m².

import { assert, assertClose, assertEqual, finish, test } from './game/_testkit';
import { reportMapFootprint } from './mapReport';

test('an empty map is all zeros with no landmark', () => {
  const r = reportMapFootprint({ chunks: [] });
  assertEqual(r.chunks, 0, 'no chunks');
  assertEqual(r.groundAreaM2, 0, 'no ground');
  assertEqual(r.diagonalMeters, 0, 'no diagonal');
  assert(r.landmark === null, 'no landmark for an empty map');
  assertEqual(r.walkSpeedMps, 2.4, 'default walk speed still reported');
});

test('a single chunk is 120x120 m, fully painted, walk diagonal at 2.4 m/s', () => {
  const r = reportMapFootprint({ chunks: [{ cx: 0, cz: 0 }] });
  assertEqual(r.chunks, 1, 'one chunk');
  assertEqual(r.widthMeters, 120, 'one chunk wide');
  assertEqual(r.depthMeters, 120, 'one chunk deep');
  assertEqual(r.groundAreaM2, 14400, 'chunk area = 120*120');
  assertEqual(r.extentAreaM2, 14400, 'extent = ground for a solid chunk');
  assertClose(r.paintedFraction, 1, 1e-9, 'bounding box fully painted');
  assertClose(r.diagonalMeters, Math.sqrt(2) * 120, 1e-6, 'corner-to-corner');
  assertClose(r.walkSecondsAcross, (Math.sqrt(2) * 120) / 2.4, 1e-6, 'walk time');
  assertClose(r.runSecondsAcross, (Math.sqrt(2) * 120) / 5.8, 1e-6, 'run time');
});

test('coverage = asset footprint area / ground area, open = the rest', () => {
  // 2x2 chunks = 57,600 m² ground; one 120x120 footprint covers 14,400 = 25%.
  const r = reportMapFootprint({
    chunks: [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }, { cx: 0, cz: 1 }, { cx: 1, cz: 1 }],
    footprints: [{ footW: 120, footD: 120 }],
  });
  assertEqual(r.groundAreaM2, 57600, '4 chunks');
  assertEqual(r.assetCount, 1, 'one footprint');
  assertEqual(r.assetAreaM2, 14400, '120*120 covered');
  assertClose(r.coverageFraction, 0.25, 1e-9, 'a quarter covered');
  assertEqual(r.openAreaM2, 57600 - 14400, 'open = ground - assets');
});

test('coverage clamps to 1 when footprints overflow the ground', () => {
  const r = reportMapFootprint({
    chunks: [{ cx: 0, cz: 0 }],
    footprints: [{ footW: 120, footD: 120 }, { footW: 120, footD: 120 }], // 2x the chunk
  });
  assertClose(r.coverageFraction, 1, 1e-9, 'clamped at fully covered');
  assertEqual(r.openAreaM2, 0, 'no open space left');
});

test('a sparse map reports paintedFraction below 1', () => {
  // two chunks on a diagonal → 3x3 bounding box (9 chunks) but only 2 painted.
  const r = reportMapFootprint({ chunks: [{ cx: 0, cz: 0 }, { cx: 2, cz: 2 }] });
  assertEqual(r.widthMeters, 360, '3 chunks wide');
  assertEqual(r.groundAreaM2, 2 * 14400, 'only 2 painted');
  assertClose(r.paintedFraction, (2 * 14400) / (360 * 360), 1e-9, '2 of 9 cells painted');
});

test('landmark is the closest real-world area in multiplicative terms', () => {
  // a single chunk (14,400 m²) is nearest a Walmart Supercenter (17,000), not a
  // soccer pitch (7,140): |ln(14400/17000)| < |ln(14400/7140)|.
  const r = reportMapFootprint({ chunks: [{ cx: 0, cz: 0 }] });
  assert(r.landmark !== null, 'has a landmark');
  assert(/Walmart/.test(r.landmark!.name), `closest landmark is Walmart, got ${r.landmark!.name}`);
  assertClose(r.landmark!.ratio, 14400 / 17000, 1e-9, 'ratio = mapArea / landmarkArea');
});

finish();
