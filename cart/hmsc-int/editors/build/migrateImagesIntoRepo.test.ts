// Pure-walk tests for the image portability migration (req_1774). The fs/host
// half (ingestImageFile) is exercised live in the editor; here we pin the doc
// rewrite logic with a fake ingest so it needs zero host doors.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { emptyDecalDoc } from '../../game/textures/decal';
import { rewriteDecalImages } from './migrateImagesIntoRepo';
import { TEX_ASSET_DIR } from './ingestImage';

// fake ingest: maps a known external path to a repo asset, fails on a "gone" one.
const fakeIngest = (src: string): string | null =>
  src === '/home/siah/wall.png' ? `${TEX_ASSET_DIR}/abc123.png` : null;

function imageDoc(src: string) {
  const d = emptyDecalDoc(64, 64);
  return { ...d, nodes: [{ id: 'img', kind: 'image' as const, x: 0, y: 0, w: 64, h: 64, src }] };
}

test('external path is copied in and the src is rewritten to the repo asset', () => {
  const r = rewriteDecalImages(imageDoc('/home/siah/wall.png'), fakeIngest);
  assertEqual(r.migrated, 1, 'one image migrated');
  assertEqual(r.alreadyLocal, 0, 'none already local');
  assertEqual(r.missing.length, 0, 'nothing missing');
  const node = r.doc.nodes[0] as any;
  assertEqual(node.src, `${TEX_ASSET_DIR}/abc123.png`, 'src points at the repo asset');
});

test('a data: URL is already portable — left untouched', () => {
  const r = rewriteDecalImages(imageDoc('data:image/png;base64,AAAA'), fakeIngest);
  assertEqual(r.migrated, 0, 'nothing migrated');
  assertEqual(r.alreadyLocal, 1, 'counted as already local');
  assertEqual((r.doc.nodes[0] as any).src, 'data:image/png;base64,AAAA', 'src unchanged');
});

test('an already-ingested asset path is left untouched', () => {
  const local = `${TEX_ASSET_DIR}/deadbeef.png`;
  const r = rewriteDecalImages(imageDoc(local), fakeIngest);
  assertEqual(r.alreadyLocal, 1, 'already local');
  assertEqual((r.doc.nodes[0] as any).src, local, 'src unchanged');
});

test('a vanished source is reported missing, src kept as-is', () => {
  const r = rewriteDecalImages(imageDoc('/home/siah/renamed.png'), fakeIngest);
  assertEqual(r.migrated, 0, 'nothing migrated');
  assertEqual(r.missing.length, 1, 'one missing');
  assertEqual(r.missing[0], '/home/siah/renamed.png', 'reported missing');
  assertEqual((r.doc.nodes[0] as any).src, '/home/siah/renamed.png', 'src untouched so the user can re-upload');
});

finish('editors/build/migrateImagesIntoRepo');
