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
type StrokeRaster = {
  stroke: RoadStroke;
  center: CenterCell[];
  /** cell → kind; closest-to-centerline column wins so corners stay clean */
  carriage: Map<string, TileKind>;
  walk: Set<string>;
  /** cell → |offset| that produced it (the corner tiebreak) */
  rank: Map<string, number>;
};

function rasterizeStroke(stroke: RoadStroke): StrokeRaster {
  const profile = clampProfile(stroke.profile);
  const xs = crossSection(profile);
  const center = rasterizeCenterline(stroke.points);
  const carriage = new Map<string, TileKind>();
  const walk = new Set<string>();
  const rank = new Map<string, number>();

  for (const c of center) {
    const r = rightOf(c.dir);
    for (const col of xs.carriage) {
      const gx = c.gx + r.dx * col.off;
      const gz = c.gz + r.dz * col.off;
      const k = cellKey(gx, gz);
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
  return { stroke, center, carriage, walk, rank };
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

  // 2) junction boxes: cells covered by ≥2 strokes' carriageways.
  const junction = new Set<string>();
  const cover = new Map<string, number>();
  for (const r of rasters) for (const k of r.carriage.keys()) cover.set(k, (cover.get(k) ?? 0) + 1);
  for (const [k, n] of cover) if (n >= 2) junction.add(k);
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
