// Run:
//   tools/esbuild cart/editor/agent/seatGeometry.test.ts --bundle --outfile=/tmp/editor-seat-geometry.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-seat-geometry.test.js
//
// These assert the arithmetic that req_4052 moved OUT of agent-side python. Each case
// is a shape the transcripts actually computed by hand: a part's extent, a leg sitting
// on a floor, a symmetry audit, a degenerate-triangle hunt.
import {
  CONTACT_EPSILON,
  axisIndexOf,
  boxFacts,
  boxOfPoints,
  contactAxis,
  findAnomalies,
  measureContact,
  measureDistance,
  measureSymmetry,
  planAlign,
  spread,
  triangleEdgeLengths,
  unionBoxes,
  type SeatBox,
} from './seatGeometry';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
const near = (a: number, b: number, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

const floor: SeatBox = [-1, 0, -1, 1, 0.1, 1];
const legAbove: SeatBox = [-0.1, 0.14, -0.1, 0.1, 0.6, 0.1];   // floating 40mm over the floor
const legSunk: SeatBox = [-0.1, 0.05, -0.1, 0.1, 0.6, 0.1];    // 50mm into the floor

test('bbox facts name the axis a part actually runs along', () => {
  const facts = boxFacts([0, 0, 0, 0.2, 1.8, 0.3]);
  assert(facts.longestAxis === 'y', `expected y, got ${facts.longestAxis}`);
  assert(near(facts.volume, 0.2 * 1.8 * 0.3), 'volume is not the product of the sides');
  assert(near(facts.center[1], 0.9), 'center y is wrong');
});

test('a floating leg reads as a gap, not as overlapping its floor footprint', () => {
  const report = measureDistance(legAbove, floor);
  assert(report.verdict === 'gap', `verdict was ${report.verdict}`);
  const y = report.axes[1]!;
  assert(near(y.gap, 0.04), `gap was ${y.gap}, expected 0.04`);
  // x and z DO overlap; the verdict must still be "gap" because y separates them.
  assert(report.axes[0]!.verdict === 'overlapping', 'x should overlap');
  assert(near(report.separation, 0.04), `separation was ${report.separation}`);
});

test('contact hands over the exact delta the transcripts computed by hand', () => {
  const report = measureContact(legAbove, floor);
  assert(report.contact.axis === 'y', `contact axis was ${report.contact.axis}`);
  // delta = stationaryPlane - movingPlane = 0.1 - 0.14
  assert(near(report.contact.delta, -0.04), `delta was ${report.contact.delta}`);
  assert(report.contact.side === 'above', `side was ${report.contact.side}`);
});

test('a sunk leg resolves along its shallowest penetration', () => {
  const report = measureContact(legSunk, floor);
  assert(report.verdict === 'overlapping', `verdict was ${report.verdict}`);
  assert(report.contact.axis === 'y', `contact axis was ${report.contact.axis}`);
  assert(near(report.contact.delta, 0.05), `delta was ${report.contact.delta}`);
});

test('touching within tolerance is touching, not a hairline gap', () => {
  const seated: SeatBox = [-0.1, 0.1, -0.1, 0.1, 0.6, 0.1];
  const report = measureContact(seated, floor);
  assert(report.axes[1]!.verdict === 'touching', `y verdict was ${report.axes[1]!.verdict}`);
  assert(near(report.contact.delta, 0), `delta was ${report.contact.delta}`);
});

test('align plans a delta on one axis only, and applying it seats the box', () => {
  const plan = planAlign(legAbove, floor);
  assert(plan.axis === 'y', `axis was ${plan.axis}`);
  assert(plan.delta[0] === 0 && plan.delta[2] === 0, 'align moved off-axis');
  const moved: SeatBox = [
    legAbove[0] + plan.delta[0], legAbove[1] + plan.delta[1], legAbove[2] + plan.delta[2],
    legAbove[3] + plan.delta[0], legAbove[4] + plan.delta[1], legAbove[5] + plan.delta[2],
  ];
  assert(measureDistance(moved, floor).axes[1]!.verdict === 'touching', 'the planned delta did not seat the box');
});

test('an explicit axis overrides the seat contact-axis pick', () => {
  const beside: SeatBox = [1.5, 0, -1, 2, 0.1, 1];
  assert(contactAxis(beside, floor) === 0, 'x separates these boxes');
  assert(planAlign(beside, floor, 1).axis === 'y', 'explicit axis was ignored');
});

test('the mirror plane is the model origin, never the bounding centerline', () => {
  // Every vertex offset +1 in x: perfectly symmetric about its OWN centerline, and
  // correctly reported as asymmetric about the model origin (req_3795).
  const offset = [
    { id: 0, at: [0.5, 0, 0] as [number, number, number] },
    { id: 1, at: [1.5, 0, 0] as [number, number, number] },
  ];
  const report = measureSymmetry(offset, 0);
  assert(report.plane === 0, 'the plane moved off the origin');
  assert(report.unmatched === 2, `expected both vertices unmatched, got ${report.unmatched}`);
});

test('symmetry counts on-plane vertices as their own partner', () => {
  const body = [
    { id: 0, at: [0, 1, 0] as [number, number, number] },
    { id: 1, at: [-0.5, 1, 0.2] as [number, number, number] },
    { id: 2, at: [0.5, 1, 0.2] as [number, number, number] },
  ];
  const report = measureSymmetry(body, 0);
  assert(report.onPlane === 1, `onPlane was ${report.onPlane}`);
  assert(report.unmatched === 0, `unmatched was ${report.unmatched}`);
  assert(near(report.ratio, 1), `ratio was ${report.ratio}`);
});

test('a partner straddling a bucket boundary is still found', () => {
  // Positions chosen so the two mirror partners quantize into neighbouring buckets.
  const half = CONTACT_EPSILON / 2;
  const body = [
    { id: 0, at: [-0.3, half, 0] as [number, number, number] },
    { id: 1, at: [0.3, half, 0] as [number, number, number] },
  ];
  assert(measureSymmetry(body, 0).unmatched === 0, 'the 3x3 bucket probe missed a straddling partner');
});

test('spread reports the stretch ratio a retopology pass is hunting', () => {
  const measured = spread([0.1, 0.2, 0.3, 0.4])!;
  assert(measured.count === 4, 'count is wrong');
  assert(near(measured.median, 0.25), `median was ${measured.median}`);
  assert(near(measured.ratio!, 4), `ratio was ${measured.ratio}`);
  assert(spread([]) === null, 'an empty set should measure nothing, not zero');
});

test('edge lengths count each shared edge once', () => {
  const vertices = [
    { id: 0, at: [0, 0, 0] as [number, number, number] },
    { id: 1, at: [1, 0, 0] as [number, number, number] },
    { id: 2, at: [1, 1, 0] as [number, number, number] },
    { id: 3, at: [0, 1, 0] as [number, number, number] },
  ];
  // Two triangles of one quad: 5 distinct edges, not 6.
  const lengths = triangleEdgeLengths(
    [{ vertices: [0, 1, 2] }, { vertices: [0, 2, 3] }],
    vertices,
  );
  assert(lengths.length === 5, `expected 5 distinct edges, got ${lengths.length}`);
});

test('a sliver with three distinct corners is caught by area, not by edge length', () => {
  const vertices = [
    { id: 0, at: [0, 0, 0] as [number, number, number] },
    { id: 1, at: [1, 0, 0] as [number, number, number] },
    { id: 2, at: [0.5, 1e-9, 0] as [number, number, number] },
  ];
  const report = findAnomalies([{ id: 4, vertices: [0, 1, 2] }], vertices, []);
  assert(report.counts.degenerate === 1, 'a zero-area sliver was not reported');
});

test('anomalies separate open boundary edges from non-manifold ones', () => {
  const edges = [
    { id: 0, vertices: [0, 1] as [number, number], faces: 1, open: true },
    { id: 1, vertices: [1, 2] as [number, number], faces: 2, open: false },
    { id: 2, vertices: [2, 3] as [number, number], faces: 3, open: false },
  ];
  const report = findAnomalies([], [], edges);
  assert(report.openEdges === 1, `openEdges was ${report.openEdges}`);
  assert(report.counts.nonManifoldEdges === 1, 'the 3-face edge was not flagged');
});

test('duplicate vertices are found by position, not by id', () => {
  const vertices = [
    { id: 0, at: [1, 2, 3] as [number, number, number] },
    { id: 9, at: [1, 2, 3] as [number, number, number] },
    { id: 4, at: [0, 0, 0] as [number, number, number] },
  ];
  const report = findAnomalies([], vertices, []);
  assert(report.counts.duplicateVertices === 1, 'the coincident pair was not reported');
  assert(report.duplicateVertices[0]!.ids.length === 2, 'the pair did not carry both ids');
});

test('point and box helpers refuse to invent an extent from nothing', () => {
  assert(boxOfPoints([]) === null, 'an empty point set produced a box');
  assert(unionBoxes([]) === null, 'an empty box set produced a box');
  assert(axisIndexOf('w') === null, 'an unknown axis name resolved');
  assert(axisIndexOf('Z') === 2, 'axis names should be case-insensitive');
});

test('a union spans every box it was given', () => {
  const box = unionBoxes([[0, 0, 0, 1, 1, 1], [-2, 0.5, 0, -1, 3, 0.5]])!;
  assert(box[0] === -2 && box[4] === 3, `union was ${box.join(',')}`);
});

log(`seatGeometry: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
if (failed) (globalThis as any).__exit?.(1);
