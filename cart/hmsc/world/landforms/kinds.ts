import type { Landform, LandformField, RoadProfile } from '../../design';
import { solveRoadCrossSection } from '../roadProfile';
import { registerLandformKind } from './registry';

// Registered landform kinds. Importing this module registers them (side effect);
// the barrel `world/landforms/index.ts` does that import so consumers get a
// populated registry. A new terrain shape is one registerLandformKind call here.
// JSX-free (world/): the pure shape/footing/water math lives here; the meshes a
// kind decorates with (a crater lake, a road ribbon) are render-side
// (render3d/Landform.tsx), driven by the geometry helpers this file exports.

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smoothBump(t: number): number {
  if (t >= 1) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
// Smooth 1→0 falloff over t in [0,1] (a steep-but-soft dome flank).
function smoothFalloff(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

// ── shared spiral carve (mountain trail + estate road both wind a bench in) ──
// A landform with a switchback path carves it as a spiral that winds from an
// OUTER radius (climb fraction u=0, the trailhead/base rim) to an INNER radius
// (u=1, the summit/plateau edge). The carved bench is the band within halfWidth
// of this centerline; both kinds share this so "a road that wraps a hill" is one
// formula, not two.
const SPIRAL_SAMPLE_COUNT = 480;
function spiralRadiusAtFraction(outerRadius: number, innerRadius: number, u: number): number {
  const clamped = Math.min(Math.max(u, 0), 1);
  return outerRadius - (outerRadius - innerRadius) * clamped;
}
function nearestSpiralFraction(
  localX: number,
  localZ: number,
  startAngle: number,
  turns: number,
  outerRadius: number,
  innerRadius: number,
): { u: number; dist: number } {
  let bestU = 0;
  let bestDistSq = Infinity;
  for (let s = 0; s <= SPIRAL_SAMPLE_COUNT; s += 1) {
    const u = s / SPIRAL_SAMPLE_COUNT;
    const radius = spiralRadiusAtFraction(outerRadius, innerRadius, u);
    const angle = startAngle + u * turns * Math.PI * 2;
    const dx = localX - Math.cos(angle) * radius;
    const dz = localZ - Math.sin(angle) * radius;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestU = u;
    }
  }
  return { u: bestU, dist: Math.sqrt(bestDistSq) };
}

// ── hills: rolling summed-cosine bumps faded to ground at the patch edge ──
const HILLS_BUMP_COUNT = 7;
function hillsRise(params: Record<string, number>, lx: number, lz: number): number {
  const hw = params.halfWidth;
  const amp = params.amplitude;
  const seed = params.seed;
  let rise = 0;
  for (let i = 0; i < HILLS_BUMP_COUNT; i += 1) {
    const angle = hash(seed + i * 1.7) * Math.PI * 2;
    const dist = (0.12 + 0.66 * hash(seed * 1.3 + i * 2.9)) * hw;
    const bumpX = Math.cos(angle) * dist;
    const bumpZ = Math.sin(angle) * dist;
    const bumpAmp = (0.45 + 0.55 * hash(seed * 0.7 + i * 4.1)) * amp;
    const bumpRadius = (0.5 + 0.35 * hash(seed * 1.9 + i * 5.3)) * hw;
    rise += bumpAmp * smoothBump(Math.hypot(lx - bumpX, lz - bumpZ) / bumpRadius);
  }
  const edge = Math.hypot(lx, lz) / hw;
  return rise * (1 - smoothstep(0.72, 1.0, edge));
}

registerLandformKind({
  kind: 'hills',
  defaults: { halfWidth: 55, amplitude: 13, seed: 7 },
  rise: hillsRise,
  footprintRadius: (p) => p.halfWidth,
  // Lenient — stroll up most of it; summed bumps steeper than this read as knolls
  // you walk around.
  walkCos: () => Math.cos((35 * Math.PI) / 180),
  resolution: 80,
  // Footing is sandy ('sand'); the VISUAL is the natural-terrain blend — golden
  // sand base with grass meadows + rock outcrops, tiled — so it reads as hills,
  // not one giant dune.
  surfaceTileKind: () => 'sand',
  surfaceStyle: () => 1,
});

// ── mountain: a truncated cone with a summit CRATER and a spiral hiking trail ──
// carved into the flank as a flat bench (the one walkable way up). Params:
//   baseRadius   — footprint radius (full height at the crater rim → 0 at base)
//   peak         — summit height above baseY
//   trailStartAngle — where on the rim the spiral begins
// The crater (rim/floor/depth) and the bench (turns/half-width) are fixed-shape
// constants; a fixed-turn spiral on a sharp point goes vertical near r→0, so the
// trail ends at the wide crater rim (not a point) to keep its final grade walkable.
const MOUNTAIN_CRATER_RIM_RADIUS_METERS = 22;
const MOUNTAIN_CRATER_FLOOR_RADIUS_METERS = 6;
const MOUNTAIN_CRATER_DEPTH_METERS = 6;
const MOUNTAIN_TRAIL_TURNS = 1.5;
const MOUNTAIN_TRAIL_HALF_WIDTH_METERS = 2.6;
// The cone faces sit ~37°; the bench is graded well under this so the limit turns
// the whole cone into a wall and leaves the bench the only ascent.
const MOUNTAIN_WALK_COS = Math.cos((24 * Math.PI) / 180);
// A wade-depth tarn sits in the crater (kept under the ~1.7 m player so the figure
// shows in it, and well under the crater depth so it's a pool, not a brim overflow).
const MOUNTAIN_CRATER_WATER_DEPTH_METERS = 1.5;

// Bare cone height at radius r: full height at the rim, a steep constant-slope
// face down to the base, and a gentle walkable crater bowl inside the rim.
function mountainConeRise(baseRadius: number, peak: number, r: number): number {
  if (r >= baseRadius) return 0;
  if (r > MOUNTAIN_CRATER_RIM_RADIUS_METERS) {
    return peak * ((baseRadius - r) / (baseRadius - MOUNTAIN_CRATER_RIM_RADIUS_METERS));
  }
  const floorRise = peak - MOUNTAIN_CRATER_DEPTH_METERS;
  if (r <= MOUNTAIN_CRATER_FLOOR_RADIUS_METERS) return floorRise;
  const wall = (r - MOUNTAIN_CRATER_FLOOR_RADIUS_METERS)
    / (MOUNTAIN_CRATER_RIM_RADIUS_METERS - MOUNTAIN_CRATER_FLOOR_RADIUS_METERS);
  return floorRise + MOUNTAIN_CRATER_DEPTH_METERS * wall;
}

// Nearest trail-bench point to a local (x,z): the spiral winds baseRadius → rim.
function mountainNearestTrail(params: Record<string, number>, lx: number, lz: number) {
  return nearestSpiralFraction(
    lx, lz, params.trailStartAngle, MOUNTAIN_TRAIL_TURNS, params.baseRadius, MOUNTAIN_CRATER_RIM_RADIUS_METERS,
  );
}

function mountainRise(params: Record<string, number>, lx: number, lz: number): number {
  const r = Math.hypot(lx, lz);
  if (r > params.baseRadius + MOUNTAIN_TRAIL_HALF_WIDTH_METERS) return 0;
  const near = mountainNearestTrail(params, lx, lz);
  // On the bench the surface is the spiral's height at the nearest centerline
  // point — flat across the path width, rising gently along it.
  if (near.dist <= MOUNTAIN_TRAIL_HALF_WIDTH_METERS) return params.peak * near.u;
  return mountainConeRise(params.baseRadius, params.peak, r);
}

registerLandformKind({
  kind: 'mountain',
  defaults: { baseRadius: 48, peak: 30, trailStartAngle: Math.PI / 2 },
  rise: mountainRise,
  footprintRadius: (p) => p.baseRadius,
  walkCos: () => MOUNTAIN_WALK_COS,
  resolution: 80,
  // Sandy/rocky footing off the trail; the bench reports packed-earth 'mud'.
  surfaceTileKind: () => 'sand',
  surfaceStyle: () => 2, // rock-dominant
  surfaceFootingAt: (p, lx, lz) =>
    mountainNearestTrail(p, lx, lz).dist <= MOUNTAIN_TRAIL_HALF_WIDTH_METERS ? 'mud' : undefined,
  submergedAt: (p, lx, lz, worldY, baseY) => {
    const r = Math.hypot(lx, lz);
    const fill = MOUNTAIN_CRATER_WATER_DEPTH_METERS / MOUNTAIN_CRATER_DEPTH_METERS;
    const waterRadius = MOUNTAIN_CRATER_FLOOR_RADIUS_METERS
      + fill * (MOUNTAIN_CRATER_RIM_RADIUS_METERS - MOUNTAIN_CRATER_FLOOR_RADIUS_METERS);
    const waterLevelY = baseY + (p.peak - MOUNTAIN_CRATER_DEPTH_METERS) + MOUNTAIN_CRATER_WATER_DEPTH_METERS;
    return r <= waterRadius && worldY < waterLevelY;
  },
});

// Crater-lake geometry for the render-side decoration (render3d/Landform.tsx): the
// still-water disc that fills the caldera. Pure data so the JSX-free rule holds.
export function mountainCraterLake(lf: Landform): { centerX: number; centerZ: number; level: number; radius: number } {
  const fill = MOUNTAIN_CRATER_WATER_DEPTH_METERS / MOUNTAIN_CRATER_DEPTH_METERS;
  return {
    centerX: lf.centerX,
    centerZ: lf.centerZ,
    level: lf.baseY + (lf.params.peak - MOUNTAIN_CRATER_DEPTH_METERS) + MOUNTAIN_CRATER_WATER_DEPTH_METERS,
    radius: MOUNTAIN_CRATER_FLOOR_RADIUS_METERS
      + fill * (MOUNTAIN_CRATER_RIM_RADIUS_METERS - MOUNTAIN_CRATER_FLOOR_RADIUS_METERS),
  };
}

// Trailhead point (spiral start, u=0 at the base rim) for the wv_mountain teleport
// and the minimap marker.
export function mountainTrailheadPoint(lf: Landform): { x: number; z: number; top: number } {
  const angle = lf.params.trailStartAngle;
  const radius = lf.params.baseRadius;
  return { x: lf.centerX + Math.cos(angle) * radius, z: lf.centerZ + Math.sin(angle) * radius, top: lf.baseY };
}

// ── estate: a flat-topped steep dome wrapped by a spiral ROAD ──
// Params: baseRadius, flatTopRadius (summit pad), height, roadStartAngle. The
// steep flanks are walls; the carved road bench is the walkable/drivable way up;
// the flat top is a building pad. The road shares the city's minimum profile so it
// reads as a street and could connect to one.
const ESTATE_ROAD_TURNS = 1.5;
const ESTATE_WALK_COS = Math.cos((26 * Math.PI) / 180);
// One car lane each way + the double-yellow, no bike/sidewalk — the minimum city
// profile, so the hill road and a street look the same and join cleanly. Exported
// for the road-ribbon decoration's cross-section texture (render3d/roadRibbon.ts).
export const LANDFORM_ROAD_PROFILE: RoadProfile = { lanesPerDirection: 1, hasBikeLane: false, hasSidewalks: false };
export function landformRoadHalfWidth(): number {
  return solveRoadCrossSection(LANDFORM_ROAD_PROFILE).totalWidthMeters / 2;
}

function estateDomeRise(params: Record<string, number>, r: number): number {
  if (r <= params.flatTopRadius) return params.height;
  if (r >= params.baseRadius) return 0;
  const t = (r - params.flatTopRadius) / (params.baseRadius - params.flatTopRadius);
  return params.height * smoothFalloff(t);
}

function estateNearestRoad(params: Record<string, number>, lx: number, lz: number) {
  return nearestSpiralFraction(
    lx, lz, params.roadStartAngle, ESTATE_ROAD_TURNS, params.baseRadius, params.flatTopRadius,
  );
}

function estateRise(params: Record<string, number>, lx: number, lz: number): number {
  const r = Math.hypot(lx, lz);
  if (r > params.baseRadius + landformRoadHalfWidth()) return 0;
  const near = estateNearestRoad(params, lx, lz);
  // On the road the surface is the dome height at the road's CENTERLINE radius —
  // flat across (a bench), gentle along (the spiral wraps slowly).
  if (near.dist <= landformRoadHalfWidth()) {
    return estateDomeRise(params, spiralRadiusAtFraction(params.baseRadius, params.flatTopRadius, near.u));
  }
  return estateDomeRise(params, r);
}

registerLandformKind({
  kind: 'estate',
  defaults: { baseRadius: 38, flatTopRadius: 13, height: 17, roadStartAngle: -Math.PI / 4 },
  rise: estateRise,
  footprintRadius: (p) => p.baseRadius,
  walkCos: () => ESTATE_WALK_COS,
  resolution: 80,
  // Soft lawn footing off the road; the road reports 'road' so it drives like a
  // street. (No 'grass' TileKind — 'sand' is the soft-ground stand-in.)
  surfaceTileKind: () => 'sand',
  surfaceStyle: () => 3, // manicured lawn
  surfaceFootingAt: (p, lx, lz) =>
    estateNearestRoad(p, lx, lz).dist <= landformRoadHalfWidth() ? 'road' : undefined,
});

// Estate road centerline as flattened x,y,z waypoints on the dome surface (lifted
// a hair to clear z-fighting) — fed to the road-ribbon mesh that drapes the real
// road texture over the hill. Pure data for the render-side decoration.
const ESTATE_ROAD_CENTERLINE_SAMPLES = 96;
const ESTATE_ROAD_RIBBON_LIFT_METERS = 0.06;
export function landformRoadCenterline(lf: Landform): number[] {
  const points: number[] = [];
  for (let s = 0; s <= ESTATE_ROAD_CENTERLINE_SAMPLES; s += 1) {
    const u = s / ESTATE_ROAD_CENTERLINE_SAMPLES;
    const radius = spiralRadiusAtFraction(lf.params.baseRadius, lf.params.flatTopRadius, u);
    const angle = lf.params.roadStartAngle + u * ESTATE_ROAD_TURNS * Math.PI * 2;
    points.push(
      lf.centerX + Math.cos(angle) * radius,
      lf.baseY + estateDomeRise(lf.params, radius) + ESTATE_ROAD_RIBBON_LIFT_METERS,
      lf.centerZ + Math.sin(angle) * radius,
    );
  }
  return points;
}

// ── heightfield: a freely PAINTED hill (hmsc-int's terrain brush) ──
// No formula — the shape rides in the landform's `field` grid, so `rise`
// bilinearly samples it. footprintRadius is the grid's inscribed half-extent.
//
// resolution is the RENDER/COLLIDE grid size, decoupled from the paint grid. The
// brush paints at DOTS_PER_TILE=2 (0.5 m samples), so a 120 m chunk's field is
// 241×241 — baking that 1:1 made one chunk a ~58k-vertex / 115k-triangle mesh that
// re-baked (mesh + collider) on every height stroke and dragged the preview down.
// The visible surface needs nothing like 0.5 m triangles, so we resample the field
// (bilinear, via `rise`) onto a ~2 m grid, capped so it never upsamples. Mesh and
// collider share `resolution`, so see-it==walk-it still holds at the coarser grid.
// 1 tile = 1 m.
const HEIGHTFIELD_DEFAULT_WALK_DEGREES = 38;
// Target render/collide vertex spacing for painted terrain (metres). A 120 m chunk
// resamples 241→61 samples per axis: ~3.7k verts vs ~58k, a ~16× cut.
const HEIGHTFIELD_RENDER_SPACING_METERS = 2;

function sampleHeightfield(field: LandformField | undefined, localX: number, localZ: number): number {
  if (!field) return 0;
  const { cols, rows, cell, heights } = field;
  // Grid is centred on the landform centre: sample (0,0) sits at the min corner.
  const fx = (localX + (cols - 1) * cell * 0.5) / cell;
  const fz = (localZ + (rows - 1) * cell * 0.5) / cell;
  if (fx < 0 || fz < 0 || fx > cols - 1 || fz > rows - 1) return 0;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const i1 = Math.min(i0 + 1, cols - 1);
  const j1 = Math.min(j0 + 1, rows - 1);
  const tx = fx - i0;
  const tz = fz - j0;
  const a = heights[j0 * cols + i0];
  const b = heights[j0 * cols + i1];
  const c = heights[j1 * cols + i0];
  const d = heights[j1 * cols + i1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

registerLandformKind({
  kind: 'heightfield',
  defaults: { walkDegrees: HEIGHTFIELD_DEFAULT_WALK_DEGREES },
  rise: (_p, localX, localZ, field) => sampleHeightfield(field, localX, localZ),
  footprintRadius: (_p, field) => (field ? (Math.max(field.cols, field.rows) - 1) * field.cell * 0.5 : 0),
  walkCos: (p) => Math.cos(((p.walkDegrees ?? HEIGHTFIELD_DEFAULT_WALK_DEGREES) * Math.PI) / 180),
  resolution: (field) => {
    if (!field) return 2;
    const spanMeters = (field.cols - 1) * field.cell;
    const samples = Math.round(spanMeters / HEIGHTFIELD_RENDER_SPACING_METERS) + 1;
    return Math.max(2, Math.min(field.cols, samples)); // never upsample past the paint grid
  },
  // Painted ground reads as the natural-terrain blend (sand base + grass + rock),
  // tiled like the hills, until per-cell tile drape lands. Soft 'sand' footing.
  surfaceTileKind: () => 'sand',
  surfaceStyle: () => 1,
});
