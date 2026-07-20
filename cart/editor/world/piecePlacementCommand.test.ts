// Pure world-piece command transaction tests.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/piecePlacementCommand.test.ts --bundle \
//     --outfile=/tmp/editor-piece-placement-command.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-piece-placement-command.test.js
import {
  PiecePlacementRejected,
  WORLD_PIECE_PLACEMENT_LIMITS,
  applyPiecePlacementForward,
  applyPiecePlacementInverse,
  planPiecePlacement,
  type PiecePlacementCandidate,
  type PiecePlacementPolicy,
  type PiecePlacementWorld,
} from './piecePlacementCommand';
import { RUN_PLACEMENT_CAP, type PlacedPiece } from './pieces';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
function same(a: unknown, b: unknown, message: string) {
  const aa = JSON.stringify(a), bb = JSON.stringify(b);
  if (aa !== bb) throw new Error(`${message}\n  got ${aa}\n want ${bb}`);
}

const KNOWN = new Set(['floor.concrete.common', 'wall.concrete.common']);
const policy: PiecePlacementPolicy = {
  makePieceId: (sequence) => `bp_${sequence}`,
  validateCandidate: (candidate, index) => {
    if (!KNOWN.has(candidate.pieceId)) {
      throw new PiecePlacementRejected('invalid-candidate', `unknown piece '${candidate.pieceId}'`, index);
    }
  },
};

function candidate(
  x: number,
  z: number,
  extra: Partial<PiecePlacementCandidate> = {},
): PiecePlacementCandidate {
  return { pieceId: 'floor.concrete.common', x, y: 0, z, yawDegrees: 0, floor: 0, ...extra };
}

function piece(id: string, x: number, z: number, extra: Partial<PlacedPiece> = {}): PlacedPiece {
  return { id, pieceId: 'floor.concrete.common', x, y: 0, z, yawDegrees: 0, floor: 0, ...extra };
}

function world(pieces: readonly PlacedPiece[] = [], nextPieceId = 1): PiecePlacementWorld {
  return { documentId: 'main', pieces, selectedPieceId: pieces[0]?.id ?? null, nextPieceId };
}

test('one click produces one applied transaction with authority-owned identity', () => {
  const before = world([], 7);
  const plan = planPiecePlacement(before, {
    documentId: 'main',
    candidates: [candidate(1.5, 4.5, { id: '' })],
    gestureMode: 'click',
  }, policy);
  assert(plan.transaction.commandId === 'world.pieces.place', 'stable command identity missing');
  assert(plan.transaction.action === 'place', 'empty footprint was classified as replacement');
  assert(plan.transaction.placed.length === 1 && plan.transaction.placed[0]!.id === 'bp_7', 'authority did not mint bp_7');
  assert(plan.next.pieces.length === 1 && plan.next.selectedPieceId === 'bp_7', 'placed piece/selection did not apply');
  assert(plan.next.nextPieceId === 8, 'allocator did not advance once');
  assert(before.pieces.length === 0 && before.nextPieceId === 7, 'planner mutated its input');
});

test('a drag-run remains one transaction while allocating one stable id per piece', () => {
  const plan = planPiecePlacement(world([], 20), {
    documentId: 'main',
    candidates: [candidate(1.5, 1.5), candidate(4.5, 1.5), candidate(7.5, 1.5)],
    gestureMode: 'drag-run',
  }, policy);
  same(plan.transaction.placed.map((p) => p.id), ['bp_20', 'bp_21', 'bp_22'], 'drag-run ids drifted');
  assert(plan.transaction.gestureMode === 'drag-run' && plan.transaction.forward.append.length === 3, 'drag-run split into another shape');
  assert(plan.next.nextPieceId === 23, 'drag-run allocator depth is wrong');
});

test('scene-sized composition batches are not clipped to the pointer drag-run budget', () => {
  assert(WORLD_PIECE_PLACEMENT_LIMITS.maxBatchSize > RUN_PLACEMENT_CAP, 'composition and drag-run budgets collapsed together');
  const candidates = Array.from({ length: RUN_PLACEMENT_CAP + 1 }, (_, index) => candidate(index * 3 + 1.5, 1.5));
  const plan = planPiecePlacement(world([], 100), {
    documentId: 'main',
    candidates,
    gestureMode: 'click',
  }, policy);
  assert(plan.transaction.placed.length === RUN_PLACEMENT_CAP + 1, 'scene-sized composition was clipped at the drag-run cap');
});

test('copy/prefab candidates retain and detach semantic attachments', () => {
  const surfaceFlora = [{
    id: 'surface-flora-1', speciesId: 'builtin-flora:grassLush', role: 'flora_1', triangle: 0,
    lx: 0.2, ly: 0.4, lz: 0.3, density: 0.5, radiusM: 1, seed: 7,
  }];
  const stickers = [{
    id: 'sticker-1', stickerId: 'logo', role: 'front', lx: 0, ly: 1, lz: 0,
    nx: 0, ny: 0, nz: -1, scale: 1, rot: 0,
  }];
  const plan = planPiecePlacement(world([], 12), {
    documentId: 'main',
    candidates: [candidate(1.5, 1.5, { surfaceFlora, stickers, spinDegPerSec: 45 })],
    gestureMode: 'click',
  }, policy);
  const placed = plan.transaction.placed[0]!;
  assert(placed.surfaceFlora?.[0]?.speciesId === 'builtin-flora:grassLush', 'surface flora was dropped');
  assert(placed.stickers?.[0]?.stickerId === 'logo' && placed.spinDegPerSec === 45, 'sticker/spin was dropped');
  assert(placed.surfaceFlora !== surfaceFlora && placed.surfaceFlora?.[0] !== surfaceFlora[0], 'surface recipes retained mutable source references');
  assert(placed.stickers !== stickers && placed.stickers?.[0] !== stickers[0], 'stickers retained mutable source references');
});

test('replacement inverse restores full victims, selection, and exact original order', () => {
  const victimA = piece('old-a', 1.5, 1.5, {
    slots: { top: { assetId: 'mat-marble' } },
    overrides: { friction: 0.25, walkable: true },
  });
  const keep = piece('keep', 10.5, 10.5);
  const victimB = piece('old-b', 4.5, 1.5, {
    slots: { top: { fn: 'tile-terrazzo', variant: 3 } },
    overrides: { opacity: 0.7 },
  });
  const tail = piece('tail', 13.5, 10.5);
  const before: PiecePlacementWorld = {
    documentId: 'main',
    pieces: [victimA, keep, victimB, tail],
    selectedPieceId: 'keep',
    nextPieceId: 30,
  };
  const plan = planPiecePlacement(before, {
    documentId: 'main',
    candidates: [candidate(1.5, 1.5), candidate(4.5, 1.5)],
    gestureMode: 'drag-run',
  }, policy);
  assert(plan.transaction.action === 'replace', 'collision was not classified as replacement');
  same(plan.transaction.removed.map((row) => ({ index: row.index, piece: row.piece })), [
    { index: 0, piece: victimA },
    { index: 2, piece: victimB },
  ], 'inverse omitted victim content or source ordering');
  same(plan.next.pieces.map((p) => p.id), ['keep', 'tail', 'bp_30', 'bp_31'], 'forward replacement order changed');

  const undone = applyPiecePlacementInverse(plan.next, plan.transaction);
  same(undone.pieces, before.pieces, 'undo did not restore exact full world list');
  assert(undone.selectedPieceId === 'keep', 'undo did not restore prior local selection');
  assert(undone.nextPieceId === 32, 'undo rewound the monotonic allocator');

  const redone = applyPiecePlacementForward(undone, plan.transaction);
  same(redone.pieces, plan.next.pieces, 'redo did not reapply the identical assigned ids/content');
  assert(redone.nextPieceId === 32, 'redo advanced the allocator a second time');

  const subsequent = planPiecePlacement(redone, {
    documentId: 'main', candidates: [candidate(7.5, 1.5)], gestureMode: 'click',
  }, policy);
  assert(subsequent.transaction.placed[0]!.id === 'bp_32', 'post-undo placement reused an old id');
});

test('different semantic footprint classes coexist at the same position', () => {
  const wall = piece('wall-1', 1.5, 0, { pieceId: 'wall.concrete.common' });
  const plan = planPiecePlacement(world([wall], 2), {
    documentId: 'main', candidates: [candidate(1.5, 0)], gestureMode: 'click',
  }, policy);
  assert(plan.transaction.removed.length === 0, 'floor incorrectly replaced a wall footprint');
  same(plan.next.pieces.map((p) => p.id), ['wall-1', 'bp_2'], 'coexisting wall/floor did not survive');
});

test('duplicate submitted footprints reject the whole batch without allocation', () => {
  const before = world([], 5);
  let error: unknown;
  try {
    planPiecePlacement(before, {
      documentId: 'main', candidates: [candidate(1.5, 1.5), candidate(1.5, 1.5)], gestureMode: 'drag-run',
    }, policy);
  } catch (caught) { error = caught; }
  assert(error instanceof PiecePlacementRejected && error.code === 'duplicate-footprint', 'duplicate footprint was not rejected precisely');
  assert(before.nextPieceId === 5 && before.pieces.length === 0, 'rejected batch mutated/allocated world state');
});

test('wrong document, malformed candidates, and semantic rejection never produce a plan', () => {
  const before = world([], 9);
  const cases: Array<{ args: any; code: string }> = [
    { args: { documentId: 'other', candidates: [candidate(1.5, 1.5)], gestureMode: 'click' }, code: 'wrong-document' },
    { args: { documentId: 'main', candidates: [{ ...candidate(1.5, 1.5), x: Number.NaN }], gestureMode: 'click' }, code: 'invalid-candidate' },
    { args: { documentId: 'main', candidates: [candidate(1.5, 1.5, { floor: 129 })], gestureMode: 'click' }, code: 'invalid-candidate' },
    { args: { documentId: 'main', candidates: [candidate(1.5, 1.5, { pieceId: 'unknown.piece' })], gestureMode: 'click' }, code: 'invalid-candidate' },
  ];
  for (const row of cases) {
    let error: unknown;
    try { planPiecePlacement(before, row.args, policy); } catch (caught) { error = caught; }
    assert(error instanceof PiecePlacementRejected && error.code === row.code, `expected ${row.code}, got ${(error as any)?.code}`);
  }
  assert(before.nextPieceId === 9 && before.pieces.length === 0, 'rejection changed the source world');
});

test('allocator collisions reject instead of silently minting divergent ids', () => {
  const before = world([piece('bp_10', 20, 20)], 10);
  let error: unknown;
  try {
    planPiecePlacement(before, {
      documentId: 'main', candidates: [candidate(1.5, 1.5)], gestureMode: 'click',
    }, policy);
  } catch (caught) { error = caught; }
  assert(error instanceof PiecePlacementRejected && error.code === 'id-collision', 'id collision was not rejected');
  assert(before.nextPieceId === 10 && before.pieces.length === 1, 'collision mutated allocator/world');
});

test('stale redo rejects when an expected replacement victim is missing', () => {
  const victim = piece('victim', 1.5, 1.5);
  const plan = planPiecePlacement(world([victim], 40), {
    documentId: 'main', candidates: [candidate(1.5, 1.5)], gestureMode: 'click',
  }, policy);
  const undone = applyPiecePlacementInverse(plan.next, plan.transaction);
  const stale = { ...undone, pieces: [] };
  let error: unknown;
  try { applyPiecePlacementForward(stale, plan.transaction); } catch (caught) { error = caught; }
  assert(error instanceof PiecePlacementRejected && error.code === 'stale-patch', 'stale redo silently produced another world');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
