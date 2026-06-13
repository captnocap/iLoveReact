// game/commands/vocabulary.ts — the CAPTURED hmsc console vocabulary (V19).
//
// cart/hmsc/commands/registry.ts is the behavior reference (read, never
// moved/edited/imported — V15-TRANSITION). Every one of its 48 command names
// is registered here so the scripting language is complete from day one:
//
//   - commands whose target lives behind a game/ door already (the command
//     state itself, GAME_KINDS, the P2 tuning tables below) run for REAL;
//   - commands whose target system is NOT yet captured register as explicit
//     stubs that FAIL LOUDLY ("system not captured yet: <owner>") — never a
//     silent no-op, never fake success. When the owning capture lane lands,
//     the stub body is replaced; the name, usage, and scripts already exist.
//
// Style differences from the reference, on purpose (the skeleton's
// conventions): commands mutate their ctx in place and throw to fail (the
// registry resolves throws to outcomes); the reference's immutable
// state-in/state-out pairs are not carried. Dot paths (gv_state/gv_set/
// gv_config) keep the reference's state SHAPE (player.physics.velocity,
// config.sky.hour, world.spawnedEntities...) so saved command sequences keep
// meaning the same thing.

import { captureFrame } from '@reactjit/capture';
import {
  GAME_KINDS,
  mountainTrailheadPoint,
  tileKindDefinition,
  isTileKind,
  tileKindNamesForConsole,
  isPropKind,
  propKindDefinition,
  propKindNamesForConsole,
  landformKindDefinition,
  landformSurfaceTop,
  type PropKind,
} from '../kinds';
import { GAME_PERCEPTION } from '../perception';
import { GAME_TELEMETRY, type DiagnosticChannel } from '../telemetry';
import { GAME_WORLD, type GridCell, type LandformPlacement, type PlacedCell, type WorldSurfaceRegion } from '../world';
import { parseCommandValue } from './parser';
import type { CommandRegistry } from './index';
import { buildingKindDefinition, buildingKindHeightMeters, buildingKindNamesForConsole, isBuildingKind } from '../../world/buildingKinds';
import { HMSC_SCALE } from '../../world/scale';
import { defineColonConsoleCommands, type ColonConsoleDiagnostics } from './colonConsole';

// ── P2: every behavior-affecting number is table data, never a buried constant.
// Values carried verbatim from the reference's state/defaults.ts + render3d/sky.ts.

export const SKY_NAMED_HOURS: Record<string, number> = {
  midnight: 0,
  dawn: 6,
  noon: 12,
  dusk: 18,
};

export const SKY_WEATHER_PRESETS: Record<string, { weather: number; gloom: number }> = {
  clear: { weather: 0, gloom: 0 },
  hazy: { weather: 0.25, gloom: 0 },
  cloudy: { weather: 0.65, gloom: 0.1 },
  storm: { weather: 1, gloom: 0.45 },
};

export const COMMAND_TUNING = {
  sky: {
    hoursPerDay: 24,
    defaultHour: 12,
    defaultWeather: 0.12,
    defaultGloom: 0,
    defaultDayCycleEnabled: false,
    defaultCycleHoursPerRealMinute: 1.5,
  },
  view: {
    defaultDrawRadiusMeters: 140,
    minDrawRadiusMeters: 16,
    maxDrawRadiusMeters: 4000,
    defaultFogNearMeters: 0,
    defaultFogFarMeters: 0,
  },
  events: {
    maxConsoleLines: 40,
    defaultConsoleLines: 12,
    ringCapacity: 256,
  },
  player: {
    defaultWalkSpeedMetersPerSecond: 2.4,
    defaultRunSpeedMetersPerSecond: 5.8,
    /** R4 scale contract (HMSC_SCALE.playerStepHeightMeters) — pv_respawn's ground-snap reach. */
    stepHeightMeters: 0.35,
  },
  /** R4: 1 tile = 1 meter — the world-scale contract. */
  world: {
    cellSizeMeters: 1,
    /** wv_mountain trailhead drop-in clearance above the bench surface. */
    trailheadLiftMeters: 0.05,
  },
  spawn: {
    defaultEntityRadiusMeters: 0.28,
    crateEntityRadiusMeters: 0.42,
    barrelEntityRadiusMeters: 0.34,
    ballEntityRadiusMeters: 0.3,
    defaultEntityRestitution: 0.72,
    spawnClearanceMeters: 0.4,
    defaultBurstCount: 18,
    maxBurstCount: 64,
    burstKindCount: 4,
    burstHeightLaneCount: 5,
    burstVerticalSpeedLaneCount: 3,
    burstSpawnRadiusMeters: 0.65,
    burstBaseHeightMeters: 1.8,
    burstHeightStepMeters: 0.18,
    burstHorizontalSpeedMetersPerSecond: 4.4,
    burstVerticalSpeedMetersPerSecond: 2.4,
    burstVerticalSpeedStepMetersPerSecond: 0.75,
    burstAngleSerialStep: 1.918,
    burstAngleItemStep: 0.41,
  },
} as const;

// ── the command state (the reference's GameState slice these commands touch) ──

export type Vec3Like = { x: number; y: number; z: number };

export type SpawnedEntity = {
  id: string;
  kind: string;
  position: Vec3Like;
  yawDegrees: number;
  physics: {
    enabled: boolean;
    radiusMeters: number;
    velocity: Vec3Like;
    restitution: number;
    grounded: boolean;
  };
  createdByCommand: string;
};

export type GameEvent = {
  id: string;
  type: string;
  source: string;
  tags: string[];
  payload: Record<string, unknown>;
};

export type CommandPersistence = {
  save: (state: GameCommandState) => string[];
  load: () => GameCommandState | null;
};

export type GameCommandState = {
  sceneStep: string;
  command: { cheatsEnabled: boolean; debugHudEnabled: boolean };
  config: {
    sky: {
      hour: number;
      weather: number;
      gloom: number;
      dayCycleEnabled: boolean;
      cycleHoursPerRealMinute: number;
    };
    view: { drawRadiusMeters: number; fogNearMeters: number; fogFarMeters: number };
  };
  player: {
    position: Vec3Like;
    yawDegrees: number;
    noclip: boolean;
    walkSpeedMetersPerSecond: number;
    runSpeedMetersPerSecond: number;
    physics: { velocity: Vec3Like; grounded: boolean };
    /** the armed respawn cell — a save checkpoint or pv_respawn's target (reference dot path) */
    respawnCell?: GridCell;
  };
  // The world-grid slice rides the GAME_WORLD shapes directly (same reference
  // dot paths: world.placedCells, world.surfaceRegions, world.landforms).
  world: {
    cellSizeMeters: number;
    spawnedEntities: Record<string, SpawnedEntity>;
    surfaceRegions: WorldSurfaceRegion[];
    placedCells: Record<string, PlacedCell>;
    landforms: LandformPlacement[];
    buildings?: WorldAuditBuilding[];
    props?: WorldAuditProp[];
  };
  events: { nextSerial: number; recent: GameEvent[] };
  nextEntitySerial: number;
  __commandPersistence?: CommandPersistence;
  __consoleDiagnostics?: ColonConsoleDiagnostics;
};

type WorldAuditBuilding = {
  id: string;
  kind: string;
  label?: string;
  x: number;
  y?: number;
  z: number;
  widthTiles: number;
  depthTiles: number;
  enclosure?: 'sealed' | 'hollow' | 'interior';
};

type WorldAuditProp = {
  id: string;
  kind: string;
  x: number;
  y?: number;
  z: number;
};

export function createGameCommandState(): GameCommandState {
  const t = COMMAND_TUNING;
  return {
    sceneStep: 'boot.console',
    command: { cheatsEnabled: false, debugHudEnabled: false },
    config: {
      sky: {
        hour: t.sky.defaultHour,
        weather: t.sky.defaultWeather,
        gloom: t.sky.defaultGloom,
        dayCycleEnabled: t.sky.defaultDayCycleEnabled,
        cycleHoursPerRealMinute: t.sky.defaultCycleHoursPerRealMinute,
      },
      view: {
        drawRadiusMeters: t.view.defaultDrawRadiusMeters,
        fogNearMeters: t.view.defaultFogNearMeters,
        fogFarMeters: t.view.defaultFogFarMeters,
      },
    },
    player: {
      position: { x: 0, y: 0, z: 0 },
      yawDegrees: 0,
      noclip: false,
      walkSpeedMetersPerSecond: t.player.defaultWalkSpeedMetersPerSecond,
      runSpeedMetersPerSecond: t.player.defaultRunSpeedMetersPerSecond,
      physics: { velocity: { x: 0, y: 0, z: 0 }, grounded: true },
    },
    world: { cellSizeMeters: t.world.cellSizeMeters, spawnedEntities: {}, surfaceRegions: [], placedCells: {}, landforms: [], waterBodies: [] },
    events: { nextSerial: 1, recent: [] },
    nextEntitySerial: 0,
  };
}

// ── argument helpers (reference semantics, kept exact) ──

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

function toggleArg(raw: string | undefined, current: boolean, name: string): boolean {
  if (raw == null || raw === '' || raw === 'toggle') return !current;
  return switchArg(raw, name);
}

function setHostSpikeTrace(enabled: boolean): void {
  const host = globalThis as Record<string, unknown>;
  const trace = host.__hmsc_spike_trace;
  if (typeof trace === 'function') (trace as (enabled: number) => void)(enabled ? 1 : 0);
}

function setReconChurnTrace(enabled: boolean): boolean {
  const host = globalThis as Record<string, unknown>;
  const set = host.__RECON_CHURN_SET;
  if (typeof set === 'function') return (set as (enabled: boolean) => boolean)(enabled);
  host.__RECON_CHURN_TRACE = enabled;
  return enabled;
}

function reconChurnTraceEnabled(): boolean {
  const host = globalThis as Record<string, unknown>;
  const status = host.__RECON_CHURN_STATUS;
  if (typeof status === 'function') {
    const result = (status as () => { enabled?: unknown })();
    return result?.enabled === true;
  }
  return host.__RECON_CHURN_TRACE === true;
}

function normalizeSkyHour(hour: number): number {
  const day = COMMAND_TUNING.sky.hoursPerDay;
  if (!Number.isFinite(hour)) return 0;
  return ((hour % day) + day) % day;
}

function skyHourArg(raw: string | undefined): number {
  const named = SKY_NAMED_HOURS[raw ?? ''];
  if (named != null) return named;
  return normalizeSkyHour(numberArg(raw, 'hour'));
}

function skyInfluenceArg(raw: string | undefined, name: string): number {
  const value = numberArg(raw, name);
  if (value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
  return value;
}

function weatherPresetNames(): string {
  return Object.keys(SKY_WEATHER_PRESETS).join(', ');
}

function readPath(root: any, path: string): unknown {
  return path.split('.').reduce((current, key) => current?.[key], root);
}

/** In-place sibling of the reference's copy-on-write setPath (mutable ctx). */
function writePath(root: any, path: string, value: unknown): void {
  const keys = path.split('.').filter(Boolean);
  if (keys.length === 0) return;
  let cursor = root;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (cursor[keys[i]] == null || typeof cursor[keys[i]] !== 'object') cursor[keys[i]] = {};
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
}

function jsonLine(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function commandStateSnapshot(game: GameCommandState): GameCommandState {
  const snapshot = cloneJson({
    sceneStep: game.sceneStep,
    command: game.command,
    config: game.config,
    player: game.player,
    world: game.world,
    events: game.events,
    nextEntitySerial: game.nextEntitySerial,
  }) as GameCommandState;
  delete snapshot.__commandPersistence;
  return snapshot;
}

function restoreCommandState(game: GameCommandState, snapshot: GameCommandState): void {
  const persistence = game.__commandPersistence;
  Object.assign(game, createGameCommandState(), commandStateSnapshot(snapshot));
  if (persistence) game.__commandPersistence = persistence;
}

function mountedPersistence(game: GameCommandState): CommandPersistence {
  const persistence = game.__commandPersistence;
  if (!persistence) throw new Error('persistence store not mounted');
  return persistence;
}

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function skyConfigLine(sky: GameCommandState['config']['sky']): string {
  return [
    `hour=${sky.hour.toFixed(2)}`,
    `weather=${sky.weather.toFixed(2)}`,
    `gloom=${sky.gloom.toFixed(2)}`,
    `dayCycle=${sky.dayCycleEnabled ? '1' : '0'}`,
    `cycleHoursPerRealMinute=${sky.cycleHoursPerRealMinute}`,
  ].join(' ');
}

function physicsRadiusForKind(kind: string): number {
  const t = COMMAND_TUNING.spawn;
  if (/crate|box/i.test(kind)) return t.crateEntityRadiusMeters;
  if (/barrel|can/i.test(kind)) return t.barrelEntityRadiusMeters;
  if (/ball|sphere/i.test(kind)) return t.ballEntityRadiusMeters;
  return t.defaultEntityRadiusMeters;
}

function spawnEntity(game: GameCommandState, kind: string, x: number, z: number, y: number, sourceLine: string): SpawnedEntity {
  const id = `${kind}_${game.nextEntitySerial.toString().padStart(4, '0')}`;
  const entity: SpawnedEntity = {
    id,
    kind,
    position: { x, y, z },
    yawDegrees: 0,
    physics: {
      enabled: true,
      radiusMeters: physicsRadiusForKind(kind),
      velocity: { x: 0, y: 0, z: 0 },
      restitution: COMMAND_TUNING.spawn.defaultEntityRestitution,
      grounded: false,
    },
    createdByCommand: sourceLine,
  };
  game.nextEntitySerial += 1;
  game.world.spawnedEntities[id] = entity;
  return entity;
}

function recordEvent(game: GameCommandState, type: string, source: string, tags: string[], payload: Record<string, unknown>): GameEvent {
  const event: GameEvent = {
    id: `ev_${game.events.nextSerial.toString().padStart(4, '0')}`,
    type,
    source,
    tags,
    payload,
  };
  game.events.nextSerial += 1;
  game.events.recent.push(event);
  const overflow = game.events.recent.length - COMMAND_TUNING.events.ringCapacity;
  if (overflow > 0) game.events.recent.splice(0, overflow);
  return event;
}

function formatEventForConsole(event: GameEvent): string {
  const tags = event.tags.length ? ` {${event.tags.join(',')}}` : '';
  return `${event.id} ${event.type} <${event.source}>${tags}`;
}

function movementNoiseLine(): string {
  const footsteps = GAME_PERCEPTION.tuning.hearing.footsteps;
  return (Object.keys(footsteps) as Array<keyof typeof footsteps>)
    .map((mode) => {
      const spec = footsteps[mode];
      return `${mode}=radius:${spec.radiusMeters}m salience:${spec.salience} cadence:${spec.stepSeconds}s`;
    })
    .join(' ');
}

function tileNoiseLine(): string {
  return GAME_KINDS.tiles.kinds
    .map((kind) => `${kind}=${tileKindDefinition(kind).npc.noise.toFixed(2)}`)
    .join(' ');
}

type PlacementSeverity = 'error' | 'warn' | 'info';
type Rect = { minX: number; minZ: number; maxX: number; maxZ: number };
type PlacementIssue = { severity: PlacementSeverity; code: string; message: string };
type PlacementSubject = {
  layer: 'building' | 'prop' | 'landform';
  id: string;
  label: string;
  footprint: Rect;
  heightMeters: number;
  solid: boolean;
  enterable: boolean;
};

function rectCenter(rect: Rect): { x: number; z: number } {
  return { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
}

function samplePlacementCells(footprint: Rect): GridCell[] {
  const c = rectCenter(footprint);
  const inset = 0.5;
  const points: Array<[number, number]> = [
    [c.x, c.z],
    [footprint.minX + inset, footprint.minZ + inset],
    [footprint.maxX - inset, footprint.minZ + inset],
    [footprint.minX + inset, footprint.maxZ - inset],
    [footprint.maxX - inset, footprint.maxZ - inset],
  ];
  const seen = new Set<string>();
  const cells: GridCell[] = [];
  for (const [x, z] of points) {
    const cell = { x: Math.floor(x), y: 0, z: Math.floor(z) };
    const key = `${cell.x},${cell.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push(cell);
  }
  return cells;
}

function buildingPreviewSubject(args: string[]): PlacementSubject {
  const kind = args[0];
  if (!isBuildingKind(kind)) throw new Error(`unknown building kind ${kind}; expected one of ${buildingKindNamesForConsole()}`);
  const x = numberArg(args[1], 'x');
  const z = numberArg(args[2], 'z');
  const def = buildingKindDefinition(kind);
  const widthTiles = args[3] != null ? numberArg(args[3], 'width') : def.defaultWidthTiles;
  const depthTiles = args[4] != null ? numberArg(args[4], 'depth') : def.defaultDepthTiles;
  return {
    layer: 'building',
    id: '__preview__',
    label: def.label,
    footprint: { minX: x, minZ: z, maxX: x + widthTiles, maxZ: z + depthTiles },
    heightMeters: buildingKindHeightMeters(kind),
    solid: true,
    enterable: def.defaultEnclosure === 'hollow' || def.defaultEnclosure === 'interior',
  };
}

function propPreviewSubject(args: string[]): PlacementSubject {
  const kind = args[0];
  if (!isPropKind(kind)) throw new Error(`unknown prop kind ${kind}; expected one of ${propKindNamesForConsole()}`);
  const x = numberArg(args[1], 'x');
  const z = numberArg(args[2], 'z');
  const def = propKindDefinition(kind as PropKind);
  const radius = Math.max(def.footprintRadiusMeters, 0.25);
  return {
    layer: 'prop',
    id: '__preview__',
    label: def.label,
    footprint: { minX: x - radius, minZ: z - radius, maxX: x + radius, maxZ: z + radius },
    heightMeters: def.heightMeters,
    solid: def.solid,
    enterable: false,
  };
}

function buildingPlacementSubject(building: WorldAuditBuilding): PlacementSubject {
  if (!isBuildingKind(building.kind)) throw new Error(`unknown building kind ${building.kind}; expected one of ${buildingKindNamesForConsole()}`);
  const def = buildingKindDefinition(building.kind);
  return {
    layer: 'building',
    id: building.id,
    label: building.label || def.label,
    footprint: {
      minX: building.x,
      minZ: building.z,
      maxX: building.x + building.widthTiles,
      maxZ: building.z + building.depthTiles,
    },
    heightMeters: buildingKindHeightMeters(building.kind),
    solid: true,
    enterable: (building.enclosure ?? def.defaultEnclosure) === 'hollow' || (building.enclosure ?? def.defaultEnclosure) === 'interior',
  };
}

function propPlacementSubject(prop: WorldAuditProp): PlacementSubject {
  if (!isPropKind(prop.kind)) throw new Error(`unknown prop kind ${prop.kind}; expected one of ${propKindNamesForConsole()}`);
  const def = propKindDefinition(prop.kind);
  const radius = Math.max(def.footprintRadiusMeters, 0.25);
  return {
    layer: 'prop',
    id: prop.id,
    label: def.label,
    footprint: { minX: prop.x - radius, minZ: prop.z - radius, maxX: prop.x + radius, maxZ: prop.z + radius },
    heightMeters: def.heightMeters,
    solid: def.solid,
    enterable: false,
  };
}

function landformSubject(lf: LandformPlacement): PlacementSubject {
  const def = landformKindDefinition(lf.kind);
  const radius = def.footprintRadius(lf.params, lf.field);
  return {
    layer: 'landform',
    id: lf.id,
    label: lf.label,
    footprint: { minX: lf.centerX - radius, minZ: lf.centerZ - radius, maxX: lf.centerX + radius, maxZ: lf.centerZ + radius },
    heightMeters: landformSurfaceTop(lf, lf.centerX, lf.centerZ) - lf.baseY,
    solid: false,
    enterable: false,
  };
}

function subjectsForAudit(game: GameCommandState): PlacementSubject[] {
  return [
    ...(game.world.buildings ?? []).map(buildingPlacementSubject),
    ...(game.world.props ?? []).map(propPlacementSubject),
    ...game.world.landforms.map(landformSubject),
  ];
}

function findSubjectById(game: GameCommandState, id: string): PlacementSubject | undefined {
  const building = (game.world.buildings ?? []).find((b) => b.id === id);
  if (building) return buildingPlacementSubject(building);
  const prop = (game.world.props ?? []).find((p) => p.id === id);
  if (prop) return propPlacementSubject(prop);
  const landform = game.world.landforms.find((lf) => lf.id === id);
  return landform ? landformSubject(landform) : undefined;
}

function tileUnderRule(game: GameCommandState, subject: PlacementSubject): PlacementIssue[] {
  const issues: PlacementIssue[] = [];
  let anyGround = false;
  const roadCells: string[] = [];
  let onWater = false;
  for (const cell of samplePlacementCells(subject.footprint)) {
    const kind = GAME_WORLD.tileKindAtCell(game.world, cell);
    if (!kind) continue;
    anyGround = true;
    const surface = tileKindDefinition(kind).surface.material;
    if (surface === 'water') onWater = true;
    if (surface === 'road') roadCells.push(`${cell.x},${cell.z}`);
  }
  if (onWater) {
    issues.push({ severity: 'error', code: 'on-water', message: `${subject.label} sits on/over water — it'll float or sink.` });
  }
  if (!anyGround) {
    issues.push({ severity: 'warn', code: 'over-void', message: `${subject.label} has no ground tile under it — it hangs over the void (lay a surface first).` });
  }
  if (subject.solid && roadCells.length > 0) {
    issues.push({
      severity: 'warn',
      code: 'on-road',
      message: `${subject.label} sits on a road tile (${roadCells.join(' ')}) — it blocks the driving lane. Move it onto the sidewalk/lot.`,
    });
  }
  return issues;
}

function scaleVsPlayerRule(_game: GameCommandState, subject: PlacementSubject): PlacementIssue[] {
  if (subject.layer !== 'building') return [];
  const issues: PlacementIssue[] = [];
  const person = HMSC_SCALE.visualHumanMaxMeters;
  const door = HMSC_SCALE.doorHeightMeters;
  const h = subject.heightMeters;
  if (subject.enterable && h < door) {
    issues.push({
      severity: 'error',
      code: 'too-short-to-enter',
      message: `${subject.label} is ${h.toFixed(1)} m tall but a doorway needs ${door.toFixed(1)} m — too short to walk into. Add a storey.`,
    });
  } else if (h < person + 0.1) {
    issues.push({
      severity: 'warn',
      code: 'shorter-than-player',
      message: `${subject.label} is only ${h.toFixed(1)} m tall — shorter than the ~${person.toFixed(1)} m player. It'll read as a crate, not a building.`,
    });
  }
  const span = Math.min(subject.footprint.maxX - subject.footprint.minX, subject.footprint.maxZ - subject.footprint.minZ);
  if (span > 0 && span < 4 && h > span * 6) {
    issues.push({
      severity: 'info',
      code: 'thin-tower',
      message: `${subject.label} is ${h.toFixed(1)} m tall on a ${span.toFixed(1)} m base — a very thin sliver; widen the footprint or it looks like a pole.`,
    });
  }
  return issues;
}

function roadDistanceRule(_game: GameCommandState, subject: PlacementSubject): PlacementIssue[] {
  if (subject.layer !== 'building') return [];
  return [{ severity: 'info', code: 'no-roads', message: `${subject.label}: the world has no roads yet, so "near a street" can't be checked.` }];
}

function checkPlacement(game: GameCommandState, subject: PlacementSubject): PlacementIssue[] {
  const order: Record<PlacementSeverity, number> = { error: 0, warn: 1, info: 2 };
  return [
    ...tileUnderRule(game, subject),
    ...scaleVsPlayerRule(game, subject),
    ...roadDistanceRule(game, subject),
  ].sort((a, b) => order[a.severity] - order[b.severity]);
}

const PLACEMENT_SEVERITY_GLYPH: Record<PlacementSeverity, string> = { error: '✗', warn: '⚠', info: '·' };

function formatPlacementIssues(issues: PlacementIssue[]): string[] {
  return issues.map((issue) => `${PLACEMENT_SEVERITY_GLYPH[issue.severity]} ${issue.message}`);
}

function runValidateCommand(game: GameCommandState, args: string[]): string[] {
  if (args[0] === 'building' || args[0] === 'prop') {
    const subject = args[0] === 'building' ? buildingPreviewSubject(args.slice(1)) : propPreviewSubject(args.slice(1));
    const issues = checkPlacement(game, subject);
    return [
      `preview ${subject.label} @ [${subject.footprint.minX},${subject.footprint.minZ}]: ${issues.length ? `${issues.length} issue(s)` : 'all clear'}`,
      ...formatPlacementIssues(issues),
    ];
  }
  if (args.length === 1) {
    const subject = findSubjectById(game, args[0]);
    if (!subject) throw new Error(`no building/prop/landform with id ${args[0]}`);
    const issues = checkPlacement(game, subject);
    return [
      `${subject.id} (${subject.label}): ${issues.length ? `${issues.length} issue(s)` : 'all clear'}`,
      ...formatPlacementIssues(issues),
    ];
  }
  const subjects = subjectsForAudit(game);
  if (subjects.length === 0) return ['nothing placed to validate'];
  const lines: string[] = [];
  let total = 0;
  let flagged = 0;
  for (const subject of subjects) {
    const issues = checkPlacement(game, subject);
    if (issues.length === 0) continue;
    flagged += 1;
    total += issues.length;
    lines.push(`${subject.id} (${subject.label}):`);
    for (const line of formatPlacementIssues(issues)) lines.push(`  ${line}`);
  }
  if (total === 0) return [`all ${subjects.length} placed things look fine`];
  return [`${total} issue(s) across ${flagged}/${subjects.length} placed things:`, ...lines];
}

// ── the loud not-yet boundary ──

/**
 * The systems whose commands are registered but pending their capture lane.
 * One entry per owner so the supervisor can hand each list to its lane.
 */
export const NOT_YET_CAPTURED: Record<string, string[]> = {
  // world grid (V4): CAPTURED — wv_place/wv_fill/wv_remove/wv_trigger/
  // pv_respawn run for real through game/world/.
  'world grid pathing (V4 grid x V5 host pathing integration)': ['wv_path'],
  'road grammar world system (roads, junctions)': ['wv_road', 'wv_intersection', 'wv_culdesac'],
  'traffic system (signal clock, phase overrides)': ['wv_signal'],
  'world props placement (kind data IS captured in game/kinds)': ['wv_prop'],
  'buildings + interiors world system': ['wv_building', 'wv_enter', 'wv_leave'],
  // world landform instances (V4): CAPTURED — wv_mountain runs for real
  // over world.landforms + the kinds registry's trailhead helper.
  'world zones': ['wv_zone'],
  'lab scenes (V13 labs-route integration with the game world)': ['lab_list', 'lab_spawn', 'lab_exit'],
  'input contract data (GAME_INPUT is transport-only today, V7)': ['gv_controls'],
};

const NOT_YET_OWNER_BY_COMMAND: Record<string, string> = {};
for (const [owner, names] of Object.entries(NOT_YET_CAPTURED)) {
  for (const name of names) NOT_YET_OWNER_BY_COMMAND[name] = owner;
}

function notYetCaptured(command: string): never {
  const owner = NOT_YET_OWNER_BY_COMMAND[command] ?? 'unknown system';
  throw new Error(
    `system not captured yet: ${owner} — "${command}" is registered (the script language is complete) but its behavior lands with that capture lane`,
  );
}

// ── the vocabulary ──

/**
 * Registers the full 48-name hmsc console vocabulary onto a registry whose
 * ctx carries a GameCommandState (wrapper ctx types — the headless boot's —
 * keep their extra fields; gv_reset only resets the command-state slice).
 */
export function defineGameCommands<C extends GameCommandState>(registry: CommandRegistry<C>): void {
  defineColonConsoleCommands(registry);
  const define = registry.define;

  define({
    name: 'cmd_help',
    usage: 'cmd_help [command]',
    summary: 'List commands or inspect one command.',
    run: (_game, args) => {
      const query = args[0];
      if (query) {
        const spec = registry.list().find((candidate) => candidate.name === query);
        if (!spec) throw new Error(`unknown command ${query}`);
        return [`${spec.name}: ${spec.summary}`, `usage: ${spec.usage}`];
      }
      const specs = registry.list();
      const pad = Math.max(...specs.map((spec) => spec.name.length)) + 2;
      return specs.map((spec) => `${spec.name.padEnd(pad)} ${spec.summary}`);
    },
  });

  // Bare `help` — what a player actually types (USER BUG: the registry's
  // unknown-command hint said "(try: help)" while only cmd_help existed — a
  // self-recommending error). Generated FROM the registry (P2: never a hand
  // list): every registered command's USAGE line, with not-yet stubs marked
  // and their owning capture lane named on inspection.
  define({
    name: 'help',
    usage: 'help [command]',
    summary: 'List every command with its usage; help <command> for one.',
    run: (_game, args) => {
      const query = args[0];
      if (query) {
        const spec = registry.list().find((candidate) => candidate.name === query);
        if (!spec) throw new Error(`unknown command ${query} — plain "help" lists everything`);
        const owner = NOT_YET_OWNER_BY_COMMAND[spec.name];
        return [
          `${spec.name}: ${spec.summary}`,
          `usage: ${spec.usage}`,
          ...(owner ? [`status: not captured yet — lands with: ${owner}`] : []),
        ];
      }
      const specs = registry.list();
      // Column capped so one long usage (wv_road's ~110 chars) doesn't push
      // every summary off a console overlay; longer usages just run on.
      const pad = Math.min(40, Math.max(...specs.map((spec) => spec.usage.length))) + 2;
      return specs.map((spec) =>
        `${spec.usage.padEnd(pad)} ${NOT_YET_OWNER_BY_COMMAND[spec.name] ? '[not yet] ' : ''}${spec.summary}`,
      );
    },
  });

  // SELFSHOT-0606 (USER RULING, 2026-06-06): the app screenshots ITSELF —
  // desktop/X11 capture of the user's system is BANNED. `shot` rides the
  // __capture_frame host door (runtime/capture.ts → framework/gpu/capture.zig
  // swapchain readback). Headless boots (verify replays) degrade gracefully:
  // the host fn is absent, the command reports it and stays green.
  define({
    name: 'shot',
    usage: 'shot [path]',
    summary: "Capture the app's OWN rendered frame to a PNG (never the desktop).",
    run: (_game, args) => {
      const path = args[0] ?? `shot-${Date.now()}.png`;
      if (!path.endsWith('.png')) throw new Error('shot writes PNG — give the path a .png suffix');
      const ok = captureFrame(path);
      if (!ok) return ['frame capture unavailable (headless boot, F9 recording active, or bad path) — nothing written'];
      return [`capturing → ${path} (the host logs SCREENSHOT_SAVED:${path} when the PNG lands)`];
    },
  });

  define({
    name: 'cmd_cheats',
    usage: 'cmd_cheats <1|0>',
    summary: 'Enable or disable cheat-gated commands.',
    run: (game, args) => {
      const cheatsEnabled = switchArg(args[0], 'cheats');
      game.command.cheatsEnabled = cheatsEnabled;
      if (!cheatsEnabled) {
        game.player.noclip = false;
        game.player.physics.velocity = { x: 0, y: 0, z: 0 };
      }
      return [cheatsEnabled ? 'cheats enabled' : 'cheats disabled; noclip off'];
    },
  });

  define({
    name: 'gv_debug_hud',
    usage: 'gv_debug_hud [1|0|toggle]',
    summary: 'Toggle the live gameplay diagnostics overlay.',
    run: (game, args) => {
      game.command.debugHudEnabled = toggleArg(args[0], game.command.debugHudEnabled, 'debugHud');
      return [`debugHud = ${game.command.debugHudEnabled ? '1' : '0'}`];
    },
  });

  define({
    name: 'log',
    usage: 'log status | log all <on|off|toggle> | log <channel> <on|off|toggle> | log dump [label] | log overhead [iterations]',
    summary: 'Runtime-switch diagnostics channels, dump JSONL snapshots, and measure all-off overhead.',
    run: (_game, args) => {
      const op = args[0] ?? 'status';
      if (op === 'status') {
        const status = GAME_TELEMETRY.diagnosticStatus();
        return [
          `diagnostics path = ${status.path}`,
          ...status.channels.map((c) => `${c.name}=${c.enabled ? 'on' : 'off'} — ${c.purpose}`),
        ];
      }
      if (op === 'dump') {
        const label = args.slice(1).join(' ').trim() || 'console';
        const dump = GAME_TELEMETRY.diagnosticDump(label);
        const count = Array.isArray((dump.snapshot.status as any)?.channels) ? (dump.snapshot.status as any).channels.length : 0;
        return [`diagnostics dumped to ${dump.path}`, `channels = ${count}`];
      }
      if (op === 'overhead') {
        const iterations = Math.max(1, Math.floor(Number(args[1] ?? 100_000)));
        const measure = GAME_TELEMETRY.estimateDiagnosticOffOverhead(iterations);
        return [
          `iterations = ${measure.iterations}`,
          `baselineMs = ${measure.baselineMs.toFixed(3)}`,
          `allOffMs = ${measure.offMs.toFixed(3)}`,
          `perCallNs = ${measure.perCallNs.toFixed(2)}`,
        ];
      }
      if (op === 'all') {
        const mode = args[1] ?? 'toggle';
        const allEnabled = GAME_TELEMETRY.channels.every((c) => GAME_TELEMETRY.diagnosticChannelEnabled(c.name));
        const enabled = mode === 'toggle' ? !allEnabled : switchArg(mode, 'log all');
        for (const spec of GAME_TELEMETRY.channels) GAME_TELEMETRY.setDiagnosticChannel(spec.name, enabled);
        return [
          `all channels = ${enabled ? 'on' : 'off'}`,
          `count = ${GAME_TELEMETRY.channels.length}`,
          `path = ${GAME_TELEMETRY.tuning.diagnostics.logPath}`,
        ];
      }
      if (!GAME_TELEMETRY.isDiagnosticChannel(op)) {
        throw new Error(`unknown log channel ${op}; expected one of ${GAME_TELEMETRY.channels.map((c) => c.name).join(', ')}`);
      }
      const channel = op as DiagnosticChannel;
      const mode = args[1] ?? 'toggle';
      const current = GAME_TELEMETRY.diagnosticChannelEnabled(channel);
      const enabled = mode === 'toggle' ? !current : switchArg(mode, 'log channel');
      GAME_TELEMETRY.setDiagnosticChannel(channel, enabled);
      return [`${channel} = ${enabled ? 'on' : 'off'}`, `path = ${GAME_TELEMETRY.tuning.diagnostics.logPath}`];
    },
  });

  define({
    name: 'gv_perflog',
    usage: 'gv_perflog [0|1|2|toggle] [spikeRatio] [minJumpMs]',
    summary: 'Compatibility alias: toggle the spike recorder; 2 also enables host-side frame trace.',
    run: (_game, args) => {
      const current = GAME_TELEMETRY.diagnosticChannelEnabled('spikes');
      const hostTrace = args[0] === '2';
      const enabled = hostTrace ? true : toggleArg(args[0], current, 'perflog');
      setHostSpikeTrace(hostTrace);
      if (args[1] != null) {
        const spikeRatio = numberArg(args[1], 'spikeRatio');
        if (spikeRatio <= 1) throw new Error('spikeRatio must be greater than 1');
        GAME_TELEMETRY.configureSpikeWatch({ spikeRatio });
      }
      if (args[2] != null) {
        const minJumpMs = numberArg(args[2], 'minJumpMs');
        if (minJumpMs < 0) throw new Error('minJumpMs must be >= 0');
        GAME_TELEMETRY.configureSpikeWatch({ minJumpUs: minJumpMs * 1000 });
      }
      GAME_TELEMETRY.setDiagnosticChannel('spikes', enabled);
      if (enabled) GAME_TELEMETRY.startSpikeWatch();
      else GAME_TELEMETRY.stopSpikeWatch();
      return {
        suppressTranscript: true,
        output: [
          `${GAME_TELEMETRY.spikeWatchStatusLine(enabled)}${hostTrace ? '  + host-trace ON' : ''}`,
          enabled
            ? `spikes flush to the dev terminal — go idle and watch for GAME PERF SPIKE blocks${hostTrace ? ' and [host-spike] lines (host ground truth)' : ''}.`
            : 'recorder stopped (host-trace off).',
          `path = ${GAME_TELEMETRY.tuning.diagnostics.logPath}`,
        ],
      };
    },
  });

  define({
    name: 'gv_churntrace',
    usage: 'gv_churntrace [1|0|toggle]',
    summary: 'Arm UIFLAP owner tracing: spike reports include React component/source/text/font-size churn candidates.',
    run: (_game, args) => {
      const enabled = toggleArg(args[0], reconChurnTraceEnabled(), 'churntrace');
      setReconChurnTrace(enabled);
      GAME_TELEMETRY.setDiagnosticChannel('spikes', enabled);
      if (enabled) GAME_TELEMETRY.startSpikeWatch();
      else GAME_TELEMETRY.stopSpikeWatch();
      return {
        suppressTranscript: true,
        output: [
          `recon churn owner trace = ${enabled ? 'on' : 'off'}`,
          `spike recorder = ${enabled ? 'on' : 'off'}`,
          enabled
            ? 'next CONTENT SWAP / GLYPH RASTERIZE spike will print component/source/text/font-size candidates in the GAME PERF SPIKE block.'
            : 'owner trace stopped.',
        ],
      };
    },
  });

  define({
    name: 'gv_sky',
    usage: 'gv_sky',
    summary: 'Print current sky clock and weather config.',
    run: (game) => [skyConfigLine(game.config.sky)],
  });

  define({
    name: 'gv_time',
    usage: 'gv_time [0-24|midnight|dawn|noon|dusk]',
    summary: 'Print or set sky time of day.',
    run: (game, args) => {
      if (!args[0]) return [`sky hour = ${game.config.sky.hour.toFixed(2)}`];
      const hour = skyHourArg(args[0]);
      game.config.sky.hour = hour;
      return [`sky hour = ${hour.toFixed(2)}`];
    },
  });

  define({
    name: 'gv_daycycle',
    usage: 'gv_daycycle [1|0] [hours-per-real-minute]',
    summary: 'Enable, disable, or retime sky day-night cycling.',
    run: (game, args) => {
      const sky = game.config.sky;
      if (!args[0]) {
        return [`dayCycle = ${sky.dayCycleEnabled ? '1' : '0'}`, `cycleHoursPerRealMinute = ${sky.cycleHoursPerRealMinute}`];
      }
      sky.dayCycleEnabled = switchArg(args[0], 'dayCycle');
      if (args[1] != null) sky.cycleHoursPerRealMinute = numberArg(args[1], 'hours-per-real-minute');
      return [`dayCycle = ${sky.dayCycleEnabled ? '1' : '0'}`, `cycleHoursPerRealMinute = ${sky.cycleHoursPerRealMinute}`];
    },
  });

  define({
    name: 'gv_weather',
    usage: 'gv_weather [clear|hazy|cloudy|storm|0-1] [gloom 0-1]',
    summary: 'Print or set sky weather/gloom.',
    run: (game, args) => {
      const sky = game.config.sky;
      if (!args[0]) {
        return [
          `weather = ${sky.weather.toFixed(2)}`,
          `gloom = ${sky.gloom.toFixed(2)}`,
          `presets = ${weatherPresetNames()}`,
        ];
      }
      try {
        const preset = SKY_WEATHER_PRESETS[args[0]];
        sky.weather = preset ? preset.weather : skyInfluenceArg(args[0], 'weather');
        sky.gloom = args[1] == null ? (preset ? preset.gloom : sky.gloom) : skyInfluenceArg(args[1], 'gloom');
      } catch (error: any) {
        throw new Error(`${error.message}; presets: ${weatherPresetNames()}`);
      }
      return [`weather = ${sky.weather.toFixed(2)}`, `gloom = ${sky.gloom.toFixed(2)}`];
    },
  });

  define({
    name: 'gv_view',
    usage: 'gv_view [radius-meters] [fogNear] [fogFar]',
    summary: 'Print or set the draw radius (view distance) and fog.',
    run: (game, args) => {
      const view = game.config.view;
      const describe = () => [
        `drawRadius = ${view.drawRadiusMeters.toFixed(0)} m`,
        `fogNear = ${view.fogNearMeters.toFixed(0)} m${view.fogNearMeters === 0 ? ' (auto)' : ''}`,
        `fogFar = ${view.fogFarMeters.toFixed(0)} m${view.fogFarMeters === 0 ? ' (auto)' : ''}`,
      ];
      if (!args[0]) return describe();
      const t = COMMAND_TUNING.view;
      view.drawRadiusMeters = Math.max(t.minDrawRadiusMeters, Math.min(t.maxDrawRadiusMeters, numberArg(args[0], 'radius')));
      if (args[1] != null) view.fogNearMeters = Math.max(0, numberArg(args[1], 'fogNear'));
      if (args[2] != null) view.fogFarMeters = Math.max(0, numberArg(args[2], 'fogFar'));
      return describe();
    },
  });

  define({
    name: 'gv_events',
    usage: 'gv_events [count] [type-filter]',
    summary: 'Print recent game events from the state ring.',
    run: (game, args) => {
      const t = COMMAND_TUNING.events;
      const rawCount = args[0] == null ? t.defaultConsoleLines : Number(args[0]);
      const count = Number.isFinite(rawCount)
        ? Math.max(1, Math.min(t.maxConsoleLines, Math.floor(rawCount)))
        : t.defaultConsoleLines;
      const filter = Number.isFinite(rawCount) ? args.slice(1).join(' ').trim() : args.join(' ').trim();
      const events = game.events.recent
        .filter((event) => !filter || event.type.includes(filter))
        .slice(-count)
        .reverse();
      if (events.length === 0) return [filter ? `no recent events matching ${filter}` : 'no recent events'];
      return events.map(formatEventForConsole);
    },
  });

  define({
    name: 'gv_emit',
    usage: 'gv_emit <type> [json-payload]',
    summary: 'Emit a typed game event for story/debug wiring.',
    run: (game, args) => {
      const type = args[0];
      if (!type) throw new Error('usage: gv_emit <type> [json-payload]');
      const payload = args.length > 1 ? parseCommandValue(args.slice(1).join(' ')) : {};
      if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('payload must be an object when provided');
      }
      const event = recordEvent(game, type, 'console', ['manual'], payload as Record<string, unknown>);
      return [`emitted ${event.id} ${type}`];
    },
  });

  define({
    name: 'gv_state',
    usage: 'gv_state [path]',
    summary: 'Print the whole game state or a dot path.',
    run: (game, args) => [jsonLine(args[0] ? readPath(game, args[0]) : game)],
  });

  define({
    name: 'gv_set',
    usage: 'gv_set <path> <value>',
    summary: 'Set a game-state dot path to a JSON-ish value.',
    run: (game, args) => {
      const path = args[0];
      if (!path || args.length < 2) throw new Error('usage: gv_set <path> <value>');
      const value = parseCommandValue(args.slice(1).join(' '));
      writePath(game, path, value);
      return [`${path} = ${jsonLine(value)}`];
    },
  });

  define({
    name: 'gv_config',
    usage: 'gv_config [path] [value]',
    summary: 'Print or set a config path.',
    run: (game, args) => {
      const path = args[0];
      if (!path) return [jsonLine(game.config)];
      if (args.length === 1) return [jsonLine(readPath(game.config, path))];
      const value = parseCommandValue(args.slice(1).join(' '));
      writePath(game.config, path, value);
      return [`config.${path} = ${jsonLine(value)}`];
    },
  });

  define({
    name: 'gv_scene',
    usage: 'gv_scene [step]',
    summary: 'Show or set the current scene step.',
    run: (game, args) => {
      const step = args.join(' ').trim();
      if (!step) return [`sceneStep = ${game.sceneStep}`];
      game.sceneStep = step;
      return [`sceneStep = ${step}`];
    },
  });

  define({
    name: 'gv_noise',
    usage: 'gv_noise',
    summary: 'Print material and movement noise multipliers.',
    run: () => {
      const gunshot = GAME_PERCEPTION.tuning.hearing.gunshot;
      return [
        `movement noise: ${movementNoiseLine()}`,
        `gunshot noise: radius:${gunshot.radiusMeters}m salience:${gunshot.salience}`,
        `tile noise multipliers: ${tileNoiseLine()}`,
      ];
    },
  });

  define({
    name: 'gv_save',
    usage: 'gv_save',
    summary: 'Persist the current game state.',
    run: (game) => mountedPersistence(game).save(commandStateSnapshot(game)),
  });

  define({
    name: 'gv_load',
    usage: 'gv_load',
    summary: 'Load the persisted game state.',
    run: (game) => {
      const snapshot = mountedPersistence(game).load();
      if (!snapshot) throw new Error('no saved game state');
      restoreCommandState(game, snapshot);
      return ['loaded persisted game state'];
    },
  });

  define({
    name: 'gv_reset',
    usage: 'gv_reset',
    summary: 'Reset to a fresh scaffold state.',
    run: (game) => {
      Object.assign(game, createGameCommandState());
      return ['reset GameState'];
    },
  });

  define({
    name: 'pv_teleport',
    usage: 'pv_teleport <x> <z> [y]',
    summary: 'Move the player in continuous world space.',
    run: (game, args) => {
      const x = numberArg(args[0], 'x');
      const z = numberArg(args[1], 'z');
      const y = args[2] == null ? game.player.position.y : numberArg(args[2], 'y');
      game.player.position = { x, y, z };
      return [`player.position = ${x}, ${y}, ${z}`];
    },
  });

  define({
    name: 'pv_where',
    usage: 'pv_where',
    summary: 'Print continuous player position and grid cell.',
    run: (game) => {
      const size = game.world.cellSizeMeters;
      const p = game.player.position;
      return [
        `player = ${jsonLine(p)}`,
        `cell = ${cellKey(Math.floor(p.x / size), Math.floor(p.y / size), Math.floor(p.z / size))}`,
      ];
    },
  });

  define({
    name: 'pv_speed',
    usage: 'pv_speed <walk|run> <value>',
    summary: 'Set player walk or run speed.',
    run: (game, args) => {
      const mode = args[0];
      const speed = numberArg(args[1], 'speed');
      if (mode === 'walk') {
        game.player.walkSpeedMetersPerSecond = speed;
        return [`walk speed = ${speed}`];
      }
      if (mode === 'run') {
        game.player.runSpeedMetersPerSecond = speed;
        return [`run speed = ${speed}`];
      }
      throw new Error('mode must be walk or run');
    },
  });

  define({
    name: 'pv_noclip',
    usage: 'pv_noclip <1|0>',
    summary: 'Enable or disable player noclip movement.',
    run: (game, args) => {
      const noclip = switchArg(args[0], 'noclip');
      if (noclip && !game.command.cheatsEnabled) throw new Error('cmd_cheats 1 required');
      game.player.noclip = noclip;
      game.player.physics.velocity = { x: 0, y: 0, z: 0 };
      if (noclip) game.player.physics.grounded = false;
      return [`noclip ${noclip ? 'enabled' : 'disabled'}`];
    },
  });

  define({
    name: 'ev_spawn',
    usage: 'ev_spawn <kind> [x] [z] [y]',
    summary: 'Spawn an entity at continuous coordinates.',
    run: (game, args) => {
      const kind = args[0];
      if (!kind) throw new Error('usage: ev_spawn <kind> [x] [z] [y]');
      const p = game.player.position;
      const x = args[1] == null ? p.x : numberArg(args[1], 'x');
      const z = args[2] == null ? p.z : numberArg(args[2], 'z');
      const y = args[3] == null
        ? p.y + physicsRadiusForKind(kind) + COMMAND_TUNING.spawn.spawnClearanceMeters
        : numberArg(args[3], 'y');
      const entity = spawnEntity(game, kind, x, z, y, `ev_spawn ${args.join(' ')}`);
      return [`spawned entity ${entity.id} at ${x}, ${y}, ${z}`];
    },
  });

  define({
    name: 'ev_burst',
    usage: 'ev_burst [count]',
    summary: 'Spawn a cluster of host-physics test bodies around the player.',
    run: (game, args) => {
      const t = COMMAND_TUNING.spawn;
      const requested = args[0] == null ? t.defaultBurstCount : numberArg(args[0], 'count');
      const count = Math.max(1, Math.min(t.maxBurstCount, Math.floor(requested)));
      const p = game.player.position;
      for (let i = 0; i < count; i += 1) {
        const serial = game.nextEntitySerial;
        const kindIndex = i % t.burstKindCount;
        const kind = kindIndex === 0 ? 'crate' : kindIndex === 1 ? 'ball' : kindIndex === 2 ? 'can' : 'prop';
        const angle = serial * t.burstAngleSerialStep + i * t.burstAngleItemStep;
        const x = p.x + Math.sin(angle) * t.burstSpawnRadiusMeters;
        const z = p.z + Math.cos(angle) * t.burstSpawnRadiusMeters;
        const y = p.y + t.burstBaseHeightMeters + (i % t.burstHeightLaneCount) * t.burstHeightStepMeters;
        const entity = spawnEntity(game, kind, x, z, y, `ev_burst ${count}`);
        entity.physics.velocity = {
          x: Math.sin(angle) * t.burstHorizontalSpeedMetersPerSecond,
          y: t.burstVerticalSpeedMetersPerSecond + (i % t.burstVerticalSpeedLaneCount) * t.burstVerticalSpeedStepMetersPerSecond,
          z: Math.cos(angle) * t.burstHorizontalSpeedMetersPerSecond,
        };
      }
      return [`spawned ${count} physics bodies`];
    },
  });

  define({
    name: 'ev_despawn',
    usage: 'ev_despawn <entityId>',
    summary: 'Remove a spawned entity.',
    run: (game, args) => {
      const id = args[0];
      if (!id) throw new Error('usage: ev_despawn <entityId>');
      if (!game.world.spawnedEntities[id]) throw new Error(`no entity ${id}`);
      delete game.world.spawnedEntities[id];
      return [`despawned ${id}`];
    },
  });

  define({
    name: 'wv_tile',
    usage: 'wv_tile [kind]',
    summary: 'Inspect tile metadata for cover, doors, visibility, traversal, and surface physics.',
    run: (_game, args) => {
      const kind = args[0];
      if (!kind) return [`tile kinds: ${tileKindNamesForConsole()}`];
      if (!isTileKind(kind)) throw new Error(`unknown tile kind ${kind}; expected one of ${tileKindNamesForConsole()}`);
      return [jsonLine(tileKindDefinition(kind))];
    },
  });

  // wv_prop is PARTIAL: the kind table is captured (game/kinds), the world
  // placement system is not — listing kinds works, everything else fails loud.
  define({
    name: 'wv_prop',
    usage: 'wv_prop [kinds] | wv_prop <kind> <x> <z> [yawDeg] [y] | wv_prop remove <id>',
    summary: 'List prop kinds (captured); place/remove awaits the world capture.',
    run: (_game, args) => {
      if (args[0] === 'kinds') return [`prop kinds: ${propKindNamesForConsole()}`];
      return notYetCaptured('wv_prop');
    },
  });

  // ── explicitly-NOT-YET commands: registered so the script language is the
  // full 48 names; each FAILS LOUDLY until its owning capture lane lands. The
  // usage/summary lines are the reference's, so help already teaches the real
  // surface. NOT_YET_CAPTURED (exported above) is the per-owner hand-off list.
  const notYet = (name: string, usage: string, summary: string) =>
    define({ name, usage, summary, run: () => notYetCaptured(name) });

  notYet('lab_list', 'lab_list', 'List lab scenes that can be spawned in the game world.');
  notYet('lab_spawn', 'lab_spawn <name>', 'Enter a lab scene through the normal gameplay rig.');
  notYet('lab_exit', 'lab_exit', 'Return from a lab scene to the normal game scene.');
  notYet('gv_controls', 'gv_controls', 'Print the canonical input contract.');
  // ── the world grid commands (V4: CAPTURED — run for real via game/world/) ──
  // The door's mutators are pure state-in/state-out; the vocabulary owns
  // mutating its ctx, so each body assigns the returned slice fields back.

  define({
    name: 'pv_respawn',
    usage: 'pv_respawn',
    summary: 'Teleport the player to the armed respawn cell — the spawn paired with the last save checkpoint stepped on, or the world default spawn.',
    run: (game) => {
      const cell = game.player.respawnCell ?? GAME_WORLD.defaultSpawnCell(game.world);
      if (!cell) throw new Error('no respawn point set — step on a save point or author a spawn marker');
      const point = GAME_WORLD.respawnPoint(game.world, cell, COMMAND_TUNING.player.stepHeightMeters, game.player.position.y);
      game.player.position = point.position;
      game.player.physics.velocity = { x: 0, y: 0, z: 0 };
      game.player.physics.grounded = true;
      return [`respawned at ${cell.x}, ${cell.z}`];
    },
  });

  define({
    name: 'wv_place',
    usage: 'wv_place <kind> <x> <z> [y]',
    summary: 'Place a world cell on the construction grid.',
    run: (game, args) => {
      const kind = args[0];
      if (!kind) throw new Error('usage: wv_place <kind> <x> <z> [y]');
      if (!isTileKind(kind)) throw new Error(`unknown tile kind ${kind}; expected one of ${tileKindNamesForConsole()}`);
      const cell = { x: numberArg(args[1], 'x'), y: args[3] == null ? 0 : numberArg(args[3], 'y'), z: numberArg(args[2], 'z') };
      // provenance: the registry hands specs args, not the raw line — rebuild it
      const sourceLine = ['wv_place', ...args].join(' ');
      game.world.placedCells = GAME_WORLD.placeCell(game.world, kind, cell, sourceLine).placedCells;
      return [`placed ${kind} at cell ${GAME_WORLD.cellKey(cell)}`];
    },
  });

  define({
    name: 'wv_fill',
    usage: 'wv_fill <kind> <x> <z> <width> <depth> [y]',
    summary: 'Fill a rectangle of one tile kind as a surface region (chunk-native).',
    run: (game, args) => {
      const kind = args[0];
      if (!kind) throw new Error('usage: wv_fill <kind> <x> <z> <width> <depth> [y]');
      if (!isTileKind(kind)) throw new Error(`unknown tile kind ${kind}; expected one of ${tileKindNamesForConsole()}`);
      const x = numberArg(args[1], 'x');
      const z = numberArg(args[2], 'z');
      const width = numberArg(args[3], 'width');
      const depth = numberArg(args[4], 'depth');
      const y = args[5] == null ? 0 : numberArg(args[5], 'y');
      if (width <= 0 || depth <= 0) throw new Error('width and depth must be positive');
      const region: WorldSurfaceRegion = {
        id: `fill_${x}_${z}_${width}x${depth}`,
        label: `${tileKindDefinition(kind).label} fill`,
        kind,
        x,
        y,
        z,
        width,
        depth,
        zoneKey: `fill_${x}_${z}`,
      };
      game.world.surfaceRegions = GAME_WORLD.addSurfaceRegion(game.world, region).surfaceRegions;
      return [`filled ${kind} ${width}x${depth} @ [${x},${z}]`];
    },
  });

  define({
    name: 'wv_remove',
    usage: 'wv_remove <x> <z> [y]',
    summary: 'Remove a placed world cell.',
    run: (game, args) => {
      const cell = { x: numberArg(args[0], 'x'), y: args[2] == null ? 0 : numberArg(args[2], 'y'), z: numberArg(args[1], 'z') };
      game.world.placedCells = GAME_WORLD.removeCell(game.world, cell).placedCells;
      return [`removed cell ${GAME_WORLD.cellKey(cell)}`];
    },
  });

  define({
    name: 'wv_trigger',
    usage: 'wv_trigger <x> <z> [y] [command...|off]',
    summary: 'Show, set, or clear an enter-cell command trigger.',
    run: (game, args) => {
      const x = numberArg(args[0], 'x');
      const z = numberArg(args[1], 'z');
      let y = 0;
      let commandStart = 2;
      if (args[2] != null && Number.isFinite(Number(args[2])) && args[3] != null) {
        y = numberArg(args[2], 'y');
        commandStart = 3;
      }
      const cell = { x, y, z };
      const placedCell = GAME_WORLD.placedCellAt(game.world, cell);
      if (!placedCell) throw new Error(`no placed cell at ${GAME_WORLD.cellKey(cell)}`);
      const triggerCommand = args.slice(commandStart).join(' ').trim();
      if (!triggerCommand) return [`${GAME_WORLD.cellKey(cell)} trigger = ${placedCell.triggerCommand ?? 'none'}`];
      if (triggerCommand === 'off') {
        game.world.placedCells = GAME_WORLD.setCellTrigger(game.world, cell, null).placedCells;
        return [`cleared trigger at ${GAME_WORLD.cellKey(cell)}`];
      }
      game.world.placedCells = GAME_WORLD.setCellTrigger(game.world, cell, triggerCommand).placedCells;
      return [`${GAME_WORLD.cellKey(cell)} trigger = ${triggerCommand}`];
    },
  });
  notYet('wv_path', 'wv_path <fromX> <fromZ> <toX> <toZ> [y] [pedestrian|runner|vehicle]', 'Find a typed-tile grid path between two cells.');
  notYet('wv_road', 'wv_road [x z length [ns|ew] [lanesPerDir 1|2] [bike 1|0] [sidewalks 1|0]] | wv_road remove <id>', 'List roads, or lay a road.');
  notYet('wv_intersection', 'wv_intersection <x> <z> [lanesPerDir 1|2] [bike 1|0] [sidewalks 1|0] | wv_intersection remove <id>', 'Lay a four-way intersection.');
  notYet('wv_culdesac', 'wv_culdesac <centerX> <centerZ> <bulbRadius> [throat n|s|e|w] [lanesPerDir 1|2] [bike 1|0] [sidewalks 1|0]', 'Lay a cul-de-sac turnaround bulb.');
  notYet('wv_signal', 'wv_signal [id] [stop|caution|go|auto]', 'Inspect traffic-control props, or pin/clear a signal phase.');
  notYet('wv_building', 'wv_building [kinds|skins] | wv_building <kind> <x> <z> [...] | wv_building remove <id>', 'List/place/remove a building, or skin one face.');
  notYet('wv_enter', 'wv_enter <buildingId>', 'Enter a closed (interior) building.');
  notYet('wv_leave', 'wv_leave', 'Leave the current building interior.');
  define({
    name: 'wv_mountain',
    usage: 'wv_mountain | wv_mountain trailhead [id]',
    summary: 'List mountains, or teleport to a mountain trailhead to start the climb.',
    run: (game, args) => {
      const mountains = game.world.landforms.filter((lf) => lf.kind === 'mountain');
      if (args.length === 0) {
        if (mountains.length === 0) return ['no mountains'];
        return mountains.map((m) =>
          `${m.id} ${m.label} peak ${m.params.peak}m r=${m.params.baseRadius}m @ [${m.centerX},${m.centerZ}]`,
        );
      }
      if (args[0] === 'trailhead') {
        const mountain = args[1] ? mountains.find((m) => m.id === args[1]) : mountains[0];
        if (!mountain) throw new Error(args[1] ? `no mountain ${args[1]}` : 'no mountains');
        const head = mountainTrailheadPoint(mountain);
        game.player.position = { x: head.x, y: head.top + COMMAND_TUNING.world.trailheadLiftMeters, z: head.z };
        game.player.physics.velocity = { x: 0, y: 0, z: 0 };
        game.player.physics.grounded = true;
        return [`at ${mountain.label} trailhead [${head.x.toFixed(1)},${head.z.toFixed(1)}] — walk the switchbacks up`];
      }
      throw new Error('usage: wv_mountain | wv_mountain trailhead [id]');
    },
  });
  notYet('wv_zone', 'wv_zone [name x z w d [flags...]] | wv_zone remove <id>', 'List zones, or define/remove a named area.');
  define({
    name: 'wv_validate',
    usage: 'wv_validate | wv_validate <id> | wv_validate building <kind> <x> <z> [w d] | wv_validate prop <kind> <x> <z>',
    summary: 'Audit placed things (or preview one) for bad tile/scale/spacing.',
    run: (game, args) => runValidateCommand(game, args),
  });
}

/** Every command name the vocabulary registers — the capture's contract. */
export const GAME_COMMAND_NAMES: string[] = [
  'cmd_help', 'cmd_cheats', 'log',
  'lab_list', 'lab_spawn', 'lab_exit',
  'gv_controls', 'gv_debug_hud', 'gv_perflog', 'gv_churntrace', 'gv_noise',
  'gv_sky', 'gv_time', 'gv_daycycle', 'gv_weather', 'gv_view',
  'gv_events', 'gv_emit', 'gv_state', 'gv_config', 'gv_save', 'gv_load', 'gv_reset',
  'gv_scene', 'gv_set',
  'pv_teleport', 'pv_respawn', 'pv_noclip', 'pv_speed', 'pv_where',
  'ev_spawn', 'ev_burst', 'ev_despawn',
  'wv_tile', 'wv_place', 'wv_fill', 'wv_remove', 'wv_trigger', 'wv_path',
  'wv_road', 'wv_intersection', 'wv_culdesac', 'wv_prop', 'wv_signal',
  'wv_building', 'wv_enter', 'wv_leave', 'wv_mountain', 'wv_zone', 'wv_validate',
];
