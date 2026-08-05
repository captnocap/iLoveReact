// Durable Asset Explorer history save-shape contract.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/libraryHistoryStore.test.ts --bundle \
//     --outfile=/tmp/editor-library-history-store.test.js --format=iife \
//     --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-library-history-store.test.js
import { parseLibraryHistoryText } from './libraryHistoryStore';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
function assertThrows(fn: () => void, message: string) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  assert(threw, message);
}

test('valid history revives newest-first mixed keys', () => {
  const keys = parseLibraryHistoryText(JSON.stringify({
    version: 1,
    recentKeys: ['model:speaker', 'asset:water', 'model:speaker', 'folder:models'],
  }));
  assert(keys.join(',') === 'model:speaker,asset:water', 'saved history did not validate or deduplicate');
});

test('unknown versions and missing key arrays fail closed', () => {
  assertThrows(() => parseLibraryHistoryText('{"version":2,"recentKeys":[]}'), 'unknown version loaded');
  assertThrows(() => parseLibraryHistoryText('{"version":1}'), 'missing recentKeys loaded');
});

if (failed > 0) throw new Error(`${failed} library-history-store test(s) failed`);
log(`libraryHistoryStore: ${passed} passed`);
