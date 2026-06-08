// twigrestore.test.ts — TWIGRESTORE-0606 camera/view relief slice.
//
// The user's immediate pain is camera reset on edit/hot reload. The route
// consumes runtime/workspace, so this pins the hot-current envelope that now
// restores before disk fallback.

import {
  buildEnvelope,
  createHistoryModel,
  parseEnvelope,
  serializeEnvelope,
  workspaceHotCurrentKey,
  workspaceHotHistoryKey,
  type HistorySnapshot,
  type SessionEnvelope,
} from '@reactjit/workspace';
import { piecesForMap, worldStream } from '@game';
import { openStore } from '../../data';
import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { createPaintHistory } from '../paint/history';
import { createSessionLog } from '../sessions';

declare const globalThis: any;

type View = { x: number; y: number; zoom: number };
type Payload = {
  view2d: View;
  cam: { x: number; y: number; z: number; yaw: number; pitch: number };
  world: { tag: string };
};

const CART = 'hmsc-int';
const VERSION = 2;
const ACTION_ROOT = 'zig-out/game/test-twigrestore-actions';

type PaintTraceDoc = { strokes: string[]; layers: string[] };

function env(tag: string, view: View): SessionEnvelope<Payload> {
  return buildEnvelope({
    cartName: CART,
    version: VERSION,
    stem: 'untitled',
    payload: {
      view2d: view,
      cam: { x: view.x, y: 12, z: view.y, yaw: 33, pitch: -8 },
      world: { tag },
    },
  });
}

function clonePaintTrace(doc: PaintTraceDoc): PaintTraceDoc {
  return { strokes: doc.strokes.slice(), layers: doc.layers.slice() };
}

function wipeActionScratch(): void {
  for (const path of [
    `${ACTION_ROOT}/store.db`, `${ACTION_ROOT}/store.db-wal`, `${ACTION_ROOT}/store.db-shm`,
    `${ACTION_ROOT}/streams/sessions.jsonl`, `${ACTION_ROOT}/streams/world.jsonl`,
    `${ACTION_ROOT}/snapshots/sessions.snapshot.json`, `${ACTION_ROOT}/snapshots/world.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

test('TWIGRESTORE-0606: hot current envelope restores exact camera/view before disk fallback', () => {
  const beforeEdit = env('before-edit', { x: 10, y: 20, zoom: 1 });
  const afterEdit = env('after-edit', { x: 123.25, y: -77.5, zoom: 2.5 });

  const disk = serializeEnvelope(beforeEdit);
  const hot = serializeEnvelope(afterEdit);
  const restored = parseEnvelope<Payload>(hot, { cartName: CART, version: VERSION });
  const staleDisk = parseEnvelope<Payload>(disk, { cartName: CART, version: VERSION });
  console.log(`[TWIGRESTORE-0606-CAMERA] hotKey=${workspaceHotCurrentKey(CART, VERSION)} view=${JSON.stringify(restored?.payload.view2d)} cam=${JSON.stringify(restored?.payload.cam)}`);

  assert(restored !== null && staleDisk !== null, 'both envelopes parse');
  assertEqual(JSON.stringify(restored!.payload.view2d), JSON.stringify(afterEdit.payload.view2d), 'hot reload restores the exact live 2D view');
  assertEqual(JSON.stringify(restored!.payload.cam), JSON.stringify(afterEdit.payload.cam), 'hot reload restores the exact live preview camera');
  assert(restored!.payload.view2d.x !== staleDisk!.payload.view2d.x, 'the hot envelope wins over stale disk autosave');
});

test('TWIGRESTORE-0606: undo history survives hot reload and restores exact pre-edit camera/view', () => {
  const beforeEdit = env('before-edit', { x: 1, y: 2, zoom: 1 });
  const afterEdit = env('after-edit', { x: 30, y: 40, zoom: 3 });
  let hotHistory: HistorySnapshot<SessionEnvelope<Payload>> | null = null;

  const history = createHistoryModel<SessionEnvelope<Payload>>({
    onChange: (snap) => { hotHistory = snap; },
  });
  history.commit(beforeEdit);
  const reloaded = createHistoryModel<SessionEnvelope<Payload>>({ initial: hotHistory });
  const undo = reloaded.undo(afterEdit);
  console.log(`[TWIGRESTORE-0606-UNDO] hotKey=${workspaceHotHistoryKey(CART, VERSION)} undoView=${JSON.stringify(undo?.payload.view2d)} redoDepth=${reloaded.snapshot().redo.length}`);

  assert(undo !== null, 'hot-reloaded history still has the edit boundary');
  assertEqual(JSON.stringify(undo!.payload.view2d), JSON.stringify(beforeEdit.payload.view2d), 'undo restores the exact pre-edit 2D view');
  assertEqual(JSON.stringify(undo!.payload.cam), JSON.stringify(beforeEdit.payload.cam), 'undo restores the exact pre-edit preview camera');
  assert(reloaded.canRedo(), 'undo fills redo after reload');
});

test('TWIGRESTORE-0606: committing after undo creates a branch and drops stale redo', () => {
  const base = env('base', { x: 0, y: 0, zoom: 1 });
  const firstBranch = env('first-branch', { x: 10, y: 0, zoom: 1.5 });
  const secondBranch = env('second-branch', { x: -10, y: 5, zoom: 2 });
  const history = createHistoryModel<SessionEnvelope<Payload>>();

  history.commit(base);
  const undo = history.undo(firstBranch);
  assert(undo !== null, 'undo returns to the branch base');
  assert(history.canRedo(), 'the abandoned branch is redoable before a new edit');
  history.commit(undo!);
  const redo = history.redo(secondBranch);
  assertEqual(redo, null, 'a new edit after undo drops the stale redo branch');
  assert(history.canUndo(), 'the new branch keeps its own undo point');
});

test('TWIGRESTORE-0606: undo action trace covers stroke, layer, and placement boundaries', () => {
  let paint: PaintTraceDoc = { strokes: [], layers: ['base'] };
  const paintHistory = createPaintHistory<PaintTraceDoc>();
  const completeStroke = (id: string): void => {
    const before = clonePaintTrace(paint);
    paint = { ...paint, strokes: paint.strokes.concat([id]) };
    paintHistory.commitSnapshot(before);
  };
  const addLayer = (name: string): void => {
    paintHistory.commit(() => clonePaintTrace(paint));
    paint = { ...paint, layers: paint.layers.concat([name]) };
  };

  completeStroke('stroke-1');
  completeStroke('stroke-2');
  completeStroke('stroke-3');
  addLayer('detail');
  const undoLayer = paintHistory.undo(() => clonePaintTrace(paint));
  assert(undoLayer !== null, 'the completed layer op created one undo entry');
  paint = undoLayer!;
  const undoStroke = paintHistory.undo(() => clonePaintTrace(paint));
  assert(undoStroke !== null, 'the completed stroke created one undo entry');
  paint = undoStroke!;

  wipeActionScratch();
  const store = openStore(ACTION_ROOT);
  const log = createSessionLog(store);
  const world = store.defineStream(worldStream);
  const ses = log.open('/build', world, 'ses-twig-actions');
  const firstPlacement = ses.commit(
    { kind: 'piecePlaced', mapName: 'trace-map', placement: { pieceId: 'floor.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0 } },
    'placed floor',
  );
  const secondPlacement = ses.commit(
    { kind: 'piecePlaced', mapName: 'trace-map', placement: { pieceId: 'wall.concrete.common', x: 3, y: 0, z: 0, yawDegrees: 0 } },
    'placed wall',
  );
  const beforeSecondPlacement = piecesForMap(world.stateAt(firstPlacement.globalSeq), 'trace-map').map((p) => p.pieceId);
  const afterSecondPlacement = piecesForMap(world.stateAt(secondPlacement.globalSeq), 'trace-map').map((p) => p.pieceId);
  const sessionLabels = log.state().sessions['ses-twig-actions'].commits.map((c) => c.label);

  console.log(`[TWIGRESTORE-0606-ACTION-TRACE] ${JSON.stringify({
    paint: {
      completed: ['stroke-1', 'stroke-2', 'stroke-3', 'layer:add detail'],
      afterUndoLayer: { strokes: undoLayer!.strokes, layers: undoLayer!.layers },
      afterUndoStroke: { strokes: undoStroke!.strokes, layers: undoStroke!.layers },
      canUndo: paintHistory.canUndo(),
      canRedo: paintHistory.canRedo(),
    },
    placement: {
      labels: sessionLabels,
      firstSeq: firstPlacement.globalSeq,
      secondSeq: secondPlacement.globalSeq,
      beforeSecondPlacement,
      afterSecondPlacement,
    },
  })}`);

  assertEqual(paint.layers.join(','), 'base', 'undoing the layer op removes only the added layer');
  assertEqual(paint.strokes.join(','), 'stroke-1,stroke-2', 'undoing one more step removes only the last completed stroke');
  assertEqual(sessionLabels.join('|'), 'placed floor|placed wall', 'each placement is one session undo marker');
  assertEqual(beforeSecondPlacement.join(','), 'floor.concrete.common', 'placement undo point before the second action has only the first piece');
  assertEqual(afterSecondPlacement.join(','), 'floor.concrete.common,wall.concrete.common', 'the second placement lands at the next undo point');
});

finish('editors/world/twigrestore');
