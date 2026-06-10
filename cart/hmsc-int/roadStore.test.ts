// roadStore.test.ts — road persistence round-trip (P4): strokes + the
// undercoat survive serializeMap → deserializeMap, undercoat prior-indices
// remap through the saved legend by NAME (the same law as the tile grids),
// and pre-road snapshots (no roads field) load clean.

import { assert, assertEqual, finish, test } from './game/_testkit';
import { TILE_KINDS } from './world/tileKinds';
import { serializeMap, deserializeMap, emptyMap } from './mapStore';
import { cellKey, type RoadStroke } from './roadData';

const ROAD: RoadStroke = {
  id: 'r_3',
  points: [{ gx: 10, gz: 10 }, { gx: 30, gz: 10 }],
  profile: { lanesF: 1, lanesB: 1, sidewalks: true },
};

test('road strokes and the undercoat survive a save/load round-trip', () => {
  const world = emptyMap();
  world.roads = [ROAD];
  const asphalt = TILE_KINDS.indexOf('asphalt');
  world.roadUnder = new Map([
    [cellKey(10, 10), asphalt],
    [cellKey(11, 10), -1],
  ]);

  const snap = serializeMap(world);
  assertEqual(snap.roads?.length, 1, 'stroke serialized');
  assertEqual(snap.roadUnder?.length, 2, 'undercoat serialized');

  const back = deserializeMap(JSON.parse(JSON.stringify(snap)));
  assertEqual(back.roads?.length, 1, 'stroke restored');
  const r = back.roads![0]!;
  assertEqual(r.id, 'r_3', 'id survives');
  assertEqual(r.points.length, 2, 'points survive');
  assertEqual(r.points[1]!.gx, 30, 'point coords survive');
  assertEqual(r.profile.lanesF, 1, 'profile survives');
  assert(r.profile.sidewalks, 'sidewalk flag survives');
  assertEqual(back.roadUnder?.get(cellKey(10, 10)), asphalt, 'undercoat index survives (legend remap by name)');
  assertEqual(back.roadUnder?.get(cellKey(11, 10)), -1, 'empty undercoat cell survives');
});

test('a pre-road snapshot (no roads field) loads with empty road state', () => {
  const snap = serializeMap(emptyMap());
  delete (snap as any).roads;
  delete (snap as any).roadUnder;
  const back = deserializeMap(JSON.parse(JSON.stringify(snap)));
  assertEqual(back.roads?.length ?? 0, 0, 'no roads');
  assertEqual(back.roadUnder?.size ?? 0, 0, 'no undercoat');
});

test('an unknown undercoat kind degrades to empty, never a wrong index', () => {
  const world = emptyMap();
  world.roads = [ROAD];
  world.roadUnder = new Map([[cellKey(5, 5), TILE_KINDS.indexOf('sand')]]);
  const snap = serializeMap(world);
  // Simulate the saved legend naming a kind that no longer exists globally.
  const mutated = JSON.parse(JSON.stringify(snap));
  mutated.tileLegend[TILE_KINDS.indexOf('sand')] = 'gone_kind';
  const back = deserializeMap(mutated);
  assertEqual(back.roadUnder?.get(cellKey(5, 5)), -1, 'unknown kind degrades to empty');
});

finish('roadStore');
