// cart/editor/world/floraKinds.test.ts — the painter legend is persisted by
// index, so append-only order and its host recipe triples are a wire contract.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/floraKinds.test.ts --bundle \
//     --outfile=/tmp/editor-flora-kinds.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-flora-kinds.test.js

import { FLORA_KIND_DEFINITIONS, FLORA_SPECS, FLORA_SPEC } from './floraKinds';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('original painter legend indices never move', () => {
  const original = ['grassSparse', 'grassMed', 'grassLush', 'grassDry', 'palmSparse', 'palmMed', 'palmDense', 'bush', 'grassFlowers'];
  assert(
    FLORA_KIND_DEFINITIONS.slice(0, original.length).map((d) => d.kind).join(',') === original.join(','),
    'the persisted first-nine flora legend changed',
  );
});

test('one catalog definition owns exactly one host triple', () => {
  assert(FLORA_SPECS.length === FLORA_KIND_DEFINITIONS.length * 3, 'spec payload and legend length drifted');
  FLORA_KIND_DEFINITIONS.forEach((def, index) => {
    const at = index * 3;
    assert(FLORA_SPECS[at] === def.population.spec, `${def.kind} spec drifted`);
    assert(FLORA_SPECS[at + 1] === def.population.count, `${def.kind} count drifted`);
    assert(Math.abs(FLORA_SPECS[at + 2]! - def.population.chance) < 1e-6, `${def.kind} chance drifted`);
  });
});

test('new tree species append to the tree lane with distinct recipes', () => {
  const trees = FLORA_KIND_DEFINITIONS.filter((d) => ['pine', 'maple', 'oak', 'cedar', 'spruce'].includes(d.kind));
  assert(trees.length === 5, `expected five new species, got ${trees.length}`);
  assert(trees.every((d) => d.lane === 'tree' && d.population.count === 0 && d.population.chance > 0), 'tree recipe shape is wrong');
  assert(new Set(trees.map((d) => d.population.spec)).size === trees.length, 'tree species share a recipe id');
  assert(trees.map((d) => d.population.spec).join(',') === [FLORA_SPEC.pine, FLORA_SPEC.maple, FLORA_SPEC.oak, FLORA_SPEC.cedar, FLORA_SPEC.spruce].join(','), 'tree recipe order drifted');
});

test('grass and bush shape variants stay in their structural lanes', () => {
  for (const kind of ['grassTall', 'grassReeds'] as const) {
    assert(FLORA_KIND_DEFINITIONS.find((d) => d.kind === kind)?.lane === 'grass', `${kind} left grass lane`);
  }
  for (const kind of ['bushLow', 'bushDense'] as const) {
    assert(FLORA_KIND_DEFINITIONS.find((d) => d.kind === kind)?.lane === 'bush', `${kind} left bush lane`);
  }
});

test('wrapped shrub recipes append as one whole 24-byte instance per painted cell', () => {
  const expected = [
    ['hydrangeaMophead', FLORA_SPEC.hydrangeaMophead],
    ['hydrangeaPanicle', FLORA_SPEC.hydrangeaPanicle],
    ['leafyThicket', FLORA_SPEC.leafyThicket],
    ['wildWeedBush', FLORA_SPEC.wildWeedBush],
  ] as const;
  const appended = FLORA_KIND_DEFINITIONS.slice(-expected.length);
  assert(appended.map((d) => d.kind).join(',') === expected.map(([kind]) => kind).join(','), 'wrapped shrubs are not append-only');
  appended.forEach((def, index) => {
    assert(def.lane === 'bush', `${def.kind} left the bush lane`);
    assert(def.population.spec === expected[index]![1], `${def.kind} recipe id drifted`);
    assert(def.population.count === 0 && def.population.chance === 1, `${def.kind} must emit one shared-mesh row`);
  });
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
