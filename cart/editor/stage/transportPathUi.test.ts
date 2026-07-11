import { PATH_CURVE_TUNING, pathInvalidLabel, pathKindPatch, pathLevelLabel, pathProfileOf, roadCarriagewayWidthM } from './transportPathUi';

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
    pathTool: 'draw', pathLevel: 0,
    pathKind: 'railway', pathCurveRadiusM: 999, railTracks: 7,
    roadLanesF: -4, roadLanesB: 9, roadSidewalks: true,
  });
  assert(profile.curveRadiusM === PATH_CURVE_TUNING.maxM, 'curve escaped the host range');
  assert(profile.tracks === 2, 'track count escaped the authored vocabulary');
  assert(profile.lanesF === 0 && profile.lanesB === 3, 'road fields were not normalized');
});

test('signed track levels use the building storey vocabulary', () => {
  assert(pathLevelLabel(0) === 'Ground', 'ground label drifted');
  assert(pathLevelLabel(2) === 'Floor 2', 'raised-storey label drifted');
  assert(pathLevelLabel(-3) === 'Basement 3', 'subway-storey label drifted');
});

test('road width exposes the ruled three-metre lanes and one-metre two-way divider', () => {
  assert(roadCarriagewayWidthM(1, 1) === 7, 'one lane each way is not the minimum 7 m carriageway');
  assert(roadCarriagewayWidthM(2, 1) === 10, 'multi-lane width lost its 3 m module');
  assert(roadCarriagewayWidthM(2, 0) === 6, 'one-way width incorrectly gained a median');
});

test('rail validation errors are phrased as an actionable edit', () => {
  assert(pathInvalidLabel('curveTooTight', 4.25).includes('4.3 m'), 'minimum curve was not surfaced');
  assert(pathInvalidLabel('tooFewPoints', null).includes('anchor'), 'missing-point guidance disappeared');
  assert(pathInvalidLabel('gradeTooSteep', null, 0.117).includes('11.7%'), 'grade guidance disappeared');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
