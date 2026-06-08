// gen_gamefile.ts — emits the canonical full game-file round-trip fixture.
//
// The TS WRITER side of the step-2 cross-language proof: it builds a complete
// game file — all THREE streams (logic / map / skins) plus a content-addressed
// asset vocabulary — with the production workspace writer (gamefile.ts +
// lumps.ts + rle.ts + sha256.ts), then prints it as base64. `rjit game verify`
// captures it to framework/testing/fixtures/gamefile_roundtrip.b64; the Zig
// reader test (framework/testing/unit/world_gamefile.zig) ingests the SAME tape,
// installs + validates every asset, and resolves every reference. The known
// values below are the contract — mirrored in RLE_FORMAT.md §7 and the Zig test.

import { writeLumpContainer, encodeBinaryRleGrid, textBytes, bytesToBase64, MAP_LUMP } from '../../../runtime/workspace/lumps';
import { encodeGrid } from '../../../runtime/workspace/rle';
import { writeGameFile, type GameAsset } from '../../../runtime/workspace/gamefile';

const bytes = (text: string): Uint8Array => textBytes(text);

// ── asset vocabulary (content-addressed; each blob's sha256 is its address) ──
const assets: GameAsset[] = [
  { key: 100, kind: 1, bytes: bytes('building:tower\n') },
  { key: 101, kind: 2, bytes: encodeBinaryRleGrid(encodeGrid([0, 1, 1, 0], 2, 2), 8) },
  { key: 102, kind: 3, bytes: bytes('skin:red\n') },
];

// ── the game-map stream: a nested RJMP map container (reuses step-1 shape) ──
const mapStrings = '0\troad\n1\tgrass\n';
const mapTiles = encodeGrid([0, 0, 1, 1, 1, 1], 3, 2); // 3×2
const mapHeights = encodeGrid([2, 2, 2, 3, 3, null], 3, 2);
const mapContainer = writeLumpContainer([
  { type: MAP_LUMP.STRINGS, encoding: 'text', data: bytes(mapStrings) },
  { type: MAP_LUMP.TILES, encoding: 'rle16', data: encodeBinaryRleGrid(mapTiles, 16) },
  { type: MAP_LUMP.HEIGHTS, encoding: 'rle8', data: encodeBinaryRleGrid(mapHeights, 8) },
]);

const file = writeGameFile({
  logic: { refs: [100], data: bytes('ticks=45\nkind.cop.disposition=hostile\n') },
  map: { refs: [100, 101], data: mapContainer },
  skins: { refs: [102], data: bytes('dupe:car01\n') },
  assets,
});

const emit = (globalThis as any).print ?? console.log;
emit(bytesToBase64(file));
