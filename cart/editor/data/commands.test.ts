// cart/editor/data/commands.test.ts — model command ownership at the outliner/face
// boundary (req_2870). A multi-part outliner selection is represented by selected
// faces in the host, but its Merge verb must stay structural.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/commands.test.ts --bundle \
//     --outfile=/tmp/editor-commands.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-commands.test.js

import { meshPartCommands, meshTopoCommands } from './commands';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (e) { failed += 1; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
const ids = (commands: { id: string }[]) => commands.map((command) => command.id);

test('ordinary face selection still offers authored-face merge', () => {
  const commands = ids(meshTopoCommands({ selMode: 3, sel: 2 }, 1));
  assert(commands.includes('mesh-merge-faces'), 'Merge Faces remains available for a real face selection');
});

test('multi-part outliner selection cannot fall through to Merge Faces', () => {
  const commands = ids(meshTopoCommands({ selMode: 3, sel: 12 }, 2));
  assert(!commands.includes('mesh-merge-faces'), 'Merge Faces is hidden while selected faces represent multiple parts');
});

test('structural merge requires the explicit selected set, not list adjacency', () => {
  const one = ids(meshPartCommands(true, 1));
  const many = ids(meshPartCommands(true, 2));
  assert(!one.includes('mesh-merge-down'), 'one selected row cannot infer a neighbor from list order');
  assert(many.includes('mesh-merge-down'), 'two selected rows expose structural merge');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
