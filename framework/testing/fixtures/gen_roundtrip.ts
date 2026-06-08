// gen_roundtrip.ts — emits the canonical mapfile round-trip fixture.
//
// This is the TS WRITER side of the keystone cross-language proof: it builds a
// real RJMP lump container with the production workspace codec (lumps.ts +
// rle.ts), then prints it as base64 to stdout. `rjit game verify` captures that
// and writes framework/testing/fixtures/mapfile_roundtrip.b64; the Zig reader
// test (framework/testing/unit/world_mapfile.zig) decodes the SAME tape and
// asserts byte/value identity. The known values below are the contract — they
// are mirrored in RLE_FORMAT.md §4 and in the Zig test's expectations.
//
// Run (bundled): tools/esbuild ... -> tools/v8cli <bundle>  (see cli/commands/game.ts)

import {
  writeLumpContainer,
  encodeBinaryRleGrid,
  textBytes,
  bytesToBase64,
  MAP_LUMP,
} from '../../../runtime/workspace/lumps';
import { encodeGrid } from '../../../runtime/workspace/rle';

// STRINGS: a tiny tab/newline string table.
const strings = '0\troad\n1\tgrass\n2\twater\n';

// TILES: 4×3 grid of tile indices, with a null (absent) cell at index 10.
const tiles = encodeGrid([0, 0, 1, 1, 1, 1, 1, 2, 2, 2, null, 2], 4, 3);

// HEIGHTS: 4×3 grid of small quantized heights, null at index 11.
const heights = encodeGrid([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 3, null], 4, 3);

const container = writeLumpContainer([
  { type: MAP_LUMP.STRINGS, encoding: 'text', data: textBytes(strings) },
  { type: MAP_LUMP.TILES, encoding: 'rle16', data: encodeBinaryRleGrid(tiles, 16) },
  { type: MAP_LUMP.HEIGHTS, encoding: 'rle8', data: encodeBinaryRleGrid(heights, 8) },
]);

const b64 = bytesToBase64(container);
const emit = (globalThis as any).print ?? console.log;
emit(b64);
