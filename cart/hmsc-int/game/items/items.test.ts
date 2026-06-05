// items.test.ts — P4 behavior tests for the captured items registry (V11).
//
// Fidelity bar: the reference's model fns reduce to literal part props at
// identity ctx (origin 0, yaw 0, scale 1), so the transcription is testable
// as data — exact per-item part counts (the 73-part table), spot-checked
// literals, and structural invariants over every part. The custom geometry
// generators are validated by construction: triangle counts and extents must
// follow their params exactly.

import { GAME_ITEMS } from './index';
import {
  ITEM_DEFINITIONS,
  ITEM_GEOMETRIES,
  ITEM_TEXTURE_KEYS,
  approxItemBoundsMeters,
  isItemId,
  itemDefinition,
} from './items';
import {
  ITEM_GEOMETRY_DEFAULTS,
  generateBlade,
  generateBoatHull,
  generateSail,
  generateSurfboard,
} from './geometries';
import { assert, assertClose, assertEqual, assertThrows, finish, test } from '../_testkit';

// The reference's 19 ids in its emission order, with per-item part counts
// after static expansion of every .map() (prongs, wheels, pills, leaves+buds,
// tips+filters).
const EXPECTED_PART_COUNTS: Record<string, number> = {
  knife: 3, pistol: 3, pitchfork: 6, bat: 2, cash: 2, vehicle: 5, sailboat: 4,
  surfboard: 3, football: 1, basketball: 1, pillbottle: 2, beer: 3, liquor: 2,
  pills: 3, weed: 8, cigarettes: 12, backpack: 5, medkit: 2, tv: 6,
};

test('the registry carries the reference\'s 19 items, in order, all unaudited (V11)', () => {
  assertEqual(ITEM_DEFINITIONS.length, 19, '19 items');
  assertEqual(
    ITEM_DEFINITIONS.map((i) => i.id).join(','),
    Object.keys(EXPECTED_PART_COUNTS).join(','),
    'ids and order must match the reference ITEMS array',
  );
  for (const item of ITEM_DEFINITIONS) {
    assertEqual(item.scaleStatus, 'unaudited', `${item.id} must owe the scale audit`);
  }
});

test('per-item part counts match the reference after static expansion (73 total)', () => {
  let total = 0;
  for (const item of ITEM_DEFINITIONS) {
    assertEqual(item.parts.length, EXPECTED_PART_COUNTS[item.id], `${item.id} part count`);
    total += item.parts.length;
  }
  assertEqual(total, 73, 'the whole catalog is 73 parts');
});

test('every part is structurally valid: resolvable geometry, #rrggbb material, defined texture keys', () => {
  const validKeys = new Set(Object.values(ITEM_TEXTURE_KEYS));
  for (const item of ITEM_DEFINITIONS) {
    for (const part of item.parts) {
      assert(part.geometry in ITEM_GEOMETRIES, `${item.id}: geometry ${part.geometry} must resolve`);
      assert(/^#[0-9a-f]{6}$/i.test(part.material), `${item.id}: material ${part.material} must be #rrggbb`);
      assert(part.position.length === 3, `${item.id}: position must be a V3`);
      if (part.textureKey != null) {
        assert(validKeys.has(part.textureKey as any), `${item.id}: textureKey ${part.textureKey} must be in ITEM_TEXTURE_KEYS`);
        assertEqual(part.material, '#ffffff', `${item.id}: textured parts render white under their texture`);
      }
    }
  }
});

test('spot-checked literals survive transcription exactly (knife, vehicle, cigarettes, sailboat)', () => {
  const knife = itemDefinition('knife');
  assertEqual(knife.parts[0].geometry, 'blade', 'knife leads with the blade');
  assertClose((knife.parts[0].params as any).length, 1.1, 1e-12, 'blade length 1.1');
  assertClose(knife.parts[0].rotation![2], -0.18, 1e-12, 'blade roll -0.18');
  assertEqual(knife.parts[1].material, '#3a261b', 'grip wood color');

  const vehicle = itemDefinition('vehicle');
  const wheels = vehicle.parts.filter((p) => p.material === '#111111');
  assertEqual(wheels.length, 2, 'two wheels');
  assertClose(wheels[0].position[0], -0.52, 1e-12, 'left wheel x');
  assertClose(wheels[1].position[0], 0.52, 1e-12, 'right wheel x');
  assertClose(wheels[0].rotation![0], Math.PI / 2, 1e-12, 'wheels lie on their side');

  const cigs = itemDefinition('cigarettes');
  const texturedFaces = cigs.parts.filter((p) => p.textureKey != null);
  assertEqual(texturedFaces.length, 5, 'five textured pack faces');
  assertEqual(
    texturedFaces.map((p) => p.textureKey).join('|'),
    [ITEM_TEXTURE_KEYS.cigFront, ITEM_TEXTURE_KEYS.cigSide, ITEM_TEXTURE_KEYS.cigTop, ITEM_TEXTURE_KEYS.cigBack, ITEM_TEXTURE_KEYS.cigBottom].join('|'),
    'face order front/side/top/back/bottom',
  );
  const tips = cigs.parts.filter((p) => p.material === '#f4f0df');
  assertEqual(tips.length, 3, 'three loose cigarettes');
  assertClose(tips[1].position[1], 0.85, 1e-12, 'second tip rides 0.82 + 0.03');

  const boat = itemDefinition('sailboat');
  assertEqual(boat.parts[0].geometry, 'boatHull', 'hull first');
  assertClose((boat.parts[0].params as any).length, 1.35, 1e-12, 'hull length 1.35');
  assertClose(boat.parts[3].rotation![1], Math.PI, 1e-12, 'aft sail faces backward');
});

test('lookup surface: is/get/namesForConsole behave like the kinds families', () => {
  assert(isItemId('medkit'), 'medkit is an item');
  assert(!isItemId('rocketlauncher'), 'unknown ids are not items');
  assertThrows(() => itemDefinition('rocketlauncher'), 'unknown lookup must throw');
  assert(GAME_ITEMS.namesForConsole().includes('knife, pistol'), 'console list joins in order');
  assertEqual(GAME_ITEMS.ids.length, 19, 'the door re-exports the id list');
});

test('custom generators: triangle counts and extents follow params exactly', () => {
  // GeometryData.positions is interleaved [px,py,pz,nx,ny,nz,u,v]; `count` is
  // the vertex count (triangles = count / 3).
  const blade = generateBlade({ length: 2, width: 0.4, thickness: 0.1 });
  assertEqual(blade.count, 8 * 3, 'blade = 8 triangles (2 faces + 3 quads)');
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < blade.positions.length; i += 8) {
    minX = Math.min(minX, blade.positions[i]);
    maxX = Math.max(maxX, blade.positions[i]);
  }
  assertClose(minX, -0.9, 1e-6, 'heel at -0.45·length');
  assertClose(maxX, 1.16, 1e-6, 'tip at 0.58·length');

  const sail = generateSail(ITEM_GEOMETRY_DEFAULTS.sail);
  assertEqual(sail.count, 8 * 3, 'sail = 8 triangles');

  const hull = generateBoatHull({ length: 1, width: 0.5, height: 0.3 });
  assertEqual(hull.count, 8 * 3, 'hull = 8 triangles (deck quad + 6 hull tris)');
  let minY = Infinity;
  for (let i = 1; i < hull.positions.length; i += 8) minY = Math.min(minY, hull.positions[i]);
  assertClose(minY, -0.3, 1e-6, 'keel sits at -height');

  const board = generateSurfboard({ length: 1, width: 0.4, thickness: 0.06, segments: 12 });
  assertEqual(board.count, 12 * 4 * 3, 'surfboard = segments × (2 caps + 2 wall tris)');
});

test('the V11 evidence is queryable: boat and knife are the same size class (scale is trash, documented not fixed)', () => {
  const boat = approxItemBoundsMeters('sailboat');
  const knife = approxItemBoundsMeters('knife');
  // A sailboat 1.35m long vs a knife ~1.3m long — the authored numbers carried
  // verbatim ARE the ruling's evidence. The audit fixes values, not this test.
  assertClose(boat.size[0], 1.35, 0.05, 'boat length ~1.35m as authored');
  assert(knife.size[0] > 1.2, 'the knife is over 1.2m long as authored');
  assert(boat.size[0] / knife.size[0] < 1.2, 'boat barely longer than the knife — the V11 quote in numbers');
});

test('bounds give the audit usable starting numbers for every item', () => {
  for (const item of ITEM_DEFINITIONS) {
    const bounds = approxItemBoundsMeters(item.id);
    for (let axis = 0; axis < 3; axis += 1) {
      assert(Number.isFinite(bounds.size[axis]), `${item.id} axis ${axis} finite`);
      assert(bounds.size[axis] > 0, `${item.id} axis ${axis} positive`);
      assert(bounds.size[axis] < 3, `${item.id} axis ${axis} under 3m (hand-prop scale class)`);
    }
  }
});

finish('game/items');
