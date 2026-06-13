// mineProp tests — proves a self-contained prop asset mines down to flat parts
// (GUIDING_LIGHT: the component is the source, the recipe is derived).

import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';
import { Payphone } from '../../render3d/props/Payphone';
import { Dumpster } from '../../render3d/props/Dumpster';
import { Furniture } from '../../render3d/props/Furniture';
import { StreetFurniture } from '../../render3d/props/StreetFurniture';
import { Tree } from '../../render3d/props/Tree';
import { Rock } from '../../render3d/props/Rock';
import { WallDecor } from '../../render3d/props/WallDecor';
import { propKindDefinition } from '../../game/kinds/props';
import { mineProp } from './mineProp';
import type { PropPartSpec } from '../../game/kinds/propModels';

function assertSane(parts: PropPartSpec[], label: string): void {
  assert(parts.length > 0, `${label}: at least one part`);
  for (const part of parts) {
    assert(['box', 'cylinder8', 'cylinder16', 'sphere'].includes(part.shape), `${label}: known shape`);
    assert(Array.isArray(part.color) && part.color.length === 3, `${label}: rgb colour`);
    assert(part.local.every(Number.isFinite), `${label}: finite local`);
    assert(part.size.every((n) => Number.isFinite(n) && n > 0), `${label}: positive finite size`);
  }
}

test('mineProp lowers the payphone asset to its exact flat parts', () => {
  const parts = mineProp(Payphone, 'payphone');
  assertEqual(parts.length, 8, 'payphone part count');
  const s = propKindDefinition('payphone').heightMeters / 1.54;
  assertEqual(parts[0].shape, 'cylinder16', 'pole shape');
  assertClose(parts[0].size[0], 0.1 * s, 1e-4, 'pole diameter');
  assertClose(parts[0].size[1], 1.0 * s, 1e-4, 'pole height');
  assertEqual(parts[1].shape, 'box', 'body shape');
  assertClose(parts[1].size[0], 0.42 * s, 1e-4, 'body width (params×scale)');
  assert(parts[7].rotation != null && Math.abs(parts[7].rotation![0] - 10) < 1e-4, 'handset pitch preserved');
  assertClose(parts[7].rotation![1], 0, 1e-4, 'yaw is local (0 at canonical)');
  assertSane(parts, 'payphone');
});

// The dispatching assets (one component → many kinds) must mine each kind, and
// the loop/sphere-blob assets (trees, rocks) must mine their generated meshes.
test('mineProp covers every asset family', () => {
  assertSane(mineProp(Dumpster, 'dumpster'), 'dumpster');
  assertSane(mineProp(Furniture, 'couch'), 'couch (Furniture)');
  assertSane(mineProp(Furniture, 'oven'), 'oven (Furniture)');
  assertSane(mineProp(Furniture, 'bedDouble'), 'bedDouble (Furniture)');
  assertSane(mineProp(StreetFurniture, 'trafficCone'), 'trafficCone (StreetFurniture)');
  assertSane(mineProp(StreetFurniture, 'basketballHoop'), 'basketballHoop (StreetFurniture)');
  assertSane(mineProp(Tree, 'treeOak'), 'treeOak (Tree, foliage loop)');
  assertSane(mineProp(Rock, 'boulder'), 'boulder (Rock)');
  assertSane(mineProp(WallDecor, 'mirror'), 'mirror (WallDecor)');
});

finish('mineProp');
