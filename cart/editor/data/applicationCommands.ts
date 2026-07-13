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
import type { PlacedPiece, PlacementGesture } from '../world/pieces';

export const WORLD_FLOOR_STEP_COMMAND_ID = 'world.floor.step';
export const WORLD_MAX_FLOOR = 128;
export const WORLD_UNDO_COMMAND_ID = 'world.history.undo';
export const WORLD_REDO_COMMAND_ID = 'world.history.redo';
export { WORLD_PIECES_PLACE_COMMAND_ID } from '../world/piecePlacementCommand';

export type WorldFloorStepArgs = { delta: -1 | 1 };
export type WorldFloorStepResult = {
  previousFloorIndex: number;
  floorIndex: number;
  delta: -1 | 1;
  maxFloor: number;
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

export interface EditorPlacementAdapter {
  read(): PiecePlacementWorld;
  policy: PiecePlacementPolicy;
  now(): number;
  /** Atomically commit a previously validated plan and return the timestamp at
   * which the new snapshot became authoritative. This method must not throw. */
  commit(plan: PiecePlacementPlan, actionId: string, gesture: PlacementGesture, applyStartedAtMs: number): number;
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

/** The smallest privileged surface needed by the first command slice. It is
 * deliberately not a React setter: the composition root owns how the one
 * committed result becomes the current read-only snapshot. */
export interface EditorCommandAdapter {
  activeSurface(): string;
  blockedReason(): string | null;
  floorIndex(): number;
  commitFloor(result: WorldFloorStepResult): void;
  placement: EditorPlacementAdapter;
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
  return args == null || (typeof args === 'object' && !Array.isArray(args))
    ? { ok: true as const, value: {} }
    : { ok: false as const, reason: 'command takes no arguments' };
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
  }, ({ args, invocationId }) => {
    const applyStartedAtMs = adapter.placement.now();
    const committedAtMs = adapter.placement.commit(args.plan, invocationId, args.gesture, applyStartedAtMs);
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
