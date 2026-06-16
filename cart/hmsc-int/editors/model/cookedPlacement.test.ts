// cookedPlacement.test.ts — repro for "the cooked prop shows in the palette but
// won't place" (req_1136). Walks the EXACT placement chain a cooked prop takes:
// register the overlay → palette lists it → validatePlacement passes → the
// worldStream materializer KEEPS the piecePlaced event (stream.ts:267 drops an
// unknown catalog id). If any link drops the cooked kind, placement silently fails.

import { registerCookedProps, isPropKind, propCategory, isCookedPropKind } from '../../game/kinds/props';
import { registerCookedCatalog, catalogEntry, isCatalogId, catalogEntriesByKind } from '../../game/build/catalog';
import { placementFor, validatePlacement } from '../../game/build/placed';
import { worldStream } from '../../game/world/stream';
import { cookProp } from './cookedAsset';
import { cuboid } from './editMesh';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

// Cook a 1 m cube the way the Studio dialog does, then register its descriptor +
// catalog row the way syncCookedRegistry does (props FIRST, then catalog).
const result = cookProp({ id: 'studio.cube', name: 'Cube', parts: [{ mesh: cuboid(1, 1, 1), lift: 0.5, visible: true }], descriptor: { solid: true, tileKind: 'wall' } });
registerCookedProps([result.asset.descriptor]);
registerCookedCatalog([result.asset.descriptor.kind]);

const PIECE_ID = 'prop.studio.cube';

test('the cooked kind resolves through the prop overlay', () => {
  assert(isCookedPropKind('studio.cube'), 'isCookedPropKind true');
  assert(isPropKind('studio.cube'), 'isPropKind true (overlay)');
  assertEqual(propCategory('studio.cube'), 'studio', 'lands on the studio shelf');
});

test('the catalog overlay lists + resolves the cooked prop row', () => {
  assert(isCatalogId(PIECE_ID), 'isCatalogId true for the cooked piece');
  assertEqual(catalogEntry(PIECE_ID).kind, 'prop', 'catalogEntry resolves it as a prop');
  assertEqual(catalogEntry(PIECE_ID).propKind, 'studio.cube', 'row carries the propKind reference');
  assert(catalogEntriesByKind('prop').some((e) => e.id === PIECE_ID), 'the prop palette includes it');
});

test('validatePlacement PASSES for a cooked prop (the placeAt gate)', () => {
  const placement = placementFor(catalogEntry(PIECE_ID), { x: 2, y: 0, z: 3, yawDegrees: 0 });
  const problems = validatePlacement(placement);
  assertEqual(problems.join('|'), '', 'no placement problems');
});

test('the worldStream materializer KEEPS the cooked piecePlaced (stream.ts:267)', () => {
  const placement = placementFor(catalogEntry(PIECE_ID), { x: 2, y: 0, z: 3, yawDegrees: 0 });
  const s0 = worldStream.initial();
  const s1 = worldStream.apply(s0, { kind: 'piecePlaced', placement } as any);
  const pieces = (s1 as any).pieces ?? [];
  assert(pieces.length === 1, `the cooked piece survived the materializer (got ${pieces.length})`);
  assertEqual(pieces[0]?.pieceId, PIECE_ID, 'it is the cooked piece');
});

finish('cookedPlacement');
