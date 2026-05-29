import {
  DEFAULT_CELL_SIZE_METERS,
  GameState,
  HMSC_STATE_SCHEMA_VERSION,
  LivePlayerSnapshot,
  TileKind,
  WorldState,
  WorldSurfaceRegion,
} from '../design';
import { surfaceRegionTopMeters } from '../world/surfaceHeights';
import {
  DEFAULT_GAME_CONFIG,
  DEFAULT_ENTITY_RADIUS_METERS,
  DEFAULT_ENTITY_RESTITUTION,
  DEFAULT_PLAYER_HEALTH,
  DEFAULT_PLAYER_HEAT,
  DEFAULT_PLAYER_MONEY,
  DEFAULT_PLAYER_RUN_SPEED_METERS_PER_SECOND,
  DEFAULT_PLAYER_WALK_SPEED_METERS_PER_SECOND,
} from './defaults';

declare const globalThis: any;

const HMSC_STORE_NAMESPACE = 'hmsc';
const HMSC_STORE_KEY = 'game-state';
const HMSC_LIVE_PLAYER_KEY = 'live-player';
const HMSC_HOT_KEY = 'hmsc:hot-game-state';

function nowIso(): string {
  return new Date().toISOString();
}

function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state));
}

function cloneLivePlayerSnapshot(snapshot: LivePlayerSnapshot): LivePlayerSnapshot {
  return JSON.parse(JSON.stringify(snapshot));
}

function livePlayerSnapshotFromState(state: GameState): LivePlayerSnapshot {
  return {
    schemaVersion: state.schemaVersion,
    sessionName: state.sessionName,
    updatedAt: state.updatedAt,
    player: state.player,
  };
}

function localStoreGet(key: string): string | null {
  if (typeof globalThis.__localstoreGet === 'function') {
    const value = globalThis.__localstoreGet(HMSC_STORE_NAMESPACE, key);
    return value ? String(value) : null;
  }
  if (typeof globalThis.__store_get === 'function') {
    const value = globalThis.__store_get(`${HMSC_STORE_NAMESPACE}:${key}`);
    return value ? String(value) : null;
  }
  return null;
}

function localStoreSet(key: string, value: string): void {
  if (typeof globalThis.__localstoreSet === 'function') {
    globalThis.__localstoreSet(HMSC_STORE_NAMESPACE, key, value);
    return;
  }
  if (typeof globalThis.__store_set === 'function') {
    globalThis.__store_set(`${HMSC_STORE_NAMESPACE}:${key}`, value);
  }
}

// A CHUNK is one fixed-size tile field stored as a surfaceRegion with its own
// texture capture (each capture fits the window — see tileSurface). The world
// is built by tiling chunks; here a 2x2 grid of 120-tile chunks → a 240x240
// world. Each chunk gets a distinct material so the chunk seams are visible.
// Changing this layout key invalidates older saved worlds in reviveGameState.
const FLOOR_LAYOUT_KEY = 'hmsc.chunks2x2.v1';
const CHUNK_TILES = 120;
const CHUNKS_PER_SIDE = 2;
// 2x2 grid centered on the origin: chunk min-corners at -120 and 0.
const CHUNK_GRID: { dx: number; dz: number; kind: TileKind; label: string }[] = [
  { dx: 0, dz: 0, kind: 'sidewalk', label: 'Sidewalk chunk' },
  { dx: -1, dz: 0, kind: 'road', label: 'Road chunk' },
  { dx: 0, dz: -1, kind: 'sand', label: 'Sand chunk' },
  { dx: -1, dz: -1, kind: 'asphalt', label: 'Asphalt chunk' },
];

function chunkRegions(): WorldSurfaceRegion[] {
  return CHUNK_GRID.map((c) => ({
    id: `chunk_${c.dx}_${c.dz}`,
    label: c.label,
    kind: c.kind,
    x: c.dx * CHUNK_TILES,
    y: 0,
    z: c.dz * CHUNK_TILES,
    width: CHUNK_TILES,
    depth: CHUNK_TILES,
    zoneKey: `chunk_${c.dx}_${c.dz}`,
  }));
}

// Spawn chunk = the one the player stands on (the (0,0) sidewalk chunk).
const SPAWN_CHUNK_KIND: TileKind = 'sidewalk';

function createInitialWorld(): WorldState {
  const totalTiles = CHUNK_TILES * CHUNKS_PER_SIDE;
  return {
    cellSizeMeters: DEFAULT_CELL_SIZE_METERS,
    chunkCellSpan: CHUNK_TILES,
    layout: {
      key: FLOOR_LAYOUT_KEY,
      label: `Chunks ${CHUNKS_PER_SIDE}x${CHUNKS_PER_SIDE} (${CHUNK_TILES}-tile)`,
      widthCells: totalTiles,
      depthCells: totalTiles,
    },
    surfaceRegions: chunkRegions(),
    placedCells: {},
    spawnedEntities: {},
  };
}

// The player spawns standing on the spawn chunk's physics top — the SAME value
// host physics uses for ground — so the player neither floats nor sinks.
export function initialPlayerFeetHeightMeters(): number {
  const spawnRegion: WorldSurfaceRegion = {
    id: 'spawn', label: 'spawn', kind: SPAWN_CHUNK_KIND,
    x: 0, y: 0, z: 0, width: CHUNK_TILES, depth: CHUNK_TILES, zoneKey: 'spawn',
  };
  return surfaceRegionTopMeters(spawnRegion, DEFAULT_CELL_SIZE_METERS);
}

export function createInitialGameState(): GameState {
  const now = nowIso();
  const state: GameState = {
    schemaVersion: HMSC_STATE_SCHEMA_VERSION,
    sessionName: 'shitcity_dev',
    sceneStep: 'boot.console',
    nextEntitySerial: 1,
    createdAt: now,
    updatedAt: now,
    savedAt: null,
    config: DEFAULT_GAME_CONFIG,
    command: {
      cheatsEnabled: false,
      debugHudEnabled: false,
    },
    story: {
      flags: {},
      counters: {},
    },
    events: {
      nextEventSerial: 1,
      recent: [],
    },
    player: {
      position: { x: 0.5, y: initialPlayerFeetHeightMeters(), z: 0.5 },
      yawDegrees: 0,
      noclip: false,
      physics: {
        velocity: { x: 0, y: 0, z: 0 },
        grounded: true,
      },
      walkSpeedMetersPerSecond: DEFAULT_PLAYER_WALK_SPEED_METERS_PER_SECOND,
      runSpeedMetersPerSecond: DEFAULT_PLAYER_RUN_SPEED_METERS_PER_SECOND,
      health: DEFAULT_PLAYER_HEALTH,
      heat: DEFAULT_PLAYER_HEAT,
      money: DEFAULT_PLAYER_MONEY,
      inventory: [],
    },
    world: createInitialWorld(),
  };

  return state;
}

export function markGameStateUpdated(state: GameState): GameState {
  return { ...state, updatedAt: nowIso() };
}

export function reviveGameState(raw: string | null | undefined): GameState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Number(parsed.schemaVersion ?? 0) > HMSC_STATE_SCHEMA_VERSION) return null;
    const initial = createInitialGameState();
    const storedWorldMatchesCurrentLayout = parsed.world?.layout?.key === initial.world.layout.key;
    return cloneGameState({
      ...initial,
      ...parsed,
      schemaVersion: HMSC_STATE_SCHEMA_VERSION,
      config: {
        ...initial.config,
        ...(parsed.config ?? {}),
        physics: {
          ...initial.config.physics,
          ...(parsed.config?.physics ?? {}),
        },
        // Always load the default sky, NOT the stored one. The hour is a live
        // session value (driven by the optional day/night cycle), not save data
        // — persisting it made the sky load dark/drifted and made gv_reset look
        // like it changed the sky. Default = stable bright midday.
        sky: initial.config.sky,
      },
      command: {
        ...initial.command,
        ...(parsed.command ?? {}),
      },
      story: {
        ...initial.story,
        ...(parsed.story ?? {}),
        flags: {
          ...initial.story.flags,
          ...(parsed.story?.flags ?? {}),
        },
        counters: {
          ...initial.story.counters,
          ...(parsed.story?.counters ?? {}),
        },
      },
      events: {
        ...initial.events,
        ...(parsed.events ?? {}),
        nextEventSerial: Number(parsed.events?.nextEventSerial ?? initial.events.nextEventSerial),
        recent: Array.isArray(parsed.events?.recent) ? parsed.events.recent : [],
      },
      player: {
        ...initial.player,
        ...(storedWorldMatchesCurrentLayout ? (parsed.player ?? {}) : {}),
        physics: {
          ...initial.player.physics,
          ...(storedWorldMatchesCurrentLayout ? (parsed.player?.physics ?? {}) : {}),
          velocity: {
            ...initial.player.physics.velocity,
            ...(storedWorldMatchesCurrentLayout ? (parsed.player?.physics?.velocity ?? {}) : {}),
          },
        },
      },
      world: {
        ...initial.world,
        ...(storedWorldMatchesCurrentLayout ? (parsed.world ?? {}) : {}),
        layout: {
          ...initial.world.layout,
          ...(storedWorldMatchesCurrentLayout ? (parsed.world?.layout ?? {}) : {}),
        },
        surfaceRegions: storedWorldMatchesCurrentLayout && Array.isArray(parsed.world?.surfaceRegions)
          ? parsed.world.surfaceRegions
          : initial.world.surfaceRegions,
        placedCells: storedWorldMatchesCurrentLayout ? (parsed.world?.placedCells ?? {}) : initial.world.placedCells,
        spawnedEntities: Object.fromEntries(Object.entries(parsed.world?.spawnedEntities ?? {}).map(([id, rawEntity]: [string, any]) => [
          id,
          {
            ...rawEntity,
            physics: {
              enabled: true,
              radiusMeters: DEFAULT_ENTITY_RADIUS_METERS,
              restitution: DEFAULT_ENTITY_RESTITUTION,
              grounded: false,
              ...(rawEntity?.physics ?? {}),
              velocity: {
                x: 0,
                y: 0,
                z: 0,
                ...(rawEntity?.physics?.velocity ?? {}),
              },
            },
          },
        ])),
      },
    });
  } catch {
    return null;
  }
}

export function reviveLivePlayerSnapshot(raw: string | null | undefined): LivePlayerSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== HMSC_STATE_SCHEMA_VERSION || !parsed.player) return null;
    return cloneLivePlayerSnapshot({
      schemaVersion: HMSC_STATE_SCHEMA_VERSION,
      sessionName: String(parsed.sessionName ?? 'shitcity_dev'),
      updatedAt: String(parsed.updatedAt ?? nowIso()),
      player: {
        ...createInitialGameState().player,
        ...parsed.player,
      },
    });
  } catch {
    return null;
  }
}

export function readStoredGameState(): GameState | null {
  const hotRaw = typeof globalThis.__hot_get === 'function' ? globalThis.__hot_get(HMSC_HOT_KEY) : null;
  const hotState = reviveGameState(hotRaw);
  if (hotState) return hotState;

  const storedRaw = localStoreGet(HMSC_STORE_KEY);
  return reviveGameState(storedRaw);
}

export function readLivePlayerSnapshot(): LivePlayerSnapshot | null {
  return reviveLivePlayerSnapshot(localStoreGet(HMSC_LIVE_PLAYER_KEY));
}

export function mirrorGameStateForHotReload(state: GameState): void {
  if (typeof globalThis.__hot_set !== 'function') return;
  try {
    globalThis.__hot_set(HMSC_HOT_KEY, JSON.stringify(state));
  } catch {}
}

export function publishLiveGameState(state: GameState): void {
  const raw = JSON.stringify(livePlayerSnapshotFromState(state));
  try {
    localStoreSet(HMSC_LIVE_PLAYER_KEY, raw);
  } catch {}
  mirrorGameStateForHotReload(state);
}

export function saveGameState(state: GameState): GameState {
  const savedState = { ...state, savedAt: nowIso(), updatedAt: nowIso() };
  try {
    localStoreSet(HMSC_STORE_KEY, JSON.stringify(savedState));
  } catch {}
  publishLiveGameState(savedState);
  return savedState;
}
