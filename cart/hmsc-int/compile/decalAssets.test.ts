// compile/decalAssets tests — the content-addressed image sink
// (DECALIMG-0610, req_0592). The reader is injected so the suite runs with no
// filesystem; the real sink reads the same cwd-relative path the editor's
// Image primitive loads.

import { assertEqual, finish, test } from '../game/_testkit';
import { bytesToBase64 } from '@reactjit/workspace';
import { sha256Hex } from '@reactjit/workspace/sha256';
import { createDecalAssetSink, DECAL_IMAGE_ASSET_KEY_BASE, MAX_DECAL_IMAGE_BYTES } from './decalAssets';

test('interns a readable file once: sequential key, content dedupe, src cache', () => {
  const content = Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4]);
  const other = Uint8Array.from([9, 9, 9]);
  let reads = 0;
  const sink = createDecalAssetSink((path) => {
    reads += 1;
    if (path === 'a.png' || path === 'copy-of-a.png') return bytesToBase64(content);
    if (path === 'b.png') return bytesToBase64(other);
    return null;
  });
  const k1 = sink.internImage('a.png', 'custom:t: image node i1');
  assertEqual(k1, DECAL_IMAGE_ASSET_KEY_BASE, 'first asset takes the base key');
  assertEqual(sink.internImage('a.png', 'custom:t: image node i2'), k1, 'same src returns the cached key');
  assertEqual(reads, 1, 'same src never re-reads the file');
  assertEqual(sink.internImage('copy-of-a.png', 'custom:t: image node i3'), k1, 'same CONTENT dedupes to one asset (content addressing)');
  assertEqual(sink.internImage('b.png', 'custom:t: image node i4'), DECAL_IMAGE_ASSET_KEY_BASE + 1, 'new content takes the next key');
  assertEqual(sink.assets.length, 2, 'two distinct payloads shipped');
  assertEqual(sink.assets[0].hashHex, sha256Hex(content), 'the address IS the sha256');
  assertEqual(sink.assets[0].bytes.byteLength, content.byteLength, 'payload bytes carried verbatim');
  assertEqual(sink.assets[0].src, 'a.png', 'first src kept for diagnostics');
});

test('missing, empty, invalid, and oversized files degrade to key 0 (warned, never thrown)', () => {
  const big = new Uint8Array(MAX_DECAL_IMAGE_BYTES + 3);
  const sink = createDecalAssetSink((path) => {
    if (path === 'missing.png') return null;
    if (path === 'empty.png') return '';
    if (path === 'garbage.png') return '!!not-base64!!';
    return bytesToBase64(big);
  });
  assertEqual(sink.internImage('missing.png', 'c'), 0, 'unreadable file → 0');
  assertEqual(sink.internImage('empty.png', 'c'), 0, 'empty file → 0');
  assertEqual(sink.internImage('garbage.png', 'c'), 0, 'invalid base64 transport → 0');
  assertEqual(sink.internImage('huge.png', 'c'), 0, 'oversized file → 0');
  assertEqual(sink.assets.length, 0, 'nothing shipped');
  assertEqual(sink.internImage('missing.png', 'c'), 0, 'known-bad src cached as 0');
});

finish('compile/decal-assets');
