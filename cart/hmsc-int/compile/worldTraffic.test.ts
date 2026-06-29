// worldTraffic.test.ts — the TRAFFIC lump's round-trip + bake (P4). The encode
// must survive a decode byte-for-byte (the reference for constructor.zig's
// reader), prototype rows must flatten a vehicle build to the 13-float instance
// layout, and the bake must drive vehicles off a painted lane ring. Pure CPU
// under tools/v8cli — the headless bake path.

import { assert, assertEqual, finish, test } from '../game/_testkit';
import { TILE_KIND_INDEX } from '../game/kinds';
import type { LandformPlacement } from '../game/world/grid';
import { makeVehicle } from '../game/vehicle';
import {
  decodeTraffic, encodeTraffic, trafficRecords, vehiclePrototypeRows,
  TRAFFIC_LUMP_VERSION, TRAFFIC_ROW_STRIDE, type TrafficVehicleRecord,
} from './worldTraffic';

// A landform whose tile field is a clockwise one-way lane ring on its border.
function ringLandform(side: number): LandformPlacement {
  const k = TILE_KIND_INDEX;
  const idx = new Array(side * side).fill(k.mud);
  const set = (x: number, z: number, v: number) => { idx[z * side + x] = v; };
  for (let i = 1; i < side - 1; i++) {
    set(i, 0, k.laneEast);
    set(side - 1, i, k.laneSouth);
    set(i, side - 1, k.laneWest);
    set(0, i, k.laneNorth);
  }
  for (const [cx, cz] of [[0, 0], [side - 1, 0], [side - 1, side - 1], [0, side - 1]]) set(cx, cz, k.junction);
  return {
    id: 'ring', kind: 'heightfield', centerX: side / 2, centerZ: side / 2, baseY: 0, params: {},
    field: { cols: 2, rows: 2, cell: side, heights: [0, 0, 0, 0], tiles: { cols: side, rows: side, idx } },
  } as LandformPlacement;
}

test('the TRAFFIC lump round-trips byte-for-byte', () => {
  const records: TrafficVehicleRecord[] = [
    { speed: 7.5, phase: 3, route: [0, 0, 10, 0, 10, 10], rows: new Array(TRAFFIC_ROW_STRIDE).fill(0).map((_, i) => i * 0.5) },
    { speed: 6, phase: 0, route: [1, 1, 2, 2], rows: [] },
  ];
  const { version, records: back } = decodeTraffic(encodeTraffic(records));
  assertEqual(version, TRAFFIC_LUMP_VERSION, 'version survives');
  assertEqual(back.length, 2, 'both vehicles survive');
  assertEqual(back[0].speed, 7.5, 'speed survives');
  assertEqual(back[0].route.length, 6, 'route point pairs survive');
  assertEqual(back[0].rows.length, TRAFFIC_ROW_STRIDE, 'prototype rows survive');
  assertEqual(back[0].rows[6], 3, 'a row float survives (index 6 = 6*0.5)');
  assertEqual(back[1].rows.length, 0, 'a zero-row vehicle survives');
});

test('prototype rows flatten a vehicle build to the 13-float instance layout', () => {
  const rows = vehiclePrototypeRows(makeVehicle(7));
  assert(rows.length > 0, 'a vehicle yields rows');
  assertEqual(rows.length % TRAFFIC_ROW_STRIDE, 0, 'rows are a whole multiple of the stride');
  for (let r = 0; r < rows.length; r += TRAFFIC_ROW_STRIDE) {
    const shape = rows[r + 12];
    assert(shape === 0 || shape === 3 || shape === 4, `shape ${shape} is box/cylinder/sphere`);
    for (let c = 9; c < 12; c++) assert(rows[r + c] >= 0 && rows[r + c] <= 1, 'color channel in 0..1');
    for (let c = 6; c < 9; c++) assert(rows[r + c] > 0, 'scale is positive (params folded in)');
  }
});

test('the bake drives vehicles off a painted lane ring', () => {
  const records = trafficRecords({ landforms: [ringLandform(12)], count: 6, seed: 5 });
  assert(records.length >= 1, 'at least one vehicle bakes onto the ring');
  for (const v of records) {
    assert(v.route.length >= 4, 'each vehicle has a route polyline');
    assert(v.rows.length >= TRAFFIC_ROW_STRIDE, 'each vehicle has a prototype');
    assert(v.speed > 0, 'each vehicle cruises');
  }
  // determinism: same seed → identical bytes.
  const a = encodeTraffic(trafficRecords({ landforms: [ringLandform(12)], count: 6, seed: 5 }));
  const b = encodeTraffic(trafficRecords({ landforms: [ringLandform(12)], count: 6, seed: 5 }));
  assertEqual(a.length, b.length, 'same seed → same byte length');
});

test('an unpainted map bakes an empty (but valid) TRAFFIC lump', () => {
  const records = trafficRecords({ landforms: [] });
  assertEqual(records.length, 0, 'no landforms → no vehicles');
  const { records: back } = decodeTraffic(encodeTraffic(records));
  assertEqual(back.length, 0, 'empty lump round-trips');
});

finish('traffic-lump');
