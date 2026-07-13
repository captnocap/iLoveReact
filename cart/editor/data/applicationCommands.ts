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

export const WORLD_FLOOR_STEP_COMMAND_ID = 'world.floor.step';
export const WORLD_MAX_FLOOR = 128;

export type WorldFloorStepArgs = { delta: -1 | 1 };
export type WorldFloorStepResult = {
  previousFloorIndex: number;
  floorIndex: number;
  delta: -1 | 1;
  maxFloor: number;
};

/** The smallest privileged surface needed by the first command slice. It is
 * deliberately not a React setter: the composition root owns how the one
 * committed result becomes the current read-only snapshot. */
export interface EditorCommandAdapter {
  activeSurface(): string;
  blockedReason(): string | null;
  floorIndex(): number;
  commitFloor(result: WorldFloorStepResult): void;
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
  if (source === 'menu' || source === 'hotkey' || source === 'toolbar' || source === 'context-menu' ||
      source === 'palette' || source === 'viewport' || source === 'native' || source === 'remote' || source === 'automation') {
    return source;
  }
  return 'automation';
}
