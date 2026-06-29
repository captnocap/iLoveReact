// compile/worldGeometry tests — the no-V8 loader reads this packed instance
// buffer directly, so build-piece face skins must survive here, not only in the
// React preview renderer.

import { assert, assertClose, assertEqual, finish, test, withHost } from '../game/_testkit';
import { GAME_BUILD, type PlacedBuildPiece } from '@game';
import { makeChunk } from '../chunks';
import { chunkToFloor } from '../chunkFloor';
import { floraKindIndex, paintFlora } from '../floraData';
import { dumpsterBodyMeters, propKindDefinition } from '../game/kinds/props';
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
  INSTANCE_SHAPE_CYLINDER8,
  INSTANCE_SHAPE_CYLINDER16,
  INSTANCE_SHAPE_FLOWER,
  INSTANCE_SHAPE_SPHERE,
  INSTANCE_STRIDE,
  MATERIALS_DOC_TAIL_MAGIC,
  resetCustomTextureCache,
  resolveMaterialShader,
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

function rowHasColor(r: number[], color: readonly [number, number, number]): boolean {
  return Math.abs(r[9] - color[0]) < 1e-6
    && Math.abs(r[10] - color[1]) < 1e-6
    && Math.abs(r[11] - color[2]) < 1e-6;
}

test('built-in shader preset ids resolve to frozen material data for compile', () => {
  const resolved = resolveMaterialShader('n-floral-wallpaper--v2--max');
  assert(resolved !== null, 'preset id resolves as a shader material');
  assertEqual(JSON.stringify(resolved!.data), JSON.stringify([0, 2, 707, 4, 13]), 'compile uses the preset data, not the recipe default');
  assert(resolved!.wgsl.includes('@fragment fn fs_main'), 'preset ships the fill shader WGSL');
});

function colorHex(hex: string): readonly [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
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
  // THINWALL (req_2044): a paper-thin wall is two HALF-DEPTH boxes meeting at the
  // centerline (front + back), not the fat core + two proud face slabs — so the
  // front/back paint survives but there is no separate side/core slab.
  assertEqual(built.pieces, 2, 'the thin wall bakes as a front half and a back half');
  assertEqual(built.total, 2, 'no extra rows emitted');
  assertColor(row(built.instances, 0), [1, 0, 0], 'front half');
  assertColor(row(built.instances, 1), [0, 1, 0], 'back half');
  assertEqual(row(built.instances, 0)[12], INSTANCE_SHAPE_BOX, 'the front half is a box instance');
});

test('WALLHIDE req_2053: wall rows are flagged, floor rows are not, flags align with rows', () => {
  const wall: PlacedBuildPiece = { id: 'w1', pieceId: 'wall.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0 };
  const floor: PlacedBuildPiece = { id: 'f1', pieceId: 'floor.concrete.common', x: 4, y: 0, z: 0, yawDegrees: 0 };
  const built = buildWorldInstances({} as any, [wall, floor], []);
  // The flag array is parallel to the instance rows (the loader reads them in lockstep).
  assertEqual(built.wallFlags.length, built.total, 'one wall flag per instance row');
  assert(built.wallFlags.length > 0, 'something baked');
  // Every wall row is flagged 1; every floor row 0. The wall lowers to its half-depth
  // boxes (front+back), the floor to its slab — so we assert by which piece a row came from
  // via its x position (wall at x=0, floor at x=4).
  let wallFlagged = 0;
  let floorRows = 0;
  for (let i = 0; i < built.total; i += 1) {
    const cx = row(built.instances, i)[0];
    const flag = built.wallFlags[i];
    if (Math.abs(cx) < 2) { // a wall row (near x=0)
      assertEqual(flag, 1, `wall row ${i} is flagged`);
      wallFlagged += 1;
    } else if (Math.abs(cx - 4) < 2) { // a floor row (near x=4)
      assertEqual(flag, 0, `floor row ${i} is NOT flagged`);
      floorRows += 1;
    }
  }
  assert(wallFlagged >= 1, 'at least one wall row was flagged');
  assert(floorRows >= 1, 'at least one floor row was present and unflagged');
});

test('WALLHIDE req_2053: a wall-free map produces an all-zero wall-flag set', () => {
  const floor: PlacedBuildPiece = { id: 'f1', pieceId: 'floor.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0 };
  const built = buildWorldInstances({} as any, [floor], []);
  assertEqual(built.wallFlags.length, built.total, 'flags parallel to rows');
  assert(!built.wallFlags.some((f) => f !== 0), 'no row is a wall (packageMap then omits the lump)');
});

test('turned window and doorway walls put front/back skins on the same sides as the building workspace', () => {
  for (const [pieceId, edit] of [
    ['wall.stucco.window', 'window'],
    ['wall.concrete.doorway', 'door'],
  ] as const) {
    const piece: PlacedBuildPiece = {
      id: `w-${edit}`,
      pieceId,
      x: 10,
      y: 0,
      z: 20,
      yawDegrees: 90,
      edit,
      skin: {
        sides: { kind: 'color', value: '#0000ff' },
        front: { kind: 'color', value: '#ff0000' },
        back: { kind: 'color', value: '#00ff00' },
      },
    };

    const built = buildWorldInstances({} as any, [piece], []);
    const rows = Array.from({ length: built.instances.length / INSTANCE_STRIDE }, (_, i) => row(built.instances, i));
    const frontRows = rows.filter((r) => rowHasColor(r, colorHex('#ff0000')));
    const backRows = rows.filter((r) => rowHasColor(r, colorHex('#00ff00')));
    assert(frontRows.length > 0, `${edit} wall has front-skinned slabs`);
    assert(backRows.length > 0, `${edit} wall has back-skinned slabs`);
    assert(frontRows.every((r) => r[0] < piece.x), `${edit} front skin sits on yaw-90 world -X face`);
    assert(backRows.every((r) => r[0] > piece.x), `${edit} back skin sits on yaw-90 world +X face`);
  }
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

test('compiled dumpster semantic recipe preserves the legacy box layout', () => {
  const { scale: s, widthMeters: w, depthMeters: d } = dumpsterBodyMeters();
  const state = {
    world: {
      surfaceRegions: [],
      placedCells: {},
      roads: [],
      junctions: [],
      buildings: [],
      props: [{
        id: 'dumpster-1',
        kind: 'dumpster',
        x: 0,
        y: 0,
        z: 0,
        yawDegrees: 0,
        createdByCommand: 'test',
      }],
    },
  };

  const built = buildWorldInstances(state as any, [], [], { includeGroundLayers: true });
  assertEqual(built.total, 8, 'the dumpster still lowers to eight box parts');

  const baseSkid = row(built.instances, 0);
  assertClose(baseSkid[1], 0.03 * s, 1e-6, 'base skid y');
  assertClose(baseSkid[6], w * 0.85, 1e-6, 'base skid width');
  assertClose(baseSkid[7], 0.06 * s, 1e-6, 'base skid height');
  assertClose(baseSkid[8], d * 0.8, 1e-6, 'base skid depth');
  assertColor(baseSkid, colorHex('#3a4a30'), 'base skid');
  assertEqual(baseSkid[12], INSTANCE_SHAPE_BOX, 'base skid is a box');

  const frontLid = row(built.instances, 3);
  assertClose(frontLid[2], d * 0.22, 1e-6, 'front lid z');
  assertClose(frontLid[3], 18, 1e-6, 'front lid pitch');
  assertClose(frontLid[6], w + 0.02 * s, 1e-6, 'front lid width');
  assertClose(frontLid[8], d * 0.55, 1e-6, 'front lid depth');
  assertColor(frontLid, colorHex('#556649'), 'front lid');

  const rearLid = row(built.instances, 4);
  assertClose(rearLid[2], -d * 0.22, 1e-6, 'rear lid z');
  assertClose(rearLid[3], -18, 1e-6, 'rear lid pitch');
  assertColor(rearLid, colorHex('#45553a'), 'rear lid');

  const rustyCornerPost = row(built.instances, 7);
  assertClose(rustyCornerPost[0], w * 0.46, 1e-6, 'rusty corner post x');
  assertClose(rustyCornerPost[1], 0.5 * s, 1e-6, 'rusty corner post y');
  assertClose(rustyCornerPost[2], d * 0.46, 1e-6, 'rusty corner post z');
  assertColor(rustyCornerPost, colorHex('#7a5c3a'), 'rusty corner post');
});

test('compiled flower grass emits winded flower-card instances, not static spheres', () => {
  const chunk = makeChunk(0, 0);
  paintFlora(chunk.flora, 10, 12, floraKindIndex('grassFlowers'));
  const state = {
    world: {
      cellSizeMeters: 1,
      surfaceRegions: [],
      roads: [],
      junctions: [],
      placedCells: {},
      props: [],
      landforms: [],
      waterBodies: [],
    },
  };

  const built = buildWorldInstances(state as any, [], [chunkToFloor(chunk)]);
  const rows = Array.from({ length: built.instances.length / INSTANCE_STRIDE }, (_, i) => row(built.instances, i));
  const flowerRows = rows.filter((r) => r[12] === INSTANCE_SHAPE_FLOWER);
  assert(flowerRows.length > 0, 'flower grass bakes blossom heads as the grass-shader flower shape');
  assertEqual(rows.filter((r) => r[12] === INSTANCE_SHAPE_SPHERE).length, 0, 'flower heads do not bake as static sphere instances');
});

test('compiled fire hydrant semantic recipe preserves the legacy part layout', () => {
  const s = propKindDefinition('fireHydrant').heightMeters / 0.78;
  const state = {
    world: {
      surfaceRegions: [],
      placedCells: {},
      roads: [],
      junctions: [],
      buildings: [],
      props: [{
        id: 'hydrant-1',
        kind: 'fireHydrant',
        x: 0,
        y: 0,
        z: 0,
        yawDegrees: 0,
        createdByCommand: 'test',
      }],
    },
  };

  const built = buildWorldInstances(state as any, [], [], { includeGroundLayers: true });
  assertEqual(built.total, 8, 'the hydrant still lowers to eight primitive parts');

  const baseFlange = row(built.instances, 0);
  assertEqual(baseFlange[12], INSTANCE_SHAPE_CYLINDER16, 'base flange uses the 16-sided cylinder');
  assertClose(baseFlange[1], 0.03 * s, 1e-6, 'base flange y');
  assertClose(baseFlange[6], 0.4 * s, 1e-6, 'base flange diameter');
  assertClose(baseFlange[7], 0.06 * s, 1e-6, 'base flange height');
  assertColor(baseFlange, colorHex('#9c2a25'), 'base flange');

  const dome = row(built.instances, 2);
  assertEqual(dome[12], INSTANCE_SHAPE_SPHERE, 'dome uses the sphere shape');
  assertClose(dome[1], 0.56 * s, 1e-6, 'dome y');
  assertClose(dome[6], 0.31 * s, 1e-6, 'dome width');
  assertClose(dome[7], 0.217 * s, 1e-6, 'dome height');
  assertColor(dome, colorHex('#c2362f'), 'dome');

  const capNut = row(built.instances, 4);
  assertEqual(capNut[12], INSTANCE_SHAPE_CYLINDER8, 'cap nut uses the 8-sided cylinder');
  assertClose(capNut[1], 0.75 * s, 1e-6, 'cap nut y');
  assertClose(capNut[6], 0.14 * s, 1e-6, 'cap nut diameter');
  assertColor(capNut, colorHex('#c9ccd1'), 'cap nut');

  const frontPumperNozzle = row(built.instances, 5);
  assertClose(frontPumperNozzle[2], -0.15 * s, 1e-6, 'front pumper nozzle z');
  assertClose(frontPumperNozzle[3], 90, 1e-6, 'front pumper nozzle pitch');
  assertClose(frontPumperNozzle[7], 0.14 * s, 1e-6, 'front pumper nozzle length');

  const rightSideOutlet = row(built.instances, 6);
  assertClose(rightSideOutlet[0], 0.15 * s, 1e-6, 'right side outlet x');
  assertClose(rightSideOutlet[5], 90, 1e-6, 'right side outlet roll');
  const leftSideOutlet = row(built.instances, 7);
  assertClose(leftSideOutlet[0], -0.15 * s, 1e-6, 'left side outlet x');
  assertClose(leftSideOutlet[5], 90, 1e-6, 'left side outlet roll');
});

test('compiled stairs use the same full-width step decomposition as build preview', () => {
  const piece: PlacedBuildPiece = {
    id: 's1',
    pieceId: 'stairs.wood.common',
    x: 0,
    y: 0,
    z: 0,
    yawDegrees: 0,
  };

  const built = buildWorldInstances({} as any, [piece], []);
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  const steps = GAME_BUILD.placed.tuning.stairVisualSteps;
  assertEqual(built.pieces, steps, 'compiled stairs emit the shared visual step count');
  assertEqual(built.total, steps, 'stairs do not bake through a stale alternate mesh');
  assertEqual(row(built.instances, 0)[12], INSTANCE_SHAPE_BOX, 'stair treads are box instances');
  assertClose(row(built.instances, 0)[6], def.size.widthMeters, 1e-6, 'compiled stairs keep the catalog full width');
  assertClose(row(built.instances, 0)[8], def.size.depthMeters / steps, 1e-6, 'compiled stair tread depth matches shared step count');
  assertClose(row(built.instances, steps - 1)[7], def.size.heightMeters, 1e-6, 'the top compiled stair reaches the next floor');
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

test('painted stencil materials ship as an underlay material plus transparent paint recipe', () => {
  resetCustomTextureCache();
  const data = [2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
  const stored = JSON.stringify([
    { id: 'custom:override-back-material', label: 'override back material', shaderId: 'cutout-stencil', data, underlayId: 'road' },
  ]);
  const piece: PlacedBuildPiece = {
    id: 'w-stencil',
    pieceId: 'wall.concrete.common',
    x: 0,
    y: 0,
    z: 0,
    yawDegrees: 0,
    skin: { back: { kind: 'material', id: 'custom:override-back-material' } },
  };

  withHost({
    __localstoreGet: (_ns: string, key: string) => (key === 'custom-textures' ? stored : null),
  }, () => {
    const built = buildWorldInstances({} as any, [piece], []);
    const stencilSlot = built.materials.findIndex((m) => JSON.stringify(m.data) === JSON.stringify(data));
    assertEqual(built.materials.length, 2, 'the painted face ships its underlay and overlay materials');
    assert(built.materials.some((m) => m.key.startsWith('road|')), 'the underlay material recipe ships');
    assert(stencilSlot >= 0, 'the painted stencil mask data ships unchanged');
    assert(built.materials[stencilSlot].wgsl.includes('D[10u + cy * igw + cx]'), 'the cutout-stencil shader recipe ships');
    assert(built.materials[stencilSlot].opacity < 0.999, 'transparent stencil backgrounds mark the material for the loader alpha path');
    assert(built.materialRefs.some((r) => r === 1), 'a face row references material slot 1');
    assert(built.materialRefs.some((r) => r === 2), 'a face row references material slot 2');
  });
  resetCustomTextureCache();
});

test('painted stencil materials ship nested underlay chains in draw order', () => {
  resetCustomTextureCache();
  const oldData = [2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
  const newData = [2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 1];
  const stored = JSON.stringify([
    { id: 'custom:old-painted-back', label: 'old painted back', shaderId: 'cutout-stencil', data: oldData, underlayId: 'road' },
    { id: 'custom:new-painted-back', label: 'new painted back', shaderId: 'cutout-stencil', data: newData, underlayId: 'custom:old-painted-back' },
  ]);
  const piece: PlacedBuildPiece = {
    id: 'w-stencil-chain',
    pieceId: 'wall.concrete.common',
    x: 0,
    y: 0,
    z: 0,
    yawDegrees: 0,
    skin: { back: { kind: 'material', id: 'custom:new-painted-back' } },
  };

  withHost({
    __localstoreGet: (_ns: string, key: string) => (key === 'custom-textures' ? stored : null),
  }, () => {
    const built = buildWorldInstances({} as any, [piece], []);
    const oldSlot = built.materials.findIndex((m) => JSON.stringify(m.data) === JSON.stringify(oldData));
    const newSlot = built.materials.findIndex((m) => JSON.stringify(m.data) === JSON.stringify(newData));
    assertEqual(built.materials.length, 3, 'the bake ships base material, old paint, and new paint');
    assert(built.materials.some((m) => m.key.startsWith('road|')), 'the original underlay material ships');
    assert(oldSlot >= 0, 'the older stencil ships above the underlay');
    assert(newSlot >= 0, 'the newest stencil ships last');
    assert(built.materialRefs.some((r) => r === 1), 'a row references material slot 1');
    assert(built.materialRefs.some((r) => r === 2), 'a row references material slot 2');
    assert(built.materialRefs.some((r) => r === 3), 'a row references material slot 3');
  });
  resetCustomTextureCache();
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

test('every painted chunk renders through the per-fragment ground FORMULA, flat or road (FORMULAFLOOR-0615)', () => {
  // Parity with the editor /test view: ANY chunk carrying tiles draws via the
  // ground formula (HEIGHTFIELD_TILE_BODY) over its cell stream — crisp at any
  // distance — rather than a baked 4px/tile pixel texture or flat box slabs. Both
  // a plain flat chunk AND a road-bearing one emit a render record, and the
  // formula ships ONCE in the lump header.
  const cols = 8;
  const tileData = [cols, cols, 1, 0.4, 0.4, 0.4];
  for (let i = 0; i < cols * cols; i += 1) tileData.push(0);
  const flatNoRoad = { cx: 0, cz: 0, tileData, heights: [0, 0, 0, 0], hcols: 2, hrows: 2, hver: 1 };
  // 8 floats = one ribbon segment (ax az bx bz rExt lExt twoWay phase).
  const flatRoad = { ...flatNoRoad, roads: [4.5, 0, 4.5, 8, 3.5, 3.5, 1, 3.5] };

  assert(floorNeedsHeightfieldRender(flatNoRoad), 'a plain flat chunk renders through the formula path');
  assert(floorHasRoadRibbon(flatRoad), 'a floor carrying at least one ribbon segment reports a road');
  assert(floorNeedsHeightfieldRender(flatRoad), 'a road floor renders through the formula path');

  const lump = encodeFloorHeightfields([flatNoRoad, flatRoad]);
  const view = new DataView(lump.buffer);
  assertEqual(view.getUint32(0, true), 3, 'the lump is the v3 formula floor');
  assertEqual(view.getUint32(4, true), 2, 'both painted chunks emit a render record');
  assert(view.getUint32(8, true) > 0, 'the ground formula ships once in the lump header');
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
