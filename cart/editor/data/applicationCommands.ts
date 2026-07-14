// cart/editor's application-command composition root.
//
// Carts declare command presentation and private handlers here. React surfaces
// receive only invoke/projection functions; the privileged adapter is created by
// AppFrame and is never passed down into Section D, menus, hotkeys, or viewports.
import {
  CommandAuthority,
  CommandRegistry,
  type CommandInvocation,
  type CommandOutcome,
  type CommandProjection,
  type CommandSource,
  type CommandMode,
} from '../../../runtime/commands';
import {
  PiecePlacementRejected,
  WORLD_PIECES_PLACE_COMMAND_ID,
  planPiecePlacement,
  type PiecePlacementCandidate,
  type PiecePlacementPlan,
  type PiecePlacementPolicy,
  type PiecePlacementWorld,
} from '../world/piecePlacementCommand';
import {
  PieceEditRejected,
  WORLD_PIECE_DELETE_COMMAND_ID,
  WORLD_PIECE_EDIT_COMMAND_IDS,
  WORLD_PIECE_MOVE_COMMAND_ID,
  WORLD_PIECE_ROTATE_COMMAND_ID,
  planPieceDelete,
  planPieceMove,
  planPieceRotate,
  type PieceDeleteArgs,
  type PieceEditPlan,
  type PieceEditWorld,
  type PieceMoveArgs,
  type PieceRotateArgs,
  type WorldPieceEditCommandId,
} from '../world/pieceEditCommand';
import type { PlacedPiece, PlacementGesture } from '../world/pieces';

export const WORLD_FLOOR_STEP_COMMAND_ID = 'world.floor.step';
export const WORLD_MAX_FLOOR = 128;
export const WORLD_SELECT_TOOL_COMMAND_ID = 'select-tool';
export const WORLD_PLACE_TOOL_COMMAND_ID = 'place-piece';
export const WORLD_MOVE_TOOL_COMMAND_ID = 'move-selection';
export const WORLD_FOCUS_TOOL_COMMAND_ID = 'focus-selection';
export const WORLD_PAINT_FACES_TOOL_COMMAND_ID = 'paint-faces';
export const WORLD_STICKER_TOOL_COMMAND_ID = 'place-sticker';
export const WORLD_TOOL_COMMAND_IDS = [
  WORLD_SELECT_TOOL_COMMAND_ID,
  WORLD_PLACE_TOOL_COMMAND_ID,
  WORLD_MOVE_TOOL_COMMAND_ID,
  WORLD_FOCUS_TOOL_COMMAND_ID,
  WORLD_PAINT_FACES_TOOL_COMMAND_ID,
  WORLD_STICKER_TOOL_COMMAND_ID,
] as const;
export type WorldToolCommandId = typeof WORLD_TOOL_COMMAND_IDS[number];
export const WORLD_UNDO_COMMAND_ID = 'world.history.undo';
export const WORLD_REDO_COMMAND_ID = 'world.history.redo';
/** Turning the not-yet-authored placement preview is a report-only choice. It
 * is intentionally not the authored `world.piece.rotate` action. */
export const WORLD_PLACEMENT_ROTATE_COMMAND_ID = 'world.placement.rotate';
export { WORLD_PIECES_PLACE_COMMAND_ID } from '../world/piecePlacementCommand';
export {
  WORLD_PIECE_DELETE_COMMAND_ID,
  WORLD_PIECE_MOVE_COMMAND_ID,
  WORLD_PIECE_ROTATE_COMMAND_ID,
} from '../world/pieceEditCommand';

export type WorldFloorStepArgs = { delta: -1 | 1 };
export type WorldFloorStepResult = {
  previousFloorIndex: number;
  floorIndex: number;
  delta: -1 | 1;
  maxFloor: number;
};

export type WorldToolArmResult = {
  previousToolId: string;
  toolId: WorldToolCommandId;
  mapPaintDropped: boolean;
  changed: boolean;
};

export type WorldPiecesPlaceArgs = {
  documentId: string;
  candidates: readonly PiecePlacementCandidate[];
  gesture: PlacementGesture;
  stamp?: Pick<PlacedPiece, 'slots' | 'overrides'> | null;
};

export type WorldPiecesPlaceResult = {
  plan: PiecePlacementPlan;
  inputAtMs: number;
  pointerX: number;
  pointerY: number;
  applyStartedAtMs: number;
  appliedAtMs: number;
  applyMs: number;
  inputToAppliedMs: number;
};

export type WorldPieceEditResult = {
  plan: PieceEditPlan;
  applyStartedAtMs: number;
  appliedAtMs: number;
  applyMs: number;
};

export type WorldPlacementRotateResult = {
  previousYawDegrees: number;
  yawDegrees: number;
  armedPieceId: string;
};

export interface EditorPlacementAdapter {
  read(): PiecePlacementWorld;
  policy: PiecePlacementPolicy;
  now(): number;
  /** Atomically commit a previously validated plan and return the timestamp at
   * which the new snapshot became authoritative. This method must not throw. */
  commit(plan: PiecePlacementPlan, actionId: string, gesture: PlacementGesture, applyStartedAtMs: number): number;
}

export interface EditorPieceEditAdapter {
  read(): PieceEditWorld;
  now(): number;
  /** Atomically commit a validated forward/inverse transaction. */
  commit(plan: PieceEditPlan, actionId: string, applyStartedAtMs: number): number;
}

export type WorldHistoryEntryRef = {
  label: string;
  actionId?: string;
  commandId?: string;
};

export type WorldHistoryControlResult = WorldHistoryEntryRef & {
  direction: 'undo' | 'redo';
  changedKeys: readonly string[];
};

export interface EditorHistoryAdapter {
  peekUndo(): WorldHistoryEntryRef | null;
  peekRedo(): WorldHistoryEntryRef | null;
  commitUndo(): WorldHistoryControlResult;
  commitRedo(): WorldHistoryControlResult;
}

/** The smallest privileged surface needed by the migrated world-command slice. It is
 * deliberately not a React setter: the composition root owns how the one
 * committed result becomes the current read-only snapshot. */
export interface EditorCommandAdapter {
  activeSurface(): string;
  blockedReason(): string | null;
  floorIndex(): number;
  commitFloor(result: WorldFloorStepResult): void;
  worldTool(): { activeCommandId: string; mapPaintActive: boolean };
  commitWorldTool(result: WorldToolArmResult): void;
  placementGhost(): { activeCommandId: string; armedPieceId: string | null; yawDegrees: number };
  commitPlacementGhostRotation(result: WorldPlacementRotateResult): void;
  placement: EditorPlacementAdapter;
  pieceEdit: EditorPieceEditAdapter;
  history: EditorHistoryAdapter;
}

export type EditorCommandRequest = Omit<CommandInvocation, 'invocationId'> & {
  invocationId?: string;
};

export interface EditorApplicationCommands {
  invoke<Result = unknown>(request: EditorCommandRequest): CommandOutcome<Result>;
  command(id: string): CommandProjection | undefined;
  commandsByMenu(menu: string): readonly CommandProjection[];
  resolveChord(chord: string, mode?: CommandMode): CommandProjection | undefined;
}

let applicationInstanceSequence = 0;

function floorArgs(args: unknown) {
  const delta = (args as { delta?: unknown } | null)?.delta;
  return delta === -1 || delta === 1
    ? { ok: true as const, value: { delta } as WorldFloorStepArgs }
    : { ok: false as const, reason: 'delta must be exactly -1 or 1' };
}

function wrappedFloor(current: number, delta: -1 | 1): number {
  const floorCount = WORLD_MAX_FLOOR + 1;
  return (current + delta + floorCount) % floorCount;
}

function noArgs(args: unknown) {
  return args == null || (typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 0)
    ? { ok: true as const, value: {} }
    : { ok: false as const, reason: 'command takes no arguments' };
}

const WORLD_TOOL_DEFS: readonly {
  id: WorldToolCommandId;
  label: string;
  icon: string;
  menu: 'Build' | 'View';
  chord: string;
}[] = [
  { id: WORLD_SELECT_TOOL_COMMAND_ID, label: 'Select', icon: 'MousePointer2', menu: 'Build', chord: 'Esc' },
  { id: WORLD_PLACE_TOOL_COMMAND_ID, label: 'Place Piece', icon: 'Pencil', menu: 'Build', chord: 'B' },
  { id: WORLD_MOVE_TOOL_COMMAND_ID, label: 'Move Selection', icon: 'Move', menu: 'Build', chord: 'V' },
  { id: WORLD_FOCUS_TOOL_COMMAND_ID, label: 'Focus Selection', icon: 'ScanSearch', menu: 'View', chord: 'F' },
  { id: WORLD_PAINT_FACES_TOOL_COMMAND_ID, label: 'Paint Faces', icon: 'Paintbrush', menu: 'Build', chord: 'N' },
  { id: WORLD_STICKER_TOOL_COMMAND_ID, label: 'Place Sticker', icon: 'Sticker', menu: 'Build', chord: 'K' },
];

export function isWorldToolCommandId(id: string): id is WorldToolCommandId {
  return (WORLD_TOOL_COMMAND_IDS as readonly string[]).includes(id);
}

type PreparedPlacement = { plan: PiecePlacementPlan; gesture: PlacementGesture };

function placementArgs(adapter: EditorPlacementAdapter, args: unknown) {
  const value = args as Partial<WorldPiecesPlaceArgs> | null;
  if (!value || typeof value.documentId !== 'string' || !Array.isArray(value.candidates)) {
    return { ok: false as const, reason: 'documentId and candidates are required' };
  }
  const gesture = value.gesture;
  if (!gesture || (gesture.mode !== 'click' && gesture.mode !== 'drag-run') ||
      !Number.isFinite(gesture.inputAtMs) || !Number.isFinite(gesture.pointerX) || !Number.isFinite(gesture.pointerY)) {
    return { ok: false as const, reason: 'gesture telemetry is malformed' };
  }
  const stamp = value.stamp ?? null;
  const candidates = value.candidates.map((candidate) => ({ ...candidate, ...(stamp ?? {}) }));
  try {
    const plan = planPiecePlacement(adapter.read(), {
      documentId: value.documentId,
      candidates,
      gestureMode: gesture.mode,
    }, adapter.policy);
    return { ok: true as const, value: { plan, gesture } as PreparedPlacement };
  } catch (error) {
    const reason = error instanceof PiecePlacementRejected ? `${error.code}: ${error.message}` : (error as Error).message;
    return { ok: false as const, reason: reason || 'placement validation failed' };
  }
}

function editRejectReason(error: unknown): string {
  return error instanceof PieceEditRejected
    ? `${error.code}: ${error.message}`
    : ((error as Error)?.message || 'piece edit validation failed');
}

function moveArgs(adapter: EditorPieceEditAdapter, args: unknown) {
  const value = args as Partial<PieceMoveArgs> | null;
  if (!value || typeof value.documentId !== 'string' || typeof value.pieceId !== 'string' || !value.transform) {
    return { ok: false as const, reason: 'documentId, pieceId, and transform are required' };
  }
  try {
    return { ok: true as const, value: planPieceMove(adapter.read(), value as PieceMoveArgs) };
  } catch (error) {
    return { ok: false as const, reason: editRejectReason(error) };
  }
}

function rotateArgs(adapter: EditorPieceEditAdapter, args: unknown) {
  const value = args as Partial<PieceRotateArgs> | null;
  if (!value || typeof value.documentId !== 'string' || typeof value.pieceId !== 'string') {
    return { ok: false as const, reason: 'documentId and pieceId are required' };
  }
  try {
    return { ok: true as const, value: planPieceRotate(adapter.read(), value as PieceRotateArgs) };
  } catch (error) {
    return { ok: false as const, reason: editRejectReason(error) };
  }
}

function deleteArgs(adapter: EditorPieceEditAdapter, args: unknown) {
  const value = args as Partial<PieceDeleteArgs> | null;
  if (!value || typeof value.documentId !== 'string' || typeof value.pieceId !== 'string') {
    return { ok: false as const, reason: 'documentId and pieceId are required' };
  }
  try {
    return { ok: true as const, value: planPieceDelete(adapter.read(), value as PieceDeleteArgs) };
  } catch (error) {
    return { ok: false as const, reason: editRejectReason(error) };
  }
}

export function isWorldPieceEditCommandId(id: string): id is WorldPieceEditCommandId {
  return (WORLD_PIECE_EDIT_COMMAND_IDS as readonly string[]).includes(id);
}

/** Build one application-scoped registry + authority. Creating it does not run
 * a command; AppFrame retains this instance for its mounted lifetime, while a
 * headless peer can create the same authority over an in-memory adapter. */
export function createEditorApplicationCommands(
  adapter: EditorCommandAdapter,
  outcomeSink: (outcome: CommandOutcome) => void,
): EditorApplicationCommands {
  const registry = new CommandRegistry();
  const instanceId = ++applicationInstanceSequence;
  let invocationSequence = 0;

  registry.register<WorldFloorStepArgs, WorldFloorStepResult>({
    id: WORLD_FLOOR_STEP_COMMAND_ID,
    label: 'Step Active Floor',
    icon: 'Layers',
    effect: 'report-only',
    undoScope: 'none',
    projections: { menu: ['Map'], toolbar: ['D.world'], palette: true },
    keybindings: [{ chord: ']', when: { surface: 'world' } }],
    validateArgs: floorArgs,
    isEnabled: () => {
      const blocked = adapter.blockedReason();
      if (blocked) return { enabled: false, reason: `resolve ${blocked} first` };
      return adapter.activeSurface() === 'world'
        ? true
        : { enabled: false, reason: 'only in the world editor' };
    },
  }, ({ args }) => {
    const previousFloorIndex = adapter.floorIndex();
    if (!Number.isInteger(previousFloorIndex) || previousFloorIndex < 0 || previousFloorIndex > WORLD_MAX_FLOOR) {
      throw new Error(`active floor ${previousFloorIndex} is outside 0..${WORLD_MAX_FLOOR}`);
    }
    const result: WorldFloorStepResult = {
      previousFloorIndex,
      floorIndex: wrappedFloor(previousFloorIndex, args.delta),
      delta: args.delta,
      maxFloor: WORLD_MAX_FLOOR,
    };
    adapter.commitFloor(result);
    return result;
  });

  for (const tool of WORLD_TOOL_DEFS) {
    registry.register<{}, WorldToolArmResult>({
      id: tool.id,
      label: tool.label,
      icon: tool.icon,
      effect: 'report-only',
      undoScope: 'none',
      projections: { menu: [tool.menu], toolbar: ['D.world'], palette: true },
      keybindings: [{ chord: tool.chord, when: { surface: 'world' } }],
      validateArgs: noArgs,
      isEnabled: () => {
        const blocked = adapter.blockedReason();
        if (blocked) return { enabled: false, reason: `resolve ${blocked} first` };
        return adapter.activeSurface() === 'world'
          ? true
          : { enabled: false, reason: 'only in the world editor' };
      },
    }, () => {
      const current = adapter.worldTool();
      const result: WorldToolArmResult = {
        previousToolId: current.activeCommandId,
        toolId: tool.id,
        mapPaintDropped: current.mapPaintActive,
        changed: current.activeCommandId !== tool.id || current.mapPaintActive,
      };
      if (result.changed) adapter.commitWorldTool(result);
      return result;
    });
  }

  registry.register<PreparedPlacement, WorldPiecesPlaceResult>({
    id: WORLD_PIECES_PLACE_COMMAND_ID,
    label: 'Place World Pieces',
    icon: 'Pencil',
    effect: 'action',
    undoScope: { kind: 'document', key: 'world' },
    projections: { hiddenReason: 'semantic gesture commit projected by the world viewport' },
    validateArgs: (args) => placementArgs(adapter.placement, args),
    isEnabled: () => {
      const blocked = adapter.blockedReason();
      if (blocked) return { enabled: false, reason: `resolve ${blocked} first` };
      return adapter.activeSurface() === 'world'
        ? true
        : { enabled: false, reason: 'only in the world editor' };
    },
  }, ({ args, invocationId, actionId }) => {
    const applyStartedAtMs = adapter.placement.now();
    const committedAtMs = adapter.placement.commit(args.plan, actionId ?? invocationId, args.gesture, applyStartedAtMs);
    const appliedAtMs = Number.isFinite(committedAtMs) ? Math.max(applyStartedAtMs, committedAtMs) : applyStartedAtMs;
    const result: WorldPiecesPlaceResult = {
      plan: args.plan,
      inputAtMs: args.gesture.inputAtMs,
      pointerX: args.gesture.pointerX,
      pointerY: args.gesture.pointerY,
      applyStartedAtMs,
      appliedAtMs,
      applyMs: Math.max(0, appliedAtMs - applyStartedAtMs),
      inputToAppliedMs: Math.max(0, appliedAtMs - args.gesture.inputAtMs),
    };
    return result;
  });

  const pieceEditEnabled = () => {
    const blocked = adapter.blockedReason();
    if (blocked) return { enabled: false, reason: `resolve ${blocked} first` };
    return adapter.activeSurface() === 'world'
      ? true
      : { enabled: false, reason: 'only in the world editor' };
  };
  const commitPieceEdit = (plan: PieceEditPlan, actionId: string): WorldPieceEditResult => {
    const applyStartedAtMs = adapter.pieceEdit.now();
    const committedAtMs = adapter.pieceEdit.commit(plan, actionId, applyStartedAtMs);
    const appliedAtMs = Number.isFinite(committedAtMs) ? Math.max(applyStartedAtMs, committedAtMs) : applyStartedAtMs;
    return {
      plan,
      applyStartedAtMs,
      appliedAtMs,
      applyMs: Math.max(0, appliedAtMs - applyStartedAtMs),
    };
  };

  registry.register<PieceEditPlan, WorldPieceEditResult>({
    id: WORLD_PIECE_MOVE_COMMAND_ID,
    label: 'Move World Piece',
    icon: 'Move',
    effect: 'action',
    undoScope: { kind: 'document', key: 'world' },
    projections: { hiddenReason: 'semantic drag commit projected by the world viewport Move tool' },
    validateArgs: (args) => moveArgs(adapter.pieceEdit, args),
    isEnabled: pieceEditEnabled,
  }, ({ args, invocationId, actionId }) => commitPieceEdit(args, actionId ?? invocationId));

  registry.register<PieceEditPlan, WorldPieceEditResult>({
    id: WORLD_PIECE_ROTATE_COMMAND_ID,
    label: 'Rotate World Piece',
    icon: 'RotateCw',
    effect: 'action',
    undoScope: { kind: 'document', key: 'world' },
    projections: {
      menu: ['Build'], toolbar: ['D.world'], contextMenu: ['world-piece'], palette: true,
    },
    keybindings: [{ chord: 'R', when: { surface: 'world' } }],
    validateArgs: (args) => rotateArgs(adapter.pieceEdit, args),
    isEnabled: pieceEditEnabled,
  }, ({ args, invocationId, actionId }) => commitPieceEdit(args, actionId ?? invocationId));

  registry.register<PieceEditPlan, WorldPieceEditResult>({
    id: WORLD_PIECE_DELETE_COMMAND_ID,
    label: 'Delete World Piece',
    icon: 'Trash2',
    effect: 'action',
    undoScope: { kind: 'document', key: 'world' },
    projections: { menu: ['Edit'], contextMenu: ['world-piece'], palette: true },
    keybindings: [{ chord: 'Delete', when: { surface: 'world' } }],
    validateArgs: (args) => deleteArgs(adapter.pieceEdit, args),
    isEnabled: pieceEditEnabled,
  }, ({ args, invocationId, actionId }) => commitPieceEdit(args, actionId ?? invocationId));

  registry.register<{}, WorldPlacementRotateResult>({
    id: WORLD_PLACEMENT_ROTATE_COMMAND_ID,
    label: 'Rotate Placement Preview',
    icon: 'RotateCw',
    effect: 'report-only',
    undoScope: 'none',
    projections: { hiddenReason: 'R resolves here only while an unplaced piece is armed' },
    validateArgs: noArgs,
    isEnabled: () => {
      const enabled = pieceEditEnabled();
      if (enabled !== true) return enabled;
      const ghost = adapter.placementGhost();
      return ghost.activeCommandId === WORLD_PLACE_TOOL_COMMAND_ID && ghost.armedPieceId
        ? true
        : { enabled: false, reason: 'arm a piece in Place mode to rotate its preview' };
    },
  }, () => {
    const ghost = adapter.placementGhost();
    if (!ghost.armedPieceId) throw new Error('placement preview disappeared before rotation');
    const result: WorldPlacementRotateResult = {
      previousYawDegrees: ghost.yawDegrees,
      yawDegrees: (ghost.yawDegrees + 90) % 360,
      armedPieceId: ghost.armedPieceId,
    };
    adapter.commitPlacementGhostRotation(result);
    return result;
  });

  registry.register<{}, WorldHistoryControlResult>({
    id: WORLD_UNDO_COMMAND_ID,
    label: 'Undo World Action',
    icon: 'Undo2',
    effect: 'control',
    undoScope: { kind: 'document', key: 'world' },
    outcomePhase: 'undone',
    projections: { menu: ['Edit'], toolbar: ['H.history'], palette: true },
    keybindings: [{ chord: 'Ctrl+Z', when: { surface: 'world' } }],
    validateArgs: noArgs,
    isEnabled: () => {
      const blocked = adapter.blockedReason();
      if (blocked) return { enabled: false, reason: `resolve ${blocked} first` };
      if (adapter.activeSurface() !== 'world') return { enabled: false, reason: 'only in the world editor' };
      return adapter.history.peekUndo() ? true : { enabled: false, reason: 'nothing to undo on the world' };
    },
  }, () => adapter.history.commitUndo());

  registry.register<{}, WorldHistoryControlResult>({
    id: WORLD_REDO_COMMAND_ID,
    label: 'Redo World Action',
    icon: 'Redo2',
    effect: 'control',
    undoScope: { kind: 'document', key: 'world' },
    outcomePhase: 'redone',
    projections: { menu: ['Edit'], toolbar: ['H.history'], palette: true },
    keybindings: [
      { chord: 'Ctrl+Shift+Z', when: { surface: 'world' } },
      { chord: 'Ctrl+Y', when: { surface: 'world' } },
    ],
    validateArgs: noArgs,
    isEnabled: () => {
      const blocked = adapter.blockedReason();
      if (blocked) return { enabled: false, reason: `resolve ${blocked} first` };
      if (adapter.activeSurface() !== 'world') return { enabled: false, reason: 'only in the world editor' };
      return adapter.history.peekRedo() ? true : { enabled: false, reason: 'nothing to redo on the world' };
    },
  }, () => adapter.history.commitRedo());

  const authority = new CommandAuthority(registry, { outcomeSink });
  return Object.freeze({
    invoke<Result = unknown>(request: EditorCommandRequest): CommandOutcome<Result> {
      return authority.invoke<Result>({
        ...request,
        invocationId: request.invocationId ?? `editor:${instanceId}:${++invocationSequence}`,
      });
    },
    command: (id: string) => registry.command(id),
    commandsByMenu: (menu: string) => registry.byMenu(menu),
    resolveChord: (chord: string, mode: CommandMode = {}) => registry.resolveChord(chord, mode),
  });
}

export function commandSource(source: string): CommandSource {
  if (source === 'action bar') return 'toolbar';
  if (source === 'context') return 'context-menu';
  if (source === 'stage') return 'viewport';
  if (source === 'menu' || source === 'hotkey' || source === 'toolbar' || source === 'dock' || source === 'context-menu' ||
      source === 'palette' || source === 'viewport' || source === 'native' || source === 'remote' || source === 'automation') {
    return source;
  }
  return 'automation';
}
