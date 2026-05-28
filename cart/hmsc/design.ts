export const HMSC_STATE_SCHEMA_VERSION = 3;
export const DEFAULT_AUTOSAVE_INTERVAL_MS = 120_000;
export const DEFAULT_LIVE_SYNC_INTERVAL_MS = 100;
export const DEFAULT_CELL_SIZE_METERS = 1;
export const DEFAULT_CHUNK_CELL_SPAN = 16;

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type GridCell = {
  x: number;
  y: number;
  z: number;
};

export type TileKind = 'asphalt' | 'sidewalk' | 'wall' | 'door' | 'marker';

export type PlayerState = {
  position: Vec3;
  yawDegrees: number;
  walkSpeedMetersPerSecond: number;
  runSpeedMetersPerSecond: number;
  health: number;
  heat: number;
  money: number;
  inventory: string[];
};

export type LivePlayerSnapshot = {
  schemaVersion: number;
  sessionName: string;
  updatedAt: string;
  player: PlayerState;
};

export type PlacedCell = {
  key: string;
  kind: TileKind;
  cell: GridCell;
  createdByCommand: string;
};

export type SpawnedEntity = {
  id: string;
  kind: string;
  position: Vec3;
  yawDegrees: number;
  createdByCommand: string;
};

export type WorldState = {
  cellSizeMeters: number;
  chunkCellSpan: number;
  placedCells: Record<string, PlacedCell>;
  spawnedEntities: Record<string, SpawnedEntity>;
};

export type GameState = {
  schemaVersion: number;
  sessionName: string;
  sceneStep: string;
  nextEntitySerial: number;
  createdAt: string;
  updatedAt: string;
  savedAt: string | null;
  player: PlayerState;
  world: WorldState;
};

export type CommandEntryKind = 'input' | 'output' | 'error';

export type CommandEntry = {
  id: string;
  kind: CommandEntryKind;
  text: string;
};

export type CommandResult = {
  state: GameState;
  output: string[];
};

export type CommandHandler = (args: string[], state: GameState, sourceLine: string) => CommandResult;

export type CommandDefinition = {
  name: string;
  aliases?: string[];
  summary: string;
  usage: string;
  run: CommandHandler;
};
