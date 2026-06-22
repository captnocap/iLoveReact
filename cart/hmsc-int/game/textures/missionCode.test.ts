// missionCode.test.ts — the mission-code codec is a real, round-trippable code
// (req_1620/1621): a key bakes to a module grid and decodes straight back, every
// generated decal validates, and the packed shader data[] stays under the 64-float
// cap. Uniqueness (distinct missions → distinct codes) is what makes a code
// "bound to something tangible".

import { assert, assertEqual, finish, test } from '../_testkit';
import { validateDecalDoc, type DecalRectNode } from './decal';
import {
  encodeMissionModules,
  decodeMissionModules,
  missionCodeData,
  missionCodeDoc,
  missionCodeDecalId,
} from './missionCode';

const KEYS = ['delivery-gig', 'a', 'protect-the-stash', 'héist-café-99', 'x'.repeat(60)];

test('encode → decode round-trips every key', () => {
  for (const key of KEYS) {
    const { size, cells } = encodeMissionModules(key);
    assertEqual(decodeMissionModules(size, cells), key, `round-trip "${key.slice(0, 16)}"`);
  }
});

test('distinct keys produce distinct grids and distinct shader data', () => {
  const a = missionCodeData('delivery-gig');
  const b = missionCodeData('delivery-job');
  assert(JSON.stringify(a) !== JSON.stringify(b), 'one-char key change changes the packed code');
  const ga = encodeMissionModules('alpha');
  const gb = encodeMissionModules('alpha'); // determinism
  assertEqual(JSON.stringify([...ga.cells]), JSON.stringify([...gb.cells]), 'same key is deterministic');
});

test('a flipped data module fails the CRC (decodes to null, never a wrong mission)', () => {
  const { size, cells } = encodeMissionModules('delivery-gig');
  // first non-reserved cell holds a payload bit (version byte) — flip it
  let flipped = -1;
  for (let y = 0; y < size && flipped < 0; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const corner = 8;
      const reserved = (x < corner && y < corner) || (x >= size - corner && y < corner) || (x < corner && y >= size - corner);
      if (!reserved) { flipped = y * size + x; break; }
    }
  }
  cells[flipped] ^= 1;
  assertEqual(decodeMissionModules(size, cells), null, 'corrupted code rejected');
});

test('decode rejects a wrong grid size or length', () => {
  const { cells } = encodeMissionModules('delivery-gig');
  assertEqual(decodeMissionModules(22, cells), null, 'non-allowed size → null');
  assertEqual(decodeMissionModules(21, new Uint8Array(10)), null, 'wrong cell count → null');
});

test('finder patterns are present in three corners (not the fourth)', () => {
  const { size, cells } = encodeMissionModules('delivery-gig');
  const at = (x: number, y: number) => cells[y * size + x];
  // each finder's outer corner module is dark; its inner-ring neighbour is light
  assertEqual(at(0, 0), 1, 'TL finder corner set');
  assertEqual(at(size - 1, 0), 1, 'TR finder corner set');
  assertEqual(at(0, size - 1), 1, 'BL finder corner set');
  assertEqual(at(1, 1), 0, 'TL finder inner ring clear');
});

test('the generated DecalDoc validates and stays under the fillData cap', () => {
  const doc = missionCodeDoc('delivery-gig');
  const valid = validateDecalDoc(doc);
  assert(valid !== null, 'mission-code DecalDoc passes strict boundary validation');
  assertEqual(doc.nodes.length, 1, 'a code is exactly one node (under MAX_NODES)');
  const node = doc.nodes[0] as DecalRectNode;
  assertEqual(node.fillShaderId, 'mission-code', 'node carries the mission-code shader fill');
  assert((node.fillData?.length ?? 0) <= 64, `fillData is ${node.fillData?.length} floats (cap 64)`);
  assert((node.fillData?.length ?? 0) > 11, 'fillData has header + at least one packed word');
});

test('the stable decal id is namespaced by mission key', () => {
  assertEqual(missionCodeDecalId('delivery-gig'), 'mission-code:delivery-gig', 'id is mission-code:<key>');
});

finish('missionCode');
