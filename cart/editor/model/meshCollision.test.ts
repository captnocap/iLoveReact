// Run:
//   tools/esbuild cart/editor/model/meshCollision.test.ts --bundle --outfile=/tmp/editor-mesh-collision.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-mesh-collision.test.js
import { compileOutlinerCollision, compileOutlinerCollisionBoxes, decodeCollisionBake, encodeCollisionBake, MESH_COLLISION_TUNING } from './meshCollision';
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

type Point = readonly [number, number, number];
function triangle(a: Point, b: Point, c: Point): number[] {
  return [
    ...a, 0, 0, 1, 0, 0,
    ...b, 0, 0, 1, 0, 0,
    ...c, 0, 0, 1, 0, 0,
  ];
}
function quad(a: Point, b: Point, c: Point, d: Point): number[] {
  return [...triangle(a, b, c), ...triangle(a, c, d)];
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
  const collision = compileOutlinerCollision(f.vertices, f.doc, f.parts);
  const boxes = collision.boxes;
  assert(boxes.length === 3, `expected three part bands, got ${boxes.length}`);
  assert(collision.triangles.length === 3 * 9, 'multi-Outliner exact payload did not retain every visible member');
  assert(boxes[0]!.maxY === 0 && boxes[1]!.maxY === 2 && boxes[2]!.maxY === 4, 'walkable tops no longer follow the visible rise');
  assert(boxes.every((box) => Math.abs((box.maxY - box.minY) - MESH_COLLISION_TUNING.minimumThicknessMeters) < 1e-9), 'flat decks did not receive a downward-only skin');
});

test('one welded Outliner member keeps its doorway instead of becoming one whole-mesh block', () => {
  // Each jamb shares a vertex with the header, so the host fallback sees one
  // connected island whose AABB seals the empty 2m-wide doorway.
  const vertices = new Float32Array([
    ...quad([0, 0, 0], [1, 0, 0], [1, 4, 0], [0, 4, 0]),
    ...quad([3, 0, 0], [4, 0, 0], [4, 4, 0], [3, 4, 0]),
    ...quad([0, 3, 0], [4, 3, 0], [4, 4, 0], [0, 4, 0]),
  ]);
  const doc: PackageMeshDoc = {
    vertices,
    faceGroups: new Uint32Array(6),
    ranges: [{ lo: 0, hi: 1 }],
  };
  const collision = compileOutlinerCollision(vertices, doc, [{ name: 'Arch', color: '#888888', visible: true }]);
  const boxes = collision.boxes;
  assert(boxes.length > 1, `single-member arch should decompose, got ${boxes.length} box(es)`);
  assert(collision.triangles.length === 6 * 9, 'the exact welded-arch triangles were not preserved for host narrowphase');
  assert(!boxes.some((box) => box.minX <= 2 && box.maxX >= 2 && box.minY <= 1.5 && box.maxY >= 1.5), 'the empty doorway is still blocked');
  assert(boxes.some((box) => box.minX <= 2 && box.maxX >= 2 && box.minY <= 3.5 && box.maxY >= 3.5), 'the visible header stopped colliding');
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
  const collision = compileOutlinerCollision(f.vertices, f.doc, f.parts);
  assert(collision.boxes.length === 2, 'hidden member still blocks the player');
  assert(collision.triangles.length === 2 * 9, 'hidden member reached the exact narrowphase payload');
});

test('RJCB round-trip preserves the bake and its doc stamp', () => {
  const f = fixture(3, 2);
  const bake = compileOutlinerCollision(f.vertices, f.doc, f.parts);
  const stamp = '84736:1753500000000.123'; // deliberately not 4-byte aligned
  const record = decodeCollisionBake(encodeCollisionBake(bake, stamp));
  assert(record !== null, 'a freshly encoded record failed to decode');
  assert(record!.docStamp === stamp, `stamp mangled: '${record!.docStamp}'`);
  assert(record!.boxes.length === bake.boxes.length, 'box count drifted through the codec');
  for (let i = 0; i < bake.boxes.length; i += 1) {
    const a = bake.boxes[i]!, b = record!.boxes[i]!;
    assert(Math.abs(a.minX - b.minX) < 1e-6 && Math.abs(a.maxY - b.maxY) < 1e-6, `box ${i} moved through the codec`);
  }
  assert(record!.triangles.length === bake.triangles.length, 'triangle payload truncated');
  for (let i = 0; i < bake.triangles.length; i += 1) {
    assert(Math.abs(record!.triangles[i]! - bake.triangles[i]!) < 1e-6, `triangle float ${i} drifted`);
  }
});

test('RJCB encodes an empty bake as an honest no-collision declaration', () => {
  const record = decodeCollisionBake(encodeCollisionBake({ boxes: [], triangles: new Float32Array() }, 'legacy:12:34'));
  assert(record !== null, 'the empty record failed to decode');
  assert(record!.boxes.length === 0 && record!.triangles.length === 0, 'an empty bake grew content');
  assert(record!.docStamp === 'legacy:12:34', 'legacy stamp mangled');
});

test('RJCB refuses damaged bytes instead of resolving a corrupt collider', () => {
  const f = fixture(2);
  const bytes = encodeCollisionBake(compileOutlinerCollision(f.vertices, f.doc, f.parts), '1:2');
  assert(decodeCollisionBake(bytes.subarray(0, bytes.length - 5)) === null, 'a truncated record decoded');
  assert(decodeCollisionBake(bytes.subarray(0, 8)) === null, 'a header stub decoded');
  const wrongMagic = bytes.slice();
  wrongMagic[0] = 0x00;
  assert(decodeCollisionBake(wrongMagic) === null, 'a wrong-magic record decoded');
  assert(decodeCollisionBake(new Uint8Array(0)) === null, 'an empty file decoded');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
