// Asset Explorer favorite/recent collection contract.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/libraryCollections.test.ts --bundle \
//     --outfile=/tmp/editor-library-collections.test.js --format=iife \
//     --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-library-collections.test.js
import { favoriteLibraryHits, LIBRARY_COLLECTION_TUNING, navigateLibraryCollection, normalizeRecentLibraryKeys, recentLibraryHits, rememberRecentLibraryItem } from './libraryCollections';
import { librarySearchHitKey } from './librarySearch';
import type { Asset, ModelPackage } from './types';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const asset = (id: string, favorite = false): Asset => ({ id, tab: 'Skins', name: id, color: '#777777', used: 0, favorite });
const model = (id: string, favorite = false): ModelPackage => ({
  id, folderId: `model-${id}`, name: id, path: `/models/${id}`, kind: 'prop', stage: 'wip',
  color: '#ffffff', source: 'source model', rig: 'none', data: 'source model', triangles: 0,
  lods: 0, decompositions: [], atlases: [], paints: [], favorite,
});

test('favorites include both models and catalog assets', () => {
  const hits = favoriteLibraryHits([asset('water', true), asset('sand')], [model('speaker', true), model('crate')]);
  const keys = hits.map(librarySearchHitKey);
  assert(keys.includes('asset:water'), 'favorite material was absent');
  assert(keys.includes('model:speaker'), 'favorite model was absent');
  assert(keys.length === 2, 'unfavorited items leaked into Favorites');
});

test('recents preserve newest-first mixed item order and skip missing ids', () => {
  const hits = recentLibraryHits(
    ['model:speaker', 'asset:water', 'asset:deleted'],
    [asset('water')],
    [model('speaker')],
  );
  assert(hits.map(librarySearchHitKey).join(',') === 'model:speaker,asset:water', 'Recent lost order or retained a missing item');
});

test('remembering an item moves it to the front without duplicates', () => {
  const keys = rememberRecentLibraryItem(['asset:water', 'model:speaker'], 'model:speaker');
  assert(keys.join(',') === 'model:speaker,asset:water', 'recent selection did not move to the front');
});

test('persisted recents accept only mixed library keys and remain bounded', () => {
  const raw = [
    'asset:water',
    'asset:water',
    'model:speaker',
    'folder:models',
    '',
    42,
    ...Array.from({ length: 30 }, (_, index) => `asset:item-${index}`),
  ];
  const keys = normalizeRecentLibraryKeys(raw);
  assert(keys.slice(0, 2).join(',') === 'asset:water,model:speaker', 'normalization lost newest-first order or deduplication');
  assert(keys.length === LIBRARY_COLLECTION_TUNING.recentLimit, 'persisted history escaped its cap');
  assert(!keys.includes('folder:models'), 'unknown key family entered Recent');
});

test('quick collections toggle back to the exact prior folder', () => {
  const focused = navigateLibraryCollection('models-props', 'models-props', 'materials-favorites');
  assert(focused.folder === 'materials-favorites' && focused.returnFolder === 'models-props', 'Favorites forgot the entry folder');
  const switched = navigateLibraryCollection(focused.folder, focused.returnFolder, 'materials-recent');
  assert(switched.folder === 'materials-recent' && switched.returnFolder === 'models-props', 'switching collections replaced the return point');
  const cleared = navigateLibraryCollection(switched.folder, switched.returnFolder, 'materials-recent');
  assert(cleared.folder === 'models-props' && cleared.returnFolder === 'models-props', 'clicking the selected collection did not clear it');
});

if (failed > 0) throw new Error(`${failed} library-collection test(s) failed`);
log(`libraryCollections: ${passed} passed`);
