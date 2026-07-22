// cart/editor/model/viewportPresentation.test.ts — authored-vs-render topology rule.
//
//   tools/esbuild cart/editor/model/viewportPresentation.test.ts --bundle \
//     --outfile=/tmp/editor-viewport-presentation.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-viewport-presentation.test.js

import { triangleWireframeVisible } from './viewportPresentation';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function test(name: string, run: () => void): void {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

test('raw triangle wireframe remains a plain View-mode diagnostic', () => {
  assert(triangleWireframeVisible(true, 0), 'View mode hid an explicitly requested triangle wireframe');
  assert(!triangleWireframeVisible(false, 0), 'View mode invented a triangle wireframe');
});

test('mesh-edit modes reserve the viewport for authored topology', () => {
  for (const mode of [1, 2, 3]) {
    assert(!triangleWireframeVisible(true, mode), `mode ${mode} exposed render diagonals over authored edges`);
  }
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
