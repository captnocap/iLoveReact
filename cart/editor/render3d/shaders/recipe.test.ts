// recipe.test.ts — the Material Lab recipe composer's behavior suite. The
// three demo recipes here are TEST FIXTURES proving the composer's range
// (masked surface layering, base domain warp, colormod filtering) — they are
// not shipped content.
import {
  composeRecipeFn,
  recipeData,
  recipeFnName,
  recipeFns,
  recipeParams,
  recipeShader,
  recipeSlots,
  recipeStageData,
  recipeStageShader,
  recipeTopologyKey,
  validateRecipe,
  type MaterialRecipe,
} from './recipe';
import { MATERIALS } from './_generated/registry';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const MOSSY_BRICK: MaterialRecipe = {
  version: 1,
  id: 'mossy-brick',
  name: 'Mossy Brick',
  base: { fn: 'brick' },
  layers: [
    { atom: 'grass', blend: 0, opacity: 0.85, mask: { field: 'field_fbm', threshold: 0.55, softness: 0.18 } },
  ],
};

const WARPED_WOOD: MaterialRecipe = {
  version: 1,
  id: 'warped-wood',
  name: 'Warped Wood',
  base: { fn: 'wood', warp: { atom: 'warp_fbm', amount: 0.9 } },
  layers: [],
};

const NIGHT_SIDING: MaterialRecipe = {
  version: 1,
  id: 'night-siding',
  name: 'Night Siding',
  base: { fn: 'rot_siding' },
  layers: [{ atom: 'colormod_night', amount: 0.8 }],
};

test('demo recipes validate; unknown fns are named in the rejection', () => {
  assert(validateRecipe(MOSSY_BRICK) === null, `mossy brick: ${validateRecipe(MOSSY_BRICK)}`);
  assert(validateRecipe(WARPED_WOOD) === null, `warped wood: ${validateRecipe(WARPED_WOOD)}`);
  assert(validateRecipe(NIGHT_SIDING) === null, `night siding: ${validateRecipe(NIGHT_SIDING)}`);
  const bad = validateRecipe({ ...MOSSY_BRICK, base: { fn: 'no_such_material' } });
  assert(bad !== null && bad.includes('no_such_material'), 'unknown base must be named in the rejection');
  const badMask = validateRecipe({
    ...MOSSY_BRICK,
    layers: [{ atom: 'grass', mask: { field: 'warp_fbm' } }],
  });
  assert(badMask !== null && badMask.includes('warp_fbm'), 'a warp atom posing as a mask field must be rejected');
});

test('composition is deterministic — equal recipes emit byte-identical WGSL', () => {
  assert(composeRecipeFn(MOSSY_BRICK) === composeRecipeFn({ ...MOSSY_BRICK }), 'recipe fn drifted between equal inputs');
  const a = recipeShader(MOSSY_BRICK);
  const b = recipeShader({ ...MOSSY_BRICK, layers: [...MOSSY_BRICK.layers] });
  assert(a !== null && a === b, 'recipe module drifted between equal inputs');
});

test('mossy brick composes shaken: brick + grass + its mask atom, nothing else', () => {
  const module = recipeShader(MOSSY_BRICK)!;
  assert(module !== null, 'mossy brick did not compose');
  assert(module.includes('fn brick(uv: vec2f'), 'base material body missing');
  assert(module.includes('fn grass(uv: vec2f'), 'layer material body missing');
  assert(module.includes('fn field_fbm(uv: vec2f, px: vec2f, seed: f32) -> f32'), 'mask atom body missing');
  assert(module.includes('surface_blend(0, col, over, factor)'), 'surface layer must blend through surface_blend');
  assert(!module.includes('fn water(uv: vec2f'), 'unrelated material leaked into the composed module');
  assert(!module.includes('fn warp_fbm('), 'unused warp atom leaked into the composed module');
  assert(module.includes('@fragment fn fs_main'), 'module must end in the standard FILL_MAIN entry');
  assert(module.split('@group(0) @binding(1)').length === 2, 'the D declaration must appear exactly once');
});

test('warped wood warps the BASE domain before sampling', () => {
  const module = recipeShader(WARPED_WOOD)!;
  assert(module !== null, 'warped wood did not compose');
  const fn = composeRecipeFn(WARPED_WOOD);
  assert(fn.includes('base_domain = warp_fbm(uv, seed,'), 'base warp must transform uv before the base samples');
  assert(fn.includes('wood(base_domain, px'), 'base material must sample the warped domain');
  assert(module.includes('fn warp_fbm(uv: vec2f, seed: f32, amount: f32) -> vec2f'), 'warp atom body missing from module');
});

test('night variant filters through the colormod path with opacity mix', () => {
  const fn = composeRecipeFn(NIGHT_SIDING);
  assert(fn.includes('colormod_night(col, layer_uv, px'), 'colormod layers must filter the running color');
  assert(fn.includes('col = mix(col, filtered, factor);'), 'colormod layers must mix by factor');
  assert(recipeShader(NIGHT_SIDING) !== null, 'night siding did not compose');
});

test('every recipe tunable routes through mat_param — the zero-recompile path', () => {
  const fn = composeRecipeFn(MOSSY_BRICK);
  const table = recipeParams(MOSSY_BRICK);
  const keys = table.map((entry) => entry.key);
  assert(keys.includes('layer.0.opacity'), `opacity missing from param table: ${keys.join(', ')}`);
  assert(keys.includes('layer.0.mask.threshold'), 'mask threshold missing from param table');
  assert(keys.includes('layer.0.mask.softness'), 'mask softness missing from param table');
  assert(keys.includes('layer.0.mask.field_fbm.scale'), 'the mask atom @param must join the recipe param table');
  const opacityIndex = keys.indexOf('layer.0.opacity');
  assert(fn.includes(`mat_param(${opacityIndex}, 0.85)`), 'opacity must be a mat_param read with its baked default');
  const warpFn = composeRecipeFn(WARPED_WOOD);
  const warpIndex = recipeParams(WARPED_WOOD).findIndex((entry) => entry.key === 'base.warp.amount');
  assert(warpFn.includes(`mat_param(${warpIndex}, 0.9)`), 'base warp amount must be a mat_param read');
});

test('atom @params rebase through mat_param_offset at their call site', () => {
  const fn = composeRecipeFn(MOSSY_BRICK);
  const table = recipeParams(MOSSY_BRICK);
  const scaleIndex = table.findIndex((entry) => entry.key === 'layer.0.mask.field_fbm.scale');
  assert(scaleIndex >= 0, 'field_fbm scale not in the table');
  assert(fn.includes(`mat_param_offset = ${scaleIndex};`), 'mask call site must rebase mat_param_offset to its region');
  assert(fn.includes('mat_param_offset = 0;'), 'offsets must reset after the call');
});

test('layer palettes rebase through mat_slot_offset into the flat slot table', () => {
  const fn = composeRecipeFn(MOSSY_BRICK);
  const slots = recipeSlots(MOSSY_BRICK);
  const brickSlots = MATERIALS.find((m) => m.fn === 'brick')!.slots.length;
  const grassStart = slots.findIndex((slot) => slot.fn === 'grass');
  assert(grassStart === brickSlots, 'grass slots must start where brick slots end');
  assert(fn.includes(`mat_slot_offset = ${grassStart};`), 'layer material call must rebase mat_slot_offset');
});

test('the data row carries the full palette + param tables; values never touch the string', () => {
  const row = recipeData(MOSSY_BRICK);
  const slots = recipeSlots(MOSSY_BRICK);
  const params = recipeParams(MOSSY_BRICK);
  assert(row[5] === slots.length, 'palette count wrong');
  assert(row[6 + slots.length * 3] === params.length, 'param count must follow the palette section');
  assert(row.length === 7 + slots.length * 3 + params.length, 'row length wrong');
  const overridden = recipeData(MOSSY_BRICK, { params: new Map([['layer.0.opacity', 0.2]]) });
  const opacityAt = 7 + slots.length * 3 + params.findIndex((entry) => entry.key === 'layer.0.opacity');
  assert(overridden[opacityAt] === 0.2, 'param override did not land in the row');
  assert(recipeShader(MOSSY_BRICK) === recipeShader(MOSSY_BRICK), 'module string must be stable across data builds');
});

test('topology key ignores data-speed values and tracks structure', () => {
  const retuned: MaterialRecipe = {
    ...MOSSY_BRICK,
    layers: [{ ...MOSSY_BRICK.layers[0]!, opacity: 0.1, mask: { ...MOSSY_BRICK.layers[0]!.mask!, threshold: 0.9, softness: 0.01 } }],
  };
  assert(recipeTopologyKey(MOSSY_BRICK) === recipeTopologyKey(retuned), 'value changes must not move the topology key');
  const reblended: MaterialRecipe = {
    ...MOSSY_BRICK,
    layers: [{ ...MOSSY_BRICK.layers[0]!, blend: 2 }],
  };
  assert(recipeTopologyKey(MOSSY_BRICK) !== recipeTopologyKey(reblended), 'a blend swap is a topology change');
});

test('stage modules carry every prefix and share one data table', () => {
  const staged = recipeStageShader(MOSSY_BRICK)!;
  assert(staged !== null, 'stage module did not compose');
  assert(staged.includes('fn recipe_mossy_brick_stage_0('), 'stage 0 fn missing');
  assert(staged.includes('fn recipe_mossy_brick_stage_1('), 'stage 1 fn missing');
  assert(staged.includes('if (material == 0)'), 'stage dispatch arm 0 missing');
  const stage0 = staged.slice(staged.indexOf('fn recipe_mossy_brick_stage_0('), staged.indexOf('fn recipe_mossy_brick_stage_1('));
  assert(!stage0.includes('grass('), 'stage 0 must be the base alone');
  const rows = recipeStageData(MOSSY_BRICK);
  assert(rows.length === 2, 'stage rows must cover base + each enabled layer');
  assert(rows[0]![0] === 0 && rows[1]![0] === 1, 'stage rows must select stages by materialId');
  assert(rows[0]!.length === rows[1]!.length, 'every stage row shares the full-table layout');
});

test('a disabled layer is absent from the composed fn and its deps', () => {
  const disabled: MaterialRecipe = {
    ...MOSSY_BRICK,
    layers: [{ ...MOSSY_BRICK.layers[0]!, enabled: false }],
  };
  const fn = composeRecipeFn(disabled);
  assert(!fn.includes('grass('), 'disabled layer still emitted');
  assert(!recipeFns(disabled).includes('grass'), 'disabled layer still in the dep list');
  assert(recipeFnName(disabled.id) === 'recipe_mossy_brick', 'fn name must derive from the slug');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} recipe suite failures`);
