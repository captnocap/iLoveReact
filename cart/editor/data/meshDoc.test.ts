// cart/editor/data/meshDoc.test.ts — RJMD v1/v2/v3 compatibility at the pure wire boundary.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/meshDoc.test.ts --bundle \
//     --outfile=/tmp/editor-meshdoc.test.js --format=iife --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-meshdoc.test.js
import { inferMeshDocPartRanges, invalidateMeshDoc, meshDocHiddenRanges, meshDocIsUnreadable, readMeshDoc, writeMeshDoc, meshDocPartMetadataCanShrink, meshDocPartRangesComplete, meshDocPartRangesFromRows, meshDocRangeGeometry, meshDocSemanticsMatch, meshDocWouldEraseSemantics, parseMeshDocBytes, partsMetaFromRows } from './meshDoc';
import { writeModelArtifacts } from './modelPackageStore';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function docBlob(version: 1 | 2 | 3, glassFirstVertex = 3, material = 0xffffffff): Uint8Array {
  const headerBytes = version === 3 ? 32 : version === 2 ? 28 : 24;
  const bytes = new Uint8Array(headerBytes + 3 * 8 * 4 + 4 + (version === 3 ? 4 : 0) + 8);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, 0x444d4a52, true);
  dv.setUint32(4, version, true);
  dv.setUint32(8, 3, true); // vertices
  dv.setUint32(12, 1, true); // faces
  dv.setUint32(16, 1, true); // groups present
  dv.setUint32(20, 1, true); // one part range
  if (version >= 2) dv.setUint32(24, glassFirstVertex, true);
  if (version === 3) dv.setUint32(28, 1, true);
  let at = headerBytes;
  for (let i = 0; i < 24; i += 1) { dv.setFloat32(at, i / 10, true); at += 4; }
  dv.setUint32(at, 7, true); at += 4;
  if (version === 3) { dv.setUint32(at, material, true); at += 4; }
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

test('RJMD v3 preserves stable per-face texture-role indices', () => {
  const doc = parseMeshDocBytes(docBlob(3, 3, 2));
  assert(!!doc, 'v3 document was rejected');
  assert(doc!.faceMaterials?.[0] === 2, 'v3 texture-role row shifted');
  assert(doc!.faceGroups?.[0] === 7 && doc!.ranges[0]?.lo === 7, 'v3 groups/ranges shifted around materials');
});

test('parts metadata preserves organizational groups while ranking by host range', () => {
  const rows = partsMetaFromRows([
    { name: 'divider', color: '#bbb', visible: false, lo: 8, groupId: 'rails', groupName: 'Rails', groupPath: [{ id: 'bridge', name: 'Bridge' }, { id: 'rails', name: 'Rails' }], outlinerOrder: 0 },
    { name: 'deck', color: '#aaa', visible: true, lo: 2, groupId: 'bridge', groupName: 'Bridge', groupPath: [{ id: 'bridge', name: 'Bridge' }], outlinerOrder: 1 },
  ]);
  assert(rows[0]?.name === 'deck' && rows[1]?.name === 'divider', 'host-range ranking changed');
  assert(rows[1]?.groupPath?.map((group) => group.id).join('/') === 'bridge/rails', 'nested group metadata was stripped from parts.json rows');
  assert(rows[0]?.outlinerOrder === 1 && rows[1]?.outlinerOrder === 0, 'display order was rewritten to host range rank');
  assert(rows[1]?.visible === false, 'hidden visibility was rewritten during rank ordering');
  const hidden = meshDocHiddenRanges([{ lo: 2, hi: 8 }, { lo: 8, hi: 12 }], rows);
  assert(JSON.stringify(hidden) === JSON.stringify([{ lo: 8, hi: 12 }]), `cold hydration hid the wrong range: ${JSON.stringify(hidden)}`);
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
  // req_3405: the two-file transaction TORE (an authorized merge wrote doc.blob's
  // collapsed range table; the app died before parts.json followed). The doc's own
  // table is the boundary truth — a stale 3-row sidecar may not hold the merged
  // 1-range document hostage; the save repairs the sidecar.
  assert(meshDocPartMetadataCanShrink(1, 3, 1), 'a torn stale parts.json held the merged document hostage');
  assert(!meshDocPartMetadataCanShrink(2, 3, 1), 'matching the stale sidecar instead of the doc range table was allowed to destroy a boundary');
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
  assert(part.positions.length === 48, `expected two triangles, got ${part.positions.length / 24}`);
  assert(part.positions[0] === 24 && part.positions[24] === 48, 'wrong source triangles copied');
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

function semanticDocBlob(): Uint8Array {
  const tableText = JSON.stringify({ version: 1, regions: [{ id: 5, name: 'window.rim', createdBy: { op: 'inset', take: 3 } }] });
  const table = Uint8Array.from(Array.from(tableText, (ch) => ch.charCodeAt(0)));
  const headerBytes = 40;
  const vertCount = 3;
  const faceCount = 1;
  const bytes = new Uint8Array(headerBytes + vertCount * 8 * 4 + faceCount * 4 + faceCount * 8 + 8 + table.length);
  new Uint32Array(bytes.buffer, 0, 10).set([0x444d4a52, 4, vertCount, faceCount, 1, 1, 3, 0, 1, table.length]);
  let at = headerBytes + vertCount * 8 * 4;
  new Uint32Array(bytes.buffer, at, 1)[0] = 0; at += 4;
  new Uint32Array(bytes.buffer, at, 1)[0] = 5; at += 4;
  new Uint32Array(bytes.buffer, at, 1)[0] = 2; at += 4;
  new Uint32Array(bytes.buffer, at, 2).set([0, 1]); at += 8;
  bytes.set(table, at);
  return bytes;
}

test('RJMD v4 restores semantic membership and its name table together', () => {
  const doc = parseMeshDocBytes(semanticDocBlob());
  assert(!!doc, 'v4 fixture did not decode');
  assert(doc!.semanticRegions?.[0] === 5, 'region membership was lost');
  assert(doc!.semanticInstances?.[0] === 2, 'instance membership was lost');
  assert(doc!.semanticTable?.regions[0]?.name === 'window.rim', 'semantic name table was lost');
});

test('RJMD v4 rejects semantic membership without a dictionary', () => {
  const bytes = semanticDocBlob();
  new Uint32Array(bytes.buffer, 36, 1)[0] = 0;
  assert(parseMeshDocBytes(bytes) === null, 'orphaned semantic ids were accepted');
});

test('save verification rejects geometry-only success that dropped resident names', () => {
  const resident = {
    faces: 3, unnamed: 0,
    table: { version: 1 as const, regions: [{ id: 5, name: 'window.rim', role: 'rim' }] },
  };
  assert(!meshDocSemanticsMatch(resident, {
    semanticRegions: null, semanticInstances: null, semanticTable: null,
  }), 'geometry-only RJMD was accepted for a named resident mesh');
  assert(meshDocSemanticsMatch(resident, {
    semanticRegions: new Uint32Array([5, 5, 5]),
    semanticInstances: new Uint32Array([0, 0, 0]),
    semanticTable: resident.table,
  }), 'matching durable semantics were rejected');
  assert(meshDocWouldEraseSemantics({ ...resident, unnamed: 3 }, {
    semanticRegions: new Uint32Array([5, 5, 5]),
  }), 'anonymous hydration was allowed to erase a named durable document');
});

test('an undecodable doc.blob is never rebuilt from base.blob, and blocks the save', () => {
  const host = globalThis as any;
  const names = [
    '__fs_exists', '__fs_read', '__fs_read_base64', '__fs_mkdir',
    '__model_meshdoc_write', '__model_mesh_write', '__model_atlas_read', '__model_paint_program_read',
  ];
  const prior = new Map(names.map((name) => [name, host[name]]));
  const dir = 'cart/editor/data/models/props/undecodable';
  let documentWrites = 0;
  try {
    // A real package: a doc.blob that will NOT decode (truncated below its own header's
    // `need`), sitting beside the base.blob that every save rewrites. This is exactly the
    // shape that turned a finished quad model into 132 loose triangles.
    const corrupt = docBlob(3);
    const truncated = corrupt.slice(0, corrupt.length - 12);
    const legacyVerts = new Uint8Array(3 * 32);
    const toB64 = (bytes: Uint8Array) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let out = '';
      for (let at = 0; at < bytes.length; at += 3) {
        const n = (bytes[at]! << 16) | ((bytes[at + 1] ?? 0) << 8) | (bytes[at + 2] ?? 0);
        out += chars[(n >>> 18) & 63]! + chars[(n >>> 12) & 63]!
          + (at + 1 < bytes.length ? chars[(n >>> 6) & 63]! : '=')
          + (at + 2 < bytes.length ? chars[n & 63]! : '=');
      }
      return out;
    };
    host.__fs_exists = (path: string) => path.endsWith('/mesh/doc.blob') || path.endsWith('/mesh/base.blob');
    host.__fs_read = () => null;
    host.__fs_read_base64 = (path: string) => (
      path.endsWith('/mesh/doc.blob') ? toB64(truncated)
        : path.endsWith('/mesh/base.blob') ? toB64(legacyVerts)
          : null
    );
    host.__fs_mkdir = () => true;
    host.__model_meshdoc_write = () => { documentWrites += 1; return 1; };
    host.__model_mesh_write = () => 1;
    host.__model_atlas_read = () => '{}';
    host.__model_paint_program_read = () => '';

    invalidateMeshDoc(dir);
    assert(readMeshDoc(dir) === null, 'an undecodable doc.blob was silently rebuilt from base.blob');
    assert(meshDocIsUnreadable(dir), 'an undecodable doc.blob was reported as an absent document');
    assert(!writeMeshDoc(dir, partsMetaFromRows([{ name: 'Body', color: '#fff', visible: true }] as any)),
      'a save was allowed to land on top of an undecodable document');
    assert(documentWrites === 0, 'the host was asked to overwrite an undecodable document');
  } finally {
    invalidateMeshDoc(dir);
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
