// mapReport.ts — the / dashboard's SPATIAL census (req_1875). Companion to
// editors/model/geometryReport.ts (the geometry census): that one answers "how
// much was modeled", this one answers "how big is the world, how full is it, and
// how long would it take to walk across".
//
// Pure + parameterized: unlike the geometry census (which reads the global asset
// stores), a map's chunks + placements are MAP-scoped state, so the dashboard
// feeds them in (from the live editor or a persisted map payload). No store reads,
// no allocation beyond the result — trivially cheap, honors the freeze law
// (req_1872), and is unit-testable without a host.
//
// Units: 1 tile = 1 meter (HMSC_SCALE); a chunk is CHUNK_TILES (120) tiles square
// = 120 m × 120 m = 14,400 m². Placement + building footprints carry footW/footD
// in tiles, i.e. meters, so their area is just footW × footD.

import { CHUNK_TILES } from './chunks';
import {
  DEFAULT_PLAYER_WALK_SPEED_METERS_PER_SECOND,
  DEFAULT_PLAYER_RUN_SPEED_METERS_PER_SECOND,
} from './state/defaults';

/** Anything with a tile footprint — Placement and MapBuildFootprint both match. */
export type FootprintLike = { footW: number; footD: number };
/** Anything with a chunk coordinate — ChunkFloor matches. */
export type ChunkCoord = { cx: number; cz: number };

/** The closest real-world area the map is sized like (for the "≈ 1.3× a soccer
 *  pitch" line). `ratio` = mapArea / landmarkArea. */
export type Landmark = { name: string; areaM2: number; ratio: number };

export type MapFootprintReport = {
  /** painted chunks. */
  chunks: number;
  /** bounding-box extent of the painted chunks, in meters. */
  widthMeters: number;
  depthMeters: number;
  /** width × depth — the rectangle the map lives inside. */
  extentAreaM2: number;
  /** actual authored ground = painted chunks × chunk area (sparse: ≤ extent). */
  groundAreaM2: number;
  /** groundArea / extentArea — how densely the bounding box is filled (1 = solid). */
  paintedFraction: number;
  /** how many footprints were counted. */
  assetCount: number;
  /** summed footprint area of every placement + building. */
  assetAreaM2: number;
  /** assetArea / groundArea, clamped to [0,1] — "how much is covered in stuff". */
  coverageFraction: number;
  /** groundArea − assetArea, floored at 0 — the walkable open space. */
  openAreaM2: number;
  walkSpeedMps: number;
  runSpeedMps: number;
  /** corner-to-corner of the extent — "one end to the other". */
  diagonalMeters: number;
  /** seconds to cross the diagonal at walk / run speed. */
  walkSecondsAcross: number;
  runSecondsAcross: number;
  /** closest real-world size comparison, or null when the map is empty. */
  landmark: Landmark | null;
};

// A curated ladder of real-world areas (m²), tiny → city-scale, so SOME landmark
// is always within an order of magnitude of the map. Reference facts, not game
// tunables — fine as a module const.
const LANDMARKS: ReadonlyArray<{ name: string; areaM2: number }> = [
  { name: 'a tennis court', areaM2: 261 },
  { name: 'a basketball court', areaM2: 437 },
  { name: 'an American football field', areaM2: 5351 },
  { name: 'a FIFA soccer pitch', areaM2: 7140 },
  { name: 'a Walmart Supercenter', areaM2: 17000 },
  { name: "the Pentagon's footprint", areaM2: 117000 },
  { name: 'Vatican City', areaM2: 440000 },
  { name: 'Monaco', areaM2: 2020000 },
  { name: 'Central Park', areaM2: 3410000 },
  { name: 'Manhattan', areaM2: 59100000 },
  { name: 'San Francisco', areaM2: 121400000 },
];

/** Pick the landmark closest in MULTIPLICATIVE terms (so "2× a pitch" beats
 *  "0.001× Central Park"). Null for a zero-area map. */
function closestLandmark(areaM2: number): Landmark | null {
  if (areaM2 <= 0) return null;
  let best = LANDMARKS[0];
  let bestDist = Infinity;
  for (const lm of LANDMARKS) {
    const dist = Math.abs(Math.log(areaM2 / lm.areaM2));
    if (dist < bestDist) { bestDist = dist; best = lm; }
  }
  return { name: best.name, areaM2: best.areaM2, ratio: areaM2 / best.areaM2 };
}

export type MapFootprintInput = {
  /** the map's painted chunks (only cx/cz are read). */
  chunks: ReadonlyArray<ChunkCoord>;
  /** every placement + building footprint (footW/footD in tiles = meters). */
  footprints?: ReadonlyArray<FootprintLike>;
  /** override the player speeds (default to the registered state defaults). */
  walkSpeedMps?: number;
  runSpeedMps?: number;
};

const EMPTY: MapFootprintReport = {
  chunks: 0, widthMeters: 0, depthMeters: 0, extentAreaM2: 0, groundAreaM2: 0,
  paintedFraction: 0, assetCount: 0, assetAreaM2: 0, coverageFraction: 0, openAreaM2: 0,
  walkSpeedMps: DEFAULT_PLAYER_WALK_SPEED_METERS_PER_SECOND,
  runSpeedMps: DEFAULT_PLAYER_RUN_SPEED_METERS_PER_SECOND,
  diagonalMeters: 0, walkSecondsAcross: 0, runSecondsAcross: 0, landmark: null,
};

/**
 * Census a map's spatial footprint: extent, density, asset coverage vs open
 * space, and how long it takes to walk/run from corner to corner.
 */
export function reportMapFootprint(input: MapFootprintInput): MapFootprintReport {
  const walkSpeedMps = input.walkSpeedMps ?? DEFAULT_PLAYER_WALK_SPEED_METERS_PER_SECOND;
  const runSpeedMps = input.runSpeedMps ?? DEFAULT_PLAYER_RUN_SPEED_METERS_PER_SECOND;
  const chunks = input.chunks;
  if (chunks.length === 0) return { ...EMPTY, walkSpeedMps, runSpeedMps };

  let minCx = Infinity, maxCx = -Infinity, minCz = Infinity, maxCz = -Infinity;
  for (const c of chunks) {
    if (c.cx < minCx) minCx = c.cx;
    if (c.cx > maxCx) maxCx = c.cx;
    if (c.cz < minCz) minCz = c.cz;
    if (c.cz > maxCz) maxCz = c.cz;
  }
  const widthMeters = (maxCx - minCx + 1) * CHUNK_TILES;
  const depthMeters = (maxCz - minCz + 1) * CHUNK_TILES;
  const extentAreaM2 = widthMeters * depthMeters;
  const chunkAreaM2 = CHUNK_TILES * CHUNK_TILES;
  const groundAreaM2 = chunks.length * chunkAreaM2;

  let assetAreaM2 = 0;
  const footprints = input.footprints ?? [];
  for (const f of footprints) assetAreaM2 += f.footW * f.footD;

  const coverageFraction = groundAreaM2 > 0 ? Math.min(1, assetAreaM2 / groundAreaM2) : 0;
  const diagonalMeters = Math.sqrt(widthMeters * widthMeters + depthMeters * depthMeters);

  return {
    chunks: chunks.length,
    widthMeters,
    depthMeters,
    extentAreaM2,
    groundAreaM2,
    paintedFraction: extentAreaM2 > 0 ? groundAreaM2 / extentAreaM2 : 0,
    assetCount: footprints.length,
    assetAreaM2,
    coverageFraction,
    openAreaM2: Math.max(0, groundAreaM2 - assetAreaM2),
    walkSpeedMps,
    runSpeedMps,
    diagonalMeters,
    walkSecondsAcross: walkSpeedMps > 0 ? diagonalMeters / walkSpeedMps : 0,
    runSecondsAcross: runSpeedMps > 0 ? diagonalMeters / runSpeedMps : 0,
    landmark: closestLandmark(extentAreaM2),
  };
}
