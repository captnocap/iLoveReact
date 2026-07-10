import { PATH_CURVE_TUNING, pathInvalidLabel, pathKindPatch, pathProfileOf } from './transportPathUi';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('path kinds select useful distinct curve defaults', () => {
  assert(pathKindPatch('road').pathCurveRadiusM === 8, 'road default drifted');
  assert(pathKindPatch('lightRail').pathCurveRadiusM === 18, 'light-rail default drifted');
  assert(pathKindPatch('railway').pathCurveRadiusM === 28, 'railway default drifted');
});

test('the chrome boundary clamps every value before crossing to Zig', () => {
  const profile = pathProfileOf({
    pathKind: 'railway', pathCurveRadiusM: 999, railTracks: 7,
    roadLanesF: -4, roadLanesB: 9, roadSidewalks: true,
  });
  assert(profile.curveRadiusM === PATH_CURVE_TUNING.maxM, 'curve escaped the host range');
  assert(profile.tracks === 2, 'track count escaped the authored vocabulary');
  assert(profile.lanesF === 0 && profile.lanesB === 3, 'road fields were not normalized');
});

test('rail validation errors are phrased as an actionable edit', () => {
  assert(pathInvalidLabel('curveTooTight', 4.25).includes('4.3 m'), 'minimum curve was not surfaced');
  assert(pathInvalidLabel('tooFewPoints', null).includes('anchor'), 'missing-point guidance disappeared');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
