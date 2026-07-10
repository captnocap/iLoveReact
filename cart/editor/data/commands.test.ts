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

import { menuNodes, meshPartCommands, meshTopoCommands, type MenuNode } from './commands';
import { BUILD_PIECE_STARTERS } from './buildStarters';

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

test('New Mesh exposes every semantic build kind under one nested menu', () => {
  const newMesh = menuNodes('File').find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'New Mesh');
  assert(!!newMesh, 'File menu lost New Mesh');
  const build = newMesh!.children.find((node): node is Extract<MenuNode, { kind: 'sub' }> => node.kind === 'sub' && node.id === 'Build Pieces');
  assert(!!build, 'New Mesh lost its Build Pieces submenu');
  const commandIds = build!.children.filter((node): node is Extract<MenuNode, { kind: 'cmd' }> => node.kind === 'cmd').map((node) => node.id);
  const expected = BUILD_PIECE_STARTERS.map((starter) => `new-build-starter-${starter.kind}`);
  assert(commandIds.join('|') === expected.join('|'), `starter menu drifted: ${commandIds.join(', ')}`);
  assert(newMesh!.children.some((node) => node.kind === 'cmd' && node.id === 'new-model-player'), 'Player / NPC starter disappeared');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
