// cookedPiece.test.ts — proves a Studio model can be cooked into a real BUILD PIECE
// (req_1684): a cooked prop that carries `buildPlacement` registers a catalog row that
// edge/surface-snaps + grants cover, while staying kind:'prop' (the uniform mesh-backed
// substrate). A plain cook (no buildPlacement) stays free-snap scenery — every built-in
// prop is unchanged.
// Bundle + run:
//   tools/esbuild cart/hmsc-int/editors/model/cookedPiece.test.ts --bundle \
//     --format=esm --platform=neutral --target=es2022 \
//     --alias:@reactjit=./runtime --alias:@game=./cart/hmsc-int/game
//   tools/v8cli <out>.js

import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';
import { cuboid, type EditMesh } from './editMesh';
import { cookProp, type CookPart, type PropDescriptorInput } from './cookedAsset';
import { registerCookedProps } from '../../game/kinds/props';
import { registerCookedCatalog, catalogEntry, isCatalogId, cookedCatalogPickEntries } from '../../game/build/catalog';
import { placedPieceColliders, placedPieceRamps } from '../../game/build/placed';

function part(mesh: EditMesh, lift = 0, visible = true): CookPart {
  return { mesh, lift, visible };
}

/** Cook a 1m railing-ish bar, register it, and return its catalog row. */
function cookAndRegister(id: string, descriptor: PropDescriptorInput) {
  const result = cookProp({ id, name: id, parts: [part(cuboid(2, 1, 0.1))], descriptor });
  assertEqual(result.errors.length, 0, `cook clean: ${result.errors.join(', ')}`);
  registerCookedProps([result.asset.descriptor]);
  registerCookedCatalog([result.asset.descriptor.kind]);
  return result;
}

test('a cooked railing edge-snaps + grants cover, but stays kind:prop with a propKind', () => {
  cookAndRegister('studio.test_railing', {
    label: 'Test Railing', solid: true, tileKind: 'wall',
    buildPlacement: { snap: 'edge', cover: 'low', blocksSight: false },
  });
  assert(isCatalogId('prop.studio.test_railing'), 'the cooked piece is a real catalog id');
  const entry = catalogEntry('prop.studio.test_railing');
  assertEqual(entry.kind, 'prop', 'mesh-backed pieces stay kind:prop (one substrate)');
  assertEqual(entry.propKind, 'studio.test_railing', 'renders via its prop model');
  assertEqual(entry.snap, 'edge', 'a railing edge-snaps');
  assertEqual(entry.tags.cover, 'low', 'a railing grants low cover');
  assertEqual(entry.tags.blocksSight, false, 'an open railing does not block sight');
});

test('a cooked wall-trim surface-snaps onto a face', () => {
  cookAndRegister('studio.test_trim', {
    label: 'Test Trim', solid: false, tileKind: 'wall',
    buildPlacement: { snap: 'surface', cover: 'none' },
  });
  const entry = catalogEntry('prop.studio.test_trim');
  assertEqual(entry.snap, 'surface', 'trim sticks to a surface');
  assertEqual(entry.tags.collision, false, 'a decal trim has no collision mass');
});

test('a cooked WALL piece lists under walls in the swap pick (req_1698)', () => {
  cookAndRegister('studio.test_customwall', {
    label: 'Custom Wall', solid: true, tileKind: 'wall',
    buildPlacement: { pieceKind: 'wall', snap: 'edge', cover: 'full', blocksSight: true },
  });
  const row = cookedCatalogPickEntries().find((e) => e.id === 'prop.studio.test_customwall');
  assert(!!row, 'the custom wall is a swap-pick row');
  assertEqual(row!.kind, 'wall', 'it groups UNDER walls, so a placed wall can be swapped to it');
});

test('a cooked piece with no pieceKind falls back to its raw kind (props) in the swap pick', () => {
  cookAndRegister('studio.test_plainprop', { label: 'Plain', solid: true, tileKind: 'wall' });
  const row = cookedCatalogPickEntries().find((e) => e.id === 'prop.studio.test_plainprop');
  assert(!!row, 'present in the pick');
  assertEqual(row!.kind, 'prop', 'no pieceKind → groups under props');
});

test('a cooked STAIRS piece collides as a walkable slope, not a solid box (req_1700)', () => {
  cookAndRegister('studio.test_stairs', {
    label: 'Custom Stairs', solid: true, tileKind: 'wall',
    buildPlacement: { pieceKind: 'stairs', snap: 'grid' },
  });
  const piece = { id: 's1', pieceId: 'prop.studio.test_stairs', x: 0, y: 0, z: 0, yawDegrees: 0 } as never;
  const { rects, orientedRects } = placedPieceColliders([piece]);
  assertEqual(rects.length + orientedRects.length, 0, 'no solid box — the walkable slope IS the collider');
  const ramps = placedPieceRamps([piece], 0);
  assertEqual(ramps.length, 1, 'one walkable heightfield slope');
  const h = ramps[0];
  assert(h.heights[h.heights.length - 1] > h.heights[0], 'heights rise along depth (you walk UP it)');
});

test('a cooked WALL piece still collides as a solid box, never a slope', () => {
  cookAndRegister('studio.test_wallsolid', {
    label: 'Solid Wall', solid: true, tileKind: 'wall',
    buildPlacement: { pieceKind: 'wall', cover: 'full', blocksSight: true },
  });
  const piece = { id: 'w1', pieceId: 'prop.studio.test_wallsolid', x: 0, y: 0, z: 0, yawDegrees: 0 } as never;
  const { rects, orientedRects } = placedPieceColliders([piece]);
  assert(rects.length + orientedRects.length > 0, 'a custom wall is solid');
  assertEqual(placedPieceRamps([piece], 0).length, 0, 'a wall is not a walkable slope');
});

test('a cooked DOOR records a measured panel, excludes the leaf from colliders, opens a portal (req_1864)', () => {
  // a 3m wall frame + a named "Door Leaf" slab in the opening — the two-part door seed.
  const frame = part(cuboid(3, 3, 0.3));
  const leaf: CookPart = { name: 'Door Leaf', mesh: cuboid(1.0, 2.1, 0.08), lift: 0, visible: true };
  const result = cookProp({
    id: 'studio.test_door', name: 'Custom Door', parts: [frame, leaf],
    descriptor: {
      label: 'Custom Door', solid: true, tileKind: 'wall',
      buildPlacement: { pieceKind: 'wall', snap: 'edge', cover: 'full', blocksSight: true, portal: true },
      door: { vehicle: false },
    },
  });
  assertEqual(result.errors.length, 0, `cook clean: ${result.errors.join(', ')}`);
  const d = result.asset.descriptor;
  assert(!!d.doorPanel, 'the cook recorded a door panel measured from the leaf');
  assertClose(d.doorPanel!.height, 2.1, 1e-5, 'panel height = the leaf height');
  assertClose(d.doorPanel!.width, 1.0, 1e-5, 'panel width = the leaf width');
  assertEqual(d.doorPanel!.vehicle, false, 'a walk door');
  assert(d.doorPanel!.reachMeters > 0, 'carries an interaction reach from the edit vocabulary');
  // the leaf ships as a trailing sub-range; the panel references exactly that range.
  assert(!!result.asset.leaf, 'a trailing leaf sub-range is shipped');
  assertEqual(d.doorPanel!.meshStart, result.asset.leaf!.start, 'doorPanel range == the leaf sub-range start');
  assertEqual(d.doorPanel!.meshCount, result.asset.leaf!.count, 'doorPanel range == the leaf sub-range count');
  // the static collider is the FRAME only — the leaf is the live panel, so the
  // doorway is walkable when open (the frame cuboid is one connected box).
  assertEqual((d.collisionBoxes ?? []).length, 1, 'only the frame box collides; the leaf is excluded');
  // registers + lists under walls + opens a portal (catalog honors place.portal).
  registerCookedProps([d]);
  registerCookedCatalog([d.kind]);
  const entry = catalogEntry('prop.studio.test_door');
  assertEqual(entry.kind, 'prop', 'stays kind:prop (the uniform substrate)');
  assertEqual(entry.tags.portal, true, 'a door connects rooms (portal)');
  const row = cookedCatalogPickEntries().find((e) => e.id === 'prop.studio.test_door');
  assertEqual(row!.kind, 'wall', 'lists under walls — swap a placed wall to your door');
});

test('a wall cook WITHOUT a door request keeps the leaf-named part as a normal solid (no panel)', () => {
  // same parts, but no `door` in the descriptor → the "Door Leaf" part is just geometry.
  const result = cookProp({
    id: 'studio.test_nodoor', name: 'Plain Wall', parts: [part(cuboid(3, 3, 0.3)), { name: 'Door Leaf', mesh: cuboid(1, 2.1, 0.08), lift: 0, visible: true }],
    descriptor: { label: 'Plain Wall', solid: true, tileKind: 'wall', buildPlacement: { pieceKind: 'wall', cover: 'full', blocksSight: true } },
  });
  assertEqual(result.asset.descriptor.doorPanel, undefined, 'no door request → no panel');
  assert(!result.asset.leaf, 'no leaf sub-range split out');
  assertEqual((result.asset.descriptor.collisionBoxes ?? []).length, 2, 'both boxes collide (frame + the slab)');
});

test('a plain cook (no buildPlacement) stays free-snap scenery — legacy default intact', () => {
  cookAndRegister('studio.test_scenery', { label: 'Test Scenery', solid: true, tileKind: 'wall' });
  const entry = catalogEntry('prop.studio.test_scenery');
  assertEqual(entry.snap, 'free', 'no placement → free-snap, exactly as before');
});

finish();
