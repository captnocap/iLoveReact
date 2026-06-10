import type { RoadProfile } from '../design';

// Road cross-section model. 1 tile = 1 meter (see HMSC_SCALE), so every width
// here is both meters and tiles. A road is symmetric about its centerline; the
// "separator" the minimum road must have IS the double-yellow centerline drawn
// at that axis. From the edges inward, one side of the axis is:
//
//   [ sidewalk ] [ bike lane ] [ car lane x N ] | centerline
//
// Bike lane and sidewalk are optional; car lanes are 1 or 2 per direction.
export const HMSC_ROAD_SCALE = {
  carLaneWidthMeters: 3.5,
  bikeLaneWidthMeters: 1.6,
  sidewalkWidthMeters: 2.0,

  // The road slab's top, in meters above its cell floor. A touch higher than a
  // sidewalk chunk (top ~0.10m) so the roadway reads as its own surface and the
  // slab does not z-fight the ground it is laid on.
  surfaceTopMeters: 0.12,
  slabThicknessMeters: 0.2,

  // Painted markings, in meters, so they keep the same real-world size at any
  // capture resolution or road length (the shader works in world meters, not uv).
  centerlineHalfGapMeters: 0.18, // each yellow line's offset from the road axis
  markingHalfWidthMeters: 0.05,  // half-width of a painted line (lane/bike/center)
  curbHalfWidthMeters: 0.06,     // the joint line where carriageway meets sidewalk
  laneDashMarkMeters: 2.0,       // painted segment of a dashed lane divider
  laneDashGapMeters: 3.0,        // gap between dashed segments

  // Junctions (intersections, cul-de-sacs) sit one centimeter above the road
  // slabs they join, so a junction cleanly covers the through-road markings in
  // the overlap instead of z-fighting them.
  junctionSurfaceTopMeters: 0.13,
  crosswalkDepthMeters: 2.0,      // how far a zebra crosswalk reaches into a leg
  crosswalkStripePeriodMeters: 0.8, // one white bar + one gap

  // Cul-de-sac bulb proportions.
  culDeSacIslandRadiusMeters: 2.5, // landscaped center island the road circles
} as const;

// A bare <Road> is the minimum legal road: one car lane each way, separated by
// the centerline, no bike lane and no sidewalks. Callers opt into the rest.
export const DEFAULT_ROAD_PROFILE: RoadProfile = {
  lanesPerDirection: 1,
  hasBikeLane: false,
  hasSidewalks: false,
};

export type RoadCrossSection = {
  lanesPerDirection: number;
  carLaneRunMeters: number;       // all car lanes on one side: lanes * laneWidth
  bikeLaneMeters: number;         // 0 when the profile has no bike lane
  sidewalkMeters: number;         // 0 when the profile has no sidewalks
  carriagewayHalfMeters: number;  // asphalt half-width: car lanes + bike lane
  totalWidthMeters: number;       // curb-to-curb, both sidewalks included
};

export function solveRoadCrossSection(profile: RoadProfile): RoadCrossSection {
  const carLaneRunMeters = profile.lanesPerDirection * HMSC_ROAD_SCALE.carLaneWidthMeters;
  const bikeLaneMeters = profile.hasBikeLane ? HMSC_ROAD_SCALE.bikeLaneWidthMeters : 0;
  const sidewalkMeters = profile.hasSidewalks ? HMSC_ROAD_SCALE.sidewalkWidthMeters : 0;
  const carriagewayHalfMeters = carLaneRunMeters + bikeLaneMeters;
  const totalWidthMeters = 2 * (carriagewayHalfMeters + sidewalkMeters);
  return {
    lanesPerDirection: profile.lanesPerDirection,
    carLaneRunMeters,
    bikeLaneMeters,
    sidewalkMeters,
    carriagewayHalfMeters,
    totalWidthMeters,
  };
}

// Footprint width rounded up to whole cells, for grid-facing callers.
export function roadWidthTiles(profile: RoadProfile): number {
  return Math.ceil(solveRoadCrossSection(profile).totalWidthMeters);
}
