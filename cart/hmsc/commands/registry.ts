import type { CommandDefinition, CommandResult, GameState, SpawnedEntity } from '../design';
import { createInitialGameState, readStoredGameState, saveGameState } from '../state/gameState';
import { cellKey, commandCell, placeCell, removeCell, worldToCell } from '../world/grid';
import { findGridPath } from '../world/pathing';
import { isTileKind, tileKindNamesForConsole } from '../world/tileKinds';
import { parseCommandValue, tokenizeCommandLine } from './parser';

function ok(state: GameState, ...output: string[]): CommandResult {
  return { state, output };
}

function fail(state: GameState, message: string): CommandResult {
  return { state, output: [`error: ${message}`] };
}

function numberArg(raw: string | undefined, name: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function readPath(root: any, path: string): unknown {
  return path.split('.').reduce((current, key) => current?.[key], root);
}

function setPath(root: any, path: string, value: unknown): any {
  const keys = path.split('.').filter(Boolean);
  if (keys.length === 0) return root;
  const copy = Array.isArray(root) ? [...root] : { ...root };
  let cursor = copy;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    const next = cursor[key];
    cursor[key] = Array.isArray(next) ? [...next] : { ...(next ?? {}) };
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  return copy;
}

function jsonLine(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function spawnEntity(state: GameState, kind: string, x: number, z: number, y: number, sourceLine: string): GameState {
  const id = `${kind}_${state.nextEntitySerial.toString().padStart(4, '0')}`;
  const entity: SpawnedEntity = {
    id,
    kind,
    position: { x, y, z },
    yawDegrees: 0,
    createdByCommand: sourceLine,
  };
  return {
    ...state,
    nextEntitySerial: state.nextEntitySerial + 1,
    world: {
      ...state.world,
      spawnedEntities: {
        ...state.world.spawnedEntities,
        [id]: entity,
      },
    },
  };
}

const COMMANDS: CommandDefinition[] = [
  {
    name: 'help',
    aliases: ['?'],
    summary: 'List commands or inspect one command.',
    usage: 'help [command]',
    run(args, state) {
      const query = args[0];
      if (query) {
        const command = findCommand(query);
        return command
          ? ok(state, `${command.name}: ${command.summary}`, `usage: ${command.usage}`)
          : fail(state, `unknown command ${query}`);
      }
      return ok(state, ...COMMANDS.map((command) => `${command.name.padEnd(10)} ${command.summary}`));
    },
  },
  {
    name: 'state',
    summary: 'Print the whole GameState or a dot path.',
    usage: 'state [path]',
    run(args, state) {
      const path = args[0];
      return ok(state, jsonLine(path ? readPath(state, path) : state));
    },
  },
  {
    name: 'save',
    summary: 'Persist the current GameState.',
    usage: 'save',
    run(_args, state) {
      const savedState = saveGameState(state);
      return ok(savedState, `saved ${savedState.savedAt}`);
    },
  },
  {
    name: 'load',
    summary: 'Load the persisted GameState.',
    usage: 'load',
    run(_args, state) {
      const loaded = readStoredGameState();
      return loaded ? ok(loaded, 'loaded saved GameState') : fail(state, 'no saved GameState found');
    },
  },
  {
    name: 'reset',
    summary: 'Reset to a fresh scaffold state.',
    usage: 'reset',
    run() {
      return ok(createInitialGameState(), 'reset GameState');
    },
  },
  {
    name: 'teleport',
    aliases: ['tp'],
    summary: 'Move the player in continuous world space.',
    usage: 'teleport <x> <z> [y]',
    run(args, state) {
      try {
        const x = numberArg(args[0], 'x');
        const z = numberArg(args[1], 'z');
        const y = args[2] == null ? state.player.position.y : numberArg(args[2], 'y');
        return ok({ ...state, player: { ...state.player, position: { x, y, z } } }, `player.position = ${x}, ${y}, ${z}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'scene',
    summary: 'Show or set the current scene step.',
    usage: 'scene [step]',
    run(args, state) {
      const step = args.join(' ').trim();
      if (!step) return ok(state, `sceneStep = ${state.sceneStep}`);
      return ok({ ...state, sceneStep: step }, `sceneStep = ${step}`);
    },
  },
  {
    name: 'set',
    summary: 'Set a GameState dot path to a JSON-ish value.',
    usage: 'set <path> <value>',
    run(args, state) {
      const path = args[0];
      if (!path || args.length < 2) return fail(state, 'usage: set <path> <value>');
      try {
        const value = parseCommandValue(args.slice(1).join(' '));
        return ok(setPath(state, path, value), `${path} = ${jsonLine(value)}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'speed',
    summary: 'Set player walk or run speed.',
    usage: 'speed <walk|run> <value>',
    run(args, state) {
      try {
        const mode = args[0];
        const speed = numberArg(args[1], 'speed');
        if (mode === 'walk') {
          return ok({ ...state, player: { ...state.player, walkSpeedMetersPerSecond: speed } }, `walk speed = ${speed}`);
        }
        if (mode === 'run') {
          return ok({ ...state, player: { ...state.player, runSpeedMetersPerSecond: speed } }, `run speed = ${speed}`);
        }
        return fail(state, 'mode must be walk or run');
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'spawn',
    summary: 'Spawn an entity at continuous coordinates.',
    usage: 'spawn <kind> [x] [z] [y]',
    run(args, state, sourceLine) {
      try {
        const kind = args[0];
        if (!kind) return fail(state, 'usage: spawn <kind> [x] [z] [y]');
        const x = args[1] == null ? state.player.position.x : numberArg(args[1], 'x');
        const z = args[2] == null ? state.player.position.z : numberArg(args[2], 'z');
        const y = args[3] == null ? state.player.position.y : numberArg(args[3], 'y');
        const nextState = spawnEntity(state, kind, x, z, y, sourceLine);
        const id = `entity ${kind}_${state.nextEntitySerial.toString().padStart(4, '0')}`;
        return ok(nextState, `spawned ${id} at ${x}, ${y}, ${z}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'despawn',
    summary: 'Remove a spawned entity.',
    usage: 'despawn <entityId>',
    run(args, state) {
      const id = args[0];
      if (!id) return fail(state, 'usage: despawn <entityId>');
      const nextEntities = { ...state.world.spawnedEntities };
      if (!nextEntities[id]) return fail(state, `no entity ${id}`);
      delete nextEntities[id];
      return ok({ ...state, world: { ...state.world, spawnedEntities: nextEntities } }, `despawned ${id}`);
    },
  },
  {
    name: 'place',
    summary: 'Place a world cell on the construction grid.',
    usage: 'place <kind> <x> <z> [y]',
    run(args, state, sourceLine) {
      try {
        const kind = args[0];
        if (!kind) return fail(state, 'usage: place <kind> <x> <z> [y]');
        if (!isTileKind(kind)) return fail(state, `unknown tile kind ${kind}; expected one of ${tileKindNamesForConsole()}`);
        const x = numberArg(args[1], 'x');
        const z = numberArg(args[2], 'z');
        const y = args[3] == null ? 0 : numberArg(args[3], 'y');
        const cell = commandCell(x, z, y);
        return ok(placeCell(state, kind, cell, sourceLine), `placed ${kind} at cell ${cellKey(cell)}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'remove',
    summary: 'Remove a placed world cell.',
    usage: 'remove <x> <z> [y]',
    run(args, state) {
      try {
        const x = numberArg(args[0], 'x');
        const z = numberArg(args[1], 'z');
        const y = args[2] == null ? 0 : numberArg(args[2], 'y');
        const cell = commandCell(x, z, y);
        return ok(removeCell(state, cell), `removed cell ${cellKey(cell)}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'where',
    summary: 'Print continuous player position and grid cell.',
    usage: 'where',
    run(_args, state) {
      const cell = worldToCell(state.player.position, state.world.cellSizeMeters);
      return ok(state, `player = ${jsonLine(state.player.position)}`, `cell = ${cellKey(cell)}`);
    },
  },
  {
    name: 'path',
    summary: 'Find a typed-tile grid path between two cells.',
    usage: 'path <fromX> <fromZ> <toX> <toZ> [y]',
    run(args, state) {
      try {
        const fromX = numberArg(args[0], 'fromX');
        const fromZ = numberArg(args[1], 'fromZ');
        const toX = numberArg(args[2], 'toX');
        const toZ = numberArg(args[3], 'toZ');
        const y = args[4] == null ? 0 : numberArg(args[4], 'y');
        const path = findGridPath(state, commandCell(fromX, fromZ, y), commandCell(toX, toZ, y));
        if (path.length === 0) return fail(state, 'no path through walkable tile kinds');
        return ok(state, `path ${path.length} cells: ${path.map(cellKey).join(' -> ')}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
];

function findCommand(name: string): CommandDefinition | undefined {
  return COMMANDS.find((command) => command.name === name || command.aliases?.includes(name));
}

export function runCommandLine(line: string, state: GameState): CommandResult {
  const tokens = tokenizeCommandLine(line);
  if (tokens.length === 0) return ok(state);
  const [name, ...args] = tokens;
  const command = findCommand(name);
  if (!command) return fail(state, `unknown command ${name}`);
  return command.run(args, state, line);
}
