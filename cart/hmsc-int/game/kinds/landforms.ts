// game/kinds/landforms — THE landform registry: the terrain twin of the
// tile/prop/NPC tables. A placed landform is pure DATA ({ kind, center, baseY,
// params, field? }); its shape, footing, and decorations are resolved by `kind`
// through LANDFORM_KIND_DEFINITIONS, so every consumer (render, collider,
// camera, footing queries, seed) iterates ONE landform array and looks the
// kind up here. A new landform = one registerLandformKind call (a height
// function + a surface tile kind), ZERO new wiring. The framework knows zero
// landform names. 1 tile = 1 meter.
//
// THE TABLES ARE THE DATA (P2): a kind's height FUNCTION is its meaning (logic
// is allowed), but every fixed-shape NUMBER it reads — crater radii, trail
// turns, walk-slope limits, road width — lives in LANDFORM_TUNING, never
// buried in the formula.
//
// Fresh capture of cart/hmsc/world/landforms/{registry,kinds}.ts (behavior
// references only — see the capture note; the GameState-coupled queries and
// the terrain bake stay with their own systems). Consumers go through
// game/kinds/index.ts (P3).

import type { TileKind } from './tiles';

// ── instance data (what a PLACED landform carries) ───────────────────────────

// A baked height grid carried BY a landform (the 'heightfield' kind, painted in
// the editor). Most kinds are parametric — shape from a `rise` formula of
// `params` — but a freely painted hill has no formula, so its samples ride
// here: a cols×rows grid of meters-above-baseY, row-major, `cell` meters
// between samples, centred on the landform centre. The SAME field drives the
// mesh, collider, and queries (see-it == walk-it).
//
// `tiles` is the painted per-cell SURFACE on top of the height — a separate,
// finer grid of tile-kind indices (into TILE_KINDS, -1 = empty) draped over
// the relief as the mesh texture. Footing still resolves via surfaceTileKind.
export type LandformField = {
  cols: number;
  rows: number;
  cell: number;
  heights: number[];
  tiles?: { cols: number; rows: number; idx: number[] };
  // What GROWS over this landform — grass/palm/bush, a SEPARATE per-cell grid from
  // `tiles` (FLORADECOUPLE-0619). The population builders read this; the ground
  // formula reads `tiles`. Same cols/rows as `tiles`; idx into FLORA_KINDS, -1 none.
  flora?: { cols: number; rows: number; idx: number[] };
};

// The placed-landform instance the pure helpers below operate on. The full
// world-state type (ids, createdByCommand, …) belongs to the world system;
// the registry only needs the shape-determining slice.
export type LandformInstance = {
  kind: string;
  centerX: number;
  centerZ: number;
  baseY: number;
  params: Record<string, number>;
  field?: LandformField;
};

// ── the kind definition ──────────────────────────────────────────────────────

export type LandformKindDefinition = {
  kind: string;
  // Per-instance knob defaults (radius, height, seed, …). An instance's
  // `params` spread over these.
  defaults: Record<string, number>;
  // Height above baseY at LOCAL (x,z) relative to the landform center — the
  // height function (cone, dome, bumps, …). The only thing that really differs
  // per kind. `field` is the instance's optional baked grid; parametric kinds
  // ignore it, the painted 'heightfield' kind bilinearly samples it.
  rise: (params: Record<string, number>, localX: number, localZ: number, field?: LandformField) => number;
  // Bounding footprint radius (bake half-width, culling, query early-outs). A
  // field-backed kind derives it from the grid extent.
  footprintRadius: (params: Record<string, number>, field?: LandformField) => number;
  // cos(slope limit): surfaces flatter than this are walkable, steeper are walls.
  walkCos: (params: Record<string, number>) => number;
  // Mesh + collider grid resolution (cols == rows). A constant for parametric
  // kinds; a field-backed kind returns its grid's column count so the bake
  // samples grid points exactly (no resampling blur).
  resolution: number | ((field?: LandformField) => number);
  // The surface's tile material — tiled across the surface by world-XZ and the
  // footing the player reads on it.
  surfaceTileKind: (params: Record<string, number>) => TileKind;
  // How the surface is painted (render-only; footing stays surfaceTileKind):
  //   0 = plain tiled tile-material (default)
  //   1 = natural terrain blend — sand base + grass patches + rock outcrops
  //   2 = rock-dominant (mountain flank)
  //   3 = manicured lawn (estate dome)
  surfaceStyle?: (params: Record<string, number>) => number;
  // Footing override for a sub-region (the carved trail on a mountain, the
  // road on an estate): returns the footing tile when (localX, localZ) lies on
  // that region, else undefined to fall back to surfaceTileKind. This is how
  // one landform carries two footings without every kind being position-aware.
  surfaceFootingAt?: (params: Record<string, number>, localX: number, localZ: number) => TileKind | undefined;
  // Whether a point is submerged in this landform's standing water (a crater
  // lake), given world Y and the landform's baseY. Omitted = no water.
  submergedAt?: (params: Record<string, number>, localX: number, localZ: number, worldY: number, baseY: number) => boolean;
};

// ── fixed-shape tuning (P2: numbers live HERE, formulas read them) ───────────

export const LANDFORM_TUNING = {
  // Shared spiral carve — the mountain trail and the estate road both wind a
  // flat bench from an OUTER radius (u=0, the trailhead/base rim) to an INNER
  // radius (u=1, the summit/plateau edge); "a road that wraps a hill" is one
  // formula, not two.
  spiral: {
    sampleCount: 480,
  },
  hills: {
    bumpCount: 7,
    // Bump placement/size as fractions of the patch (halfWidth / amplitude).
    bumpMinDistFrac: 0.12,
    bumpDistSpreadFrac: 0.66,
    bumpMinAmpFrac: 0.45,
    bumpAmpSpreadFrac: 0.55,
    bumpMinRadiusFrac: 0.5,
    bumpRadiusSpreadFrac: 0.35,
    // Rolling bumps fade to flat ground across this edge band of the patch.
    edgeFadeStartFrac: 0.72,
    edgeFadeEndFrac: 1.0,
    // Lenient — stroll up most of it; bumps steeper than this read as knolls
    // you walk around.
    walkDegrees: 35,
    meshResolution: 80,
  },
  mountain: {
    // The summit crater: a wide rim, a flat floor, and the bowl between them.
    // A fixed-turn spiral on a sharp point goes vertical near r→0, so the
    // trail ends at the WIDE crater rim (not a point) to keep its final grade
    // walkable.
    craterRimRadiusMeters: 22,
    craterFloorRadiusMeters: 6,
    craterDepthMeters: 6,
    trailTurns: 1.5,
    trailHalfWidthMeters: 2.6,
    // The cone faces sit ~37°; the bench is graded well under this so the
    // limit turns the whole cone into a wall and leaves the bench the only
    // ascent.
    walkDegrees: 24,
    // A wade-depth tarn in the crater (under the ~1.7m player so the figure
    // shows in it, and well under the crater depth so it is a pool, not a brim
    // overflow).
    craterWaterDepthMeters: 1.5,
    meshResolution: 80,
  },
  estate: {
    roadTurns: 1.5,
    walkDegrees: 26,
    // One car lane each way + the double-yellow, no bike/sidewalk — the city's
    // MINIMUM road profile, so the hill road and a street look the same and
    // join cleanly. The half-width is that profile's curb-to-curb width / 2
    // (2 × one 3.5m car lane → 7m total → 3.5m half).
    roadProfile: { lanesPerDirection: 1, hasBikeLane: false, hasSidewalks: false },
    roadHalfWidthMeters: 3.5,
    // Road-ribbon decoration sampling (render-side mesh drapes the road
    // texture over the dome along this centerline).
    roadCenterlineSamples: 96,
    roadRibbonLiftMeters: 0.06,
    meshResolution: 80,
  },
  heightfield: {
    defaultWalkDegrees: 38,
  },
} as const;

// ── the registry ─────────────────────────────────────────────────────────────

export const LANDFORM_KIND_DEFINITIONS: Record<string, LandformKindDefinition> = {};

export function registerLandformKind(def: LandformKindDefinition): void {
  LANDFORM_KIND_DEFINITIONS[def.kind] = def;
}

export function landformKindDefinition(kind: string): LandformKindDefinition | undefined {
  return LANDFORM_KIND_DEFINITIONS[kind];
}

export function landformKindNamesForConsole(): string {
  return Object.keys(LANDFORM_KIND_DEFINITIONS).join(', ');
}

// World-space surface height under a point (raw mesh surface, any slope) — the
// one pure query every consumer shares.
export function landformSurfaceTop(lf: LandformInstance, x: number, z: number): number {
  const def = LANDFORM_KIND_DEFINITIONS[lf.kind];
  if (!def) return lf.baseY;
  return lf.baseY + def.rise(lf.params, x - lf.centerX, z - lf.centerZ, lf.field);
}

// ── shared math ──────────────────────────────────────────────────────────────

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

function degreesToCos(degrees: number): number {
  return Math.cos((degrees * Math.PI) / 180);
}

// ── the shared spiral carve ──────────────────────────────────────────────────

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
  const samples = LANDFORM_TUNING.spiral.sampleCount;
  let bestU = 0;
  let bestDistSq = Infinity;
  for (let s = 0; s <= samples; s += 1) {
    const u = s / samples;
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

// ── hills: rolling summed-cosine bumps faded to ground at the patch edge ─────

function hillsRise(params: Record<string, number>, lx: number, lz: number): number {
  const T = LANDFORM_TUNING.hills;
  const hw = params.halfWidth;
  const amp = params.amplitude;
  const seed = params.seed;
  let rise = 0;
  for (let i = 0; i < T.bumpCount; i += 1) {
    const angle = hash(seed + i * 1.7) * Math.PI * 2;
    const dist = (T.bumpMinDistFrac + T.bumpDistSpreadFrac * hash(seed * 1.3 + i * 2.9)) * hw;
    const bumpX = Math.cos(angle) * dist;
    const bumpZ = Math.sin(angle) * dist;
    const bumpAmp = (T.bumpMinAmpFrac + T.bumpAmpSpreadFrac * hash(seed * 0.7 + i * 4.1)) * amp;
    const bumpRadius = (T.bumpMinRadiusFrac + T.bumpRadiusSpreadFrac * hash(seed * 1.9 + i * 5.3)) * hw;
    rise += bumpAmp * smoothBump(Math.hypot(lx - bumpX, lz - bumpZ) / bumpRadius);
  }
  const edge = Math.hypot(lx, lz) / hw;
  return rise * (1 - smoothstep(T.edgeFadeStartFrac, T.edgeFadeEndFrac, edge));
}

registerLandformKind({
  kind: 'hills',
  defaults: { halfWidth: 55, amplitude: 13, seed: 7 },
  rise: hillsRise,
  footprintRadius: (p) => p.halfWidth,
  walkCos: () => degreesToCos(LANDFORM_TUNING.hills.walkDegrees),
  resolution: LANDFORM_TUNING.hills.meshResolution,
  // Footing is sandy ('sand' — no grass TileKind; sand is the soft-ground
  // stand-in); the VISUAL is the natural-terrain blend so it reads as hills,
  // not one giant dune.
  surfaceTileKind: () => 'sand',
  surfaceStyle: () => 1,
});

// ── mountain: a truncated cone with a summit CRATER and a spiral hiking trail
// carved into the flank as a flat bench (the one walkable way up) ─────────────
// Params: baseRadius (footprint), peak (summit height above baseY),
// trailStartAngle (where on the rim the spiral begins).

// Bare cone height at radius r: full height at the rim, a steep constant-slope
// face down to the base, and a gentle walkable crater bowl inside the rim.
function mountainConeRise(baseRadius: number, peak: number, r: number): number {
  const T = LANDFORM_TUNING.mountain;
  if (r >= baseRadius) return 0;
  if (r > T.craterRimRadiusMeters) {
    return peak * ((baseRadius - r) / (baseRadius - T.craterRimRadiusMeters));
  }
  const floorRise = peak - T.craterDepthMeters;
  if (r <= T.craterFloorRadiusMeters) return floorRise;
  const wall = (r - T.craterFloorRadiusMeters) / (T.craterRimRadiusMeters - T.craterFloorRadiusMeters);
  return floorRise + T.craterDepthMeters * wall;
}

// Nearest trail-bench point to a local (x,z): the spiral winds baseRadius → rim.
function mountainNearestTrail(params: Record<string, number>, lx: number, lz: number) {
  const T = LANDFORM_TUNING.mountain;
  return nearestSpiralFraction(lx, lz, params.trailStartAngle, T.trailTurns, params.baseRadius, T.craterRimRadiusMeters);
}

function mountainRise(params: Record<string, number>, lx: number, lz: number): number {
  const T = LANDFORM_TUNING.mountain;
  const r = Math.hypot(lx, lz);
  if (r > params.baseRadius + T.trailHalfWidthMeters) return 0;
  const near = mountainNearestTrail(params, lx, lz);
  // On the bench the surface is the spiral's height at the nearest centerline
  // point — flat across the path width, rising gently along it.
  if (near.dist <= T.trailHalfWidthMeters) return params.peak * near.u;
  return mountainConeRise(params.baseRadius, params.peak, r);
}

registerLandformKind({
  kind: 'mountain',
  defaults: { baseRadius: 48, peak: 30, trailStartAngle: Math.PI / 2 },
  rise: mountainRise,
  footprintRadius: (p) => p.baseRadius,
  walkCos: () => degreesToCos(LANDFORM_TUNING.mountain.walkDegrees),
  resolution: LANDFORM_TUNING.mountain.meshResolution,
  // Sandy/rocky footing off the trail; the bench reports packed-earth 'mud'.
  surfaceTileKind: () => 'sand',
  surfaceStyle: () => 2, // rock-dominant
  surfaceFootingAt: (p, lx, lz) =>
    mountainNearestTrail(p, lx, lz).dist <= LANDFORM_TUNING.mountain.trailHalfWidthMeters ? 'mud' : undefined,
  submergedAt: (p, lx, lz, worldY, baseY) => {
    const T = LANDFORM_TUNING.mountain;
    const r = Math.hypot(lx, lz);
    const fill = T.craterWaterDepthMeters / T.craterDepthMeters;
    const waterRadius = T.craterFloorRadiusMeters + fill * (T.craterRimRadiusMeters - T.craterFloorRadiusMeters);
    const waterLevelY = baseY + (p.peak - T.craterDepthMeters) + T.craterWaterDepthMeters;
    return r <= waterRadius && worldY < waterLevelY;
  },
});

// Crater-lake geometry for the render-side decoration: the still-water disc
// that fills the caldera. Pure data so the JSX-free rule holds.
export function mountainCraterLake(lf: LandformInstance): { centerX: number; centerZ: number; level: number; radius: number } {
  const T = LANDFORM_TUNING.mountain;
  const fill = T.craterWaterDepthMeters / T.craterDepthMeters;
  return {
    centerX: lf.centerX,
    centerZ: lf.centerZ,
    level: lf.baseY + (lf.params.peak - T.craterDepthMeters) + T.craterWaterDepthMeters,
    radius: T.craterFloorRadiusMeters + fill * (T.craterRimRadiusMeters - T.craterFloorRadiusMeters),
  };
}

// Trailhead point (spiral start, u=0 at the base rim) for teleports and the
// minimap marker.
export function mountainTrailheadPoint(lf: LandformInstance): { x: number; z: number; top: number } {
  const angle = lf.params.trailStartAngle;
  const radius = lf.params.baseRadius;
  return { x: lf.centerX + Math.cos(angle) * radius, z: lf.centerZ + Math.sin(angle) * radius, top: lf.baseY };
}

// ── estate: a flat-topped steep dome wrapped by a spiral ROAD ────────────────
// Params: baseRadius, flatTopRadius (summit pad), height, roadStartAngle. The
// steep flanks are walls; the carved road bench is the walkable/drivable way
// up; the flat top is a building pad.

export function landformRoadHalfWidth(): number {
  return LANDFORM_TUNING.estate.roadHalfWidthMeters;
}

function estateDomeRise(params: Record<string, number>, r: number): number {
  if (r <= params.flatTopRadius) return params.height;
  if (r >= params.baseRadius) return 0;
  const t = (r - params.flatTopRadius) / (params.baseRadius - params.flatTopRadius);
  return params.height * smoothFalloff(t);
}

function estateNearestRoad(params: Record<string, number>, lx: number, lz: number) {
  return nearestSpiralFraction(
    lx, lz, params.roadStartAngle, LANDFORM_TUNING.estate.roadTurns, params.baseRadius, params.flatTopRadius,
  );
}

function estateRise(params: Record<string, number>, lx: number, lz: number): number {
  const r = Math.hypot(lx, lz);
  if (r > params.baseRadius + landformRoadHalfWidth()) return 0;
  const near = estateNearestRoad(params, lx, lz);
  // On the road the surface is the dome height at the road's CENTERLINE radius
  // — flat across (a bench), gentle along (the spiral wraps slowly).
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
  walkCos: () => degreesToCos(LANDFORM_TUNING.estate.walkDegrees),
  resolution: LANDFORM_TUNING.estate.meshResolution,
  // Soft lawn footing off the road; the road reports 'road' so it drives like
  // a street.
  surfaceTileKind: () => 'sand',
  surfaceStyle: () => 3, // manicured lawn
  surfaceFootingAt: (p, lx, lz) =>
    estateNearestRoad(p, lx, lz).dist <= landformRoadHalfWidth() ? 'road' : undefined,
});

// Estate road centerline as flattened x,y,z waypoints on the dome surface
// (lifted a hair to clear z-fighting) — fed to the road-ribbon mesh that
// drapes the real road texture over the hill. Pure data for the render side.
export function landformRoadCenterline(lf: LandformInstance): number[] {
  const T = LANDFORM_TUNING.estate;
  const points: number[] = [];
  for (let s = 0; s <= T.roadCenterlineSamples; s += 1) {
    const u = s / T.roadCenterlineSamples;
    const radius = spiralRadiusAtFraction(lf.params.baseRadius, lf.params.flatTopRadius, u);
    const angle = lf.params.roadStartAngle + u * T.roadTurns * Math.PI * 2;
    points.push(
      lf.centerX + Math.cos(angle) * radius,
      lf.baseY + estateDomeRise(lf.params, radius) + T.roadRibbonLiftMeters,
      lf.centerZ + Math.sin(angle) * radius,
    );
  }
  return points;
}

// ── heightfield: a freely PAINTED hill (the editor's terrain brush) ──────────
// No formula — the shape rides in the instance's `field` grid, so `rise`
// bilinearly samples it. footprintRadius is the grid's inscribed half-extent,
// and resolution = the field's own column count, so the render mesh AND
// collider bake the authored grid 1:1 (no resampling — re-coarsening destroys
// authored tiles). Mesh == collider == field: see-it == walk-it.

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
  defaults: { walkDegrees: LANDFORM_TUNING.heightfield.defaultWalkDegrees },
  rise: (_p, localX, localZ, field) => sampleHeightfield(field, localX, localZ),
  footprintRadius: (_p, field) => (field ? (Math.max(field.cols, field.rows) - 1) * field.cell * 0.5 : 0),
  walkCos: (p) => degreesToCos(p.walkDegrees ?? LANDFORM_TUNING.heightfield.defaultWalkDegrees),
  resolution: (field) => (field ? field.cols : 2),
  // Painted ground reads as the natural-terrain blend until per-cell tile
  // drape applies. Soft 'sand' footing.
  surfaceTileKind: () => 'sand',
  surfaceStyle: () => 1,
});

export const LANDFORM_KINDS = Object.keys(LANDFORM_KIND_DEFINITIONS);
