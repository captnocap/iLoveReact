import type { ModelPart } from '../data/types';
import type { ModelSelectionSnapshot } from './modelSelectionFocus';
import { planSelectionOwnerSurgery, selectionOwnerElementLabel } from './selectionOwnerSurgery';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const parts: ModelPart[] = [
  { id: 'headrest', name: 'Head rest', visible: true, color: '#fff', lo: 20, hi: 30 },
  { id: 'seat', name: 'Seat', visible: true, color: '#fff', lo: 0, hi: 20 },
];

const edgeSelection = (edges: ModelSelectionSnapshot['edges'], truncated = false): ModelSelectionSnapshot => ({
  version: 1,
  mode: 2,
  count: edges.length,
  affectedVertices: edges.length * 2,
  selectedTriangles: 0,
  truncated,
  pivot: edges.length ? [0, 0, 0] : null,
  bounds: edges.length ? [0, 0, 0, 1, 1, 1] : null,
  vertices: edges.flatMap((edge) => edge.vertices.map((id) => ({ id, at: [0, 0, 0] as [number, number, number], part: edge.part }))),
  edges,
  triangles: [],
});

const oneOwner = planSelectionOwnerSurgery(edgeSelection([
  { id: 971, vertices: [1, 2], length: 1, faces: 1, open: true, part: 1 },
  { id: 973, vertices: [2, 3], length: 1, faces: 2, open: false, part: 1 },
]), parts);
assert(oneOwner.ok, 'one-owner edge selection was rejected');
assert(oneOwner.plan.groups.length === 1, 'one owner did not collapse to one surgery stop');
assert(oneOwner.plan.groups[0]!.partId === 'headrest', 'numeric owner ignored range rank');
assert(oneOwner.plan.groups[0]!.elementIds.join(',') === '971,973', 'edge ids were not preserved');

const mixed = planSelectionOwnerSurgery(edgeSelection([
  { id: 7, vertices: [1, 2], length: 1, faces: 1, open: true, part: 0 },
  { id: 971, vertices: [3, 4], length: 1, faces: 1, open: true, part: 1 },
]), parts);
assert(mixed.ok && mixed.plan.groups.map((group) => group.partId).join(',') === 'seat,headrest', 'mixed owners did not become ordered cycle stops');

const unowned = planSelectionOwnerSurgery(edgeSelection([
  { id: 9, vertices: [1, 2], length: 1, faces: 1, open: true, part: null },
]), parts);
assert(!unowned.ok && unowned.reason.includes('no Outliner owner'), 'unowned topology was silently assigned');

const tooLarge = planSelectionOwnerSurgery(edgeSelection([
  { id: 9, vertices: [1, 2], length: 1, faces: 1, open: true, part: 0 },
], true), parts);
assert(!tooLarge.ok && tooLarge.reason.includes('too large'), 'truncated selection was treated as exactly restorable');
assert(selectionOwnerElementLabel(2, 2) === '2 edges', 'edge status label drifted');

console.log('selectionOwnerSurgery.test.ts: ok');
