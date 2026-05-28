import {
  DEFAULT_CELL_SIZE_METERS,
  DEFAULT_CHUNK_CELL_SPAN,
  GameState,
  HMSC_STATE_SCHEMA_VERSION,
} from '../design';
import { commandCell, placeCell } from '../world/grid';

declare const globalThis: any;

const HMSC_STORE_KEY = 'hmsc:game-state';
const HMSC_HOT_KEY = 'hmsc:hot-game-state';

function nowIso(): string {
  return new Date().toISOString();
}

function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state));
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

  state = placeCell(state, 'asphalt', commandCell(0, 0), 'boot');
  state = placeCell(state, 'sidewalk', commandCell(1, 0), 'boot');
  state = placeCell(state, 'wall', commandCell(2, 0), 'boot');
  state = placeCell(state, 'door', commandCell(2, 1), 'boot');
  state = placeCell(state, 'marker', commandCell(0, 2), 'boot');
  return state;
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

export function readStoredGameState(): GameState | null {
  const hotRaw = typeof globalThis.__hot_get === 'function' ? globalThis.__hot_get(HMSC_HOT_KEY) : null;
  const hotState = reviveGameState(hotRaw);
  if (hotState) return hotState;

  const storedRaw = typeof globalThis.__store_get === 'function' ? globalThis.__store_get(HMSC_STORE_KEY) : null;
  return reviveGameState(storedRaw);
}

export function mirrorGameStateForHotReload(state: GameState): void {
  if (typeof globalThis.__hot_set !== 'function') return;
  try {
    globalThis.__hot_set(HMSC_HOT_KEY, JSON.stringify(state));
  } catch {}
}

export function saveGameState(state: GameState): GameState {
  const savedState = { ...state, savedAt: nowIso(), updatedAt: nowIso() };
  if (typeof globalThis.__store_set === 'function') {
    try {
      globalThis.__store_set(HMSC_STORE_KEY, JSON.stringify(savedState));
    } catch {}
  }
  mirrorGameStateForHotReload(savedState);
  return savedState;
}
