// cart/editor/world/meshProps.test.ts — resident door metadata matches the
// framework/world/constructor.zig MESH_PROPS v11 decoder byte-for-byte.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/meshProps.test.ts --bundle \
//     --outfile=/tmp/editor-mesh-props.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-mesh-props.test.js
import { encodeResidentMeshes, encodeMeshRefs, encodeMeshRefsV2, meshKeyHash } from './meshProps';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const vertices = new Float32Array(9 * 8);

test('door resident row carries opaque/glass leaf slots, interaction metadata, and open-frame boxes', () => {
  const bytes = encodeResidentMeshes([{
    key: 'model:test-door',
    vertices,
    slots: [{ start: 3, count: 3 }, { start: 6, count: 3 }],
    door: { leafSlot: 0, reachMeters: 2.2, vehicle: false, startOpen: false },
    collisionBoxes: [
      { minX: -1.5, minY: 0, minZ: -0.15, maxX: -0.5, maxY: 2.2, maxZ: 0.15 },
      { minX: 0.5, minY: 0, minZ: -0.15, maxX: 1.5, maxY: 2.2, maxZ: 0.15 },
      { minX: -1.5, minY: 2.2, minZ: -0.15, maxX: 1.5, maxY: 3, maxZ: 0.15 },
    ],
  }]);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(dv.getUint32(0, true) === 11, 'not MESH_PROPS v11');
  assert(dv.getUint32(4, true) === 1 && dv.getUint32(8, true) === 0, 'catalog header changed');
  const keyLength = dv.getUint32(12, true);
  let at = 16 + keyLength + 36 + vertices.length * 4;
  const pngLength = dv.getUint32(at, true); at += 4 + pngLength;
  assert(dv.getUint32(at, true) === 2, 'opaque/glass leaf slots missing'); at += 4;
  assert(dv.getUint32(at, true) === 3 && dv.getUint32(at + 4, true) === 3, 'leaf slot range changed'); at += 8;
  assert(dv.getUint32(at, true) === 6 && dv.getUint32(at + 4, true) === 3, 'leaf glass slot range changed'); at += 8;
  assert(dv.getUint32(at, true) === 1, 'door flag missing'); at += 4;
  assert(dv.getUint32(at, true) === 0, 'leaf slot index changed');
  assert(Math.abs(dv.getFloat32(at + 4, true) - 2.2) < 1e-5, 'interaction reach changed');
  assert(dv.getUint32(at + 8, true) === 0, 'walk door became vehicle door');
  assert(dv.getUint32(at + 12, true) === 0, 'door unexpectedly starts open');
  at += 16;
  assert(dv.getUint32(at, true) === 3, 'portal-preserving frame boxes missing'); at += 4;
  assert(Math.abs(dv.getFloat32(at, true) - (-1.5)) < 1e-5, 'left jamb minX changed');
  assert(Math.abs(dv.getFloat32(at + 12, true) - (-0.5)) < 1e-5, 'left jamb maxX changed');
  at += 3 * 24;
  assert(dv.getUint32(at, true) === 0, 'door unexpectedly carries face-material UVs'); at += 4;
  assert(dv.getUint32(at, true) === 0, 'door unexpectedly carries exact collision triangles'); at += 4;
  assert(dv.getUint32(at, true) === 0, 'door leaf glass rides the door block, never the v11 glass slot'); at += 4;
  assert(at === bytes.byteLength, `encoder size drift: parsed ${at}, wrote ${bytes.byteLength}`);
});

test('v11 marks the trailing Studio glass run of a door-less untextured model (req_4707)', () => {
  const bytes = encodeResidentMeshes([{
    key: 'opening:window',
    vertices,
    slots: [{ start: 0, count: 6 }, { start: 6, count: 3 }],
    glassSlot: 1,
  }]);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keyLength = dv.getUint32(12, true);
  let at = 16 + keyLength + 36 + vertices.length * 4;
  at += 4; // pngLen=0 — untextured is the case that NEEDS the slot
  assert(dv.getUint32(at, true) === 2, 'body/glass slots missing'); at += 4;
  at += 16; // two slot rows
  at += 4; // hasDoor=0
  at += 4; // collisionBoxCount=0
  at += 4; // materialUvCount=0
  at += 4; // collisionTriangleCount=0
  assert(dv.getUint32(at, true) === 2, 'glassSlotPlusOne must encode glassSlot 1 as 2'); at += 4;
  assert(at === bytes.byteLength, 'glass slot payload size drifted');
});

test('encoder rejects a glass slot outside the slot table', () => {
  let threw = false;
  try {
    encodeResidentMeshes([{ key: 'opening:bad-glass', vertices, glassSlot: 0 }]);
  } catch { threw = true; }
  assert(threw, 'an out-of-range glass slot reached the host decoder');
});

test('v10 retains the v9 separate material UV pair per resident vertex', () => {
  const triangle = new Float32Array([
    0, 0, 0, 0, 0, 1, 0.2, 0.3,
    1, 0, 0, 0, 0, 1, 0.2, 0.3,
    0, 1, 0, 0, 0, 1, 0.2, 0.3,
  ]);
  const materialUvs = new Float32Array([0, 1, 1, 1, 0, 0]);
  const bytes = encodeResidentMeshes([{ key: 'prop:textured-face', vertices: triangle, materialUvs }]);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keyLength = dv.getUint32(12, true);
  let at = 16 + keyLength + 36 + triangle.length * 4;
  at += 4; // pngLen=0
  at += 4; // slotCount=0
  at += 4; // hasDoor=0
  at += 4; // collisionBoxCount=0
  assert(dv.getUint32(at, true) === 3, 'material UV vertex count missing'); at += 4;
  for (let i = 0; i < materialUvs.length; i += 1) {
    assert(Math.abs(dv.getFloat32(at + i * 4, true) - materialUvs[i]!) < 1e-6, `material UV ${i} changed`);
  }
  at += materialUvs.length * 4;
  assert(dv.getUint32(at, true) === 0, 'textured face unexpectedly carries collision triangles'); at += 4;
  assert(dv.getUint32(at, true) === 0, 'textured face unexpectedly declares a glass slot'); at += 4;
  assert(at === bytes.byteLength, 'material UV payload size drifted');
});

test('v10 carries exact saved-Outliner collision triangles after material UVs', () => {
  const triangle = new Float32Array([
    0, 0, 0, 0, 0, 1, 0, 0,
    1, 0, 0, 0, 0, 1, 1, 0,
    0, 2, 1, 0, 0, 1, 0, 1,
  ]);
  const collisionTriangles = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 1]);
  const bytes = encodeResidentMeshes([{ key: 'prop:sloped-wall', vertices: triangle, collisionTriangles }]);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keyLength = dv.getUint32(12, true);
  let at = 16 + keyLength + 36 + triangle.length * 4;
  at += 4; // pngLen=0
  at += 4; // slotCount=0
  at += 4; // hasDoor=0
  at += 4; // collisionBoxCount=0
  at += 4; // materialUvCount=0
  assert(dv.getUint32(at, true) === 1, 'exact collision triangle count missing'); at += 4;
  for (let i = 0; i < collisionTriangles.length; i += 1) {
    assert(Math.abs(dv.getFloat32(at + i * 4, true) - collisionTriangles[i]!) < 1e-6, `collision coordinate ${i} changed`);
  }
  at += collisionTriangles.length * 4;
  assert(dv.getUint32(at, true) === 0, 'sloped wall unexpectedly declares a glass slot'); at += 4;
  assert(at === bytes.byteLength, 'exact collision payload size drifted');
});

test('encoder rejects a partial material UV channel', () => {
  let threw = false;
  try {
    encodeResidentMeshes([{ key: 'prop:bad-uv', vertices, materialUvs: new Float32Array(2) }]);
  } catch { threw = true; }
  assert(threw, 'partial material UV channel reached the host decoder');
});

test('encoder rejects a partial exact collision triangle', () => {
  let threw = false;
  try {
    encodeResidentMeshes([{ key: 'prop:bad-collision', vertices, collisionTriangles: new Float32Array(8) }]);
  } catch { threw = true; }
  assert(threw, 'partial collision triangle reached the host decoder');
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

test('encoder rejects a degenerate authored collision box', () => {
  let threw = false;
  try {
    encodeResidentMeshes([{
      key: 'model:bad-box', vertices,
      collisionBoxes: [{ minX: 1, minY: 0, minZ: 0, maxX: 1, maxY: 2, maxZ: 0.2 }],
    }]);
  } catch { threw = true; }
  assert(threw, 'degenerate collider reached the host decoder');
});

test('v2 mesh refs carry spin between yaw and matCount; v1 stays 24-byte (req_3128)', () => {
  const ref = { key: 'model:sign', x: 1, y: 2, z: 3, yaw: 90, spin: 45 };
  const v2 = encodeMeshRefsV2([ref, { ...ref, spin: undefined }]);
  assert(v2.byteLength === 2 * 28, 'v2 stride is not 28 bytes');
  const dv = new DataView(v2.buffer, v2.byteOffset, v2.byteLength);
  assert(dv.getUint32(0, true) === meshKeyHash('model:sign'), 'v2 hash moved');
  assert(Math.abs(dv.getFloat32(16, true) - 90) < 1e-5, 'v2 yaw moved');
  assert(Math.abs(dv.getFloat32(20, true) - 45) < 1e-5, 'v2 spin not at offset 20');
  assert(dv.getUint32(24, true) === 0, 'v2 matCount not at offset 24');
  assert(dv.getFloat32(28 + 20, true) === 0, 'absent spin did not encode as 0');
  const v1 = encodeMeshRefs([ref]);
  assert(v1.byteLength === 24, 'v1 stride drifted — an older host would misparse every push');
});

test('mesh refs carry one hash per authored face slot, including zero paint fallbacks', () => {
  const ref = { key: 'prop:chair', x: 0, y: 0, z: 0, yaw: 0, materials: [0x11223344, 0, 0xaabbccdd] };
  const v2 = encodeMeshRefsV2([ref]);
  assert(v2.byteLength === 28 + 12, 'v2 material payload size drifted');
  const v2dv = new DataView(v2.buffer, v2.byteOffset, v2.byteLength);
  assert(v2dv.getUint32(24, true) === 3, 'v2 matCount missing');
  assert(v2dv.getUint32(28, true) === 0x11223344, 'slot 0 hash moved');
  assert(v2dv.getUint32(32, true) === 0, 'unassigned slot no longer preserves paint');
  assert(v2dv.getUint32(36, true) === 0xaabbccdd, 'slot 2 hash moved');
  const v1 = encodeMeshRefs([ref]);
  assert(v1.byteLength === 24 + 12, 'v1 material payload size drifted');
  const v1dv = new DataView(v1.buffer, v1.byteOffset, v1.byteLength);
  assert(v1dv.getUint32(20, true) === 3 && v1dv.getUint32(28, true) === 0, 'v1 slot fallback changed');
});

test('bounds radius spheres the MODEL-FRAME ORIGIN, not the AABB centre (req_4777)', () => {
  // A world-space identity mesh (the architecture band lane): geometry far from
  // the origin. The loader culls with a sphere at the node position — for these
  // refs that is the origin — so the wire radius must reach the farthest vertex.
  const far = new Float32Array(3 * 8);
  const corners: [number, number, number][] = [[440, 0, 200], [470, 12, 230], [455, 6, 215]];
  corners.forEach(([x, y, z], i) => { far[i * 8] = x; far[i * 8 + 1] = y; far[i * 8 + 2] = z; });
  const bytes = encodeResidentMeshes([{ key: 'arch:wall:plain:s1', vertices: far, solid: false }]);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keyLength = dv.getUint32(12, true);
  const radius = dv.getFloat32(16 + keyLength + 12, true);
  const need = Math.hypot(470, 12, 230);
  assert(radius >= need - 1e-3, `radius ${radius} does not reach the farthest vertex ${need} — the loader would blink the whole band with sub-degree camera moves`);
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
