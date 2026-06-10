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

export function clampProfile(p: RoadProfile): RoadProfile {
  const lanesF = Math.max(0, Math.min(MAX_LANES_PER_SIDE, Math.round(p.lanesF)));
  const lanesB = Math.max(0, Math.min(MAX_LANES_PER_SIDE, Math.round(p.lanesB)));
  // A road with no lanes at all is not a road; keep one forward lane.
  if (lanesF === 0 && lanesB === 0) return { lanesF: 1, lanesB: 0, sidewalks: !!p.sidewalks };
  return { lanesF, lanesB, sidewalks: !!p.sidewalks };
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
    const steps = Math.max(Math.abs(b.gx - a.gx), Math.abs(b.gz - a.gz)) * 4;
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
  const center = rasterizeCenterline(stroke.points);
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

/** Short profile blurb for the rail list: "1+1 ·7w", "2→ ·6w +walk". */
export function profileLabel(p: RoadProfile): string {
  const c = clampProfile(p);
  const lanes = isOneWay(c)
    ? `${Math.max(c.lanesF, c.lanesB)}${c.lanesF > 0 ? '→' : '←'}`
    : `${c.lanesF}+${c.lanesB}`;
  return `${lanes} ·${roadWidthTiles(c)}w${c.sidewalks ? ' +walk' : ''}`;
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
