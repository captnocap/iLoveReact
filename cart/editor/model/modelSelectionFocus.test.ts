import {
  CREATE_FACE_MAX_EDGES,
  describeCreateFaceReadiness,
  modelSelectionModeName,
  parseModelSelectionSnapshot,
  summarizeSelectedFaces,
  type ModelSelectionSnapshot,
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

// ── Create Face readiness (req_4202) ─────────────────────────────────────────
// The ladder under test is `meshTopoCreateFaceFromEdges` in framework/gpu/3d.zig.
// Each case below is one of its gates, read WITHOUT running the op.

type TestEdge = { id: number; vertices: [number, number]; faces: number };
const edgeSelection = (rows: TestEdge[], count = rows.length, truncated = false): ModelSelectionSnapshot => {
  const snapshot = parseModelSelectionSnapshot({
    version: 1,
    mode: 2,
    count,
    affectedVertices: 2,
    selectedTriangles: 0,
    truncated,
    pivot: [0, 0, 0],
    bounds: [0, 0, 0, 1, 1, 0],
    vertices: [{ id: 0, at: [0, 0, 0], part: 0 }, { id: 1, at: [1, 0, 0], part: 0 }],
    edges: rows.map((row) => ({ ...row, length: 1, open: row.faces === 1, part: 0 })),
    triangles: [],
  });
  assert(snapshot, 'test edge selection was rejected by the parser');
  return snapshot;
};

const lone = describeCreateFaceReadiness(edgeSelection([{ id: 3, vertices: [0, 1], faces: 1 }]));
assert(lone.shape === 'none' && lone.blocking.length === 1, 'a one-edge selection was not reported as blocking');
assert(lone.blocking[0]!.includes('ADDITIVE'), 'the one-edge refusal did not name the additive pick');

const openBridge = describeCreateFaceReadiness(edgeSelection([
  { id: 3, vertices: [0, 1], faces: 1 },
  { id: 9, vertices: [4, 5], faces: 1 },
]));
assert(openBridge.shape === 'bridge' && openBridge.blocking.length === 0, 'two disjoint OPEN edges were reported as blocked');
assert(openBridge.hostDecides.length > 0, 'the bridge reported no host-decided gate — unmeasured must never read as clean');

const closedBridge = describeCreateFaceReadiness(edgeSelection([
  { id: 3, vertices: [0, 1], faces: 2 },
  { id: 9, vertices: [4, 5], faces: 2 },
]));
assert(closedBridge.shape === 'bridge' && closedBridge.blocking.length === 1, 'a bridge between two interior edges was not flagged');
assert(closedBridge.blocking[0]!.includes('edge 3 already carries 2 faces') &&
  closedBridge.blocking[0]!.includes('edge 9 already carries 2 faces'), 'both closed edges were not named');

const corner = describeCreateFaceReadiness(edgeSelection([
  { id: 3, vertices: [0, 1], faces: 1 },
  { id: 9, vertices: [1, 2], faces: 1 },
]));
assert(corner.shape === 'corner' && corner.blocking.length === 0, 'two edges sharing a vertex were not read as a corner triangle');

const closedLoop = describeCreateFaceReadiness(edgeSelection([
  { id: 1, vertices: [0, 1], faces: 1 },
  { id: 2, vertices: [1, 2], faces: 1 },
  { id: 3, vertices: [2, 0], faces: 1 },
]));
assert(closedLoop.shape === 'loop-fill' && closedLoop.blocking.length === 0, 'a closed 3-edge loop was reported as blocked');

const openChain = describeCreateFaceReadiness(edgeSelection([
  { id: 1, vertices: [0, 1], faces: 1 },
  { id: 2, vertices: [1, 2], faces: 1 },
  { id: 3, vertices: [2, 3], faces: 1 },
]));
assert(openChain.shape === 'loop-fill' && openChain.blocking.length === 1, 'an OPEN 3-edge chain was accepted as a loop fill');
assert(openChain.blocking[0]!.includes('CLOSED loop'), 'the open-chain refusal did not name the closed-loop requirement');

const tooMany = describeCreateFaceReadiness(edgeSelection([], 5));
assert(tooMany.shape === 'none' && tooMany.blocking[0]!.includes('3 or 4 edges'), 'a 5-edge selection was not refused at the loop cap');
const wayTooMany = describeCreateFaceReadiness(edgeSelection([], CREATE_FACE_MAX_EDGES + 1));
assert(wayTooMany.blocking[0]!.includes(String(CREATE_FACE_MAX_EDGES)), 'the host edge-buffer cap was not reported');

const wrongMode = describeCreateFaceReadiness(face);
assert(wrongMode.shape === 'none' && wrongMode.blocking[0]!.includes('face mode'), 'a face-mode selection was not refused by mode');

console.log('modelSelectionFocus.test.ts: ok');
