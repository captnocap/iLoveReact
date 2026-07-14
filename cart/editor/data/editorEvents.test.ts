// cart/editor/data/editorEvents.test.ts — placement events carry semantic piece
// truth, not the currently selected material asset.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/editorEvents.test.ts --bundle \
//     --outfile=/tmp/editor-events.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit/cameras=$ROOT/runtime/cameras \
//     --alias:@reactjit/geometries=$ROOT/runtime/geometries \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-events.test.js

import { describeEvent, head, since } from '../../../runtime/editorbus';
import { commandOutcome, dispatchCommandOutcome, mapPaint, pieceEdit, pieceEditPayload, pieceMaterial, pieceMaterialPayload, piecePlace, piecePlacementPayload, type MapPaintPayload } from './editorEvents';
import { planPieceMaterialAssign, planPieceMove } from '../world/pieceEditCommand';
import { planPiecePlacement } from '../world/piecePlacementCommand';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

test('piece.place payload describes the placed floor, not the selected material', () => {
  const plan = planPiecePlacement({ documentId: 'main', pieces: [], selectedPieceId: null, nextPieceId: 7 }, {
    documentId: 'main',
    candidates: [{ id: '', pieceId: 'floor.concrete.common', x: 1.5, y: 0, z: 4.5, yawDegrees: 0, floor: 0 }],
    gestureMode: 'click',
  }, {
    makePieceId: (sequence) => `bp_${sequence}`,
    validateCandidate: () => {},
  });
  const payload = piecePlacementPayload({
    plan,
    inputAtMs: 1000,
    pointerX: 42,
    pointerY: 24,
    applyStartedAtMs: 1004,
    appliedAtMs: 1005,
    applyMs: 1,
    inputToAppliedMs: 5,
  });
  const event = piecePlace(payload, [{ kind: 'piece', id: 'bp_7' }], {
    invocationId: 'place:7', commandId: 'world.pieces.place', actionId: 'place:7',
    source: 'viewport', phase: 'applied', effect: 'action', undoScope: { kind: 'document', key: 'world' },
  });

  assert(payload.pieceId === 'floor.concrete.common', 'semantic piece id carried');
  assert(payload.label === 'Concrete Floor', `catalog label carried, got ${payload.label}`);
  assert(payload.kind === 'floor', `piece kind carried, got ${payload.kind}`);
  assert(payload.material === 'concrete', `default piece material carried, got ${payload.material}`);
  assert(payload.positions[0]?.slotKey === 'grid:1.5,0,4.5', `slot key carried, got ${payload.positions[0]?.slotKey}`);
  assert(payload.inputToAppliedMs === 5, `input→apply timing carried, got ${payload.inputToAppliedMs}`);
  assert(payload.transaction.placed[0]?.id === 'bp_7' && payload.transaction.forward.append.length === 1, 'exact transaction carried');
  assert(event.actionId === 'place:7' && event.commandId === 'world.pieces.place', 'authority correlation carried');
  assert(describeEvent(event) === 'place Concrete Floor', `description uses piece label, got ${describeEvent(event)}`);
});

test('piece.edit payload carries the exact replacement transaction and authority identity', () => {
  const plan = planPieceMove({
    documentId: 'main',
    pieces: [
      { id: 'moving', pieceId: 'floor.concrete.common', x: 1.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 },
      { id: 'victim', pieceId: 'floor.concrete.common', x: 4.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 },
    ],
    selectedPieceId: 'moving',
  }, {
    documentId: 'main', pieceId: 'moving',
    transform: { x: 4.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 },
  });
  const payload = pieceEditPayload({ plan, applyStartedAtMs: 2000, appliedAtMs: 2002, applyMs: 2 });
  const event = pieceEdit(payload, [{ kind: 'piece', id: 'moving' }], {
    invocationId: 'move:1', commandId: 'world.piece.move', actionId: 'move:1',
    source: 'viewport', phase: 'applied', effect: 'action', undoScope: { kind: 'document', key: 'world' },
  });

  assert(payload.action === 'move' && payload.instanceId === 'moving', 'edit identity drifted');
  assert(payload.label === 'Concrete Floor' && payload.replaced === 1, 'semantic label/replacement count drifted');
  assert(payload.transaction.replaced[0]?.piece.id === 'victim', 'exact replacement victim left the report');
  assert(event.actionId === 'move:1' && event.commandId === 'world.piece.move', 'action correlation left the envelope');
  assert(describeEvent(event) === 'move Concrete Floor', `description drifted, got ${describeEvent(event)}`);
});

test('piece.material payload reports one batched face gesture with exact inverse data', () => {
  const plan = planPieceMaterialAssign({
    documentId: 'main',
    pieces: [
      { id: 'floor-a', pieceId: 'floor.concrete.common', x: 1.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 },
      { id: 'floor-b', pieceId: 'floor.concrete.common', x: 4.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 },
    ],
    selectedPieceId: null,
  }, {
    documentId: 'main', materialAssetId: 'a-brick',
    targets: [{ pieceId: 'floor-a', roles: ['top', 'edges'] }, { pieceId: 'floor-b', roles: ['top'] }],
  }, {
    materialAssetExists: (id) => id === 'a-brick',
    rolesForPiece: () => ['top', 'bottom', 'edges'],
  });
  const payload = pieceMaterialPayload({ plan, applyStartedAtMs: 3000, appliedAtMs: 3001, applyMs: 1 });
  const event = pieceMaterial(payload, [{ kind: 'piece', id: 'floor-a' }], {
    invocationId: 'paint:1', commandId: 'world.piece.material.assign', actionId: 'paint:1',
    source: 'viewport', phase: 'applied', effect: 'action', undoScope: { kind: 'document', key: 'world' },
  });

  assert(payload.pieceCount === 2 && payload.roleCount === 3, 'gesture counts split or drifted');
  assert(payload.materialAssetId === 'a-brick' && payload.transaction.before.length === 2, 'material/exact inverse left the payload');
  assert(event.actionId === 'paint:1' && event.commandId === 'world.piece.material.assign', 'material action correlation left the envelope');
  assert(describeEvent(event) === 'paint 3 faces Abalone Shell', `material description drifted, got ${describeEvent(event)}`);
});

test('map.paint payload describes native tile strokes with coordinates and timing', () => {
  const payload: MapPaintPayload = {
    action: 'stroke',
    label: 'paint tile Sidewalk',
    channel: 'tile',
    mode: 'paint',
    shape: 'circle',
    profile: 'flat',
    radiusM: 3,
    tileKind: 'sidewalk',
    tileLabel: 'Sidewalk',
    material: 'Sidewalk Pavers',
    start: { x: 4, z: 8 },
    end: { x: 12, z: 16 },
    samples: 2,
    stamps: 9,
    touchedChunks: 1,
    durationMs: 6,
    materializedAtMs: 2000,
    inputToMaterializedMs: 6,
    applyMs: 6,
    renderDeltaMs: 0,
  };
  const event = mapPaint(payload, [{ kind: 'map-channel', id: 'tile' }]);

  assert(describeEvent(event) === 'paint tile Sidewalk', `description uses map label, got ${describeEvent(event)}`);
  assert(payload.start?.x === 4 && payload.end?.z === 16, 'stroke coordinates carried');
  assert(payload.stamps === 9 && payload.touchedChunks === 1, 'stroke stats carried');
  assert(payload.inputToMaterializedMs === 6, `stroke timing carried, got ${payload.inputToMaterializedMs}`);
});

test('command outcomes persist identity and source in the common envelope', () => {
  const event = commandOutcome({
    status: 'applied',
    label: 'active floor → Floor 4',
    result: { previousFloorIndex: 3, floorIndex: 4 },
  }, [{ kind: 'view-floor', id: '4' }], {
    invocationId: 'editor:1:4',
    commandId: 'world.floor.step',
    source: 'toolbar',
    phase: 'applied',
    effect: 'report-only',
    undoScope: { kind: 'none' },
  });
  assert(event.commandId === 'world.floor.step' && event.invocationId === 'editor:1:4', 'command identity left the envelope');
  assert(event.source === 'toolbar' && event.phase === 'applied', 'source/phase left the envelope');
  assert(event.undoScope?.kind === 'none' && event.targets[0]?.id === '4', 'scope/target drifted');
  assert(describeEvent(event) === 'active floor → Floor 4', 'outcome description drifted');
});

test('tool authority outcomes append one correlated report to the eventbus', () => {
  const before = head();
  dispatchCommandOutcome({
    invocationId: 'editor:tool:9',
    commandId: 'paint-faces',
    source: 'toolbar',
    status: 'applied',
    phase: 'applied',
    effect: 'report-only',
    undoScope: 'none',
    result: { previousToolId: 'select-tool', toolId: 'paint-faces', mapPaintDropped: false, changed: true },
  }, {
    label: 'active tool → Paint Faces',
    targets: [{ kind: 'world-tool', id: 'paint-faces' }],
  });
  const appended = since(before);
  assert(appended.length === 1, `tool choice appended ${appended.length} reports`);
  const event = appended[0]!;
  assert(event.commandId === 'paint-faces' && event.source === 'toolbar', 'tool command/source correlation drifted');
  assert(event.effect === 'report-only' && event.undoScope?.kind === 'none', 'tool choice became authored history');
  assert(event.targets[0]?.kind === 'world-tool' && event.targets[0]?.id === 'paint-faces', 'tool target drifted');
  assert(describeEvent(event) === 'active tool → Paint Faces', 'tool report description drifted');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
