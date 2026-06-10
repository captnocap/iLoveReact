// roadData.ts — ROAD STROKES: the authored road objects and the pure planner
// that compiles them to tile-kind stamps (ROADSTROKE-0610).
//
// A road is authored as a STROKE — a centerline polyline + a cross-section
// profile — never tile by tile (V24's law applied to roads: the 1m grid is the
// snap substrate, not the authored object model). Everything the locked road
// grammar needs derives from the stroke:
//
//   • lane DIRECTION falls out of the order you drew the points — the compass
//     kinds (laneNorth/...) are wire format the planner emits, never something
//     a human picks from a palette;
//   • lane WIDTH is the user-ruled 3 tiles (2026-06-10, supersedes the 2-tile
//     musing in req_0385); a two-way road adds a 1-tile median between the
//     opposing groups; sidewalks add 2 tiles per side (the locked double ring);
//   • RIGHT-HAND traffic: forward lanes sit on the RIGHT of the centerline
//     relative to travel, opposing lanes on the left;
//   • JUNCTIONS are not authored: where two strokes' carriageways overlap, the
//     overlap box becomes flow-neutral 'junction' tiles, and 2-deep 'crosswalk'
//     bands stamp across each leg just outside the box (the locked zebra rule);
//   • ONE-WAY roads are a profile choice (a side with 0 lanes); the whole
//     carriageway then centres on the stroke with no median.
//
// planRoads() is PURE — strokes in, Map<cellKey, TileKind> out — so the tile
// compiler is testable with zero editor or GPU machinery (roadData.test.ts).
// The editor (PaintCanvas) applies the plan destructively to the chunk tile
// grids, recording an UNDERCOAT (cell → previous index) so editing or deleting
// a stroke restores the paint beneath. The grid stays the single runtime truth
// ("the tile system IS the system"); strokes are authoring metadata that ride
// the map snapshot beside it.

import type { TileKind } from '../hmsc/design';

// ── the authored objects ─────────────────────────────────────────────────────

export interface RoadProfile {
  /** Lanes flowing WITH the stroke direction (the right side). 0 disables the side. */
  lanesF: number;
  /** Opposing lanes (the left side). 0 = a one-way road. */
  lanesB: number;
  /** The locked 2-tile sidewalk ring on both outer edges. */
  sidewalks: boolean;
  /** Speed limit in km/h (ROADSPEED-0610, req_0554: city vs rural). The
   *  STROKE is the carrier — stamped tiles are shared kinds and cannot hold
   *  it. Optional so pre-speed strokes stay valid; clampProfile normalizes
   *  absent → the city preset. */
  speedLimitKph?: number;
}

/** Global integer cell coords — the SelCell convention (chunk cx covers gx ∈ [cx·120, cx·120+119]). */
export interface RoadPoint {
  gx: number;
  gz: number;
}

export interface RoadStroke {
  id: string;
  points: RoadPoint[];
  profile: RoadProfile;
}

// ── the ruled constants ──────────────────────────────────────────────────────

/** USER-RULED 2026-06-10: a driving lane is 3 tiles wide (matches the 3.5m real lane and the 3-tile floor plate). */
export const LANE_TILES = 3;
/** The locked sidewalk ring is 2 tiles. */
export const SIDEWALK_TILES = 2;
/** The zebra band reaches 2 cells into each leg, just outside the junction box. */
export const CROSSWALK_DEPTH = 2;

export const MAX_LANES_PER_SIDE = 3;

/** Speed presets (ROADSPEED-0610): pick one in the rail, tune per stroke. */
export const ROAD_SPEED_PRESETS = { city: 50, rural: 90 } as const;
export const SPEED_LIMIT_MIN_KPH = 10;
export const SPEED_LIMIT_MAX_KPH = 130;

function clampSpeedLimit(kph: number | undefined): number {
  const v = Number.isFinite(kph) ? Math.round(kph! / 5) * 5 : ROAD_SPEED_PRESETS.city;
  return Math.max(SPEED_LIMIT_MIN_KPH, Math.min(SPEED_LIMIT_MAX_KPH, v));
}

export function clampProfile(p: RoadProfile): RoadProfile {
  const lanesF = Math.max(0, Math.min(MAX_LANES_PER_SIDE, Math.round(p.lanesF)));
  const lanesB = Math.max(0, Math.min(MAX_LANES_PER_SIDE, Math.round(p.lanesB)));
  const speedLimitKph = clampSpeedLimit(p.speedLimitKph);
  // A road with no lanes at all is not a road; keep one forward lane.
  if (lanesF === 0 && lanesB === 0) return { lanesF: 1, lanesB: 0, sidewalks: !!p.sidewalks, speedLimitKph };
  return { lanesF, lanesB, sidewalks: !!p.sidewalks, speedLimitKph };
}

/** The clamped limit in m/s — what motion planning consumes. */
export function speedLimitMps(p: RoadProfile): number {
  return clampSpeedLimit(p.speedLimitKph) / 3.6;
}

export function isOneWay(p: RoadProfile): boolean {
  return p.lanesF === 0 || p.lanesB === 0;
}

/** Carriageway width in tiles (lanes + median; no sidewalks). */
export function carriagewayTiles(p: RoadProfile): number {
  const median = p.lanesF > 0 && p.lanesB > 0 ? 1 : 0;
  return LANE_TILES * (p.lanesF + p.lanesB) + median;
}

/** Full stamped width in tiles, curb to curb including sidewalks. */
export function roadWidthTiles(p: RoadProfile): number {
  return carriagewayTiles(p) + (p.sidewalks ? 2 * SIDEWALK_TILES : 0);
}

// ── the plan ─────────────────────────────────────────────────────────────────

export type RoadPlan = Map<string, TileKind>;

export const cellKey = (gx: number, gz: number): string => `${gx},${gz}`;

export function parseCellKey(key: string): RoadPoint {
  const i = key.indexOf(',');
  return { gx: Number(key.slice(0, i)), gz: Number(key.slice(i + 1)) };
}

// Compass step vectors in cell space (+z is south; north = -z, the hmsc facing
// convention) and the lane kind each travel direction emits.
type Dir = { dx: number; dz: number };

function laneKindFor(dir: Dir): TileKind {
  if (dir.dx > 0) return 'laneEast';
  if (dir.dx < 0) return 'laneWest';
  if (dir.dz > 0) return 'laneSouth';
  return 'laneNorth';
}

// Quantize a segment to its dominant compass axis. Diagonal segments staircase
// cell-wise but their lanes flow the dominant direction.
function segmentDir(a: RoadPoint, b: RoadPoint): Dir | null {
  const dx = b.gx - a.gx;
  const dz = b.gz - a.gz;
  if (dx === 0 && dz === 0) return null;
  if (Math.abs(dx) >= Math.abs(dz)) return { dx: Math.sign(dx), dz: 0 };
  return { dx: 0, dz: Math.sign(dz) };
}

// The RIGHT of travel in cell space (+z south): driving east (1,0) your right
// hand points south (0,1); driving north (0,-1) it points east (1,0).
function rightOf(dir: Dir): Dir {
  return { dx: -dir.dz, dz: dir.dx };
}

// A centerline cell with the travel direction through it.
type CenterCell = { gx: number; gz: number; dir: Dir };

// ── corner fillets (ROADCURVE-0610) ─────────────────────────────────────────
// Authored points stay the editable wire; CURVES are derived. Every interior
// vertex becomes a quadratic-bezier arc (radius clamped to half its shorter
// neighbour segment), and BOTH the tile stamp and the analytic ribbon render
// rasterize the same filleted polyline — what you stamp is what you see.

export const ROAD_FILLET_TILES = 5;

export function filletPoints(points: RoadPoint[], radius: number): RoadPoint[] {
  if (points.length < 3 || radius <= 0) return points;
  const out: RoadPoint[] = [points[0]!];
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i - 1]!, v = points[i]!, b = points[i + 1]!;
    const d1 = Math.hypot(v.gx - a.gx, v.gz - a.gz);
    const d2 = Math.hypot(b.gx - v.gx, b.gz - v.gz);
    const r = Math.min(radius, d1 * 0.45, d2 * 0.45);
    if (r < 0.75 || d1 === 0 || d2 === 0) { out.push(v); continue; }
    const u1 = { x: (v.gx - a.gx) / d1, z: (v.gz - a.gz) / d1 };
    const u2 = { x: (b.gx - v.gx) / d2, z: (b.gz - v.gz) / d2 };
    if (u1.x * u2.x + u1.z * u2.z > 0.985) { out.push(v); continue; } // straight-through
    const p1 = { gx: v.gx - u1.x * r, gz: v.gz - u1.z * r };
    const p2 = { gx: v.gx + u2.x * r, gz: v.gz + u2.z * r };
    const samples = Math.max(4, Math.ceil(r * 1.5));
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const omt = 1 - t;
      out.push({
        gx: omt * omt * p1.gx + 2 * omt * t * v.gx + t * t * p2.gx,
        gz: omt * omt * p1.gz + 2 * omt * t * v.gz + t * t * p2.gz,
      });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

// Rasterize the polyline to ordered, deduped centerline cells. Sampling at
// quarter-cell steps guarantees 8-connected coverage on any diagonal.
export function rasterizeCenterline(points: RoadPoint[]): CenterCell[] {
  const out: CenterCell[] = [];
  const seen = new Set<string>();
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dir = segmentDir(a, b);
    if (!dir) continue;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.gx - a.gx), Math.abs(b.gz - a.gz)) * 4));
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.max(1, steps);
      const gx = Math.round(a.gx + (b.gx - a.gx) * t);
      const gz = Math.round(a.gz + (b.gz - a.gz) * t);
      const k = cellKey(gx, gz);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ gx, gz, dir });
    }
  }
  return out;
}

// Cross-section column offsets for one stroke, by what they stamp. Offsets are
// multiples of the RIGHT vector: positive = right of travel (forward lanes,
// right-hand traffic), negative = left (opposing lanes).
type CrossSection = {
  /** offset → lane kind resolver (depends on travel dir), or 'median' */
  carriage: { off: number; kind: 'median' | 'forward' | 'backward' }[];
  walk: number[]; // sidewalk offsets
};

export function crossSection(profile: RoadProfile): CrossSection {
  const p = clampProfile(profile);
  const carriage: CrossSection['carriage'] = [];
  let left: number;
  let right: number;
  if (p.lanesF > 0 && p.lanesB > 0) {
    // Two-way: median on the stroke, forward group right, opposing group left.
    carriage.push({ off: 0, kind: 'median' });
    right = LANE_TILES * p.lanesF;
    left = -LANE_TILES * p.lanesB;
    for (let o = 1; o <= right; o++) carriage.push({ off: o, kind: 'forward' });
    for (let o = -1; o >= left; o--) carriage.push({ off: o, kind: 'backward' });
  } else {
    // One-way: no median; centre the whole carriageway on the stroke.
    const kind = p.lanesF > 0 ? 'forward' : 'backward';
    const w = LANE_TILES * Math.max(p.lanesF, p.lanesB);
    left = -Math.floor((w - 1) / 2);
    right = left + w - 1;
    for (let o = left; o <= right; o++) carriage.push({ off: o, kind });
  }
  const walk: number[] = [];
  if (p.sidewalks) {
    for (let s = 1; s <= SIDEWALK_TILES; s++) {
      walk.push(right + s);
      walk.push(left - s);
    }
  }
  return { carriage, walk };
}

// Per-stroke rasterization: carriageway cells (lane/median) and sidewalk cells,
// plus the ordered centerline (junction/crosswalk passes need the order).
// Travel-axis bits per carriageway cell — the junction discriminator. A
// junction needs CROSSING traffic; two parallel strokes (a road continued
// end-to-end from an existing one, or drawn head-on) overlap without crossing
// and must read as ONE continuous road, never a phantom junction + zebras.
const AXIS_X = 1;
const AXIS_Z = 2;

type StrokeRaster = {
  stroke: RoadStroke;
  center: CenterCell[];
  /** cell → kind; closest-to-centerline column wins so corners stay clean */
  carriage: Map<string, TileKind>;
  walk: Set<string>;
  /** cell → |offset| that produced it (the corner tiebreak) */
  rank: Map<string, number>;
  /** cell → travel-axis bits (AXIS_X / AXIS_Z) along this stroke */
  axes: Map<string, number>;
};

function rasterizeStroke(stroke: RoadStroke): StrokeRaster {
  const profile = clampProfile(stroke.profile);
  const xs = crossSection(profile);
  // Stamp the FILLETED polyline — corners rasterize as arcs, and the analytic
  // ribbon render walks the same curve, so look and gameplay agree.
  const center = rasterizeCenterline(filletPoints(stroke.points, ROAD_FILLET_TILES));
  const carriage = new Map<string, TileKind>();
  const walk = new Set<string>();
  const rank = new Map<string, number>();
  const axes = new Map<string, number>();

  for (const c of center) {
    const r = rightOf(c.dir);
    const axis = c.dir.dx !== 0 ? AXIS_X : AXIS_Z;
    for (const col of xs.carriage) {
      const gx = c.gx + r.dx * col.off;
      const gz = c.gz + r.dz * col.off;
      const k = cellKey(gx, gz);
      axes.set(k, (axes.get(k) ?? 0) | axis);
      const score = Math.abs(col.off);
      const prev = rank.get(k);
      if (prev !== undefined && prev <= score) continue;
      rank.set(k, score);
      const kind: TileKind =
        col.kind === 'median' ? 'median'
        : col.kind === 'forward' ? laneKindFor(c.dir)
        : laneKindFor({ dx: -c.dir.dx, dz: -c.dir.dz });
      carriage.set(k, kind);
      walk.delete(k); // carriageway always beats this stroke's own sidewalk
    }
    for (const off of xs.walk) {
      const gx = c.gx + r.dx * off;
      const gz = c.gz + r.dz * off;
      const k = cellKey(gx, gz);
      if (carriage.has(k)) continue;
      const score = Math.abs(off);
      const prev = rank.get(k);
      if (prev !== undefined && prev <= score) continue;
      rank.set(k, score);
      walk.add(k);
    }
  }
  return { stroke, center, carriage, walk, rank, axes };
}

/**
 * Compile every stroke to one tile-kind plan. Later strokes win plain overlap;
 * junction boxes form where two strokes' carriageways cross; crosswalk bands
 * stamp across each leg just outside the box.
 */
export function planRoads(strokes: RoadStroke[]): RoadPlan {
  const rasters = strokes
    .filter((s) => s.points.length >= 2)
    .map(rasterizeStroke);

  // 1) sidewalks first, then carriageways (any stroke's lanes beat any stroke's
  //    sidewalk where a corner grazes a neighbour road).
  const plan: RoadPlan = new Map();
  for (const r of rasters) for (const k of r.walk) plan.set(k, 'sidewalk');
  for (const r of rasters) for (const [k, kind] of r.carriage) plan.set(k, kind);

  // 2) junction boxes: cells covered by ≥2 strokes' carriageways whose travel
  //    axes CROSS. Parallel overlap (a road continued from an endpoint, or two
  //    roads drawn head-on) is one continuous road — later stroke wins, no box.
  const junction = new Set<string>();
  const cover = new Map<string, number>();
  const coverAxes = new Map<string, number>();
  for (const r of rasters) {
    for (const [k, m] of r.axes) {
      cover.set(k, (cover.get(k) ?? 0) + 1);
      coverAxes.set(k, (coverAxes.get(k) ?? 0) | m);
    }
  }
  for (const [k, n] of cover) {
    if (n >= 2 && coverAxes.get(k) === (AXIS_X | AXIS_Z)) junction.add(k);
  }
  for (const k of junction) plan.set(k, 'junction');

  // 3) crosswalk bands: walking each stroke's centerline in draw order, the
  //    CROSSWALK_DEPTH centerline cells just outside every enter/exit of the
  //    junction box stamp their carriageway cross-section as zebra.
  if (junction.size) {
    for (const r of rasters) {
      const inBox = r.center.map((c) => junction.has(cellKey(c.gx, c.gz)));
      const bandAt = new Set<number>();
      for (let i = 0; i < r.center.length; i++) {
        const enter = !inBox[i] && inBox[i + 1] === true;
        const exit = inBox[i] && inBox[i + 1] === false;
        if (enter) for (let d = 0; d < CROSSWALK_DEPTH; d++) if (i - d >= 0 && !inBox[i - d]) bandAt.add(i - d);
        if (exit) for (let d = 1; d <= CROSSWALK_DEPTH; d++) if (i + d < r.center.length && !inBox[i + d]) bandAt.add(i + d);
      }
      if (!bandAt.size) continue;
      const xs = crossSection(clampProfile(r.stroke.profile));
      for (const i of bandAt) {
        const c = r.center[i]!;
        const rt = rightOf(c.dir);
        for (const col of xs.carriage) {
          const k = cellKey(c.gx + rt.dx * col.off, c.gz + rt.dz * col.off);
          if (!junction.has(k) && plan.has(k)) plan.set(k, 'crosswalk');
        }
      }
    }
  }

  return plan;
}

// ── editor display helpers ───────────────────────────────────────────────────

/** One-way direction chevrons: a marker per segment midpoint, angled along travel (degrees, 0 = +x/east, screen convention +z down). */
export function strokeChevrons(stroke: RoadStroke): { gx: number; gz: number; angleDeg: number }[] {
  const out: { gx: number; gz: number; angleDeg: number }[] = [];
  for (let i = 0; i + 1 < stroke.points.length; i++) {
    const a = stroke.points[i]!;
    const b = stroke.points[i + 1]!;
    if (a.gx === b.gx && a.gz === b.gz) continue;
    // lanesF=0 means traffic flows AGAINST the draw direction — flip the arrow.
    const flip = clampProfile(stroke.profile).lanesF === 0 ? -1 : 1;
    out.push({
      gx: (a.gx + b.gx) / 2,
      gz: (a.gz + b.gz) / 2,
      angleDeg: (Math.atan2((b.gz - a.gz) * flip, (b.gx - a.gx) * flip) * 180) / Math.PI,
    });
  }
  return out;
}

// ── the analytic ribbon (ROADCURVE-0610) ────────────────────────────────────
// The stroke IS the perfect curve; the tile stamp is just its 1m rasterization
// for gameplay. The LOOK renders analytically: per-chunk segment lists feed the
// terrain-drape shader, which paints asphalt/markings from the distance to the
// filleted centerline — sub-tile sharp at the capture's full resolution.

/** Cross-section extents relative to the draw direction's RIGHT vector. */
export function ribbonExtents(p: RoadProfile): { rightExt: number; leftExt: number; twoWay: number; phase: number } {
  const c = clampProfile(p);
  if (c.lanesF > 0 && c.lanesB > 0) {
    // Median half-tile each side; lane-divider boundaries start at 0.5+3 = 3.5.
    return { rightExt: 0.5 + LANE_TILES * c.lanesF, leftExt: 0.5 + LANE_TILES * c.lanesB, twoWay: 1, phase: 3.5 };
  }
  const n = Math.max(c.lanesF, c.lanesB);
  const half = (LANE_TILES * n) / 2;
  // One-way centres on the stroke; divider boundaries depend on lane parity.
  return { rightExt: half, leftExt: half, twoWay: 0, phase: n % 2 === 1 ? 1.5 : 0 };
}

/** Floats per ribbon segment: ax az bx bz rightExt leftExt twoWay phase. */
export const RIBBON_SEG_FLOATS = 8;

/**
 * The chunk-local ribbon segment list for the drape shader: the filleted
 * centerline of every stroke, in CELL space relative to chunk (cx,cz) (cell
 * centres at +0.5), filtered to segments whose band can touch the chunk.
 */
export function roadRibbonSegments(
  strokes: RoadStroke[],
  chunkCx: number,
  chunkCz: number,
  chunkTiles: number,
  maxSegs = 160,
): number[] {
  const out: number[] = [];
  let count = 0;
  for (const r of strokes) {
    if (r.points.length < 2) continue;
    const ext = ribbonExtents(r.profile);
    const m = Math.max(ext.rightExt, ext.leftExt) + 1.5;
    const pts = filletPoints(r.points, ROAD_FILLET_TILES);
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i]!.gx - chunkCx * chunkTiles + 0.5;
      const az = pts[i]!.gz - chunkCz * chunkTiles + 0.5;
      const bx = pts[i + 1]!.gx - chunkCx * chunkTiles + 0.5;
      const bz = pts[i + 1]!.gz - chunkCz * chunkTiles + 0.5;
      if (Math.max(ax, bx) < -m || Math.min(ax, bx) > chunkTiles + m) continue;
      if (Math.max(az, bz) < -m || Math.min(az, bz) > chunkTiles + m) continue;
      if (count >= maxSegs) return out; // silently capped — log upstream if hit
      out.push(ax, az, bx, bz, ext.rightExt, ext.leftExt, ext.twoWay, ext.phase);
      count++;
    }
  }
  return out;
}

/** Short profile blurb for the rail list: "1+1 ·7w ·50", "2→ ·6w +walk ·90". */
export function profileLabel(p: RoadProfile): string {
  const c = clampProfile(p);
  const lanes = isOneWay(c)
    ? `${Math.max(c.lanesF, c.lanesB)}${c.lanesF > 0 ? '→' : '←'}`
    : `${c.lanesF}+${c.lanesB}`;
  return `${lanes} ·${roadWidthTiles(c)}w${c.sidewalks ? ' +walk' : ''} ·${c.speedLimitKph}`;
}

/**
 * The centre offset of every LANE in the cross-section (multiples of the right
 * vector) with its flow — the editor's lane wires (req_0528: seeing each lane's
 * own line makes merging lanes between roads easy).
 */
export function laneGuides(p: RoadProfile): { off: number; flow: 'forward' | 'backward' }[] {
  const c = clampProfile(p);
  const out: { off: number; flow: 'forward' | 'backward' }[] = [];
  const half = (LANE_TILES - 1) / 2;
  if (c.lanesF > 0 && c.lanesB > 0) {
    for (let i = 0; i < c.lanesF; i++) out.push({ off: 1 + i * LANE_TILES + half, flow: 'forward' });
    for (let i = 0; i < c.lanesB; i++) out.push({ off: -(1 + i * LANE_TILES + half), flow: 'backward' });
  } else {
    const n = Math.max(c.lanesF, c.lanesB);
    const flow = c.lanesF > 0 ? 'forward' : 'backward';
    const left = -Math.floor((LANE_TILES * n - 1) / 2);
    for (let i = 0; i < n; i++) out.push({ off: left + i * LANE_TILES + half, flow });
  }
  return out;
}

// ── speed limits along a route (ROADSPEED-0610, req_0554) ───────────────────
// The stroke carries the limit; the lookup answers "which stroke's lane am I
// on" by distance to the FILLETED centerline (the geometry the ribbon renders
// and traffic will drive), within that stroke's carriageway extents.

/** The governing stroke at a world point: nearest filleted centerline whose
 *  carriageway band covers the point. null off-road. */
export function strokeAtPoint(strokes: RoadStroke[], gx: number, gz: number): RoadStroke | null {
  let best: { r: RoadStroke; d: number } | null = null;
  for (const r of strokes) {
    if (r.points.length < 2) continue;
    const ext = ribbonExtents(r.profile);
    const reach = Math.max(ext.rightExt, ext.leftExt);
    const pts = filletPoints(r.points, ROAD_FILLET_TILES);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const abx = b.gx - a.gx, abz = b.gz - a.gz;
      const len2 = abx * abx + abz * abz;
      const t = len2 ? Math.max(0, Math.min(1, ((gx - a.gx) * abx + (gz - a.gz) * abz) / len2)) : 0;
      const d = Math.hypot(gx - (a.gx + abx * t), gz - (a.gz + abz * t));
      if (d <= reach && (!best || d < best.d)) best = { r, d };
    }
  }
  return best?.r ?? null;
}

/** The limit (m/s) governing a world point, or null off-road. */
export function speedLimitAtPoint(strokes: RoadStroke[], gx: number, gz: number): number | null {
  const r = strokeAtPoint(strokes, gx, gz);
  return r ? speedLimitMps(r.profile) : null;
}

/** The STRICTEST limit (m/s) along a route — sampled at every vertex plus
 *  ~3-cell intervals so a brief pass through a slow road still binds. null
 *  when no sample touches a road. */
export function routeSpeedLimitMps(strokes: RoadStroke[], points: readonly [number, number][]): number | null {
  let strictest: number | null = null;
  const sampleAt = (x: number, z: number) => {
    const v = speedLimitAtPoint(strokes, x, z);
    if (v !== null && (strictest === null || v < strictest)) strictest = v;
  };
  for (let i = 0; i < points.length; i++) {
    sampleAt(points[i]![0], points[i]![1]);
    if (i + 1 < points.length) {
      const len = Math.hypot(points[i + 1]![0] - points[i]![0], points[i + 1]![1] - points[i]![1]);
      const steps = Math.floor(len / 3);
      for (let s = 1; s <= steps; s++) {
        const t = s / (steps + 1);
        sampleAt(points[i]![0] + (points[i + 1]![0] - points[i]![0]) * t, points[i]![1] + (points[i + 1]![1] - points[i]![1]) * t);
      }
    }
  }
  return strictest;
}

/** THE MOTION CONSUMER: a driving profile obeying the route's strictest
 *  limit — maxSpeed clamps down, never up (a 30 km/h jalopy stays a jalopy
 *  on the highway). Off-road routes keep the base profile. */
export function roadMotionProfile<T extends { maxSpeed: number }>(
  base: T,
  strokes: RoadStroke[],
  points: readonly [number, number][],
): T {
  const limit = routeSpeedLimitMps(strokes, points);
  if (limit === null || limit >= base.maxSpeed) return base;
  return { ...base, maxSpeed: limit };
}

/** Per-LANE flow arrows (FLOWARROWS-0610, user ask): one glyph every
 *  `everyTiles` along each lane's centerline, pointing the lane's ACTUAL
 *  travel direction — colours can't say "which way", arrows can. ASCII
 *  glyphs by dominant axis (the roadChevrons convention; fillets make short
 *  near-diagonal segments where the dominant axis is an honest rounding). */
export function laneFlowArrows(r: RoadStroke, everyTiles: number): { x: number; z: number; glyph: string; flow: 'forward' | 'backward' }[] {
  const guides = laneGuides(r.profile);
  const out: { x: number; z: number; glyph: string; flow: 'forward' | 'backward' }[] = [];
  for (let i = 0; i + 1 < r.points.length; i++) {
    const a = r.points[i]!, b = r.points[i + 1]!;
    const dx = b.gx - a.gx, dz = b.gz - a.gz;
    const len = Math.hypot(dx, dz);
    if (!len) continue;
    const dir = Math.abs(dx) >= Math.abs(dz) ? { dx: Math.sign(dx), dz: 0 } : { dx: 0, dz: Math.sign(dz) };
    const right = { dx: -dir.dz, dz: dir.dx };
    const n = Math.max(1, Math.round(len / everyTiles));
    for (const g of guides) {
      // the lane's true travel vector: with the segment for forward lanes,
      // against it for opposing ones
      const fx = g.flow === 'forward' ? dx : -dx;
      const fz = g.flow === 'forward' ? dz : -dz;
      const glyph = Math.abs(fx) >= Math.abs(fz) ? (fx > 0 ? '>' : '<') : (fz > 0 ? 'v' : '^');
      // midpoints of n slots — arrows stay off the segment ends so junction
      // seams and connect squares keep their breathing room
      for (let s = 0; s < n; s++) {
        const t = (s + 0.5) / n;
        out.push({
          x: a.gx + dx * t + right.dx * g.off,
          z: a.gz + dz * t + right.dz * g.off,
          glyph,
          flow: g.flow,
        });
      }
    }
  }
  return out;
}

/** Wire-colour canonicalization (WIRECOLOR-0610): true when the stroke's net
 *  direction points NEGATIVE on its dominant axis. Lane wires colour by flow
 *  vs the CANONICAL direction (east/south positive), not the draw direction —
 *  so the two halves of a road drawn outward from a junction read one
 *  continuous colour instead of flipping at the seam (the user's report: the
 *  flip LOOKED like wrong-way traffic when the lanes were actually correct). */
export function strokeWireFlip(points: RoadPoint[]): boolean {
  if (points.length < 2) return false;
  const dx = points[points.length - 1]!.gx - points[0]!.gx;
  const dz = points[points.length - 1]!.gz - points[0]!.gz;
  return Math.abs(dx) >= Math.abs(dz) ? dx < 0 : dz < 0;
}

/** Every stroke's two endpoints — the wire connect points the editor marks. */
export function strokeEndpoints(strokes: RoadStroke[]): RoadPoint[] {
  const out: RoadPoint[] = [];
  for (const r of strokes) {
    if (!r.points.length) continue;
    out.push(r.points[0]!);
    if (r.points.length > 1) out.push(r.points[r.points.length - 1]!);
  }
  return out;
}

/**
 * Snap a clicked cell to the nearest stroke endpoint within `radius` cells —
 * how a new road CONTINUES an existing one into a connected network (the
 * axis-crossing junction rule reads the shared seam as one road, not a box).
 */
export function snapToRoadEnd(strokes: RoadStroke[], p: RoadPoint, radius: number): RoadPoint | null {
  let best: RoadPoint | null = null;
  let bestD = radius;
  for (const e of strokeEndpoints(strokes)) {
    const d = Math.hypot(e.gx - p.gx, e.gz - p.gz);
    if (d <= bestD) {
      bestD = d;
      best = e;
    }
  }
  return best ? { gx: best.gx, gz: best.gz } : null;
}

// ── mid-stroke connections (req_0529: "where do I click to merge?") ─────────
// A connection point doesn't have to be an endpoint: clicking ON a road's
// centerline snaps to it, and committing a stroke that ENDS there SPLITS the
// underlying road at that point — the split seam stays one continuous road
// (parallel axes never box), and the two halves become independently
// re-profileable (widen the downstream half = the lane merge).

export type CenterlineHit = {
  strokeId: string;
  /** the snapped cell ON the centerline */
  point: RoadPoint;
  /** true when the hit is NOT one of the stroke's endpoints (a split is needed) */
  midSpan: boolean;
};

/** Nearest point on any stroke's centerline within `radius` cells, or null. */
export function snapToCenterline(strokes: RoadStroke[], p: RoadPoint, radius: number): CenterlineHit | null {
  let best: { r: RoadStroke; d: number; x: number; z: number } | null = null;
  for (const r of strokes) {
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i]!, b = r.points[i + 1]!;
      const abx = b.gx - a.gx, abz = b.gz - a.gz;
      const len2 = abx * abx + abz * abz;
      const t = len2 ? Math.max(0, Math.min(1, ((p.gx - a.gx) * abx + (p.gz - a.gz) * abz) / len2)) : 0;
      const x = a.gx + abx * t, z = a.gz + abz * t;
      const d = Math.hypot(p.gx - x, p.gz - z);
      if (!best || d < best.d) best = { r, d, x, z };
    }
  }
  if (!best || best.d > radius) return null;
  const point = { gx: Math.round(best.x), gz: Math.round(best.z) };
  const first = best.r.points[0]!;
  const last = best.r.points[best.r.points.length - 1]!;
  const midSpan = !(first.gx === point.gx && first.gz === point.gz) && !(last.gx === point.gx && last.gz === point.gz);
  return { strokeId: best.r.id, point, midSpan };
}

/**
 * THE MERGE GESTURE (req_0532): a one-way draft whose tail (or head) runs
 * ALONG an existing road — [...ramp, C, E] where C sits mid-span on a stroke
 * and E is that same stroke's endpoint — means "these lanes pour into the road
 * at C and continue toward E". The gesture: splits the road at C, WIDENS the
 * C→E half on the side the merging traffic flows (the ramp's lane count, so
 * 1 existing + 2 incoming = 3), and trims the along-road tail off the ramp so
 * it ends at C. Works at either end of the draft: tail = an entry ramp, head
 * = an exit ramp (traffic leaving at C widens the deceleration side).
 * Null when the draft is two-way, too short, or no such (C, E) pair exists.
 */
export type MergeGestureResult = {
  /** strokes with the target split + the C→E half widened */
  strokes: RoadStroke[];
  /** the draft trimmed to end (or start) at C */
  points: RoadPoint[];
  /** the id of the widened half (select it after commit) */
  widenedId: string;
};

export function applyMergeGesture(
  strokes: RoadStroke[],
  points: RoadPoint[],
  profile: RoadProfile,
  mintId: () => string,
): MergeGestureResult | null {
  const p = clampProfile(profile);
  if (!isOneWay(p) || points.length < 3) return null;
  const rampLanes = Math.max(p.lanesF, p.lanesB);

  const tryAt = (cIdx: number, eIdx: number): MergeGestureResult | null => {
    const C = points[cIdx]!;
    const E = points[eIdx]!;
    const target = strokes.find((r) => {
      const f = r.points[0]!;
      const l = r.points[r.points.length - 1]!;
      const isEnd = (f.gx === E.gx && f.gz === E.gz) || (l.gx === E.gx && l.gz === E.gz);
      if (!isEnd) return false;
      const hit = snapToCenterline([r], C, 0.6);
      return !!hit && hit.midSpan;
    });
    if (!target) return null;
    const halves = splitStroke(target, C, mintId(), mintId());
    if (!halves) return null;
    const isE = (pt: RoadPoint) => pt.gx === E.gx && pt.gz === E.gz;
    const half = halves.find((h) => isE(h.points[0]!) || isE(h.points[h.points.length - 1]!));
    const other = halves.find((h) => h !== half);
    if (!half || !other) return null;
    // Traffic direction through the gesture: tail gesture draws C→E, head
    // gesture draws E→C; lanesB-only one-ways flow against the draw.
    const drawIsCtoE = cIdx < eIdx;
    const flowCtoE = p.lanesF > 0 ? drawIsCtoE : !drawIsCtoE;
    // Which of the half's profile sides flows C→E: its draw order decides.
    const halfForwardCtoE = half.points[0]!.gx === C.gx && half.points[0]!.gz === C.gz;
    const widenForward = flowCtoE === halfForwardCtoE;
    const widened: RoadStroke = {
      ...half,
      profile: clampProfile({
        ...half.profile,
        lanesF: half.profile.lanesF + (widenForward ? rampLanes : 0),
        lanesB: half.profile.lanesB + (widenForward ? 0 : rampLanes),
      }),
    };
    const idx = strokes.findIndex((r) => r.id === target.id);
    const nextStrokes = [...strokes];
    nextStrokes.splice(idx, 1, other, widened);
    const trimmed = cIdx < eIdx ? points.slice(0, cIdx + 1) : points.slice(cIdx);
    return { strokes: nextStrokes, points: trimmed, widenedId: widened.id };
  };

  return tryAt(points.length - 2, points.length - 1) ?? tryAt(1, 0);
}

/**
 * Split a stroke at a point on (or near) its centerline into two strokes that
 * share that point. Profiles copy to both halves — re-profile either after.
 * Null when the point sits on an endpoint (nothing to split) or a half would
 * degenerate.
 */
export function splitStroke(stroke: RoadStroke, at: RoadPoint, idA: string, idB: string): [RoadStroke, RoadStroke] | null {
  const pts = stroke.points;
  let bestSeg = -1, bestD = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const abx = b.gx - a.gx, abz = b.gz - a.gz;
    const len2 = abx * abx + abz * abz;
    const t = len2 ? Math.max(0, Math.min(1, ((at.gx - a.gx) * abx + (at.gz - a.gz) * abz) / len2)) : 0;
    const d = Math.hypot(at.gx - (a.gx + abx * t), at.gz - (a.gz + abz * t));
    if (d < bestD) { bestD = d; bestSeg = i; }
  }
  if (bestSeg < 0) return null;
  const dedupe = (list: RoadPoint[]): RoadPoint[] => {
    const out: RoadPoint[] = [];
    for (const p of list) {
      const last = out[out.length - 1];
      if (!last || last.gx !== p.gx || last.gz !== p.gz) out.push({ gx: p.gx, gz: p.gz });
    }
    return out;
  };
  const a = dedupe([...pts.slice(0, bestSeg + 1), at]);
  const b = dedupe([at, ...pts.slice(bestSeg + 1)]);
  if (a.length < 2 || b.length < 2) return null;
  return [
    { id: idA, points: a, profile: { ...stroke.profile } },
    { id: idB, points: b, profile: { ...stroke.profile } },
  ];
}
