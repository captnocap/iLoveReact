import type {
  Building,
  GameState,
  InteriorSpace,
  PlacedCell,
  WorldState,
} from '../design';
import { buildingDoorFrontCells, buildingDoorFrontPoint, placeBuilding, removeBuilding } from './buildings';
import { cellKey } from './grid';
import { surfaceRegionTopMeters } from './surfaceHeights';
import { HMSC_SCALE } from './scale';

// The closed-building portal layer. A closed ('interior') building's door leads
// into a separate mini-world that can be far larger than the exterior footprint.
// Entry swaps state.world to that mini-world and pushes the outer world onto the
// suspend stack; leaving pops it back. Because an interior IS a full WorldState,
// the existing renderer (GameWorld3D reads state.world) and host physics
// (state.world rects) draw and simulate it with no special casing — the swap is
// the whole mechanism. The lab system overlays an add-on scene; this is cleaner.

const INTERIOR_SCENE_PREFIX = 'interior.';

// How much bigger inside than out: the interior room is this multiple of the
// building footprint, floored at a roomy minimum so even a tiny shack opens into
// a real space. This is the "bigger inside than out" knob.
const INTERIOR_FOOTPRINT_SCALE = 2.5;
const MIN_INTERIOR_TILES = 12;
const INTERIOR_FLOOR_KIND = 'sidewalk';

export function interiorSceneStep(interiorId: string): string {
  return `${INTERIOR_SCENE_PREFIX}${interiorId}`;
}

export function interiorIdFromSceneStep(sceneStep: string): string | null {
  return sceneStep.startsWith(INTERIOR_SCENE_PREFIX) ? sceneStep.slice(INTERIOR_SCENE_PREFIX.length) : null;
}

export function isInteriorSceneStep(sceneStep: string): boolean {
  return sceneStep.startsWith(INTERIOR_SCENE_PREFIX);
}

function interiorIdFor(building: Building): string {
  return `${building.id}_interior`;
}

// Build a map of walkable trigger pads (door tiles) from a list of cells, all
// firing one command. Used for both the entry mat in front of a closed
// building's door and the exit mat inside its interior doorway.
function padCellRecord(
  cells: Array<{ x: number; y: number; z: number }>,
  triggerCommand: string,
  triggerLabel: string,
): Record<string, PlacedCell> {
  const out: Record<string, PlacedCell> = {};
  for (const cell of cells) {
    const key = cellKey(cell);
    out[key] = { key, kind: 'door', cell, triggerCommand, triggerLabel, createdByCommand: 'building-interior' };
  }
  return out;
}

// The walkable entry mat in the OUTER world, flush in front of an interior
// building's door and spanning the doorway. Stepping onto any of its cells fires
// wv_enter (a door trigger), so the player can't walk up to the closed door and
// miss the trigger.
function entryPads(building: Building): Record<string, PlacedCell> {
  return padCellRecord(buildingDoorFrontCells(building), `wv_enter ${building.id}`, `Enter ${building.label}`);
}

// Build a closed building's interior: a roomy floor enclosed by a hollow shell
// (real tall walls + a south doorway), an exit pad at that doorway carrying
// wv_leave, and the portal metadata (spawn inside, return to the outer approach
// cell). The interior's layout key matches the outer world's so a save made
// inside still revives. Sizing is independent of the building footprint.
export function makeDefaultInterior(building: Building, outerWorld: WorldState): InteriorSpace {
  const interiorId = interiorIdFor(building);
  const widthTiles = Math.max(MIN_INTERIOR_TILES, Math.round(building.widthTiles * INTERIOR_FOOTPRINT_SCALE));
  const depthTiles = Math.max(MIN_INTERIOR_TILES, Math.round(building.depthTiles * INTERIOR_FOOTPRINT_SCALE));
  const cellSizeMeters = outerWorld.cellSizeMeters;

  const floorRegion = {
    id: `${interiorId}_floor`,
    label: `${building.label} floor`,
    kind: INTERIOR_FLOOR_KIND as PlacedCell['kind'],
    x: 0,
    y: 0,
    z: 0,
    width: widthTiles,
    depth: depthTiles,
    zoneKey: interiorId,
  };
  const floorTop = surfaceRegionTopMeters(floorRegion, cellSizeMeters);

  // The enclosing shell: a hollow building with its doorway on the south edge,
  // so the room has proper full-height walls and one opening. Reuses the exact
  // same wall geometry/physics/render path as an outer-world hollow building.
  const shell: Building = {
    id: `${interiorId}_shell`,
    kind: building.kind,
    label: `${building.label} interior`,
    enclosure: 'hollow',
    x: 0,
    y: 0,
    z: 0,
    widthTiles,
    depthTiles,
    doorSide: 'south',
    createdByCommand: 'building-interior',
  };

  // Exit mat: the floor cells just inside the shell's south doorway, carrying
  // wv_leave. The shell's south gap is centered at x = widthTiles/2, so the mat
  // spans the doorway on the floor's south row (z 0). Reaching the doorway to
  // leave puts the player on it.
  const doorHalf = HMSC_SCALE.doorWidthMeters / 2;
  const exitCenterX = widthTiles / 2;
  const exitCells: Array<{ x: number; y: number; z: number }> = [];
  for (let x = Math.floor(exitCenterX - doorHalf); x <= Math.floor(exitCenterX + doorHalf - 1e-6); x += 1) {
    exitCells.push({ x, y: 0, z: 0 });
  }
  const exitPads = padCellRecord(exitCells, 'wv_leave', `Leave ${building.label}`);

  // Spread the outer world first so the interior inherits scalar fields and ANY
  // future world layer exists (an empty/inherited value never crashes the
  // renderer the way a missing one does), then override every known layer to an
  // empty interior. This is what keeps the active-world swap robust as new world
  // layers (zones, mountains, …) get added by other work.
  const space: WorldState = {
    ...outerWorld,
    cellSizeMeters,
    chunkCellSpan: outerWorld.chunkCellSpan,
    layout: {
      key: outerWorld.layout.key,
      label: `Interior: ${building.label}`,
      widthCells: widthTiles,
      depthCells: depthTiles,
    },
    surfaceRegions: [floorRegion],
    placedCells: exitPads,
    roads: [],
    junctions: [],
    props: [],
    buildings: [shell],
    interiors: {},
    landforms: [],
    zones: [],
    spawnedEntities: {},
    // Start with no crowd — an interior must not inherit the outer city's NPCs
    // through the `...outerWorld` spread above. Its own actors are placed inside.
    npcs: {},
  };

  const exitFront = buildingDoorFrontPoint(building);
  return {
    id: interiorId,
    label: `${building.label} interior`,
    space,
    // Land a few tiles in from the doorway, standing on the floor — clear of the
    // exit mat at the south wall so entering doesn't immediately bounce you out.
    spawnPosition: { x: widthTiles / 2, y: floorTop, z: 3.5 },
    spawnYawDegrees: 0,
    // Return just outside, in front of the building's door, facing away from it.
    exitToPosition: { x: exitFront.x, y: building.y + HMSC_SCALE.floorTileThicknessMeters, z: exitFront.z },
    exitToYawDegrees: building.doorSide === 'north' ? 0 : building.doorSide === 'south' ? 180 : building.doorSide === 'east' ? 270 : 90,
  };
}

// Place a building AND wire its entry: for an 'interior' building this generates
// the interior mini-world and drops the wv_enter pad in front of the door; for
// 'sealed'/'hollow' it is just placeBuilding. The one entry point both the
// wv_building command and the world seed use, so the wiring never drifts.
export function addBuildingToWorld(state: GameState, building: Building): GameState {
  if (building.enclosure !== 'interior') {
    return placeBuilding(state, building);
  }
  const interiorId = interiorIdFor(building);
  const wired: Building = { ...building, interiorId };
  const interior = makeDefaultInterior(wired, state.world);
  const pads = entryPads(wired);
  const placed = placeBuilding(state, wired);
  return {
    ...placed,
    world: {
      ...placed.world,
      interiors: { ...placed.world.interiors, [interiorId]: interior },
      placedCells: { ...placed.world.placedCells, ...pads },
    },
  };
}

export function removeBuildingFromWorld(state: GameState, buildingId: string): GameState {
  const building = state.world.buildings.find((b) => b.id === buildingId);
  const removed = removeBuilding(state, buildingId);
  if (!building || building.enclosure !== 'interior') return removed;
  const interiorId = building.interiorId ?? interiorIdFor(building);
  const nextInteriors = { ...removed.world.interiors };
  delete nextInteriors[interiorId];
  const nextPlacedCells = { ...removed.world.placedCells };
  for (const cell of buildingDoorFrontCells(building)) delete nextPlacedCells[cellKey(cell)];
  return {
    ...removed,
    world: { ...removed.world, interiors: nextInteriors, placedCells: nextPlacedCells },
  };
}

function restPlayer(state: GameState, position: { x: number; y: number; z: number }, yawDegrees: number): GameState['player'] {
  return {
    ...state.player,
    position: { ...position },
    yawDegrees,
    physics: { ...state.player.physics, velocity: { x: 0, y: 0, z: 0 }, grounded: false },
  };
}

// Enter a closed building's interior: swap the active world to the interior,
// suspend the outer world, and teleport the player to the interior spawn.
// Assumes the building is a wired 'interior' building (the wv_building command
// validates before calling). Returns the same state if the interior is missing.
export function enterBuildingInterior(state: GameState, building: Building): GameState {
  const interiorId = building.interiorId ?? interiorIdFor(building);
  const interior = state.world.interiors[interiorId];
  if (!interior) return state;
  return {
    ...state,
    sceneStep: interiorSceneStep(interior.id),
    suspendedSpaces: [...state.suspendedSpaces, state.world],
    world: interior.space,
    player: restPlayer(state, interior.spawnPosition, interior.spawnYawDegrees),
  };
}

// Leave the current interior: pop the outer world back and teleport the player
// to the interior's return point. Returns null if not inside an interior.
// Interiors are depth-1 (a generated interior's own space has no interiors of
// its own), so the pop always lands back in the outer city console scene.
export function leaveCurrentInterior(state: GameState): GameState | null {
  if (state.suspendedSpaces.length === 0) return null;
  const outer = state.suspendedSpaces[state.suspendedSpaces.length - 1];
  const interiorId = interiorIdFromSceneStep(state.sceneStep);
  const interior = interiorId ? outer.interiors[interiorId] : undefined;
  const position = interior ? interior.exitToPosition : state.player.position;
  const yaw = interior ? interior.exitToYawDegrees : state.player.yawDegrees;
  return {
    ...state,
    sceneStep: 'boot.console',
    suspendedSpaces: state.suspendedSpaces.slice(0, -1),
    world: outer,
    player: restPlayer(state, position, yaw),
  };
}
