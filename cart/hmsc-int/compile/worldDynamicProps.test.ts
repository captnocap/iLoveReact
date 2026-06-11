// compile/worldDynamicProps tests — the DYNAMIC_PROPS lump carries the
// kickable props (balls/cones/cans) into the compiled game, so the wire
// layout the Zig decoder (framework/world/constructor.zig decodeDynamicProps)
// reads must round-trip exactly here, and the bake split must hold: dynamics
// kinds leave the static instance buffer entirely.

import { assert, assertClose, assertEqual, finish, test } from '../game/_testkit';
import { propDynamics } from '../game/kinds/props';
import type { GameState } from '../design';
import { createInitialGameState } from '../state/gameState';
import { buildWorldInstances } from './worldGeometry';
import { DYNAMIC_PART_FLOATS, decodeDynamicProps, encodeDynamicProps } from './worldDynamicProps';
import { GAME_BUILD, type PlacedBuildPiece } from '@game';

/** A placed build piece wrapping a prop kind (the path /test's props take). */
function placedProp(kind: string, x: number, z: number, yawDegrees = 0): PlacedBuildPiece | null {
  for (const id of GAME_BUILD.catalog.ids as readonly string[]) {
    try {
      const def = GAME_BUILD.catalog.get(id);
      if (def.kind === 'prop' && def.propKind === kind) {
        return { id: `t-${id}-${x}-${z}`, pieceId: id, x, y: 0, z, yawDegrees } as PlacedBuildPiece;
      }
    } catch {
      // unknown id — skip
    }
  }
  return null;
}

function emptyState(): GameState {
  return createInitialGameState();
}

test('dynamics kinds leave the static buffer and land in the dynamic sink', () => {
  const ball = placedProp('ballBeach', 4, 4);
  const cone = placedProp('trafficCone', 8, 8, 45);
  const hydrant = placedProp('fireHydrant', 12, 12);
  assert(ball !== null && cone !== null && hydrant !== null, 'catalog carries ball/cone/hydrant pieces');
  const withDynamic = buildWorldInstances(emptyState(), [ball!, cone!, hydrant!], []);
  assertEqual(withDynamic.dynamicProps.length, 2, 'ball + cone are dynamic, hydrant is scenery');
  const staticOnly = buildWorldInstances(emptyState(), [hydrant!], []);
  assertEqual(
    withDynamic.instances.length,
    staticOnly.instances.length,
    'the static instance buffer holds ONLY the hydrant rows — dynamic parts shipped separately',
  );
  assert(withDynamic.dynamicProps[0].parts.length % DYNAMIC_PART_FLOATS === 0, 'parts are whole 13-float rows');
  assert(withDynamic.dynamicProps[0].parts.length > 0, 'the ball ships render parts');
});

test('encode/decode round-trips the registry dynamics exactly', () => {
  const ball = placedProp('ballSoccer', 10, -3, 30);
  assert(ball !== null, 'catalog carries a soccer ball piece');
  const result = buildWorldInstances(emptyState(), [ball!], []);
  assertEqual(result.dynamicProps.length, 1, 'one dynamic prop');
  const decoded = decodeDynamicProps(encodeDynamicProps(result.dynamicProps));
  assertEqual(decoded.version, 1, 'lump version');
  assertEqual(decoded.props.length, 1, 'one prop travels');
  const p = decoded.props[0];
  const recipe = propDynamics('ballSoccer');
  assert(recipe !== null, 'ballSoccer carries dynamics in the registry');
  assertClose(p.bodyRadiusMeters, recipe!.bodyRadiusMeters, 1e-6, 'body radius travels');
  assertClose(p.restitution, recipe!.restitution, 1e-6, 'restitution travels');
  assertClose(p.x, 10, 1e-6, 'anchor x');
  assertClose(p.yawDegrees, 30, 1e-6, 'yaw travels');
  assertEqual(p.parts.length, result.dynamicProps[0].parts.length, 'every part float travels');
  for (let i = 0; i < p.parts.length; i += 1) {
    assertClose(p.parts[i], Math.fround(result.dynamicProps[0].parts[i]), 1e-6, `part float ${i}`);
  }
});

test('empty world encodes a valid empty lump', () => {
  const decoded = decodeDynamicProps(encodeDynamicProps([]));
  assertEqual(decoded.props.length, 0, 'no dynamic props');
});

finish('worldDynamicProps');
