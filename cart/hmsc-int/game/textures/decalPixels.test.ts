// game/textures/decalPixels tests — the decal pixel bake's codec (DECALPIX-0610).
// The SAME pixel-PackBits stream is decoded by constructor.zig at world
// construct, so the encoder's edge behavior (max runs, literal stretches,
// malformed-stream rejection) must be pinned here, not just eyeballed.

import { assert, assertEqual, finish, test } from '../_testkit';
import { emptyDecalDoc } from './decal';
import {
  decalDocHash,
  decalPixelsRgba,
  decodePixelRle,
  encodePixelRle,
  packDecalPixels,
  validateDecalPixels,
} from './decalPixels';

function rgbaOf(pixels: number[][]): Uint8Array {
  const out = new Uint8Array(pixels.length * 4);
  pixels.forEach((p, i) => out.set(p, i * 4));
  return out;
}

function assertBytesEqual(a: Uint8Array, b: Uint8Array, label: string): void {
  assertEqual(a.length, b.length, `${label} length`);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) throw new Error(`${label}: byte ${i} differs (${a[i]} != ${b[i]})`);
  }
}

test('flat image collapses to repeat runs and round-trips', () => {
  const flat = rgbaOf(Array.from({ length: 300 }, () => [200, 30, 30, 255]));
  const rle = encodePixelRle(flat);
  // 300 identical pixels = 3 max-run (128+128+44) repeat records of 5 bytes.
  assertEqual(rle.length, 15, 'flat 300px compresses to 3 repeat records');
  assertBytesEqual(decodePixelRle(rle, 300)!, flat, 'flat round-trip');
});

test('all-distinct image round-trips as literals', () => {
  const distinct = rgbaOf(Array.from({ length: 200 }, (_, i) => [i & 255, (i * 7) & 255, (i * 13) & 255, 255]));
  const rle = encodePixelRle(distinct);
  assertBytesEqual(decodePixelRle(rle, 200)!, distinct, 'distinct round-trip');
});

test('mixed runs and literals round-trip', () => {
  const mixed = rgbaOf([
    [1, 1, 1, 255], [1, 1, 1, 255], [1, 1, 1, 255],
    [9, 8, 7, 255],
    [5, 5, 5, 128], [5, 5, 5, 128],
    [2, 4, 6, 255], [200, 100, 50, 25],
  ]);
  const rle = encodePixelRle(mixed);
  assertBytesEqual(decodePixelRle(rle, 8)!, mixed, 'mixed round-trip');
});

test('malformed streams decode to null, never partial pixels', () => {
  const good = encodePixelRle(rgbaOf(Array.from({ length: 10 }, () => [7, 7, 7, 255])));
  assertEqual(decodePixelRle(good.subarray(0, good.length - 2), 10), null, 'truncated stream rejected');
  const padded = new Uint8Array(good.length + 3);
  padded.set(good);
  assertEqual(decodePixelRle(padded, 10), null, 'trailing garbage rejected');
  assertEqual(decodePixelRle(good, 11), null, 'pixel-count overrun rejected');
});

test('pack → validate → rgba round-trips through the stored payload shape', () => {
  const doc = emptyDecalDoc(4, 3);
  const rgba = rgbaOf(Array.from({ length: 12 }, (_, i) => [i * 9, 255 - i, 30, 255]));
  const packed = packDecalPixels(doc, 4, 3, rgba);
  assert(packed !== null, 'pack accepts a matching w*h*4 buffer');
  assertEqual(packed!.docHash, decalDocHash(doc), 'payload carries the doc hash');
  const revalidated = validateDecalPixels(JSON.parse(JSON.stringify(packed)));
  assert(revalidated !== undefined, 'payload survives JSON storage');
  assertBytesEqual(decalPixelsRgba(revalidated!)!, rgba, 'stored payload decodes to the captured pixels');
});

test('pack rejects size mismatches and oversized captures', () => {
  const doc = emptyDecalDoc(4, 3);
  assertEqual(packDecalPixels(doc, 4, 3, new Uint8Array(10)), null, 'wrong byte length rejected');
  assertEqual(packDecalPixels(doc, 5000, 1, new Uint8Array(5000 * 4)), null, 'oversized side rejected');
});

test('doc hash tracks edits (the bake-staleness key)', () => {
  const a = emptyDecalDoc(64, 64);
  const b = { ...a, bg: '#ff0000' };
  assert(decalDocHash(a) !== decalDocHash(b), 'editing the doc changes the hash');
  assertEqual(decalDocHash(a), decalDocHash(emptyDecalDoc(64, 64)), 'equal docs hash equal');
});

finish('game/textures/decal-pixels');
