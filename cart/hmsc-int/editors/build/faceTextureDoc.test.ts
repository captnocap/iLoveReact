// editors/build/faceTextureDoc.test.ts (req_0749) — the upload's doc shape is a
// VALID decal that round-trips through the decal validator (the store/picker are
// host doors, exercised live; this pins the pure construction the panel relies
// on). Imports only the pure decal model — no material store, no IFTTT chain.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { imageDecalDoc, labelFromPath, MAX_UPLOAD_SIDE } from './faceTextureDoc';
import { validateDecalDoc } from '../../game/textures/decal';

test('an uploaded image becomes a valid full-bleed image decal', () => {
  const doc = imageDecalDoc('/home/u/pics/poster.png', { w: 1600, h: 900 });
  const valid = validateDecalDoc(doc);
  assert(valid !== null, 'the upload doc passes the decal validator (so the store accepts it)');
  assertEqual(valid!.nodes.length, 1, 'one node — the image');
  assertEqual(valid!.nodes[0].kind, 'image', 'the node is an image');
  assert((valid!.nodes[0] as any).src === '/home/u/pics/poster.png', 'it carries the picked path');
  // full-bleed: the image fills the whole canvas, no letterbox
  assertEqual((valid!.nodes[0] as any).w, valid!.width, 'image width fills the canvas');
  assertEqual((valid!.nodes[0] as any).h, valid!.height, 'image height fills the canvas');
});

test('a large image is scaled down to MAX_UPLOAD_SIDE, keeping aspect', () => {
  const doc = imageDecalDoc('big.jpg', { w: 4000, h: 2000 });
  assertEqual(doc.width, MAX_UPLOAD_SIDE, 'longest side clamped to the cap');
  assertEqual(doc.height, MAX_UPLOAD_SIDE / 2, 'aspect preserved (2:1)');
});

test('a tiny image never collapses below one pixel', () => {
  const doc = imageDecalDoc('dot.png', { w: 1, h: 1 });
  assert(doc.width >= 1 && doc.height >= 1, 'the canvas stays at least 1×1');
});

test('labelFromPath strips directory + extension', () => {
  assertEqual(labelFromPath('/a/b/My Wall.PNG'), 'My Wall', 'directory and extension drop');
  assertEqual(labelFromPath('noext'), 'noext', 'a bare name survives');
});

finish('editors/build/faceTextureDoc');
