// Run:
//   tools/esbuild cart/editor/data/scaleBy.test.ts --bundle --outfile=/tmp/editor-scale-by.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-scale-by.test.js
import { parseScaleByFactor, SCALE_BY_TUNING } from './scaleBy';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('accepts the bridge authoring factor exactly', () => {
  const parsed = parseScaleByFactor('48');
  assert(parsed.ok && parsed.factor === 48, '×48 did not survive parsing exactly');
});

test('accepts fractional down-scaling inside the engine contract', () => {
  const parsed = parseScaleByFactor('0.5');
  assert(parsed.ok && parsed.factor === 0.5, 'fractional scale was rejected');
});

test('rejects no-op, non-finite, and out-of-contract factors without clamping', () => {
  assert(!parseScaleByFactor('1').ok, '×1 became a phantom edit');
  assert(!parseScaleByFactor('Infinity').ok, 'infinite scale escaped validation');
  assert(!parseScaleByFactor(String(SCALE_BY_TUNING.max + 1)).ok, 'oversize input was silently clamped');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
