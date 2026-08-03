import { MATERIALS } from './_generated/registry';

const expected = [
  'alley_concrete',
  'asphalt',
  'brick',
  'concrete',
  'grass',
  'lava_plasma',
  'mud',
  'plaza_terrazzo',
  'refuse',
  'road',
  'rot_siding',
  'sand',
  'sidewalk',
  'sidewalk_grid',
  'sidewalk_pavers',
  'sidewalk_utility',
  'water',
  'wood',
].sort();

const actual = MATERIALS.map((material) => material.fn).sort();
if (actual.join(',') !== expected.join(',')) {
  throw new Error(`procedural catalog drifted: expected ${expected.join(', ')}; got ${actual.join(', ')}`);
}

const stable = new Map(MATERIALS.map((material) => [material.fn, `${material.boardIndex}:${material.materialId}`]));
if (stable.get('road') !== '0:0' || stable.get('rot_siding') !== '1:5' || stable.get('lava_plasma') !== '4:58') {
  throw new Error('retained procedural material ids changed during catalog severance');
}

console.log(`PASS procedural catalog: ${MATERIALS.length} retained materials with stable ids`);
