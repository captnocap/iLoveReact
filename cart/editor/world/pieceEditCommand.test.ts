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
  applyPieceMaterialInverse,
  planPieceDelete,
  planPieceMaterialAssign,
  planPieceMaterialClear,
  planPieceMove,
  planPieceRotate,
  planPieceSpin,
  type PieceEditWorld,
  type PieceMaterialPolicy,
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

const materialPolicy: PieceMaterialPolicy = {
  materialAssetExists: (id) => id === 'mat-red' || id === 'mat-blue',
  rolesForPiece: (pieceId) => pieceId.startsWith('wall.') ? ['front', 'back', 'sides'] : ['top', 'bottom', 'edges'],
};

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

test('move transform carries the gizmo scale and preserves it when absent (req_3367)', () => {
  const prop = piece('lamp', 1.5, { pieceId: 'prop.streetlamp.common', scale: 2 });
  const before = world([prop], 'lamp');
  // Scale-only change is a real transaction…
  const scalePlan = planPieceMove(before, {
    documentId: 'main', pieceId: 'lamp',
    transform: { x: 1.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0, scale: 0.5 },
  });
  assert(scalePlan.transaction.after?.scale === 0.5, 'scale did not land on the transform');
  same(applyPieceEditInverse(scalePlan.next, scalePlan.transaction), before, 'scale undo drifted');
  // …an absent scale keeps the current one instead of resetting to 1…
  const movePlan = planPieceMove(before, {
    documentId: 'main', pieceId: 'lamp',
    transform: { x: 4.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 },
  });
  assert(movePlan.transaction.after?.scale === 2, 'plain move reset the piece scale');
  // …and identical transform + scale is no-change; invalid scale rejects.
  for (const bad of [
    () => planPieceMove(before, { documentId: 'main', pieceId: 'lamp', transform: { x: 1.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0, scale: 2 } }),
    () => planPieceMove(before, { documentId: 'main', pieceId: 'lamp', transform: { x: 1.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0, scale: 0 } }),
    () => planPieceMove(before, { documentId: 'main', pieceId: 'lamp', transform: { x: 1.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0, scale: Number.NaN } }),
  ]) {
    let rejected = false;
    try { bad(); } catch (error) { rejected = error instanceof PieceEditRejected; }
    assert(rejected, 'invalid/no-change scale transform was accepted');
  }
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

test('spin sets/clears only spinDegPerSec in place and round-trips exactly (req_3128)', () => {
  const target = piece('sign', 4.5, { slots: { top: { assetId: 'kept' } }, overrides: { walkable: true } });
  const before = world([piece('head', 1.5), target, piece('tail', 7.5)], 'tail');
  const plan = planPieceSpin(before, { documentId: 'main', pieceId: 'sign', spinDegPerSec: 45 });
  assert(plan.transaction.commandId === 'world.piece.spin' && plan.transaction.action === 'spin', 'stable spin identity missing');
  same(plan.next.pieces.map((p) => p.id), ['head', 'sign', 'tail'], 'spin churned list order');
  const spun = plan.next.pieces[1]!;
  assert(spun.spinDegPerSec === 45, 'spin rate did not land');
  assert(spun.x === target.x && spun.yawDegrees === target.yawDegrees, 'spin changed the transform');
  same(spun.slots, target.slots, 'spin changed slots');
  same(spun.overrides, target.overrides, 'spin changed overrides');
  assert(plan.transaction.replaced.length === 0, 'spin invented destination victims');
  same(applyPieceEditInverse(plan.next, plan.transaction), before, 'spin undo drifted');

  // Rate 0 CLEARS the field (a stopped sign persists as a plain piece).
  const stopPlan = planPieceSpin(plan.next, { documentId: 'main', pieceId: 'sign', spinDegPerSec: 0 });
  assert(!('spinDegPerSec' in stopPlan.next.pieces[1]!), 'stop did not clear the field');

  // No-change and non-finite rates reject.
  let rejected = 0;
  try { planPieceSpin(plan.next, { documentId: 'main', pieceId: 'sign', spinDegPerSec: 45 }); }
  catch (e) { if (e instanceof PieceEditRejected && e.code === 'no-change') rejected += 1; }
  try { planPieceSpin(before, { documentId: 'main', pieceId: 'sign', spinDegPerSec: Number.NaN }); }
  catch (e) { if (e instanceof PieceEditRejected && e.code === 'invalid-args') rejected += 1; }
  assert(rejected === 2, 'spin accepted a no-op or a non-finite rate');
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

test('one face-paint gesture becomes one exact multi-piece material transaction', () => {
  const first = piece('first', 1.5, { slots: { back: { assetId: 'mat-blue' } } });
  const second = piece('second', 4.5, { pieceId: 'wall.concrete.common', slots: { sides: { assetId: 'mat-blue' } } });
  const before = world([first, piece('keep', 3), second], 'keep');
  const plan = planPieceMaterialAssign(before, {
    documentId: 'main',
    materialAssetId: 'mat-red',
    targets: [
      { pieceId: 'first', roles: ['top', 'edges'] },
      { pieceId: 'second', roles: ['front'] },
      { pieceId: 'first', roles: ['top'] },
    ],
  }, materialPolicy);

  assert(plan.transaction.commandId === 'world.piece.material.assign', 'stable material command identity missing');
  assert(plan.transaction.assignments.length === 2 && plan.transaction.before.length === 2, 'stroke split or duplicated a target');
  assert(plan.next.pieces[0]?.slots?.top && 'assetId' in plan.next.pieces[0]!.slots!.top &&
    plan.next.pieces[0]!.slots!.top.assetId === 'mat-red', 'first face did not paint');
  assert(plan.next.pieces[2]?.slots?.front && plan.next.pieces[2]?.slots?.sides, 'second face paint erased another role');
  assert(plan.next.selectedPieceId === 'keep', 'paint changed selection');
  same(applyPieceMaterialInverse(plan.next, plan.transaction), before, 'paint undo did not restore exact pieces/order/selection');
});

test('assign-all expands semantic roles and clear-all removes only material slots', () => {
  const original = piece('wall', 1.5, {
    pieceId: 'wall.concrete.common',
    slots: { front: { assetId: 'mat-blue' } },
    overrides: { collision: true },
    stickers: [{ id: 's1', stickerId: 'logo', role: 'front', lx: 0, ly: 0, lz: 0, nx: 0, ny: 0, nz: 1, scale: 1, rot: 0 }],
  });
  const assigned = planPieceMaterialAssign(world([original]), {
    documentId: 'main', materialAssetId: 'mat-red', targets: [{ pieceId: 'wall', roles: 'all' }],
  }, materialPolicy);
  assert(Object.keys(assigned.next.pieces[0]?.slots ?? {}).length === 3, 'all did not expand the wall role grammar');
  const cleared = planPieceMaterialClear(assigned.next, {
    documentId: 'main', targets: [{ pieceId: 'wall', roles: 'all' }],
  }, materialPolicy);
  assert(cleared.next.pieces[0]?.slots === undefined, 'clear all left an empty slot shell');
  assert(cleared.next.pieces[0]?.overrides?.collision === true && cleared.next.pieces[0]?.stickers?.[0]?.id === 's1', 'clear all erased unrelated authored data');
});

test('unknown materials, unsupported roles, missing pieces, and no-op paints reject', () => {
  const before = world([piece('one', 1.5, { slots: { top: { assetId: 'mat-red' } } })]);
  const calls: Array<() => unknown> = [
    () => planPieceMaterialAssign(before, { documentId: 'main', materialAssetId: 'missing', targets: [{ pieceId: 'one', roles: ['top'] }] }, materialPolicy),
    () => planPieceMaterialAssign(before, { documentId: 'main', materialAssetId: 'mat-blue', targets: [{ pieceId: 'one', roles: ['front'] }] }, materialPolicy),
    () => planPieceMaterialClear(before, { documentId: 'main', targets: [{ pieceId: 'gone', roles: ['top'] }] }, materialPolicy),
    () => planPieceMaterialAssign(before, { documentId: 'main', materialAssetId: 'mat-red', targets: [{ pieceId: 'one', roles: ['top'] }] }, materialPolicy),
  ];
  for (const call of calls) {
    let error: unknown;
    try { call(); } catch (caught) { error = caught; }
    assert(error instanceof PieceEditRejected, 'invalid material edit crossed the pure boundary');
  }
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
