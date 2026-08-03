import { EDITOR_GROUND_FORMULA, GROUND_STREAM_TUNING, groundFormulaFor, tileBindingFor } from './groundFormula';
import { fillShaderFor } from './shaders/compose';
import { FILL_SHADER } from './shaders/index';
import { MATERIALS } from './shaders/_generated/registry';
import { EDITOR_SHADERS } from '../textures/shaders';

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

test('ground composition disables the row-relative fill palette contract', () => {
  assert(
    EDITOR_GROUND_FORMULA.includes('let n = 0; // ground stream carries cells, not a fill palette'),
    'generated fill palette count was not neutralized for the ground D stream',
  );
  assert(
    !EDITOR_GROUND_FORMULA.includes('let n = i32(D[mat_data_base + 5u] + 0.5)'),
    'ground formula still interprets bindCount/cell data as a material palette',
  );
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
  assert(EDITOR_GROUND_FORMULA.includes('let crosswalkAlongM = select(p.y, p.x, (roadMark & 1) != 0)'), 'crosswalk phase no longer follows its semantic leg axis');
  assert(EDITOR_GROUND_FORMULA.includes('bestRoadAlong, crosswalkAlongM'), 'crosswalk phase can switch to the nearest crossing ribbon');
});

test('the default ground module carries only its retained procedural set', () => {
  assert(
    EDITOR_GROUND_FORMULA.length < 200_000,
    `default ground formula is ${EDITOR_GROUND_FORMULA.length}B — full-catalog composition is back (req_3473: ~90s boot compile)`,
  );
  for (const fn of ['road', 'water', 'grass', 'sand', 'mud', 'sidewalk', 'concrete', 'asphalt']) {
    assert(EDITOR_GROUND_FORMULA.includes(`fn ${fn}(uv: vec2f`), `default material body '${fn}' missing from the composed module`);
  }
  assert(EDITOR_GROUND_FORMULA.includes('fn fill_pick('), 'composed fill_pick chain missing');
  assert(EDITOR_GROUND_FORMULA.includes('fn quality_pass('), 'helpers prelude missing from the composed module');
});

test('a picked binding folds its material into the recomposed ground module', () => {
  const lava = MATERIALS.find((material) => material.fn === 'lava_plasma');
  assert(!!lava, 'lava_plasma disappeared from the generated registry');
  assert(!EDITOR_GROUND_FORMULA.includes('fn lava_plasma('), 'default module already carries lava_plasma — the shaken-set probe is meaningless');
  const withPick = groundFormulaFor([{ fn: 'lava_plasma', variant: 0 }]);
  assert(withPick.includes('fn lava_plasma('), 'picked material body missing from the recomposed formula');
  assert(
    withPick.includes(`material == ${lava!.materialId} && i32(board + 0.5) == ${lava!.boardIndex}`),
    'picked material is not dispatchable through the composed fill_pick chain',
  );
});

test('per-material fill modules are small and keep the FILL_SHADER contract', () => {
  const one = fillShaderFor(['water']);
  assert(one.length < 200_000, `single-material fill module is ${one.length}B — tree-shake broke (req_3473)`);
  assert(one.includes('fn fill_render('), 'FILL_MAIN fs_main missing — the D[] contract broke');
  assert(one.includes('fn fill_grid('), 'packed thumbnail grid envelope missing');
  assert(one.includes('fn water(uv: vec2f'), 'wanted material body missing');
  assert(fillShaderFor(['water']) === one, 'per-set modules are not memoized');
  assert(fillShaderFor(['no_such_material_fn']) === FILL_SHADER, 'unknown fn must fall back to the full catalog, not break rendering');
});

test('every retained fill spec resolves its registry fn and composes shaken', () => {
  // The regression this guards: FillMaterial carries no fn, so fillSpec must
  // resolve it via fnForMaterialRow. The catalog is intentionally small now;
  // every retained entry still has to compose independently.
  const fillSpecs = EDITOR_SHADERS.filter((spec) => spec.fillFn !== undefined);
  assert(fillSpecs.length === MATERIALS.length, `${fillSpecs.length} fill specs did not match ${MATERIALS.length} retained materials`);
  for (const spec of fillSpecs) {
    assert(spec.shader !== FILL_SHADER, `spec '${spec.id}' fell back to the full-catalog shader`);
    assert(spec.shader.includes(`fn ${spec.fillFn}(uv: vec2f`), `spec '${spec.id}' module is missing its own material body '${spec.fillFn}'`);
  }
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
