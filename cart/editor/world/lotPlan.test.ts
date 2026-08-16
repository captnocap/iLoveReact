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

const CATALOG = new Map<string, LotPlaceableFacts>([
  ['bed_king', { id: 'bed_king', name: 'King Bed', widthU: 2, depthU: 3, mount: 'floor' }],
  ['couch_001', { id: 'couch_001', name: 'Couch', widthU: 3, depthU: 1, mount: 'floor' }],
  ['tv_001', { id: 'tv_001', name: 'TV', widthU: 2, depthU: 1, mount: 'wall' }],
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

test('a valid furnished plan audits clean', () => {
  const plan = bedroomPlan();
  plan.placements.push({ id: 'bed', placeableId: 'bed_king', columnU: 0, rowU: 0, rotation: 0 });
  const findings = auditLotPlan(plan, CATALOG);
  equal(findings.length, 0, `findings: ${findings.map((f) => f.code).join(',')}`);
});

test('rotation swaps a footprint and out-of-bounds refuses', () => {
  const plan = bedroomPlan();
  const rect = lotPlacementRect({ id: 'bed', placeableId: 'bed_king', columnU: 0, rowU: 0, rotation: 1 }, CATALOG.get('bed_king')!);
  equal(rect.widthU, 3, 'rotated width');
  equal(rect.depthU, 2, 'rotated depth');
  plan.placements.push({ id: 'bed', placeableId: 'bed_king', columnU: 5, rowU: 3, rotation: 0 });
  const findings = auditLotPlan(plan, CATALOG);
  equal(findings[0]?.code, 'placement-out-of-bounds', 'oob refusal');
});

test('overlap, unknown placeable, and door blocking refuse by name', () => {
  const plan = bedroomPlan();
  plan.placements.push({ id: 'bed', placeableId: 'bed_king', columnU: 0, rowU: 0, rotation: 0 });
  plan.placements.push({ id: 'couch', placeableId: 'couch_001', columnU: 0, rowU: 1, rotation: 0 });
  plan.placements.push({ id: 'ghost', placeableId: 'not_a_thing', columnU: 5, rowU: 0, rotation: 0 });
  plan.placements.push({ id: 'blocker', placeableId: 'couch_001', columnU: 2, rowU: 2, rotation: 0 });
  const codes = auditLotPlan(plan, CATALOG).map((f) => f.code);
  assert(codes.includes('placement-overlap'), `overlap missing in ${codes.join(',')}`);
  assert(codes.includes('placement-unknown-placeable'), 'unknown placeable missing');
  assert(codes.includes('placement-blocks-door'), 'door block missing');
});

test('wall-mounted placeables demand a wall behind them', () => {
  const plan = bedroomPlan();
  plan.placements.push({ id: 'tv-good', placeableId: 'tv_001', columnU: 0, rowU: 0, rotation: 0 });
  plan.placements.push({ id: 'tv-floating', placeableId: 'tv_001', columnU: 4, rowU: 1, rotation: 0 });
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

test('the percept summarizes measured facts and renders the plan', () => {
  const plan = bedroomPlan();
  plan.placements.push({ id: 'bed', placeableId: 'bed_king', columnU: 0, rowU: 0, rotation: 0 });
  const summary = summarizeLotPlan(plan, CATALOG);
  equal(summary.rooms[0]!.areaU2, 12, 'bedroom area');
  equal(summary.placements[0]!.footprintU!.widthU, 2, 'measured footprint');
  equal(summary.findings.length, 0, 'clean audit');
  const ascii = renderLotPlanAscii(plan, CATALOG);
  assert(ascii.includes('D'), 'door drawn');
  assert(ascii.includes('a '), 'placement glyph drawn');
  assert(ascii.includes('King Bed · 2×3 u'), 'legend carries the measured size');
  assert(ascii.includes('│'), 'walls drawn');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
