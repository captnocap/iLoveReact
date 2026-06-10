import type { BuildingSide, WorldState } from '../design';
import { roadFootprint } from './roads';
import { junctionFootprint } from './roadJunctions';
import type { RoadFootprint } from './roads';
import { rectGap } from './rects';

// Road-distance helper retained for generic placement warnings. AUTHBUILD-REMOVE
// deleted the legacy `world.buildings` placement resolver; current buildings are
// authored through V24 build pieces (`bp_*`) instead.

// A building must be within this of a road, else it reads as sparse and is
// rejected (unless forced). ~a building-depth + sidewalk from the curb.
export const MAX_ROAD_DISTANCE_METERS = 18;

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
