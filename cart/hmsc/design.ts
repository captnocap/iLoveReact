export const HMSC_STATE_SCHEMA_VERSION = 14;
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
  | 'bush'
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
  props: WorldProp[];
  buildings: Building[];
  // Closed-building interiors, keyed by interior id. Each is its own mini-world
  // (its size is independent of the building footprint it hangs off — bigger
  // inside than out). Empty inside an interior's own space; only the outer world
  // owns interiors. See world/interiors.ts.
  interiors: Record<string, InteriorSpace>;
  mountains: Mountain[];
  // Named rectangular areas with enter/exit behavior (district names, private
  // property, safe houses…). A first-class world layer, peer of surfaceRegions.
  zones: Zone[];
  spawnedEntities: Record<string, SpawnedEntity>;
}

// A placed building. Like a road or a prop, a building is a first-class world
// layer (not a field of tiles): each one owns a footprint and a sculpted mass.
// The shared property bundle (solidity, cover, line of sight, wall friction) is
// resolved by kind through world/buildingKinds.ts. Axis-aligned (no arbitrary
// yaw) so its wall collision stays as cheap AABB rects; `doorSide` picks the
// entry edge. 1 tile = 1 meter.
export type BuildingKind = 'house' | 'shop' | 'tower';

// How a building meets the player. The three product types, as one field:
//   - 'sealed':   static, no entry. A solid block you bump and can stand on.
//   - 'hollow':   walk-in shell. The doorway is a real gap and the interior is
//                 the SAME outer world — you see in from outside, out from in.
//   - 'interior': closed. The door is a portal into a separate, isolated space
//                 that can be far larger than the exterior footprint.
export type BuildingEnclosure = 'sealed' | 'hollow' | 'interior';

// Which exterior edge carries the entry. north = +Z edge, south = -Z edge,
// east = +X edge, west = -X edge. Ignored when enclosure === 'sealed'.
export type BuildingSide = 'north' | 'south' | 'east' | 'west';

export type Building = {
  id: string;
  kind: BuildingKind;
  label: string;
  enclosure: BuildingEnclosure;
  // Min-corner of the footprint in world meters; y is the cell floor it sits on.
  x: number;
  y: number;
  z: number;
  widthTiles: number; // extent along +X
  depthTiles: number; // extent along +Z
  doorSide: BuildingSide;
  // For enclosure === 'interior': the key into world.interiors this door leads
  // to. Authored alongside the building (see world/interiors.ts).
  interiorId?: string;
  createdByCommand: string;
};

// A closed building's interior: its own little world in its own local coordinate
// space, plus the portal metadata that links it back to the outer world. On
// entry the player teleports to spawnPosition and the active world is swapped to
// `space`; on exit they return to exitToPosition in the outer world. Because the
// interior IS a full WorldState, the existing renderer and host-physics path
// draw and simulate it with no special casing.
export type InteriorSpace = {
  id: string;
  label: string;
  space: WorldState;
  spawnPosition: Vec3;
  spawnYawDegrees: number;
  exitToPosition: Vec3;
  exitToYawDegrees: number;
};;

// Space-filling street furniture (rocks, hydrants, signs, lights, bushes,
// traffic control). A prop is a first-class world layer — a peer of
// roads/junctions/placedCells — because, like a road, it isn't a field of
// identical floor tiles: each kind owns its own sculpted mesh and its own
// footprint. The shared property bundle (solidity, cover, line-of-sight,
// traffic control) is resolved by kind through world/propKinds.ts, the same way
// a tile resolves through tileKindDefinition. 1 tile = 1 meter.
export type PropKind =
  | 'rock'
  | 'fireHydrant'
  | 'streetSign'
  | 'streetLight'
  | 'bush'
  | 'bushLarge'
  | 'stopSign'
  | 'trafficLight';

// A traffic-control prop tells an approaching vehicle to stop, slow, or go. A
// stop sign is always 'stop'; a traffic light cycles through all three. The
// phase is what NPC vehicle pathing reads to decide whether to yield at a
// junction — see world/traffic.ts.
export type TrafficSignalPhase = 'stop' | 'caution' | 'go';

// One placed prop. (x, y, z) is the ground anchor in world meters (y is the
// cell floor the prop stands on); yawDegrees turns its facing (a sign faces its
// road, a traffic light faces the lane it governs). signalOverride pins a
// traffic-control prop to a fixed phase for testing vehicle pathing; cleared, a
// traffic light free-runs its cycle.
export type WorldProp = {
  id: string;
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  yawDegrees: number;
  signalOverride?: TrafficSignalPhase;
  createdByCommand: string;
};

// A large walkable landform: a smooth conical mass (rendered as ONE Heightfield
// mesh) wrapped by a switchback hiking trail that spirals up its flank — the only
// walkable way to the peak. A first-class world layer, peer of roads/props,
// because a mountain is not a field of identical floor tiles. The cone is
// scenery; the trail's flat treads ARE the physics. (centerX, centerZ) is the
// peak's ground anchor in world meters, baseY the terrain it rises from. See
// world/mountain.ts. 1 tile = 1 meter.
export type Mountain = {
  id: string;
  label: string;
  centerX: number;
  centerZ: number;
  baseY: number;
  baseRadiusMeters: number;
  peakHeightMeters: number;
  // Where on the rim the trail begins; the spiral winds up from here.
  trailStartAngleRadians: number;
  createdByCommand: string;
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

// Behavior tags a zone carries for other systems to read. 'private' (property),
// 'safe'/'hostile' (turf), 'restricted' (no-go), 'interior'. Open-ended.
export type ZoneFlag = 'private' | 'safe' | 'hostile' | 'restricted' | 'interior';

// A named rectangular area (cells; 1 tile = 1 m) with enter/exit behavior — the
// GTA district-name unit and the hook for private property. The player-drive
// loop fires onEnter/onExit when the player crosses a zone boundary; the default
// onEnter flashes the name. `ownerId` and `availableWhen` are forward seams for
// the quest slice (unused today) — see WORLD_AUTHORING_PLAN.
export type Zone = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  flags: ZoneFlag[];
  onEnterCommand?: string;
  onExitCommand?: string;
  ownerId?: string;
  availableWhen?: string;
  createdByCommand: string;
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
  perfWatchEnabled: boolean;
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
  // The world the player is currently in. While outside, this is the outer city.
  // On entering a closed building it is swapped to that interior's mini-world and
  // the outer world is pushed onto `suspendedSpaces`; leaving pops it back. So
  // the renderer and host physics always read one active world, never branch.
  world: WorldState;
  suspendedSpaces: WorldState[];
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
