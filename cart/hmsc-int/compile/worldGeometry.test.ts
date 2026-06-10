// compile/worldGeometry tests — the no-V8 loader reads this packed instance
// buffer directly, so build-piece face skins must survive here, not only in the
// React preview renderer.

import { assert, assertClose, assertEqual, finish, test, withHost } from '../game/_testkit';
import type { PlacedBuildPiece } from '@game';
import { emptyDecalDoc } from '../game/textures/decal';
import { decalDocHash, decalPixelsFilePath, encodeDecalPixelFile } from '../game/textures/decalPixels';
import {
  buildWorldInstances,
  encodeMaterials,
  INSTANCE_SHAPE_BOX,
  INSTANCE_STRIDE,
  MATERIALS_PIXEL_TAIL_MAGIC,
} from './worldGeometry';

function row(values: Float32Array, index: number): number[] {
  const start = index * INSTANCE_STRIDE;
  return Array.from(values.slice(start, start + INSTANCE_STRIDE));
}

function assertColor(r: number[], color: readonly [number, number, number], label: string): void {
  assertClose(r[9], color[0], 1e-6, `${label} red`);
  assertClose(r[10], color[1], 1e-6, `${label} green`);
  assertClose(r[11], color[2], 1e-6, `${label} blue`);
}

test('compiled placed walls preserve front, back, and side face skins', () => {
  const piece: PlacedBuildPiece = {
    id: 'w1',
    pieceId: 'wall.concrete.common',
    x: 10,
    y: 0,
    z: 20,
    yawDegrees: 0,
    skin: {
      sides: { kind: 'color', value: '#0000ff' },
      front: { kind: 'color', value: '#ff0000' },
      back: { kind: 'color', value: '#00ff00' },
    },
  };

  const built = buildWorldInstances({} as any, [piece], []);
  assertEqual(built.pieces, 3, 'the wall bakes as core plus two face slabs');
  assertEqual(built.total, 3, 'no extra rows emitted');
  assertColor(row(built.instances, 0), [0, 0, 1], 'side/core slab');
  assertColor(row(built.instances, 1), [1, 0, 0], 'front slab');
  assertColor(row(built.instances, 2), [0, 1, 0], 'back slab');
  assertEqual(row(built.instances, 0)[12], INSTANCE_SHAPE_BOX, 'the core is a box instance');
});

test('compiled floors preserve top, bottom, and edge face skins', () => {
  const piece: PlacedBuildPiece = {
    id: 'f1',
    pieceId: 'floor.concrete.common',
    x: 0,
    y: 2,
    z: 0,
    yawDegrees: 90,
    skin: {
      sides: { kind: 'color', value: '#111111' },
      front: { kind: 'color', value: '#eeeeee' },
      back: { kind: 'color', value: '#333333' },
    },
  };

  const built = buildWorldInstances({} as any, [piece], []);
  assertEqual(built.pieces, 3, 'the floor bakes as edges plus top and bottom slabs');
  assertColor(row(built.instances, 0), [17 / 255, 17 / 255, 17 / 255], 'edge/core slab');
  assertColor(row(built.instances, 1), [238 / 255, 238 / 255, 238 / 255], 'top slab');
  assertColor(row(built.instances, 2), [51 / 255, 51 / 255, 51 / 255], 'bottom slab');
});

test('decal materials ship their editor-baked pixels in the MATERIALS lump tail', () => {
  // A saved decal custom whose record points at its on-disk pixel JSON —
  // exactly what the DecalPixelBaker persists (DECALPIX/DECALPIXFILE-0610;
  // the record stays under the localstore's 8KB value cap). 8×8 is the
  // smallest doc validateDecalDoc admits (it clamps smaller) — the hash must
  // be computed over the SAME validated doc the bake reloads.
  const doc = emptyDecalDoc(8, 8);
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 64; i += 1) rgba.set([i * 3 & 255, 255 - i, 40, 255], i * 4);
  const pixelFile = encodeDecalPixelFile(8, 8, rgba);
  const payload = { w: 8, h: 8, docHash: decalDocHash(doc), file: decalPixelsFilePath('custom:netcafe') };
  const stored = JSON.stringify([
    { id: 'custom:netcafe', label: 'NET CAFE', decal: doc, pixels: payload },
  ]);
  const piece: PlacedBuildPiece = {
    id: 'w2',
    pieceId: 'wall.concrete.common',
    x: 0,
    y: 0,
    z: 0,
    yawDegrees: 0,
    skin: { front: { kind: 'material', id: 'custom:netcafe' } },
  };

  withHost({
    __localstoreGet: (_ns: string, key: string) => (key === 'custom-textures' ? stored : null),
    __fs_read: (path: string) => (path === payload.file ? pixelFile : null),
  }, () => {
    const built = buildWorldInstances({} as any, [piece], []);
    assertEqual(built.materials.length, 1, 'the decal interned as one material');
    assert(built.materials[0].pixels !== undefined, 'the material carries pixels, not a recipe');
    assertEqual(built.materials[0].wgsl, '', 'no WGSL for a decal');
    assert(built.materialRefs.some((r) => r === 1), 'a face row references the decal slot');

    const lump = encodeMaterials(built.materials);
    const view = new DataView(lump.buffer, lump.byteOffset, lump.byteLength);
    assertEqual(view.getUint32(0, true), 1, 'one material in the body');
    // Body of one pixel material: empty wgsl (4) + empty data (4) + opacity (4).
    const tailAt = 4 + 12;
    assertEqual(view.getUint32(tailAt, true), MATERIALS_PIXEL_TAIL_MAGIC, 'PIXS tail magic follows the body');
    assertEqual(view.getUint32(tailAt + 4, true), 1, 'one pixel entry');
    assertEqual(view.getUint32(tailAt + 8, true), 0, 'entry references material 0');
    assertEqual(view.getUint32(tailAt + 12, true), 8, 'pixel width');
    assertEqual(view.getUint32(tailAt + 16, true), 8, 'pixel height');
    const rleLen = view.getUint32(tailAt + 20, true);
    assertEqual(tailAt + 24 + rleLen, lump.byteLength, 'tail is the end of the lump');
  });
});

test('materials without pixels encode with no tail (the pre-decal byte layout)', () => {
  const lump = encodeMaterials([{ key: 'flat:glass', wgsl: '', data: [], opacity: 0.3 }]);
  assertEqual(lump.byteLength, 4 + 12, 'count + one empty-recipe material, nothing appended');
});

finish('compile/world-geometry');
