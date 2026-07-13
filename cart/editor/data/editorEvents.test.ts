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

import { describeEvent } from '../../../runtime/editorbus';
import { commandOutcome, draftPiecePlacementEvent, finalizePiecePlacementEvent, mapPaint, piecePlace, type MapPaintPayload } from './editorEvents';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

test('piece.place payload describes the placed floor, not the selected material', () => {
  const draft = draftPiecePlacementEvent({
    placed: [{
      id: 'bp_7',
      pieceId: 'floor.concrete.common',
      x: 1.5,
      y: 0,
      z: 4.5,
      yawDegrees: 0,
      floor: 0,
    }],
    replaced: 0,
    gesture: { mode: 'click', inputAtMs: 1000, pointerX: 42, pointerY: 24 },
    applyMs: 2,
    committedAtMs: 1005,
  });
  const payload = finalizePiecePlacementEvent(draft, 1012);
  const event = piecePlace(payload, [{ kind: 'piece', id: 'bp_7' }]);

  assert(payload.pieceId === 'floor.concrete.common', 'semantic piece id carried');
  assert(payload.label === 'Concrete Floor', `catalog label carried, got ${payload.label}`);
  assert(payload.kind === 'floor', `piece kind carried, got ${payload.kind}`);
  assert(payload.material === 'concrete', `default piece material carried, got ${payload.material}`);
  assert(payload.positions[0]?.slotKey === 'grid:1.5,0,4.5', `slot key carried, got ${payload.positions[0]?.slotKey}`);
  assert(payload.inputToCommitMs === 5, `input→commit timing carried, got ${payload.inputToCommitMs}`);
  assert(payload.inputToMaterializedMs === 12, `input→materialized timing carried, got ${payload.inputToMaterializedMs}`);
  assert(payload.renderDeltaMs === 10, `render delta carried, got ${payload.renderDeltaMs}`);
  assert(describeEvent(event) === 'place Concrete Floor', `description uses piece label, got ${describeEvent(event)}`);
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

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
