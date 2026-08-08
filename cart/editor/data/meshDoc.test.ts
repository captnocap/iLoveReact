// cart/editor/data/meshDoc.test.ts — RJMD v1-v5 compatibility at the pure wire boundary.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/meshDoc.test.ts --bundle \
//     --outfile=/tmp/editor-meshdoc.test.js --format=iife --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-meshdoc.test.js
import { compareMeshDocs, meshDocRangeStats, meshDocTriangle, diagnoseMeshDocBytes, inferMeshDocPartRanges, invalidateMeshDoc, meshDocHiddenRanges, meshDocIsUnreadable, meshDocUnreadableDiagnostic, readCharacterMeshDoc, readMeshDoc, writeMeshDoc, meshDocPartMetadataCanShrink, meshDocPartRangesComplete, meshDocPartRangesFromRows, meshDocRangeGeometry, meshDocRangeObjectIdsMatch, meshDocSemanticsMatch, meshDocWouldEraseSemantics, parseMeshDocBytes, partsMetaFromRows } from './meshDoc';
import { writeModelArtifacts } from './modelPackageStore';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
function toB64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const n = (bytes[at]! << 16) | ((bytes[at + 1] ?? 0) << 8) | (bytes[at + 2] ?? 0);
    out += chars[(n >>> 18) & 63]! + chars[(n >>> 12) & 63]!
      + (at + 1 < bytes.length ? chars[(n >>> 6) & 63]! : '=')
      + (at + 2 < bytes.length ? chars[n & 63]! : '=');
  }
  return out;
}

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

function logicalDocBlob(): Uint8Array {
  const headerBytes = 48, vertCount = 6, faceCount = 2;
  const bytes = new Uint8Array(headerBytes + vertCount * 8 * 4 + faceCount * 4 + 8 + vertCount * 4);
  const words = new Uint32Array(bytes.buffer);
  words.set([0x444d4a52, 5, vertCount, faceCount, 1, 1, 6, 0, 0, 0, 1, 4]);
  const vertices = new Float32Array(bytes.buffer, headerBytes, vertCount * 8);
  const positions = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0],
    [0, 0, 0], [0, 1, 0], [1, 1, 0],
  ];
  positions.forEach((position, corner) => {
    vertices.set(position, corner * 8);
    // Deliberate normal/UV splits on the duplicate logical corners are legal.
    vertices[corner * 8 + 3] = corner;
    vertices[corner * 8 + 6] = corner / 10;
  });
  let at = headerBytes + vertCount * 8 * 4;
  new Uint32Array(bytes.buffer, at, faceCount).set([7, 8]); at += faceCount * 4;
  new Uint32Array(bytes.buffer, at, 2).set([7, 9]); at += 8;
  new Uint32Array(bytes.buffer, at, vertCount).set([0, 1, 2, 0, 2, 3]);
  return bytes;
}

function logicalObjectDocBlob(): Uint8Array {
  const headerBytes = 48, vertCount = 6, faceCount = 2;
  const semanticText = JSON.stringify({
    version: 1,
    regions: [{ id: 5, name: 'display name can change', role: 'chest' }],
    rangeObjects: [{ objectId: 'object-body-stable', lo: 7, hi: 9 }],
  });
  const semanticJson = Uint8Array.from(Array.from(semanticText, (ch) => ch.charCodeAt(0)));
  const bytes = new Uint8Array(headerBytes + vertCount * 8 * 4 + faceCount * 4 + faceCount * 8 + 8 + vertCount * 4 + semanticJson.length);
  new Uint32Array(bytes.buffer, 0, 12).set([0x444d4a52, 5, vertCount, faceCount, 1, 1, 6, 0, 1, semanticJson.length, 1, 4]);
  const vertices = new Float32Array(bytes.buffer, headerBytes, vertCount * 8);
  const positions = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0],
    [0, 0, 0], [0, 1, 0], [1, 1, 0],
  ];
  positions.forEach((position, corner) => vertices.set(position, corner * 8));
  let at = headerBytes + vertCount * 8 * 4;
  new Uint32Array(bytes.buffer, at, faceCount).set([7, 8]); at += faceCount * 4;
  new Uint32Array(bytes.buffer, at, faceCount).set([5, 5]); at += faceCount * 4;
  new Uint32Array(bytes.buffer, at, faceCount).set([0, 0]); at += faceCount * 4;
  new Uint32Array(bytes.buffer, at, 2).set([7, 9]); at += 8;
  new Uint32Array(bytes.buffer, at, vertCount).set([0, 1, 2, 0, 2, 3]); at += vertCount * 4;
  bytes.set(semanticJson, at);
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

test('RJMD v5 restores dense welded logical ids after range metadata', () => {
  const doc = parseMeshDocBytes(logicalDocBlob());
  assert(!!doc, 'v5 logical document was rejected');
  assert(doc!.formatVersion === 5 && doc!.hasLogicalVertices === true, 'v5 logical header was not surfaced');
  assert(doc!.logicalVertexCount === 4, `logical vertex count changed to ${doc!.logicalVertexCount}`);
  assert(Array.from(doc!.renderCornerLogicalIds ?? []).join(',') === '0,1,2,0,2,3', 'corner logical ids shifted around ranges');
  assert(doc!.ranges[0]?.lo === 7 && doc!.ranges[0]?.hi === 9, 'range section shifted around logical ids');
});

test('RJMD v5 rejects non-dense ids and separated render duplicates', () => {
  const missing = logicalDocBlob();
  const missingRowsAt = 48 + 6 * 8 * 4 + 2 * 4 + 8;
  new Uint32Array(missing.buffer, missingRowsAt, 6).set([0, 1, 2, 0, 2, 2]);
  assert(parseMeshDocBytes(missing) === null, 'a missing dense logical id was accepted');

  const separated = logicalDocBlob();
  const vertices = new Float32Array(separated.buffer, 48, 6 * 8);
  vertices[3 * 8] = 0.01;
  assert(parseMeshDocBytes(separated) === null, 'one logical id was allowed to occupy two model-space positions');
});

test('RJMD diagnostics preserve the first exact rejecting invariant', () => {
  const complete = logicalDocBlob();
  const truncated = complete.slice(0, -1);
  const short = diagnoseMeshDocBytes(truncated);
  assert(!short.ok && short.diagnostic.code === 'truncated-payload',
    `truncated v5 reason drifted to ${short.ok ? 'accepted' : short.diagnostic.code}`);
  assert(!short.ok && short.diagnostic.details?.expectedBytes === complete.length &&
    short.diagnostic.details?.actualBytes === truncated.length,
  'truncated payload diagnostic lost declared-versus-actual byte counts');

  const separated = logicalDocBlob();
  new Float32Array(separated.buffer, 48, 6 * 8)[3 * 8] = 0.01;
  const topology = diagnoseMeshDocBytes(separated);
  assert(!topology.ok && topology.diagnostic.code === 'logical-position-mismatch',
    `separated logical duplicate reason drifted to ${topology.ok ? 'accepted' : topology.diagnostic.code}`);
  assert(!topology.ok && topology.diagnostic.details?.logicalId === 0 && topology.diagnostic.details?.corner === 3,
    'logical topology diagnostic did not localize the stable id and render corner');
});

test('RJMD v5 binds stable object ids to explicit persisted ranges', () => {
  const doc = parseMeshDocBytes(logicalObjectDocBlob());
  assert(!!doc, 'v5 object metadata fixture did not decode');
  assert(doc!.rangeObjectIds?.join(',') === 'object-body-stable', 'stable object id was not restored');
  assert(doc!.semanticTable?.rangeObjects?.[0]?.lo === 7 && doc!.semanticTable?.rangeObjects?.[0]?.hi === 9,
    'object identity lost its explicit range bounds');
  assert(meshDocRangeObjectIdsMatch(doc, [{ objectId: 'object-body-stable' }]), 'matching range identity was rejected');
  assert(!meshDocRangeObjectIdsMatch(doc, [{ objectId: 'renamed-display-label' }]), 'display/rank identity substituted for the stable object id');

  const drifted = logicalObjectDocBlob();
  const semanticAt = 48 + 6 * 8 * 4 + 2 * 4 + 2 * 8 + 8 + 6 * 4;
  const text = Array.from(drifted.subarray(semanticAt), (byte) => String.fromCharCode(byte)).join('');
  const marker = '"lo":7';
  const byteAt = text.lastIndexOf(marker);
  assert(byteAt >= 0, 'fixture range marker missing');
  drifted[semanticAt + byteAt + marker.length - 1] = '8'.charCodeAt(0);
  assert(parseMeshDocBytes(drifted) === null, 'range/object metadata drifting from binary ranges was accepted');
});

test('saved character cold-reopens only its manifest-declared immutable RJMD', () => {
  const host = globalThis as any;
  const names = ['__fs_exists', '__fs_read_base64'];
  const prior = new Map(names.map((name) => [name, host[name]]));
  const dir = 'cart/editor/data/models/characters/cold-reopen';
  const geometryPath = `mesh/character-${'a'.repeat(64)}.rjmd`;
  const artifactPath = `${dir}/${geometryPath}`;
  let legacyReads = 0;
  try {
    host.__fs_exists = (path: string) => path === artifactPath || path === `${dir}/mesh/doc.blob`;
    host.__fs_read_base64 = (path: string) => {
      if (path === artifactPath) return toB64(logicalObjectDocBlob());
      if (path === `${dir}/mesh/doc.blob`) { legacyReads += 1; return toB64(docBlob(3)); }
      return null;
    };
    invalidateMeshDoc(dir);
    const reopened = readCharacterMeshDoc(dir, geometryPath);
    assert(reopened?.formatVersion === 5 && reopened.rangeObjectIds?.[0] === 'object-body-stable',
      'declared immutable character geometry did not cold-reopen');
    assert(legacyReads === 0, 'character cold-open touched the prop mesh/doc.blob fallback');

    const missingDir = `${dir}-missing`;
    host.__fs_exists = (path: string) => path === `${missingDir}/mesh/doc.blob`;
    host.__fs_read_base64 = (path: string) => {
      if (path === `${missingDir}/mesh/doc.blob`) { legacyReads += 1; return toB64(docBlob(3)); }
      return null;
    };
    invalidateMeshDoc(missingDir);
    assert(readCharacterMeshDoc(missingDir, geometryPath) === null, 'missing declared artifact fell back to mesh/doc.blob');
    assert(readCharacterMeshDoc(missingDir, '../mesh/doc.blob') === null, 'non-content-addressed character path was accepted');
    assert(legacyReads === 0, 'missing character artifact read the legacy prop document');
  } finally {
    invalidateMeshDoc(dir);
    invalidateMeshDoc(`${dir}-missing`);
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
});

test('parts metadata preserves organizational groups while ranking by host range', () => {
  const rows = partsMetaFromRows([
    { id: 'object-divider', name: 'divider', color: '#bbb', visible: false, lo: 8, groupId: 'rails', groupName: 'Rails', groupPath: [{ id: 'bridge', name: 'Bridge' }, { id: 'rails', name: 'Rails' }], outlinerOrder: 0 },
    { id: 'object-deck', name: 'deck', color: '#aaa', visible: true, lo: 2, groupId: 'bridge', groupName: 'Bridge', groupPath: [{ id: 'bridge', name: 'Bridge' }], outlinerOrder: 1 },
  ]);
  assert(rows[0]?.name === 'deck' && rows[1]?.name === 'divider', 'host-range ranking changed');
  assert(rows[1]?.groupPath?.map((group) => group.id).join('/') === 'bridge/rails', 'nested group metadata was stripped from parts.json rows');
  assert(rows[0]?.outlinerOrder === 1 && rows[1]?.outlinerOrder === 0, 'display order was rewritten to host range rank');
  assert(rows[1]?.visible === false, 'hidden visibility was rewritten during rank ordering');
  assert(rows[0]?.objectId === 'object-deck' && rows[1]?.objectId === 'object-divider', 'stable object ids followed display order instead of their objects');
  const hidden = meshDocHiddenRanges([{ lo: 2, hi: 8 }, { lo: 8, hi: 12 }], rows);
  assert(JSON.stringify(hidden) === JSON.stringify([{ lo: 8, hi: 12 }]), `cold hydration hid the wrong range: ${JSON.stringify(hidden)}`);
});

test('v5 writer passes stable ids in native range order, never display order', () => {
  const host = globalThis as any;
  const names = ['__fs_exists', '__fs_read', '__fs_read_base64', '__mesh_part_ranges', '__mesh_semantic_state', '__model_meshdoc_write'];
  const prior = new Map(names.map((name) => [name, host[name]]));
  const dir = 'cart/editor/data/models/characters/range-id-wire';
  let receivedIds = '';
  try {
    host.__fs_exists = () => false;
    host.__fs_read = () => null;
    host.__fs_read_base64 = () => null;
    host.__mesh_part_ranges = () => JSON.stringify({ ok: true, ranges: [[2, 8], [8, 12]] });
    delete host.__mesh_semantic_state;
    host.__model_meshdoc_write = (_path: string, count: number, ids: string) => {
      assert(count === 2, 'range count shifted at the native boundary');
      receivedIds = ids;
      return 0; // Stop before filesystem postconditions; this test owns the call contract.
    };
    invalidateMeshDoc(dir);
    const parts = partsMetaFromRows([
      { id: 'object-second', name: 'renamed second', color: '#bbb', visible: false, lo: 8, outlinerOrder: 0 },
      { id: 'object-first', name: 'renamed first', color: '#aaa', visible: true, lo: 2, outlinerOrder: 1 },
    ]);
    assert(!writeMeshDoc(dir, parts), 'boundary-only writer unexpectedly completed');
    assert(receivedIds === '["object-first","object-second"]', `native writer received display order/rank fallback: ${receivedIds}`);
  } finally {
    invalidateMeshDoc(dir);
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
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
  // req_3898: removing the LAST region reaches the same zero deliberately. Without a
  // capability the model became unsaveable, so an explicit Remove must pass while the
  // unauthorized drop above still refuses.
  assert(!meshDocWouldEraseSemantics({ ...resident, unnamed: 3 }, {
    semanticRegions: new Uint32Array([5, 5, 5]),
  }, true), 'an explicitly authorized Remove could not clear the durable table');
});

test('save repairs an exact anonymous source mount through the native RJMD gate', () => {
  const host = globalThis as any;
  const names = [
    '__fs_exists', '__fs_read', '__fs_read_base64', '__mesh_part_ranges',
    '__mesh_semantic_state', '__mesh_semantics_restore_from_rjmd', '__model_meshdoc_write',
  ];
  const prior = new Map(names.map((name) => [name, host[name]]));
  const dir = 'cart/editor/data/models/props/exact-semantic-recovery';
  const blob = toB64(semanticDocBlob());
  const table = { version: 1, regions: [{ id: 5, name: 'window.rim', createdBy: { op: 'inset', take: 3 } }] };
  let resident = { faces: 1, unnamed: 1, table };
  let recoveryCalls = 0;
  let writerCalls = 0;
  try {
    host.__fs_exists = (path: string) => path === `${dir}/mesh/doc.blob`;
    host.__fs_read = () => null;
    host.__fs_read_base64 = (path: string) => path === `${dir}/mesh/doc.blob` ? blob : null;
    host.__mesh_part_ranges = () => JSON.stringify({ ok: true, ranges: [[0, 1]] });
    host.__mesh_semantic_state = () => JSON.stringify(resident);
    host.__mesh_semantics_restore_from_rjmd = (path: string) => {
      recoveryCalls += 1;
      assert(path === `${dir}/mesh/doc.blob`, 'recovery did not read the exact durable artifact');
      resident = { ...resident, unnamed: 0 };
      return JSON.stringify({ ok: 1, restoredNamedFaces: 1 });
    };
    host.__model_meshdoc_write = () => { writerCalls += 1; return 0; };

    invalidateMeshDoc(dir);
    const completed = writeMeshDoc(dir, [{ objectId: 'object-body', name: 'Body', color: '#fff', visible: true }]);
    assert(!completed, 'boundary-only writer unexpectedly completed');
    assert(recoveryCalls === 1, 'anonymous resident did not enter exact native recovery once');
    assert(writerCalls === 1, 'save remained blocked after native recovery reproduced durable semantics');
  } finally {
    invalidateMeshDoc(dir);
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
});

test('background save still refuses when native semantic recovery cannot prove exact geometry', () => {
  const host = globalThis as any;
  const names = [
    '__fs_exists', '__fs_read', '__fs_read_base64', '__mesh_part_ranges',
    '__mesh_semantic_state', '__mesh_semantics_restore_from_rjmd', '__model_meshdoc_write',
  ];
  const prior = new Map(names.map((name) => [name, host[name]]));
  const dir = 'cart/editor/data/models/props/refused-semantic-recovery';
  let writerCalls = 0;
  try {
    host.__fs_exists = (path: string) => path === `${dir}/mesh/doc.blob`;
    host.__fs_read = () => null;
    host.__fs_read_base64 = (path: string) => path === `${dir}/mesh/doc.blob` ? toB64(semanticDocBlob()) : null;
    host.__mesh_part_ranges = () => JSON.stringify({ ok: true, ranges: [[0, 1]] });
    host.__mesh_semantic_state = () => JSON.stringify({
      faces: 1,
      unnamed: 1,
      table: { version: 1, regions: [{ id: 5, name: 'window.rim', createdBy: { op: 'inset', take: 3 } }] },
    });
    host.__mesh_semantics_restore_from_rjmd = () => JSON.stringify({ ok: 0, reason: 'geometry-mismatch' });
    host.__model_meshdoc_write = () => { writerCalls += 1; return 1; };

    invalidateMeshDoc(dir);
    assert(!writeMeshDoc(dir, [{ objectId: 'object-body', name: 'Body', color: '#fff', visible: true }]),
      'a geometry mismatch bypassed the semantic erase guard');
    assert(writerCalls === 0, 'the durable writer ran after exact recovery was refused');
  } finally {
    invalidateMeshDoc(dir);
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
});

test('an explicitly authoritative Save commits the anonymous resident without invoking recovery', () => {
  const host = globalThis as any;
  const names = [
    '__fs_exists', '__fs_read', '__fs_read_base64', '__mesh_part_ranges',
    '__mesh_semantic_state', '__mesh_semantics_restore_from_rjmd', '__model_meshdoc_write',
  ];
  const prior = new Map(names.map((name) => [name, host[name]]));
  const dir = 'cart/editor/data/models/props/explicit-live-save';
  let recoveryCalls = 0;
  let writerCalls = 0;
  try {
    host.__fs_exists = (path: string) => path === `${dir}/mesh/doc.blob`;
    host.__fs_read = () => null;
    host.__fs_read_base64 = (path: string) => path === `${dir}/mesh/doc.blob` ? toB64(semanticDocBlob()) : null;
    host.__mesh_part_ranges = () => JSON.stringify({ ok: true, ranges: [[0, 1]] });
    host.__mesh_semantic_state = () => JSON.stringify({
      faces: 1,
      unnamed: 1,
      table: { version: 1, regions: [] },
    });
    host.__mesh_semantics_restore_from_rjmd = () => {
      recoveryCalls += 1;
      return JSON.stringify({ ok: 0, reason: 'must-not-run' });
    };
    host.__model_meshdoc_write = () => { writerCalls += 1; return 0; };

    invalidateMeshDoc(dir);
    const completed = writeMeshDoc(
      dir,
      [{ objectId: 'object-body', name: 'Body', color: '#fff', visible: true }],
      undefined,
      { allowSemanticClear: true },
    );
    assert(!completed, 'boundary-only writer unexpectedly completed');
    assert(recoveryCalls === 0, 'explicit Save tried to replace the live semantic state from disk');
    assert(writerCalls === 1, 'explicit Save did not reach the native resident writer');
  } finally {
    invalidateMeshDoc(dir);
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
});

test('native write success is refused when the written RJMD cannot cold-decode', () => {
  const host = globalThis as any;
  const names = [
    '__fs_exists', '__fs_read', '__fs_read_base64', '__fs_remove',
    '__mesh_part_ranges', '__mesh_semantic_state', '__model_meshdoc_write',
  ];
  const prior = new Map(names.map((name) => [name, host[name]]));
  const dir = 'cart/editor/data/models/props/native-unreadable-output';
  let docExists = false;
  let blob: string | null = null;
  let removed = false;
  try {
    host.__fs_exists = (path: string) => path.endsWith('/mesh/doc.blob') && docExists;
    host.__fs_read = () => null;
    host.__fs_read_base64 = (path: string) => path.endsWith('/mesh/doc.blob') && docExists ? blob : null;
    host.__fs_remove = (path: string) => {
      if (!path.endsWith('/mesh/doc.blob')) return false;
      docExists = false;
      blob = null;
      removed = true;
      return true;
    };
    host.__mesh_part_ranges = () => JSON.stringify({ ok: true, ranges: [[0, 1]] });
    delete host.__mesh_semantic_state;
    host.__model_meshdoc_write = () => {
      const valid = docBlob(3);
      blob = toB64(valid.slice(0, valid.length - 1));
      docExists = true;
      return 1;
    };

    invalidateMeshDoc(dir);
    const parts = partsMetaFromRows([
      { id: 'object-body', name: 'Body', color: '#fff', visible: true, lo: 0 },
    ]);
    assert(!writeMeshDoc(dir, parts), 'native return value 1 acknowledged an unreadable RJMD');
    assert(removed && !docExists, 'unreadable first-save output was not removed before metadata cutover');
  } finally {
    invalidateMeshDoc(dir);
    for (const name of names) {
      const value = prior.get(name);
      if (value === undefined) delete host[name];
      else host[name] = value;
    }
  }
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
    const diagnostic = meshDocUnreadableDiagnostic(dir);
    assert(diagnostic?.code === 'truncated-payload', `disk package failure stayed generic: ${diagnostic?.code ?? 'none'}`);
    assert(diagnostic?.details?.actualBytes === truncated.length,
      'disk package diagnostic did not preserve the exact file byte count');
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

// ── saved-document readers that replaced hand-parsed blobs (req_4077) ──────────

/** A two-part document: range [0,2) holds one quad (two triangles sharing a group),
 *  range [2,3) holds one loose triangle. That is exactly the shape the per-range
 *  group count exists to tell apart. */
function twoPartDoc() {
  const triangles = 3;
  const vertices = new Float32Array(triangles * 24);
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const at = (triangle * 3 + corner) * 8;
      vertices[at] = triangle;             // x separates the triangles
      vertices[at + 1] = corner;           // y separates the corners
      vertices[at + 2] = 0;
      vertices[at + 6] = triangle / 10;    // uv columns are 6 and 7, not 3 and 4
      vertices[at + 7] = corner / 10;
    }
  }
  return {
    vertices,
    faceGroups: new Uint32Array([0, 0, 1]),
    semanticRegions: new Uint32Array([7, 7, 0xffffffff]),
    semanticInstances: new Uint32Array([0, 0, 0]),
    faceMaterials: null,
    ranges: [{ lo: 0, hi: 1 }, { lo: 1, hi: 2 }],
  } as any;
}

test('per-range stats separate a quad part from a loose-triangle part', () => {
  const stats = meshDocRangeStats(twoPartDoc());
  assert(stats.length === 2, `expected 2 ranges, got ${stats.length}`);
  // Two triangles over ONE group is a quad; one over one group is soup.
  assert(stats[0]!.triangles === 2 && stats[0]!.groups === 1, `range 0: ${stats[0]!.triangles}/${stats[0]!.groups}`);
  assert(stats[1]!.triangles === 1 && stats[1]!.groups === 1, `range 1: ${stats[1]!.triangles}/${stats[1]!.groups}`);
  assert(stats[0]!.bbox !== null && stats[0]!.bbox![0] === 0, 'range 0 lost its extent');
});

test('a range holding nothing reports no extent rather than an infinite one', () => {
  const doc = twoPartDoc();
  doc.ranges = [{ lo: 90, hi: 99 }];
  const stats = meshDocRangeStats(doc);
  assert(stats[0]!.triangles === 0 && stats[0]!.bbox === null, 'an empty range invented a bbox');
});

test('a saved triangle decodes its corners AND its uvs from the right columns', () => {
  const triangle = meshDocTriangle(twoPartDoc(), 2)!;
  assert(triangle.group === 1, `group was ${triangle.group}`);
  assert(triangle.corners.length === 3 && triangle.corners[0]![0] === 2, `corners: ${JSON.stringify(triangle.corners[0])}`);
  // uv lives at stride offsets 6 and 7; a hand reader that assumes 3 and 4 gets normals.
  assert(Math.abs(triangle.uvs[1]![0] - 0.2) < 1e-6 && Math.abs(triangle.uvs[1]![1] - 0.1) < 1e-6, `uvs: ${JSON.stringify(triangle.uvs[1])}`);
});

test('an unnamed saved triangle reports its sentinel region, not a guess', () => {
  assert(meshDocTriangle(twoPartDoc(), 0)!.region === 7, 'a named triangle lost its region');
  assert(meshDocTriangle(twoPartDoc(), 2)!.region === 0xffffffff, 'an unnamed triangle did not report the sentinel');
  assert(meshDocTriangle(twoPartDoc(), 99) === null, 'an out-of-range triangle decoded');
  assert(meshDocTriangle(twoPartDoc(), -1) === null, 'a negative index decoded');
});

test('comparing two saved documents finds the moved triangles', () => {
  const before = twoPartDoc();
  const after = twoPartDoc();
  after.vertices[0] += 0.5;
  const report = compareMeshDocs(before, after);
  assert(report.moved.length === 1 && report.moved[0]!.index === 0, `moved: ${JSON.stringify(report.moved)}`);
  assert(Math.abs(report.moved[0]!.delta - 0.5) < 1e-6, `delta was ${report.moved[0]!.delta}`);
  assert(compareMeshDocs(before, twoPartDoc()).moved.length === 0, 'identical documents reported movement');
});

test('documents of different size say they are incomparable instead of aligning by index', () => {
  const small = twoPartDoc();
  const big = twoPartDoc();
  big.vertices = new Float32Array(4 * 24);
  const report = compareMeshDocs(small, big);
  assert(report.moved.length === 0, 'mismatched documents produced per-triangle deltas');
  assert(/no per-triangle correspondence/.test(report.incomparable ?? ''), `incomparable said: ${report.incomparable}`);
  assert(report.triangles.a === 3 && report.triangles.b === 4, 'the shape summary was wrong');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
