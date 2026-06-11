// compile/worldGeometry tests — the no-V8 loader reads this packed instance
// buffer directly, so build-piece face skins must survive here, not only in the
// React preview renderer.

import { assert, assertClose, assertEqual, finish, test, withHost } from '../game/_testkit';
import type { PlacedBuildPiece } from '@game';
import { emptyDecalDoc } from '../game/textures/decal';
import { BUILTIN_DECALS } from '../game/textures/builtinDecals';
import { packDecalDoc } from './decalPack';
import { createDecalAssetSink, DECAL_IMAGE_ASSET_KEY_BASE } from './decalAssets';
import { bytesToBase64 } from '@reactjit/workspace';
import {
  buildWorldInstances,
  encodeFloorHeightfields,
  encodeMaterials,
  floorHasRoadRibbon,
  floorNeedsHeightfieldRender,
  INSTANCE_SHAPE_BOX,
  INSTANCE_STRIDE,
  MATERIALS_DOC_TAIL_MAGIC,
  resetCustomTextureCache,
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

test('decal materials ship their packed RECIPE in the MATERIALS lump tail', () => {
  // A saved decal custom straight off the shared 'hmsc' localstore — the
  // record's DecalDoc IS what ships (DECALRECIPE-0610: store the recipe, not
  // the product; no editor bake, no fs dependency). 8×8 is the smallest doc
  // validateDecalDoc admits (it clamps smaller).
  const doc = emptyDecalDoc(8, 8);
  doc.nodes.push({ id: 't', kind: 'text', x: 0, y: 0, w: 8, h: 8, text: 'NC', color: '#ffffff', fontSize: 6 });
  const stored = JSON.stringify([
    { id: 'custom:netcafe', label: 'NET CAFE', decal: doc },
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
  }, () => {
    const built = buildWorldInstances({} as any, [piece], []);
    assertEqual(built.materials.length, 1, 'the decal interned as one material');
    assert(built.materials[0].doc !== undefined, 'the material carries the packed doc — the recipe');
    assertEqual(built.materials[0].wgsl, '', 'no WGSL for a decal');
    assert(built.materialRefs.some((r) => r === 1), 'a face row references the decal slot');
    const packed = packDecalDoc(doc, 'custom:netcafe');
    assertEqual(built.materials[0].doc!.byteLength, packed.byteLength, 'the interned doc is the packDecalDoc lowering');

    const lump = encodeMaterials(built.materials);
    const view = new DataView(lump.buffer, lump.byteOffset, lump.byteLength);
    assertEqual(view.getUint32(0, true), 1, 'one material in the body');
    // Body of one doc material: empty wgsl (4) + empty data (4) + opacity (4).
    const tailAt = 4 + 12;
    assertEqual(view.getUint32(tailAt, true), MATERIALS_DOC_TAIL_MAGIC, 'DOCS tail magic follows the body');
    assertEqual(view.getUint32(tailAt + 4, true), 1, 'one doc entry');
    assertEqual(view.getUint32(tailAt + 8, true), 0, 'entry references material 0');
    assertEqual(view.getUint32(tailAt + 12, true), packed.byteLength, 'doc byte length');
    assertEqual(tailAt + 16 + packed.byteLength, lump.byteLength, 'tail is the end of the lump');
  });
});

test('materials without docs encode with no tail (the pre-decal byte layout)', () => {
  const lump = encodeMaterials([{ key: 'flat:glass', wgsl: '', data: [], opacity: 0.3 }]);
  assertEqual(lump.byteLength, 4 + 12, 'count + one empty-recipe material, nothing appended');
});

test('react-facade skins resolve through the BUILT-IN decal table (FACADEDECAL-0610)', () => {
  // No custom store at all — the transcribed internetCafe facade must still
  // ship as a packed recipe instead of dropping the face to flat color.
  const piece: PlacedBuildPiece = {
    id: 'w3',
    pieceId: 'wall.concrete.common',
    x: 0,
    y: 0,
    z: 0,
    yawDegrees: 0,
    skin: { front: { kind: 'material', id: 'internetCafe' } },
  };
  withHost({ __localstoreGet: () => null }, () => {
    const built = buildWorldInstances({} as any, [piece], []);
    assertEqual(built.materials.length, 1, 'the facade interned as one material');
    assert(built.materials[0].doc !== undefined, 'the material carries the transcribed doc');
    assertEqual(
      built.materials[0].doc!.byteLength,
      packDecalDoc(BUILTIN_DECALS.internetCafe, 'internetCafe').byteLength,
      'the interned doc is the builtin transcription',
    );
  });
});

test('a FLAT road-bearing floor renders through the textured heightfield path, not box slabs (RIBBONBAKE-0610)', () => {
  // A flat chunk (no height relief) carrying a road ribbon: the editor draws the
  // analytic ribbon, so the compiled game must too — by shipping a textured
  // heightfield quad rather than per-cell flat box slabs (which can only show the
  // blocky stamped tile colours). This pins the routing predicate + lump count.
  const cols = 8;
  const tileData = [cols, cols, 1, 0.4, 0.4, 0.4];
  for (let i = 0; i < cols * cols; i += 1) tileData.push(0);
  const flatNoRoad = { cx: 0, cz: 0, tileData, heights: [0, 0, 0, 0], hcols: 2, hrows: 2, hver: 1 };
  // 8 floats = one ribbon segment (ax az bx bz rExt lExt twoWay phase).
  const flatRoad = { ...flatNoRoad, roads: [4.5, 0, 4.5, 8, 3.5, 3.5, 1, 3.5] };

  assert(!floorNeedsHeightfieldRender(flatNoRoad), 'a flat floor with no road stays on the box-slab path');
  assert(floorHasRoadRibbon(flatRoad), 'a floor carrying at least one ribbon segment reports a road');
  assert(floorNeedsHeightfieldRender(flatRoad), 'a flat road floor routes to the textured heightfield path');

  const lump = encodeFloorHeightfields([flatNoRoad, flatRoad]);
  const view = new DataView(lump.buffer);
  assertEqual(view.getUint32(4, true), 1, 'only the road-bearing flat chunk emits a heightfield render record');
});

test('decal image nodes ship content-addressed assets; the packed doc references the key (DECALIMG-0610)', () => {
  // The custom-texture table cached for the earlier decal tests — drop it so
  // this test's stubbed store (with the poster decal) is what resolves.
  resetCustomTextureCache();
  const doc = emptyDecalDoc(8, 8);
  doc.nodes.push({ id: 'img', kind: 'image', x: 0, y: 0, w: 8, h: 8, src: 'images/poster.png' });
  const stored = JSON.stringify([{ id: 'custom:poster', label: 'POSTER', decal: doc }]);
  const piece: PlacedBuildPiece = {
    id: 'w4',
    pieceId: 'wall.concrete.common',
    x: 0,
    y: 0,
    z: 0,
    yawDegrees: 0,
    skin: { front: { kind: 'material', id: 'custom:poster' } },
  };
  const content = Uint8Array.from([1, 2, 3, 4, 5]);
  const sink = createDecalAssetSink((path) => (path === 'images/poster.png' ? bytesToBase64(content) : null));
  withHost({
    __localstoreGet: (_ns: string, key: string) => (key === 'custom-textures' ? stored : null),
  }, () => {
    const built = buildWorldInstances({} as any, [piece], [], { decalAssets: sink });
    assertEqual(built.materials.length, 1, 'the decal interned as one material');
    assertEqual(sink.assets.length, 1, 'the image interned as one content-addressed asset');
    assertEqual(sink.assets[0].key, DECAL_IMAGE_ASSET_KEY_BASE, 'keys start at the decal-image base');
    const packed = built.materials[0].doc!;
    const v = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    // image record after the doc header (10) + kind (1) + 5×f32 (20): u32 assetKey
    assertEqual(v.getUint32(10 + 1 + 20, true), DECAL_IMAGE_ASSET_KEY_BASE, 'the packed doc references the manifest key');
  });
  resetCustomTextureCache(); // leave no poster table behind for later tests
});

finish('compile/world-geometry');
