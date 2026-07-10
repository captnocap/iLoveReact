// Run:
//   tools/esbuild cart/editor/model/meshCollision.test.ts --bundle --outfile=/tmp/editor-mesh-collision.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-mesh-collision.test.js
import { compileOutlinerCollisionBoxes, MESH_COLLISION_TUNING } from './meshCollision';
import type { MeshDocPartMeta, PackageMeshDoc } from '../data/meshDoc';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function triangleAt(x: number, y: number): number[] {
  return [
    x, y, 0, 0, 1, 0, 0, 0,
    x + 1, y, 0, 0, 1, 0, 1, 0,
    x, y, 1, 0, 1, 0, 0, 1,
  ];
}

function fixture(count: number, rise = 0.25): { vertices: Float32Array; doc: PackageMeshDoc; parts: MeshDocPartMeta[] } {
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) values.push(...triangleAt(i * 1.25, i * rise));
  const groups = new Uint32Array(count);
  const ranges: { lo: number; hi: number }[] = [];
  const parts: MeshDocPartMeta[] = [];
  for (let i = 0; i < count; i += 1) {
    groups[i] = i;
    ranges.push({ lo: i, hi: i + 1 });
    parts.push({ name: `Deck (${i + 1})`, color: '#888888', visible: true, groupId: 'bridge', groupName: 'Bridge' });
  }
  const vertices = new Float32Array(values);
  return { vertices, doc: { vertices, faceGroups: groups, ranges }, parts };
}

test('rising Outliner members keep separate local height bands', () => {
  const f = fixture(3, 2);
  const boxes = compileOutlinerCollisionBoxes(f.vertices, f.doc, f.parts);
  assert(boxes.length === 3, `expected three part bands, got ${boxes.length}`);
  assert(boxes[0]!.maxY === 0 && boxes[1]!.maxY === 2 && boxes[2]!.maxY === 4, 'walkable tops no longer follow the visible rise');
  assert(boxes.every((box) => Math.abs((box.maxY - box.minY) - MESH_COLLISION_TUNING.minimumThicknessMeters) < 1e-9), 'flat decks did not receive a downward-only skin');
});

test('long paths reduce locally to the host budget without losing either endpoint', () => {
  const f = fixture(33, 0.5);
  const boxes = compileOutlinerCollisionBoxes(f.vertices, f.doc, f.parts);
  assert(boxes.length === MESH_COLLISION_TUNING.hostBoxBudget, `expected ${MESH_COLLISION_TUNING.hostBoxBudget} boxes, got ${boxes.length}`);
  assert(Math.min(...boxes.map((box) => box.minX)) <= 0, 'first bridge bay disappeared');
  assert(Math.max(...boxes.map((box) => box.maxX)) >= 41, 'last bridge bay disappeared');
  assert(boxes.every((box) => box.maxY - box.minY < 3), 'a local merge recreated the whole-height wall');
});

test('hidden Outliner members do not produce invisible collision', () => {
  const f = fixture(3);
  f.parts[1] = { ...f.parts[1]!, visible: false };
  const boxes = compileOutlinerCollisionBoxes(f.vertices, f.doc, f.parts);
  assert(boxes.length === 2, 'hidden member still blocks the player');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
