export const HMSC_STATE_SCHEMA_VERSION = 11;
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

export type TileKind =
  | 'water'
  | 'residential'
  | 'downtown'
  | 'mixed'
  | 'road'
  | 'asphalt'
  | 'sidewalk'
  | 'mud'
  | 'sand'
  | 'wall'
  | 'door'
  | 'marker';

export type PlayerState = {
  position: Vec3;
  yawDegrees: number;
  noclip: boolean;
  physics: {
    velocity: Vec3;
    grounded: boolean;
  };
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
  triggerCommand?: string;
  triggerLabel?: string;
  createdByCommand: string;
};

export type SpawnedEntity = {
  id: string;
  kind: string;
  position: Vec3;
  yawDegrees: number;
  physics: {
    enabled: boolean;
    radiusMeters: number;
    velocity: Vec3;
    restitution: number;
    grounded: boolean;
  };
  createdByCommand: string;
};

export type HmscEventRefKind = 'player' | 'npc' | 'entity' | 'world' | 'cell' | 'command' | 'lab' | 'story' | 'system';

export type HmscEventRef = {
  kind: HmscEventRefKind;
  id: string;
  label?: string;
};

export type HmscGameEvent = {
  id: string;
  serial: number;
  occurredAt: string;
  type: string;
  source: string;
  sceneStep: string;
  actor?: HmscEventRef;
  subject?: HmscEventRef;
  target?: HmscEventRef;
  parentId?: string;
  tags: string[];
  player: {
    position: Vec3;
    yawDegrees: number;
    cellKey: string;
  };
  payload: Record<string, unknown>;
};

export type GameEventLogState = {
  nextEventSerial: number;
  recent: HmscGameEvent[];
};

export type StoryValue = boolean | number | string;

export type StoryState = {
  flags: Record<string, StoryValue>;
  counters: Record<string, number>;
};

export type WorldState = {
  cellSizeMeters: number;
  chunkCellSpan: number;
  layout: {
    key: string;
    label: string;
    widthCells: number;
    depthCells: number;
  };
  surfaceRegions: WorldSurfaceRegion[];
  placedCells: Record<string, PlacedCell>;
  spawnedEntities: Record<string, SpawnedEntity>;
};

export type WorldSurfaceRegion = {
  id: string;
  label: string;
  kind: TileKind;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  zoneKey: string;
};

export type PhysicsConfigState = {
  gravityMetersPerSecondSquared: number;
  jumpSpeedMetersPerSecond: number;
  playerCapsuleRadiusMeters: number;
  playerCapsuleHeightMeters: number;
  playerStepHeightMeters: number;
  wallRestitution: number;
  bodyRestitution: number;
  maxDriveFrameSeconds: number;
};

export type SkyConfigState = {
  hour: number;
  weather: number;
  gloom: number;
  dayCycleEnabled: boolean;
  cycleHoursPerRealMinute: number;
};

export type GameConfigState = {
  physics: PhysicsConfigState;
  sky: SkyConfigState;
};

export type CommandSystemState = {
  cheatsEnabled: boolean;
  debugHudEnabled: boolean;
};

export type GameState = {
  schemaVersion: number;
  sessionName: string;
  sceneStep: string;
  nextEntitySerial: number;
  createdAt: string;
  updatedAt: string;
  savedAt: string | null;
  config: GameConfigState;
  command: CommandSystemState;
  story: StoryState;
  events: GameEventLogState;
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
