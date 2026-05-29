import type { RoadCulDeSac, RoadIntersection } from '../design';
import { HMSC_ROAD_SCALE, solveRoadCrossSection } from '../world/roadProfile';
import { TILE_FILL_WGSL } from './tileFill';

// Junction surfaces, each painted by one Effect over a square uv 0..1 mapped to
// world meters (so markings stay scale-true). Both reuse fill_road /
// fill_concrete from tileFill.ts so they match the roads they join.

const JUNCTION_PAINT_CONSTS = `
const JUNCTION_MARK = vec3f(0.86, 0.87, 0.83);
const JUNCTION_CURB = vec3f(0.30, 0.31, 0.33);
const JUNCTION_ISLAND = vec3f(0.36, 0.46, 0.30);
`;

// Four-way crossing: an asphalt cross (either road's carriageway) with a zebra
// crosswalk striped across each leg just outside the central conflict box, and
// sidewalk corners with an L-shaped curb.
//   D[0] sideMeters       D[1] carriageHalfMeters   D[2] sidewalkMeters
//   D[3] crosswalkDepthMeters   D[4] crosswalkStripePeriodMeters
//   D[5] curbHalfMeters
export const INTERSECTION_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
${TILE_FILL_WGSL}
${JUNCTION_PAINT_CONSTS}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let side = D[0];
  let carriageHalf = D[1];
  let crosswalkDepth = D[3];
  let stripePeriod = D[4];
  let curbHalf = D[5];

  let xM = in.uv.x * side;
  let zM = in.uv.y * side;
  let ax = abs(xM - side * 0.5);
  let az = abs(zM - side * 0.5);
  let nsArm = ax <= carriageHalf;
  let ewArm = az <= carriageHalf;

  let seed = tf_rand(floor(vec2f(xM, zM) * 0.5)) * 50.0;
  let uvLocal = vec2f(fract(xM), fract(zM));
  let px = vec2f(xM, zM) * 64.0;

  var col: vec3f;
  if (nsArm || ewArm) {
    col = fill_road(uvLocal, px, 0.0, seed);
    // Zebra crosswalk across the north-south road's two legs.
    if (nsArm && az > carriageHalf && az <= carriageHalf + crosswalkDepth) {
      col = mix(col, JUNCTION_MARK, step(0.5, fract(xM / stripePeriod)) * 0.85);
    }
    // Zebra crosswalk across the east-west road's two legs.
    if (ewArm && ax > carriageHalf && ax <= carriageHalf + crosswalkDepth) {
      col = mix(col, JUNCTION_MARK, step(0.5, fract(zM / stripePeriod)) * 0.85);
    }
  } else {
    col = fill_concrete(uvLocal, px, 0.0, seed);
    let curb = line_near(ax - carriageHalf, curbHalf) + line_near(az - carriageHalf, curbHalf);
    col = mix(col, JUNCTION_CURB, sat(curb) * 0.6);
  }
  return vec4f(col, 1.0);
}
`;

// Dead-end bulb: a circular drivable disc, a sidewalk ring, a landscaped center
// island the road circles, and a throat where the road enters (the ring opens).
//   D[0] sideMeters         D[1] drivableRadiusMeters   D[2] sidewalkMeters
//   D[3] islandRadiusMeters D[4] carriageHalfMeters      D[5] throatAxis (0=x,1=z)
//   D[6] throatSign (+1/-1) D[7] curbHalfMeters
export const CUL_DE_SAC_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
${TILE_FILL_WGSL}
${JUNCTION_PAINT_CONSTS}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let side = D[0];
  let drivableR = D[1];
  let islandR = D[3];
  let carriageHalf = D[4];
  let throatAxis = D[5];
  let throatSign = D[6];
  let curbHalf = D[7];

  let xM = in.uv.x * side;
  let zM = in.uv.y * side;
  let relX = xM - side * 0.5;
  let relZ = zM - side * 0.5;
  let r = length(vec2f(relX, relZ));

  var alongThroat = relX;
  var perpThroat = relZ;
  if (throatAxis > 0.5) { alongThroat = relZ; perpThroat = relX; }
  let inThroat = abs(perpThroat) <= carriageHalf && alongThroat * throatSign >= 0.0;

  let seed = tf_rand(floor(vec2f(xM, zM) * 0.5)) * 50.0;
  let uvLocal = vec2f(fract(xM), fract(zM));
  let px = vec2f(xM, zM) * 64.0;

  var col: vec3f;
  if (r <= islandR) {
    col = fill_concrete(uvLocal, px, 0.0, seed);
    col = mix(col, JUNCTION_ISLAND, 0.35);
  } else if (r <= drivableR) {
    col = fill_road(uvLocal, px, 0.0, seed);
  } else if (inThroat) {
    col = fill_road(uvLocal, px, 0.0, seed);
  } else {
    col = fill_concrete(uvLocal, px, 0.0, seed);
  }

  // Curb rings at the island edge and the drivable edge, broken at the throat.
  var curb = line_near(r - drivableR, curbHalf);
  if (islandR > 0.5) { curb = curb + line_near(r - islandR, curbHalf); }
  let curbMask = select(1.0, 0.0, inThroat);
  col = mix(col, JUNCTION_CURB, sat(curb) * curbMask * 0.6);
  return vec4f(col, 1.0);
}
`;

export function intersectionData(junction: RoadIntersection): number[] {
  const cross = solveRoadCrossSection(junction.profile);
  return [
    cross.totalWidthMeters,
    cross.carriagewayHalfMeters,
    cross.sidewalkMeters,
    HMSC_ROAD_SCALE.crosswalkDepthMeters,
    HMSC_ROAD_SCALE.crosswalkStripePeriodMeters,
    HMSC_ROAD_SCALE.curbHalfWidthMeters,
  ];
}

export function culDeSacData(junction: RoadCulDeSac): number[] {
  const cross = solveRoadCrossSection(junction.profile);
  const throatAxis = junction.throat === 'east' || junction.throat === 'west' ? 0 : 1;
  const throatSign = junction.throat === 'north' || junction.throat === 'east' ? 1 : -1;
  return [
    junction.bulbRadiusTiles * 2,
    junction.bulbRadiusTiles - cross.sidewalkMeters,
    cross.sidewalkMeters,
    HMSC_ROAD_SCALE.culDeSacIslandRadiusMeters,
    cross.carriagewayHalfMeters,
    throatAxis,
    throatSign,
    HMSC_ROAD_SCALE.curbHalfWidthMeters,
  ];
}

export function junctionTextureKey(junctionId: string): string {
  return `hmsc.junction.${junctionId}`;
}
