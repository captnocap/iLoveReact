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

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { cuboid, type EditMesh } from './editMesh';
import { cookProp, type CookPart, type PropDescriptorInput } from './cookedAsset';
import { registerCookedProps } from '../../game/kinds/props';
import { registerCookedCatalog, catalogEntry, isCatalogId, cookedCatalogPickEntries } from '../../game/build/catalog';

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

test('a plain cook (no buildPlacement) stays free-snap scenery — legacy default intact', () => {
  cookAndRegister('studio.test_scenery', { label: 'Test Scenery', solid: true, tileKind: 'wall' });
  const entry = catalogEntry('prop.studio.test_scenery');
  assertEqual(entry.snap, 'free', 'no placement → free-snap, exactly as before');
});

finish();
