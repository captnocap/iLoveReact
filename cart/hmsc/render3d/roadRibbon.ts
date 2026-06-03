import { mesh } from '@reactjit/geometries';
import { HMSC_ROAD_SCALE, solveRoadCrossSection } from '../world/roadProfile';
import { LANDFORM_ROAD_PROFILE } from '../world/landforms';
import { TILE_FILL_WGSL } from './tileFill';
import { ROAD_CROSS_SECTION_WGSL } from './roadFill';

// A ROAD RIBBON: a flat strip mesh that follows a path (centerline waypoints at
// the terrain surface) so a road bends over terrain instead of being painted into
// the terrain's low-res texture. UV.x runs ACROSS the lanes (0 = left curb, 1 =
// right curb); UV.y runs ALONG (0..1). It samples a DEDICATED, high-res road
// cross-section texture, so the double-yellow + lanes stay crisp at any size —
// "tile dynamics" laid up the mesh, the same markings the city <Road> slabs use.
//
// A hand-authored geometry def (the @reactjit/geometries cart-author pattern):
// generate builds the strip from params, the framework interns it by params.

export type RoadRibbonParams = {
  points: number[]; // flattened centerline x,y,z triplets, already at surface height
  halfWidth: number; // meters from centerline to curb
};

function generate(p: RoadRibbonParams) {
  const g = mesh();
  const count = Math.floor(p.points.length / 3);
  if (count < 2) return g.build();
  const at = (i: number) => ({ x: p.points[i * 3], y: p.points[i * 3 + 1], z: p.points[i * 3 + 2] });

  // Segment lengths + cumulative arc per vertex (so UV.y normalizes to 0..1).
  let total = 0;
  const arcAt: number[] = [0];
  for (let i = 0; i + 1 < count; i += 1) {
    const a = at(i);
    const b = at(i + 1);
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    arcAt.push(total);
  }
  if (total < 1e-5) return g.build();

  // Per-VERTEX edge points (a mitered join): the across-perpendicular at each
  // vertex is taken from the averaged tangent (prev→next), so consecutive quads
  // SHARE the same left/right points. Computing the perpendicular per segment
  // instead leaves a gap on the outer curve (the seam) where the two segments'
  // edges don't meet — sharing per-vertex edges closes it on both sides.
  const left: [number, number, number][] = [];
  const right: [number, number, number][] = [];
  const hw = p.halfWidth;
  for (let i = 0; i < count; i += 1) {
    const prev = at(Math.max(0, i - 1));
    const next = at(Math.min(count - 1, i + 1));
    let px = -(next.z - prev.z); // horizontal perp of the averaged tangent
    let pz = next.x - prev.x;
    const pl = Math.hypot(px, pz) || 1;
    px = (px / pl) * hw;
    pz = (pz / pl) * hw;
    const pt = at(i);
    left.push([pt.x + px, pt.y, pt.z + pz]);
    right.push([pt.x - px, pt.y, pt.z - pz]);
  }

  const up: [number, number, number] = [0, 1, 0];
  for (let i = 0; i + 1 < count; i += 1) {
    const v0 = arcAt[i] / total;
    const v1 = arcAt[i + 1] / total;
    const aL = left[i];
    const aR = right[i];
    const bL = left[i + 1];
    const bR = right[i + 1];
    // Wound so the face normal is +Y (up); back-face culling keeps it visible.
    g.vert(aL, up, [0, v0]);
    g.vert(bL, up, [0, v1]);
    g.vert(aR, up, [1, v0]);
    g.vert(aR, up, [1, v0]);
    g.vert(bL, up, [0, v1]);
    g.vert(bR, up, [1, v1]);
  }
  return g.build();
}

export const ROAD_RIBBON_DEF = {
  id: 'hmscRoadRibbon',
  generate,
  defaults: { points: [] as number[], halfWidth: 3.5 },
};

// The ribbon's dedicated road texture: the cross-section as a function of UV.x
// (across, 0..1 = curb to curb), uniform along (so a clamp sampler tiles fine for
// a no-dash road). Reuses road_cross_section, so it is the IDENTICAL asphalt +
// double-yellow as a street.
// D: [widthM, carLaneW, dashPeriod, dashMarkFrac, markHalf, curbHalf, centerHalfGap]
export const ROAD_RIBBON_FILL_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
${TILE_FILL_WGSL}
${ROAD_CROSS_SECTION_WGSL}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let widthM = D[0];
  // along position from UV.y (only matters for dashes; a 1-lane road is uniform).
  let yM = in.uv.y * 6.0;
  return vec4f(road_cross_section(in.uv.x * widthM, yM, widthM, 1.0, D[1], 0.0, 0.0, D[2], D[3], D[4], D[5], D[6]), 1.0);
}
`;

export function roadRibbonFillData(): number[] {
  const cross = solveRoadCrossSection(LANDFORM_ROAD_PROFILE);
  const dashPeriod = HMSC_ROAD_SCALE.laneDashMarkMeters + HMSC_ROAD_SCALE.laneDashGapMeters;
  return [
    cross.totalWidthMeters,
    HMSC_ROAD_SCALE.carLaneWidthMeters,
    dashPeriod,
    HMSC_ROAD_SCALE.laneDashMarkMeters / dashPeriod,
    HMSC_ROAD_SCALE.markingHalfWidthMeters,
    HMSC_ROAD_SCALE.curbHalfWidthMeters,
    HMSC_ROAD_SCALE.centerlineHalfGapMeters,
  ];
}

export function roadRibbonTextureKey(id: string): string {
  return `hmsc.roadribbon.${id}`;
}

// High resolution ACROSS (so the thin lane markings are crisp), short along (the
// cross-section is uniform along for a no-dash road).
export const ROAD_RIBBON_CAPTURE_W = 768;
export const ROAD_RIBBON_CAPTURE_H = 64;
