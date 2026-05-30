import {
  Building,
  DEFAULT_CELL_SIZE_METERS,
  GameState,
  HMSC_STATE_SCHEMA_VERSION,
  LivePlayerSnapshot,
  Mountain,
  RoadJunction,
  RoadProfile,
  RoadSegment,
  TileKind,
  WorldProp,
  WorldState,
  WorldSurfaceRegion,
} from '../design';
import { surfaceRegionTopMeters } from '../world/surfaceHeights';
import { addBuildingToWorld } from '../world/interiors';
import { buildingKindDefinition } from '../world/buildingKinds';
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

// Exported namespaced store handles for other hmsc modules (the chunk-painter
// draft + history). Same 'hmsc' namespace + host shim as the internal callers —
// one wrapper, multiple consumers, no second storage path.
export function hmscStoreGet(key: string): string | null {
  return localStoreGet(key);
}

export function hmscStoreSet(key: string, value: string): void {
  localStoreSet(key, value);
}

// A CHUNK is one fixed-size tile field stored as a surfaceRegion with its own
// texture capture (each capture fits the window — see tileSurface). The world
// is built by tiling chunks; here a 2x2 grid of 120-tile chunks → a 240x240
// world. Each chunk gets a distinct material so the chunk seams are visible.
// Changing this layout key invalidates older saved worlds in reviveGameState.
const FLOOR_LAYOUT_KEY = 'hmsc.chunks2x2.v4';
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

// A small road network laid through the spawn (0,0) sidewalk chunk so a fresh
// world shows the system off. Every piece shares one full profile — one car
// lane each way split by the double-yellow centerline, a bike lane each side,
// and sidewalks (width 2*(3.5 + 1.6 + 2.0) = 14.2m) — so the lanes and sidewalks
// line up where the pieces meet:
//   - a north-south arterial running up from the spawn corner,
//   - an east-west cross street meeting it at an intersection (z=50),
//   - a cul-de-sac turnaround capping the arterial's north end (z=110).
const SPAWN_ROAD_PROFILE: RoadProfile = { lanesPerDirection: 1, hasBikeLane: true, hasSidewalks: true };
const SPAWN_ARTERIAL_ID = 'road_spawn_arterial';
const SPAWN_CROSS_STREET_ID = 'road_spawn_cross';
const SPAWN_INTERSECTION_ID = 'junction_spawn_intersection';
const SPAWN_CUL_DE_SAC_ID = 'junction_spawn_culdesac';

function createInitialRoads(): RoadSegment[] {
  return [
    {
      id: SPAWN_ARTERIAL_ID,
      label: 'Spawn arterial',
      orientation: 'northSouth',
      x: 3,
      y: 0,
      z: 2,
      lengthTiles: 108,
      profile: SPAWN_ROAD_PROFILE,
      createdByCommand: 'initial-world',
    },
    {
      id: SPAWN_CROSS_STREET_ID,
      label: 'Cross street',
      orientation: 'eastWest',
      x: 3,
      y: 0,
      z: 43,
      lengthTiles: 70,
      profile: SPAWN_ROAD_PROFILE,
      createdByCommand: 'initial-world',
    },
  ];
}

function createInitialJunctions(): RoadJunction[] {
  return [
    {
      kind: 'intersection',
      id: SPAWN_INTERSECTION_ID,
      label: 'Spawn intersection',
      // Min-corner = (arterial x, cross-street z) so the box covers the crossing.
      x: 3,
      y: 0,
      z: 43,
      profile: SPAWN_ROAD_PROFILE,
      createdByCommand: 'initial-world',
    },
    {
      kind: 'culDeSac',
      id: SPAWN_CUL_DE_SAC_ID,
      label: 'Arterial cul-de-sac',
      // Centered on the arterial's north end; its throat opens south onto it.
      centerX: 10.1,
      y: 0,
      centerZ: 110,
      bulbRadiusTiles: 8,
      throat: 'south',
      profile: SPAWN_ROAD_PROFILE,
      createdByCommand: 'initial-world',
    },
  ];
}

// Space-filling street furniture seeded around the spawn so a fresh world shows
// the prop system off, the way the spawn roads do. Yaw 0 faces -Z; a prop that
// governs or is read from the road turns to face it. The arterial runs z up at
// x 3..17.2 (sidewalks at x 3..5 west and 15.2..17.2 east); the cross street and
// intersection meet it at z 43..57.2; the south chunk (z < 0) is sand.
function createInitialProps(): WorldProp[] {
  const seed: Array<Omit<WorldProp, 'createdByCommand'>> = [
    // Cobra-head street lights cantilevered over the arterial, alternating sides.
    { id: 'prop_light_e1', kind: 'streetLight', x: 16.3, y: 0, z: 18, yawDegrees: 90 },
    { id: 'prop_light_e2', kind: 'streetLight', x: 16.3, y: 0, z: 68, yawDegrees: 90 },
    { id: 'prop_light_e3', kind: 'streetLight', x: 16.3, y: 0, z: 92, yawDegrees: 90 },
    { id: 'prop_light_w1', kind: 'streetLight', x: 3.7, y: 0, z: 32, yawDegrees: 270 },
    // Traffic lights at the intersection: one faces northbound arterial traffic
    // (-Z, yaw 0), the cross one faces eastbound cross traffic (-X, yaw 90). Their
    // facings put them a half-cycle apart so the two flows alternate.
    { id: 'prop_signal_ns', kind: 'trafficLight', x: 16.4, y: 0, z: 41, yawDegrees: 0 },
    { id: 'prop_signal_ew', kind: 'trafficLight', x: 1.6, y: 0, z: 50.5, yawDegrees: 90 },
    // Stop signs on the minor approaches (always-stop control).
    { id: 'prop_stop_e', kind: 'stopSign', x: 71.5, y: 0, z: 53, yawDegrees: 90 },
    { id: 'prop_stop_w', kind: 'stopSign', x: 4.5, y: 0, z: 47, yawDegrees: 270 },
    // Green guide signs at the intersection corners (billboard panels).
    { id: 'prop_sign_n', kind: 'streetSign', x: 16.6, y: 0, z: 58, yawDegrees: 0 },
    { id: 'prop_sign_s', kind: 'streetSign', x: 2.4, y: 0, z: 42, yawDegrees: 180 },
    // Hydrants on the sidewalks.
    { id: 'prop_hydrant_e', kind: 'fireHydrant', x: 16.4, y: 0, z: 35, yawDegrees: 90 },
    { id: 'prop_hydrant_w', kind: 'fireHydrant', x: 3.6, y: 0, z: 78, yawDegrees: 270 },
    // GTA bushes near spawn (walk straight through them).
    { id: 'prop_bush_1', kind: 'bush', x: 6.5, y: 0, z: 9, yawDegrees: 12 },
    { id: 'prop_bush_2', kind: 'bush', x: 13.5, y: 0, z: 11, yawDegrees: 40 },
    { id: 'prop_bush_3', kind: 'bush', x: 50, y: 0, z: -15, yawDegrees: 0 },
    // A MASSIVE bush in the open east of spawn — big enough to hide a car in.
    { id: 'prop_bush_mega', kind: 'bushLarge', x: 34, y: 0, z: 24, yawDegrees: 18 },
    // Rocks scattered on the sand chunk.
    { id: 'prop_rock_1', kind: 'rock', x: 40, y: 0, z: -20, yawDegrees: 25 },
    { id: 'prop_rock_2', kind: 'rock', x: 62, y: 0, z: -42, yawDegrees: 70 },
  ];
  return seed.map((prop) => ({ ...prop, createdByCommand: 'initial-world' }));
}

// A large mountain seeded out on the south sand chunk (x 0..120, z -120..0) so a
// fresh world shows the landform + hiking-trail system off, the way the spawn
// roads and props do. The player spawns at the origin and walks south onto the
// sand to reach it. The trail starts on the north rim (angle +Z, facing the
// approaching player) and spirals up to the peak. baseY 0 = the sand floor, so
// the first tread is within one step of the player standing on the sand.
function createInitialMountains(): Mountain[] {
  return [
    {
      id: 'mountain_spawn',
      label: 'South Mountain',
      centerX: 62,
      centerZ: -62,
      baseY: 0,
      baseRadiusMeters: 48,
      peakHeightMeters: 30,
      trailStartAngleRadians: Math.PI / 2,
      createdByCommand: 'initial-world',
    },
  ];
}

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
    roads: createInitialRoads(),
    junctions: createInitialJunctions(),
    props: createInitialProps(),
    buildings: [],
    interiors: {},
    mountains: createInitialMountains(),
    zones: [],
    spawnedEntities: {},
  };
}

// Three demo buildings near spawn, one per enclosure mode, so a fresh world
// shows the building system off the way the spawn roads and props do. Placed
// east of the arterial, south of the cross street, on the spawn sidewalk chunk.
// Their interiors/entry pads are wired by addBuildingToWorld (seedBuildings).
function createInitialBuildings(): Building[] {
  const seed: Array<Omit<Building, 'createdByCommand' | 'label'>> = [
    // Sealed: a solid block. Bump it; stand on its roof. No way in.
    { id: 'building_demo_sealed', kind: 'house', enclosure: 'sealed', x: 26, y: 0, z: 18, widthTiles: 8, depthTiles: 10, doorSide: 'south' },
    // Hollow: a walk-in shell. The south doorway is a real gap and the floor
    // inside is the same outer world — see in from outside, out from inside.
    { id: 'building_demo_hollow', kind: 'shop', enclosure: 'hollow', x: 42, y: 0, z: 18, widthTiles: 8, depthTiles: 10, doorSide: 'south' },
    // Interior: a closed tower. Its front pad is a portal into a separate space
    // far larger than this 12x12 footprint.
    { id: 'building_demo_interior', kind: 'tower', enclosure: 'interior', x: 60, y: 0, z: 16, widthTiles: 12, depthTiles: 12, doorSide: 'south' },
  ];
  return seed.map((b) => ({ ...b, label: buildingKindDefinition(b.kind).label, createdByCommand: 'initial-world' }));
}

function seedBuildings(state: GameState): GameState {
  return createInitialBuildings().reduce((acc, building) => addBuildingToWorld(acc, building), state);
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
      perfWatchEnabled: false,
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
    suspendedSpaces: [],
  };

  return seedBuildings(state);
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
        view: {
          ...initial.config.view,
          ...(parsed.config?.view ?? {}),
        },
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
        roads: storedWorldMatchesCurrentLayout && Array.isArray(parsed.world?.roads)
          ? parsed.world.roads
          : initial.world.roads,
        junctions: storedWorldMatchesCurrentLayout && Array.isArray(parsed.world?.junctions)
          ? parsed.world.junctions
          : initial.world.junctions,
        props: storedWorldMatchesCurrentLayout && Array.isArray(parsed.world?.props)
          ? parsed.world.props
          : initial.world.props,
        // A save predating the mountain layer has no `mountains` key → seed the
        // example landform; a save that already has one keeps it.
        mountains: storedWorldMatchesCurrentLayout && Array.isArray(parsed.world?.mountains)
          ? parsed.world.mountains
          : initial.world.mountains,
        // Zones are authored (wv_zone); a save predating the layer has no key →
        // empty. Layout-matched saves keep their stored zones.
        zones: storedWorldMatchesCurrentLayout && Array.isArray(parsed.world?.zones)
          ? parsed.world.zones
          : initial.world.zones,
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
      // Scene + suspend stack are only meaningful against a matching world. On a
      // layout reset the world falls back to the fresh outer city, so a save made
      // inside a building interior must not revive into a stale swapped world —
      // force the console scene with an empty suspend stack. When the layout
      // matches, keep them so reloading inside an interior lands you inside.
      sceneStep: storedWorldMatchesCurrentLayout ? (parsed.sceneStep ?? 'boot.console') : 'boot.console',
      suspendedSpaces: storedWorldMatchesCurrentLayout && Array.isArray(parsed.suspendedSpaces) ? parsed.suspendedSpaces : [],
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

// Lightweight, high-frequency publish: only the small live player snapshot.
// Deliberately does NOT mirror the full state for hot reload — that is a heavy
// JSON.stringify(whole-state) and running it at the 100ms live-sync cadence
// caused periodic main-thread hitches that pushed frames past the vblank
// (visible fps variance). The full mirror runs on its own slow cadence; see
// mirrorGameStateForHotReload callers in index.tsx + saveGameState.
export function publishLiveGameState(state: GameState): void {
  const raw = JSON.stringify(livePlayerSnapshotFromState(state));
  try {
    localStoreSet(HMSC_LIVE_PLAYER_KEY, raw);
  } catch {}
}

export function saveGameState(state: GameState): GameState {
  const savedState = { ...state, savedAt: nowIso(), updatedAt: nowIso() };
  try {
    localStoreSet(HMSC_STORE_KEY, JSON.stringify(savedState));
  } catch {}
  publishLiveGameState(savedState);
  // Autosave is rare (120s), so mirroring the full state for hot reload here is
  // free frame-wise — keeps the hot-reload snapshot fresh without paying the
  // heavy serialize on the 100ms live-sync path.
  mirrorGameStateForHotReload(savedState);
  return savedState;
}
