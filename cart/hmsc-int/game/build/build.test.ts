// game/build behavior tests (P4) — MEANING tests for the V24 piece grammar:
// they assert what authored pieces MEAN (a doorway is a portal; a window has
// sightline but not traversal; cover values carry; prefabs decompose to
// semantic pieces; the catalog honors its kind contracts), never what the
// functions are called. Runs under tools/v8cli via `rjit game verify`.

import { assert, assertEqual, finish, test } from '../_testkit';
import {
  BUILD_PIECE_KINDS,
  BUILD_KIND_CONTRACTS,
  buildKindContract,
  isBuildPieceKind,
} from './pieces';
import { WALL_EDITS, WALL_EDIT_DEFINITIONS, applyWallEdit, isWallEdit } from './edits';
import {
  BUILD_CATALOG,
  BUILD_CATALOG_IDS,
  catalogEntry,
  catalogEntriesByKind,
  catalogEntriesByTheme,
  effectiveTags,
  validateCatalog,
  validateCatalogEntry,
} from './catalog';
import {
  decomposePrefab,
  prefabDefinition,
  validatePrefab,
  validatePrefabs,
} from './prefabs';
import { placementFor } from './placed';
import {
  validateMarkers,
  markersOfType,
  type WorldMarker,
} from './markers';

const SOLID_WALL = catalogEntry('wall.concrete.common');

// ── edit meaning ─────────────────────────────────────────────────────────────

test('a doorway is a portal: the door edit opens a walk portal through a solid wall', () => {
  const tags = applyWallEdit(SOLID_WALL.tags, 'door');
  assert(tags.portal, 'door edit must set portal');
  assertEqual(WALL_EDIT_DEFINITIONS.door.portalKind, 'walk', 'a doorway admits bodies');
  assert(WALL_EDIT_DEFINITIONS.door.traversable, 'a doorway is traversable');
  assertEqual(WALL_EDIT_DEFINITIONS.door.interaction?.action, 'toggle', 'a door exposes the open/close interaction');
  assertEqual(WALL_EDIT_DEFINITIONS.door.interaction?.defaultState, 'closed', 'authored doors start closed until toggled');
  assert(!SOLID_WALL.tags.portal, 'the uncut wall is NOT a portal');
});

test('a window has sightline but not traversal', () => {
  const def = WALL_EDIT_DEFINITIONS.window;
  const tags = applyWallEdit(SOLID_WALL.tags, 'window');
  assert(def.sightline, 'a window opens a sightline');
  assert(!def.traversable, 'a window is not walked through');
  assertEqual(def.portalKind, 'none', 'a window is never a nav portal');
  assert(!tags.blocksSight, 'the edited wall no longer blocks sight');
  assert(tags.collision, 'the edited wall still has collision mass');
  assert(!tags.portal, 'the edited wall still connects no rooms');
});

test('a broken window adds the vault entry a window lacks', () => {
  const tags = applyWallEdit(SOLID_WALL.tags, 'brokenWindow');
  assert(tags.vaultable, 'broken glass is a vault entry');
  assert(WALL_EDIT_DEFINITIONS.brokenWindow.traversable, 'a body fits through');
  assertEqual(WALL_EDIT_DEFINITIONS.brokenWindow.portalKind, 'none', 'vault entry, not a corridor');
});

test('a garage door is a vehicle portal', () => {
  const tags = applyWallEdit(SOLID_WALL.tags, 'garageDoor');
  assert(tags.portal, 'garage door connects spaces');
  assertEqual(WALL_EDIT_DEFINITIONS.garageDoor.portalKind, 'vehicle', 'a car drives through');
  assertEqual(WALL_EDIT_DEFINITIONS.garageDoor.interaction?.action, 'toggle', 'garage doors are interactable too');
});

test('halfHeight drops a full wall to vaultable low cover with sight over the top', () => {
  const tags = applyWallEdit(SOLID_WALL.tags, 'halfHeight');
  assertEqual(tags.cover, 'low', 'half a wall is low cover');
  assert(tags.vaultable, 'a waist wall is vaulted');
  assert(!tags.blocksSight, 'you see over a half wall');
  assert(tags.collision, 'the low wall is still solid');
});

test('the solid edit is the identity: no cutout, no meaning change', () => {
  const tags = applyWallEdit(SOLID_WALL.tags, 'solid');
  assertEqual(JSON.stringify(tags), JSON.stringify(SOLID_WALL.tags), 'solid changes nothing');
});

// ── cover carries ────────────────────────────────────────────────────────────

test('cover values carry: the catalog speaks the kinds registry cover vocabulary', () => {
  const allowed = ['none', 'low', 'high', 'full'];
  for (const id of BUILD_CATALOG_IDS) {
    assert(allowed.includes(BUILD_CATALOG[id].tags.cover), `${id}: cover '${BUILD_CATALOG[id].tags.cover}' not in the shared vocabulary`);
  }
  // and an uneditied piece's cover passes through effectiveTags untouched
  const dumpster = catalogEntry('prop.dumpster');
  assertEqual(effectiveTags(dumpster).cover, 'high', 'chest-high dumpster cover carries');
});

// ── catalog vs contract ──────────────────────────────────────────────────────

test('the shipped catalog validates against every kind contract', () => {
  const problems = validateCatalog();
  assertEqual(problems.length, 0, `catalog violations: ${problems.join(' | ')}`);
});

test('an entry claiming a capability its kind never promised is rejected', () => {
  const trim = catalogEntry('trim.cornice.downtown');
  const cheating = { ...trim, id: 'trim.cheat', tags: { ...trim.tags, collision: true, cover: 'full' as const } };
  const problems = validateCatalogEntry(cheating);
  assert(problems.length >= 2, 'collision + cover on decor-only trim must both be violations');
});

test('prop entries must reference a real prop kind; others must not', () => {
  const dumpster = catalogEntry('prop.dumpster');
  assertEqual(dumpster.propKind, 'dumpster', 'prop rows carry the pipeline reference');
  const orphanProp = { ...dumpster, id: 'prop.orphan', propKind: undefined };
  assert(validateCatalogEntry(orphanProp).length > 0, 'a prop with no propKind is incomplete');
  const wallWithProp = { ...SOLID_WALL, id: 'wall.confused', propKind: 'dumpster' as const };
  assert(validateCatalogEntry(wallWithProp).length > 0, 'propKind on a wall is meaningless');
});

test('every kind has a contract, renders, and only the wall family takes edits', () => {
  for (const kind of BUILD_PIECE_KINDS) {
    const contract = buildKindContract(kind);
    assert(contract.promise.renderGeometry, `${kind}: everything renders`);
    assert(isBuildPieceKind(kind), `${kind} round-trips the guard`);
  }
  const editKinds = BUILD_PIECE_KINDS.filter((kind) => BUILD_KIND_CONTRACTS[kind].edits === 'wall');
  assertEqual(editKinds.join(','), 'wall', 'WallEdit belongs to walls alone');
  assert(WALL_EDITS.length === 8 && isWallEdit('doubleWindow'), 'the ruled edit vocabulary is present');
});

test('vertical links are exactly ramp, stairs, and elevator (the kinds that connect floors)', () => {
  const links = BUILD_PIECE_KINDS.filter((kind) => BUILD_KIND_CONTRACTS[kind].promise.verticalLink);
  assertEqual(links.sort().join(','), 'elevator,ramp,stairs', 'the floor-connecting kinds');
});

test('stairs default to the full 3m module, with narrow stairs as an explicit variant', () => {
  assertEqual(catalogEntry('stairs.wood.common').size.widthMeters, 3, 'default wood stairs are not the old one-third-width model');
  assertEqual(catalogEntry('stairs.concrete.common').size.widthMeters, 3, 'concrete stairs fill the same floor module');
  assertEqual(catalogEntry('stairs.metal.industrial').size.widthMeters, 3, 'industrial stairs fill the same floor module');
  assertEqual(catalogEntry('stairs.wood.narrow').size.widthMeters, 1.2, 'the compact stair is named narrow on purpose');
  assert(catalogEntriesByKind('stairs').length >= 4, 'the palette has multiple stair models');
});

test('theme query folds the common rows in; kind query is exact', () => {
  const motel = catalogEntriesByTheme('motel');
  assert(motel.some((entry) => entry.theme === 'motel'), 'themed rows present');
  assert(motel.some((entry) => entry.theme === 'common'), 'common rows serve every theme');
  assert(catalogEntriesByKind('wall').every((entry) => entry.kind === 'wall'), 'byKind is exact');
});

// ── prefabs decompose ────────────────────────────────────────────────────────

test('a prefab decomposes to its semantic pieces — the bake sees through it', () => {
  const motelRoom = prefabDefinition('prefab.motelRoom');
  const pieces = decomposePrefab(motelRoom, { x: 10, y: 0, z: 20 });
  assertEqual(pieces.length, motelRoom.pieces.length, 'no piece lost, no blob gained');
  assert(pieces.some((piece) => piece.tags.portal), 'the cloned room still has its doorway portal');
  assert(pieces.some((piece) => piece.edit === 'window' && !piece.tags.blocksSight), 'the window wall still has its sightline');
  assert(pieces.every((piece) => piece.def.kind !== undefined), 'every piece resolves its catalog row');
  const floor = pieces.find((piece) => piece.def.kind === 'floor');
  assert(floor !== undefined && floor.x === 10 && floor.z === 20, 'world placement = origin + local');
});

// ── wall TYPES that are a cutout (REQ-0647: NOT prefabs, USER ruled) ─────────

test('door/doorway/window methods are WALL TYPES: same kind, same edge snap, the cut rides the row', () => {
  const expectations: Array<[string, string]> = [
    ['wall.concrete.doorway', 'door'],
    ['wall.concrete.openDoorway', 'arch'],
    ['wall.metal.garageDoor', 'garageDoor'],
    ['wall.stucco.window', 'window'],
    ['wall.stucco.doubleWindow', 'doubleWindow'],
    ['wall.plywood.brokenWindow', 'brokenWindow'],
  ];
  for (const [id, edit] of expectations) {
    const row = catalogEntry(id);
    assertEqual(row.kind, 'wall', `${id} is a wall, not a prefab composition`);
    assertEqual(row.snap, 'edge', `${id} rides the wall edge-snap lattice — it lines up with walls`);
    assertEqual(row.defaultEdit, edit, `${id} carries its cut as the row's defaultEdit`);
  }
  assertEqual(catalogEntry('wall.stucco.window').material, 'stucco', 'the window method is residential, not storefront glass');
  // the door method is the interactable door (E opens/closes)
  assertEqual(WALL_EDIT_DEFINITIONS[catalogEntry('wall.concrete.doorway').defaultEdit!].interaction?.action, 'toggle', 'the doorway wall lands an interactable door');
});

test('placementFor stamps the defaultEdit onto the placement — every site cuts the same opening', () => {
  const doorway = catalogEntry('wall.concrete.doorway');
  const placement = placementFor(doorway, { x: 3, y: 0, z: 6, yawDegrees: 90 });
  assertEqual(placement.edit, 'door', 'the placed wall arrives with its doorway cut');
  assert(effectiveTags(doorway, placement.edit).portal, 'the placed doorway IS a walk portal');
  const solid = placementFor(SOLID_WALL, { x: 0, y: 0, z: 0, yawDegrees: 0 });
  assertEqual(solid.edit, undefined, 'a plain wall places uncut');
});

test('a defaultEdit on a non-wall kind violates the catalog contract', () => {
  const floor = catalogEntry('floor.concrete.common');
  const cheating = { ...floor, id: 'floor.cheat', defaultEdit: 'door' as const };
  assert(validateCatalogEntry(cheating).length > 0, 'only the wall family carries cutouts');
});

// ── the elevator is a PIECE (REQ-0647: "a ramp that is really an elevator") ──

test('the elevator is a one-module vertical-link piece, never a prefab', () => {
  const row = catalogEntry('elevator.metal.common');
  assertEqual(row.kind, 'elevator', 'a first-class kind in the vertical-link family');
  assertEqual(row.snap, 'grid', 'drops on the module grid like ramp/stairs');
  assertEqual(row.size.widthMeters, 3, 'one wall/floor module wide — "fits right in"');
  assertEqual(row.size.heightMeters, 3, 'one storey per placed piece; stack for floors');
  assert(BUILD_KIND_CONTRACTS.elevator.promise.verticalLink, 'an elevator knows it connects floors');
  assertEqual(BUILD_KIND_CONTRACTS.elevator.edits, 'none', 'shaft storeys take no wall cutouts');
});

test('the shipped prefabs validate; dangling references and illegal edits are rejected', () => {
  assertEqual(validatePrefabs().length, 0, 'seed prefabs are valid');
  const dangling = { id: 'prefab.bad', label: 'Bad', theme: 'common' as const, pieces: [{ pieceId: 'wall.imaginary', x: 0, y: 0, z: 0, yawDegrees: 0 }] };
  assert(validatePrefab(dangling).length > 0, 'unknown catalog id rejected');
  const editedFloor = { id: 'prefab.bad2', label: 'Bad2', theme: 'common' as const, pieces: [{ pieceId: 'floor.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0, edit: 'door' as const }] };
  assert(validatePrefab(editedFloor).length > 0, 'a floor takes no WallEdit');
});

// ── markers (the semantic overlays) ──────────────────────────────────────────

test('a portal references two different rooms that exist in the set', () => {
  const rooms: WorldMarker[] = [
    { type: 'room', id: 'room.lobby', polygon: [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 6 }, { x: 0, z: 6 }], y: 0, role: 'public' },
    { type: 'room', id: 'room.office', polygon: [{ x: 6, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 6 }, { x: 6, z: 6 }], y: 0, role: 'staff' },
  ];
  const good: WorldMarker[] = [...rooms, { type: 'portal', id: 'portal.lobby-office', fromRoom: 'room.lobby', toRoom: 'room.office', doorId: 'placed.wall.17' }];
  assertEqual(validateMarkers(good).length, 0, 'a well-wired portal validates');
  const dangling: WorldMarker[] = [...rooms, { type: 'portal', id: 'portal.dangling', fromRoom: 'room.lobby', toRoom: 'room.vault' }];
  assert(validateMarkers(dangling).length > 0, 'a portal into a missing room is a violation');
  const selfLoop: WorldMarker[] = [...rooms, { type: 'portal', id: 'portal.loop', fromRoom: 'room.lobby', toRoom: 'room.lobby' }];
  assert(validateMarkers(selfLoop).length > 0, 'a portal connects two DIFFERENT rooms');
});

test('an interest point role validates against the vocabulary; a trigger event is a command line', () => {
  const smoke: WorldMarker = { type: 'interest_point', id: 'ip.smoke', pos: { x: 1, y: 0, z: 1 }, role: 'smoke' };
  assertEqual(validateMarkers([smoke]).length, 0, 'a ruled role validates');
  const bogus = { type: 'interest_point', id: 'ip.bogus', pos: { x: 1, y: 0, z: 1 }, role: 'loiter' } as unknown as WorldMarker;
  assert(validateMarkers([bogus]).length > 0, 'an unruled role is rejected');
  const silent: WorldMarker = { type: 'trigger', id: 'trig.silent', bounds: { x: 0, y: 0, z: 0, widthMeters: 2, heightMeters: 2, depthMeters: 2 }, event: '   ' };
  assert(validateMarkers([silent]).length > 0, 'a trigger with no command line means nothing');
});

test('marker sets enforce unique ids and type queries are exact', () => {
  const a: WorldMarker = { type: 'path_node', id: 'pn.1', pos: { x: 0, y: 0, z: 0 }, tags: ['sidewalk'] };
  const dup: WorldMarker = { type: 'path_node', id: 'pn.1', pos: { x: 1, y: 0, z: 0 }, tags: [] };
  assert(validateMarkers([a, dup]).length > 0, 'duplicate marker ids rejected');
  const mixed: WorldMarker[] = [a, { type: 'camera_marker', id: 'cam.1', pos: { x: 0, y: 5, z: 0 }, target: { x: 0, y: 0, z: 0 }, shot: 'Orbit' }];
  assertEqual(markersOfType(mixed, 'camera_marker').length, 1, 'ofType filters exactly');
});

finish('build');
