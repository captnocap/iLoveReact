// groundResolve.test.ts - P4 tests for req_0699: markers are META, not ground
// (a spawn painted on a parking lot renders as parking in the game), and
// parking stall lines survive the compiled-floor bake.

import { encodeTileMap, makeTileMap, paintTile, tileKindIndex } from '../tileData';
import { groundKindAt, heightfieldTexelColor, MARKER_KIND_INDICES, PARKING_KIND_INDEX } from './heightfieldSurface';
import { floorHasParkingCells, floorNeedsHeightfieldRender } from '../compile/worldGeometry';
import type { ChunkFloor } from '../chunkFloor';
import { assert, assertClose, assertEqual, finish, test } from '../game/_testkit';

const PARKING = tileKindIndex('parking');
const VEHICLE_SPAWN = tileKindIndex('vehicleSpawn');
const SPAWN = tileKindIndex('spawn');
const MUD = tileKindIndex('mud');

function parkingLotWithMarker(markerIdx: number): number[] {
  const m = makeTileMap(8, 8);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) paintTile(m, x, y, PARKING);
  paintTile(m, 4, 4, markerIdx);
  return encodeTileMap(m);
}

function flatFloor(tileData: number[]): ChunkFloor {
  return { cx: 0, cz: 0, tileData, heights: [0, 0, 0, 0], hcols: 2, hrows: 2, hver: 1 };
}

test('registry → indices: parking and the marker set resolve from TILE_KINDS order', () => {
  assertEqual(PARKING_KIND_INDEX, PARKING, 'parking index agrees with the encoder');
  assert(MARKER_KIND_INDICES.includes(VEHICLE_SPAWN), 'vehicleSpawn is a marker');
  assert(MARKER_KIND_INDICES.includes(SPAWN), 'player spawn is a marker');
  assert(!MARKER_KIND_INDICES.includes(PARKING), 'parking is ground, not a marker');
});

test('groundKindAt: a marker cell resolves to the ground around it', () => {
  const data = parkingLotWithMarker(VEHICLE_SPAWN);
  const cellBase = 3 + (data[2] | 0) * 3;
  assertEqual(groundKindAt(data, cellBase, 8, 8, 4, 4), PARKING, 'marker → surrounding parking');
  assertEqual(groundKindAt(data, cellBase, 8, 8, 0, 0), PARKING, 'plain ground passes through');
  // A marker floating in the void has no ground to inherit — it keeps its kind.
  const lonely = makeTileMap(8, 8);
  paintTile(lonely, 4, 4, VEHICLE_SPAWN);
  const lonelyData = encodeTileMap(lonely);
  assertEqual(groundKindAt(lonelyData, 3 + (lonelyData[2] | 0) * 3, 8, 8, 4, 4), VEHICLE_SPAWN, 'no ground nearby → marker kind survives');
  assertEqual(groundKindAt(lonelyData, 3 + (lonelyData[2] | 0) * 3, 8, 8, 0, 0), -1, 'empty stays empty');
});

test('the baked floor texel under a marker is the ground colour, never orange', () => {
  const data = parkingLotWithMarker(VEHICLE_SPAWN);
  // Texel at the marker cell's centre (cell 4,4 of 8) vs a plain parking cell.
  const [mr, mg, mb] = heightfieldTexelColor(data, 4.5 / 8, 4.5 / 8, );
  const [pr, pg, pb] = heightfieldTexelColor(data, 4.5 / 8, 2.5 / 8);
  assertClose(mr, pr, 1e-9, 'marker texel r == parking texel r');
  assertClose(mg, pg, 1e-9, 'marker texel g == parking texel g');
  assertClose(mb, pb, 1e-9, 'marker texel b == parking texel b');
  assert(mr < 0.5, 'nothing orange about it');
});

test('parking stall lines land in the bake: white at 3m bay boundaries', () => {
  const data = parkingLotWithMarker(VEHICLE_SPAWN);
  const [lr, lg, lb] = heightfieldTexelColor(data, 3 / 8, 2.5 / 8); // on the x=3 bay line
  const [br] = heightfieldTexelColor(data, 4.5 / 8, 2.5 / 8); // mid-bay
  assert(lr > 0.7 && lg > 0.7 && lb > 0.7, `bay boundary is painted white (got ${lr.toFixed(2)},${lg.toFixed(2)},${lb.toFixed(2)})`);
  assert(br < 0.3, 'mid-bay stays asphalt-dark');
});

test('flat parking floors route through the textured heightfield bake', () => {
  const parkingFloor = flatFloor(parkingLotWithMarker(VEHICLE_SPAWN));
  assert(floorHasParkingCells(parkingFloor), 'parking cells detected');
  assert(floorNeedsHeightfieldRender(parkingFloor), 'parking floor takes the textured path');
  const mudMap = makeTileMap(8, 8);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) paintTile(mudMap, x, y, MUD);
  const mudFloor = flatFloor(encodeTileMap(mudMap));
  assert(!floorNeedsHeightfieldRender(mudFloor), 'plain flat ground keeps the cheap slab path');
});

finish('render3d/groundResolve');
