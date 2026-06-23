// props.test.ts — behavior tests for world prop geometry.

import type { WorldProp } from '../design';
import { assert, assertClose, finish, test } from '../game/_testkit';
import { propKindDefinition } from '../game/kinds/props';
import { propOrientedPhysicsRect, propPhysicsRect } from './props';

function prop(kind: WorldProp['kind'], yawDegrees = 0): WorldProp {
  return {
    id: 'p_test',
    kind,
    x: 10,
    y: 0,
    z: 20,
    yawDegrees,
    createdByCommand: 'test',
  };
}

test('imported rectangular props ship measured oriented physics, not a radius square', () => {
  const desk = prop('imported.desk');
  const def = propKindDefinition(desk.kind);
  const oriented = propOrientedPhysicsRect(desk);
  assert(oriented !== null, 'imported desk has an oriented physics footprint');
  assertClose(oriented!.maxX - oriented!.minX, def.footprintWidthMeters!, 1e-6, 'desk collision width is measured local X');
  assertClose(oriented!.maxZ - oriented!.minZ, def.footprintDepthMeters!, 1e-6, 'desk collision depth is measured local Z');
  assert(
    oriented!.maxZ - oriented!.minZ < def.footprintRadiusMeters * 2,
    'desk front/back depth must not fall back to the coarse radius square',
  );
});

test('prop AABB remains an editor query shape while physics keeps the local rectangle', () => {
  const desk = prop('imported.desk', 90);
  const def = propKindDefinition(desk.kind);
  const aabb = propPhysicsRect(desk);
  const oriented = propOrientedPhysicsRect(desk);
  assert(aabb !== null && oriented !== null, 'rotated desk has both query AABB and physics OBB');
  assertClose(aabb!.maxX - aabb!.minX, def.footprintDepthMeters!, 1e-6, 'query AABB rotates into world X');
  assertClose(aabb!.maxZ - aabb!.minZ, def.footprintWidthMeters!, 1e-6, 'query AABB rotates into world Z');
  assertClose(oriented!.maxX - oriented!.minX, def.footprintWidthMeters!, 1e-6, 'physics OBB keeps local X width');
  assertClose(oriented!.maxZ - oriented!.minZ, def.footprintDepthMeters!, 1e-6, 'physics OBB keeps local Z depth');
});

finish('world/props');
