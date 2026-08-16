import {
  auditLotPlan,
  cloneLotPlan,
  emptyLotPlan,
  lotEdgeKey,
  lotPlacementRect,
  parseLotPlan,
  LotPlanValidationError,
  type LotPlaceableFacts,
  type LotPlan,
} from './lotPlan';
import { renderLotPlanAscii, summarizeLotPlan } from './lotPlanPercept';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function throwsValidation(run: () => void, expectedPath: string): void {
  try {
    run();
  } catch (error) {
    if (!(error instanceof LotPlanValidationError)) throw error;
    assert(error.path.includes(expectedPath), `expected validation path containing '${expectedPath}', got '${error.path}'`);
    return;
  }
  throw new Error(`expected a validation error at '${expectedPath}'`);
}

// Real measured sizes — fractional is the NORM (req_4562): the modeled size
// IS the size; nothing here rounds to tiles.
const CATALOG = new Map<string, LotPlaceableFacts>([
  ['bed_king', { id: 'bed_king', name: 'King Bed', widthU: 1.93, depthU: 2.13, mount: 'floor' }],
  ['couch_001', { id: 'couch_001', name: 'Couch', widthU: 2.6, depthU: 0.95, mount: 'floor' }],
  ['tv_001', { id: 'tv_001', name: 'TV', widthU: 1.42, depthU: 0.12, mount: 'wall' }],
]);

/** 6×4 lot: one 3×4 bedroom walled off on the left, a door in its east wall. */
function bedroomPlan(): LotPlan {
  const plan = emptyLotPlan('Test Lot', 6, 4);
  plan.rooms.push({ id: 'bedroom', name: 'Bedroom' });
  for (let r = 0; r < 4; r += 1) for (let c = 0; c < 3; c += 1) plan.cells[r * 6 + c] = 0;
  for (let c = 0; c < 3; c += 1) {
    plan.walls.push({ edge: { orientation: 'h', columnU: c, rowU: 0 }, styleId: null });
    plan.walls.push({ edge: { orientation: 'h', columnU: c, rowU: 4 }, styleId: null });
  }
  for (let r = 0; r < 4; r += 1) {
    plan.walls.push({ edge: { orientation: 'v', columnU: 0, rowU: r }, styleId: null });
    plan.walls.push({ edge: { orientation: 'v', columnU: 3, rowU: r }, styleId: null });
  }
  plan.openings.push({ edge: { orientation: 'v', columnU: 3, rowU: 2 }, kind: 'door', kitId: null });
  return plan;
}

test('empty plan, round-trip clone, and edge keys hold', () => {
  const plan = bedroomPlan();
  const copy = cloneLotPlan(plan);
  equal(copy.cells.length, 24, 'cell count');
  equal(copy.walls.length, 14, 'wall count');
  equal(lotEdgeKey({ orientation: 'v', columnU: 3, rowU: 2 }), 'v:3,2', 'edge key form');
});

test('strict parse refuses bad versions, duplicate ids, and out-of-lot edges', () => {
  throwsValidation(() => parseLotPlan({ version: 2 }), 'plan.version');
  const dupRooms = JSON.parse(JSON.stringify(bedroomPlan()));
  dupRooms.rooms = [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }];
  throwsValidation(() => parseLotPlan(dupRooms), 'rooms[1].id');
  const farEdge = JSON.parse(JSON.stringify(bedroomPlan()));
  farEdge.walls.push({ edge: { orientation: 'h', columnU: 6, rowU: 0 }, styleId: null });
  throwsValidation(() => parseLotPlan(farEdge), 'edge');
  const badCells = JSON.parse(JSON.stringify(bedroomPlan()));
  badCells.cells[0] = 5;
  throwsValidation(() => parseLotPlan(badCells), 'cells[0]');
});

test('a valid furnished plan audits clean at fractional coordinates', () => {
  const plan = bedroomPlan();
  // x 0.05..1.98 stays clear of the door clearance zone that starts at x=2.
  plan.placements.push({ id: 'bed', placeableId: 'bed_king', xU: 0.05, yU: 0.4, rotation: 0 });
  const findings = auditLotPlan(plan, CATALOG);
  equal(findings.length, 0, `findings: ${findings.map((f) => f.code).join(',')}`);
});

test('rotation swaps the measured footprint and out-of-bounds refuses', () => {
  const plan = bedroomPlan();
  const rect = lotPlacementRect({ id: 'bed', placeableId: 'bed_king', xU: 0, yU: 0, rotation: 1 }, CATALOG.get('bed_king')!);
  equal(rect.widthU, 2.13, 'rotated width keeps the measured meters');
  equal(rect.depthU, 1.93, 'rotated depth keeps the measured meters');
  plan.placements.push({ id: 'bed', placeableId: 'bed_king', xU: 4.5, yU: 2.5, rotation: 0 });
  const findings = auditLotPlan(plan, CATALOG);
  equal(findings[0]?.code, 'placement-out-of-bounds', 'oob refusal');
});

test('overlap, flush-touch, unknown placeable, and door blocking behave', () => {
  const plan = bedroomPlan();
  plan.placements.push({ id: 'bed', placeableId: 'bed_king', xU: 0, yU: 0, rotation: 0 });
  // Interiors intersect (bed is 1.93 wide, couch starts at 1.5) → overlap.
  plan.placements.push({ id: 'couch', placeableId: 'couch_001', xU: 1.5, yU: 0.5, rotation: 0 });
  // Flush against the bed's face at exactly 1.93 → NOT an overlap.
  plan.placements.push({ id: 'flush', placeableId: 'couch_001', xU: 1.93, yU: 2.6, rotation: 0 });
  plan.placements.push({ id: 'ghost', placeableId: 'not_a_thing', xU: 5, yU: 0, rotation: 0 });
  // Door edge v:3,2 — clearance spans x 2..4, y 2..3; this couch reaches x 2.35.
  plan.placements.push({ id: 'blocker', placeableId: 'couch_001', xU: 2.1, yU: 2.05, rotation: 1 });
  const codes = auditLotPlan(plan, CATALOG).map((f) => f.code);
  assert(codes.includes('placement-overlap'), `overlap missing in ${codes.join(',')}`);
  equal(codes.filter((c) => c === 'placement-overlap').length, 1, 'flush touch did not count as overlap');
  assert(codes.includes('placement-unknown-placeable'), 'unknown placeable missing');
  assert(codes.includes('placement-blocks-door'), 'door block missing');
});

test('wall-mounted placeables demand a wall within reach of a face', () => {
  const plan = bedroomPlan();
  // Back face at yU=0.03 — within the 0.05 u touch tolerance of the wall at y=0.
  plan.placements.push({ id: 'tv-good', placeableId: 'tv_001', xU: 0.7, yU: 0.03, rotation: 0 });
  plan.placements.push({ id: 'tv-floating', placeableId: 'tv_001', xU: 4, yU: 1.5, rotation: 0 });
  const findings = auditLotPlan(plan, CATALOG);
  equal(findings.length, 1, `findings: ${findings.map((f) => f.code).join(',')}`);
  equal(findings[0]!.code, 'wall-mount-without-wall', 'refusal code');
  equal(findings[0]!.subject, 'tv-floating', 'the backed TV passed, the floating one refused');
});

test('an opening needs a wall; a doorless room reports sealed', () => {
  const plan = bedroomPlan();
  plan.openings.push({ edge: { orientation: 'v', columnU: 5, rowU: 0 }, kind: 'window', kitId: null });
  plan.openings[0] = { ...plan.openings[0]!, kind: 'window' }; // bedroom door becomes a window
  const codes = auditLotPlan(plan, CATALOG).map((f) => f.code);
  assert(codes.includes('opening-without-wall'), `wall-less opening missing in ${codes.join(',')}`);
  assert(codes.includes('room-sealed'), 'sealed room missing');
});

test('the percept keeps fractional truth in the legend', () => {
  const plan = bedroomPlan();
  plan.placements.push({ id: 'bed', placeableId: 'bed_king', xU: 0.05, yU: 0.4, rotation: 0 });
  const summary = summarizeLotPlan(plan, CATALOG);
  equal(summary.rooms[0]!.areaU2, 12, 'bedroom area');
  equal(summary.placements[0]!.footprintU!.widthU, 1.93, 'footprint is the MEASURED meters, not tiles');
  equal(summary.findings.length, 0, 'clean audit');
  const ascii = renderLotPlanAscii(plan, CATALOG);
  assert(ascii.includes('D'), 'door drawn');
  assert(ascii.includes('a '), 'placement glyph drawn');
  assert(ascii.includes('King Bed · 1.93×2.13 u at 0.05,0.4'), 'legend carries fractional truth');
  assert(ascii.includes('│'), 'walls drawn');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
