// cart/editor/data/applicationCommands.test.ts — editor command-authority contract.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/applicationCommands.test.ts --bundle \
//     --outfile=/tmp/editor-application-commands.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-application-commands.test.js
import { type CommandOutcome, type CommandSource } from '../../../runtime/commands';
import {
  COLOR_STUDIO_COLOR_SELECT_COMMAND_ID,
  COLOR_STUDIO_MATERIAL_SELECT_COMMAND_ID,
  COLOR_STUDIO_PALETTE_ADD_COMMAND_ID,
  COLOR_STUDIO_REDO_COMMAND_ID,
  COLOR_STUDIO_SLOT_FILL_COMMAND_ID,
  COLOR_STUDIO_UNDO_COMMAND_ID,
  COLOR_STUDIO_VARIANT_SELECT_COMMAND_ID,
  MODEL_GROUP_DISSOLVE_COMMAND_ID,
  MODEL_GROUP_RENAME_COMMAND_ID,
  MODEL_OUTLINER_MOVE_COMMAND_ID,
  MODEL_PART_RENAME_COMMAND_ID,
  MODEL_PARTS_GROUP_COMMAND_ID,
  MODEL_PARTS_UNGROUP_COMMAND_ID,
  WORLD_FLOOR_STEP_COMMAND_ID,
  WORLD_MAX_FLOOR,
  WORLD_PIECE_DELETE_COMMAND_ID,
  WORLD_PIECE_MOVE_COMMAND_ID,
  WORLD_PIECE_MATERIAL_ASSIGN_COMMAND_ID,
  WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID,
  WORLD_PIECE_ROTATE_COMMAND_ID,
  WORLD_PLACEMENT_ROTATE_COMMAND_ID,
  WORLD_SELECT_TOOL_COMMAND_ID,
  WORLD_TOOL_COMMAND_IDS,
  createEditorApplicationCommands,
  type EditorCommandAdapter,
  type WorldFloorStepResult,
  type WorldPieceEditResult,
  type WorldPieceMaterialResult,
  type WorldPiecesPlaceResult,
  type ModelOutlinerActionResult,
} from './applicationCommands';
import type { PiecePlacementWorld } from '../world/piecePlacementCommand';
import type { ColorStudioHistoryEntry, ColorStudioSnapshot } from '../material/colorStudioCommand';

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
  let studio: ColorStudioSnapshot = {
    materialId: 'brick', variant: 0, seed: 4, quality: 3, activeSlot: 0,
    view: 'materialPalette', currentColor: { l: 0.6, c: 0.1, h: 20 }, scenePick: null,
    overrides: {}, palette: [{ l: 0.5, c: 0.1, h: 10 }],
  };
  let studioUndo: ColorStudioHistoryEntry[] = [];
  let studioRedo: ColorStudioHistoryEntry[] = [];
  let modelOutliner = {
    modelId: 'model-a',
    nextSequence: 40,
    parts: [
      { id: 'part-a', name: 'Deck', visible: true, color: '#999999', lo: 0, hi: 4 },
      { id: 'part-b', name: 'Rail', visible: true, color: '#aaaaaa', lo: 4, hi: 8 },
      { id: 'part-c', name: 'Lamp', visible: true, color: '#bbbbbb', lo: 8, hi: 12 },
    ],
  };
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
    pieceMaterial: {
      read: () => placementWorld,
      policy: {
        materialAssetExists: (assetId) => assetId === 'mat-red' || assetId === 'mat-blue',
        rolesForPiece: (pieceId) => pieceId.startsWith('wall.') ? ['front', 'back', 'sides'] : ['top', 'bottom', 'edges'],
      },
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
    modelOutliner: {
      read: () => modelOutliner,
      now: () => now++,
      commit: (plan, actionId) => {
        modelOutliner = {
          modelId: plan.next.modelId,
          nextSequence: plan.next.nextSequence,
          parts: plan.next.parts.map((part) => ({ ...part })),
        };
        committedActionId = actionId;
        commits += 1;
        return now++;
      },
    },
    colorStudio: {
      read: () => studio,
      policy: {
        qualityCount: 5,
        seedMax: 2200,
        spec: (id) => id === 'brick' ? {
          id: 'brick', label: 'Brick', variants: [{ label: 'Clean' }, { label: 'Dirty' }],
          slots: [{ name: 'Mortar', baked: [0.6, 0.6, 0.6] }, { name: 'Face', baked: [0.7, 0.1, 0.05] }],
        } : id === 'metal' ? {
          id: 'metal', label: 'Metal', variants: [{ label: 'Plain' }],
          slots: [{ name: 'Base', baked: [0.4, 0.4, 0.4] }],
        } : null,
      },
      now: () => now++,
      commitChoice: (result) => {
        studio = { ...studio, ...result.patch };
        commits += 1;
      },
      commitAction: (plan, actionId) => {
        const commandId = plan.transaction.action === 'slot.fill'
          ? COLOR_STUDIO_SLOT_FILL_COMMAND_ID
          : plan.transaction.action === 'slots.reset'
            ? 'material.slots.reset'
            : plan.transaction.action === 'palette.add'
              ? COLOR_STUDIO_PALETTE_ADD_COMMAND_ID
              : 'studio.palette.load';
        const entry: ColorStudioHistoryEntry = {
          label: plan.label, actionId, commandId, transaction: plan.transaction,
          before: plan.before, after: plan.after,
        };
        studio = {
          ...studio,
          overrides: plan.after.overrides,
          palette: plan.after.palette,
          currentColor: plan.after.currentColor,
        };
        studioUndo.unshift(entry);
        studioRedo = [];
        committedActionId = actionId;
        commits += 1;
        return now++;
      },
      history: {
        peekUndo: () => studioUndo[0] ?? null,
        peekRedo: () => studioRedo[0] ?? null,
        commitUndo: () => {
          const entry = studioUndo.shift()!;
          studioRedo.unshift(entry);
          studio = { ...studio, overrides: entry.before.overrides, palette: entry.before.palette, currentColor: entry.before.currentColor };
          commits += 1;
          return { direction: 'undo', label: entry.label, actionId: entry.actionId, commandId: entry.commandId, transaction: entry.transaction };
        },
        commitRedo: () => {
          const entry = studioRedo.shift()!;
          studioUndo.unshift(entry);
          studio = { ...studio, overrides: entry.after.overrides, palette: entry.after.palette, currentColor: entry.after.currentColor };
          commits += 1;
          return { direction: 'redo', label: entry.label, actionId: entry.actionId, commandId: entry.commandId, transaction: entry.transaction };
        },
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
    studio: () => studio,
    studioUndoDepth: () => studioUndo.length,
    studioRedoDepth: () => studioRedo.length,
    modelOutliner: () => modelOutliner,
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
  assert(h.commands.resolveChord('Ctrl+Z', { surface: 'material' })?.id === COLOR_STUDIO_UNDO_COMMAND_ID, 'material Ctrl+Z did not resolve Studio history');
  assert(h.commands.resolveChord('Ctrl+Y', { surface: 'material' })?.id === COLOR_STUDIO_REDO_COMMAND_ID, 'material Ctrl+Y did not resolve Studio history');
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

test('viewport stroke, Inspector, context menu, and remote share one material action', () => {
  for (const source of ['viewport', 'dock', 'context-menu', 'remote'] as CommandSource[]) {
    const h = harness(0, 'world', null, null, 'paint-faces', false, selectedPieceWorld);
    const outcome = h.commands.invoke<WorldPieceMaterialResult>({
      invocationId: `material:${source}`,
      commandId: WORLD_PIECE_MATERIAL_ASSIGN_COMMAND_ID,
      args: {
        documentId: 'main', materialAssetId: 'mat-red',
        targets: [{ pieceId: 'bp_7', roles: ['top', 'edges', 'top'] }],
      },
      source,
    });
    assert(outcome.status === 'applied' && outcome.actionId === `material:${source}`, `${source} lost material action identity`);
    assert(outcome.status === 'applied' && outcome.result.plan.transaction.assignments[0]?.roles.length === 2, `${source} split/duplicated the stroke`);
    assert(h.pieces()[0]?.slots?.top && h.pieces()[0]?.slots?.edges, `${source} did not apply all roles`);
    assert(h.commits() === 1 && h.outcomes.length === 1, `${source} did not commit/publish exactly once`);
  }
});

test('material clear is an exact action and no-op clear rejects before commit', () => {
  const painted: PiecePlacementWorld = {
    ...selectedPieceWorld,
    pieces: [{ ...selectedPieceWorld.pieces[0]!, slots: { top: { assetId: 'mat-red' }, edges: { assetId: 'mat-blue' } } }],
  };
  const h = harness(0, 'world', null, null, 'select-tool', false, painted);
  const cleared = h.commands.invoke<WorldPieceMaterialResult>({
    invocationId: 'clear:1', commandId: WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID,
    args: { documentId: 'main', targets: [{ pieceId: 'bp_7', roles: ['top'] }] }, source: 'dock',
  });
  assert(cleared.status === 'applied' && h.pieces()[0]?.slots?.edges && !h.pieces()[0]?.slots?.top, 'clear changed the wrong roles');
  const noop = h.commands.invoke({
    invocationId: 'clear:2', commandId: WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID,
    args: { documentId: 'main', targets: [{ pieceId: 'bp_7', roles: ['top'] }] }, source: 'remote',
  });
  assert(noop.status === 'rejected' && noop.code === 'invalid-args', 'no-op clear produced an action');
  assert(h.commits() === 1, 'no-op clear committed state');
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

test('Color Studio choices are one report-only command for every invocation source', () => {
  for (const source of ['viewport', 'toolbar', 'remote'] as CommandSource[]) {
    const h = harness(0, 'material');
    const selected = h.commands.invoke({
      commandId: COLOR_STUDIO_MATERIAL_SELECT_COMMAND_ID,
      args: { specId: 'metal', variant: 0 },
      source,
    });
    assert(selected.status === 'applied' && selected.effect === 'report-only' && !('actionId' in selected), `${source} material choice became an action`);
    assert(h.studio().materialId === 'metal' && h.commits() === 1, `${source} did not use the shared material handler once`);
    assert(h.outcomes.length === 1 && h.outcomes[0] === selected, `${source} did not publish one authority outcome`);
  }
});

test('settled current-color choice is idempotent and never enters Studio history', () => {
  const h = harness(0, 'material');
  const same = h.commands.invoke({
    commandId: COLOR_STUDIO_COLOR_SELECT_COMMAND_ID,
    args: { color: { l: 0.6, c: 0.1, h: 20 }, source: 'color map' },
    source: 'viewport',
  });
  assert(same.status === 'applied' && same.result.changed === false, 'same settled color did not report a no-op');
  assert(h.commits() === 0 && h.studioUndoDepth() === 0, 'same color mutated or consumed undo');

  const changed = h.commands.invoke({
    commandId: COLOR_STUDIO_COLOR_SELECT_COMMAND_ID,
    args: { color: { l: 0.7, c: 0.1, h: 20 }, source: 'color map' },
    source: 'viewport',
  });
  assert(changed.status === 'applied' && changed.result.changed === true, 'new settled color disappeared');
  assert(h.studio().currentColor.l === 0.7 && h.commits() === 1 && h.studioUndoDepth() === 0, 'color choice became authored history');
});

test('material slot fill, undo, and redo retain one action identity and exact color state', () => {
  const h = harness(0, 'material');
  h.commands.invoke({ commandId: COLOR_STUDIO_VARIANT_SELECT_COMMAND_ID, args: { variant: 1 }, source: 'viewport' });
  const filled = h.commands.invoke({
    invocationId: 'studio-fill:1',
    commandId: COLOR_STUDIO_SLOT_FILL_COMMAND_ID,
    args: { specId: 'brick', variant: 1, slot: 1, rgb: [0.2, 0.3, 0.4], source: 'hex #334d66' },
    source: 'viewport',
  });
  assert(filled.status === 'applied' && filled.actionId === 'studio-fill:1' && filled.effect === 'action', 'slot fill lost action identity');
  assert(h.studio().overrides['brick:1:1']?.[1] === 0.3 && h.studioUndoDepth() === 1, 'slot fill did not commit exact state/history');

  const undone = h.commands.invoke({
    commandId: COLOR_STUDIO_UNDO_COMMAND_ID, args: {}, source: 'hotkey',
    actionId: 'studio-fill:1', causedBy: 'studio-fill:1',
  });
  assert(undone.status === 'applied' && undone.phase === 'undone' && undone.actionId === 'studio-fill:1', 'Studio undo correlation drifted');
  assert(h.studio().overrides['brick:1:1'] === undefined && h.studioRedoDepth() === 1, 'Studio undo did not restore exact inverse');

  const redone = h.commands.invoke({
    commandId: COLOR_STUDIO_REDO_COMMAND_ID, args: {}, source: 'dock',
    actionId: 'studio-fill:1', causedBy: 'studio-fill:1',
  });
  assert(redone.status === 'applied' && redone.phase === 'redone' && redone.actionId === 'studio-fill:1', 'Studio redo correlation drifted');
  assert(h.studio().overrides['brick:1:1']?.[2] === 0.4 && h.studioUndoDepth() === 1, 'Studio redo did not reapply exact state');
});

test('palette workspace actions work from paint surfaces but slot edits stay in Color Studio', () => {
  const model = harness(0, 'model');
  const added = model.commands.invoke({
    commandId: COLOR_STUDIO_PALETTE_ADD_COMMAND_ID,
    args: { color: { l: 0.8, c: 0.2, h: 90 }, source: 'current color' },
    source: 'toolbar',
  });
  assert(added.status === 'applied' && model.studio().palette.length === 2, 'shared paint tray action was blocked from model paint');

  const wrong = model.commands.invoke({
    commandId: COLOR_STUDIO_SLOT_FILL_COMMAND_ID,
    args: { specId: 'brick', variant: 0, slot: 0, rgb: [1, 0, 0], source: 'remote' },
    source: 'remote',
  });
  assert(wrong.status === 'rejected' && wrong.code === 'disabled', 'material slot edit escaped the Color Studio surface');
  assert(model.commits() === 1, 'rejected slot edit mutated model paint state');
});

test('Outliner organization is one native-journal action path for dock and remote callers', () => {
  for (const source of ['dock', 'remote'] as CommandSource[]) {
    const h = harness(0, 'model');
    const grouped = h.commands.invoke<ModelOutlinerActionResult>({
      invocationId: `group:${source}`,
      commandId: MODEL_PARTS_GROUP_COMMAND_ID,
      args: { modelId: 'model-a', partIds: ['part-a', 'part-b'] },
      source,
    });
    assert(grouped.status === 'applied' && grouped.actionId === `group:${source}`, `${source} lost model action identity`);
    assert(grouped.status === 'applied' && grouped.undoScope !== 'none' && grouped.undoScope.kind === 'native', `${source} escaped the mesh journal scope`);
    assert(h.modelOutliner().parts[0]?.groupId === 'part-group:40' && h.modelOutliner().parts[1]?.groupId === 'part-group:40', `${source} did not commit the exact group`);
    assert(h.modelOutliner().parts[2]?.groupId === undefined && h.commits() === 1 && h.outcomes.length === 1, `${source} mutated unrelated rows or published twice`);
  }
});

test('Outliner drag/reparent uses the same native-journal command boundary', () => {
  const h = harness(0, 'model');
  h.commands.invoke({
    commandId: MODEL_PARTS_GROUP_COMMAND_ID,
    args: { modelId: 'model-a', partIds: ['part-a', 'part-b'] },
    source: 'dock',
  });
  const groupId = h.modelOutliner().parts[0]?.groupId!;
  const moved = h.commands.invoke<ModelOutlinerActionResult>({
    commandId: MODEL_OUTLINER_MOVE_COMMAND_ID,
    args: {
      modelId: 'model-a',
      item: { kind: 'part', id: 'part-c' },
      target: { kind: 'group', id: groupId, position: 'inside' },
    },
    source: 'dock',
  });
  assert(moved.status === 'applied' && moved.result.plan.transaction.action === 'outliner.move', 'drag bypassed the outliner action boundary');
  assert(h.modelOutliner().parts.every((part) => part.groupId === groupId), 'drag did not reparent the part');
  assert(h.commits() === 2, 'drag did not commit exactly once');
});

test('rename, ungroup, group rename, and dissolve share exact outliner transactions', () => {
  const h = harness(0, 'model');
  const renamed = h.commands.invoke({
    commandId: MODEL_PART_RENAME_COMMAND_ID,
    args: { modelId: 'model-a', partId: 'part-a', name: 'Main Deck' },
    source: 'dock',
  });
  assert(renamed.status === 'applied' && h.modelOutliner().parts[0]?.name === 'Main Deck', 'part rename bypassed the shared handler');
  h.commands.invoke({ commandId: MODEL_PARTS_GROUP_COMMAND_ID, args: { modelId: 'model-a', partIds: ['part-a', 'part-b'] }, source: 'dock' });
  const groupId = h.modelOutliner().parts[0]?.groupId!;
  h.commands.invoke({ commandId: MODEL_GROUP_RENAME_COMMAND_ID, args: { modelId: 'model-a', groupId, name: 'Bridge' }, source: 'dock' });
  assert(h.modelOutliner().parts.slice(0, 2).every((part) => part.groupName === 'Bridge'), 'group rename split member labels');
  h.commands.invoke({ commandId: MODEL_PARTS_UNGROUP_COMMAND_ID, args: { modelId: 'model-a', partIds: ['part-a'] }, source: 'dock' });
  assert(!h.modelOutliner().parts[0]?.groupId && h.modelOutliner().parts[1]?.groupId === groupId, 'ungroup changed the wrong rows');
  h.commands.invoke({ commandId: MODEL_GROUP_DISSOLVE_COMMAND_ID, args: { modelId: 'model-a', groupId }, source: 'dock' });
  assert(h.modelOutliner().parts.every((part) => !part.groupId), 'dissolve left group metadata behind');
  assert(h.commits() === 5 && h.outcomes.length === 5, 'outliner actions did not commit/publish once each');
});

test('stale and wrong-surface outliner requests reject before commit', () => {
  const model = harness(0, 'model');
  const stale = model.commands.invoke({
    commandId: MODEL_PART_RENAME_COMMAND_ID,
    args: { modelId: 'model-a', partId: 'missing', name: 'Ghost' },
    source: 'remote',
  });
  assert(stale.status === 'rejected' && stale.code === 'invalid-args' && model.commits() === 0, 'stale part crossed authority');

  const world = harness(0, 'world');
  const wrong = world.commands.invoke({
    commandId: MODEL_PART_RENAME_COMMAND_ID,
    args: { modelId: 'model-a', partId: 'part-a', name: 'Wrong Surface' },
    source: 'remote',
  });
  assert(wrong.status === 'rejected' && wrong.code === 'disabled' && world.commits() === 0, 'model action escaped onto world surface');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
