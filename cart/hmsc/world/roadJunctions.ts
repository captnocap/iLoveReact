import type {
  GameState,
  GridCell,
  RoadCulDeSac,
  RoadIntersection,
  RoadJunction,
  TileKind,
  Vec3,
} from '../design';
import { HMSC_ROAD_SCALE, solveRoadCrossSection } from './roadProfile';
import type { RoadFootprint, RoadPhysicsBand } from './roads';

// World-layer geometry and queries for road junctions. Both an intersection and
// a cul-de-sac occupy a square footprint (the intersection IS the square; the
// cul-de-sac's circular bulb is inscribed in it). They sit one cm above the
// road slabs they join. 1 tile = 1 meter.

export function junctionFootprint(junction: RoadJunction): RoadFootprint {
  if (junction.kind === 'intersection') {
    const side = solveRoadCrossSection(junction.profile).totalWidthMeters;
    return { minX: junction.x, minZ: junction.z, maxX: junction.x + side, maxZ: junction.z + side };
  }
  const radius = junction.bulbRadiusTiles;
  return {
    minX: junction.centerX - radius,
    minZ: junction.centerZ - radius,
    maxX: junction.centerX + radius,
    maxZ: junction.centerZ + radius,
  };
}

export function junctionTopMeters(junction: RoadJunction): number {
  return junction.y + HMSC_ROAD_SCALE.junctionSurfaceTopMeters;
}

function footprintContains(footprint: RoadFootprint, x: number, z: number): boolean {
  return x >= footprint.minX && x < footprint.maxX && z >= footprint.minZ && z < footprint.maxZ;
}

// The intersection is an asphalt cross (either road's carriageway) with sidewalk
// corners outside both carriageways.
function intersectionBandKind(junction: RoadIntersection, x: number, z: number): TileKind {
  const cross = solveRoadCrossSection(junction.profile);
  const side = cross.totalWidthMeters;
  const acrossX = Math.abs(x - (junction.x + side / 2));
  const acrossZ = Math.abs(z - (junction.z + side / 2));
  const carriageHalf = cross.carriagewayHalfMeters;
  return acrossX <= carriageHalf || acrossZ <= carriageHalf ? 'road' : 'sidewalk';
}

// The road enters the bulb through a straight channel of carriageway half-width
// along the throat axis, on the throat's side of center.
function culDeSacInThroat(junction: RoadCulDeSac, relX: number, relZ: number, carriageHalf: number): boolean {
  const alongThroat = junction.throat === 'east' || junction.throat === 'west' ? relX : relZ;
  const perpThroat = junction.throat === 'east' || junction.throat === 'west' ? relZ : relX;
  const towardThroat = junction.throat === 'north' || junction.throat === 'east' ? 1 : -1;
  return Math.abs(perpThroat) <= carriageHalf && alongThroat * towardThroat >= 0;
}

// Center island and sidewalk ring are concrete; the drivable disc and the throat
// opening are asphalt.
function culDeSacBandKind(junction: RoadCulDeSac, x: number, z: number): TileKind {
  const cross = solveRoadCrossSection(junction.profile);
  const drivableRadius = junction.bulbRadiusTiles - cross.sidewalkMeters;
  const relX = x - junction.centerX;
  const relZ = z - junction.centerZ;
  const r = Math.hypot(relX, relZ);
  if (r <= HMSC_ROAD_SCALE.culDeSacIslandRadiusMeters) return 'sidewalk';
  if (r <= drivableRadius) return 'road';
  if (culDeSacInThroat(junction, relX, relZ, cross.carriagewayHalfMeters)) return 'road';
  return 'sidewalk';
}

export function junctionBandKindAt(junction: RoadJunction, x: number, z: number): TileKind | undefined {
  if (!footprintContains(junctionFootprint(junction), x, z)) return undefined;
  return junction.kind === 'intersection'
    ? intersectionBandKind(junction, x, z)
    : culDeSacBandKind(junction, x, z);
}

// Physics treats a junction as one flat asphalt pad (its full footprint at one
// height). The corner sidewalks are visual; the player stands on a single road
// surface across the junction, which is what a flat paved crossing feels like.
export function junctionPhysicsBands(junction: RoadJunction): RoadPhysicsBand[] {
  return [{ ...junctionFootprint(junction), kind: 'road' }];
}

// --- World-position queries (iterate every junction; last laid wins) ---

export function junctionBandKindAtWorldPosition(state: GameState, position: Vec3): TileKind | undefined {
  for (let index = state.world.junctions.length - 1; index >= 0; index -= 1) {
    const kind = junctionBandKindAt(state.world.junctions[index], position.x, position.z);
    if (kind) return kind;
  }
  return undefined;
}

export function junctionBandKindAtCell(state: GameState, cell: GridCell): TileKind | undefined {
  for (let index = state.world.junctions.length - 1; index >= 0; index -= 1) {
    const kind = junctionBandKindAt(state.world.junctions[index], cell.x + 0.5, cell.z + 0.5);
    if (kind) return kind;
  }
  return undefined;
}

export function junctionTopAtWorldPosition(state: GameState, position: Vec3, maxReachableTop: number): number | undefined {
  let top: number | undefined;
  for (const junction of state.world.junctions) {
    if (!footprintContains(junctionFootprint(junction), position.x, position.z)) continue;
    const candidate = junctionTopMeters(junction);
    if (candidate > maxReachableTop) continue;
    top = top == null ? candidate : Math.max(top, candidate);
  }
  return top;
}

// --- Mutations ---

export function placeJunction(state: GameState, junction: RoadJunction): GameState {
  return { ...state, world: { ...state.world, junctions: [...state.world.junctions, junction] } };
}

export function removeJunction(state: GameState, junctionId: string): GameState {
  return { ...state, world: { ...state.world, junctions: state.world.junctions.filter((junction) => junction.id !== junctionId) } };
}
