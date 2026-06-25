// decalEdit.test.ts — P4 behavior tests for the shared DECAL node-editing core
// (req_1730/req_1831). Pins the pure ops the materials composer AND the studio
// painter both build on, so a future change can't silently diverge them.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { emptyDecalDoc, type DecalImageNode, type DecalPathNode, type DecalRectNode, type DecalTextNode } from '../../game/textures/decal';
import {
  addNode, cleanPickedPath, duplicateNode, mintNodeId, moveNode, newImage, newPath, newRect, newText,
  patchNode, removeNode, renameNode, reorderNode, resizeNode, toggleHidden,
} from './decalEdit';

test('node factories scale to the doc and mint unique ids', () => {
  const doc = emptyDecalDoc(512, 256);
  const rect = newRect(doc) as DecalRectNode;
  assertEqual(rect.kind, 'rect', 'rect factory makes a rect');
  assertEqual(rect.x, 128, 'rect x is a quarter of width');
  assertEqual(rect.w, 256, 'rect w is half the width');
  const text = newText(doc) as DecalTextNode;
  assertEqual(text.text, 'BILLBOARD', 'text node seeds a default string');
  assertEqual(text.fontWeight, 800, 'text node seeds a bold weight');
  const img = newImage(doc, 'a.png') as DecalImageNode;
  assertEqual(img.src, 'a.png', 'image factory takes a src');
  const neon = newPath(doc) as DecalPathNode;
  assertEqual(neon.kind, 'path', 'neon factory makes a path node');
  assert(neon.d.startsWith('M '), 'neon node carries an SVG path d');
  // ids are unique within a doc as nodes accumulate
  const d1 = addNode(doc, rect);
  assertEqual(mintNodeId(d1, 'rect'), 'rect-2', 'next rect id avoids the existing one');
});

test('addNode / removeNode / patchNode are pure and immutable', () => {
  const doc = emptyDecalDoc(256, 256);
  const node = newRect(doc);
  const added = addNode(doc, node);
  assertEqual(doc.nodes.length, 0, 'addNode does not mutate the source doc');
  assertEqual(added.nodes.length, 1, 'addNode returns a doc with the node');
  const patched = patchNode(added, node.id, { x: 99 });
  assertEqual((added.nodes[0] as DecalRectNode).x, 64, 'patchNode leaves the prior doc intact');
  assertEqual((patched.nodes[0] as DecalRectNode).x, 99, 'patchNode applies the patch');
  const removed = removeNode(patched, node.id);
  assertEqual(removed.nodes.length, 0, 'removeNode drops the node');
});

test('moveNode offsets x/y from the current position', () => {
  const doc = addNode(emptyDecalDoc(256, 256), newRect(emptyDecalDoc(256, 256)));
  const id = doc.nodes[0].id;
  const moved = moveNode(doc, id, 5, 7);
  assertEqual((moved.nodes[0] as DecalRectNode).x, 64 + 5, 'x shifts by dx');
  assertEqual((moved.nodes[0] as DecalRectNode).y, 64 + 7, 'y shifts by dy');
});

test('resizeNode grows from a handle and clamps to the minimum, pinning the far edge', () => {
  const base = emptyDecalDoc(256, 256);
  const doc = addNode(base, newRect(base)); // rect at x64 y64 w128 h128
  const id = doc.nodes[0].id;
  const se = resizeNode(doc, id, 'se', 20, 10);
  assertEqual((se.nodes[0] as DecalRectNode).w, 128 + 20, 'se handle grows width');
  assertEqual((se.nodes[0] as DecalRectNode).h, 128 + 10, 'se handle grows height');
  // dragging the west handle far past the east edge clamps width to 1 and pins the east edge
  const w = resizeNode(se, id, 'w', 9999, 0);
  assertEqual((w.nodes[0] as DecalRectNode).w, 1, 'west drag clamps to minimum width');
  assertEqual((w.nodes[0] as DecalRectNode).x, 64 + (128 + 20) - 1, 'west clamp keeps the east edge pinned');
});

test('reorderNode swaps neighbours and no-ops at the ends', () => {
  let doc = emptyDecalDoc(256, 256);
  const a = newRect(doc); doc = addNode(doc, a);
  const b = newText(doc); doc = addNode(doc, b);
  const up = reorderNode(doc, a.id, 1);
  assertEqual(up.nodes[1].id, a.id, 'a moved forward past b');
  const edge = reorderNode(doc, b.id, 1); // b already on top
  assertEqual(edge.nodes[1].id, b.id, 'reorder past the top is a no-op');
});

test('duplicateNode clones with a fresh id and a +16 offset', () => {
  const doc = addNode(emptyDecalDoc(256, 256), newText(emptyDecalDoc(256, 256)));
  const id = doc.nodes[0].id;
  const dup = duplicateNode(doc, id);
  assertEqual(dup.nodes.length, 2, 'duplicate adds a node');
  assert(dup.nodes[1].id !== id, 'the clone has a new id');
  assertEqual(dup.nodes[1].x, dup.nodes[0].x + 16, 'the clone is offset by 16px');
});

test('toggleHidden and renameNode round-trip', () => {
  const doc = addNode(emptyDecalDoc(256, 256), newRect(emptyDecalDoc(256, 256)));
  const id = doc.nodes[0].id;
  const hidden = toggleHidden(doc, id);
  assertEqual(hidden.nodes[0].hidden, true, 'toggle hides a visible node');
  assertEqual(toggleHidden(hidden, id).nodes[0].hidden, undefined, 'toggle again clears hidden');
  const named = renameNode(doc, id, '  front  ');
  assertEqual(named.nodes[0].name, 'front', 'rename trims whitespace');
  assertEqual(renameNode(named, id, '   ').nodes[0].name, undefined, 'blank rename clears the name');
});

test('cleanPickedPath strips quotes and the file scheme', () => {
  assertEqual(cleanPickedPath('  "file:///tmp/a%20b.png"  '), '/tmp/a b.png', 'decodes a quoted file:// uri');
  assertEqual(cleanPickedPath('/plain/path.png'), '/plain/path.png', 'leaves a plain path untouched');
});

finish('editors/decal/decalEdit');
