// cart/editor/data/meshDoc.test.ts — RJMD v1/v2 compatibility at the pure wire boundary.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/meshDoc.test.ts --bundle \
//     --outfile=/tmp/editor-meshdoc.test.js --format=iife --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-meshdoc.test.js
import { parseMeshDocBytes, partsMetaFromRows } from './meshDoc';

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

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
