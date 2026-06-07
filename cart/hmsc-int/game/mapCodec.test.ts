// mapCodec.test.ts — P4 TS-side tests for the platform mapfile codec.

import {
  MAP_LUMP,
  bytesText,
  decodeBinaryRleGrid,
  decodeGrid,
  dequantizeHeightfield,
  encodeBinaryRleGrid,
  encodeGrid,
  findLump,
  quantizeHeightfield,
  readLumpContainer,
  textBytes,
  writeLumpContainer,
} from '@reactjit/workspace';
import { assert, assertClose, assertEqual, finish, test } from './_testkit';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

test('lump container write-read-write is byte-identical', () => {
  const first = writeLumpContainer([
    { type: MAP_LUMP.STRINGS, encoding: 'text', data: textBytes('0 road\n1 sidewalk\n') },
    { type: MAP_LUMP.ENTITIES, encoding: 'text', data: textBytes('hmsc.state_json_base64=AAAA\n') },
  ]);
  const records = readLumpContainer(first);
  const second = writeLumpContainer(records.map((record) => ({
    type: record.type,
    encoding: record.encoding,
    data: record.data,
  })));
  assert(sameBytes(first, second), 'container round-trip must be byte-identical');
  assertEqual(bytesText(findLump(records, MAP_LUMP.STRINGS)!.data), '0 road\n1 sidewalk\n', 'text lump survives');
});

test('reader skips future lump types when given a known-type set', () => {
  const futureType = 0x7fff_fff0;
  const map = writeLumpContainer([
    { type: MAP_LUMP.TILES, encoding: 'rle8', data: encodeBinaryRleGrid(encodeGrid([0, 0, 1, null], 2, 2), 8) },
    { type: futureType, encoding: 'raw', data: new Uint8Array([1, 2, 3, 4]) },
  ]);
  const records = readLumpContainer(map, { knownTypes: new Set([MAP_LUMP.TILES]) });
  assertEqual(records.length, 1, 'old reader sees only known lumps');
  assertEqual(records[0]!.type, MAP_LUMP.TILES, 'known lump remains readable');
});

test('binary row-RLE transcodes through the JSON row-RLE source shape', () => {
  const values = [
    1, 1, 1, null, null,
    2, 3, 3, 3, 2,
    null, null, null, null, null,
  ];
  const source = encodeGrid(values, 5, 3);
  const payload8 = encodeBinaryRleGrid(source, 8);
  const restored8 = decodeBinaryRleGrid(payload8, 8);
  assertEqual(JSON.stringify(decodeGrid(restored8)), JSON.stringify(values), 'rle8 restores source grid values');

  const wide = encodeGrid([0, 511, null, 511], 2, 2);
  const payload16 = encodeBinaryRleGrid(wide, 16);
  const restored16 = decodeBinaryRleGrid(payload16, 16);
  assertEqual(JSON.stringify(decodeGrid(restored16)), JSON.stringify([0, 511, null, 511]), 'rle16 restores wide values');
});

test('heightfields quantize to u16 and restore within scale error', () => {
  const heights = [0, 0.5, 1, 1.5, 2, 2.5];
  const q = quantizeHeightfield(heights, 3, 2);
  const restored = dequantizeHeightfield(q);
  for (let i = 0; i < heights.length; i += 1) {
    assertClose(restored[i]!, heights[i]!, q.scale + 1e-9, `height ${i} survives quantization`);
  }
});

finish('map-codec');
