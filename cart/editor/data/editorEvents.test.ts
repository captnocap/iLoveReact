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
import { commandOutcome, dispatchColorStudioActionOutcome, dispatchCommandOutcome, dispatchModelOutlinerActionOutcome, mapPaint, pieceEdit, pieceEditPayload, pieceMaterial, pieceMaterialPayload, piecePlace, piecePlacementPayload, type MapPaintPayload, type MaterialStudioPayload, type ModelOutlinerPayload, type PaletteStudioPayload } from './editorEvents';
import { planPieceMaterialAssign, planPieceMove } from '../world/pieceEditCommand';
import { planPiecePlacement } from '../world/piecePlacementCommand';
import { planPaletteLoad, planSlotFill, type ColorStudioPolicy, type ColorStudioSnapshot } from '../material/colorStudioCommand';
import { modelPartRecords, planPartsGroup } from '../model/outlinerCommand';

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

const studioPolicy: ColorStudioPolicy = {
  qualityCount: 5,
  seedMax: 2200,
  spec: (id) => id === 'brick' ? {
    id: 'brick', label: 'Brick', variants: [{ label: 'Clean' }],
    slots: [{ name: 'Mortar', baked: [0.6, 0.6, 0.6] }],
  } : null,
};
const studioSnapshot: ColorStudioSnapshot = {
  materialId: 'brick', variant: 0, seed: 4, quality: 3, activeSlot: 0,
  view: 'materialPalette', currentColor: { l: 0.6, c: 0.1, h: 20 }, scenePick: null,
  overrides: {}, palette: [{ l: 0.5, c: 0.1, h: 10 }],
};

test('Color Studio material actions emit one typed replay-grade transaction', () => {
  const plan = planSlotFill(studioSnapshot, {
    specId: 'brick', variant: 0, slot: 0, rgb: [0.2, 0.3, 0.4], source: 'hex #334d66',
  }, studioPolicy);
  const before = head();
  dispatchColorStudioActionOutcome({
    invocationId: 'studio:fill:1', commandId: 'material.slot.fill', actionId: 'studio:fill:1',
    source: 'viewport', status: 'applied', phase: 'applied', effect: 'action',
    undoScope: { kind: 'workspace', key: 'color-studio' },
    result: { plan, applyStartedAtMs: 100, appliedAtMs: 102, applyMs: 2 },
  });
  const appended = since(before);
  assert(appended.length === 1, `slot fill appended ${appended.length} reports`);
  const event = appended[0]!;
  assert(event.type === 'material.edit' && event.commandId === 'material.slot.fill', 'slot fill fell back to a generic receipt');
  assert(event.actionId === 'studio:fill:1' && event.targets.some((target) => target.id === 'brick:0:0'), 'slot action identity/target drifted');
  const payload = event.payload as MaterialStudioPayload;
  assert(payload.transaction.action === 'slot.fill' && payload.transaction.before === null && payload.transaction.after[1] === 0.3, 'exact forward/inverse colors left the report');
  assert(describeEvent(event) === 'fill Brick Mortar', `material description drifted: ${describeEvent(event)}`);
});

test('Color Studio palette replacement emits its exact prior and next trays', () => {
  const plan = planPaletteLoad(studioSnapshot, {
    setName: 'Dune Dusk', colors: [{ l: 0.2, c: 0.05, h: 30 }, { l: 0.9, c: 0.02, h: 80 }],
  });
  const before = head();
  dispatchColorStudioActionOutcome({
    invocationId: 'studio:palette:1', commandId: 'studio.palette.load', actionId: 'studio:palette:1',
    source: 'toolbar', status: 'applied', phase: 'applied', effect: 'action',
    undoScope: { kind: 'workspace', key: 'color-studio' },
    result: { plan, applyStartedAtMs: 200, appliedAtMs: 201, applyMs: 1 },
  });
  const event = since(before)[0]!;
  assert(event.type === 'palette.edit' && event.targets[0]?.id === 'color-studio-tray', 'palette action used the wrong typed target');
  const payload = event.payload as PaletteStudioPayload;
  assert(payload.transaction.action === 'palette.load' && payload.transaction.before.palette.length === 1 && payload.transaction.after.palette.length === 2, 'palette inverse left the report');
  assert(describeEvent(event) === 'load Dune Dusk palette', `palette description drifted: ${describeEvent(event)}`);
});

test('model organization emits one typed native-journal transaction', () => {
  const plan = planPartsGroup({
    modelId: 'bridge-model',
    nextSequence: 9,
    parts: modelPartRecords([
      { id: 'deck', name: 'Deck', visible: true, color: '#999999', lo: 0, hi: 4 },
      { id: 'rail', name: 'Rail', visible: true, color: '#aaaaaa', lo: 4, hi: 8 },
    ]),
  }, { modelId: 'bridge-model', partIds: ['deck', 'rail'] });
  const before = head();
  dispatchModelOutlinerActionOutcome({
    invocationId: 'model:group:1', commandId: 'model.parts.group', actionId: 'model:group:1',
    source: 'dock', status: 'applied', phase: 'applied', effect: 'action',
    undoScope: { kind: 'native', key: 'model' },
    result: { plan, applyStartedAtMs: 300, appliedAtMs: 301, applyMs: 1 },
  });
  const appended = since(before);
  assert(appended.length === 1, `model group appended ${appended.length} reports`);
  const event = appended[0]!;
  assert(event.type === 'model.structure' && event.actionId === 'model:group:1', 'model action fell back to a generic receipt');
  assert(event.undoScope?.kind === 'native' && event.targets.some((target) => target.id === 'part-group:9'), 'native scope/group target drifted');
  const payload = event.payload as ModelOutlinerPayload;
  assert(payload.transaction.before.every((row) => !row.groupId) && payload.transaction.after.every((row) => row.groupId === 'part-group:9'), 'exact group inverse left the report');
  assert(describeEvent(event) === 'group 2 parts as Group 1', `model description drifted: ${describeEvent(event)}`);
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
