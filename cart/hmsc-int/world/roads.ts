import type { GameState, GridCell, RoadSegment, TileKind, Vec3 } from '../design';
import { HMSC_ROAD_SCALE, solveRoadCrossSection } from './roadProfile';

// World-layer geometry and queries for roads. A road is a flat slab strip; its
// across-axis is x for a northSouth road (it runs along z) and z for an
// eastWest road (it runs along x). 1 tile = 1 meter, so the footprint math is
// all in meters.

export type RoadFootprint = { minX: number; minZ: number; maxX: number; maxZ: number };

export function roadFootprint(road: RoadSegment): RoadFootprint {
  const widthMeters = solveRoadCrossSection(road.profile).totalWidthMeters;
  const lengthMeters = road.lengthTiles;
  if (road.orientation === 'northSouth') {
    return { minX: road.x, minZ: road.z, maxX: road.x + widthMeters, maxZ: road.z + lengthMeters };
  }
  return { minX: road.x, minZ: road.z, maxX: road.x + lengthMeters, maxZ: road.z + widthMeters };
}

export function roadTopMeters(road: RoadSegment): number {
  return road.y + HMSC_ROAD_SCALE.surfaceTopMeters;
}

function footprintContains(footprint: RoadFootprint, x: number, z: number): boolean {
  return x >= footprint.minX && x < footprint.maxX && z >= footprint.minZ && z < footprint.maxZ;
}

// Which surface a point inside a road lands on: the concrete sidewalk band at
// the curb edges, otherwise the asphalt carriageway. Car lanes and the bike
// lane are both asphalt, so both report 'road'.
export function roadBandKindAt(road: RoadSegment, x: number, z: number): TileKind | undefined {
  const footprint = roadFootprint(road);
  if (!footprintContains(footprint, x, z)) return undefined;
  const cross = solveRoadCrossSection(road.profile);
  const acrossMeters = road.orientation === 'northSouth' ? x - footprint.minX : z - footprint.minZ;
  const distanceFromAxis = Math.abs(acrossMeters - cross.totalWidthMeters / 2);
  return distanceFromAxis > cross.carriagewayHalfMeters ? 'sidewalk' : 'road';
}

// Axis-aligned surface bands a road contributes to host physics: a center
// carriageway plus a sidewalk strip on each side (when the profile has them).
// Each band is one rect spanning the whole length, so a road is at most three
// rects regardless of how long it is.
export type RoadPhysicsBand = RoadFootprint & { kind: TileKind };

export function roadPhysicsBands(road: RoadSegment): RoadPhysicsBand[] {
  const footprint = roadFootprint(road);
  const walk = solveRoadCrossSection(road.profile).sidewalkMeters;
  if (walk <= 0) return [{ ...footprint, kind: 'road' }];
  if (road.orientation === 'northSouth') {
    return [
      { ...footprint, maxX: footprint.minX + walk, kind: 'sidewalk' },
      { ...footprint, minX: footprint.minX + walk, maxX: footprint.maxX - walk, kind: 'road' },
      { ...footprint, minX: footprint.maxX - walk, kind: 'sidewalk' },
    ];
  }
  return [
    { ...footprint, maxZ: footprint.minZ + walk, kind: 'sidewalk' },
    { ...footprint, minZ: footprint.minZ + walk, maxZ: footprint.maxZ - walk, kind: 'road' },
    { ...footprint, minZ: footprint.maxZ - walk, kind: 'sidewalk' },
  ];
}

// --- World-position queries (iterate every laid road; last laid wins) ---

export function roadBandKindAtWorldPosition(state: GameState, position: Vec3): TileKind | undefined {
  for (let index = state.world.roads.length - 1; index >= 0; index -= 1) {
    const kind = roadBandKindAt(state.world.roads[index], position.x, position.z);
    if (kind) return kind;
  }
  return undefined;
}

export function roadBandKindAtCell(state: GameState, cell: GridCell): TileKind | undefined {
  for (let index = state.world.roads.length - 1; index >= 0; index -= 1) {
    const kind = roadBandKindAt(state.world.roads[index], cell.x + 0.5, cell.z + 0.5);
    if (kind) return kind;
  }
  return undefined;
}

// Highest road surface under a point that is still within the player's step
// reach, mirroring the surfaceRegion ground rule in grid.ts.
export function roadTopAtWorldPosition(state: GameState, position: Vec3, maxReachableTop: number): number | undefined {
  let top: number | undefined;
  for (const road of state.world.roads) {
    if (!footprintContains(roadFootprint(road), position.x, position.z)) continue;
    const candidate = roadTopMeters(road);
    if (candidate > maxReachableTop) continue;
    top = top == null ? candidate : Math.max(top, candidate);
  }
  return top;
}

// --- Mutations (immutable, mirror grid.ts placeCell/removeCell) ---

export function placeRoad(state: GameState, road: RoadSegment): GameState {
  return { ...state, world: { ...state.world, roads: [...state.world.roads, road] } };
}

export function removeRoad(state: GameState, roadId: string): GameState {
  return { ...state, world: { ...state.world, roads: state.world.roads.filter((road) => road.id !== roadId) } };
}
