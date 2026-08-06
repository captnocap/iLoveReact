// Cold-load versus hot-resume glass restoration contract.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/model/glassHydration.test.ts --bundle \
//     --outfile=/tmp/editor-glass-hydration.test.js --format=iife \
//     --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-glass-hydration.test.js
import { shouldRestoreSavedGlass } from './glassHydration';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('cold model load restores the saved trailing glass boundary once', () => {
  assert(shouldRestoreSavedGlass({ resumedHostSession: false, alreadyRestored: false, glassFirstVertex: 9 }), 'cold load skipped saved glass');
  assert(!shouldRestoreSavedGlass({ resumedHostSession: false, alreadyRestored: true, glassFirstVertex: 9 }), 'cold load restored glass twice');
});

test('hot-resumed host mesh never receives the stale saved glass boundary', () => {
  assert(!shouldRestoreSavedGlass({ resumedHostSession: true, alreadyRestored: false, glassFirstVertex: 9 }), 'hot resume replayed stale saved glass over resident face order');
});

test('missing glass metadata is never restored', () => {
  assert(!shouldRestoreSavedGlass({ resumedHostSession: false, alreadyRestored: false, glassFirstVertex: null }), 'missing glass boundary reached the host');
});

if (failed > 0) throw new Error(`${failed} glass-hydration test(s) failed`);
log(`glassHydration: ${passed} passed`);
