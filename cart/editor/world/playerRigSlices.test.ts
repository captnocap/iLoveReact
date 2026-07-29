// cart/editor/world/playerRigSlices.test.ts
//
//   tools/esbuild cart/editor/world/playerRigSlices.test.ts --bundle \
//     --outfile=/tmp/editor-player-rig-slices.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-player-rig-slices.test.js

import { playerRigSlices } from './playerRigSlices';
import type { PackageMeshDoc, MeshDocPartMeta } from '../data/meshDoc';
import type { Skeleton } from '../../../runtime/skeleton';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function triangle(x: number): number[] {
  return [x, 0, 0, 0, 1, 0, 0, 0, x + 0.4, 0, 0, 0, 1, 0, 0, 0, x, 0.4, 0, 0, 1, 0, 0, 0];
}

test('missing range table regroups multiple shells onto exported bone centers', () => {
  const doc: PackageMeshDoc = {
    vertices: new Float32Array([...triangle(0), ...triangle(0.7), ...triangle(10)]),
    faceGroups: new Uint32Array([0, 1, 2]),
    ranges: [{ lo: 0, hi: 3 }],
    storedRangeCount: 0,
  };
  const meta: MeshDocPartMeta[] = [
    { name: 'fingers_left', color: '#fff', visible: true },
    { name: 'hand_right', color: '#fff', visible: true },
  ];
  const skeleton: Skeleton = {
    id: 'test',
    bones: [
      { id: 'root' },
      { id: 'fingers_left', parent: 'root', transform: { pos: [0, 0, 0] } },
      { id: 'hand_right', parent: 'root', transform: { pos: [10, 0, 0] } },
    ],
  };
  const slices = playerRigSlices(doc, meta, skeleton);
  assert(slices.recovered, 'recoverable multi-shell rig stayed collapsed');
  assert(slices.buckets.length === 2, `got ${slices.buckets.length} buckets`);
  assert(slices.buckets[0]!.length === 6, 'two left shells did not regroup onto one semantic bone');
  assert(slices.buckets[1]!.length === 3, 'right shell did not bind to its exported bone');
  assert(slices.centers[1]![0] > 9, 'recovered bind center did not return to measured mesh truth');
});

test('recovery fails closed when a named part has no exported bone', () => {
  const doc: PackageMeshDoc = {
    vertices: new Float32Array([...triangle(0), ...triangle(10)]),
    faceGroups: new Uint32Array([0, 1]),
    ranges: [{ lo: 0, hi: 2 }],
    storedRangeCount: 0,
  };
  const meta: MeshDocPartMeta[] = [
    { name: 'known', color: '#fff', visible: true },
    { name: 'mystery', color: '#fff', visible: true },
  ];
  const skeleton: Skeleton = { id: 'test', bones: [{ id: 'known', transform: { pos: [0, 0, 0] } }] };
  const slices = playerRigSlices(doc, meta, skeleton);
  assert(!slices.recovered, 'missing bone was guessed');
  assert(slices.buckets.length === 1, 'fail-closed path did not retain the durable one-range document');
});

test('ordered partition prevents a stale bone center from stealing the next shell', () => {
  const doc: PackageMeshDoc = {
    vertices: new Float32Array([...triangle(0), ...triangle(4), ...triangle(4.7), ...triangle(10)]),
    faceGroups: new Uint32Array([0, 1, 2, 3]),
    ranges: [{ lo: 0, hi: 4 }],
    storedRangeCount: 0,
  };
  const meta: MeshDocPartMeta[] = [
    { name: 'head', color: '#fff', visible: true },
    { name: 'fingers_left', color: '#fff', visible: true },
    { name: 'foot_left', color: '#fff', visible: true },
  ];
  const skeleton: Skeleton = {
    id: 'test',
    bones: [
      { id: 'head', transform: { pos: [0, 0, 0] } },
      { id: 'fingers_left', transform: { pos: [4.5, 0, 0] } },
      // Deliberately stale: nearest-center assignment would give the final
      // shell to fingers and leave this semantic endpoint empty.
      { id: 'foot_left', transform: { pos: [4.6, 0, 0] } },
    ],
  };
  const slices = playerRigSlices(doc, meta, skeleton);
  assert(slices.recovered, 'ordered recoverable rig stayed collapsed');
  assert(slices.buckets[0]!.length === 3, 'head did not receive the first run');
  assert(slices.buckets[1]!.length === 6, 'multi-shell middle part was not grouped');
  assert(slices.buckets[2]!.length === 3, 'stale endpoint center stole the final shell');
  assert(slices.centers[2]![0] > 9, 'bind center did not return to measured mesh truth');
});

log(`${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} player rig slice test(s) failed`);
