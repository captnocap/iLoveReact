// Run:
//   tools/esbuild cart/editor/shell/ShaderGridBatch.test.ts --bundle --outfile=/tmp/editor-shader-grid-batch.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-shader-grid-batch.test.js
import {
  SHADER_GRID_TUNING,
  isBatchableFillData,
  packFillShaderGridData,
  sameShaderGridBatchProps,
  shaderGridDimensions,
} from './ShaderGridBatch';

let passed = 0;
let failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, body: () => void): void {
  try { body(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

test('keeps the fixed 8 by 6 browser geometry and all 48 cells', () => {
  const size = shaderGridDimensions(SHADER_GRID_TUNING.maxCells);
  assert(size.rows === 6, `expected six rows, got ${size.rows}`);
  assert(size.width === 316, `expected 316px grid width, got ${size.width}`);
  assert(size.height === 236, `expected 236px grid height, got ${size.height}`);
});

test('packs variable rows behind stable cell offsets and preserves fallback holes', () => {
  const plain = [4, 1, 22, 2, 3];
  const palette = [7, 0, 8, 2, 1, 1, 0.1, 0.2, 0.3];
  const packed = packFillShaderGridData([plain, null, palette]);
  assert(packed[0] === -1 && packed[1] === 3, 'grid marker or cell count header was lost');
  assert(packed[8] === 11, `plain row offset should be 11, got ${packed[8]}`);
  assert(packed[9] === -1, 'custom-shader fallback cell was not transparent');
  assert(packed[10] === 17, `palette row offset should be 17, got ${packed[10]}`);
  assert(packed[16] === 0, 'five-float row did not receive an explicit zero palette count');
  assert(plain.length === 5, 'packing mutated its source data');
});

test('rejects malformed fill rows instead of reading across packed boundaries', () => {
  assert(isBatchableFillData([0, 0, 0, 2, 0]), 'canonical five-float fill row was rejected');
  assert(isBatchableFillData([0, 0, 0, 2, 0, 1, 0.2, 0.3, 0.4]), 'valid palette row was rejected');
  assert(!isBatchableFillData([0, 0, 0, 2]), 'short fill row escaped validation');
  assert(!isBatchableFillData([0, 0, 0, 2, 0, 2, 0.2, 0.3, 0.4]), 'truncated palette escaped validation');
  assert(!isBatchableFillData([0, 0, Number.NaN, 2, 0]), 'non-finite fill data escaped validation');
});

test('value-equal packed buffers preserve the StaticSurface cache', () => {
  const base = { data: [1, 2, 3], width: 316, height: 236 };
  assert(sameShaderGridBatchProps(base, { ...base, data: [1, 2, 3] }), 'equal fresh data invalidated the batch');
  assert(!sameShaderGridBatchProps(base, { ...base, data: [1, 2, 4] }), 'real data change was ignored');
  assert(!sameShaderGridBatchProps(base, { ...base, height: 196 }), 'geometry change was ignored');
});

test('refuses more than the visible-page contract', () => {
  let threw = false;
  try { packFillShaderGridData(new Array(SHADER_GRID_TUNING.maxCells + 1).fill(null)); }
  catch { threw = true; }
  assert(threw, 'oversize page silently exceeded the 48-cell contract');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
