import { MATERIALS } from './_generated/registry';

// The req_3714 severance deleted 392 of these materials as "unused" — but model
// paintings reference materials by (board, materialId), and several went dormant
// pointing at recipes that no longer existed. req_4394 restored the full catalog.
// Shrinking it again requires auditing every saved painting first.
const RESTORED_CATALOG_FLOOR = 410;
if (MATERIALS.length < RESTORED_CATALOG_FLOOR) {
  throw new Error(`procedural catalog shrank: ${MATERIALS.length} materials, restored floor is ${RESTORED_CATALOG_FLOOR} — deleting a material orphans any painting that references it`);
}

// The ground/base set every map depends on must always be present.
const core = [
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
];
const present = new Set(MATERIALS.map((material) => material.fn));
const missing = core.filter((fn) => !present.has(fn));
if (missing.length) {
  throw new Error(`core procedural materials missing from the catalog: ${missing.join(', ')}`);
}

// ids.json is append-only, so (boardIndex, materialId) is forever — paintings
// bake these numbers. Sentinels span the retained core and the restored set.
const stable = new Map(MATERIALS.map((material) => [material.fn, `${material.boardIndex}:${material.materialId}`]));
const sentinels: [string, string][] = [
  ['road', '0:0'],
  ['rot_siding', '1:5'],
  ['lava_plasma', '4:58'],
  ['autumn_leaves', '0:8'],
  ['circuit_board', '4:13'],
  ['zellige_star', '11:39'],
];
for (const [fn, id] of sentinels) {
  if (stable.get(fn) !== id) {
    throw new Error(`material '${fn}' id drifted: expected ${id}, got ${stable.get(fn)} — renumbering breaks every painting that baked it`);
  }
}

console.log(`PASS procedural catalog: ${MATERIALS.length} materials, core set present, sentinel ids stable`);
