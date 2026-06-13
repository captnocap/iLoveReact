// Behavior tests for bodies of water (P4): the FACTORED model — a footprint + a
// surface level, depth DERIVED against the bed, footing wades. Asserts what water
// DOES, not how it's stored.

import {
  submergedInWaterBody,
  waterBodyContains,
  waterBodyKindAt,
  waterDepthAt,
  waterSurfaceTopAt,
  type WaterBody,
} from './water';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

const rect: WaterBody = {
  id: 'pond', label: 'pond', shape: 'rect',
  x: 10, z: 20, width: 8, depth: 6, surfaceY: 2, createdByCommand: 'test',
};
const disc: WaterBody = {
  id: 'lake', label: 'lake', shape: 'disc',
  x: 0, z: 0, width: 10, depth: 10, surfaceY: 3, createdByCommand: 'test',
};

test('rect footprint covers its whole AABB and nothing outside it', () => {
  assert(waterBodyContains(rect, 10, 20), 'min corner inside');
  assert(waterBodyContains(rect, 17.9, 25.9), 'far corner inside');
  assert(!waterBodyContains(rect, 18, 26), 'max edge is exclusive');
  assert(!waterBodyContains(rect, 9.9, 23), 'just left is out');
  assert(!waterBodyContains(rect, 14, 19.9), 'just above is out');
});

test('disc footprint is the inscribed ellipse, not the box', () => {
  assert(waterBodyContains(disc, 5, 5), 'center inside');
  assert(waterBodyContains(disc, 9.9, 5), 'right-mid inside');
  assert(!waterBodyContains(disc, 0.2, 0.2), 'box corner is OUT of the disc');
  assert(!waterBodyContains(disc, 9.6, 9.6), 'far box corner is OUT of the disc');
});

test('depth is DERIVED = surfaceY - bed, never stored; clamps at 0', () => {
  // Flat bed at y=0: a 2m surface ⇒ 2m everywhere inside.
  assertClose(waterDepthAt(rect, 12, 22, 0), 2, 1e-9, 'flat bed full depth');
  // Dig the bed to -3 ⇒ 5m deep at that spot (same body, same float).
  assertClose(waterDepthAt(rect, 12, 22, -3), 5, 1e-9, 'dug bed is deeper');
  // Bed pokes ABOVE the surface ⇒ an island, no water.
  assertClose(waterDepthAt(rect, 12, 22, 2.5), 0, 1e-9, 'island, dry');
  // Outside the footprint ⇒ no water regardless of bed.
  assertClose(waterDepthAt(rect, 100, 100, -50), 0, 1e-9, 'outside, dry');
});

test('submersion = inside footprint AND below the surface', () => {
  assert(submergedInWaterBody(rect, 12, 22, 1), 'wading: y under surface');
  assert(!submergedInWaterBody(rect, 12, 22, 2), 'at the surface is not submerged');
  assert(!submergedInWaterBody(rect, 12, 22, 5), 'above the surface, dry');
  assert(!submergedInWaterBody(rect, 0, 0, -10), 'outside footprint, dry');
});

test('footing reads water only when submerged in some body', () => {
  assertEqual(waterBodyKindAt([rect, disc], { x: 12, y: 1, z: 22 }), 'water', 'in the pond');
  assertEqual(waterBodyKindAt([rect, disc], { x: 5, y: 1, z: 5 }), 'water', 'in the lake disc');
  assertEqual(waterBodyKindAt([rect, disc], { x: 12, y: 9, z: 22 }), undefined, 'above the pond is dry');
  assertEqual(waterBodyKindAt([], { x: 12, y: 1, z: 22 }), undefined, 'no bodies, dry');
  assertEqual(waterBodyKindAt(undefined, { x: 12, y: 1, z: 22 }), undefined, 'undefined list, dry');
});

test('overlapping bodies lift to the highest water surface', () => {
  const low: WaterBody = { ...rect, id: 'low', surfaceY: 1 };
  const high: WaterBody = { ...rect, id: 'high', surfaceY: 4 };
  assertClose(waterSurfaceTopAt([low, high], 12, 22)!, 4, 1e-9, 'max surface wins');
  assertEqual(waterSurfaceTopAt([low, high], 999, 999), undefined, 'dry where no body covers');
});

finish('water');
