import {
  DEFAULT_CELL_SIZE_METERS,
  DEFAULT_CHUNK_CELL_SPAN,
  GameState,
  HMSC_STATE_SCHEMA_VERSION,
  LivePlayerSnapshot,
} from '../design';
import { addDemoMapToState } from '../world/demoMap';

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

export function createInitialGameState(): GameState {
  const now = nowIso();
  let state: GameState = {
    schemaVersion: HMSC_STATE_SCHEMA_VERSION,
    sessionName: 'shitcity_dev',
    sceneStep: 'boot.console',
    nextEntitySerial: 1,
    createdAt: now,
    updatedAt: now,
    savedAt: null,
    player: {
      position: { x: 0.5, y: 0, z: 0.5 },
      yawDegrees: 0,
      walkSpeedMetersPerSecond: 2.4,
      runSpeedMetersPerSecond: 5.8,
      health: 100,
      heat: 0,
      money: 0,
      inventory: [],
    },
    world: {
      cellSizeMeters: DEFAULT_CELL_SIZE_METERS,
      chunkCellSpan: DEFAULT_CHUNK_CELL_SPAN,
      placedCells: {},
      spawnedEntities: {},
    },
  };

  return addDemoMapToState(state);
}

export function markGameStateUpdated(state: GameState): GameState {
  return { ...state, updatedAt: nowIso() };
}

export function reviveGameState(raw: string | null | undefined): GameState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schemaVersion !== HMSC_STATE_SCHEMA_VERSION) return null;
    return cloneGameState({
      ...createInitialGameState(),
      ...parsed,
      player: {
        ...createInitialGameState().player,
        ...(parsed.player ?? {}),
      },
      world: {
        ...createInitialGameState().world,
        ...(parsed.world ?? {}),
        placedCells: parsed.world?.placedCells ?? {},
        spawnedEntities: parsed.world?.spawnedEntities ?? {},
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
