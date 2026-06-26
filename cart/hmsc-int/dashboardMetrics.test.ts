// dashboardMetrics.test.ts — pins the playful / dashboard metrics.

import { assert, assertClose, assertEqual, finish, test } from './game/_testkit';
import { CHUNK_TILES } from './chunks';
import { TILE_UNITS } from './heightData';
import { reportDashboardFunMetrics, type DashboardFootprint } from './dashboardMetrics';
import type { EditEvent } from './editLog';

function fp(label: string, x: number, z: number, footW = 1, footD = 1): DashboardFootprint {
  return {
    label,
    footW,
    footD,
    gx: (x - CHUNK_TILES / 2) * TILE_UNITS,
    gy: (z - CHUNK_TILES / 2) * TILE_UNITS,
  };
}

test('finds the densest chunk and its dominant label', () => {
  const r = reportDashboardFunMetrics({
    footprints: [
      fp('Stop Sign', 10, 10),
      fp('Stop Sign', 20, 20),
      fp('Bench', 30, 30),
      fp('Tree', CHUNK_TILES + 5, 5),
    ],
    now: 1000,
  });
  assert(r.densest !== null, 'has densest region');
  assertEqual(r.densest!.cx, 0, 'densest chunk x');
  assertEqual(r.densest!.cz, 0, 'densest chunk z');
  assertEqual(r.densest!.count, 3, 'three placements in chunk');
  assertEqual(r.densest!.uniqueKinds, 2, 'two labels in chunk');
  assertEqual(r.densest!.topLabel, 'Stop Sign', 'dominant label');
});

test('reports the largest footprint by authored area', () => {
  const r = reportDashboardFunMetrics({
    footprints: [fp('Kiosk', 0, 0, 4, 4), fp('Garage', 0, 0, 9, 7)],
    now: 1000,
  });
  assert(r.largest !== null, 'has largest footprint');
  assertEqual(r.largest!.label, 'Garage', 'largest label');
  assertEqual(r.largest!.areaM2, 63, 'area is width * depth');
});

test('selects the tallest build peak', () => {
  const r = reportDashboardFunMetrics({
    footprints: [],
    buildPeaks: [
      { label: 'Shop', x: 10, z: 20, heightMeters: 3, topY: 3, pieces: 4 },
      { label: 'Tower', x: 30, z: 40, heightMeters: 12, topY: 14, pieces: 9 },
    ],
    now: 1000,
  });
  assert(r.tallest !== null, 'has tallest peak');
  assertEqual(r.tallest!.label, 'Tower', 'tallest label');
  assertEqual(r.tallest!.topY, 14, 'keeps top y');
});

test('edit tempo ignores map/camera noise and reports the dominant category', () => {
  const now = 10 * 60 * 1000;
  const events: EditEvent[] = [
    { cat: 'map', text: 'opened main', t: now - 2 * 60 * 1000 },
    { cat: 'camera', text: 'camera moved', t: now - 90 * 1000 },
    { cat: 'tile', text: 'painted asphalt', t: now - 60 * 1000 },
    { cat: 'tile', text: 'painted concrete', t: now - 30 * 1000 },
    { cat: 'object', text: 'placed sign', t: now },
  ];
  const r = reportDashboardFunMetrics({ footprints: [], events, now });
  assert(r.tempo !== null, 'has tempo');
  assertEqual(r.tempo!.eventCount, 3, 'map/camera filtered out');
  assertEqual(r.tempo!.category, 'tile', 'dominant category');
  assertClose(r.tempo!.editsPerMinute, 3, 1e-9, 'three edits across one minute');
});

finish('dashboardMetrics');
