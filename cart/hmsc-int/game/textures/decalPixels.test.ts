// game/textures/decalPixels tests — the decal pixel bake's two codecs
// (DECALPIX-0610 / DECALPIXFILE-0610). The PackBits stream is decoded by
// constructor.zig at world construct and the rows-of-runs pixel JSON (the
// cart/pixel_icons format, USER req_0572) is what lives on disk — both
// boundaries' edge behavior is pinned here, not eyeballed.

import { assert, assertEqual, finish, test, withHost } from '../_testkit';
import { emptyDecalDoc } from './decal';
import {
  decalDocHash,
  decalPixelsFilePath,
  decodeDecalPixelFile,
  decodePixelRle,
  encodeDecalPixelFile,
  encodePixelRle,
  loadDecalPixelsRgba,
  storeDecalPixels,
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

/** An in-memory fs door for withHost — the same __fs_read/__fs_write surface
 *  the editor host and the headless bake both speak. */
function memoryFs(): { stubs: Record<string, unknown>; files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    stubs: {
      __fs_write: (path: string, content: string) => { files.set(path, content); return true; },
      __fs_read: (path: string) => files.get(path) ?? null,
    },
  };
}

// ── the LUMP codec (PackBits — the constructor.zig pair) ─────────────────────

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

test('malformed PackBits streams decode to null, never partial pixels', () => {
  const good = encodePixelRle(rgbaOf(Array.from({ length: 10 }, () => [7, 7, 7, 255])));
  assertEqual(decodePixelRle(good.subarray(0, good.length - 2), 10), null, 'truncated stream rejected');
  const padded = new Uint8Array(good.length + 3);
  padded.set(good);
  assertEqual(decodePixelRle(padded, 10), null, 'trailing garbage rejected');
  assertEqual(decodePixelRle(good, 11), null, 'pixel-count overrun rejected');
});

// ── the FILE codec (rows-of-runs pixel JSON — the pixel_icons format) ───────

test('pixel file JSON round-trips runs, literals, alpha, and transparency', () => {
  // 4×3: a flat run row, a distinct row, a row mixing transparency + alpha.
  const rgba = rgbaOf([
    [10, 20, 30, 255], [10, 20, 30, 255], [10, 20, 30, 255], [10, 20, 30, 255],
    [1, 2, 3, 255], [4, 5, 6, 255], [7, 8, 9, 255], [10, 11, 12, 255],
    [0, 0, 0, 0], [0, 0, 0, 0], [200, 100, 50, 128], [10, 20, 30, 255],
  ]);
  const text = encodeDecalPixelFile(4, 3, rgba);
  const parsed = JSON.parse(text);
  assertEqual(parsed.width, 4, 'width stored');
  assertEqual(parsed.height, 3, 'height stored');
  assertEqual(parsed.rows.length, 3, 'one entry per row');
  assert(JSON.stringify(parsed.rows[0]) === JSON.stringify([[4, 0]]), 'flat row encodes as one run');
  assert(parsed.palette.includes('#c8643280'), 'translucent pixel keeps its alpha in the palette');
  assertBytesEqual(decodeDecalPixelFile(text, 4, 3)!, rgba, 'file round-trip');
});

test('pixel file decode rejects malformed documents, never partial pixels', () => {
  const rgba = rgbaOf(Array.from({ length: 6 }, () => [9, 9, 9, 255]));
  const good = encodeDecalPixelFile(3, 2, rgba);
  assertEqual(decodeDecalPixelFile(good, 4, 2), null, 'dimension mismatch rejected');
  assertEqual(decodeDecalPixelFile('not json', 3, 2), null, 'garbage rejected');
  const shortRow = JSON.stringify({ width: 3, height: 2, palette: ['#090909'], rows: [[[3, 0]], [[2, 0]]] });
  assertEqual(decodeDecalPixelFile(shortRow, 3, 2), null, 'row underrun rejected');
  const overRow = JSON.stringify({ width: 3, height: 2, palette: ['#090909'], rows: [[[3, 0]], [[4, 0]]] });
  assertEqual(decodeDecalPixelFile(overRow, 3, 2), null, 'row overrun rejected');
  const badIndex = JSON.stringify({ width: 3, height: 2, palette: ['#090909'], rows: [[[3, 0]], [[3, 9]]] });
  assertEqual(decodeDecalPixelFile(badIndex, 3, 2), null, 'palette index out of range rejected');
  const badColor = JSON.stringify({ width: 3, height: 2, palette: ['nope'], rows: [[[3, 0]], [[3, 0]]] });
  assertEqual(decodeDecalPixelFile(badColor, 3, 2), null, 'bad palette entry rejected');
});

// ── the stored payload + its file ────────────────────────────────────────────

test('store → validate → load round-trips through the fs door', () => {
  const doc = emptyDecalDoc(8, 8);
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 64; i += 1) rgba.set([(i * 3) & 255, 255 - i, 40, 255], i * 4);
  const fs = memoryFs();
  withHost(fs.stubs, () => {
    const payload = storeDecalPixels('custom:netcafe', doc, 8, 8, rgba);
    assert(payload !== null, 'store writes and returns the payload');
    assertEqual(payload!.file, decalPixelsFilePath('custom:netcafe'), 'deterministic per-id file path');
    assertEqual(payload!.docHash, decalDocHash(doc), 'payload carries the doc hash');
    assert(fs.files.has(payload!.file), 'the pixel file landed on disk');
    const revalidated = validateDecalPixels(JSON.parse(JSON.stringify(payload)));
    assert(revalidated !== undefined, 'payload survives JSON storage');
    assertBytesEqual(loadDecalPixelsRgba(revalidated!)!, rgba, 'stored payload loads back to the captured pixels');
  });
});

test('store refuses size mismatches and a refused fs write', () => {
  const doc = emptyDecalDoc(8, 8);
  withHost(memoryFs().stubs, () => {
    assertEqual(storeDecalPixels('custom:x', doc, 8, 8, new Uint8Array(10)), null, 'wrong byte length rejected');
    assertEqual(storeDecalPixels('custom:x', doc, 5000, 1, new Uint8Array(5000 * 4)), null, 'oversized side rejected');
  });
  withHost({ __fs_write: () => false, __fs_read: () => null }, () => {
    assertEqual(storeDecalPixels('custom:x', doc, 1, 1, new Uint8Array(4)), null, 'refused write returns null (caller parks)');
  });
});

test('load degrades to null on a missing or mismatched file', () => {
  const doc = emptyDecalDoc(8, 8);
  const payload = { w: 8, h: 8, docHash: decalDocHash(doc), file: 'cart/hmsc-int/data/decal-pixels/gone.json' };
  withHost({ __fs_read: () => null }, () => {
    assertEqual(loadDecalPixelsRgba(payload), null, 'missing file → null');
  });
  withHost({ __fs_read: () => encodeDecalPixelFile(2, 2, new Uint8Array(16)) }, () => {
    assertEqual(loadDecalPixelsRgba(payload), null, 'file dimensions must match the payload');
  });
});

test('doc hash tracks edits (the bake-staleness key)', () => {
  const a = emptyDecalDoc(64, 64);
  const b = { ...a, bg: '#ff0000' };
  assert(decalDocHash(a) !== decalDocHash(b), 'editing the doc changes the hash');
  assertEqual(decalDocHash(a), decalDocHash(emptyDecalDoc(64, 64)), 'equal docs hash equal');
});

finish('game/textures/decal-pixels');
