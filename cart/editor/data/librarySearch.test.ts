// Global Asset Explorer search contract.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/librarySearch.test.ts --bundle \
//     --outfile=/tmp/editor-library-search.test.js --format=iife \
//     --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-library-search.test.js
import { searchLibrary } from './librarySearch';
import type { Asset, ModelPackage } from './types';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const asset = (overrides: Partial<Asset>): Asset => ({
  id: 'material:concrete', tab: 'Skins', name: 'Concrete', color: '#777777', used: 0, ...overrides,
});
const model = (overrides: Partial<ModelPackage>): ModelPackage => ({
  id: 'model:moped', folderId: 'model-model:moped', name: 'Moped 50',
  path: '/models/vehicles/moped', kind: 'vehicle', stage: 'wip', color: '#ffffff',
  source: 'source model', rig: 'none', data: 'source model', triangles: 0, lods: 0,
  decompositions: [], atlases: [], paints: [], ...overrides,
});

test('search is global across models and catalog assets', () => {
  const hits = searchLibrary('moped', [asset({})], [model({})]);
  assert(hits.length === 1 && hits[0]?.kind === 'model', 'model outside the selected folder was not found');
});

test('search includes paths, stable ids, recipes, variants, and semantic metadata', () => {
  const assets = [asset({ recipe: 'weathered aggregate', variants: ['rain-dark'] })];
  const models = [model({ semanticKind: 'street transport' })];
  assert(searchLibrary('rain-dark', assets, models)[0]?.kind === 'asset', 'asset variant was not searchable');
  assert(searchLibrary('street transport', assets, models)[0]?.kind === 'model', 'model semantic metadata was not searchable');
});

test('name matches rank ahead of metadata-only matches', () => {
  const hits = searchLibrary('concrete', [
    asset({ id: 'material:metadata', name: 'Road', recipe: 'concrete aggregate' }),
    asset({ id: 'material:name', name: 'Concrete Smooth' }),
  ], []);
  assert(hits[0]?.kind === 'asset' && hits[0].asset.id === 'material:name', 'metadata match outranked a name prefix');
});

test('blank and unmatched queries return no result rows', () => {
  assert(searchLibrary('   ', [asset({})], [model({})]).length === 0, 'blank query created a global dump');
  assert(searchLibrary('no-such-asset', [asset({})], [model({})]).length === 0, 'unmatched query returned an item');
});

if (failed > 0) throw new Error(`${failed} library-search test(s) failed`);
log(`librarySearch: ${passed} passed`);
