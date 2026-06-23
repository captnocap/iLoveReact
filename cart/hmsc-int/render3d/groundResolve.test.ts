// groundResolve.test.ts - P4 tests for req_0699: markers are META, not ground
// (a spawn painted on a parking lot renders as parking in the game), and
// parking stall lines survive the compiled-floor bake.

import { encodeTileMap, makeTileMap, paintTile, tileKindIndex } from '../tileData';
import { groundKindAt, heightfieldTexelColor, MARKER_KIND_INDICES, PARKING_KIND_INDEX } from './heightfieldSurface';
import { floorHasParkingCells, floorNeedsHeightfieldRender } from '../compile/worldGeometry';
import type { ChunkFloor } from '../chunkFloor';
import { assert, assertClose, assertEqual, finish, test } from '../game/_testkit';

const PARKING = tileKindIndex('parking');
const PARKING_CROSS = tileKindIndex('parkingCross');
const VEHICLE_SPAWN = tileKindIndex('vehicleSpawn');
const SPAWN = tileKindIndex('spawn');
const MUD = tileKindIndex('mud');

function parkingLotWithMarker(markerIdx: number): number[] {
  const m = makeTileMap(8, 8);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) paintTile(m, x, y, PARKING);
  paintTile(m, 4, 4, markerIdx);
  return encodeTileMap(m);
}

function lotOf(kindIdx: number): number[] {
  const m = makeTileMap(8, 8);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) paintTile(m, x, y, kindIdx);
  return encodeTileMap(m);
}

// The brightest texel within ±0.5 tiles of (px,py), sampled the way the bake
// does (4 px/tile texel centres), scanning along the given axis.
function brightestNearLine(data: number[], axis: 'x' | 'z', linePos: number, fixedTile: number): number {
  const cols = data[0] | 0;
  const rows = data[1] | 0;
  const scale = 4;
  let best = 0;
  const span = axis === 'x' ? cols * scale : rows * scale;
  for (let i = 0; i < span; i += 1) {
    const p = (i + 0.5) / scale;
    if (Math.abs(p - linePos) > 0.5) continue;
    const u = axis === 'x' ? p / cols : (fixedTile + 0.5) / cols;
    const v = axis === 'x' ? (fixedTile + 0.5) / rows : p / rows;
    best = Math.max(best, heightfieldTexelColor(data, u, v)[0]);
  }
  return best;
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

test('parking stall lines survive the REAL 4 px/tile bake sampling (req_0704)', () => {
  // The bug: the bake samples at texel centres (px = 0.125, 0.375, …), never
  // exactly on a 3-tile bay line, so a thin line falls between texels and
  // vanishes. This test samples the way heightfieldTextureBytes actually does —
  // texel centres at scale px/tile — and asserts a white texel lands at the bay
  // boundary. Sampling exactly on the line (the old test) hid the bug.
  const data = parkingLotWithMarker(VEHICLE_SPAWN);
  const cols = data[0] | 0;
  const scale = 4; // HEIGHTFIELD_TEXTURE_PIXELS_PER_TILE
  const width = cols * scale;
  const row = (px: number) => heightfieldTexelColor(data, px / cols, 2.5 / 8);
  // Walk the real texel grid; find the brightest texel within ±0.5 tile of the
  // px=3 bay line (mirrors the bake's row scan around a boundary).
  let bestAtLine = 0;
  let midBay = 1;
  for (let x = 0; x < width; x += 1) {
    const px = (x + 0.5) / scale; // bake's px for texel x
    const [r] = row(px);
    if (Math.abs(px - 3) <= 0.5) bestAtLine = Math.max(bestAtLine, r);
    if (Math.abs(px - 1.5) <= 0.2) midBay = Math.min(midBay, r); // mid-bay sample
  }
  assert(bestAtLine > 0.7, `a baked texel at the bay line is white (brightest=${bestAtLine.toFixed(2)})`);
  assert(midBay < 0.3, `mid-bay stays asphalt-dark (got ${midBay.toFixed(2)})`);
});

test('flat parking floors route through the textured heightfield bake', () => {
  const parkingFloor = flatFloor(parkingLotWithMarker(VEHICLE_SPAWN));
  assert(floorHasParkingCells(parkingFloor), 'parking cells detected');
  assert(floorNeedsHeightfieldRender(parkingFloor), 'parking floor takes the textured path');
  const mudMap = makeTileMap(8, 8);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) paintTile(mudMap, x, y, MUD);
  const mudFloor = flatFloor(encodeTileMap(mudMap));
  // FORMULAFLOOR-0615: plain flat ground now ALSO renders through the per-fragment
  // formula (a cheap flat 2×2 mesh + the cell stream), so it wears the same grain
  // + slab joints as the editor /test view — no separate flat box-slab look.
  assert(floorNeedsHeightfieldRender(mudFloor), 'plain flat ground renders through the formula path too');
});

test('parkingCross rotates the bay lines 90° — perpendicular to parking (req_0710)', () => {
  const park = lotOf(PARKING);
  const cross = lotOf(PARKING_CROSS);
  // parking draws a VERTICAL stripe (line of constant X) at px=3: a scan ACROSS
  // X at a mid-Z row hits white; the same scan on parkingCross stays dark
  // (its lines run the other way).
  assert(brightestNearLine(park, 'x', 3, 1) > 0.7, 'parking has a bay line along the X axis');
  assert(brightestNearLine(cross, 'x', 3, 1) < 0.3, 'parkingCross has NO line along X there (rotated away)');
  // parkingCross draws a HORIZONTAL stripe (line of constant Z) at pz=3: a scan
  // ACROSS Z hits white; plain parking stays dark on that same scan.
  assert(brightestNearLine(cross, 'z', 3, 1) > 0.7, 'parkingCross has a bay line along the Z axis');
  assert(brightestNearLine(park, 'z', 3, 1) < 0.3, 'parking has NO line along Z (its lines run across X)');
});

test('a parkingCross-only flat floor still routes through the textured bake', () => {
  const crossFloor = flatFloor(lotOf(PARKING_CROSS));
  assert(floorHasParkingCells(crossFloor), 'parkingCross cells detected');
  assert(floorNeedsHeightfieldRender(crossFloor), 'parkingCross floor takes the textured path');
});

finish('render3d/groundResolve');
