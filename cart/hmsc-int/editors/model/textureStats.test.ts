// textureStats.test.ts — pins the header-only image dimension reader (req_1879):
// PNG IHDR and JPEG SOF parsing. Pure bytes in, {w,h} out — no atob, no decode.
// reportTextureCensus() (the store walk) is verified live in `rjit dev`.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { dimsFromBytes } from './textureStats';

test('reads PNG dimensions from the IHDR', () => {
  // 8-byte sig, IHDR length+type, then width@16 (256) and height@20 (128).
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  b.set([0, 0, 1, 0], 16); // width = 256
  b.set([0, 0, 0, 0x80], 20); // height = 128
  const d = dimsFromBytes(b);
  assert(d !== null, 'parsed PNG');
  assertEqual(d!.w, 256, 'png width');
  assertEqual(d!.h, 128, 'png height');
});

test('reads JPEG dimensions from the SOF0 marker', () => {
  // FF D8, then SOF0 (FF C0): len, precision, height@+5 (480), width@+7 (640).
  const b = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x00]);
  const d = dimsFromBytes(b);
  assert(d !== null, 'parsed JPEG');
  assertEqual(d!.h, 480, 'jpeg height');
  assertEqual(d!.w, 640, 'jpeg width');
});

test('skips a JPEG APP0 segment to find the SOF behind it', () => {
  // FF D8, APP0 (FF E0) length 4 (2 payload bytes), then SOF0 with 100x200.
  const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0xaa, 0xbb, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8, 0x00]);
  const d = dimsFromBytes(b);
  assert(d !== null, 'parsed JPEG past APP0');
  assertEqual(d!.h, 100, 'jpeg height behind APP0');
  assertEqual(d!.w, 200, 'jpeg width behind APP0');
});

test('returns null for unrecognized bytes', () => {
  assert(dimsFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])) === null, 'garbage → null');
});

finish();
