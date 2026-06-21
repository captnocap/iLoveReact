// meshProps.test.ts — the MESH_PROPS lump v5 (req_1544/req_1573): the cooked-prop paint
// atlas now ships as ENCODED PNG bytes and is decoded in the Zig loader
// (constructor.decodeMeshProps via stbi), NOT decoded at bake time (the headless
// v8cli bake has no image codec). This locks the encode byte layout so it can't
// silently drift from the Zig decoder — the offsets here MUST match the read in
// framework/world/constructor.zig.
//
// Bundle + run:
//   tools/esbuild cart/hmsc-int/compile/meshProps.test.ts --bundle \
//     --format=iife --platform=neutral --target=es2022 \
//     --alias:@reactjit=runtime --alias:@game=cart/hmsc-int/game | tools/v8cli /dev/stdin

import { assert, assertEqual, finish, test } from '../game/_testkit';
import { encodeMeshProps, MESH_PROPS_LUMP_VERSION, type ImportedMeshPropSink } from './worldGeometry';

// A minimal mesh row; `png` is optional (the cooked-paint atlas). Cast through the
// sink type — the encoder only reads these fields + the optional `png`.
function meshRow(key: string, png?: Uint8Array, slots?: { start: number; count: number }[]): any {
  return {
    key, source: `t:${key}`,
    color: [0.5, 0.5, 0.5] as [number, number, number],
    count: 1,
    boundsRadius: 1, footprintWidthMeters: 1, footprintDepthMeters: 1, heightMeters: 1,
    solid: true,
    vertices: new Float32Array(8), // one vertex (pos3 nrm3 uv2)
    ...(png ? { png } : {}),
    ...(slots ? { slots } : {}),
  };
}

// Mirror of constructor.zig decodeMeshProps (v5) — the contract under test.
function decode(bytes: Uint8Array): { version: number; meshes: { key: string; pngLen: number; png: Uint8Array | null; slots: { start: number; count: number }[] }[]; instances: { mesh: number; slotMaterials: number[] }[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0, true);
  const meshCount = view.getUint32(4, true);
  const instanceCount = view.getUint32(8, true);
  let at = 12;
  const meshes: { key: string; pngLen: number; png: Uint8Array | null; slots: { start: number; count: number }[] }[] = [];
  for (let m = 0; m < meshCount; m += 1) {
    const keyLen = view.getUint32(at, true); at += 4;
    let key = '';
    for (let k = 0; k < keyLen; k += 1) key += String.fromCharCode(bytes[at + k]);
    at += keyLen;
    const vcount = view.getUint32(at + 32, true); // u32 vertexCount at meta+32
    at += 36;
    at += vcount * 8 * 4;
    const pngLen = view.getUint32(at, true); at += 4;
    const png = pngLen > 0 ? bytes.subarray(at, at + pngLen) : null;
    at += pngLen;
    const slotCount = view.getUint32(at, true); at += 4;
    const slots: { start: number; count: number }[] = [];
    for (let s = 0; s < slotCount; s += 1) {
      slots.push({ start: view.getUint32(at, true), count: view.getUint32(at + 4, true) });
      at += 8;
    }
    meshes.push({ key, pngLen, png, slots });
  }
  const instances: { mesh: number; slotMaterials: number[] }[] = [];
  for (let i = 0; i < instanceCount; i += 1) {
    const mesh = view.getUint32(at, true);
    at += 20;
    const slotMaterials: number[] = [];
    for (let s = 0; s < (meshes[mesh]?.slots.length ?? 0); s += 1) {
      slotMaterials.push(view.getUint32(at, true));
      at += 4;
    }
    instances.push({ mesh, slotMaterials });
  }
  return { version, meshes, instances };
}

test('MESH_PROPS v5: a cooked prop ships paint PNG bytes and slot material refs (req_1544/req_1573)', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 250, 251]); // PNG sig + payload
  const sink: ImportedMeshPropSink = {
    meshes: [meshRow('painted', png, [{ start: 6, count: 6 }]), meshRow('bare')] as any,
    instances: [{ mesh: 0, x: 1, y: 2, z: 3, yawDegrees: 90, slotMaterials: [7] }, { mesh: 1, x: 0, y: 0, z: 0, yawDegrees: 0 }],
  };
  const out = decode(encodeMeshProps(sink));
  assertEqual(out.version, 5, 'lump is v5');
  assertEqual(MESH_PROPS_LUMP_VERSION, 5, 'the exported version constant is 5');
  assertEqual(out.instances.length, 2, 'both instances encoded');
  assertEqual(out.meshes.length, 2, 'both meshes encoded');
  // the painted mesh carries the EXACT PNG bytes (no decode, no resize — passthrough).
  assertEqual(out.meshes[0].pngLen, png.length, 'painted mesh png length matches');
  assert(out.meshes[0].png !== null && out.meshes[0].png!.every((b, i) => b === png[i]), 'png bytes are byte-identical (passthrough)');
  assertEqual(out.meshes[0].slots[0].start, 6, 'slot start carried');
  assertEqual(out.meshes[0].slots[0].count, 6, 'slot count carried');
  assertEqual(out.instances[0].slotMaterials[0], 7, 'slot material ref carried per instance');
  // the bare mesh has no texture → pngLen 0 (an OBJ/GLB import or unpainted prop).
  assertEqual(out.meshes[1].pngLen, 0, 'untextured mesh ships pngLen 0');
  assertEqual(out.meshes[1].slots.length, 0, 'un-slotted mesh ships slotCount 0');
});

finish('meshProps');
