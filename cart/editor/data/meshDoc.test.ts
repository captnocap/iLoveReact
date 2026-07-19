// cart/editor/data/meshDoc.test.ts — RJMD v1/v2 compatibility at the pure wire boundary.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/meshDoc.test.ts --bundle \
//     --outfile=/tmp/editor-meshdoc.test.js --format=iife --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-meshdoc.test.js
import { inferMeshDocPartRanges, meshDocPartMetadataCanShrink, meshDocPartRangesComplete, meshDocPartRangesFromRows, meshDocRangeGeometry, parseMeshDocBytes, partsMetaFromRows } from './meshDoc';
import { writeModelArtifacts } from './modelPackageStore';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function docBlob(version: 1 | 2, glassFirstVertex = 3): Uint8Array {
  const headerBytes = version === 2 ? 28 : 24;
  const bytes = new Uint8Array(headerBytes + 3 * 8 * 4 + 4 + 8);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, 0x444d4a52, true);
  dv.setUint32(4, version, true);
  dv.setUint32(8, 3, true); // vertices
  dv.setUint32(12, 1, true); // faces
  dv.setUint32(16, 1, true); // groups present
  dv.setUint32(20, 1, true); // one part range
  if (version === 2) dv.setUint32(24, glassFirstVertex, true);
  let at = headerBytes;
  for (let i = 0; i < 24; i += 1) { dv.setFloat32(at, i / 10, true); at += 4; }
  dv.setUint32(at, 7, true); at += 4;
  dv.setUint32(at, 7, true); dv.setUint32(at + 4, 8, true);
  return bytes;
}

test('RJMD v1 remains readable and carries no glass boundary', () => {
  const doc = parseMeshDocBytes(docBlob(1));
  assert(!!doc, 'v1 document was rejected');
  assert(doc!.glassFirstVertex === null, 'v1 invented a glass boundary');
  assert(doc!.faceGroups?.[0] === 7 && doc!.ranges[0]?.lo === 7, 'v1 groups/ranges shifted');
});

test('RJMD v2 preserves the trailing glass vertex boundary', () => {
  const doc = parseMeshDocBytes(docBlob(2, 0));
  assert(!!doc, 'v2 document was rejected');
  assert(doc!.glassFirstVertex === 0, `v2 glass boundary changed to ${doc!.glassFirstVertex}`);
});

test('RJMD v2 rejects a non-triangle-aligned glass boundary', () => {
  assert(parseMeshDocBytes(docBlob(2, 2)) === null, 'misaligned glass boundary passed');
});

test('parts metadata preserves organizational groups while ranking by host range', () => {
  const rows = partsMetaFromRows([
    { name: 'divider', color: '#bbb', visible: true, lo: 8, groupId: 'bridge', groupName: 'Bridge deck' },
    { name: 'deck', color: '#aaa', visible: true, lo: 2, groupId: 'bridge', groupName: 'Bridge deck' },
  ]);
  assert(rows[0]?.name === 'deck' && rows[1]?.name === 'divider', 'host-range ranking changed');
  assert(rows.every((row) => row.groupId === 'bridge' && row.groupName === 'Bridge deck'), 'group metadata was stripped from parts.json rows');
});

test('a degraded host cannot overwrite a multi-part mesh document', () => {
  assert(!meshDocPartRangesComplete(15, 0), 'zero ranges were accepted for a 15-part model');
  assert(!meshDocPartRangesComplete(15, 1), 'one merged range was accepted for a 15-part model');
  assert(meshDocPartRangesComplete(15, 15), 'a complete range table was rejected');
  assert(!meshDocPartRangesComplete(1, 0), 'a single part without its one durable range was accepted');
  assert(meshDocPartRangesComplete(1, 1), 'a complete single-part range table was rejected');
  assert(!meshDocPartMetadataCanShrink(0, 15, 1), 'a collapsed fallback row could overwrite 15 saved names');
  assert(!meshDocPartMetadataCanShrink(15, 15, 1), 'a healthy document shrank without a destructive-action capability');
  assert(meshDocPartMetadataCanShrink(15, 15, 1, true), 'an explicitly authorized delete from a healthy document was blocked');
  assert(meshDocPartMetadataCanShrink(0, 15, 15), 'an exact recovered outliner could not repair its zero-range document');
  assert(!meshDocPartMetadataCanShrink(15, 1, 1), 'the durable range table did not outvote already-collapsed metadata');
});

test('save recovery accepts only complete non-overlapping live ranges', () => {
  const recovered = meshDocPartRangesFromRows([{ lo: 8, hi: 12 }, { lo: 0, hi: 8 }]);
  assert(JSON.stringify(recovered) === JSON.stringify([{ lo: 0, hi: 8 }, { lo: 8, hi: 12 }]), 'valid ranges were not normalized by rank');
  assert(meshDocPartRangesFromRows([{ lo: 0, hi: 8 }, { lo: 7, hi: 12 }]) === null, 'overlapping ranges were accepted');
  assert(meshDocPartRangesFromRows([{ lo: 0, hi: 8 }, { lo: undefined, hi: undefined }]) === null, 'missing ranges were guessed');
});

test('missing ranges recover only from an exact parts-to-connectivity-run match', () => {
  const vertices = new Float32Array(5 * 24);
  const triangles = [
    [[0, 0, 0], [1, 0, 0], [0, 1, 0]],       // group 0, component A
    [[1, 0, 0], [1, 1, 0], [0, 1, 0]],       // group 1, component A
    [[4, 0, 0], [5, 0, 0], [4, 1, 0]],       // group 2, component B
    [[0, 0, 0], [0, 1, 0], [-1, 0, 0]],      // group 3, component A again
    [[10, 0, 0], [11, 0, 0], [10, 1, 0]],    // group 10, gap forces a new run
  ];
  triangles.forEach((triangle, ti) => triangle.forEach((position, corner) => {
    const at = (ti * 3 + corner) * 8;
    vertices.set(position, at);
  }));
  const doc = { vertices, faceGroups: new Uint32Array([0, 1, 2, 3, 10]) };
  const recovered = inferMeshDocPartRanges(doc, 4);
  assert(JSON.stringify(recovered) === JSON.stringify([{ lo: 0, hi: 2 }, { lo: 2, hi: 3 }, { lo: 3, hi: 4 }, { lo: 10, hi: 11 }]), `exact runs were not recovered: ${JSON.stringify(recovered)}`);
  assert(inferMeshDocPartRanges(doc, 3) === null, 'ambiguous run/metadata mismatch was guessed');
});

test('package part extraction keeps only its range and normalizes face groups', () => {
  const vertices = new Float32Array(4 * 24);
  for (let i = 0; i < vertices.length; i += 1) vertices[i] = i;
  const part = meshDocRangeGeometry({
    vertices,
    faceGroups: new Uint32Array([2, 7, 8, 12]),
    ranges: [{ lo: 2, hi: 3 }, { lo: 7, hi: 10 }, { lo: 12, hi: 13 }],
  }, 1);
  assert(part.vertices.length === 48, `expected two triangles, got ${part.vertices.length / 24}`);
  assert(part.vertices[0] === 24 && part.vertices[24] === 48, 'wrong source triangles copied');
  assert(part.faceGroups[0] === 0 && part.faceGroups[1] === 1, 'source group ids were not normalized');
});

test('paint-only artifact persistence cannot rewrite editable mesh files', () => {
  const host = globalThis as any;
  const names = [
    '__fs_exists', '__fs_read', '__fs_mkdir', '__model_meshdoc_write',
    '__model_mesh_write', '__model_atlas_read', '__model_paint_program_read',
  ];
  const prior = new Map(names.map((name) => [name, host[name]]));
  let documentWrites = 0;
  let sourceMeshWrites = 0;
  try {
    host.__fs_exists = (path: string) => path.endsWith('/mesh/doc.blob');
    host.__fs_read = () => null;
    host.__fs_mkdir = () => true;
    host.__model_meshdoc_write = () => { documentWrites += 1; return 1; };
    host.__model_mesh_write = () => { sourceMeshWrites += 1; return 1; };
    host.__model_atlas_read = () => '{}';
    host.__model_paint_program_read = () => '';
    const ok = writeModelArtifacts({ kind: 'prop', id: 'test:paint-only', name: 'paint only' });
    assert(ok, 'paint-only persistence did not recognize the existing document');
    assert(documentWrites === 0, 'paint-only persistence rewrote doc.blob');
    assert(sourceMeshWrites === 0, 'paint-only persistence rewrote base.blob');
  } finally {
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
