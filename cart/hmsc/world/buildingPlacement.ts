import type { Building, BuildingSide, GameState, WorldState } from '../design';
import { buildingFootprint } from './buildings';
import { roadFootprint } from './roads';
import { junctionFootprint } from './roadJunctions';
import type { RoadFootprint } from './roads';
import { rectsOverlap, rectGap } from './rects';

// Placement policy for buildings — the city-sanity rules so a placed building
// lines a street instead of floating in a field or overlapping a neighbour. The
// command applies this; the rules are: no overlap (edge-to-edge touching is
// fine), never sitting on a road, must be near a road (or it "feels sparse"),
// and the door auto-snaps to face that nearest road so nobody has to think about
// orientation. A `force` placement skips all of it (sandbox / intentional).

// A building must be within this of a road, else it reads as sparse and is
// rejected (unless forced). ~a building-depth + sidewalk from the curb.
export const MAX_ROAD_DISTANCE_METERS = 18;

export type PlacementResult =
  | { ok: true; building: Building }
  | { ok: false; reason: string };

// rectsOverlap (strict — flush edges don't count) and rectGap live in world/rects.ts,
// shared with the placement validator (world/placementCheck.ts).

function roadFootprints(world: WorldState): RoadFootprint[] {
  return [
    ...world.roads.map(roadFootprint),
    ...world.junctions.map(junctionFootprint),
  ];
}

// The building side facing a target rect, by relative center — the side whose
// outward direction points toward the road.
function sideToward(building: RoadFootprint, target: RoadFootprint): BuildingSide {
  const bx = (building.minX + building.maxX) / 2;
  const bz = (building.minZ + building.maxZ) / 2;
  const tx = (target.minX + target.maxX) / 2;
  const tz = (target.minZ + target.maxZ) / 2;
  const dx = tx - bx;
  const dz = tz - bz;
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 'east' : 'west';
  return dz >= 0 ? 'north' : 'south';
}

// The nearest road/junction to a building footprint and which building side faces
// it. Null when the world has no roads at all.
export function nearestRoad(world: WorldState, footprint: RoadFootprint): { distance: number; side: BuildingSide } | null {
  let best: { distance: number; side: BuildingSide } | null = null;
  for (const road of roadFootprints(world)) {
    const distance = rectGap(footprint, road);
    if (!best || distance < best.distance) {
      best = { distance, side: sideToward(footprint, road) };
    }
  }
  return best;
}

// Resolve a proposed building against the placement rules. Forced placement is
// returned as-is. Otherwise: reject overlaps (other buildings, or sitting on a
// road) and too-far-from-road, and snap the door to face the nearest road.
export function resolveBuildingPlacement(state: GameState, building: Building, force: boolean): PlacementResult {
  if (force) return { ok: true, building };

  const footprint = buildingFootprint(building);

  for (const other of state.world.buildings) {
    if (rectsOverlap(footprint, buildingFootprint(other))) {
      return { ok: false, reason: `overlaps ${other.id} (buildings may touch edge-to-edge but not overlap; add 'force' to override)` };
    }
  }
  for (const road of roadFootprints(state.world)) {
    if (rectsOverlap(footprint, road)) {
      return { ok: false, reason: `sits on a road (add 'force' to override)` };
    }
  }

  const near = nearestRoad(state.world, footprint);
  if (!near || near.distance > MAX_ROAD_DISTANCE_METERS) {
    const dist = near ? `${near.distance.toFixed(1)}m from the nearest road` : 'no roads in the world';
    return { ok: false, reason: `too far from a road (${dist}, max ${MAX_ROAD_DISTANCE_METERS}m) — feels sparse; add 'force' to place anyway` };
  }

  // Auto-snap the door to face the road, so placement never has to think about it.
  return { ok: true, building: { ...building, doorSide: near.side } };
}
