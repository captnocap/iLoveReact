import { busEmit } from '@reactjit/hooks/useIFTTT';
import { bus as hostEventBus } from '@reactjit/eventBus';
import type { CommandResult, GameState, GridCell, HmscEventRef, HmscGameEvent } from '../design';
import { DEFAULT_GAME_EVENT_LOG_LIMIT } from '../state/defaults';
import { cellKey, worldToCell } from '../world/grid';

export type HmscGameEventInput = {
  type: string;
  source: string;
  actor?: HmscEventRef;
  subject?: HmscEventRef;
  target?: HmscEventRef;
  parentId?: string;
  tags?: string[];
  payload?: Record<string, unknown>;
};

export type CommandEventOptions = {
  source?: string;
  parentEventId?: string;
};

type RecordGameEventResult = {
  state: GameState;
  event: HmscGameEvent;
};

const HMSC_EVENT_ROOT_CHANNEL = 'hmsc:event';
const HMSC_HOST_EVENT_PREFIX = 'hmsc';
const PLAYER_EVENT_ACTOR: HmscEventRef = { kind: 'player', id: 'player' };
const COMMAND_EVENT_IMPORTANCE = 0.35;
const STORY_EVENT_IMPORTANCE = 0.78;
const TRIGGER_EVENT_IMPORTANCE = 0.72;
const DEFAULT_EVENT_IMPORTANCE = 0.5;

function eventId(serial: number): string {
  return `hmsc_evt_${serial.toString().padStart(6, '0')}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function eventImportance(event: HmscGameEvent): number {
  if (event.type.startsWith('story.')) return STORY_EVENT_IMPORTANCE;
  if (event.type.includes('trigger') || event.type.startsWith('lab.')) return TRIGGER_EVENT_IMPORTANCE;
  if (event.type.startsWith('command.')) return COMMAND_EVENT_IMPORTANCE;
  return DEFAULT_EVENT_IMPORTANCE;
}

function safePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return { unserializable: true };
  }
}

function playerCellKey(state: GameState): string {
  return cellKey(worldToCell(state.player.position, state.world.cellSizeMeters));
}

function publishEventChannel(channel: string, event: HmscGameEvent): void {
  try {
    busEmit(channel, event);
  } catch {}
}

export function cellEventRef(cell: GridCell): HmscEventRef {
  return { kind: 'cell', id: cellKey(cell) };
}

export function playerEventActor(): HmscEventRef {
  return PLAYER_EVENT_ACTOR;
}

export function recordGameEvent(state: GameState, input: HmscGameEventInput): RecordGameEventResult {
  const serial = state.events.nextEventSerial;
  const event: HmscGameEvent = {
    id: eventId(serial),
    serial,
    occurredAt: nowIso(),
    type: input.type,
    source: input.source,
    sceneStep: state.sceneStep,
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.target ? { target: input.target } : {}),
    ...(input.parentId ? { parentId: input.parentId } : {}),
    tags: input.tags ?? [],
    player: {
      position: state.player.position,
      yawDegrees: state.player.yawDegrees,
      cellKey: playerCellKey(state),
    },
    payload: safePayload(input.payload),
  };
  return {
    state: {
      ...state,
      events: {
        nextEventSerial: serial + 1,
        recent: [...state.events.recent, event].slice(-DEFAULT_GAME_EVENT_LOG_LIMIT),
      },
    },
    event,
  };
}

export function publishGameEvent(event: HmscGameEvent): void {
  hostEventBus.emit(`${HMSC_HOST_EVENT_PREFIX}:${event.type}`, event, {
    source: 'hmsc',
    importance: eventImportance(event),
  });
  publishEventChannel(HMSC_EVENT_ROOT_CHANNEL, event);
  publishEventChannel(`${HMSC_EVENT_ROOT_CHANNEL}:${event.type}`, event);
  if (event.actor) publishEventChannel(`hmsc:actor:${event.actor.kind}:${event.actor.id}`, event);
  if (event.subject) publishEventChannel(`hmsc:subject:${event.subject.kind}:${event.subject.id}`, event);
  for (const tag of event.tags) publishEventChannel(`hmsc:tag:${tag}`, event);
}

export function recordAndPublishGameEvent(state: GameState, input: HmscGameEventInput): RecordGameEventResult {
  const result = recordGameEvent(state, input);
  publishGameEvent(result.event);
  return result;
}

function changedKeys<T>(before: Record<string, T>, after: Record<string, T>): { added: string[]; removed: string[] } {
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));
  const added = Array.from(afterKeys).filter((key) => !beforeKeys.has(key));
  const removed = Array.from(beforeKeys).filter((key) => !afterKeys.has(key));
  return { added, removed };
}

function appendCommandDerivedEvent(
  state: GameState,
  input: HmscGameEventInput,
): RecordGameEventResult {
  return recordAndPublishGameEvent(state, input);
}

export function recordCommandEvents(
  beforeState: GameState,
  result: CommandResult,
  commandName: string,
  sourceLine: string,
  options: CommandEventOptions = {},
): CommandResult {
  const success = !result.output.some((line) => line.startsWith('error:'));
  let nextState = result.state;
  const commandEvent = recordAndPublishGameEvent(nextState, {
    type: 'command.executed',
    source: options.source ?? 'console',
    actor: { kind: 'command', id: commandName },
    parentId: options.parentEventId,
    tags: ['command'],
    payload: {
      line: sourceLine,
      success,
      output: result.output,
    },
  });
  nextState = commandEvent.state;
  const parentId = commandEvent.event.id;

  if (beforeState.sceneStep !== result.state.sceneStep) {
    const enteredLab = result.state.sceneStep.startsWith('lab.') ? result.state.sceneStep.slice('lab.'.length) : null;
    const exitedLab = beforeState.sceneStep.startsWith('lab.') && result.state.sceneStep === 'boot.console'
      ? beforeState.sceneStep.slice('lab.'.length)
      : null;
    const sceneEvent = appendCommandDerivedEvent(nextState, {
      type: 'scene.changed',
      source: 'command-diff',
      actor: { kind: 'command', id: commandName },
      subject: { kind: 'system', id: result.state.sceneStep },
      parentId,
      tags: ['scene'],
      payload: {
        from: beforeState.sceneStep,
        to: result.state.sceneStep,
      },
    });
    nextState = sceneEvent.state;
    if (enteredLab) {
      nextState = appendCommandDerivedEvent(nextState, {
        type: 'lab.entered',
        source: 'command-diff',
        actor: PLAYER_EVENT_ACTOR,
        subject: { kind: 'lab', id: enteredLab },
        parentId,
        tags: ['lab', 'story'],
        payload: { lab: enteredLab },
      }).state;
    }
    if (exitedLab) {
      nextState = appendCommandDerivedEvent(nextState, {
        type: 'lab.exited',
        source: 'command-diff',
        actor: PLAYER_EVENT_ACTOR,
        subject: { kind: 'lab', id: exitedLab },
        parentId,
        tags: ['lab', 'story'],
        payload: { lab: exitedLab },
      }).state;
    }
  }

  const entityDelta = changedKeys(beforeState.world.spawnedEntities, result.state.world.spawnedEntities);
  for (const id of entityDelta.added) {
    nextState = appendCommandDerivedEvent(nextState, {
      type: 'entity.spawned',
      source: 'command-diff',
      actor: { kind: 'command', id: commandName },
      subject: { kind: 'entity', id },
      parentId,
      tags: ['entity'],
      payload: result.state.world.spawnedEntities[id],
    }).state;
  }
  for (const id of entityDelta.removed) {
    nextState = appendCommandDerivedEvent(nextState, {
      type: 'entity.despawned',
      source: 'command-diff',
      actor: { kind: 'command', id: commandName },
      subject: { kind: 'entity', id },
      parentId,
      tags: ['entity'],
      payload: beforeState.world.spawnedEntities[id],
    }).state;
  }

  const cellDelta = changedKeys(beforeState.world.placedCells, result.state.world.placedCells);
  for (const id of cellDelta.added) {
    nextState = appendCommandDerivedEvent(nextState, {
      type: 'world.cell.placed',
      source: 'command-diff',
      actor: { kind: 'command', id: commandName },
      subject: { kind: 'cell', id },
      parentId,
      tags: ['world', 'cell'],
      payload: result.state.world.placedCells[id],
    }).state;
  }
  for (const id of cellDelta.removed) {
    nextState = appendCommandDerivedEvent(nextState, {
      type: 'world.cell.removed',
      source: 'command-diff',
      actor: { kind: 'command', id: commandName },
      subject: { kind: 'cell', id },
      parentId,
      tags: ['world', 'cell'],
      payload: beforeState.world.placedCells[id],
    }).state;
  }

  return { ...result, state: nextState };
}

export function formatGameEventForConsole(event: HmscGameEvent): string {
  const subject = event.subject ? ` ${event.subject.kind}:${event.subject.id}` : '';
  const parent = event.parentId ? ` parent=${event.parentId}` : '';
  return `${event.id} ${event.type}${subject} player=${event.player.cellKey}${parent}`;
}
