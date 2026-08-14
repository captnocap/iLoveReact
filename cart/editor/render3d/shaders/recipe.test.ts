// recipe.test.ts — the Material Lab recipe composer's behavior suite. The
// three demo recipes here are TEST FIXTURES proving the composer's range
// (masked surface layering, base domain warp, colormod filtering) — they are
// not shipped content.
import {
  composeRecipeFn,
  recipeFnName,
  recipeFns,
  recipeShader,
  recipeStageShader,
  validateRecipe,
  type MaterialRecipe,
} from './recipe';

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
  assert(fn.includes('let base_uv = warp_fbm(uv, seed, 0.9);'), 'base warp must transform uv before the base samples');
  assert(fn.includes('wood(base_uv, px'), 'base material must sample the warped domain');
  assert(module.includes('fn warp_fbm(uv: vec2f, seed: f32, amount: f32) -> vec2f'), 'warp atom body missing from module');
});

test('night variant filters through the colormod path with opacity mix', () => {
  const fn = composeRecipeFn(NIGHT_SIDING);
  assert(fn.includes('mix(col, colormod_night(col, layer_uv, px'), 'colormod layers must mix the filtered color by factor');
  assert(recipeShader(NIGHT_SIDING) !== null, 'night siding did not compose');
});

test('stage modules carry every prefix and dispatch by materialId', () => {
  const staged = recipeStageShader(MOSSY_BRICK)!;
  assert(staged !== null, 'stage module did not compose');
  assert(staged.includes('fn recipe_mossy_brick_stage_0('), 'stage 0 fn missing');
  assert(staged.includes('fn recipe_mossy_brick_stage_1('), 'stage 1 fn missing');
  assert(staged.includes('if (material == 0)'), 'stage dispatch arm 0 missing');
  const stage0 = staged.slice(staged.indexOf('fn recipe_mossy_brick_stage_0('), staged.indexOf('fn recipe_mossy_brick_stage_1('));
  assert(!stage0.includes('grass('), 'stage 0 must be the base alone');
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
