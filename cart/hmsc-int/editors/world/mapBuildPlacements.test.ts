// mapBuildPlacements tests — MAPBUILD-0608: the 2D map place mode reads and
// writes the SAME semantic build-piece stream as Creative Build.

import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';
import { CHUNK_TILES } from '../../chunks';
import { TILE_UNITS } from '../../heightData';
import { GAME_BUILD, piecesForMap, worldStream, type WorldEvent, type WorldStreamState } from '../../game';
import { buildWorldToGraph, graphToBuildWorld, mapBuildFootprints, mapBuildPlaceable } from '../../mapBuildPlacements';

function fold(events: WorldEvent[]): WorldStreamState {
  let state = worldStream.initial();
  for (const event of events) state = worldStream.apply(state, event);
  return state;
}

test('MAPBUILD-0608: map place mode stamps prefab buildings into the shared world stream', () => {
  const prefab = GAME_BUILD.prefabs.get('prefab.motelRoom');
  const origin = graphToBuildWorld(TILE_UNITS * 2, TILE_UNITS * 4);
  const state = fold([
    { kind: 'prefabStamped', mapName: 'city-map', prefabId: prefab.id, origin, yawDegrees: 0 },
  ]);
  const pieces = piecesForMap(state, 'city-map');
  assertEqual(pieces.length, prefab.pieces.length, 'the map stamp materializes as semantic build pieces');
  assertEqual(piecesForMap(state, 'other-map').length, 0, 'the stamp is scoped to the active map');

  const footprints = mapBuildFootprints(pieces);
  assertEqual(footprints.length, 1, 'the 2D map sees the placed building as one footprint');
  assertEqual(footprints[0].pieceIds.length, pieces.length, 'delete targets the same bp_* pieces the game reads');
  assert(footprints[0].pieceIds.every((id) => pieces.some((piece) => piece.id === id)), 'footprint ids are stream piece ids');
});

test('MAPBUILD-0608: deleting a map building removes the same pieces from the game stream', () => {
  const prefab = GAME_BUILD.prefabs.get('prefab.motelRoom');
  let state = fold([
    { kind: 'prefabStamped', mapName: 'city-map', prefabId: prefab.id, origin: { x: 10, y: 0, z: 10 }, yawDegrees: 0 },
  ]);
  const footprint = mapBuildFootprints(piecesForMap(state, 'city-map'))[0];
  for (const id of footprint.pieceIds) state = worldStream.apply(state, { kind: 'pieceRemoved', mapName: 'city-map', id });
  assertEqual(piecesForMap(state, 'city-map').length, 0, 'game/test mode sees the deleted building gone');
});

test('MAPBUILD-0608: canvas graph coordinates and prefab footprints share one lattice', () => {
  const world = graphToBuildWorld(0, 0);
  assertClose(world.x, CHUNK_TILES / 2, 1e-9, 'graph origin maps to the existing map tile lattice x');
  assertClose(world.z, CHUNK_TILES / 2, 1e-9, 'graph origin maps to the existing map tile lattice z');
  const graph = buildWorldToGraph(world.x + 3, world.z + 6);
  assertClose(graph.gx, 3 * TILE_UNITS, 1e-9, 'world-to-graph x is exact');
  assertClose(graph.gy, 6 * TILE_UNITS, 1e-9, 'world-to-graph z is exact');

  const prefab = GAME_BUILD.prefabs.get('prefab.motelRoom');
  const placeable = mapBuildPlaceable(prefab);
  assertEqual(placeable.cat, 'building', 'building prefabs arm through the existing place brush');
  assert(placeable.footW > 0 && placeable.footD > 0, 'the map brush has a real footprint');
});

finish();
