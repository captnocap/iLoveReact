// editors/workbench/buildings/buildings.test.ts — P4 behavior suite for the
// BUILDING WorkbenchSource (BUILDSKIN-0606).
//
// THE PASS, asserted as written by the user: "set global green, then change
// one wall to red" — all walls go green in ONE action, the piece override
// beats the type global, clearing the override falls back to green. Every
// commit is ONE `prefabDefined` event that the REAL worldStream materializer
// accepts (the fake session folds through worldStream.apply — store → stream
// → merged read, the whole loop proven headless).
//
//   tools/esbuild cart/hmsc-int/editors/workbench/buildings/buildings.test.ts \
//     --bundle --outfile=zig-out/game/tests/wb_buildings.test.js --format=iife \
//     --platform=neutral --target=es2022 --alias:@reactjit=runtime \
//     --alias:@game=cart/hmsc-int/game
//   tools/v8cli zig-out/game/tests/wb_buildings.test.js
//
// Headless per the characters.test.ts bundling law: store.ts/panel.ts + the
// game/build vocabulary only (never source.tsx/Stage.tsx — the React half).

import { assert, assertClose, assertEqual, assertThrows, finish, test } from '../../../game/_testkit';
import { worldStream, type WorldStreamState } from '../../../game/world/stream';
import {
  faceSlotLabels,
  resolveFaceSkin,
  skinKindOrder,
  validatePrefab,
  type BuildFaceSkin,
} from '../../../game/build';
import { createBuildingsStore, type BuildingsStore } from './store';
import {
  buildingRender, buildingsPanel, buildingsRoster, stageTextureIds,
  catalogPickOptions, materialPickOptions, piecePickOptions,
} from './panel';
import { materialFamily } from '../materials/chooser';
import { stageFaceSlotFromNormal, stageQuarterNormal } from './stageMath';

const GREEN: BuildFaceSkin = { kind: 'color', value: '#16a34a' };
const RED: BuildFaceSkin = { kind: 'color', value: '#dc2626' };
const ASPHALT: BuildFaceSkin = { kind: 'material', id: 'mat.asphalt' };

const MOTEL = 'prefab.motelRoom'; // the static seed: 4 walls (door, window) + floor + roof

function fixture(): { store: BuildingsStore; labels: string[]; state: () => WorldStreamState } {
  let state = worldStream.initial();
  const labels: string[] = [];
  const store = createBuildingsStore({
    world: () => state,
    session: {
      commit: (event, label) => {
        // the REAL materializer is the gate — a def it drops would be a bug
        state = worldStream.apply(state, event);
        labels.push(label);
      },
    },
    error: null,
    validMaterial: (id) => id === 'mat.asphalt' || id === 'brickRed' || id.startsWith('custom:'),
    materials: () => [
      { id: 'mat.asphalt', label: 'Asphalt', group: 'HMSC · Game', source: 'recipe' },
      { id: 'brickRed', label: 'Brick Red' },
    ],
  });
  return { store, labels, state: () => state };
}

function sessionlessFixture(): BuildingsStore {
  return createBuildingsStore({
    world: () => worldStream.initial(),
    session: null,
    error: null,
    validMaterial: (id) => id === 'mat.asphalt' || id === 'brickRed' || id.startsWith('custom:'),
    materials: () => [
      { id: 'mat.asphalt', label: 'Asphalt', group: 'HMSC · Game', source: 'recipe' },
      { id: 'brickRed', label: 'Brick Red' },
    ],
  });
}

// ── the roster: a saved prefab IS a building type ────────────────────────────

test('the roster lists every prefab-building with its total piece count', () => {
  const { store } = fixture();
  const rows = buildingsRoster(store);
  const motel = rows.find((r) => r.id === MOTEL);
  assert(!!motel, 'the static seed shows as a building');
  assertEqual(motel!.label, 'Motel Room · 6', 'label carries the piece count (4 walls + floor + roof)');
});

test('a world-saved def shadows a same-id seed (the stream newest-meaning law)', () => {
  const { store, state } = fixture();
  store.renameBuilding(MOTEL, 'Motel Deluxe');
  assertEqual(state().prefabs[MOTEL].label, 'Motel Deluxe', 'the commit landed in the world stream');
  assertEqual(store.building(MOTEL)!.label, 'Motel Deluxe', 'the merged read prefers the world copy');
  assertEqual(buildingsRoster(store).find((r) => r.id === MOTEL)!.label, 'Motel Deluxe · 6', 'the roster follows');
});

// ── THE PASS: global green, then one wall red ────────────────────────────────

test('THE PASS: all walls → green is ONE action; one wall → red beats it; clearing falls back', () => {
  const { store, labels } = fixture();
  // "all walls -> green" in one action
  store.setTypeSkin(MOTEL, 'wall', 'all', GREEN);
  assertEqual(labels.length, 1, 'one action, one commit');
  const wallIndexes = [1, 2, 3, 4]; // motel pieces 1-4 are the walls
  for (const i of wallIndexes) {
    for (const slot of ['front', 'back', 'sides'] as const) {
      const r = store.resolved(MOTEL, i, slot);
      assertEqual(r.skin?.kind === 'color' ? r.skin.value : '', '#16a34a', `wall #${i} ${slot} is green`);
      assertEqual(r.from, 'type', 'the green comes from the type global');
    }
  }
  const floor = store.resolved(MOTEL, 0, 'front');
  assertEqual(floor.from, 'none', 'floors are untouched by the wall global');

  // "then change one wall to red" — the piece override beats the global
  store.setPieceSkin(MOTEL, 2, 'all', RED);
  const overridden = store.resolved(MOTEL, 2, 'front');
  assertEqual(overridden.skin?.kind === 'color' ? overridden.skin.value : '', '#dc2626', 'the overridden wall reads red');
  assertEqual(overridden.from, 'piece', 'piece override BEATS type global');
  const sibling = store.resolved(MOTEL, 1, 'front');
  assertEqual(sibling.skin?.kind === 'color' ? sibling.skin.value : '', '#16a34a', 'the other walls stay green');

  // clearing the override falls back to the global
  store.setPieceSkin(MOTEL, 2, 'all', null);
  const cleared = store.resolved(MOTEL, 2, 'front');
  assertEqual(cleared.skin?.kind === 'color' ? cleared.skin.value : '', '#16a34a', 'cleared override falls back to green');
  assertEqual(cleared.from, 'type', 'provenance returns to the type global');
});

// ── per-face: 2 majors individually, sides one group ─────────────────────────

test('faces resolve per slot: front/back individually, the side group as one', () => {
  const { store } = fixture();
  store.setPieceSkin(MOTEL, 1, 'front', RED);
  store.setPieceSkin(MOTEL, 1, 'sides', GREEN);
  assertEqual(store.resolved(MOTEL, 1, 'front').skin?.kind, 'color', 'front set');
  assertEqual(store.resolved(MOTEL, 1, 'back').from, 'none', 'back untouched — the majors are individual');
  const sides = store.resolved(MOTEL, 1, 'sides');
  assertEqual(sides.skin?.kind === 'color' ? sides.skin.value : '', '#16a34a', 'the side group is ONE slot, uniform all the way around');
  // plates name their majors top/bottom; walls front/back — same 3 slots
  assertEqual(faceSlotLabels('floor').front, 'top', 'plate majors read top/bottom');
  assertEqual(faceSlotLabels('wall').front, 'front', 'wall majors read front/back');
  assertEqual(faceSlotLabels('roof').sides, 'edges', 'a plate side group reads edges');
});

// ── the skin IS the material system ──────────────────────────────────────────

test('a material skin is a registry assignment; an unknown id is refused loudly', () => {
  const { store } = fixture();
  store.setTypeSkin(MOTEL, 'roof', 'all', ASPHALT);
  const roof = store.resolved(MOTEL, 5, 'front');
  assertEqual(roof.skin?.kind === 'material' ? roof.skin.id : '', 'mat.asphalt', 'the roof wears the material');
  assertThrows(() => store.setTypeSkin(MOTEL, 'wall', 'all', { kind: 'material', id: 'no-such-texture' }), 'an id outside THE registry is refused');
  // the stage fold hands the capture list exactly the distinct material ids
  const pieces = buildingRender(store, MOTEL);
  assertEqual(JSON.stringify(stageTextureIds(pieces)), JSON.stringify(['mat.asphalt']), 'one capture per distinct material');
  assertEqual(pieces[5].faces.front.textureId, 'mat.asphalt', 'the render fold carries the textureKey side');
  assert(!!pieces[0].faces.front.color, 'unskinned faces carry the bare catalog color');
});

// ── nothing is immutable: swap / edit / remove / add ─────────────────────────

test('structure edits: swap keeps placement+skin, cutouts swap walls to doors, remove/add live', () => {
  const { store, state } = fixture();
  store.setPieceSkin(MOTEL, 3, 'all', RED); // skin rides the piece
  store.swapPiece(MOTEL, 3, 'wall.stucco.motel');
  assertEqual(store.building(MOTEL)!.pieces[3].pieceId, 'wall.stucco.motel', 'swapped');
  assertEqual(store.resolved(MOTEL, 3, 'front').from, 'piece', 'the override survived the swap');

  store.setPieceEdit(MOTEL, 3, 'door'); // "swap a wall piece to a door"
  assertEqual(store.building(MOTEL)!.pieces[3].edit, 'door', 'the wall is now a door');
  assertThrows(() => store.setPieceEdit(MOTEL, 0, 'door'), 'a floor takes no cutout (the kind contract holds)');

  store.removePiece(MOTEL, 5); // drop the roof
  assertEqual(store.building(MOTEL)!.pieces.length, 5, 'removed');
  store.addPiece(MOTEL, 'wall.concrete.common'); // "add a window" starts as a piece
  assertEqual(store.building(MOTEL)!.pieces.length, 6, 'added');
  assertEqual(store.selectedPiece(MOTEL), 5, 'the new piece is selected for editing');
  store.setPieceEdit(MOTEL, 5, 'window');
  assertEqual(store.building(MOTEL)!.pieces[5].edit, 'window', 'and takes its window cutout');

  // every mutation was ONE valid prefabDefined the real materializer accepted
  assertEqual(validatePrefab(state().prefabs[MOTEL]).length, 0, 'the standing def stays valid');
});

test('removing a piece keeps every other piece\'s skin (overrides ride the piece, not an index table)', () => {
  const { store } = fixture();
  store.setPieceSkin(MOTEL, 4, 'all', RED);
  store.selectPiece(MOTEL, 4);
  store.removePiece(MOTEL, 1);
  // the skinned wall is now index 3 — and still red
  const moved = store.resolved(MOTEL, 3, 'front');
  assertEqual(moved.skin?.kind === 'color' ? moved.skin.value : '', '#dc2626', 'the skin moved with its piece');
  assertEqual(store.selectedPiece(MOTEL), 3, 'selection followed the shift');
});

// ── the panel + ordering laws ────────────────────────────────────────────────

test('the panel generates: ONE skins group with a class selector (quartet first) + the piece group', () => {
  // PANELGRAMMAR-0610 (§11.2): the per-kind GLOBAL groups were N copies of
  // one picker — the grammar's G1 case. One group + a class enum now.
  const { store } = fixture();
  const spec = buildingsPanel(store, MOTEL);
  const titles = spec.groups.map((g) => g.title);
  assertEqual(titles[0], 'BUILDING', 'identity group leads');
  assertEqual(titles.filter((t) => t.includes('GLOBAL')).join(','), 'SKINS · GLOBAL', 'exactly ONE global skins group');
  const skins = spec.groups.find((g) => g.title === 'SKINS · GLOBAL')!;
  const classField = skins.fields.find((f) => f.k === 'class') as any;
  assertEqual(classField.t, 'enum', 'the piece class is a selector field, not a group per class');
  assertEqual(classField.get(), 'wall', 'quartet order: walls lead');
  assertEqual(classField.opts.join(','), 'wall,floor,roof', 'one option per kind PRESENT, quartet first');
  classField.set('roof');
  const retargeted = buildingsPanel(store, MOTEL);
  const roofSkins = retargeted.groups.find((g) => g.title === 'SKINS · GLOBAL')!;
  assertEqual((roofSkins.fields.find((f) => f.k === 'class') as any).get(), 'roof', 'the selector retargets the one picker');
  store.setSkinClass(MOTEL, 'wall'); // back to the default for the tests below
  assertEqual(skinKindOrder(['roof', 'wall', 'trim']).join(','), 'wall,roof,trim', 'quartet first, then the rest');

  store.selectPiece(MOTEL, 1);
  const withPiece = buildingsPanel(store, MOTEL);
  const pieceGroup = withPiece.groups[withPiece.groups.length - 1];
  assert(pieceGroup.title.startsWith('PIECE #1'), 'the selected piece gets its own group');
  const fieldKeys = pieceGroup.fields.map((f) => f.k);
  assert(fieldKeys.includes('piece type') && fieldKeys.includes('cutout') && fieldKeys.includes('remove piece'), 'swap/cutout/remove all in the one edit surface');
  assert(fieldKeys.includes('front =') && fieldKeys.includes('target') && fieldKeys.includes('paint target'), 'resolved provenance + compact paint target controls');
});

test('ROOFAFFORD-0607: no-edit piece kinds render no cutout affordance', () => {
  const { store } = fixture();
  store.selectPiece(MOTEL, 5); // roof
  const roofGroup = buildingsPanel(store, MOTEL).groups.at(-1)!;
  assert(roofGroup.title.startsWith('PIECE #5 ROOF'), 'before: the selected piece is the roof');
  const roofFields = roofGroup.fields.map((f) => f.k);
  console.log(`[ROOFAFFORD-0607] roof fields=${roofFields.join(',')}`);
  assert(!roofFields.includes('cutout'), 'after: a roof offers no edit control that can only fail validation');

  store.selectPiece(MOTEL, 1); // wall
  const wallFields = buildingsPanel(store, MOTEL).groups.at(-1)!.fields.map((f) => f.k);
  console.log(`[ROOFAFFORD-0607] wall fields=${wallFields.join(',')}`);
  assert(wallFields.includes('cutout'), 'wall pieces still expose the WallEdit affordance');
});

test('resolution is pure vocabulary: resolveFaceSkin orders piece > type > none', () => {
  const r1 = resolveFaceSkin({ wall: { front: GREEN } }, 'wall', { front: RED }, 'front');
  assertEqual(r1.skin?.kind === 'color' ? r1.skin.value : '', '#dc2626', 'piece wins');
  const r2 = resolveFaceSkin({ wall: { front: GREEN } }, 'wall', undefined, 'front');
  assertEqual(r2.from, 'type', 'type fills absent overrides');
  assertEqual(resolveFaceSkin(undefined, 'wall', undefined, 'front').from, 'none', 'bare otherwise');
});

// ── req_0184 fixes: the pick folds (no chip walls) + DELETE building ─────────

test('pick folds: materials keep catalog groups, pieces by type with counts, catalog by kind', () => {
  const { store } = fixture();
  assertEqual(materialFamily('a-concrete'), 'a-family', 'a- prefix groups');
  assertEqual(materialFamily('office'), 'misc', 'unprefixed pools under misc');
  const mats = materialPickOptions(store);
  assertEqual(mats.length, 2, 'one option per registry material');
  assertEqual(mats[0].label, 'Asphalt', 'labels ride along');
  assertEqual(mats[0].group, 'HMSC · Game', 'catalog material groups ride along');
  assertEqual(mats[1].group, 'misc', 'ids without catalog groups still fall back to family grouping');
  const pieces = piecePickOptions(store.building(MOTEL)!);
  assertEqual(pieces.filter((p) => p.group === 'walls').length, 4, 'walls · 4 (the grouped counts the user asked for)');
  assertEqual(pieces.filter((p) => p.group === 'floors').length, 1, 'floors · 1');
  assertEqual(pieces[1].label, '#1 wall · door', 'piece labels carry index/kind/cutout');
  const cat = catalogPickOptions();
  assert(cat.every((c) => c.group && c.group.endsWith('s')), 'the catalog groups by kind');
  // the panel rows are PICKS now, never option-dump enums
  const spec = buildingsPanel(store, MOTEL);
  const wallGroup = spec.groups.find((g) => g.title === 'SKINS · GLOBAL')!;
  const matField = wallGroup.fields.find((f) => f.k === 'material') as any;
  assertEqual(matField.t, 'val', 'material is a readout, not an inline catalog dropdown');
  assertEqual(matField.get(), 'bare', 'bare reads without opening a picker');
  const browseField = wallGroup.fields.find((f) => f.k === 'browse material') as any;
  assertEqual(browseField.t, 'act', 'material browsing is a stage action, not a narrow panel picker');
  const targetField = wallGroup.fields.find((f) => f.k === 'target') as any;
  assertEqual(targetField.t, 'pick', 'face target is one compact picker');
  assertEqual(targetField.show('front'), 'front', 'target labels come from the face vocabulary');
  const selector = spec.groups[0].fields.find((f) => f.k === 'edit') as any;
  assertEqual(selector.t, 'pick', 'the piece selector is a pick (grouped chooser, one chip collapsed)');
});

test('paint target handoff: a compact face target can receive the materialized paint', () => {
  const { store } = fixture();
  let opened = 0;
  const spec = buildingsPanel(store, MOTEL, null, (target) => {
    opened += 1;
    store.setPaintTarget(target);
    store.setLens('paint');
  });
  const wallGroup = spec.groups.find((g) => g.title === 'SKINS · GLOBAL')!;
  const targetField = wallGroup.fields.find((f) => f.k === 'target') as any;
  targetField.set('front');
  const paintField = wallGroup.fields.find((f) => f.k === 'paint target') as any;
  paintField.run();
  assertEqual(opened, 1, 'one panel action opens the painter');
  const target = store.paintTarget();
  assert(target !== null, 'the target is retained for the paint lens apply action');
  assertEqual(store.lens(), 'paint', 'opening a paint target switches the source lens');
  assertEqual(target!.slot, 'front', 'the active face target rides the handoff');
  store.setPaintTargetSkin(target!, { kind: 'material', id: 'mat.asphalt' });
  const resolved = store.resolved(MOTEL, 1, 'front');
  assertEqual(resolved.skin?.kind === 'material' ? resolved.skin.id : '', 'mat.asphalt', 'the materialized paint applies through the normal skin path');
});

test('material browse handoff: existing materials open as a wide source lens target', () => {
  const { store } = fixture();
  const spec = buildingsPanel(store, MOTEL, (target) => {
    store.setPaintTarget(target);
    store.setLens('materials');
  });
  const wallGroup = spec.groups.find((g) => g.title === 'SKINS · GLOBAL')!;
  const targetField = wallGroup.fields.find((f) => f.k === 'target') as any;
  targetField.set('sides');
  const browse = wallGroup.fields.find((f) => f.k === 'browse material') as any;
  browse.run();
  assertEqual(store.lens(), 'materials', 'browse material opens the wide material lens');
  assertEqual(store.paintTarget()?.slot, 'sides', 'the chosen face target is retained');
  store.setPaintTargetSkin(store.paintTarget()!, { kind: 'material', id: 'brickRed' });
  assertEqual(store.resolved(MOTEL, 1, 'sides').skin?.kind === 'material' ? store.resolved(MOTEL, 1, 'sides').skin!.id : '', 'brickRed', 'material browser applies through the skin path');
});

test('stage face selection repoints a stale material browser target to the clicked piece face', () => {
  const { store } = fixture();
  store.setTypeSkin(MOTEL, 'roof', 'front', { kind: 'material', id: 'brickRed' });
  store.setPaintTarget({
    buildingId: MOTEL,
    scope: { kind: 'type', pieceKind: 'roof' },
    slot: 'front',
    label: 'top',
    materialId: 'brickRed',
  });
  store.selectPieceTarget(MOTEL, 1, 'front');
  assertEqual(store.selectedPiece(MOTEL), 1, 'the clicked wall piece is selected');
  assertEqual(store.skinTarget(MOTEL, { kind: 'piece', index: 1 }), 'front', 'the active piece face follows the click');
  assertEqual(store.paintTarget()?.scope.kind, 'piece', 'the material browser no longer points at the stale roof global');
  assertEqual(store.paintTarget()?.slot, 'front', 'the material browser target follows the clicked face');
  store.setPaintTargetSkin(store.paintTarget()!, { kind: 'material', id: 'mat.asphalt' });
  assertEqual(store.resolved(MOTEL, 1, 'front').skin?.kind === 'material' ? store.resolved(MOTEL, 1, 'front').skin!.id : '', 'mat.asphalt', 'applying now edits the wall face');
  assertEqual(store.resolved(MOTEL, 5, 'front').skin?.kind === 'material' ? store.resolved(MOTEL, 5, 'front').skin!.id : '', 'brickRed', 'the roof keeps its previous material');
});

test('material apply uses the current target, not a stale render target', () => {
  const { store } = fixture();
  store.setPaintTarget({
    buildingId: MOTEL,
    scope: { kind: 'type', pieceKind: 'roof' },
    slot: 'front',
    label: 'top',
    materialId: null,
  });
  const stale = store.paintTarget();
  assertEqual(stale?.scope.kind, 'type', 'opened on a type-global target');
  store.selectPieceTarget(MOTEL, 1, 'front');
  assertEqual(store.paintTarget()?.scope.kind, 'piece', 'clicking the stage moved the active target');
  assertEqual(store.applyPaintTargetSkin({ kind: 'material', id: 'mat.asphalt' }), true, 'apply succeeds against the active target');
  assertEqual(store.resolved(MOTEL, 1, 'front').skin?.kind === 'material' ? store.resolved(MOTEL, 1, 'front').skin!.id : '', 'mat.asphalt', 'the clicked piece face receives the material');
  assertEqual(store.resolved(MOTEL, 5, 'front').skin, null, 'the stale roof target is left alone');
});

test('material browser target can switch faces and keep the selected material ready to apply', () => {
  const { store } = fixture();
  store.selectPieceTarget(MOTEL, 1, 'front');
  store.setPaintTargetSlot('back');
  assertEqual(store.skinTarget(MOTEL, { kind: 'piece', index: 1 }), 'back', 'face chip retargets the selected piece group');
  assertEqual(store.paintTarget()?.label, 'override back', 'the browser label follows the face chip');
  store.setPaintTargetSkin(store.paintTarget()!, { kind: 'material', id: 'brickRed' });
  assertEqual(store.resolved(MOTEL, 1, 'back').skin?.kind === 'material' ? store.resolved(MOTEL, 1, 'back').skin!.id : '', 'brickRed', 'apply writes the retargeted back face');
  assertEqual(store.resolved(MOTEL, 1, 'front').skin, null, 'the previous front face stays untouched');
});

test('repainting a piece override keeps the inherited type material as the paint underlay', () => {
  const { store } = fixture();
  store.setTypeSkin(MOTEL, 'wall', 'back', { kind: 'material', id: 'brickRed' });
  store.setPieceSkin(MOTEL, 1, 'back', { kind: 'material', id: 'custom:old-painted-back' });
  store.selectPieceTarget(MOTEL, 1, 'back');
  const target = store.paintTarget();
  assertEqual(target?.materialId, 'custom:old-painted-back', 'the active face is still the current painted override');
  assertEqual(target?.underlayId, 'brickRed', 'the repaint target remembers the inherited wall material underneath');
});

test('material apply updates the visible building even when the session is unavailable', () => {
  const store = sessionlessFixture();
  store.selectPieceTarget(MOTEL, 1, 'front');
  store.setPaintTargetSkin(store.paintTarget()!, { kind: 'material', id: 'mat.asphalt' });
  assertEqual(store.resolved(MOTEL, 1, 'front').skin?.kind === 'material' ? store.resolved(MOTEL, 1, 'front').skin!.id : '', 'mat.asphalt', 'local optimistic prefab carries the edit immediately');
  assertEqual(buildingRender(store, MOTEL)[1].faces.front.textureId, 'mat.asphalt', 'stage render reads the locally updated prefab');
});

test('material preview paints the building render without committing until apply', () => {
  const { store } = fixture();
  const target = { buildingId: MOTEL, scope: { kind: 'type' as const, pieceKind: 'wall' as const }, slot: 'front' as const, label: 'front', materialId: null };
  const preview = buildingRender(store, MOTEL, { target, textureId: 'mat.asphalt' });
  assertEqual(preview[1].faces.front.textureId, 'mat.asphalt', 'the preview material is visible on the target face');
  assertEqual(preview[1].faces.back.textureId ?? '', '', 'non-target faces are left alone');
  assertEqual(store.resolved(MOTEL, 1, 'front').skin, null, 'preview does not write the prefab');
});

test('stage face math: turned wall render slabs match raycast face slots', () => {
  const front = stageQuarterNormal(90);
  assertClose(front.nx, -1, 1e-6, 'yaw 90 front slab follows build-system +yaw');
  assertClose(front.nz, 0, 1e-6, 'yaw 90 front slab sits on the -X face');
  const wall = { kind: 'wall', yawDegrees: 90 };
  assertEqual(stageFaceSlotFromNormal(wall as any, { x: -1, y: 0, z: 0 }), 'front', 'clicking that visible side targets the same front slot');
  assertEqual(stageFaceSlotFromNormal(wall as any, { x: 1, y: 0, z: 0 }), 'back', 'the opposite side targets back');
});

test('clear target clears the saved skin and the active material target state', () => {
  const { store } = fixture();
  const spec = buildingsPanel(store, MOTEL, (target) => {
    store.setPaintTarget(target);
    store.setLens('materials');
  });
  const wallGroup = spec.groups.find((g) => g.title === 'SKINS · GLOBAL')!;
  const targetField = wallGroup.fields.find((f) => f.k === 'target') as any;
  targetField.set('front');
  const browse = wallGroup.fields.find((f) => f.k === 'browse material') as any;
  browse.run();
  store.setPaintTargetSkin(store.paintTarget()!, { kind: 'material', id: 'mat.asphalt' });
  assertEqual(store.paintTarget()?.materialId, 'mat.asphalt', 'active target tracks the applied material');
  const refreshed = buildingsPanel(store, MOTEL, (target) => store.setPaintTarget(target));
  const clear = refreshed.groups.find((g) => g.title === 'SKINS · GLOBAL')!.fields.find((f) => f.k === 'clear target') as any;
  clear.run();
  assertEqual(store.resolved(MOTEL, 1, 'front').skin, null, 'the saved face material is cleared');
  assertEqual(store.paintTarget()?.materialId, null, 'the material browser target no longer previews the cleared material');
});

test('DELETE building is two-step: arm (nothing committed) → confirm (prefabRemoved lands)', () => {
  const { store, labels, state } = fixture();
  const before = labels.length;
  assertEqual(store.deleteBuilding(MOTEL), false, 'first click ARMS, never deletes');
  assertEqual(labels.length, before, 'nothing committed while armed');
  assertEqual(store.armedDelete(), MOTEL, 'the panel can render ⚠ confirm');
  assertEqual(store.deleteBuilding(MOTEL), true, 'the second click executes');
  assertEqual(labels[labels.length - 1], '− building Motel Room (6 pieces)', 'one prefabRemoved commit, labeled');
  assertEqual(store.building(MOTEL), null, 'the building is gone from the merged read (a SEED stays gone — tombstoned)');
  assert((state().removedPrefabs ?? []).includes(MOTEL), 'the tombstone landed in the real materializer');
  assert(!store.buildings().some((b) => b.id === MOTEL), 'the roster row is gone');
  // skins live INSIDE the def — nothing orphaned by construction; the only
  // other keyed state (selection) was dropped with it
  assertEqual(store.selectedPiece(MOTEL), -1, 'no dangling selection');
});

test('the arm disarms on any other action; a re-defined id revives; a tombstoned id cannot stamp', () => {
  const { store, state } = fixture();
  store.deleteBuilding(MOTEL); // arm
  store.selectPiece(MOTEL, 1); // moving on disarms
  assertEqual(store.armedDelete(), null, 'selection change disarms');
  store.deleteBuilding(MOTEL); // arm again
  store.setTypeSkin(MOTEL, 'wall', 'all', GREEN); // an edit disarms
  assertEqual(store.armedDelete(), null, 'an edit disarms');
  // now delete for real, then revive by re-defining the same id
  store.deleteBuilding(MOTEL);
  store.deleteBuilding(MOTEL);
  assertEqual(store.building(MOTEL), null, 'deleted');
  const stamped = worldStream.apply(state(), { kind: 'prefabStamped', prefabId: MOTEL, origin: { x: 0, y: 0, z: 0 }, yawDegrees: 0 });
  assertEqual(stamped.pieces.length, state().pieces.length, 'a deleted type cannot stamp (the seed fallback stays dead)');
  const revived = worldStream.apply(state(), { kind: 'prefabDefined', def: { id: MOTEL, label: 'Motel Reborn', theme: 'motel', pieces: [{ pieceId: 'wall.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0 }] } });
  assert(!(revived.removedPrefabs ?? []).includes(MOTEL), 'a later prefabDefined lifts the tombstone');
  assertEqual(revived.prefabs[MOTEL].label, 'Motel Reborn', 'and the new meaning stands');
});

test('the floor cell painter (MICROGRID-0610): paint a cell, see it stamp, clear back to default', () => {
  const { store, state } = fixture();
  const def = store.building(MOTEL)!;
  const floorIndex = def.pieces.findIndex((p) => p.pieceId.startsWith('floor.'));
  assert(floorIndex >= 0, 'the motel seed has a floor');
  // paint the centre cell → the def commits with 9 entries, centre authored
  store.setPieceFloorCell(MOTEL, floorIndex, 4, 'bush');
  const cells = store.building(MOTEL)!.pieces[floorIndex].cells!;
  assertEqual(cells.length, 9, 'always the full 9');
  assertEqual(cells[4], 'bush', 'centre authored');
  assertEqual(cells[0], null, 'others stay default');
  assert(validatePrefab(store.building(MOTEL)!).length === 0, 'the painted def stays valid');
  // the stamp carries the cells into every placed instance
  const stamped = worldStream.apply(state(), { kind: 'prefabStamped', prefabId: MOTEL, origin: { x: 10, y: 0, z: 10 }, yawDegrees: 90 });
  const placedFloor = stamped.pieces.find((p) => p.pieceId.startsWith('floor.'));
  assertEqual(placedFloor?.cells?.[4], 'bush', 'the stamp carries authored cells');
  // the stage render exposes them (col 4 demonstrates)
  const render = buildingRender(store, MOTEL);
  assertEqual(render[floorIndex].cells?.[4], 'bush', 'PieceRender carries cells');
  // clearing the only authored cell drops the field entirely
  store.setPieceFloorCell(MOTEL, floorIndex, 4, null);
  assertEqual(store.building(MOTEL)!.pieces[floorIndex].cells, undefined, 'all-default collapses the field');
  // cells on a non-floor refuse
  const wallIndex = store.building(MOTEL)!.pieces.findIndex((p) => p.pieceId.startsWith('wall.'));
  assertThrows(() => store.setPieceFloorCell(MOTEL, wallIndex, 0, 'bush'), 'cells live on floor pieces only');
});

finish('workbench/buildings');
