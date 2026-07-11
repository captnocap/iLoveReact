import { EDITOR_GROUND_FORMULA, GROUND_STREAM_TUNING, tileBindingFor } from './groundFormula';
import { MATERIALS } from './shaders/_generated/registry';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('every road grammar cell resolves to the semantic Road material instead of concrete', () => {
  for (const kind of ['laneNorth', 'laneSouth', 'laneEast', 'laneWest'] as const) {
    assert(tileBindingFor(kind).fn === 'road', `${kind} is not Road`);
    assert(tileBindingFor(kind).variant === 2, `${kind} does not start from Plain Asphalt`);
  }
  assert(tileBindingFor('junction').fn === 'road', 'junction is not Road');
  assert(tileBindingFor('crosswalk').fn === 'road', 'crosswalk is not Road');
  assert(tileBindingFor('median').fn === 'road', 'median is not Road');
});

test('ground shader rotates catalog UVs for east-west road grammar', () => {
  assert(EDITOR_GROUND_FORMULA.includes('var roadAlongX = undercoatToken == 0 && ((roadMark & 1) != 0 || semanticKind =='), 'directional road dispatch missing');
  assert(EDITOR_GROUND_FORMULA.includes('if (undercoatToken == 0 && roadMark == 0'), 'visual undercoat is incorrectly inheriting road rotation');
  assert(EDITOR_GROUND_FORMULA.includes('surfaceUv = vec2f(fc.y, fc.x)'), 'east-west UV swap missing');
  assert(EDITOR_GROUND_FORMULA.includes('immediately adjacent directional lane cells'), 'median axis inference missing');
});

test('ground material references unpack fallback markings and analytic visual undercoat', () => {
  assert(GROUND_STREAM_TUNING.materialRefStride === 512, 'material/marking stride drifted from the native contract');
  assert(GROUND_STREAM_TUNING.undercoatRefStride === 131072, 'undercoat stride drifted from the native contract');
  assert(EDITOR_GROUND_FORMULA.includes('materialRef % 131072'), 'packed material/marking low bits are not decoded');
  assert(EDITOR_GROUND_FORMULA.includes('materialRef / 131072'), 'visual undercoat token is not decoded');
  assert(EDITOR_GROUND_FORMULA.includes('undercoatToken - 2'), 'road cells do not reveal their exact prior tile');
  assert(EDITOR_GROUND_FORMULA.includes('road_apply_markings(rgb, surfaceUv, surfaceMeters'), 'derived road paint is not composited');
  assert(EDITOR_GROUND_FORMULA.includes('surfaceMeters = vec2f(p.y, p.x)'), 'east-west marking metres are not rotated');
});

test('committed roads render as continuous curve ribbons over the gameplay raster', () => {
  assert(GROUND_STREAM_TUNING.ribbonSegmentFloats === 11, 'ribbon row shape drifted from Zig');
  assert(EDITOR_GROUND_FORMULA.includes('let ribbonCount = i32(D[ribbonBase])'), 'ribbon header is not read');
  assert(EDITOR_GROUND_FORMULA.includes('bestRoadAlong = alongM'), 'arc-continuous marking phase is not carried');
  assert(EDITOR_GROUND_FORMULA.includes('max(fullMask - roadMask, 0.0)'), 'sidewalk/road union priority is missing');
  assert(EDITOR_GROUND_FORMULA.includes('road_apply_ribbon_markings('), 'analytic Road catalog markings are not applied');
  assert(EDITOR_GROUND_FORMULA.includes('semanticKind =='), 'junction/crosswalk raster policy was discarded');
});

test('Road catalog variants name the yellow, white, and plain authored takes', () => {
  const road = MATERIALS.find((material) => material.fn === 'road');
  assert(!!road, 'Road material disappeared from the generated registry');
  assert(
    road!.variantLabels.join('|') === 'Yellow Divider|White Lane + Edge|Plain Asphalt',
    `Road take labels drifted: ${road!.variantLabels.join('|')}`,
  );
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
