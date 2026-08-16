// cart/editor's application-command composition root.
//
// Carts declare command presentation and private handlers here. React surfaces
// receive only invoke/projection functions; the privileged adapter is created by
// AppFrame and is never passed down into Section D, menus, hotkeys, or viewports.
import {
  CommandAuthority,
  CommandRegistry,
  type CommandInvocation,
  type CommandAvailability,
  type CommandOutcome,
  type CommandProjection,
  type CommandSource,
  type CommandMode,
} from '../../../runtime/commands';
import { claimActiveModel, claimAdmits } from '../agent/claims';
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
  WORLD_PIECE_MATERIAL_ASSIGN_COMMAND_ID,
  WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID,
  WORLD_PIECE_MATERIAL_COMMAND_IDS,
  WORLD_PIECE_MOVE_COMMAND_ID,
  WORLD_PIECE_ROTATE_COMMAND_ID,
  WORLD_PIECE_SKIN_COMMAND_ID,
  WORLD_PIECE_SPIN_COMMAND_ID,
  planPieceDelete,
  planPieceMaterialAssign,
  planPieceMaterialClear,
  planPieceMove,
  planPieceRotate,
  planPieceSkin,
  planPieceSpin,
  type PieceDeleteArgs,
  type PieceEditPlan,
  type PieceEditWorld,
  type PieceMoveArgs,
  type PieceMaterialAssignArgs,
  type PieceMaterialClearArgs,
  type PieceMaterialPlan,
  type PieceMaterialPolicy,
  type PieceRotateArgs,
  type PieceSkinArgs,
  type PieceSkinPolicy,
  type PieceSpinArgs,
  type WorldPieceEditCommandId,
  type WorldPieceMaterialCommandId,
} from '../world/pieceEditCommand';
import type { PlacedPiece, PlacementGesture } from '../world/pieces';
import {
  ColorStudioRejected,
  planCurrentColorChoice,
  planMaterialChoice,
  planPaletteAdd,
  planPaletteLoad,
  planQualityChoice,
  planSeedRoll,
  planSlotChoice,
  planSlotFill,
  planSlotsReset,
  planVariantChoice,
  planViewChoice,
  type ColorStudioActionPlan,
  type ColorStudioChoiceResult,
  type ColorStudioHistoryEntry,
  type ColorStudioPolicy,
  type ColorStudioSnapshot,
} from '../material/colorStudioCommand';
import {
  MODEL_GROUP_DISSOLVE_COMMAND_ID,
  MODEL_GROUP_RENAME_COMMAND_ID,
  MODEL_OUTLINER_MOVE_COMMAND_ID,
  MODEL_OUTLINER_ACTION_COMMAND_IDS,
  MODEL_PART_RENAME_COMMAND_ID,
  MODEL_PARTS_GROUP_COMMAND_ID,
  MODEL_PARTS_UNGROUP_COMMAND_ID,
  planOutlinerMove,
  ModelOutlinerRejected,
  planGroupDissolve,
  planGroupRename,
  planPartRename,
  planPartsGroup,
  planPartsUngroup,
  type ModelOutlinerCommandId,
  type ModelOutlinerPlan,
  type ModelOutlinerSnapshot,
} from '../model/outlinerCommand';
import {
  registerAnimationCommands,
  type EditorAnimationCommandAdapter,
} from '../animation/commandRegistration';

export const WORLD_FLOOR_STEP_COMMAND_ID = 'world.floor.step';
export const WORLD_MAX_FLOOR = 128;
export const WORLD_SELECT_TOOL_COMMAND_ID = 'select-tool';
export const WORLD_PLACE_TOOL_COMMAND_ID = 'place-piece';
export const WORLD_MOVE_TOOL_COMMAND_ID = 'move-selection';
export const WORLD_FOCUS_TOOL_COMMAND_ID = 'focus-selection';
export const WORLD_PAINT_FACES_TOOL_COMMAND_ID = 'paint-faces';
export const WORLD_STICKER_TOOL_COMMAND_ID = 'place-sticker';
export const WORLD_DRAW_WALL_TOOL_COMMAND_ID = 'draw-wall';
export const WORLD_CUT_OPENING_TOOL_COMMAND_ID = 'cut-opening';
export const WORLD_TOOL_COMMAND_IDS = [
  WORLD_SELECT_TOOL_COMMAND_ID,
  WORLD_PLACE_TOOL_COMMAND_ID,
  WORLD_MOVE_TOOL_COMMAND_ID,
  WORLD_FOCUS_TOOL_COMMAND_ID,
  WORLD_PAINT_FACES_TOOL_COMMAND_ID,
  WORLD_STICKER_TOOL_COMMAND_ID,
  WORLD_DRAW_WALL_TOOL_COMMAND_ID,
  WORLD_CUT_OPENING_TOOL_COMMAND_ID,
] as const;
export type WorldToolCommandId = typeof WORLD_TOOL_COMMAND_IDS[number];
export const WORLD_UNDO_COMMAND_ID = 'world.history.undo';
export const WORLD_REDO_COMMAND_ID = 'world.history.redo';
/** Turning the not-yet-authored placement preview is a report-only choice. It
 * is intentionally not the authored `world.piece.rotate` action. */
export const WORLD_PLACEMENT_ROTATE_COMMAND_ID = 'world.placement.rotate';
export const COLOR_STUDIO_MATERIAL_SELECT_COMMAND_ID = 'studio.material.select';
export const COLOR_STUDIO_VARIANT_SELECT_COMMAND_ID = 'studio.variant.select';
export const COLOR_STUDIO_SEED_ROLL_COMMAND_ID = 'studio.seed.roll';
export const COLOR_STUDIO_QUALITY_SELECT_COMMAND_ID = 'studio.quality.select';
export const COLOR_STUDIO_SLOT_SELECT_COMMAND_ID = 'studio.slot.select';
export const COLOR_STUDIO_VIEW_SELECT_COMMAND_ID = 'studio.view.select';
export const COLOR_STUDIO_COLOR_SELECT_COMMAND_ID = 'studio.color.select';
export const COLOR_STUDIO_SLOT_FILL_COMMAND_ID = 'material.slot.fill';
export const COLOR_STUDIO_SLOTS_RESET_COMMAND_ID = 'material.slots.reset';
export const COLOR_STUDIO_PALETTE_ADD_COMMAND_ID = 'studio.palette.add';
export const COLOR_STUDIO_PALETTE_LOAD_COMMAND_ID = 'studio.palette.load';
export const COLOR_STUDIO_UNDO_COMMAND_ID = 'studio.history.undo';
export const COLOR_STUDIO_REDO_COMMAND_ID = 'studio.history.redo';
export const COLOR_STUDIO_CHOICE_COMMAND_IDS = [
  COLOR_STUDIO_MATERIAL_SELECT_COMMAND_ID,
  COLOR_STUDIO_VARIANT_SELECT_COMMAND_ID,
  COLOR_STUDIO_SEED_ROLL_COMMAND_ID,
  COLOR_STUDIO_QUALITY_SELECT_COMMAND_ID,
  COLOR_STUDIO_SLOT_SELECT_COMMAND_ID,
  COLOR_STUDIO_VIEW_SELECT_COMMAND_ID,
  COLOR_STUDIO_COLOR_SELECT_COMMAND_ID,
] as const;
export const COLOR_STUDIO_ACTION_COMMAND_IDS = [
  COLOR_STUDIO_SLOT_FILL_COMMAND_ID,
  COLOR_STUDIO_SLOTS_RESET_COMMAND_ID,
  COLOR_STUDIO_PALETTE_ADD_COMMAND_ID,
  COLOR_STUDIO_PALETTE_LOAD_COMMAND_ID,
] as const;
export { WORLD_PIECES_PLACE_COMMAND_ID } from '../world/piecePlacementCommand';
export {
  WORLD_PIECE_DELETE_COMMAND_ID,
  WORLD_PIECE_MATERIAL_ASSIGN_COMMAND_ID,
  WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID,
  WORLD_PIECE_MOVE_COMMAND_ID,
  WORLD_PIECE_ROTATE_COMMAND_ID,
  WORLD_PIECE_SKIN_COMMAND_ID,
  WORLD_PIECE_SPIN_COMMAND_ID,
} from '../world/pieceEditCommand';
export {
  MODEL_GROUP_DISSOLVE_COMMAND_ID,
  MODEL_GROUP_RENAME_COMMAND_ID,
  MODEL_OUTLINER_MOVE_COMMAND_ID,
  MODEL_PART_RENAME_COMMAND_ID,
  MODEL_PARTS_GROUP_COMMAND_ID,
  MODEL_PARTS_UNGROUP_COMMAND_ID,
} from '../model/outlinerCommand';

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
  stamp?: Pick<PlacedPiece, 'slots' | 'overrides' | 'stickers' | 'surfaceFlora' | 'spinDegPerSec'> | null;
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

export type WorldPieceMaterialResult = {
  plan: PieceMaterialPlan;
  applyStartedAtMs: number;
  appliedAtMs: number;
  applyMs: number;
};

export type WorldPlacementRotateResult = {
  previousYawDegrees: number;
  yawDegrees: number;
  armedPieceId: string;
};

export type ColorStudioActionResult = {
  plan: ColorStudioActionPlan;
  applyStartedAtMs: number;
  appliedAtMs: number;
  applyMs: number;
};

export type ColorStudioHistoryControlResult = {
  direction: 'undo' | 'redo';
  label: string;
  actionId: string;
  commandId: string;
  transaction: ColorStudioHistoryEntry['transaction'];
};

export type ModelOutlinerActionResult = {
  plan: ModelOutlinerPlan;
  applyStartedAtMs: number;
  appliedAtMs: number;
  applyMs: number;
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
  /** Catalog-side resolution for the paint-skin swap (req_3443) — what a placed
   * piece's placeable id becomes wearing a stored painting (null = invalid). */
  skinPolicy: PieceSkinPolicy;
  now(): number;
  /** Atomically commit a validated forward/inverse transaction. */
  commit(plan: PieceEditPlan, actionId: string, applyStartedAtMs: number): number;
}

export interface EditorPieceMaterialAdapter {
  read(): PieceEditWorld;
  policy: PieceMaterialPolicy;
  now(): number;
  commit(plan: PieceMaterialPlan, actionId: string, applyStartedAtMs: number): number;
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

export interface EditorColorStudioAdapter {
  read(): ColorStudioSnapshot;
  policy: ColorStudioPolicy;
  now(): number;
  commitChoice(result: ColorStudioChoiceResult): void;
  commitAction(plan: ColorStudioActionPlan, actionId: string, applyStartedAtMs: number): number;
  history: {
    peekUndo(): ColorStudioHistoryEntry | null;
    peekRedo(): ColorStudioHistoryEntry | null;
    commitUndo(): ColorStudioHistoryControlResult;
    commitRedo(): ColorStudioHistoryControlResult;
  };
}

export interface EditorModelOutlinerAdapter {
  read(modelId?: string): ModelOutlinerSnapshot;
  now(): number;
  /** Commit both the host-journal checkpoint and its matching React metadata
   * projection. Failure must occur before either becomes visible. */
  commit(plan: ModelOutlinerPlan, actionId: string, applyStartedAtMs: number): number;
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
  pieceMaterial: EditorPieceMaterialAdapter;
  history: EditorHistoryAdapter;
  colorStudio: EditorColorStudioAdapter;
  modelOutliner: EditorModelOutlinerAdapter;
  animation?: EditorAnimationCommandAdapter;
}

export type EditorCommandRequest = Omit<CommandInvocation, 'invocationId'> & {
  invocationId?: string;
};

export interface EditorApplicationCommands {
  invoke<Result = unknown>(request: EditorCommandRequest): CommandOutcome<Result>;
  command(id: string): CommandProjection | undefined;
  commandsByMenu(menu: string): readonly CommandProjection[];
  availability(commandId: string, args?: unknown, origin?: string): CommandAvailability;
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

function studioFailure(error: unknown): { ok: false; reason: string } {
  const reason = error instanceof ColorStudioRejected
    ? `${error.code}: ${error.message}`
    : ((error as Error)?.message || 'Color Studio validation failed');
  return { ok: false, reason };
}

function studioRecord(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new ColorStudioRejected('INVALID_ARGS', 'command arguments must be an object');
  }
  return args as Record<string, unknown>;
}

function studioPlan<Result>(planner: () => Result) {
  try { return { ok: true as const, value: planner() }; }
  catch (error) { return studioFailure(error); }
}

export function isColorStudioChoiceCommandId(id: string): id is typeof COLOR_STUDIO_CHOICE_COMMAND_IDS[number] {
  return (COLOR_STUDIO_CHOICE_COMMAND_IDS as readonly string[]).includes(id);
}

export function isColorStudioActionCommandId(id: string): id is typeof COLOR_STUDIO_ACTION_COMMAND_IDS[number] {
  return (COLOR_STUDIO_ACTION_COMMAND_IDS as readonly string[]).includes(id);
}

export function isModelOutlinerActionCommandId(id: string): id is ModelOutlinerCommandId {
  return (MODEL_OUTLINER_ACTION_COMMAND_IDS as readonly string[]).includes(id);
}

function modelOutlinerFailure(error: unknown): { ok: false; reason: string } {
  const reason = error instanceof ModelOutlinerRejected
    ? `${error.code}: ${error.message}`
    : ((error as Error)?.message || 'model outliner validation failed');
  return { ok: false, reason };
}

function modelOutlinerRecord(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new ModelOutlinerRejected('INVALID_ARGS', 'command arguments must be an object');
  }
  return args as Record<string, unknown>;
}

function modelOutlinerPlan<Result>(planner: () => Result) {
  try { return { ok: true as const, value: planner() }; }
  catch (error) { return modelOutlinerFailure(error); }
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
  { id: WORLD_DRAW_WALL_TOOL_COMMAND_ID, label: 'Draw Wall', icon: 'BrickWall', menu: 'Build', chord: 'G' },
  // Place Opening (req_4513): armed from the Doors/Windows palette, no chord.
  { id: WORLD_CUT_OPENING_TOOL_COMMAND_ID, label: 'Place Door / Window', icon: 'DoorOpen', menu: 'Build', chord: '' },
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

function spinArgs(adapter: EditorPieceEditAdapter, args: unknown) {
  const value = args as Partial<PieceSpinArgs> | null;
  if (!value || typeof value.documentId !== 'string' || typeof value.pieceId !== 'string' || typeof value.spinDegPerSec !== 'number') {
    return { ok: false as const, reason: 'documentId, pieceId, and spinDegPerSec are required' };
  }
  try {
    return { ok: true as const, value: planPieceSpin(adapter.read(), value as PieceSpinArgs) };
  } catch (error) {
    return { ok: false as const, reason: editRejectReason(error) };
  }
}

function skinArgs(adapter: EditorPieceEditAdapter, args: unknown) {
  const value = args as Partial<PieceSkinArgs> | null;
  if (!value || typeof value.documentId !== 'string' || typeof value.pieceId !== 'string' || value.skinId === undefined) {
    return { ok: false as const, reason: 'documentId, pieceId, and skinId (null = base look) are required' };
  }
  try {
    return { ok: true as const, value: planPieceSkin(adapter.read(), value as PieceSkinArgs, adapter.skinPolicy) };
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

function materialAssignArgs(adapter: EditorPieceMaterialAdapter, args: unknown) {
  const value = args as Partial<PieceMaterialAssignArgs> | null;
  if (!value || typeof value.documentId !== 'string' || !Array.isArray(value.targets) || typeof value.materialAssetId !== 'string') {
    return { ok: false as const, reason: 'documentId, targets, and materialAssetId are required' };
  }
  try {
    return { ok: true as const, value: planPieceMaterialAssign(adapter.read(), value as PieceMaterialAssignArgs, adapter.policy) };
  } catch (error) {
    return { ok: false as const, reason: editRejectReason(error) };
  }
}

function materialClearArgs(adapter: EditorPieceMaterialAdapter, args: unknown) {
  const value = args as Partial<PieceMaterialClearArgs> | null;
  if (!value || typeof value.documentId !== 'string' || !Array.isArray(value.targets)) {
    return { ok: false as const, reason: 'documentId and targets are required' };
  }
  try {
    return { ok: true as const, value: planPieceMaterialClear(adapter.read(), value as PieceMaterialClearArgs, adapter.policy) };
  } catch (error) {
    return { ok: false as const, reason: editRejectReason(error) };
  }
}

export function isWorldPieceEditCommandId(id: string): id is WorldPieceEditCommandId {
  return (WORLD_PIECE_EDIT_COMMAND_IDS as readonly string[]).includes(id);
}

export function isWorldPieceMaterialCommandId(id: string): id is WorldPieceMaterialCommandId {
  return (WORLD_PIECE_MATERIAL_COMMAND_IDS as readonly string[]).includes(id);
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
      keybindings: tool.chord ? [{ chord: tool.chord, when: { surface: 'world' } }] : [],
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
    id: WORLD_PIECE_SPIN_COMMAND_ID,
    label: 'Spin World Piece',
    icon: 'Orbit',
    effect: 'action',
    undoScope: { kind: 'document', key: 'world' },
    projections: { menu: ['Build'], contextMenu: ['world-piece'], palette: true },
    validateArgs: (args) => spinArgs(adapter.pieceEdit, args),
    isEnabled: pieceEditEnabled,
  }, ({ args, invocationId, actionId }) => commitPieceEdit(args, actionId ?? invocationId));

  registry.register<PieceEditPlan, WorldPieceEditResult>({
    id: WORLD_PIECE_SKIN_COMMAND_ID,
    label: 'Set Piece Painting',
    icon: 'Brush',
    effect: 'action',
    undoScope: { kind: 'document', key: 'world' },
    projections: { contextMenu: ['world-piece'], palette: true },
    validateArgs: (args) => skinArgs(adapter.pieceEdit, args),
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

  const commitPieceMaterial = (plan: PieceMaterialPlan, actionId: string): WorldPieceMaterialResult => {
    const applyStartedAtMs = adapter.pieceMaterial.now();
    const committedAtMs = adapter.pieceMaterial.commit(plan, actionId, applyStartedAtMs);
    const appliedAtMs = Number.isFinite(committedAtMs) ? Math.max(applyStartedAtMs, committedAtMs) : applyStartedAtMs;
    return { plan, applyStartedAtMs, appliedAtMs, applyMs: Math.max(0, appliedAtMs - applyStartedAtMs) };
  };

  registry.register<PieceMaterialPlan, WorldPieceMaterialResult>({
    id: WORLD_PIECE_MATERIAL_ASSIGN_COMMAND_ID,
    label: 'Assign Piece Material',
    icon: 'Paintbrush',
    effect: 'action',
    undoScope: { kind: 'document', key: 'world' },
    projections: {
      toolbar: ['D.world.paint-faces'], contextMenu: ['world-piece'], palette: true,
    },
    validateArgs: (args) => materialAssignArgs(adapter.pieceMaterial, args),
    isEnabled: pieceEditEnabled,
  }, ({ args, invocationId, actionId }) => commitPieceMaterial(args, actionId ?? invocationId));

  registry.register<PieceMaterialPlan, WorldPieceMaterialResult>({
    id: WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID,
    label: 'Clear Piece Material',
    icon: 'RotateCcw',
    effect: 'action',
    undoScope: { kind: 'document', key: 'world' },
    projections: { contextMenu: ['world-piece'], palette: true },
    validateArgs: (args) => materialClearArgs(adapter.pieceMaterial, args),
    isEnabled: pieceEditEnabled,
  }, ({ args, invocationId, actionId }) => commitPieceMaterial(args, actionId ?? invocationId));

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

  const modelSurfaceEnabled = () => {
    const blocked = adapter.blockedReason();
    if (blocked) return { enabled: false, reason: `resolve ${blocked} first` };
    return adapter.activeSurface() === 'model'
      ? true
      : { enabled: false, reason: 'only in the model editor' };
  };
  const commitModelOutliner = (plan: ModelOutlinerPlan, actionId: string): ModelOutlinerActionResult => {
    const applyStartedAtMs = adapter.modelOutliner.now();
    const committedAtMs = adapter.modelOutliner.commit(plan, actionId, applyStartedAtMs);
    const appliedAtMs = Number.isFinite(committedAtMs) ? Math.max(applyStartedAtMs, committedAtMs) : applyStartedAtMs;
    return { plan, applyStartedAtMs, appliedAtMs, applyMs: Math.max(0, appliedAtMs - applyStartedAtMs) };
  };
  const outlinerRegistration = (
    id: ModelOutlinerCommandId,
    label: string,
    icon: string,
    validateArgs: (args: unknown) => { ok: true; value: ModelOutlinerPlan } | { ok: false; reason: string },
  ) => registry.register<ModelOutlinerPlan, ModelOutlinerActionResult>({
    id,
    label,
    icon,
    effect: 'action',
    undoScope: { kind: 'native', key: 'model' },
    requiredCapabilities: ['model.edit'],
    projections: { contextMenu: ['model-outliner'] },
    validateArgs,
    isEnabled: modelSurfaceEnabled,
  }, ({ args, actionId, invocationId }) => commitModelOutliner(args, actionId ?? invocationId));

  outlinerRegistration(MODEL_PART_RENAME_COMMAND_ID, 'Rename Model Part', 'PencilLine', (args) => modelOutlinerPlan(() => {
    const value = modelOutlinerRecord(args);
    return planPartRename(adapter.modelOutliner.read(value.modelId as string), {
      modelId: value.modelId as string,
      partId: value.partId as string,
      name: value.name as string,
    });
  }));
  outlinerRegistration(MODEL_PARTS_GROUP_COMMAND_ID, 'Group Model Parts', 'FolderPlus', (args) => modelOutlinerPlan(() => {
    const value = modelOutlinerRecord(args);
    return planPartsGroup(adapter.modelOutliner.read(value.modelId as string), {
      modelId: value.modelId as string,
      partIds: value.partIds as string[],
    });
  }));
  outlinerRegistration(MODEL_PARTS_UNGROUP_COMMAND_ID, 'Ungroup Model Parts', 'FolderMinus', (args) => modelOutlinerPlan(() => {
    const value = modelOutlinerRecord(args);
    return planPartsUngroup(adapter.modelOutliner.read(value.modelId as string), {
      modelId: value.modelId as string,
      partIds: value.partIds as string[],
    });
  }));
  outlinerRegistration(MODEL_GROUP_RENAME_COMMAND_ID, 'Rename Model Part Group', 'PencilLine', (args) => modelOutlinerPlan(() => {
    const value = modelOutlinerRecord(args);
    return planGroupRename(adapter.modelOutliner.read(value.modelId as string), {
      modelId: value.modelId as string,
      groupId: value.groupId as string,
      name: value.name as string,
    });
  }));
  outlinerRegistration(MODEL_GROUP_DISSOLVE_COMMAND_ID, 'Dissolve Model Part Group', 'FolderX', (args) => modelOutlinerPlan(() => {
    const value = modelOutlinerRecord(args);
    return planGroupDissolve(adapter.modelOutliner.read(value.modelId as string), {
      modelId: value.modelId as string,
      groupId: value.groupId as string,
    });
  }));
  outlinerRegistration(MODEL_OUTLINER_MOVE_COMMAND_ID, 'Move Model Outliner Item', 'GripVertical', (args) => modelOutlinerPlan(() => {
    const value = modelOutlinerRecord(args);
    return planOutlinerMove(adapter.modelOutliner.read(value.modelId as string), {
      modelId: value.modelId as string,
      item: value.item as any,
      target: value.target as any,
    });
  }));

  registerAnimationCommands(registry, adapter.animation);

  const authoringSurfaceEnabled = () => {
    const blocked = adapter.blockedReason();
    if (blocked) return { enabled: false, reason: `resolve ${blocked} first` };
    const surface = adapter.activeSurface();
    return surface === 'world' || surface === 'model' || surface === 'material'
      ? true
      : { enabled: false, reason: 'only on an authoring surface' };
  };
  const materialSurfaceEnabled = () => {
    const enabled = authoringSurfaceEnabled();
    if (enabled !== true) return enabled;
    return adapter.activeSurface() === 'material'
      ? true
      : { enabled: false, reason: 'only in Color Studio' };
  };
  const commitChoice = (result: ColorStudioChoiceResult): ColorStudioChoiceResult => {
    if (result.changed) adapter.colorStudio.commitChoice(result);
    return result;
  };
  const commitStudioAction = (plan: ColorStudioActionPlan, actionId: string): ColorStudioActionResult => {
    const applyStartedAtMs = adapter.colorStudio.now();
    const committedAtMs = adapter.colorStudio.commitAction(plan, actionId, applyStartedAtMs);
    const appliedAtMs = Number.isFinite(committedAtMs) ? Math.max(applyStartedAtMs, committedAtMs) : applyStartedAtMs;
    return { plan, applyStartedAtMs, appliedAtMs, applyMs: Math.max(0, appliedAtMs - applyStartedAtMs) };
  };

  registry.register<ColorStudioChoiceResult, ColorStudioChoiceResult>({
    id: COLOR_STUDIO_MATERIAL_SELECT_COMMAND_ID,
    label: 'Select Color Studio Material',
    icon: 'SwatchBook',
    effect: 'report-only',
    undoScope: 'none',
    projections: { hiddenReason: 'projected by material cards and paint-ink handoffs' },
    validateArgs: (args) => studioPlan(() => {
      const value = studioRecord(args);
      if (typeof value.specId !== 'string') throw new ColorStudioRejected('INVALID_MATERIAL', 'material id is required');
      return planMaterialChoice(adapter.colorStudio.read(), value.specId, adapter.colorStudio.policy, (value.variant ?? 0) as number);
    }),
    isEnabled: authoringSurfaceEnabled,
  }, ({ args }) => commitChoice(args));

  registry.register<ColorStudioChoiceResult, ColorStudioChoiceResult>({
    id: COLOR_STUDIO_VARIANT_SELECT_COMMAND_ID,
    label: 'Select Material Variant',
    icon: 'Layers3',
    effect: 'report-only',
    undoScope: 'none',
    projections: { hiddenReason: 'projected by Color Studio variant segments' },
    validateArgs: (args) => studioPlan(() => {
      const value = studioRecord(args);
      return planVariantChoice(adapter.colorStudio.read(), value.variant as number, adapter.colorStudio.policy);
    }),
    isEnabled: materialSurfaceEnabled,
  }, ({ args }) => commitChoice(args));

  registry.register<ColorStudioChoiceResult, ColorStudioChoiceResult>({
    id: COLOR_STUDIO_SEED_ROLL_COMMAND_ID,
    label: 'Roll Material Seed',
    icon: 'Dices',
    effect: 'report-only',
    undoScope: 'none',
    projections: { hiddenReason: 'projected by the Color Studio seed control' },
    validateArgs: (args) => {
      const valid = noArgs(args);
      return valid.ok ? studioPlan(() => planSeedRoll(adapter.colorStudio.read(), adapter.colorStudio.policy)) : valid;
    },
    isEnabled: materialSurfaceEnabled,
  }, ({ args }) => commitChoice(args));

  registry.register<ColorStudioChoiceResult, ColorStudioChoiceResult>({
    id: COLOR_STUDIO_QUALITY_SELECT_COMMAND_ID,
    label: 'Select Material Quality',
    icon: 'Gauge',
    effect: 'report-only',
    undoScope: 'none',
    projections: { hiddenReason: 'projected by Color Studio quality segments' },
    validateArgs: (args) => studioPlan(() => {
      const value = studioRecord(args);
      return planQualityChoice(adapter.colorStudio.read(), value.quality as number, adapter.colorStudio.policy);
    }),
    isEnabled: materialSurfaceEnabled,
  }, ({ args }) => commitChoice(args));

  registry.register<ColorStudioChoiceResult, ColorStudioChoiceResult>({
    id: COLOR_STUDIO_SLOT_SELECT_COMMAND_ID,
    label: 'Select Material Slot',
    icon: 'Pipette',
    effect: 'report-only',
    undoScope: 'none',
    projections: { hiddenReason: 'projected by the Color Studio slot grid' },
    validateArgs: (args) => studioPlan(() => {
      const value = studioRecord(args);
      return planSlotChoice(adapter.colorStudio.read(), value.slot as number, adapter.colorStudio.policy);
    }),
    isEnabled: materialSurfaceEnabled,
  }, ({ args }) => commitChoice(args));

  registry.register<ColorStudioChoiceResult, ColorStudioChoiceResult>({
    id: COLOR_STUDIO_VIEW_SELECT_COMMAND_ID,
    label: 'Select Color Studio View',
    icon: 'PanelTop',
    effect: 'report-only',
    undoScope: 'none',
    projections: { hiddenReason: 'projected by Color Studio view tabs' },
    validateArgs: (args) => studioPlan(() => {
      const value = studioRecord(args);
      return planViewChoice(adapter.colorStudio.read(), value.view);
    }),
    isEnabled: materialSurfaceEnabled,
  }, ({ args }) => commitChoice(args));

  registry.register<ColorStudioChoiceResult, ColorStudioChoiceResult>({
    id: COLOR_STUDIO_COLOR_SELECT_COMMAND_ID,
    label: 'Select Current Paint Color',
    icon: 'Palette',
    effect: 'report-only',
    undoScope: 'none',
    projections: { hiddenReason: 'projected once when a paint-bucket color gesture settles' },
    validateArgs: (args) => studioPlan(() => {
      const value = studioRecord(args);
      return planCurrentColorChoice(adapter.colorStudio.read(), value.color, value.source, value.scenePick);
    }),
    isEnabled: authoringSurfaceEnabled,
  }, ({ args }) => commitChoice(args));

  registry.register<ColorStudioActionPlan, ColorStudioActionResult>({
    id: COLOR_STUDIO_SLOT_FILL_COMMAND_ID,
    label: 'Fill Material Slot',
    icon: 'PaintBucket',
    effect: 'action',
    undoScope: { kind: 'workspace', key: 'color-studio' },
    projections: { toolbar: ['E.color-studio'], palette: true },
    validateArgs: (args) => studioPlan(() => {
      const value = studioRecord(args);
      return planSlotFill(adapter.colorStudio.read(), {
        specId: value.specId,
        variant: value.variant,
        slot: value.slot,
        rgb: value.rgb,
        source: value.source,
      }, adapter.colorStudio.policy);
    }),
    isEnabled: materialSurfaceEnabled,
  }, ({ args, actionId, invocationId }) => commitStudioAction(args, actionId ?? invocationId));

  registry.register<ColorStudioActionPlan, ColorStudioActionResult>({
    id: COLOR_STUDIO_SLOTS_RESET_COMMAND_ID,
    label: 'Reset Material Slots',
    icon: 'RotateCcw',
    effect: 'action',
    undoScope: { kind: 'workspace', key: 'color-studio' },
    projections: { toolbar: ['E.color-studio'], palette: true },
    validateArgs: (args) => studioPlan(() => {
      const value = studioRecord(args);
      return planSlotsReset(adapter.colorStudio.read(), {
        specId: value.specId,
        variant: value.variant,
      }, adapter.colorStudio.policy);
    }),
    isEnabled: materialSurfaceEnabled,
  }, ({ args, actionId, invocationId }) => commitStudioAction(args, actionId ?? invocationId));

  registry.register<ColorStudioActionPlan, ColorStudioActionResult>({
    id: COLOR_STUDIO_PALETTE_ADD_COMMAND_ID,
    label: 'Add Current Color to Tray',
    icon: 'Plus',
    effect: 'action',
    undoScope: { kind: 'workspace', key: 'color-studio' },
    projections: { hiddenReason: 'projected by the shared paint bucket tray control' },
    validateArgs: (args) => studioPlan(() => {
      const value = studioRecord(args);
      return planPaletteAdd(adapter.colorStudio.read(), { color: value.color, source: value.source });
    }),
    isEnabled: authoringSurfaceEnabled,
  }, ({ args, actionId, invocationId }) => commitStudioAction(args, actionId ?? invocationId));

  registry.register<ColorStudioActionPlan, ColorStudioActionResult>({
    id: COLOR_STUDIO_PALETTE_LOAD_COMMAND_ID,
    label: 'Load Palette Set',
    icon: 'Library',
    effect: 'action',
    undoScope: { kind: 'workspace', key: 'color-studio' },
    projections: { hiddenReason: 'projected by the shared paint bucket library rows' },
    validateArgs: (args) => studioPlan(() => {
      const value = studioRecord(args);
      return planPaletteLoad(adapter.colorStudio.read(), { colors: value.colors, setName: value.setName });
    }),
    isEnabled: authoringSurfaceEnabled,
  }, ({ args, actionId, invocationId }) => commitStudioAction(args, actionId ?? invocationId));

  registry.register<{}, ColorStudioHistoryControlResult>({
    id: COLOR_STUDIO_UNDO_COMMAND_ID,
    label: 'Undo Color Studio Action',
    icon: 'Undo2',
    effect: 'control',
    undoScope: { kind: 'workspace', key: 'color-studio' },
    outcomePhase: 'undone',
    projections: { menu: ['Edit'], toolbar: ['H.history'], palette: true },
    keybindings: [{ chord: 'Ctrl+Z', when: { surface: 'material' } }],
    validateArgs: noArgs,
    isEnabled: () => {
      const enabled = materialSurfaceEnabled();
      if (enabled !== true) return enabled;
      return adapter.colorStudio.history.peekUndo() ? true : { enabled: false, reason: 'nothing to undo in Color Studio' };
    },
  }, () => adapter.colorStudio.history.commitUndo());

  registry.register<{}, ColorStudioHistoryControlResult>({
    id: COLOR_STUDIO_REDO_COMMAND_ID,
    label: 'Redo Color Studio Action',
    icon: 'Redo2',
    effect: 'control',
    undoScope: { kind: 'workspace', key: 'color-studio' },
    outcomePhase: 'redone',
    projections: { menu: ['Edit'], toolbar: ['H.history'], palette: true },
    keybindings: [
      { chord: 'Ctrl+Shift+Z', when: { surface: 'material' } },
      { chord: 'Ctrl+Y', when: { surface: 'material' } },
    ],
    validateArgs: noArgs,
    isEnabled: () => {
      const enabled = materialSurfaceEnabled();
      if (enabled !== true) return enabled;
      return adapter.colorStudio.history.peekRedo() ? true : { enabled: false, reason: 'nothing to redo in Color Studio' };
    },
  }, () => adapter.colorStudio.history.commitRedo());

  const authority = new CommandAuthority(registry, {
    outcomeSink,
    // Claim admission (req_3850): commands declaring 'model.edit' mutate the
    // active model document. The seat lane's password was already verified at
    // the transport door, so its origin passes; every other origin is a
    // user-lane edit and answers to the claim table. Refusals reject as
    // 'unauthorized' and flow through the outcome sink like any command.
    hasCapability: (capability, context) => {
      if (capability !== 'model.edit') return false;
      if (context.origin === 'seat') return true;
      return claimAdmits(claimActiveModel(), undefined).ok;
    },
  });
  return Object.freeze({
    invoke<Result = unknown>(request: EditorCommandRequest): CommandOutcome<Result> {
      return authority.invoke<Result>({
        ...request,
        invocationId: request.invocationId ?? `editor:${instanceId}:${++invocationSequence}`,
      });
    },
    command: (id: string) => registry.command(id),
    commandsByMenu: (menu: string) => registry.byMenu(menu),
    availability: (commandId: string, args?: unknown, origin?: string) =>
      authority.availability({ commandId, args, origin }),
    resolveChord: (chord: string, mode: CommandMode = {}) => registry.resolveChord(chord, mode),
  });
}

export function commandSource(source: string): CommandSource {
  if (source === 'action bar') return 'toolbar';
  if (source === 'context') return 'context-menu';
  if (source === 'stage') return 'viewport';
  if (source === 'focus-panel') return 'dock';
  if (source === 'menu' || source === 'hotkey' || source === 'toolbar' || source === 'dock' || source === 'context-menu' ||
      source === 'palette' || source === 'viewport' || source === 'native' || source === 'remote' || source === 'automation') {
    return source;
  }
  return 'automation';
}
