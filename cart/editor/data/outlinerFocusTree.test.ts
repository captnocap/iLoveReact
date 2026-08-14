import { outlinerFocusTree, outlinerHeaderCounts, partAttachments } from './outlinerFocusTree';
import type { ModelFocusSemanticRow } from '../model/modelSemanticsFocus';
import type { ModelPart } from './types';

let passed = 0;
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const test = (name: string, fn: () => void) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

const part = (id: string, lo: number, hi: number): ModelPart => ({ id, name: id, visible: true, color: '#888', lo, hi });
const faceRow = (id: number, name: string, groupSpan: [number, number] | null, presence: 'resident' | 'saved-only' = 'resident'): ModelFocusSemanticRow => ({
  kind: 'face', id, name, role: '', parent: null, faces: 4, instances: 1, presence, groupSpan,
});
const edgeRow = (id: number, name: string, role: 'boundary' | 'hinge' | 'mount' | 'contact', objectId: string): ModelFocusSemanticRow => ({
  kind: 'edge', id, name, role, objectId, closed: false, vertices: 3, edges: 2, presence: 'resident',
});

test('face regions attach to the part whose range contains their group span', () => {
  const tree = outlinerFocusTree([part('a', 0, 10), part('b', 10, 20)], [
    faceRow(1, 'a.window', [2, 5]),
    faceRow(2, 'b.door', [10, 20]),
  ]);
  assert(partAttachments(tree, 'a').regions.length === 1, 'region missed its owner');
  assert(partAttachments(tree, 'b').regions.length === 1, 'boundary-exact region missed its owner');
  assert(tree.unattributed.length === 0, 'exact spans must not fall out of the tree');
});

test('spanning, span-less, and ghost rows never wear a guessed owner', () => {
  const tree = outlinerFocusTree([part('a', 0, 10), part('b', 10, 20)], [
    faceRow(1, 'straddler', [5, 15]),
    faceRow(2, 'old-host', null),
    faceRow(3, 'ghost', [0, 4], 'saved-only'),
  ]);
  assert(partAttachments(tree, 'a').regions.length === 0 && partAttachments(tree, 'b').regions.length === 0, 'a guess was attributed');
  assert(tree.unattributed.length === 2, 'resident rows without one exact owner belong to the unattributed bucket');
  assert(tree.totals.regions === 2, 'ghost rows must not count');
});

test('edge paths join by objectId and rig roles land in the rig lane', () => {
  const tree = outlinerFocusTree([part('door', 0, 10)], [
    edgeRow(5, 'seam', 'boundary', 'door'),
    edgeRow(6, 'hinge', 'hinge', 'door'),
    edgeRow(7, 'stray', 'contact', 'deleted-part'),
  ]);
  const door = partAttachments(tree, 'door');
  assert(door.edges.length === 1 && door.rigs.length === 1, 'edge/rig lanes split wrong');
  assert(door.summary === '1 edg · 1 rig', `summary read "${door.summary}"`);
  assert(tree.unattributed.length === 1, 'an orphaned objectId must surface, not vanish');
  assert(outlinerHeaderCounts(1, tree) === '1 · 1 edg · 2 rig', `header read "${outlinerHeaderCounts(1, tree)}"`);
});

console.log(`outlinerFocusTree: ${passed} passed`);
