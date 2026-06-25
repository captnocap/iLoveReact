// placementStats.test.ts — pins the / dashboard "most placed" census (req_1879).

import { assert, assertEqual, finish, test } from './game/_testkit';
import { reportPlacementCensus } from './placementStats';

test('an empty world has no placements', () => {
  const c = reportPlacementCensus([]);
  assertEqual(c.total, 0, 'no total');
  assertEqual(c.unique, 0, 'no unique');
  assertEqual(c.top.length, 0, 'no ranks');
});

test('tallies labels and ranks them by count', () => {
  const c = reportPlacementCensus(['Oak Tree', 'Oak Tree', 'Bench', 'Oak Tree', 'Bench', 'Lamp']);
  assertEqual(c.total, 6, 'six placed');
  assertEqual(c.unique, 3, 'three kinds');
  assertEqual(c.top[0].label, 'Oak Tree', 'most placed first');
  assertEqual(c.top[0].count, 3, 'three oaks');
  assertEqual(c.top[1].label, 'Bench', 'bench second');
  assertEqual(c.top[2].label, 'Lamp', 'lamp last');
});

test('ties break alphabetically (stable order)', () => {
  const c = reportPlacementCensus(['Zed', 'Alpha', 'Zed', 'Alpha']);
  assertEqual(c.top[0].label, 'Alpha', 'equal counts → alphabetical');
  assertEqual(c.top[1].label, 'Zed', 'Zed after Alpha');
});

test('topN caps the list', () => {
  const c = reportPlacementCensus(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 3);
  assertEqual(c.top.length, 3, 'capped to 3');
  assertEqual(c.unique, 7, 'unique still counts all');
});

test('blank labels fold into "unnamed"', () => {
  const c = reportPlacementCensus(['', '  ', 'Tree']);
  assert(c.top.some((r) => r.label === 'unnamed' && r.count === 2), 'two unnamed');
});

finish();
