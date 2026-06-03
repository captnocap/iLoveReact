export const HMSC_STATE_SCHEMA_VERSION = 15;
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
  | 'road'
  | 'asphalt'
  | 'sidewalk'
  | 'mud'
  | 'sand'
  | 'wall'
  | 'door'
  | 'bush'
  | 'marker';

// Altered-perception channel. Drives how building skins (and later other
// surfaces) reinterpret themselves — e.g. being high scrambling facade text or
// turning a wall into a live plasma wash. Each value is a 0..1 intensity. The
// static skin catalog accepts this in its render context but ignores it for now;
// the reactive slice lights these up without changing the skin contract.
export type PerceptionState = {
  high: number;
};

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
  perception: PerceptionState;
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

// An NPC: a living actor, distinct from SpawnedEntity (which is a dumb physics
// prop — a crate or a ball). An NPC has three orthogonal axes, each resolved by
// its own registry the same way a tile resolves through tileKinds:
//   - kind    (what it is): body/health/speed defaults — npc/kinds.ts
//   - faction (who it fights): combat allegiance, through the hostility matrix
//             in npc/factions.ts
//   - role    (what it means to the player): an OPEN registry of narrative
//             designations (person of interest, target, informant, witness…) in
//             npc/roles.ts. Stored as a role-id string so new roles are a
//             registry entry, never a type edit.
// The model and its locational hitbox are the shared humanoid (render3d/humanoid);
// `moving`/`running` are DERIVED from velocity at draw time, never stored, so the
// gait can't disagree with motion. NPCs live on WorldState.npcs, so an interior
// (itself a WorldState) carries its own NPCs through the active-world swap with
// no special casing — same as every other world layer.
export type NpcKind = 'civilian' | 'thug' | 'police';

// Combat allegiance. A closed set; who-regards-whom-how is the matrix in
// npc/factions.ts. Orthogonal to role: a `civilian` faction NPC can be your
// `target` (the Hitman mark who won't fight back).
export type NpcFaction = 'civilian' | 'gang' | 'police';

// Body posture. Crouch lowers the head/torso hitbox capsules and the incoming
// hit chance — cover actually protects. No prone (out of scope).
export type NpcStance = 'stand' | 'crouch';

// AI/animation state. `down` is dead/incapacitated; the figure stops driving and
// the entity is no longer a threat. The brain that moves between these is the
// next layer — the entity just stores the current one.
export type NpcPosture = 'idle' | 'wander' | 'alert' | 'flee' | 'fight' | 'down';

export type NpcHealth = {
  current: number;
  max: number;
};

export type NpcState = {
  id: string;
  kind: NpcKind;
  faction: NpcFaction;
  // A role-id into npc/roles.ts (the open designation registry). 'none' = an
  // anonymous background body. The story layer reassigns this (nv_role later).
  role: string;
  position: Vec3;
  yawDegrees: number;
  stance: NpcStance;
  posture: NpcPosture;
  health: NpcHealth;
  // This NPC's own gait clock, so a crowd isn't lockstep.
  animationSeconds: number;
  // Physics + motion. moving/running are derived from |velocity| at render time.
  velocity: Vec3;
  grounded: boolean;
  // Where it's walking to (fed to world/pathing.ts) and who it's fighting (the
  // player id or another npc id). Both optional — an idle civilian has neither.
  pathTarget?: GridCell;
  targetId?: string;
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
  // Registry-driven terrain (world/landforms): mountains, hills, estates, … all as
  // pure data resolved by kind. A new terrain shape is a registry entry, not a new
  // array on WorldState.
  landforms: Landform[];
  // Named rectangular areas with enter/exit behavior (district names, private
  // property, safe houses…). A first-class world layer, peer of surfaceRegions.
  zones: Zone[];
  spawnedEntities: Record<string, SpawnedEntity>;
  // Living actors in this space, keyed by npc id. A first-class world layer, so
  // an interior carries its own crowd through the active-world swap. See npc/.
  npcs: Record<string, NpcState>;
}

// A placed building. Like a road or a prop, a building is a first-class world
// layer (not a field of tiles): each one owns a footprint and a sculpted mass.
// The shared property bundle (solidity, cover, line of sight, wall friction) is
// resolved by kind through world/buildingKinds.ts. The footprint is authored
// axis-aligned (min-corner + width/depth); an optional `yawDegrees` then spins
// the whole mass about its footprint centre. yaw 0 (the default) stays a cheap
// AABB rect for collision; a rotated building emits an ORIENTED rect the host
// collides as an OBB, so the wall you see is still the wall you hit. `doorSide`
// picks the entry edge in the building's own (rotated) frame. 1 tile = 1 meter.
// Box kinds (house/shop/tower/warehouse) wear wall boxes + a captured facade
// skin through the one uniform Building3D renderer. Open kinds (parkingGarage/
// gasStation/usedCarLot) are sculpted structures — decks on pillars, a fuel
// canopy, a sales lot — that don't read as a sealed box, so each owns a custom
// model + custom collision rects (the per-kind dispatch in render3d/buildingModels
// and world/structures, mirroring how a PropKind owns its model). The model axis
// is `structureModel` in BUILDING_KIND_DEFINITIONS; 'box' is the default path.
export type BuildingKind =
  | 'house'
  | 'shop'
  | 'tower'
  | 'warehouse'
  | 'parkingGarage'
  | 'gasStation'
  | 'usedCarLot'
  | 'driveIn';

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

// The facade skin — appearance, a SEPARATE axis from kind (size/physics) so any
// footprint can wear any look. A skin is a 2D facade (windows/signage/address,
// captured to a texture and mapped onto the wall faces) resolved through the
// BUILDING_SKINS registry in render3d/buildingSkins.tsx. 'plain' = the bare
// solid-color wall (no facade panel), the default when a kind/placement does not
// pick one.
export type BuildingSkin =
  | 'plain'
  | 'office'
  | 'residential'
  | 'retail'
  | 'industrial'
  | 'internetCafe'
  | 'gunShop'
  | 'mall';

// A skin can be applied per face instead of to the whole building, so e.g. a
// warehouse wears its garage on the FRONT only and plain walls on the sides, or
// a billboard goes on one side. Face roles are RELATIVE to the building's facing:
// 'front' = the door side, 'back' = opposite, 'left'/'right' = the perpendicular
// walls, 'top' = the roof. `all` is the fallback for any unset face. A bare
// BuildingSkin string applies to every wall (and leaves the roof plain).
export type BuildingFaceRole = 'front' | 'back' | 'left' | 'right' | 'top';
export type BuildingFaceSkins = { all?: BuildingSkin } & Partial<Record<BuildingFaceRole, BuildingSkin>>;

export type Building = {
  id: string;
  kind: BuildingKind;
  label: string;
  enclosure: BuildingEnclosure;
  // Min-corner of the footprint in world meters; y is the cell floor it sits on.
  x: number;
  y: number;
  z: number;
  widthTiles: number; // extent along +X (before yaw)
  depthTiles: number; // extent along +Z (before yaw)
  // Rotation of the whole mass about its footprint centre, degrees, +Y (CCW
  // looking down). Omitted/0 = axis-aligned (the legacy path). doorSide is in
  // this rotated frame, so a yawed building's door turns with it.
  yawDegrees?: number;
  doorSide: BuildingSide;
  // Facade appearance: a single skin for every wall, or a per-face map (front/
  // back/left/right/top). Omitted falls back to the kind's default skin.
  skin?: BuildingSkin | BuildingFaceSkins;
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
  | 'rockLarge'
  | 'rockSmall'
  | 'fireHydrant'
  | 'streetSign'
  | 'streetLight'
  | 'bush'
  | 'bushLarge'
  | 'bushLow'
  | 'bushSparse'
  | 'stopSign'
  | 'trafficLight'
  | 'payphone'
  | 'dumpster'
  | 'mailbox'
  | 'fence';

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

// A baked height grid carried BY a landform (the 'heightfield' kind authored in
// hmsc-int). Most kinds are parametric — their shape comes from a `rise` function
// of `params` — but a freely painted hill has no formula, so its samples ride
// here: a cols×rows grid of metres-above-baseY, row-major, with `cell` metres
// between samples. The grid is centred on the landform's centre, so sample (i,j)
// sits at local ((i-(cols-1)/2)*cell, (j-(rows-1)/2)*cell). The kind's `rise`
// bilinearly samples it; the SAME field drives the mesh, collider, and queries.
//
// `tiles` is the painted per-cell SURFACE on top of the height — a separate,
// finer grid of tile-kind indices (into TILE_KINDS, -1 = empty) that drapes over
// the relief as the mesh texture (the editor's "tiles on the mesh"). Its grid is
// per-1m-cell, so it is denser than the height samples; it spans the same footprint
// centred on the landform centre. The render captures it via the tile-field shader
// (render3d/heightfieldSurface); footing still resolves through surfaceTileKind.
export type LandformField = {
  cols: number;
  rows: number;
  cell: number;
  heights: number[];
  tiles?: { cols: number; rows: number; idx: number[] };
};

// A placed landform — the registry-driven terrain layer (world/landforms). Pure
// data: `kind` selects a LandformKindDef (height function + surface tile kind +
// footprint), `params` are its knobs (radius, height, seed, …). One array, one
// renderer/collider/camera/query path; a new terrain shape is a registry entry,
// not new wiring. Supersedes the per-type Mountain/Hills/EstateHill arrays as they
// migrate in. `field` is the optional baked grid a non-parametric kind
// ('heightfield', a painted hill) carries instead of a formula. 1 tile = 1 meter.
export type Landform = {
  id: string;
  kind: string;
  label: string;
  centerX: number;
  centerZ: number;
  baseY: number;
  params: Record<string, number>;
  field?: LandformField;
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
