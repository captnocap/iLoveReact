// cart/editor/world/meshProps.test.ts — resident door metadata matches the
// framework/world/constructor.zig MESH_PROPS v7 decoder byte-for-byte.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/meshProps.test.ts --bundle \
//     --outfile=/tmp/editor-mesh-props.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-mesh-props.test.js
import { encodeResidentMeshes } from './meshProps';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const vertices = new Float32Array(6 * 8);

test('door resident row carries one leaf slot and the v6 interaction block', () => {
  const bytes = encodeResidentMeshes([{
    key: 'model:test-door',
    vertices,
    slots: [{ start: 3, count: 3 }],
    door: { leafSlot: 0, reachMeters: 2.2, vehicle: false, startOpen: false },
  }]);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(dv.getUint32(0, true) === 7, 'not MESH_PROPS v7');
  assert(dv.getUint32(4, true) === 1 && dv.getUint32(8, true) === 0, 'catalog header changed');
  const keyLength = dv.getUint32(12, true);
  let at = 16 + keyLength + 36 + vertices.length * 4;
  const pngLength = dv.getUint32(at, true); at += 4 + pngLength;
  assert(dv.getUint32(at, true) === 1, 'leaf slot missing'); at += 4;
  assert(dv.getUint32(at, true) === 3 && dv.getUint32(at + 4, true) === 3, 'leaf slot range changed'); at += 8;
  assert(dv.getUint32(at, true) === 1, 'door flag missing'); at += 4;
  assert(dv.getUint32(at, true) === 0, 'leaf slot index changed');
  assert(Math.abs(dv.getFloat32(at + 4, true) - 2.2) < 1e-5, 'interaction reach changed');
  assert(dv.getUint32(at + 8, true) === 0, 'walk door became vehicle door');
  assert(dv.getUint32(at + 12, true) === 0, 'door unexpectedly starts open');
  at += 16;
  assert(dv.getUint32(at, true) === 0, 'unexpected authored collider boxes');
  assert(at + 4 === bytes.byteLength, `encoder size drift: parsed ${at + 4}, wrote ${bytes.byteLength}`);
});

test('encoder rejects a door whose leaf slot does not exist', () => {
  let threw = false;
  try {
    encodeResidentMeshes([{
      key: 'model:bad-door', vertices,
      door: { leafSlot: 0, reachMeters: 2.2, vehicle: false, startOpen: false },
    }]);
  } catch { threw = true; }
  assert(threw, 'invalid door metadata reached the host decoder');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
