import type { RoadSegment } from '../design';
import { HMSC_ROAD_SCALE, solveRoadCrossSection } from '../world/roadProfile';
import { TILE_FILL_WGSL } from './tileFill';

// One Effect paints a whole road's cross-section: the asphalt carriageway,
// dashed lane dividers, the double-yellow centerline separator, the green bike
// lane and its solid edge line, and the concrete sidewalks with a curb joint.
// It reuses fill_road / fill_concrete from tileFill.ts (the effect_fills port),
// so the road shares the chunk floors' material look and only adds the lane
// markings on top. The game captures this to a texture for the road slab.
//
// All band/marking geometry is in WORLD METERS, fed through D so the markings
// stay the same real size at any capture resolution or road length:
//   D[0] acrossAxis (0 => uv.x is across, 1 => uv.y is across)
//   D[1] widthMeters (across span)   D[2] lengthMeters (along span)
//   D[3] lanesPerDirection           D[4] carLaneWidthMeters
//   D[5] bikeLaneMeters (0 = none)   D[6] sidewalkMeters (0 = none)
//   D[7] dashPeriodMeters            D[8] dashMarkFraction (mark / period)
//   D[9] markingHalfWidthMeters      D[10] curbHalfWidthMeters
//   D[11] centerlineHalfGapMeters
// The road cross-section as a reusable WGSL function, painted purely by distance
// d from the centerline (and along-position yM for the dashes). Both the straight
// <Road> slab and the estate-hill spiral road call this, so a curved hill road
// gets the IDENTICAL asphalt + double-yellow lanes and the two connect seamlessly.
// Assumes TILE_FILL_WGSL (fill_road / fill_concrete / line_near / tf_rand) is
// already included before it.
export const ROAD_CROSS_SECTION_WGSL = `
const ROAD_MARK_PAINT = vec3f(0.86, 0.87, 0.83);
const ROAD_CENTER_YELLOW = vec3f(0.93, 0.74, 0.18);
const ROAD_CURB = vec3f(0.30, 0.31, 0.33);
const ROAD_BIKE_TINT = vec3f(0.10, 0.34, 0.18);
fn road_cross_section(xM: f32, yM: f32, widthM: f32, lanesPerDir: f32, laneW: f32, bikeM: f32, walkM: f32, dashPeriod: f32, dashMarkFrac: f32, markHalf: f32, curbHalf: f32, centerHalfGap: f32) -> vec3f {
  let d = abs(xM - widthM * 0.5);
  let carriageHalf = lanesPerDir * laneW + bikeM;
  let seed = tf_rand(floor(vec2f(xM, yM) * 0.5)) * 50.0;
  let uvLocal = vec2f(fract(xM), fract(yM));
  let px = vec2f(xM, yM) * 64.0;
  var col: vec3f;
  if (walkM > 0.0 && d > carriageHalf) {
    col = fill_concrete(uvLocal, px, 0.0, seed);
  } else {
    col = fill_road(uvLocal, px, 0.0, seed);
    if (bikeM > 0.0 && d > carriageHalf - bikeM) {
      col = mix(col, ROAD_BIKE_TINT, 0.30);
      col = mix(col, ROAD_MARK_PAINT, line_near(d - (carriageHalf - bikeM), markHalf) * 0.9);
    }
    if (lanesPerDir > 1.5) {
      let dash = 1.0 - step(dashMarkFrac, fract(yM / dashPeriod));
      col = mix(col, ROAD_MARK_PAINT, line_near(d - laneW, markHalf) * dash * 0.9);
    }
    col = mix(col, ROAD_CENTER_YELLOW, line_near(d - centerHalfGap, markHalf) * 0.95);
  }
  if (walkM > 0.0) {
    col = mix(col, ROAD_CURB, line_near(d - carriageHalf, curbHalf) * 0.8);
  }
  return col;
}
`;

export const ROAD_CROSS_SECTION_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
${TILE_FILL_WGSL}
${ROAD_CROSS_SECTION_WGSL}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let acrossAxis = D[0];
  let widthM = D[1];
  let lengthM = D[2];
  var across = in.uv.x;
  var along = in.uv.y;
  if (acrossAxis > 0.5) { across = in.uv.y; along = in.uv.x; }
  return vec4f(road_cross_section(across * widthM, along * lengthM, widthM, D[3], D[4], D[5], D[6], D[7], D[8], D[9], D[10], D[11]), 1.0);
}
`;

export function roadCrossSectionData(road: RoadSegment): number[] {
  const cross = solveRoadCrossSection(road.profile);
  const dashPeriodMeters = HMSC_ROAD_SCALE.laneDashMarkMeters + HMSC_ROAD_SCALE.laneDashGapMeters;
  return [
    road.orientation === 'northSouth' ? 0 : 1,
    cross.totalWidthMeters,
    road.lengthTiles,
    cross.lanesPerDirection,
    HMSC_ROAD_SCALE.carLaneWidthMeters,
    cross.bikeLaneMeters,
    cross.sidewalkMeters,
    dashPeriodMeters,
    HMSC_ROAD_SCALE.laneDashMarkMeters / dashPeriodMeters,
    HMSC_ROAD_SCALE.markingHalfWidthMeters,
    HMSC_ROAD_SCALE.curbHalfWidthMeters,
    HMSC_ROAD_SCALE.centerlineHalfGapMeters,
  ];
}

export function roadTextureKey(roadId: string): string {
  return `hmsc.road.${roadId}`;
}

// ~8 px/meter, clamped so a long road's capture still fits inside the window
// framebuffer (a capture can't render larger than the window — see tileSurface).
const MAX_ROAD_CAPTURE_PX = 900;
export function roadCaptureDimension(meters: number): number {
  return Math.max(256, Math.min(MAX_ROAD_CAPTURE_PX, Math.round(meters * 8)));
}
