// uvDedup.test.ts — pins the UV island shape-key + grouping (req_1255). A face's
// island is min-normalized, so congruence reduces to "same point set"; the key must
// be invariant to loop start + winding but NOT to a 90° spatial rotation (the v1
// bound that keeps placement transform-free). Pure + headless.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { faceShapeKey, groupByShape } from './uvDedup';
import type { V2 } from './editMesh';

const rect = (w: number, h: number): V2[] => [[0, 0], [w, 0], [w, h], [0, h]];

test('congruent squares hash equal regardless of loop start + winding', () => {
  assertEqual(faceShapeKey(rect(1, 1)), faceShapeKey([[1, 0], [1, 1], [0, 1], [0, 0]]), 'loop start does not change the key');
  assertEqual(faceShapeKey(rect(1, 1)), faceShapeKey([[0, 0], [0, 1], [1, 1], [1, 0]]), 'reverse winding does not change the key');
});

test('different shapes hash differently; w×h vs h×w stay distinct (v1 bound)', () => {
  assert(faceShapeKey(rect(2, 1)) !== faceShapeKey(rect(1, 1)), '2x1 != 1x1');
  assert(faceShapeKey(rect(2, 1)) !== faceShapeKey(rect(1, 2)), '2x1 != 1x2 (no spatial rotation in v1)');
  assert(faceShapeKey(rect(1, 1)).startsWith('4|'), 'key encodes the corner count');
});

test('float noise within the quantum collapses to one key', () => {
  assertEqual(faceShapeKey([[0, 0], [1.0001, 0], [1.0001, 1], [0, 1]]), faceShapeKey(rect(1, 1)), 'sub-quantum jitter hashes equal');
});

test('groupByShape buckets congruent items; first = rep; order stable', () => {
  const items = [rect(1, 1), rect(2, 1), rect(1, 1), rect(2, 1), rect(3, 3)];
  const groups = groupByShape(items, (x) => x);
  assertEqual(groups.length, 3, 'three distinct shapes');
  assertEqual(groups[0].rep, 0, 'first 1x1 is its representative');
  assertEqual(JSON.stringify(groups[0].members), JSON.stringify([0, 2]), '1x1 members = indices 0 and 2');
  assertEqual(JSON.stringify(groups[1].members), JSON.stringify([1, 3]), '2x1 members = indices 1 and 3');
  assertEqual(JSON.stringify(groups[2].members), JSON.stringify([4]), '3x3 is a singleton');
});

finish('uvDedup');
