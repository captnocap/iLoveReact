// editors/build/faceTextureDoc.test.ts (req_0749) — the upload's doc shape is a
// VALID decal that round-trips through the decal validator (the store/picker are
// host doors, exercised live; this pins the pure construction the panel relies
// on). Imports only the pure decal model — no material store, no IFTTT chain.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { imageDecalDoc, labelFromPath, MAX_UPLOAD_SIDE } from './faceTextureDoc';
import { validateDecalDoc } from '../../game/textures/decal';

test('an uploaded image COVERS a square canvas (no transparent margin on a square face)', () => {
  const doc = imageDecalDoc('/home/u/pics/poster.png', { w: 1600, h: 900 });
  const valid = validateDecalDoc(doc);
  assert(valid !== null, 'the upload doc passes the decal validator (so the store accepts it)');
  assertEqual(valid!.width, valid!.height, 'the canvas is square — matches the square face capture');
  assertEqual(valid!.nodes.length, 1, 'one node — the image');
  const img = valid!.nodes[0] as any;
  assertEqual(img.kind, 'image', 'the node is an image');
  assert(img.src === '/home/u/pics/poster.png', 'it carries the picked path');
  // COVER: the image node fills the canvas on both axes (overhang clipped), so
  // no transparent gap shows the wall through. The shorter edge meets the side.
  assert(img.w >= valid!.width && img.h >= valid!.height, 'the image covers the square on both axes');
  assertEqual(Math.min(img.w, img.h), valid!.width, 'the shorter image edge meets the square side (cover, not contain)');
  // landscape (16:9) overhangs horizontally and is centered → x negative, y 0
  assert(img.x <= 0 && img.y === 0, 'a landscape image is centered horizontally, crop on left/right');
});

test('a portrait image covers + centers the overhang vertically', () => {
  const doc = imageDecalDoc('tower.png', { w: 600, h: 1200 });
  const img = doc.nodes[0] as any;
  assertEqual(doc.width, doc.height, 'square canvas');
  assert(img.w >= doc.width && img.h >= doc.height, 'covers both axes');
  assert(img.y <= 0 && img.x === 0, 'portrait overhangs vertically, centered, crop on top/bottom');
});

test('a large image is scaled down so the square side hits the cap', () => {
  const doc = imageDecalDoc('big.jpg', { w: 4000, h: 2000 });
  assertEqual(doc.width, MAX_UPLOAD_SIDE, 'the square side is clamped to the cap');
  const img = doc.nodes[0] as any;
  assertEqual(Math.min(img.w, img.h), MAX_UPLOAD_SIDE, 'shorter edge covers the side; aspect kept');
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
