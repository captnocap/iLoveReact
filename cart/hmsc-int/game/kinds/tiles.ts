// game/kinds/tiles — the tile-kind registry. THE TABLE IS THE DATA (P2): every
// behavior-affecting value a tile contributes to the game lives in
// TILE_KIND_DEFINITIONS, never in logic. The struct stores `kind`; this registry
// gives it meaning (V4: "the tile system IS the system"). 1 tile = 1 meter.
//
// Fresh capture of cart/hmsc/world/tileKinds.ts (behavior reference only — see
// the capture note in this directory). Consumers go through game/kinds/index.ts
// (P3), never this file directly.
//
// ── THE ROAD GRAMMAR (LOCKED — user-ruled 2026-06-04, proven in pathing_lab) ──
// • A driving lane is a 3-tile trio [shoulder, lane, shoulder]; the WHOLE trio
//   carries the directional lane kind. Flow-less shoulder tiles are a wrong-way
//   loophole (A* drives the oncoming shoulder as a shortcut), so every drivable
//   road tile must carry flow.
// • The kind's `flow` field is the lane's legal direction (compass; north = -Z,
//   the hmsc facing convention). Host pathing builds its flow table FROM this
//   field (runtime/pathing.ts setPathFlows); per-profile againstFlow/crossFlow
//   multipliers (~30 for vehicles) make right-hand traffic fall out of the paint.
// • `junction` is the intersection resolver: flow-neutral road where routes may
//   legally change heading. Right-of-way (signals, yields) gates the box at
//   runtime, not in the path graph. Turn apexes are post-processed to the
//   lane-line intersection (pathing_lab straightenJunctions).
// • `crosswalk` is the zebra band just outside each junction edge. Three jobs in
//   one tile: the ONLY sane pedestrian road crossing (walk-preferred over
//   sidewalk via npc.walkCost), the car STOP LINE (signal yields halt before the
//   band), and walker right-of-way (a pedestrian on the zebra owns the road
//   regardless of the light).
// • Sidewalks are TWO tiles wide (derived as a double ring pass off the road).
// Any deviation from this grammar is a bug.

// ── kind id + placement ──────────────────────────────────────────────────────

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
  | 'marker'
  | 'spawn'
  | 'save'
  // Directional lanes + the junction resolver + the zebra — see the locked
  // grammar above. Listed AFTER the original kinds so kind INDICES stay stable
  // (host pathing ships kind indices in TILE_KINDS order).
  | 'laneNorth'
  | 'laneSouth'
  | 'laneEast'
  | 'laneWest'
  | 'junction'
  | 'crosswalk'
  // The double-yellow centerline strip between opposing lane groups (stamped
  // by the road-stroke painter). Appended last — kind indices stay stable.
  | 'median'
  // Living ground (GRASSTILE-0611, req_0642): paintable lawn/meadow surfaces —
  // the user had bush (an embedded foliage profile) but no grass GROUND.
  | 'grass'
  | 'grassDry'
  // Parking + vehicle spawn (PARKSPAWN-0612, req_0694). Appended last — kind
  // indices stay stable. 'parking' is painted parking-lot ground (asphalt
  // wearing white stall lines); 'vehicleSpawn' is the gameplay marker where
  // the traffic system may materialize a vehicle (which vehicle = the
  // garage's per-style spawnRate weighting, not the cell's business).
  | 'parking'
  | 'vehicleSpawn';

// How a tile kind is allowed to enter the world — the registry is several
// things in one list, and this is what tells them apart:
//   'surface'  — a real paintable ground surface (water/road/sidewalk/…). The
//                only kinds the editor's tile palette offers.
//   'embedded' — a gameplay profile that comes as a PROPERTY of something else
//                and is never freely painted: a building's wall, a solid prop's
//                footprint, a doorway, foliage. It supplies cover /
//                line-of-sight / friction, not a paint swatch.
//   'gameplay' — a single placed cell WITH identity that means something to the
//                game loop (spawn / save checkpoint). Authored one cell at a
//                time in the editor's MARKERS palette.
//   'dev'      — debug-only (the cyan marker); not part of authored worlds.
export type TilePlacement = 'surface' | 'embedded' | 'gameplay' | 'dev';

// ── lane flow (DATA, not a naming convention) ────────────────────────────────
// The old registry carried flow in the kind NAME and left the kind→direction
// table to be hand-built by each consumer. Per P2 the flow is registry data:
// host pathing's flow table is derived from this field.

export type TileFlow = 'none' | 'north' | 'south' | 'east' | 'west';

// Compass → world vector. hmsc facing convention: north = -Z.
export const TILE_FLOW_VECTORS: Record<Exclude<TileFlow, 'none'>, { dx: number; dz: number }> = {
  north: { dx: 0, dz: -1 },
  south: { dx: 0, dz: 1 },
  east: { dx: 1, dz: 0 },
  west: { dx: -1, dz: 0 },
};

// ── the property bundles ─────────────────────────────────────────────────────

export type TilePathingProfile = {
  walkable: boolean;
  movementCost: number;
  blocksLineOfSight: boolean;
};

export type TileCoverHeight = 'none' | 'low' | 'high' | 'full';

export type TileCoverProfile = {
  height: TileCoverHeight;
  protection: number;
  concealment: number;
  shootOver: boolean;
  leanAround: boolean;
  crouchRequired: boolean;
};

// A doorway's pathing surcharge. Deliberately small: the speculative door
// state-machine fields of the old registry (defaultState / interaction /
// widthMeters / blocksMovementWhenClosed / blocksLineOfSightWhenClosed /
// vehiclePassable) had zero consumers and were NOT carried — see the capture
// note. A real door system re-grows this profile from its own requirements.
export type TileDoorProfile = {
  isDoor: boolean;
  // Extra path cost for passing through (the pause to open).
  openCost: number;
};

export type TileVisibilityProfile = {
  opacity: number;
  concealment: number;
  lightTransmission: number;
  soundOcclusion: number;
};

export type TileTraversalWidth = 'open' | 'narrow' | 'blocked';
export type TileTraversalMode = 'walk' | 'run' | 'drive' | 'swim' | 'mantle';

export type TileTraversalProfile = {
  allowedModes: TileTraversalMode[];
  width: TileTraversalWidth;
  maxStepUpMeters: number;
  minClearanceMeters: number;
  slopeLimitDegrees: number;
  requiresCrouch: boolean;
  requiresMantle: boolean;
  vehicleGripMultiplier: number;
};

// NPC path-shaping costs. RAW costs are legality + gentle preference only —
// behavioral shaping (e.g. "roads are terrifying to walk on") lives in
// per-profile multipliers ON TOP of these (the pathing system's profile
// tuning), because raw costs make the road cheaper to walk than the sidewalk.
export type TileNpcProfile = {
  traversable: boolean;
  walkCost: number;
  runCost: number;
  vehicleCost: number;
  preferredByVehicles: boolean;
  noise: number; // 0..1 footstep-noise scale for the perception system
};

export type TileSurfaceMaterial =
  | 'water'
  | 'road'
  | 'concrete'
  | 'soil'
  | 'sand'
  | 'wall'
  | 'door'
  | 'dev';

export type TileSurfaceProfile = {
  material: TileSurfaceMaterial;
  walkSpeedMultiplier: number;
  runSpeedMultiplier: number;
  vehicleSpeedMultiplier: number;
  accelerationMultiplier: number;
  friction: number;
  lateralGrip: number;
  restitution: number;
};

export type TileRenderProfile = {
  color: string;
  heightMeters: number;
  textureKey: string;
};

export type TileAltitudeProfile = {
  sample: 'heightfieldSurface' | 'cellBase';
  followsHeightfield: boolean;
  surfaceOffsetMeters: number;
};

export type TileKindDefinition = {
  kind: TileKind;
  placement: TilePlacement;
  label: string;
  // The lane's legal flow direction; 'none' for every non-lane kind (junction
  // is DELIBERATELY flow-neutral — that is where turns resolve).
  flow: TileFlow;
  pathing: TilePathingProfile;
  npc: TileNpcProfile;
  cover: TileCoverProfile;
  door: TileDoorProfile;
  visibility: TileVisibilityProfile;
  traversal: TileTraversalProfile;
  surface: TileSurfaceProfile;
  render: TileRenderProfile;
  altitude: TileAltitudeProfile;
};

// ── shared bundles (named rows of the table, not buried constants) ───────────

const NO_COVER: TileCoverProfile = {
  height: 'none',
  protection: 0,
  concealment: 0,
  shootOver: false,
  leanAround: false,
  crouchRequired: false,
};

const LOW_COVER: TileCoverProfile = {
  height: 'low',
  protection: 0.35,
  concealment: 0.3,
  shootOver: true,
  leanAround: true,
  crouchRequired: true,
};

const FULL_COVER: TileCoverProfile = {
  height: 'full',
  protection: 1,
  concealment: 1,
  shootOver: false,
  leanAround: true,
  crouchRequired: false,
};

const NO_DOOR: TileDoorProfile = { isDoor: false, openCost: 0 };

const OPEN_VISIBILITY: TileVisibilityProfile = {
  opacity: 0,
  concealment: 0,
  lightTransmission: 1,
  soundOcclusion: 0,
};

const BLOCKED_VISIBILITY: TileVisibilityProfile = {
  opacity: 1,
  concealment: 1,
  lightTransmission: 0,
  soundOcclusion: 0.82,
};

const OPEN_TRAVERSAL: TileTraversalProfile = {
  allowedModes: ['walk', 'run', 'drive'],
  width: 'open',
  maxStepUpMeters: 0.35,
  minClearanceMeters: 2.1,
  slopeLimitDegrees: 38,
  requiresCrouch: false,
  requiresMantle: false,
  vehicleGripMultiplier: 1,
};

const PEDESTRIAN_TRAVERSAL: TileTraversalProfile = {
  ...OPEN_TRAVERSAL,
  allowedModes: ['walk', 'run'],
  vehicleGripMultiplier: 0,
};

const BLOCKED_TRAVERSAL: TileTraversalProfile = {
  allowedModes: [],
  width: 'blocked',
  maxStepUpMeters: 0,
  minClearanceMeters: 0,
  slopeLimitDegrees: 0,
  requiresCrouch: false,
  requiresMantle: false,
  vehicleGripMultiplier: 0,
};

const HEIGHTFIELD_ALTITUDE: TileAltitudeProfile = {
  sample: 'heightfieldSurface',
  followsHeightfield: true,
  surfaceOffsetMeters: 0,
};

const CELL_BASE_ALTITUDE: TileAltitudeProfile = {
  sample: 'cellBase',
  followsHeightfield: false,
  surfaceOffsetMeters: 0,
};

// Texture keys for the 2D-on-3D tile surfaces. Road-like kinds (lanes /
// junction / crosswalk) deliberately share the road surface texture — the
// directional marking is paint-layer territory, not a separate base material.
const TEX = {
  water: 'hmsc.tile.water',
  road: 'hmsc.tile.road',
  asphalt: 'hmsc.tile.asphalt',
  sidewalk: 'hmsc.tile.sidewalk',
  mud: 'hmsc.tile.mud',
  sand: 'hmsc.tile.sand',
  wall: 'hmsc.tile.wall',
  door: 'hmsc.tile.door',
  bush: 'hmsc.tile.bush',
  marker: 'hmsc.tile.marker',
  spawn: 'hmsc.tile.spawn',
  save: 'hmsc.tile.save',
  grass: 'hmsc.tile.grass',
  parking: 'hmsc.tile.parking',
  vehicleSpawn: 'hmsc.tile.vehicleSpawn',
} as const;

const ROAD_SURFACE: TileSurfaceProfile = {
  material: 'road',
  walkSpeedMultiplier: 1.0,
  runSpeedMultiplier: 1.0,
  vehicleSpeedMultiplier: 1.0,
  accelerationMultiplier: 1.0,
  friction: 0.18,
  lateralGrip: 0.92,
  restitution: 0.84,
};

// One definition per lane flow direction — identical drivable profile, only the
// flow differs. vehicleCost (0.6) undercuts plain road (0.72) so vehicle A*
// prefers the painted lane line over any shoulder/legacy-road tile beside it.
function laneKindDefinition(kind: TileKind, label: string, flow: TileFlow): TileKindDefinition {
  return {
    kind,
    placement: 'surface',
    label,
    flow,
    pathing: { walkable: true, movementCost: 0.95, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.02, runCost: 1.0, vehicleCost: 0.6, preferredByVehicles: true, noise: 0.7 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 1 },
    surface: ROAD_SURFACE,
    render: { color: '#232936', heightMeters: 0.08, textureKey: TEX.road },
    altitude: HEIGHTFIELD_ALTITUDE,
  };
}

// ── THE TABLE ─────────────────────────────────────────────────────────────────
// Key order is LOCKED: host pathing ships kind INDICES in TILE_KINDS order, so
// any session-scoped index-keyed grid depends on this exact sequence. New kinds
// append at the END, never in the middle.

export const TILE_KIND_DEFINITIONS: Record<TileKind, TileKindDefinition> = {
  water: {
    kind: 'water',
    placement: 'surface',
    label: 'Water',
    flow: 'none',
    pathing: { walkable: false, movementCost: Infinity, blocksLineOfSight: false },
    npc: { traversable: false, walkCost: Infinity, runCost: Infinity, vehicleCost: Infinity, preferredByVehicles: false, noise: 0.15 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: { ...OPEN_VISIBILITY, opacity: 0.05, concealment: 0.1, lightTransmission: 0.88, soundOcclusion: 0.18 },
    traversal: { ...BLOCKED_TRAVERSAL, allowedModes: ['swim'], width: 'open', vehicleGripMultiplier: 0 },
    surface: { material: 'water', walkSpeedMultiplier: 0.42, runSpeedMultiplier: 0.28, vehicleSpeedMultiplier: 0, accelerationMultiplier: 0.35, friction: 0.96, lateralGrip: 0.22, restitution: 0.02 },
    render: { color: '#4ea0df', heightMeters: 0.02, textureKey: TEX.water },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // Legacy flow-less drivable road. Painted ROADS use the lane-trio grammar
  // (lanes + junction + crosswalk); plain 'road' remains for generic asphalt
  // expanses and pre-grammar saves.
  road: {
    kind: 'road',
    placement: 'surface',
    label: 'Road',
    flow: 'none',
    pathing: { walkable: true, movementCost: 0.95, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.02, runCost: 1.0, vehicleCost: 0.72, preferredByVehicles: true, noise: 0.7 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 1 },
    surface: ROAD_SURFACE,
    render: { color: '#1f2530', heightMeters: 0.08, textureKey: TEX.road },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  asphalt: {
    kind: 'asphalt',
    placement: 'surface',
    label: 'Asphalt',
    flow: 'none',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.05, runCost: 1.0, vehicleCost: 0.78, preferredByVehicles: true, noise: 0.65 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 0.95 },
    surface: { material: 'road', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 0.95, accelerationMultiplier: 1.0, friction: 0.2, lateralGrip: 0.9, restitution: 0.82 },
    render: { color: '#20242d', heightMeters: 0.08, textureKey: TEX.asphalt },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  sidewalk: {
    kind: 'sidewalk',
    placement: 'surface',
    label: 'Sidewalk',
    flow: 'none',
    pathing: { walkable: true, movementCost: 1.08, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.05, vehicleCost: 1.8, preferredByVehicles: false, noise: 0.4 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 0.55 },
    surface: { material: 'concrete', walkSpeedMultiplier: 0.98, runSpeedMultiplier: 0.96, vehicleSpeedMultiplier: 0.55, accelerationMultiplier: 0.96, friction: 0.24, lateralGrip: 0.86, restitution: 0.78 },
    render: { color: '#596170', heightMeters: 0.11, textureKey: TEX.sidewalk },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  mud: {
    kind: 'mud',
    placement: 'surface',
    label: 'Mud',
    flow: 'none',
    pathing: { walkable: true, movementCost: 2.1, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 2.15, runCost: 2.65, vehicleCost: 3.2, preferredByVehicles: false, noise: 0.25 },
    cover: LOW_COVER,
    door: NO_DOOR,
    visibility: { ...OPEN_VISIBILITY, concealment: 0.18, lightTransmission: 0.94, soundOcclusion: 0.08 },
    traversal: { ...OPEN_TRAVERSAL, maxStepUpMeters: 0.24, slopeLimitDegrees: 24, vehicleGripMultiplier: 0.38 },
    surface: { material: 'soil', walkSpeedMultiplier: 0.68, runSpeedMultiplier: 0.52, vehicleSpeedMultiplier: 0.38, accelerationMultiplier: 0.45, friction: 0.86, lateralGrip: 0.55, restitution: 0.16 },
    render: { color: '#5b4636', heightMeters: 0.075, textureKey: TEX.mud },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  sand: {
    kind: 'sand',
    placement: 'surface',
    label: 'Sand',
    flow: 'none',
    pathing: { walkable: true, movementCost: 1.7, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.7, runCost: 2.05, vehicleCost: 2.45, preferredByVehicles: false, noise: 0.35 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: { ...OPEN_VISIBILITY, concealment: 0.1, lightTransmission: 0.96, soundOcclusion: 0.05 },
    traversal: { ...OPEN_TRAVERSAL, maxStepUpMeters: 0.26, slopeLimitDegrees: 28, vehicleGripMultiplier: 0.48 },
    surface: { material: 'sand', walkSpeedMultiplier: 0.78, runSpeedMultiplier: 0.62, vehicleSpeedMultiplier: 0.48, accelerationMultiplier: 0.58, friction: 0.74, lateralGrip: 0.45, restitution: 0.12 },
    render: { color: '#c8b66f', heightMeters: 0.075, textureKey: TEX.sand },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  wall: {
    kind: 'wall',
    placement: 'embedded',
    label: 'Wall',
    flow: 'none',
    pathing: { walkable: false, movementCost: Infinity, blocksLineOfSight: true },
    npc: { traversable: false, walkCost: Infinity, runCost: Infinity, vehicleCost: Infinity, preferredByVehicles: false, noise: 1.0 },
    cover: FULL_COVER,
    door: NO_DOOR,
    visibility: BLOCKED_VISIBILITY,
    traversal: BLOCKED_TRAVERSAL,
    surface: { material: 'wall', walkSpeedMultiplier: 0, runSpeedMultiplier: 0, vehicleSpeedMultiplier: 0, accelerationMultiplier: 0, friction: 0.5, lateralGrip: 0, restitution: 0.45 },
    render: { color: '#cbd5e1', heightMeters: 1.6, textureKey: TEX.wall },
    altitude: CELL_BASE_ALTITUDE,
  },
  door: {
    kind: 'door',
    placement: 'embedded',
    label: 'Door',
    flow: 'none',
    pathing: { walkable: true, movementCost: 1.25, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.35, runCost: 1.5, vehicleCost: Infinity, preferredByVehicles: false, noise: 0.8 },
    cover: { ...LOW_COVER, protection: 0.28, concealment: 0.45, shootOver: false },
    door: { isDoor: true, openCost: 0.45 },
    visibility: { ...OPEN_VISIBILITY, opacity: 0.12, concealment: 0.25, lightTransmission: 0.72, soundOcclusion: 0.36 },
    traversal: { ...PEDESTRIAN_TRAVERSAL, width: 'narrow', minClearanceMeters: 2.05, vehicleGripMultiplier: 0 },
    surface: { material: 'door', walkSpeedMultiplier: 0.82, runSpeedMultiplier: 0.74, vehicleSpeedMultiplier: 0, accelerationMultiplier: 0.75, friction: 0.42, lateralGrip: 0.7, restitution: 0.42 },
    render: { color: '#f59e0b', heightMeters: 1.2, textureKey: TEX.door },
    altitude: CELL_BASE_ALTITUDE,
  },
  bush: {
    kind: 'bush',
    placement: 'embedded',
    label: 'Bush',
    flow: 'none',
    // GTA-style foliage: you walk straight into it (non-solid), it rustles, and
    // it hides you without stopping a bullet. Walkable with high concealment but
    // near-zero protection; it dims line of sight without blocking it. Vehicles
    // do not path through it.
    pathing: { walkable: true, movementCost: 1.18, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.2, runCost: 1.3, vehicleCost: Infinity, preferredByVehicles: false, noise: 0.6 },
    cover: { height: 'high', protection: 0.1, concealment: 0.82, shootOver: false, leanAround: true, crouchRequired: false },
    door: NO_DOOR,
    visibility: { opacity: 0.5, concealment: 0.82, lightTransmission: 0.6, soundOcclusion: 0.2 },
    traversal: { ...PEDESTRIAN_TRAVERSAL, maxStepUpMeters: 0.3 },
    surface: { material: 'soil', walkSpeedMultiplier: 0.9, runSpeedMultiplier: 0.84, vehicleSpeedMultiplier: 0, accelerationMultiplier: 0.85, friction: 0.5, lateralGrip: 0.7, restitution: 0.2 },
    render: { color: '#2f6b35', heightMeters: 0.05, textureKey: TEX.bush },
    altitude: CELL_BASE_ALTITUDE,
  },
  marker: {
    kind: 'marker',
    placement: 'dev',
    label: 'Marker',
    flow: 'none',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.0, vehicleCost: 1.0, preferredByVehicles: false, noise: 0.0 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: OPEN_TRAVERSAL,
    surface: { material: 'dev', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.2, lateralGrip: 0.9, restitution: 0.8 },
    render: { color: '#22d3ee', heightMeters: 0.095, textureKey: TEX.marker },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // Where the player (re)appears. Ordinary walkable ground under a marker look —
  // physics treats it like a normal flat surface so standing/spawning on it
  // feels like any other tile.
  spawn: {
    kind: 'spawn',
    placement: 'gameplay',
    label: 'Spawn Point',
    flow: 'none',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.0, vehicleCost: 1.0, preferredByVehicles: false, noise: 0.0 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: OPEN_TRAVERSAL,
    surface: { material: 'dev', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.2, lateralGrip: 0.9, restitution: 0.8 },
    render: { color: '#22c55e', heightMeters: 0.05, textureKey: TEX.spawn },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // A save checkpoint. Stepping on it persists the game and arms the respawn at
  // its paired spawn cell. Walkable, marker look.
  save: {
    kind: 'save',
    placement: 'gameplay',
    label: 'Save Point',
    flow: 'none',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.0, vehicleCost: 1.0, preferredByVehicles: false, noise: 0.0 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: OPEN_TRAVERSAL,
    surface: { material: 'dev', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.2, lateralGrip: 0.9, restitution: 0.8 },
    render: { color: '#a855f7', heightMeters: 0.05, textureKey: TEX.save },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // ── the locked road grammar: lane trios, the junction resolver, the zebra ──
  laneNorth: laneKindDefinition('laneNorth', 'Lane (north, -Z)', 'north'),
  laneSouth: laneKindDefinition('laneSouth', 'Lane (south, +Z)', 'south'),
  laneEast: laneKindDefinition('laneEast', 'Lane (east, +X)', 'east'),
  laneWest: laneKindDefinition('laneWest', 'Lane (west, -X)', 'west'),
  junction: {
    kind: 'junction',
    placement: 'surface',
    label: 'Junction',
    flow: 'none', // flow-NEUTRAL by design: the box where turns legally resolve
    pathing: { walkable: true, movementCost: 0.95, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.04, runCost: 1.0, vehicleCost: 0.7, preferredByVehicles: true, noise: 0.7 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 1 },
    surface: ROAD_SURFACE,
    render: { color: '#272c37', heightMeters: 0.08, textureKey: TEX.road },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // The zebra crossing — drivable like road, pleasantly walkable so pedestrian
  // cost shaping funnels every road crossing here (walkCost 0.9 undercuts the
  // sidewalk's 1.0). Also the car stop line and walker right-of-way band.
  crosswalk: {
    kind: 'crosswalk',
    placement: 'surface',
    label: 'Crosswalk',
    flow: 'none',
    pathing: { walkable: true, movementCost: 0.95, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 0.9, runCost: 0.95, vehicleCost: 0.75, preferredByVehicles: false, noise: 0.55 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 1 },
    surface: { ...ROAD_SURFACE, friction: 0.19 },
    render: { color: '#3a4250', heightMeters: 0.085, textureKey: TEX.road },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // The double-yellow centerline. Walkable (jaywalking is legal pathing) but
  // vehicleCost prices out driving ALONG it: crossing one cell to turn adds ~6,
  // driving 100m down the middle adds ~600 vs ~60 on a lane — the per-cell tax
  // that closes the flow-less-drivable wrong-way loophole a cheap neutral
  // center tile would open. Flow-neutral by design (it is the boundary, not a
  // lane), so the host flow table ignores it.
  median: {
    kind: 'median',
    placement: 'surface',
    label: 'Median (centerline)',
    flow: 'none',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.3, runCost: 1.35, vehicleCost: 6.0, preferredByVehicles: false, noise: 0.7 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 1 },
    surface: ROAD_SURFACE,
    render: { color: '#46431f', heightMeters: 0.085, textureKey: TEX.road },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // ── living ground (GRASSTILE-0611, req_0642) — appended LAST, indices stable ─
  // Quiet underfoot (the perception system's footstep-noise floor), slightly
  // slow, bad for cars; thin concealment — standing in a LAWN hides nothing
  // (hiding is the bush/grassTall PROP's job, not the ground's).
  grass: {
    kind: 'grass',
    placement: 'surface',
    label: 'Grass',
    flow: 'none',
    pathing: { walkable: true, movementCost: 1.15, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.12, runCost: 1.1, vehicleCost: 1.9, preferredByVehicles: false, noise: 0.2 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: { ...OPEN_VISIBILITY, concealment: 0.12, lightTransmission: 0.97, soundOcclusion: 0.04 },
    traversal: { ...OPEN_TRAVERSAL, maxStepUpMeters: 0.28, slopeLimitDegrees: 30, vehicleGripMultiplier: 0.5 },
    surface: { material: 'soil', walkSpeedMultiplier: 0.95, runSpeedMultiplier: 0.92, vehicleSpeedMultiplier: 0.5, accelerationMultiplier: 0.7, friction: 0.6, lateralGrip: 0.6, restitution: 0.2 },
    render: { color: '#3f7d33', heightMeters: 0.06, textureKey: TEX.grass },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  grassDry: {
    kind: 'grassDry',
    placement: 'surface',
    label: 'Dry Grass',
    flow: 'none',
    pathing: { walkable: true, movementCost: 1.15, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.12, runCost: 1.1, vehicleCost: 1.8, preferredByVehicles: false, noise: 0.28 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: { ...OPEN_VISIBILITY, concealment: 0.1, lightTransmission: 0.97, soundOcclusion: 0.04 },
    traversal: { ...OPEN_TRAVERSAL, maxStepUpMeters: 0.28, slopeLimitDegrees: 30, vehicleGripMultiplier: 0.55 },
    surface: { material: 'soil', walkSpeedMultiplier: 0.96, runSpeedMultiplier: 0.94, vehicleSpeedMultiplier: 0.55, accelerationMultiplier: 0.72, friction: 0.58, lateralGrip: 0.62, restitution: 0.2 },
    render: { color: '#8a9a4a', heightMeters: 0.06, textureKey: TEX.grass },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // ── parking + vehicle spawn (PARKSPAWN-0612, req_0694) — appended LAST ─────
  // Painted parking-lot ground: asphalt wearing white stall lines (the tile
  // surface shaders draw 3m bays). Drivable but priced as a destination, not
  // a thoroughfare — vehicleCost 1.4 keeps A* from cutting through lots.
  parking: {
    kind: 'parking',
    placement: 'surface',
    label: 'Parking',
    flow: 'none',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.05, runCost: 1.0, vehicleCost: 1.4, preferredByVehicles: false, noise: 0.6 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: { ...OPEN_TRAVERSAL, vehicleGripMultiplier: 0.95 },
    surface: { material: 'road', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 0.85, accelerationMultiplier: 0.95, friction: 0.2, lateralGrip: 0.9, restitution: 0.82 },
    render: { color: '#2a2f3a', heightMeters: 0.08, textureKey: TEX.parking },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
  // Where the traffic system may materialize a vehicle. Ordinary drivable
  // ground under a marker look; WHICH vehicle is the garage's per-style
  // spawnRate weighting (GAME_VEHICLE.pickSpawn), not the cell's business.
  vehicleSpawn: {
    kind: 'vehicleSpawn',
    placement: 'gameplay',
    label: 'Vehicle Spawn',
    flow: 'none',
    pathing: { walkable: true, movementCost: 1.0, blocksLineOfSight: false },
    npc: { traversable: true, walkCost: 1.0, runCost: 1.0, vehicleCost: 1.0, preferredByVehicles: false, noise: 0.0 },
    cover: NO_COVER,
    door: NO_DOOR,
    visibility: OPEN_VISIBILITY,
    traversal: OPEN_TRAVERSAL,
    surface: { material: 'dev', walkSpeedMultiplier: 1.0, runSpeedMultiplier: 1.0, vehicleSpeedMultiplier: 1.0, accelerationMultiplier: 1.0, friction: 0.2, lateralGrip: 0.9, restitution: 0.8 },
    render: { color: '#f97316', heightMeters: 0.05, textureKey: TEX.vehicleSpawn },
    altitude: HEIGHTFIELD_ALTITUDE,
  },
};

// Index order is the host-pathing wire format — see the table comment.
export const TILE_KINDS = Object.keys(TILE_KIND_DEFINITIONS) as TileKind[];

// kind → index in TILE_KINDS, for index-keyed grids and the host flow table.
export const TILE_KIND_INDEX: Record<TileKind, number> = Object.fromEntries(
  TILE_KINDS.map((k, i) => [k, i]),
) as Record<TileKind, number>;

// The kinds a user may actually paint as ground — the editor's tile palette
// reads THIS, not the raw registry, so embedded profiles (wall/door/bush) and
// dev/gameplay markers never show up as if they were placeable surfaces.
export const PAINTABLE_TILE_KINDS: TileKind[] = TILE_KINDS.filter(
  (k) => TILE_KIND_DEFINITIONS[k].placement === 'surface',
);

// Embedded profiles — the kinds that come as a property of something else
// (wall/door/bush) and are never freely painted.
export const EMBEDDED_TILE_KINDS: TileKind[] = TILE_KINDS.filter(
  (k) => TILE_KIND_DEFINITIONS[k].placement === 'embedded',
);

// Gameplay markers (spawn/save) — single placed cells with identity, authored
// in the editor's MARKERS palette one cell at a time.
export const GAMEPLAY_TILE_KINDS: TileKind[] = TILE_KINDS.filter(
  (k) => TILE_KIND_DEFINITIONS[k].placement === 'gameplay',
);

export function isTileKind(value: string): value is TileKind {
  return Object.prototype.hasOwnProperty.call(TILE_KIND_DEFINITIONS, value);
}

export function tileKindDefinition(kind: TileKind): TileKindDefinition {
  return TILE_KIND_DEFINITIONS[kind];
}

// The lane's legal flow as a world vector ({dx,dz}; north = -Z), or null for
// flow-neutral kinds. Host pathing derives its setPathFlows table from this.
export function tileFlowVector(kind: TileKind): { dx: number; dz: number } | null {
  const flow = TILE_KIND_DEFINITIONS[kind].flow;
  return flow === 'none' ? null : TILE_FLOW_VECTORS[flow];
}

export function tileKindNamesForConsole(): string {
  return TILE_KINDS.join(', ');
}
