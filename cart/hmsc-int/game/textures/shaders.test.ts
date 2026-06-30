// shaders.test.ts -- catalog contracts for texture shader recipes.

import { assert, assertEqual, finish, test } from '../_testkit';
import { defaultShaderData, HMSC_BROWSE_SHADER_PRESETS, HMSC_SHADERS, HMSC_SHADER_PRESETS, shaderGroups, shaderSpec, shaderTexturePreset } from './shaders';

const EXPANSION_IDS = [
  'k-sidewalk-grid', 'k-sidewalk-utility', 'k-sidewalk-pavers', 'k-curb-crosswalk',
  'k-alley-concrete', 'k-plaza-terrazzo', 'k-storm-drain',
  'l-plywood-sheet', 'l-clapboard-siding', 'l-parquet-floor', 'l-brick-herringbone',
  'l-cinder-block', 'l-fieldstone', 'l-marble-slab',
  'm-corrugated-metal', 'm-diamond-plate', 'm-brushed-steel', 'm-rusted-panel',
  'm-chainlink-panel', 'm-painted-metal-door', 'm-copper-patina',
  'n-floral-wallpaper', 'n-stripe-wallpaper', 'n-motel-wallpaper', 'n-kids-wallpaper',
  'n-damask-wallpaper', 'n-smoke-stained-wallpaper', 'n-office-wallcover',
  'n-rose-trellis-wallpaper', 'n-vine-wallpaper', 'n-chinoiserie-wallpaper',
  'n-art-deco-wallpaper', 'n-toile-wallpaper', 'n-tropical-wallpaper',
  'n-kitchen-wallpaper', 'n-nursery-wallpaper', 'n-torn-layered-wallpaper',
  'o-sunset-gradient', 'o-vapor-gradient', 'o-sodium-fog', 'o-fluorescent-panel',
  'o-hazard-gradient', 'o-wet-neon-fade', 'o-grime-gradient',
];

test('shader ids are unique', () => {
  const seen = new Set<string>();
  for (const spec of HMSC_SHADERS) {
    assert(!seen.has(spec.id), `duplicate shader id ${spec.id}`);
    seen.add(spec.id);
  }
  for (const preset of HMSC_SHADER_PRESETS) {
    assert(!seen.has(preset.id), `preset id collides with shader id ${preset.id}`);
    assert(!seen.has(`preset:${preset.id}`), `duplicate preset id ${preset.id}`);
    seen.add(`preset:${preset.id}`);
  }
});

test('bulk expansion boards expose material recipes', () => {
  for (const id of EXPANSION_IDS) {
    const spec = shaderSpec(id);
    assert(spec !== undefined, `${id} exists`);
    assertEqual(spec!.variants.length, 3, `${id} has three authored takes`);
  }
});

test('bulk expansion recipes pack stable board and material slots', () => {
  const probes = [
    ['k-sidewalk-grid', 10, 0, 'Pavement & Streets'],
    ['k-storm-drain', 10, 6, 'Pavement & Streets'],
    ['l-plywood-sheet', 11, 0, 'Floors & Tile'],
    ['l-marble-slab', 11, 6, 'Exterior Walls'],
    ['m-corrugated-metal', 12, 0, 'Metal & Industrial'],
    ['m-copper-patina', 12, 6, 'Metal & Industrial'],
    ['n-floral-wallpaper', 13, 0, 'Wallpaper & Interior Walls'],
    ['n-office-wallcover', 13, 6, 'Wallpaper & Interior Walls'],
    ['n-rose-trellis-wallpaper', 13, 7, 'Wallpaper & Interior Walls'],
    ['n-torn-layered-wallpaper', 13, 15, 'Wallpaper & Interior Walls'],
    ['o-sunset-gradient', 14, 0, 'Glass, Light & Gradients'],
    ['o-grime-gradient', 14, 6, 'Glass, Light & Gradients'],
  ] as const;
  for (const [id, board, material, group] of probes) {
    const spec = shaderSpec(id)!;
    const data = defaultShaderData(spec);
    assertEqual(spec.group, group, `${id} group`);
    assertEqual(data[0], material, `${id} material slot`);
    assertEqual(data[1], 0, `${id} default variant`);
    assertEqual(data[4], board, `${id} board slot`);
  }
});

test('catalog groups expose semantic shelves instead of board families', () => {
  const groups = shaderGroups().map((g) => g.group);
  assert(groups.includes('Wallpaper & Interior Walls'), 'wallpaper shelf exists');
  assert(groups.includes('Metal & Industrial'), 'metal shelf exists');
  for (const group of groups) {
    assert(!/^[a-o]-family$/i.test(group), `${group} is not a board-family group`);
  }
  for (const spec of HMSC_SHADERS) {
    assert(!/^[a-o]-family$/i.test(spec.group), `${spec.id} has a semantic group`);
  }
});

test('shader presets bake all qualities but browse only the standard grade', () => {
  const floral = HMSC_SHADER_PRESETS.filter((p) => p.shaderId === 'n-floral-wallpaper');
  assertEqual(floral.length, 15, 'three floral takes times five quality grades');
  const browseFloral = HMSC_BROWSE_SHADER_PRESETS.filter((p) => p.shaderId === 'n-floral-wallpaper');
  assertEqual(browseFloral.length, 3, 'browse catalog keeps one quality per take');
  const roseStd = shaderTexturePreset('n-floral-wallpaper--v0--std');
  assert(roseStd !== undefined, 'standard rose wallpaper preset exists');
  assertEqual(roseStd!.label, 'Floral Wallpaper · Rose · Std', 'preset label includes material, take, and grade');
  assertEqual(roseStd!.group, 'Wallpaper & Interior Walls', 'preset inherits semantic shelf');
  assertEqual(JSON.stringify(roseStd!.data), JSON.stringify([0, 0, 601, 3, 13]), 'preset data freezes variant and quality');
  const blueMax = shaderTexturePreset('n-floral-wallpaper--v2--max');
  assert(blueMax !== undefined, 'max-detail blue wallpaper preset exists');
  assertEqual(JSON.stringify(blueMax!.data), JSON.stringify([0, 2, 707, 4, 13]), 'variant seed and max grade are baked');
  assert(!HMSC_BROWSE_SHADER_PRESETS.some((p) => p.id === 'n-floral-wallpaper--v2--max'), 'nonstandard qualities stay out of the browse list');
});

finish('game/textures/shaders');
