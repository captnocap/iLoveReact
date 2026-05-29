import type { CommandDefinition, CommandResult, GameState, SkyConfigState, SpawnedEntity } from '../design';
import { formatGameEventForConsole, recordCommandEvents, recordAndPublishGameEvent, type CommandEventOptions } from '../events/gameEvents';
import { inputBindingsForConsole } from '../input/controlContract';
import { hmscLabForSceneStep, hmscLabNamesForConsole, HMSC_LAB_DEFINITIONS, isHmscLabName } from '../labs/labDefinitions';
import {
  clampSkyInfluence,
  HMSC_SKY_NAMED_HOURS,
  HMSC_SKY_WEATHER_PRESETS,
  hmscSkyWeatherPresetNamesForConsole,
  normalizeSkyHour,
  type HmscSkyNamedHour,
  type HmscSkyWeatherPresetName,
} from '../render3d/sky';
import {
  BALL_ENTITY_RADIUS_METERS,
  BARREL_ENTITY_RADIUS_METERS,
  CRATE_ENTITY_RADIUS_METERS,
  DEFAULT_ENTITY_RADIUS_METERS,
  DEFAULT_ENTITY_RESTITUTION,
  DEFAULT_PHYSICS_BURST_COUNT,
  MAX_CONSOLE_EVENT_LINES,
  MAX_DRAW_RADIUS_METERS,
  MAX_PHYSICS_BURST_COUNT,
  MIN_DRAW_RADIUS_METERS,
  PHYSICS_BURST_ANGLE_ITEM_STEP,
  PHYSICS_BURST_ANGLE_SERIAL_STEP,
  PHYSICS_BURST_BASE_HEIGHT_METERS,
  PHYSICS_BURST_HEIGHT_STEP_METERS,
  PHYSICS_BURST_HEIGHT_LANE_COUNT,
  PHYSICS_BURST_HORIZONTAL_SPEED_METERS_PER_SECOND,
  PHYSICS_BURST_KIND_COUNT,
  PHYSICS_BURST_SPAWN_RADIUS_METERS,
  PHYSICS_BURST_VERTICAL_SPEED_METERS_PER_SECOND,
  PHYSICS_BURST_VERTICAL_SPEED_LANE_COUNT,
  PHYSICS_BURST_VERTICAL_SPEED_STEP_METERS_PER_SECOND,
  SPAWN_ENTITY_CLEARANCE_METERS,
} from '../state/defaults';
import { createInitialGameState, readStoredGameState, saveGameState } from '../state/gameState';
import { cellKey, commandCell, placeCell, placedCellAt, removeCell, setCellTrigger, worldToCell } from '../world/grid';
import { placeRoad, removeRoad, roadFootprint } from '../world/roads';
import { junctionFootprint, placeJunction, removeJunction } from '../world/roadJunctions';
import { solveRoadCrossSection } from '../world/roadProfile';
import type { RoadCulDeSac, RoadCulDeSacThroat, RoadIntersection, RoadLaneCount, RoadOrientation, RoadProfile, RoadSegment } from '../design';
import { movementNoiseModesForConsole, surfaceNoiseProfilesForConsole } from '../world/noiseModel';
import { findGridPath, type PathAgentKind } from '../world/pathing';
import { isTileKind, tileKindDefinition, tileKindNamesForConsole } from '../world/tileKinds';
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

function switchArg(raw: string | undefined, name: string): boolean {
  if (raw === '1' || raw === 'true' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  throw new Error(`${name} must be 1 or 0`);
}

// Shared [lanesPerDir] [bike] [sidewalks] tail parser for the road/junction
// laying commands. Defaults to the minimum profile (1 lane each way, no extras).
function roadProfileArgs(lanesRaw: string | undefined, bikeRaw: string | undefined, sidewalksRaw: string | undefined): RoadProfile {
  return {
    lanesPerDirection: (lanesRaw === '2' ? 2 : 1) as RoadLaneCount,
    hasBikeLane: bikeRaw == null ? false : switchArg(bikeRaw, 'bike'),
    hasSidewalks: sidewalksRaw == null ? false : switchArg(sidewalksRaw, 'sidewalks'),
  };
}

function toggleArg(raw: string | undefined, current: boolean, name: string): boolean {
  if (raw == null || raw === '' || raw === 'toggle') return !current;
  return switchArg(raw, name);
}

function skyHourArg(raw: string | undefined): number {
  const namedHour = HMSC_SKY_NAMED_HOURS[raw as HmscSkyNamedHour];
  if (namedHour != null) return namedHour;
  return normalizeSkyHour(numberArg(raw, 'hour'));
}

function skyInfluenceArg(raw: string | undefined, name: string): number {
  const value = numberArg(raw, name);
  if (value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
  return clampSkyInfluence(value);
}

function skyConfigLine(sky: SkyConfigState): string {
  return [
    `hour=${sky.hour.toFixed(2)}`,
    `weather=${sky.weather.toFixed(2)}`,
    `gloom=${sky.gloom.toFixed(2)}`,
    `dayCycle=${sky.dayCycleEnabled ? '1' : '0'}`,
    `cycleHoursPerRealMinute=${sky.cycleHoursPerRealMinute}`,
  ].join(' ');
}

function setSkyConfig(state: GameState, sky: SkyConfigState): GameState {
  return {
    ...state,
    config: {
      ...state.config,
      sky,
    },
  };
}

function pathAgentArg(raw: string | undefined): PathAgentKind {
  if (raw === 'pedestrian' || raw === 'runner' || raw === 'vehicle') return raw;
  throw new Error('agent must be pedestrian, runner, or vehicle');
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

function physicsRadiusForKind(kind: string): number {
  if (/crate|box/i.test(kind)) return CRATE_ENTITY_RADIUS_METERS;
  if (/barrel|can/i.test(kind)) return BARREL_ENTITY_RADIUS_METERS;
  if (/ball|sphere/i.test(kind)) return BALL_ENTITY_RADIUS_METERS;
  return DEFAULT_ENTITY_RADIUS_METERS;
}

function safePhysicsBurstCount(count: number): number {
  return Math.max(1, Math.min(MAX_PHYSICS_BURST_COUNT, Math.floor(count)));
}

function spawnEntity(state: GameState, kind: string, x: number, z: number, y: number, sourceLine: string): GameState {
  const id = `${kind}_${state.nextEntitySerial.toString().padStart(4, '0')}`;
  const radiusMeters = physicsRadiusForKind(kind);
  const entity: SpawnedEntity = {
    id,
    kind,
    position: { x, y, z },
    yawDegrees: 0,
    physics: {
      enabled: true,
      radiusMeters,
      velocity: { x: 0, y: 0, z: 0 },
      restitution: DEFAULT_ENTITY_RESTITUTION,
      grounded: false,
    },
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

function spawnPhysicsBurst(state: GameState, count: number, sourceLine: string): GameState {
  let nextState = state;
  const safeCount = safePhysicsBurstCount(count);
  for (let i = 0; i < safeCount; i += 1) {
    const serial = nextState.nextEntitySerial;
    const kindIndex = i % PHYSICS_BURST_KIND_COUNT;
    const kind = kindIndex === 0 ? 'crate' : kindIndex === 1 ? 'ball' : kindIndex === 2 ? 'can' : 'prop';
    const radiusMeters = physicsRadiusForKind(kind);
    const angle = serial * PHYSICS_BURST_ANGLE_SERIAL_STEP + i * PHYSICS_BURST_ANGLE_ITEM_STEP;
    const x = state.player.position.x + Math.sin(angle) * PHYSICS_BURST_SPAWN_RADIUS_METERS;
    const z = state.player.position.z + Math.cos(angle) * PHYSICS_BURST_SPAWN_RADIUS_METERS;
    const y = state.player.position.y + PHYSICS_BURST_BASE_HEIGHT_METERS + (i % PHYSICS_BURST_HEIGHT_LANE_COUNT) * PHYSICS_BURST_HEIGHT_STEP_METERS;
    nextState = spawnEntity(nextState, kind, x, z, y, sourceLine);
    const id = `${kind}_${serial.toString().padStart(4, '0')}`;
    nextState = {
      ...nextState,
      world: {
        ...nextState.world,
        spawnedEntities: {
          ...nextState.world.spawnedEntities,
          [id]: {
            ...nextState.world.spawnedEntities[id],
            physics: {
              ...nextState.world.spawnedEntities[id].physics,
              radiusMeters,
              velocity: {
                x: Math.sin(angle) * PHYSICS_BURST_HORIZONTAL_SPEED_METERS_PER_SECOND,
                y: PHYSICS_BURST_VERTICAL_SPEED_METERS_PER_SECOND + (i % PHYSICS_BURST_VERTICAL_SPEED_LANE_COUNT) * PHYSICS_BURST_VERTICAL_SPEED_STEP_METERS_PER_SECOND,
                z: Math.cos(angle) * PHYSICS_BURST_HORIZONTAL_SPEED_METERS_PER_SECOND,
              },
            },
          },
        },
      },
    };
  }
  return nextState;
}

const COMMANDS: CommandDefinition[] = [
  {
    name: 'cmd_help',
    summary: 'List commands or inspect one command.',
    usage: 'cmd_help [command]',
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
    name: 'cmd_cheats',
    summary: 'Enable or disable cheat-gated commands.',
    usage: 'cmd_cheats <1|0>',
    run(args, state) {
      try {
        const cheatsEnabled = switchArg(args[0], 'cheats');
        return ok(
          {
            ...state,
            command: { ...state.command, cheatsEnabled },
            player: cheatsEnabled ? state.player : {
              ...state.player,
              noclip: false,
              physics: {
                ...state.player.physics,
                velocity: { x: 0, y: 0, z: 0 },
              },
            },
          },
          cheatsEnabled ? 'cheats enabled' : 'cheats disabled; noclip off',
        );
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'lab_list',
    summary: 'List HMSC labs that can be spawned inside this cart.',
    usage: 'lab_list',
    run(_args, state) {
      return ok(state, `labs: ${hmscLabNamesForConsole()}`);
    },
  },
  {
    name: 'lab_spawn',
    summary: 'Enter a lab scene through the normal gameplay rig.',
    usage: 'lab_spawn <name>',
    run(args, state) {
      const name = args[0];
      if (!name) return fail(state, `usage: lab_spawn <name>; labs: ${hmscLabNamesForConsole()}`);
      if (!isHmscLabName(name)) return fail(state, `unknown lab ${name}; labs: ${hmscLabNamesForConsole()}`);
      const lab = HMSC_LAB_DEFINITIONS[name];
      return ok({
        ...state,
        sceneStep: lab.sceneStep,
        player: {
          ...state.player,
          position: lab.spawnPosition,
          yawDegrees: lab.spawnYawDegrees,
          physics: {
            ...state.player.physics,
            velocity: { x: 0, y: 0, z: 0 },
            grounded: true,
          },
        },
      }, `entered ${lab.label}`);
    },
  },
  {
    name: 'lab_exit',
    summary: 'Return from a lab scene to the normal game scene.',
    usage: 'lab_exit',
    run(_args, state) {
      const lab = hmscLabForSceneStep(state.sceneStep);
      return ok({
        ...state,
        sceneStep: 'boot.console',
        player: lab ? {
          ...state.player,
          position: lab.exitPosition,
          yawDegrees: lab.exitYawDegrees,
          physics: {
            ...state.player.physics,
            velocity: { x: 0, y: 0, z: 0 },
            grounded: true,
          },
        } : state.player,
      }, 'left lab scene');
    },
  },
  {
    name: 'gv_controls',
    summary: 'Print the canonical HMSC input contract.',
    usage: 'gv_controls',
    run(_args, state) {
      return ok(state, 'input contract:', ...inputBindingsForConsole());
    },
  },
  {
    name: 'gv_debug_hud',
    summary: 'Toggle the live gameplay diagnostics overlay.',
    usage: 'gv_debug_hud [1|0|toggle]',
    run(args, state) {
      try {
        const debugHudEnabled = toggleArg(args[0], state.command.debugHudEnabled, 'debugHud');
        return ok({
          ...state,
          command: {
            ...state.command,
            debugHudEnabled,
          },
        }, `debugHud = ${debugHudEnabled ? '1' : '0'}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'gv_noise',
    summary: 'Print material and movement noise multipliers.',
    usage: 'gv_noise',
    run(_args, state) {
      return ok(state, 'material multipliers:', ...surfaceNoiseProfilesForConsole(), 'movement modes:', ...movementNoiseModesForConsole());
    },
  },
  {
    name: 'wv_tile',
    summary: 'Inspect tile metadata for cover, doors, visibility, traversal, and surface physics.',
    usage: 'wv_tile [kind]',
    run(args, state) {
      const kind = args[0];
      if (!kind) return ok(state, `tile kinds: ${tileKindNamesForConsole()}`);
      if (!isTileKind(kind)) return fail(state, `unknown tile kind ${kind}; expected one of ${tileKindNamesForConsole()}`);
      return ok(state, jsonLine(tileKindDefinition(kind)));
    },
  },
  {
    name: 'gv_sky',
    summary: 'Print current sky clock and weather config.',
    usage: 'gv_sky',
    run(_args, state) {
      return ok(state, skyConfigLine(state.config.sky));
    },
  },
  {
    name: 'gv_time',
    summary: 'Print or set sky time of day.',
    usage: 'gv_time [0-24|midnight|dawn|noon|dusk]',
    run(args, state) {
      if (!args[0]) return ok(state, `sky hour = ${state.config.sky.hour.toFixed(2)}`);
      try {
        const hour = skyHourArg(args[0]);
        return ok(setSkyConfig(state, { ...state.config.sky, hour }), `sky hour = ${hour.toFixed(2)}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'gv_daycycle',
    summary: 'Enable, disable, or retime sky day-night cycling.',
    usage: 'gv_daycycle [1|0] [hours-per-real-minute]',
    run(args, state) {
      if (!args[0]) {
        return ok(
          state,
          `dayCycle = ${state.config.sky.dayCycleEnabled ? '1' : '0'}`,
          `cycleHoursPerRealMinute = ${state.config.sky.cycleHoursPerRealMinute}`,
        );
      }
      try {
        const dayCycleEnabled = switchArg(args[0], 'dayCycle');
        const cycleHoursPerRealMinute = args[1] == null
          ? state.config.sky.cycleHoursPerRealMinute
          : numberArg(args[1], 'hours-per-real-minute');
        if (!Number.isFinite(cycleHoursPerRealMinute)) throw new Error('hours-per-real-minute must be a number');
        return ok(
          setSkyConfig(state, {
            ...state.config.sky,
            dayCycleEnabled,
            cycleHoursPerRealMinute,
          }),
          `dayCycle = ${dayCycleEnabled ? '1' : '0'}`,
          `cycleHoursPerRealMinute = ${cycleHoursPerRealMinute}`,
        );
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'gv_weather',
    summary: 'Print or set sky weather/gloom.',
    usage: 'gv_weather [clear|hazy|cloudy|storm|0-1] [gloom 0-1]',
    run(args, state) {
      if (!args[0]) {
        return ok(
          state,
          `weather = ${state.config.sky.weather.toFixed(2)}`,
          `gloom = ${state.config.sky.gloom.toFixed(2)}`,
          `presets = ${hmscSkyWeatherPresetNamesForConsole()}`,
        );
      }
      try {
        const preset = HMSC_SKY_WEATHER_PRESETS[args[0] as HmscSkyWeatherPresetName];
        const weather = preset ? preset.weather : skyInfluenceArg(args[0], 'weather');
        const gloom = args[1] == null
          ? (preset ? preset.gloom : state.config.sky.gloom)
          : skyInfluenceArg(args[1], 'gloom');
        return ok(
          setSkyConfig(state, {
            ...state.config.sky,
            weather,
            gloom,
          }),
          `weather = ${weather.toFixed(2)}`,
          `gloom = ${gloom.toFixed(2)}`,
        );
      } catch (err: any) {
        return fail(state, `${err.message}; presets: ${hmscSkyWeatherPresetNamesForConsole()}`);
      }
    },
  },
  {
    name: 'gv_view',
    summary: 'Print or set the draw radius (view distance) and fog.',
    usage: 'gv_view [radius-meters] [fogNear] [fogFar]',
    run(args, state) {
      const view = state.config.view;
      if (!args[0]) {
        return ok(
          state,
          `drawRadius = ${view.drawRadiusMeters.toFixed(0)} m`,
          `fogNear = ${view.fogNearMeters.toFixed(0)} m${view.fogNearMeters === 0 ? ' (auto)' : ''}`,
          `fogFar = ${view.fogFarMeters.toFixed(0)} m${view.fogFarMeters === 0 ? ' (auto)' : ''}`,
        );
      }
      try {
        const radius = Math.max(
          MIN_DRAW_RADIUS_METERS,
          Math.min(MAX_DRAW_RADIUS_METERS, numberArg(args[0], 'radius')),
        );
        const fogNear = args[1] == null ? view.fogNearMeters : Math.max(0, numberArg(args[1], 'fogNear'));
        const fogFar = args[2] == null ? view.fogFarMeters : Math.max(0, numberArg(args[2], 'fogFar'));
        return ok(
          {
            ...state,
            config: {
              ...state.config,
              view: { drawRadiusMeters: radius, fogNearMeters: fogNear, fogFarMeters: fogFar },
            },
          },
          `drawRadius = ${radius.toFixed(0)} m`,
          `fogNear = ${fogNear.toFixed(0)} m${fogNear === 0 ? ' (auto)' : ''}`,
          `fogFar = ${fogFar.toFixed(0)} m${fogFar === 0 ? ' (auto)' : ''}`,
        );
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'gv_events',
    summary: 'Print recent HMSC game events from the state ring.',
    usage: 'gv_events [count] [type-filter]',
    run(args, state) {
      const rawCount = args[0] == null ? 12 : Number(args[0]);
      const count = Number.isFinite(rawCount)
        ? Math.max(1, Math.min(MAX_CONSOLE_EVENT_LINES, Math.floor(rawCount)))
        : 12;
      const filter = Number.isFinite(rawCount) ? args.slice(1).join(' ').trim() : args.join(' ').trim();
      const events = state.events.recent
        .filter((event) => !filter || event.type.includes(filter) || event.subject?.id.includes(filter))
        .slice(-count)
        .reverse();
      if (events.length === 0) return ok(state, filter ? `no recent events matching ${filter}` : 'no recent events');
      return ok(state, ...events.map(formatGameEventForConsole));
    },
  },
  {
    name: 'gv_emit',
    summary: 'Emit a typed HMSC game event for story/debug wiring.',
    usage: 'gv_emit <type> [json-payload]',
    run(args, state) {
      const type = args[0];
      if (!type) return fail(state, 'usage: gv_emit <type> [json-payload]');
      try {
        const payload = args.length > 1 ? parseCommandValue(args.slice(1).join(' ')) : {};
        if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
          return fail(state, 'payload must be an object when provided');
        }
        const result = recordAndPublishGameEvent(state, {
          type,
          source: 'console',
          actor: { kind: 'system', id: 'console' },
          tags: ['manual'],
          payload: payload as Record<string, unknown>,
        });
        return ok(result.state, `emitted ${result.event.id} ${type}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'gv_state',
    summary: 'Print the whole GameState or a dot path.',
    usage: 'gv_state [path]',
    run(args, state) {
      const path = args[0];
      return ok(state, jsonLine(path ? readPath(state, path) : state));
    },
  },
  {
    name: 'gv_config',
    summary: 'Print or set a GameState config path.',
    usage: 'gv_config [path] [value]',
    run(args, state) {
      const path = args[0];
      if (!path) return ok(state, jsonLine(state.config));
      if (args.length === 1) return ok(state, jsonLine(readPath(state.config, path)));
      try {
        const value = parseCommandValue(args.slice(1).join(' '));
        return ok({ ...state, config: setPath(state.config, path, value) }, `config.${path} = ${jsonLine(value)}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'gv_save',
    summary: 'Persist the current GameState.',
    usage: 'gv_save',
    run(_args, state) {
      const savedState = saveGameState(state);
      return ok(savedState, `saved ${savedState.savedAt}`);
    },
  },
  {
    name: 'gv_load',
    summary: 'Load the persisted GameState.',
    usage: 'gv_load',
    run(_args, state) {
      const loaded = readStoredGameState();
      return loaded ? ok(loaded, 'loaded saved GameState') : fail(state, 'no saved GameState found');
    },
  },
  {
    name: 'gv_reset',
    summary: 'Reset to a fresh scaffold state.',
    usage: 'gv_reset',
    run() {
      return ok(createInitialGameState(), 'reset GameState');
    },
  },
  {
    name: 'pv_teleport',
    summary: 'Move the player in continuous world space.',
    usage: 'pv_teleport <x> <z> [y]',
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
    name: 'gv_scene',
    summary: 'Show or set the current scene step.',
    usage: 'gv_scene [step]',
    run(args, state) {
      const step = args.join(' ').trim();
      if (!step) return ok(state, `sceneStep = ${state.sceneStep}`);
      return ok({ ...state, sceneStep: step }, `sceneStep = ${step}`);
    },
  },
  {
    name: 'gv_set',
    summary: 'Set a GameState dot path to a JSON-ish value.',
    usage: 'gv_set <path> <value>',
    run(args, state) {
      const path = args[0];
      if (!path || args.length < 2) return fail(state, 'usage: gv_set <path> <value>');
      try {
        const value = parseCommandValue(args.slice(1).join(' '));
        return ok(setPath(state, path, value), `${path} = ${jsonLine(value)}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'pv_noclip',
    summary: 'Enable or disable player noclip movement.',
    usage: 'pv_noclip <1|0>',
    run(args, state) {
      try {
        const noclip = switchArg(args[0], 'noclip');
        if (noclip && !state.command.cheatsEnabled) return fail(state, 'cmd_cheats 1 required');
        return ok(
          {
            ...state,
            player: {
              ...state.player,
              noclip,
              physics: {
                ...state.player.physics,
                velocity: { x: 0, y: 0, z: 0 },
                grounded: !noclip && state.player.physics.grounded,
              },
            },
          },
          `noclip ${noclip ? 'enabled' : 'disabled'}`,
        );
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'pv_speed',
    summary: 'Set player walk or run speed.',
    usage: 'pv_speed <walk|run> <value>',
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
    name: 'ev_spawn',
    summary: 'Spawn an entity at continuous coordinates.',
    usage: 'ev_spawn <kind> [x] [z] [y]',
    run(args, state, sourceLine) {
      try {
        const kind = args[0];
        if (!kind) return fail(state, 'usage: ev_spawn <kind> [x] [z] [y]');
        const x = args[1] == null ? state.player.position.x : numberArg(args[1], 'x');
        const z = args[2] == null ? state.player.position.z : numberArg(args[2], 'z');
        const y = args[3] == null ? state.player.position.y + physicsRadiusForKind(kind) + SPAWN_ENTITY_CLEARANCE_METERS : numberArg(args[3], 'y');
        const nextState = spawnEntity(state, kind, x, z, y, sourceLine);
        const id = `entity ${kind}_${state.nextEntitySerial.toString().padStart(4, '0')}`;
        return ok(nextState, `spawned ${id} at ${x}, ${y}, ${z}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'ev_burst',
    summary: 'Spawn a cluster of host-physics test bodies around the player.',
    usage: 'ev_burst [count]',
    run(args, state, sourceLine) {
      try {
        const count = args[0] == null ? DEFAULT_PHYSICS_BURST_COUNT : numberArg(args[0], 'count');
        const nextState = spawnPhysicsBurst(state, count, sourceLine);
        return ok(nextState, `spawned ${safePhysicsBurstCount(count)} physics bodies`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'ev_despawn',
    summary: 'Remove a spawned entity.',
    usage: 'ev_despawn <entityId>',
    run(args, state) {
      const id = args[0];
      if (!id) return fail(state, 'usage: ev_despawn <entityId>');
      const nextEntities = { ...state.world.spawnedEntities };
      if (!nextEntities[id]) return fail(state, `no entity ${id}`);
      delete nextEntities[id];
      return ok({ ...state, world: { ...state.world, spawnedEntities: nextEntities } }, `despawned ${id}`);
    },
  },
  {
    name: 'wv_place',
    summary: 'Place a world cell on the construction grid.',
    usage: 'wv_place <kind> <x> <z> [y]',
    run(args, state, sourceLine) {
      try {
        const kind = args[0];
        if (!kind) return fail(state, 'usage: wv_place <kind> <x> <z> [y]');
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
    name: 'wv_remove',
    summary: 'Remove a placed world cell.',
    usage: 'wv_remove <x> <z> [y]',
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
    name: 'wv_trigger',
    summary: 'Show, set, or clear an enter-cell command trigger.',
    usage: 'wv_trigger <x> <z> [y] [command...|off]',
    run(args, state) {
      try {
        const x = numberArg(args[0], 'x');
        const z = numberArg(args[1], 'z');
        let y = 0;
        let commandStart = 2;
        if (args[2] != null && Number.isFinite(Number(args[2])) && args[3] != null) {
          y = numberArg(args[2], 'y');
          commandStart = 3;
        }
        const cell = commandCell(x, z, y);
        const placedCell = placedCellAt(state, cell);
        if (!placedCell) return fail(state, `no placed cell at ${cellKey(cell)}`);
        const triggerCommand = args.slice(commandStart).join(' ').trim();
        if (!triggerCommand) {
          return ok(state, `${cellKey(cell)} trigger = ${placedCell.triggerCommand ?? 'none'}`);
        }
        if (triggerCommand === 'off') {
          return ok(setCellTrigger(state, cell, null), `cleared trigger at ${cellKey(cell)}`);
        }
        return ok(setCellTrigger(state, cell, triggerCommand), `${cellKey(cell)} trigger = ${triggerCommand}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'pv_where',
    summary: 'Print continuous player position and grid cell.',
    usage: 'pv_where',
    run(_args, state) {
      const cell = worldToCell(state.player.position, state.world.cellSizeMeters);
      return ok(state, `player = ${jsonLine(state.player.position)}`, `cell = ${cellKey(cell)}`);
    },
  },
  {
    name: 'wv_path',
    summary: 'Find a typed-tile grid path between two cells.',
    usage: 'wv_path <fromX> <fromZ> <toX> <toZ> [y] [pedestrian|runner|vehicle]',
    run(args, state) {
      try {
        const fromX = numberArg(args[0], 'fromX');
        const fromZ = numberArg(args[1], 'fromZ');
        const toX = numberArg(args[2], 'toX');
        const toZ = numberArg(args[3], 'toZ');
        let y = 0;
        let agent: PathAgentKind = 'pedestrian';
        if (args[4] != null) {
          const maybeY = Number(args[4]);
          if (Number.isFinite(maybeY)) {
            y = maybeY;
            if (args[5] != null) agent = pathAgentArg(args[5]);
          } else {
            agent = pathAgentArg(args[4]);
          }
        }
        const path = findGridPath(state, commandCell(fromX, fromZ, y), commandCell(toX, toZ, y), agent);
        if (path.length === 0) return fail(state, `no ${agent} path through traversable tile kinds`);
        return ok(state, `${agent} path ${path.length} cells: ${path.map(cellKey).join(' -> ')}`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'wv_road',
    summary: 'List roads, or lay a road (2 lanes + centerline minimum).',
    usage: 'wv_road [x z length [ns|ew] [lanesPerDir 1|2] [bike 1|0] [sidewalks 1|0]] | wv_road remove <id>',
    run(args, state, sourceLine) {
      try {
        if (args.length === 0) {
          if (state.world.roads.length === 0) return ok(state, 'no roads laid');
          return ok(state, ...state.world.roads.map((road) => {
            const footprint = roadFootprint(road);
            const width = solveRoadCrossSection(road.profile).totalWidthMeters.toFixed(1);
            return `${road.id} ${road.orientation} ${width}m wide x ${road.lengthTiles}m @ [${footprint.minX},${footprint.minZ}]`;
          }));
        }
        if (args[0] === 'remove') {
          const id = args[1];
          if (!id) return fail(state, 'usage: wv_road remove <id>');
          if (!state.world.roads.some((road) => road.id === id)) return fail(state, `no road ${id}`);
          return ok(removeRoad(state, id), `removed road ${id}`);
        }
        const x = numberArg(args[0], 'x');
        const z = numberArg(args[1], 'z');
        const lengthTiles = numberArg(args[2], 'length');
        const orientation: RoadOrientation = args[3] === 'ew' ? 'eastWest' : 'northSouth';
        const road: RoadSegment = {
          id: `road_user_${state.world.roads.length + 1}`,
          label: `Road ${state.world.roads.length + 1}`,
          orientation,
          x,
          y: 0,
          z,
          lengthTiles,
          profile: roadProfileArgs(args[4], args[5], args[6]),
          createdByCommand: sourceLine,
        };
        const width = solveRoadCrossSection(road.profile).totalWidthMeters.toFixed(1);
        return ok(placeRoad(state, road), `laid ${road.id} ${orientation} ${width}m wide x ${lengthTiles}m @ [${x},${z}]`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'wv_intersection',
    summary: 'Lay a four-way intersection (square box at a road crossing).',
    usage: 'wv_intersection <x> <z> [lanesPerDir 1|2] [bike 1|0] [sidewalks 1|0] | wv_intersection remove <id>',
    run(args, state, sourceLine) {
      try {
        if (args[0] === 'remove') {
          const id = args[1];
          if (!id) return fail(state, 'usage: wv_intersection remove <id>');
          if (!state.world.junctions.some((junction) => junction.id === id)) return fail(state, `no junction ${id}`);
          return ok(removeJunction(state, id), `removed junction ${id}`);
        }
        const x = numberArg(args[0], 'x');
        const z = numberArg(args[1], 'z');
        const junction: RoadIntersection = {
          kind: 'intersection',
          id: `junction_user_${state.world.junctions.length + 1}`,
          label: `Intersection ${state.world.junctions.length + 1}`,
          x,
          y: 0,
          z,
          profile: roadProfileArgs(args[2], args[3], args[4]),
          createdByCommand: sourceLine,
        };
        const footprint = junctionFootprint(junction);
        const side = (footprint.maxX - footprint.minX).toFixed(1);
        return ok(placeJunction(state, junction), `laid ${junction.id} ${side}m box @ [${x},${z}]`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
  {
    name: 'wv_culdesac',
    summary: 'Lay a cul-de-sac turnaround bulb at a road dead-end.',
    usage: 'wv_culdesac <centerX> <centerZ> <bulbRadius> [throat n|s|e|w] [lanesPerDir 1|2] [bike 1|0] [sidewalks 1|0]',
    run(args, state, sourceLine) {
      try {
        if (args[0] === 'remove') {
          const id = args[1];
          if (!id) return fail(state, 'usage: wv_culdesac remove <id>');
          if (!state.world.junctions.some((junction) => junction.id === id)) return fail(state, `no junction ${id}`);
          return ok(removeJunction(state, id), `removed junction ${id}`);
        }
        const centerX = numberArg(args[0], 'centerX');
        const centerZ = numberArg(args[1], 'centerZ');
        const bulbRadiusTiles = numberArg(args[2], 'bulbRadius');
        const throatLetter = (args[3] ?? 's').toLowerCase();
        const throat: RoadCulDeSacThroat = throatLetter === 'n' ? 'north'
          : throatLetter === 'e' ? 'east'
          : throatLetter === 'w' ? 'west'
          : 'south';
        const junction: RoadCulDeSac = {
          kind: 'culDeSac',
          id: `junction_user_${state.world.junctions.length + 1}`,
          label: `Cul-de-sac ${state.world.junctions.length + 1}`,
          centerX,
          y: 0,
          centerZ,
          bulbRadiusTiles,
          throat,
          profile: roadProfileArgs(args[4], args[5], args[6]),
          createdByCommand: sourceLine,
        };
        return ok(placeJunction(state, junction), `laid ${junction.id} r=${bulbRadiusTiles}m throat ${throat} @ [${centerX},${centerZ}]`);
      } catch (err: any) {
        return fail(state, err.message);
      }
    },
  },
];

function findCommand(name: string): CommandDefinition | undefined {
  return COMMANDS.find((command) => command.name === name);
}

export function runCommandLine(line: string, state: GameState, options: CommandEventOptions = {}): CommandResult {
  const tokens = tokenizeCommandLine(line);
  if (tokens.length === 0) return ok(state);
  const [name, ...args] = tokens;
  const command = findCommand(name);
  if (!command) return recordCommandEvents(state, fail(state, `unknown command ${name}`), name, line, options);
  return recordCommandEvents(state, command.run(args, state, line), name, line, options);
}
