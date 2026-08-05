import {
  modelSelectionModeName,
  parseModelSelectionSnapshot,
  summarizeSelectedFaces,
} from './modelSelectionFocus';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const face = parseModelSelectionSnapshot(JSON.stringify({
  version: 1,
  mode: 3,
  count: 1,
  affectedVertices: 4,
  selectedTriangles: 2,
  truncated: false,
  pivot: [0.5, 0.5, 0],
  bounds: [0, 0, 0, 1, 1, 0],
  vertices: [
    { id: 0, at: [0, 0, 0], part: 0 },
    { id: 1, at: [1, 0, 0], part: 0 },
    { id: 2, at: [0, 1, 0], part: 0 },
    { id: 3, at: [1, 1, 0], part: 0 },
  ],
  edges: [],
  triangles: [
    { id: 4, group: 12, part: 0, material: 2, region: 7, instance: 0, vertices: [0, 1, 2], normal: [0, 0, 1], area: 0.5 },
    { id: 5, group: 12, part: 0, material: 2, region: 7, instance: 0, vertices: [1, 3, 2], normal: [0, 0, 1], area: 0.5 },
  ],
}));
assert(face, 'valid native face selection was rejected');
assert(modelSelectionModeName(face.mode) === 'face', 'face mode label drifted');
const summaries = summarizeSelectedFaces(face);
assert(summaries.length === 1, 'one authored quad was not collapsed from its two resident triangles');
assert(summaries[0]!.triangleIds.join(',') === '4,5', 'resident triangle ids were lost');
assert(summaries[0]!.vertices.join(',') === '0,1,2,3', 'authored-face vertex set was wrong');
assert(summaries[0]!.area === 1 && summaries[0]!.normal.join(',') === '0,0,1', 'face area/normal summary was wrong');
assert(summaries[0]!.region === 7 && summaries[0]!.material === 2, 'semantic/material facts were lost');

const edge = parseModelSelectionSnapshot({
  version: 1,
  mode: 2,
  count: 1,
  affectedVertices: 2,
  selectedTriangles: 0,
  truncated: false,
  pivot: [0.5, 0, 0],
  bounds: [0, 0, 0, 1, 0, 0],
  vertices: [{ id: 0, at: [0, 0, 0], part: 0 }, { id: 1, at: [1, 0, 0], part: 0 }],
  edges: [{ id: 3, vertices: [0, 1], length: 1, faces: 1, open: true, part: 0 }],
  triangles: [],
});
assert(edge?.edges[0]?.open === true, 'valid edge topology was not accepted');

assert(parseModelSelectionSnapshot({
  version: 1, mode: 1, count: 1, affectedVertices: 1, selectedTriangles: 0, truncated: false,
  pivot: null, bounds: null, vertices: [], edges: [], triangles: [],
}) === null, 'non-empty selection without a native pivot/bounds was accepted');
assert(parseModelSelectionSnapshot({
  version: 1, mode: 1, count: 1, affectedVertices: 1, selectedTriangles: 0, truncated: false,
  pivot: [0, 0, 0], bounds: [0, 0, 0, 0, 0, 0],
  vertices: [{ id: 0, at: [0, Number.NaN, 0], part: null }], edges: [], triangles: [],
}) === null, 'non-finite native geometry reached the focus panel');

console.log('modelSelectionFocus.test.ts: ok');
