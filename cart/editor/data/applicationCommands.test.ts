// cart/editor/data/applicationCommands.test.ts — editor command-authority contract.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/applicationCommands.test.ts --bundle \
//     --outfile=/tmp/editor-application-commands.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-application-commands.test.js
import { type CommandOutcome, type CommandSource } from '../../../runtime/commands';
import {
  WORLD_FLOOR_STEP_COMMAND_ID,
  WORLD_MAX_FLOOR,
  WORLD_PIECE_DELETE_COMMAND_ID,
  WORLD_PIECE_MOVE_COMMAND_ID,
  WORLD_PIECE_ROTATE_COMMAND_ID,
  WORLD_PLACEMENT_ROTATE_COMMAND_ID,
  WORLD_SELECT_TOOL_COMMAND_ID,
  WORLD_TOOL_COMMAND_IDS,
  createEditorApplicationCommands,
  type EditorCommandAdapter,
  type WorldFloorStepResult,
  type WorldPieceEditResult,
  type WorldPiecesPlaceResult,
} from './applicationCommands';
import type { PiecePlacementWorld } from '../world/piecePlacementCommand';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function harness(
  startFloor = 0,
  surface = 'world',
  blocked: string | null = null,
  historyEntry: { label: string; actionId?: string; commandId?: string } | null = null,
  startTool = 'place-piece',
  startMapPaint = false,
  startWorld: PiecePlacementWorld = { documentId: 'main', pieces: [], selectedPieceId: null, nextPieceId: 1 },
) {
  let floor = startFloor;
  let commits = 0;
  let placementWorld: PiecePlacementWorld = startWorld;
  let undo = historyEntry ? [historyEntry] : [];
  let redo: typeof undo = [];
  let now = 1000;
  let activeTool = startTool;
  let mapPaintActive = startMapPaint;
  let ghostYawDegrees = 0;
  let committedActionId: string | null = null;
  const outcomes: CommandOutcome[] = [];
  const adapter: EditorCommandAdapter = {
    activeSurface: () => surface,
    blockedReason: () => blocked,
    floorIndex: () => floor,
    commitFloor: (result) => { floor = result.floorIndex; commits += 1; },
    worldTool: () => ({ activeCommandId: activeTool, mapPaintActive }),
    commitWorldTool: (result) => { activeTool = result.toolId; mapPaintActive = false; commits += 1; },
    placementGhost: () => ({
      activeCommandId: activeTool,
      armedPieceId: activeTool === 'place-piece' ? 'floor.concrete.common' : null,
      yawDegrees: ghostYawDegrees,
    }),
    commitPlacementGhostRotation: (result) => { ghostYawDegrees = result.yawDegrees; commits += 1; },
    placement: {
      read: () => placementWorld,
      policy: {
        makePieceId: (sequence) => `bp_${sequence}`,
        validateCandidate: (candidate) => {
          if (candidate.pieceId !== 'floor.concrete.common') throw new Error(`unknown piece '${candidate.pieceId}'`);
        },
      },
      now: () => now++,
      commit: (plan, actionId) => { placementWorld = plan.next; committedActionId = actionId; commits += 1; return now++; },
    },
    pieceEdit: {
      read: () => placementWorld,
      now: () => now++,
      commit: (plan, actionId) => {
        placementWorld = { ...placementWorld, ...plan.next };
        committedActionId = actionId;
        commits += 1;
        return now++;
      },
    },
    history: {
      peekUndo: () => undo[0] ?? null,
      peekRedo: () => redo[0] ?? null,
      commitUndo: () => {
        const entry = undo.shift()!;
        redo.unshift(entry);
        commits += 1;
        return { ...entry, direction: 'undo' as const, changedKeys: ['worldPieces'] };
      },
      commitRedo: () => {
        const entry = redo.shift()!;
        undo.unshift(entry);
        commits += 1;
        return { ...entry, direction: 'redo' as const, changedKeys: ['worldPieces'] };
      },
    },
  };
  return {
    commands: createEditorApplicationCommands(adapter, (outcome) => outcomes.push(outcome)),
    floor: () => floor,
    commits: () => commits,
    outcomes,
    pieces: () => placementWorld.pieces,
    undoDepth: () => undo.length,
    redoDepth: () => redo.length,
    activeTool: () => activeTool,
    mapPaintActive: () => mapPaintActive,
    ghostYaw: () => ghostYawDegrees,
    committedActionId: () => committedActionId,
  };
}

test('menu, hotkey, Section D, and remote use the same floor handler', () => {
  const sources: CommandSource[] = ['menu', 'hotkey', 'toolbar', 'remote'];
  for (const source of sources) {
    const h = harness(4);
    const outcome = h.commands.invoke<WorldFloorStepResult>({
      invocationId: `floor:${source}`,
      commandId: WORLD_FLOOR_STEP_COMMAND_ID,
      args: { delta: 1 },
      source,
    });
    assert(outcome.status === 'applied' && outcome.result.floorIndex === 5, `${source} result drifted`);
    assert(h.floor() === 5 && h.commits() === 1, `${source} did not commit exactly once`);
    assert(h.outcomes.length === 1 && h.outcomes[0] === outcome, `${source} did not publish exactly once`);
    assert(!('actionId' in outcome), 'report-only floor choice invented an action id');
  }
});

test('both directions use one symmetric wrap rule', () => {
  const down = harness(0);
  down.commands.invoke({ commandId: WORLD_FLOOR_STEP_COMMAND_ID, args: { delta: -1 }, source: 'toolbar' });
  assert(down.floor() === WORLD_MAX_FLOOR, 'down from Ground did not wrap to the highest storey');
  const up = harness(WORLD_MAX_FLOOR);
  up.commands.invoke({ commandId: WORLD_FLOOR_STEP_COMMAND_ID, args: { delta: 1 }, source: 'hotkey' });
  assert(up.floor() === 0, 'up from the highest storey did not wrap to Ground');
});

test('headless chord resolution returns the same inert command projection', () => {
  const h = harness();
  const byId = h.commands.command(WORLD_FLOOR_STEP_COMMAND_ID);
  assert(byId !== undefined && !('run' in byId), 'projection leaked a handler');
  assert(h.commands.commandsByMenu('Map')[0] === byId, 'menu projection identity drifted');
  assert(h.commands.resolveChord(']', { surface: 'world' }) === byId, 'world key projection drifted');
  assert(h.commands.resolveChord(']', { surface: 'model' }) === undefined, 'wrong mode resolved floor command');
  const toolChords = [
    ['Esc', 'select-tool'], ['B', 'place-piece'], ['V', 'move-selection'],
    ['F', 'focus-selection'], ['N', 'paint-faces'], ['K', 'place-sticker'],
  ];
  for (const [chord, id] of toolChords) {
    assert(h.commands.resolveChord(chord!, { surface: 'world' })?.id === id, `${chord} did not resolve ${id}`);
    assert(h.commands.resolveChord(chord!, { surface: 'model' }) === undefined, `${chord} leaked onto the model surface`);
  }
  assert(h.commands.resolveChord('R', { surface: 'world' })?.id === WORLD_PIECE_ROTATE_COMMAND_ID, 'R did not project authored rotate');
  assert(h.commands.resolveChord('Delete', { surface: 'world' })?.id === WORLD_PIECE_DELETE_COMMAND_ID, 'Delete did not project authored delete');
});

test('every source arms every world tool through one report-only handler', () => {
  for (const commandId of WORLD_TOOL_COMMAND_IDS) {
    for (const source of ['menu', 'hotkey', 'toolbar', 'remote'] as CommandSource[]) {
      const startTool = commandId === WORLD_SELECT_TOOL_COMMAND_ID ? 'paint-faces' : WORLD_SELECT_TOOL_COMMAND_ID;
      const h = harness(0, 'world', null, null, startTool, true);
      const outcome = h.commands.invoke({ commandId, args: {}, source });
      assert(outcome.status === 'applied' && outcome.effect === 'report-only', `${commandId}/${source} was not report-only`);
      assert(outcome.status === 'applied' && outcome.result.previousToolId === startTool, `${commandId}/${source} lost the prior tool`);
      assert(outcome.status === 'applied' && outcome.result.toolId === commandId, `${commandId}/${source} selected a second behavior`);
      assert(h.activeTool() === commandId && !h.mapPaintActive(), `${commandId}/${source} did not arm once and drop Map Paint`);
      assert(h.commits() === 1 && !('actionId' in outcome), `${commandId}/${source} invented an authored edit`);
      assert(h.outcomes.length === 1 && h.outcomes[0] === outcome, `${commandId}/${source} did not publish exactly once`);
    }
  }
});

test('Select never invents a material edit', () => {
  for (const source of ['hotkey', 'toolbar', 'remote'] as CommandSource[]) {
    const h = harness(0, 'world', null, null, 'paint-faces', true);
    const outcome = h.commands.invoke({ commandId: WORLD_SELECT_TOOL_COMMAND_ID, args: {}, source });
    assert(outcome.status === 'applied' && outcome.effect === 'report-only', `${source} was not report-only`);
    assert(outcome.status === 'applied' && outcome.result.previousToolId === 'paint-faces', `${source} lost the actual prior tool`);
    assert(h.activeTool() === WORLD_SELECT_TOOL_COMMAND_ID && !h.mapPaintActive(), `${source} did not reach the neutral tool`);
    assert(h.commits() === 1 && !('actionId' in outcome), `${source} invented an authored edit`);
    assert(JSON.stringify(outcome).toLowerCase().includes('material') === false, `${source} fabricated a material target`);
  }
});

test('re-arming any current tool is idempotent', () => {
  for (const commandId of WORLD_TOOL_COMMAND_IDS) {
    const h = harness(0, 'world', null, null, commandId, false);
    const outcome = h.commands.invoke({ commandId, args: {}, source: 'hotkey' });
    assert(outcome.status === 'applied' && outcome.result.changed === false, `${commandId} did not report a no-op`);
    assert(h.commits() === 0, `${commandId} committed repeated state`);
  }
});

test('invalid, blocked, and wrong-surface calls reject without mutation', () => {
  const invalid = harness(3);
  const bad = invalid.commands.invoke({ commandId: WORLD_FLOOR_STEP_COMMAND_ID, args: { delta: 2 }, source: 'remote' });
  assert(bad.status === 'rejected' && bad.code === 'invalid-args', 'invalid delta was not rejected');
  assert(invalid.floor() === 3 && invalid.commits() === 0, 'invalid delta mutated floor');

  const blocked = harness(3, 'world', 'Add Chunk');
  const no = blocked.commands.invoke({ commandId: WORLD_FLOOR_STEP_COMMAND_ID, args: { delta: 1 }, source: 'toolbar' });
  assert(no.status === 'rejected' && no.code === 'disabled', 'blocking overlay did not reject');
  assert(blocked.floor() === 3 && blocked.commits() === 0, 'blocked call mutated floor');

  const model = harness(3, 'model');
  const wrong = model.commands.invoke({ commandId: WORLD_FLOOR_STEP_COMMAND_ID, args: { delta: 1 }, source: 'hotkey' });
  assert(wrong.status === 'rejected' && wrong.code === 'disabled', 'wrong surface did not reject');
  assert(model.floor() === 3 && model.commits() === 0, 'wrong surface mutated floor');

  const extra = harness(0);
  const noisy = extra.commands.invoke({ commandId: WORLD_SELECT_TOOL_COMMAND_ID, args: { surprise: true }, source: 'remote' });
  assert(noisy.status === 'rejected' && noisy.code === 'invalid-args', 'no-argument command accepted an invented argument');
  assert(extra.commits() === 0, 'invalid tool args mutated state');
});

test('a headless viewport or remote peer commits the same authored placement once', () => {
  for (const source of ['viewport', 'remote'] as CommandSource[]) {
    const h = harness();
    const outcome = h.commands.invoke<WorldPiecesPlaceResult>({
      invocationId: `place:${source}`,
      commandId: 'world.pieces.place',
      args: {
        documentId: 'main',
        candidates: [{ id: '', pieceId: 'floor.concrete.common', x: 1.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 }],
        gesture: { mode: 'click', inputAtMs: 900, pointerX: 40, pointerY: 24 },
        stamp: { slots: { top: { assetId: 'mat-copy' } }, overrides: { friction: 0.4 } },
      },
      source,
    });
    assert(outcome.status === 'applied' && outcome.actionId === `place:${source}`, `${source} action id drifted`);
    assert(outcome.status === 'applied' && outcome.result.plan.transaction.placed[0]?.id === 'bp_1', `${source} transaction drifted`);
    assert(outcome.status === 'applied' && outcome.result.plan.transaction.placed[0]?.slots?.top &&
      'assetId' in outcome.result.plan.transaction.placed[0]!.slots!.top &&
      outcome.result.plan.transaction.placed[0]!.slots!.top.assetId === 'mat-copy', `${source} copy stamp disappeared`);
    assert(h.pieces().length === 1 && h.commits() === 1, `${source} did not commit exactly once`);
    assert(h.outcomes.length === 1 && h.outcomes[0] === outcome, `${source} did not publish exactly once`);
  }
});

const selectedPieceWorld: PiecePlacementWorld = {
  documentId: 'main',
  pieces: [{
    id: 'bp_7', pieceId: 'floor.concrete.common', x: 1.5, y: 0, z: 1.5,
    yawDegrees: 0, floor: 0, slots: { top: { assetId: 'mat-kept' } },
  }],
  selectedPieceId: 'bp_7',
  nextPieceId: 8,
};

test('menu, hotkey, Section D, context, and remote share one authored rotate action', () => {
  for (const source of ['menu', 'hotkey', 'toolbar', 'context-menu', 'remote'] as CommandSource[]) {
    const h = harness(0, 'world', null, null, 'select-tool', false, selectedPieceWorld);
    const outcome = h.commands.invoke<WorldPieceEditResult>({
      invocationId: `rotate:${source}`,
      commandId: WORLD_PIECE_ROTATE_COMMAND_ID,
      args: { documentId: 'main', pieceId: 'bp_7', quarterTurns: 1 },
      source,
    });
    assert(outcome.status === 'applied' && outcome.actionId === `rotate:${source}`, `${source} lost action identity`);
    assert(outcome.status === 'applied' && outcome.result.plan.transaction.action === 'rotate', `${source} ran another behavior`);
    assert(h.pieces()[0]?.yawDegrees === 90 && h.pieces()[0]?.slots?.top, `${source} did not preserve and rotate the piece`);
    assert(h.commits() === 1 && h.outcomes.length === 1, `${source} did not commit/publish exactly once`);
  }
});

test('viewport and remote move use the same replacement transaction', () => {
  const occupied: PiecePlacementWorld = {
    ...selectedPieceWorld,
    pieces: [
      ...selectedPieceWorld.pieces,
      { id: 'victim', pieceId: 'floor.concrete.common', x: 4.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 },
    ],
  };
  for (const source of ['viewport', 'remote'] as CommandSource[]) {
    const h = harness(0, 'world', null, null, 'move-selection', false, occupied);
    const outcome = h.commands.invoke<WorldPieceEditResult>({
      invocationId: `move:${source}`,
      commandId: WORLD_PIECE_MOVE_COMMAND_ID,
      args: {
        documentId: 'main', pieceId: 'bp_7',
        transform: { x: 4.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 },
      },
      source,
    });
    assert(outcome.status === 'applied' && outcome.result.plan.transaction.replaced[0]?.piece.id === 'victim', `${source} lost replacement`);
    assert(h.pieces().length === 1 && h.pieces()[0]?.id === 'bp_7' && h.pieces()[0]?.x === 4.5, `${source} world drifted`);
    assert(h.commits() === 1 && h.outcomes.length === 1, `${source} did not commit/publish exactly once`);
  }
});

test('Delete is an authored action while placement-preview rotation is report-only', () => {
  const deletion = harness(0, 'world', null, null, 'select-tool', false, selectedPieceWorld);
  const deleted = deletion.commands.invoke({
    invocationId: 'delete:context', actionId: 'piece-action:7', commandId: WORLD_PIECE_DELETE_COMMAND_ID,
    args: { documentId: 'main', pieceId: 'bp_7' }, source: 'context-menu',
  });
  assert(deleted.status === 'applied' && deleted.actionId === 'piece-action:7' && deleted.effect === 'action', 'delete lost authored identity');
  assert(deletion.committedActionId() === 'piece-action:7', 'delete committed under a different id than its outcome');
  assert(deletion.pieces().length === 0 && deletion.commits() === 1, 'delete did not commit once');

  const ghost = harness(0, 'world', null, null, 'place-piece');
  const turned = ghost.commands.invoke({ commandId: WORLD_PLACEMENT_ROTATE_COMMAND_ID, args: {}, source: 'hotkey' });
  assert(turned.status === 'applied' && turned.effect === 'report-only' && !('actionId' in turned), 'preview turn became authored history');
  assert(ghost.ghostYaw() === 90 && ghost.commits() === 1, 'preview did not turn once');
});

test('stale, wrong-document, no-op, and malformed piece edits reject before commit', () => {
  const h = harness(0, 'world', null, null, 'select-tool', false, selectedPieceWorld);
  const calls = [
    h.commands.invoke({ commandId: WORLD_PIECE_DELETE_COMMAND_ID, args: { documentId: 'other', pieceId: 'bp_7' }, source: 'remote' }),
    h.commands.invoke({ commandId: WORLD_PIECE_ROTATE_COMMAND_ID, args: { documentId: 'main', pieceId: 'gone', quarterTurns: 1 }, source: 'remote' }),
    h.commands.invoke({ commandId: WORLD_PIECE_MOVE_COMMAND_ID, args: { documentId: 'main', pieceId: 'bp_7', transform: { x: 1.5, y: 0, z: 1.5, yawDegrees: 0, floor: 0 } }, source: 'remote' }),
    h.commands.invoke({ commandId: WORLD_PIECE_ROTATE_COMMAND_ID, args: { documentId: 'main', pieceId: 'bp_7', quarterTurns: 2 }, source: 'remote' }),
  ];
  assert(calls.every((outcome) => outcome.status === 'rejected' && outcome.code === 'invalid-args'), 'invalid edit crossed authority');
  assert(h.commits() === 0 && h.pieces()[0]?.yawDegrees === 0, 'rejected edit mutated state');
});

test('undo and redo outcomes retain the authored action identity', () => {
  const entry = { label: 'place Concrete Floor', actionId: 'place:7', commandId: 'world.pieces.place' };
  const h = harness(0, 'world', null, entry);
  const undone = h.commands.invoke({
    invocationId: 'undo:1', commandId: 'world.history.undo', args: {}, source: 'hotkey',
    actionId: entry.actionId, causedBy: entry.actionId,
  });
  assert(undone.status === 'applied' && undone.phase === 'undone' && undone.actionId === entry.actionId, 'undo correlation drifted');
  assert(h.undoDepth() === 0 && h.redoDepth() === 1, 'undo did not move one history entry');

  const redone = h.commands.invoke({
    invocationId: 'redo:1', commandId: 'world.history.redo', args: {}, source: 'dock',
    actionId: entry.actionId, causedBy: entry.actionId,
  });
  assert(redone.status === 'applied' && redone.phase === 'redone' && redone.actionId === entry.actionId, 'redo correlation drifted');
  assert(h.undoDepth() === 1 && h.redoDepth() === 0, 'redo did not restore one history entry');
  assert(h.commits() === 2 && h.outcomes.length === 2, 'controls did not commit/publish exactly once each');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
