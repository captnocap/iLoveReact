export const HMSC_STATE_SCHEMA_VERSION = 12;
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
  roads: RoadSegment[];
  junctions: RoadJunction[];
  spawnedEntities: Record<string, SpawnedEntity>;
};

export type RoadLaneCount = 1 | 2;

// What a <Road> is made of. The minimum is one car lane each way split by the
// centerline; bike lane and sidewalks are opt-in. See world/roadProfile.ts for
// the meter widths these resolve to.
export type RoadProfile = {
  lanesPerDirection: RoadLaneCount;
  hasBikeLane: boolean;
  hasSidewalks: boolean;
};

export type RoadOrientation = 'northSouth' | 'eastWest';

// A laid road. (x, y, z) is the footprint's min-corner cell; the road runs for
// lengthTiles along its orientation axis and is profile-wide across it. Stored
// as a first-class world layer (peer of surfaceRegions/placedCells) because its
// cross-section markings can't be expressed as a field of identical tiles.
export type RoadSegment = {
  id: string;
  label: string;
  orientation: RoadOrientation;
  x: number;
  y: number;
  z: number;
  lengthTiles: number;
  profile: RoadProfile;
  createdByCommand: string;
};

// Where the road network turns into something other than a straight strip. Both
// junctions are one slab + one shader (the same pattern as RoadSegment); they
// share a layer so render/physics/pathing thread them once. The `profile` sizes
// the junction to the roads it joins (lane/bike/sidewalk widths line up).
export type RoadCulDeSacThroat = 'north' | 'south' | 'east' | 'west';

// A four-way crossing of a north-south and an east-west road: a square asphalt
// box at (x,y,z) min-corner, sized to the road width, with zebra crosswalks on
// each leg and sidewalk corners. Drawn over the crossing roads so it masks
// their markings through the box.
export type RoadIntersection = {
  kind: 'intersection';
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  profile: RoadProfile;
  createdByCommand: string;
};

// A dead-end turnaround bulb centered at (centerX,y,centerZ): a circular
// drivable disc with a sidewalk ring and a small center island, opened on one
// side (`throat`) where its road enters.
export type RoadCulDeSac = {
  kind: 'culDeSac';
  id: string;
  label: string;
  centerX: number;
  y: number;
  centerZ: number;
  bulbRadiusTiles: number;
  throat: RoadCulDeSacThroat;
  profile: RoadProfile;
  createdByCommand: string;
};

export type RoadJunction = RoadIntersection | RoadCulDeSac;

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

// What's visible at distance. drawRadiusMeters = the camera's hard draw radius
// (clip plane + per-mesh cull) — past it the world is not drawn, so cresting a
// hill shows a hazed horizon, not the whole map. Fog fades geometry into the sky
// before that edge; fogNear/fogFar = 0 auto-anchors the fade to the draw radius
// (fade finishes AT it), set them to decouple the haze from the cull distance.
export type ViewConfigState = {
  drawRadiusMeters: number;
  fogNearMeters: number; // 0 = auto (anchor to draw radius)
  fogFarMeters: number; // 0 = auto (anchor to draw radius)
};

export type GameConfigState = {
  physics: PhysicsConfigState;
  sky: SkyConfigState;
  view: ViewConfigState;
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
