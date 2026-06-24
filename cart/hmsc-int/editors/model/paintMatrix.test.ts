// Round-trip + compaction tests for the paint RLE codec (req_1783). Pure — no
// host doors. Proves: RGBA→matrix→RGBA is lossless for flat paint, RLE runs
// collapse, decode expands exactly, and a flat fill compresses hard.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { rgbaToMatrix, matrixToRgba, encodeMatrix, decodeMatrix, rgbaToEncoded, encodedToRgba } from './paintMatrix';

// build a tiny RGBA buffer from a per-pixel color fn (null = transparent)
function makeRgba(size: number, at: (x: number, y: number) => [number, number, number] | null): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const c = at(x, y); const p = (y * size + x) * 4;
    if (!c) continue;
    out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2]; out[p + 3] = 255;
  }
  return out;
}

test('a flat 4×4 fill → one palette entry, one run per row', () => {
  const rgba = makeRgba(4, () => [255, 0, 0]);
  const enc = rgbaToEncoded(rgba, 4);
  assertEqual(enc.palette.length, 1, 'one colour');
  assertEqual(enc.palette[0], '#ff0000', 'red interned');
  assertEqual(enc.rows.length, 4, 'four rows');
  assert(Array.isArray(enc.rows[0][0]) && (enc.rows[0][0] as any)[0] === 4, 'each row is a single 4-run');
});

test('RGBA → matrix → RGBA round-trips losslessly for flat paint', () => {
  const rgba = makeRgba(8, (x, y) => (x < 4 ? [10, 20, 30] : (y < 4 ? [200, 100, 50] : null)));
  const back = encodedToRgba(rgbaToEncoded(rgba, 8));
  assertEqual(back.length, rgba.length, 'same byte length');
  for (let i = 0; i < rgba.length; i += 1) assertEqual(back[i], rgba[i], `byte ${i} identical`);
});

test('transparent texels are null and survive the round-trip', () => {
  const rgba = makeRgba(4, (x) => (x === 0 ? null : [0, 0, 0]));
  const m = rgbaToMatrix(rgba, 4);
  assertEqual(m.pixels[0], null, 'first cell transparent');
  assert(m.pixels[1] != null, 'second cell opaque (black is a real colour)');
  const back = matrixToRgba(m);
  assertEqual(back[3], 0, 'transparent alpha stays 0');
  assertEqual(back[7], 255, 'opaque alpha is 255');
});

test('alpha below the cut is transparent, at/above is opaque', () => {
  const rgba = new Uint8Array([5, 5, 5, 127, 9, 9, 9, 128]); // 1×2
  const m = rgbaToMatrix(rgba, 1, 128); // size 1 → only reads first texel; check both via size 2 below
  void m;
  const m2 = rgbaToMatrix(rgba, 2, 128);
  assertEqual(m2.pixels[0], null, 'alpha 127 < cut → transparent');
  assert(m2.pixels[1] != null, 'alpha 128 ≥ cut → opaque');
});

test('decode expands runs to the exact flat array', () => {
  const enc = { size: 3, palette: ['#aabbcc'], rows: [[[3, 0]], [0, [2, null as any]], [null, null, 0]] };
  const m = decodeMatrix(enc as any);
  assertEqual(m.pixels.length, 9, 'nine cells');
  assertEqual(m.pixels[0], 0, 'row0 run of index 0');
  assertEqual(m.pixels[3], 0, 'row1 starts index 0');
  assertEqual(m.pixels[4], null, 'row1 transparent run');
  assertEqual(m.pixels[8], 0, 'row2 last cell index 0');
});

test('a mostly-flat image compresses far below its pixel count', () => {
  // 64×64 with a single 8×8 different block → runs dominate; entries << 4096
  const rgba = makeRgba(64, (x, y) => (x < 8 && y < 8 ? [1, 2, 3] : [9, 9, 9]));
  const enc = encodeMatrix(rgbaToMatrix(rgba, 64));
  const entries = enc.rows.reduce((n, r) => n + r.length, 0);
  assert(entries < 200, `flat image RLE entries (${entries}) far below 4096 cells`);
});

finish('editors/model/paintMatrix');
