// Pure world-piece edit transaction tests.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/pieceEditCommand.test.ts --bundle \
//     --outfile=/tmp/editor-piece-edit-command.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-piece-edit-command.test.js
import {
  PieceEditRejected,
  applyPieceEditForward,
  applyPieceEditInverse,
  planPieceDelete,
  planPieceMove,
  planPieceRotate,
  type PieceEditWorld,
} from './pieceEditCommand';
import type { PlacedPiece } from './pieces';

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

function piece(id: string, x: number, extra: Partial<PlacedPiece> = {}): PlacedPiece {
  return {
    id, pieceId: 'floor.concrete.common', x, y: 0, z: 1.5, yawDegrees: 0, floor: 0,
    ...extra,
  };
}

function world(pieces: readonly PlacedPiece[], selectedPieceId = pieces[0]?.id ?? null): PieceEditWorld {
  return { documentId: 'main', pieces, selectedPieceId };
}

test('move owns destination replacement and restores exact content/order on undo', () => {
  const beforePiece = piece('moving', 1.5, {
    slots: { top: { assetId: 'marble' } },
    overrides: { friction: 0.25 },
    stickers: [{ id: 's1', stickerId: 'logo', role: 'top', lx: 0, ly: 0, lz: 0, nx: 0, ny: 1, nz: 0, scale: 1, rot: 0 }],
  });
  const keep = piece('keep', 10.5);
  const victim = piece('victim', 4.5, { slots: { top: { fn: 'tiles', variant: 3 } } });
  const before = world([beforePiece, keep, victim], 'keep');
  const plan = planPieceMove(before, {
    documentId: 'main', pieceId: 'moving',
    transform: { x: 4.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 },
  });

  assert(plan.transaction.commandId === 'world.piece.move', 'stable move identity missing');
  assert(plan.transaction.replaced[0]?.piece.id === 'victim', 'destination victim was not captured');
  same(plan.next.pieces.map((p) => p.id), ['keep', 'moving'], 'move did not reproduce current append policy');
  assert(plan.next.pieces[1]?.slots?.top && plan.next.pieces[1]?.stickers?.[0]?.id === 's1', 'semantic piece payload was lost');

  const undone = applyPieceEditInverse(plan.next, plan.transaction);
  same(undone, before, 'move undo did not restore exact list/content/selection');
  const redone = applyPieceEditForward(undone, plan.transaction);
  same(redone, plan.next, 'move redo did not reproduce the same transaction');
});

test('rotate changes only yaw, replaces its edge destination, and round-trips exact rows', () => {
  const original = piece('wall', 1.5, {
    pieceId: 'wall.concrete.common', yawDegrees: 270,
    slots: { sides: { assetId: 'paint' } }, overrides: { opacity: 0.8 },
  });
  const victim = piece('edge-victim', 1.5, { pieceId: 'wall.concrete.common', yawDegrees: 0 });
  const before = world([victim, piece('keep', 9), original], 'wall');
  const plan = planPieceRotate(before, { documentId: 'main', pieceId: 'wall', quarterTurns: 1 });
  assert(plan.transaction.commandId === 'world.piece.rotate' && plan.transaction.after?.yawDegrees === 0, 'quarter turn did not wrap');
  assert(plan.transaction.replaced[0]?.piece.id === 'edge-victim', 'rotated edge did not own destination replacement');
  same(plan.next.pieces.map((p) => p.id), ['keep', 'wall'], 'rotate changed source order or kept destination victim');
  assert(plan.next.pieces[1]?.slots?.sides && plan.next.pieces[1]?.overrides?.opacity === 0.8, 'rotate erased authored data');
  same(applyPieceEditInverse(plan.next, plan.transaction), before, 'rotate undo drifted');
});

test('delete captures the complete row and its original index', () => {
  const target = piece('target', 4.5, { slots: { top: { assetId: 'kept' } } });
  const before = world([piece('head', 1.5), target, piece('tail', 7.5)], 'target');
  const plan = planPieceDelete(before, { documentId: 'main', pieceId: 'target' });
  assert(plan.transaction.commandId === 'world.piece.delete' && plan.transaction.before.index === 1, 'delete inverse omitted source index');
  same(plan.next.pieces.map((p) => p.id), ['head', 'tail'], 'delete removed the wrong row');
  same(applyPieceEditInverse(plan.next, plan.transaction), before, 'delete undo did not restore exact row/order/selection');
});

test('command args cannot alter piece identity, slots, overrides, or stickers during move', () => {
  const original = piece('safe', 1.5, { slots: { top: { assetId: 'truth' } }, overrides: { walkable: true } });
  const plan = planPieceMove(world([original]), {
    documentId: 'main', pieceId: 'safe',
    transform: { x: 7.5, y: 3, z: 4.5, yawDegrees: 90, floor: 1 },
  });
  const moved = plan.next.pieces[0]!;
  assert(moved.id === 'safe' && moved.pieceId === original.pieceId, 'move changed identity');
  same(moved.slots, original.slots, 'move changed slots');
  same(moved.overrides, original.overrides, 'move changed overrides');
});

test('wrong document, missing target, malformed transform, no-op, and stale replay reject', () => {
  const before = world([piece('one', 1.5)]);
  const calls: Array<() => unknown> = [
    () => planPieceDelete(before, { documentId: 'other', pieceId: 'one' }),
    () => planPieceRotate(before, { documentId: 'main', pieceId: 'gone', quarterTurns: 1 }),
    () => planPieceMove(before, { documentId: 'main', pieceId: 'one', transform: { x: Number.NaN, y: 0, z: 0, yawDegrees: 0, floor: 0 } }),
    () => planPieceMove(before, { documentId: 'main', pieceId: 'one', transform: { x: 1.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 } }),
    () => planPieceDelete(world([{ ...piece('bad', 1.5), yawDegrees: Number.NaN }]), { documentId: 'main', pieceId: 'bad' }),
  ];
  for (const call of calls) {
    let error: unknown;
    try { call(); } catch (caught) { error = caught; }
    assert(error instanceof PieceEditRejected, 'invalid edit did not reject at the pure boundary');
  }
  const deleted = planPieceDelete(before, { documentId: 'main', pieceId: 'one' });
  let stale: unknown;
  try { applyPieceEditForward(deleted.next, deleted.transaction); } catch (caught) { stale = caught; }
  assert(stale instanceof PieceEditRejected && stale.code === 'stale-patch', 'stale replay silently diverged');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
