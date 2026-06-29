// game/traffic/ — GAME_TRAFFIC: ambient road traffic, baked for the no-V8
// compiled world (req_2056, native re-home).
//
// The user checks the world through the compiled native loader, not React — so
// traffic is BAKED, not a runtime React layer ([[compiled_world_animated_content]]).
// At bake time we generate looping vehicle routes PURELY (the headless bake has
// no host A*): build the nav grid from the painted map (GAME_WORLD.bakeNavGrid),
// then FLOW-FOLLOW the directional lane tiles — a vehicle drives with the lane
// flow, holds its side (never enters an opposing-flow cell), and turns at
// junctions. Each baked vehicle is a closed route polyline + a cruise speed + a
// phase offset; world_loader.zig samples it per frame (arc-length mod loop
// length) and rebuilds the vehicle's instance rows — the LED-ticker pattern.
//
// This is the V5/V21 doctrine made concrete: deterministic, precomputed routes
// (closed-form until a game-state change), no per-frame pathfinding.

import { TILE_KINDS, TILE_KIND_INDEX, tileFlowVector, tileKindDefinition, type TileKind } from '../kinds';
import type { NavGrid } from '../world/navGrid';
import { makeVehicle, type VehicleDoc } from '../vehicle';
import { seededRng } from '../chance';

/** Gameplay knobs — P2 (no inline magic values; one registered table). */
export const TRAFFIC_TUNING = {
  /** city cruise speed range (m/s) — each vehicle samples within. */
  cruiseSpeedMin: 5,
  cruiseSpeedMax: 9,
  /** a baked tour must be at least this long (m) to be worth driving. */
  minCircuitMeters: 24,
  /** how many distant-goal legs a car's tour visits (random in this range) — the
   *  spread that makes routes feel un-fixed. */
  goalLegsMin: 2,
  goalLegsMax: 6,
  /** a goal intersection must be at least this far from the car (m) — never the
   *  immediate next one. */
  minGoalMeters: 45,
  /** how many starts to try before giving up on a car (a tour must make it home
   *  to loop without teleporting). */
  bakeAttemptsPerCar: 10,
  /** cap on road cells scanned out of the baked grid. */
  maxRoadPoints: 4096,
  /** how many vehicles the compiled-world bake populates. */
  bakeCount: 14,
  /** reproducibility seed for the bake. */
  bakeSeed: 1337,
} as const;

/** A grid step direction (cells). */
type Step = { dx: number; dz: number };
const STEPS: readonly Step[] = [{ dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 }];

/** A baked vehicle route: world-space corner points; `closed` = loops cleanly. */
export type TrafficRoute = {
  points: [number, number][];
  closed: boolean;
  /** total arc length (m). */
  length: number;
};

/** One baked vehicle: a visual doc + its looping route + cruise speed + phase. */
export type BakedVehicle = {
  doc: VehicleDoc;
  route: TrafficRoute;
  /** constant cruise speed (m/s). */
  speed: number;
  /** arc-length head start (m) so cars don't stack at the route origin. */
  phase: number;
};

// ── road / flow grid helpers (TILE_KINDS-indexed, computed once) ────────────

/** Is this kind a vehicle road? (lanes, junctions, plain road) — the PREFERRED
 *  surfaces a car likes, used for spawn/seed selection. */
function roadKindMask(): boolean[] {
  return TILE_KINDS.map((k) => tileKindDefinition(k as TileKind).npc.preferredByVehicles === true);
}

/** The drivable ROAD NETWORK a car routes on: the PREFERRED road surfaces (lanes,
 *  plain road, asphalt, junctions) PLUS crosswalks — the one non-preferred tile a
 *  car crosses to get between lanes and junctions. Deliberately EXCLUDES merely
 *  traversable terrain (sidewalk, grass, mud, sand, median, parking): those have a
 *  finite vehicle cost but a car must not shortcut across them. Without crosswalks
 *  the network is sealed (lanes can't reach junctions); with terrain the BFS cuts
 *  corners off-road. This is exactly the road family. */
function roadNetworkMask(): boolean[] {
  return TILE_KINDS.map((k) => tileKindDefinition(k as TileKind).npc.preferredByVehicles === true || k === 'crosswalk');
}

/** Per-kind flow step (null where flow-neutral — junctions, plain road). */
function flowStepTable(): (Step | null)[] {
  return TILE_KINDS.map((k) => {
    const v = tileFlowVector(k as TileKind);
    return v ? { dx: Math.sign(v.dx), dz: Math.sign(v.dz) } : null;
  });
}

/** Every vehicle-road cell center in world space — the spawn/seed pool. */
export function roadCellsFromNav(grid: NavGrid, maxPoints = TRAFFIC_TUNING.maxRoadPoints): [number, number][] {
  const isRoad = roadKindMask();
  const [ox, oz] = grid.origin;
  const cell = grid.cellSize;
  const points: [number, number][] = [];
  for (let z = 0; z < grid.rows; z++) {
    for (let x = 0; x < grid.cols; x++) {
      if (!isRoad[grid.kinds[z * grid.cols + x]]) continue;
      points.push([ox + (x + 0.5) * cell, oz + (z + 0.5) * cell]);
    }
  }
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % stride === 0);
}

// ── goal-oriented routing (pure, headless) ──────────────────────────────────

/** Intersection (junction) cells — the goal nodes traffic routes between. */
export function junctionCells(grid: NavGrid): [number, number][] {
  const j = TILE_KIND_INDEX.junction;
  const out: [number, number][] = [];
  for (let z = 0; z < grid.rows; z++) {
    for (let x = 0; x < grid.cols; x++) {
      if (grid.kinds[z * grid.cols + x] === j) out.push([x, z]);
    }
  }
  return out;
}

/**
 * GOAL-ORIENTED route. From a start cell the car visits a TOUR of several random
 * DISTANT intersections (never the immediate next one — `minGoalMeters` away),
 * then home, so the baked route loops without teleporting. Each leg is a real
 * SHORTEST legal path (BFS over the directed road graph — on-road, never against
 * the lane flow), so a tour reliably makes it home. The varied leg count + goal
 * distance per call mean no two cars feel fixed. Returns a closed route, or
 * `closed:false` if home is unreachable (the bake retries / rejects). null if the
 * start can't move.
 */
export function traceGoalTour(grid: NavGrid, start: [number, number], goals: readonly [number, number][], rng: () => number): TrafficRoute | null {
  const isRoad = roadNetworkMask(); // road family only — never shortcut across terrain
  const flow = flowStepTable();
  const { cols, rows, kinds } = grid;
  const [ox, oz] = grid.origin;
  const cellM = grid.cellSize;
  const at = (x: number, z: number): number => (x < 0 || z < 0 || x >= cols || z >= rows ? -1 : kinds[z * cols + x]);
  const road = (x: number, z: number): boolean => { const k = at(x, z); return k >= 0 && isRoad[k]; };
  const opposes = (x: number, z: number, d: Step): boolean => {
    const f = at(x, z) >= 0 ? flow[at(x, z)] : null;
    return !!f && (f.dx * d.dx + f.dz * d.dz) < 0; // entering a lane against its flow
  };
  const manh = (ax: number, az: number, gx: number, gz: number): number => Math.abs(ax - gx) + Math.abs(az - gz);

  const [sx, sz] = start;
  if (!road(sx, sz) || !goals.length) return null;

  // Shortest LEGAL directed path between two road cells (BFS, flow-respecting).
  // Returns the cell list inclusive of both ends, or null if unreachable.
  const routeBetween = (fx: number, fz: number, tx: number, tz: number): [number, number][] | null => {
    const startKey = fz * cols + fx;
    const goalKey = tz * cols + tx;
    if (startKey === goalKey) return [[fx, fz]];
    const prev = new Map<number, number>();
    const seen = new Set<number>([startKey]);
    let frontier: [number, number][] = [[fx, fz]];
    let found = false;
    while (frontier.length && !found) {
      const nextF: [number, number][] = [];
      for (const [x, z] of frontier) {
        for (const s of STEPS) {
          const nx = x + s.dx;
          const nz = z + s.dz;
          if (!road(nx, nz) || opposes(nx, nz, s)) continue;
          const key = nz * cols + nx;
          if (seen.has(key)) continue;
          seen.add(key);
          prev.set(key, z * cols + x);
          if (key === goalKey) { found = true; break; }
          nextF.push([nx, nz]);
        }
        if (found) break;
      }
      frontier = nextF;
    }
    if (!found) return null;
    const path: [number, number][] = [];
    let k = goalKey;
    while (k !== startKey) {
      const x = k % cols;
      path.push([x, (k - x) / cols]);
      const p = prev.get(k);
      if (p === undefined) return null;
      k = p;
    }
    path.push([fx, fz]);
    path.reverse();
    return path;
  };

  const cellPath: [number, number][] = [[sx, sz]];
  let cx = sx;
  let cz = sz;
  const append = (leg: [number, number][]): void => {
    for (let i = 1; i < leg.length; i++) cellPath.push(leg[i]);
    const end = leg[leg.length - 1];
    cx = end[0]; cz = end[1];
  };

  const minGoal = Math.max(1, Math.round(TRAFFIC_TUNING.minGoalMeters / cellM));
  const pickFarGoal = (): [number, number] => {
    const far = goals.filter(([gx, gz]) => manh(cx, cz, gx, gz) >= minGoal);
    const pool = far.length ? far : goals;
    return pool[Math.floor(rng() * pool.length)];
  };

  const legs = TRAFFIC_TUNING.goalLegsMin + Math.floor(rng() * (TRAFFIC_TUNING.goalLegsMax - TRAFFIC_TUNING.goalLegsMin + 1));
  for (let l = 0; l < legs; l++) {
    const goal = pickFarGoal();
    const leg = routeBetween(cx, cz, goal[0], goal[1]);
    if (leg) append(leg); // an unreachable goal is just skipped; the tour goes on
  }
  const homeLeg = routeBetween(cx, cz, sx, sz); // the closing leg, back to start
  const closed = homeLeg !== null;
  if (homeLeg) append(homeLeg);

  // Snap every cell onto its LANE CENTERLINE (perpendicular to flow) so the car
  // drives down the center of the 3-wide trio, not wherever the BFS wandered
  // across its width. Every tile of a trio shares the trio's flow, so they all
  // snap to the same line; flow-neutral cells (junctions / crosswalks) keep their
  // own center. Then simplify the world polyline to its corners — a closed tour
  // ends at the start cell (== points[0]), so the loop seam stays exact.
  const sameFlow = (x: number, z: number, f: Step): boolean => {
    const k = at(x, z);
    const g = k >= 0 ? flow[k] : null;
    return !!g && g.dx === f.dx && g.dz === f.dz;
  };
  const laneCenter = (x: number, z: number): [number, number] => {
    const k = at(x, z);
    const f = k >= 0 ? flow[k] : null;
    if (!f) return [ox + (x + 0.5) * cellM, oz + (z + 0.5) * cellM];
    const px = -f.dz; // unit perpendicular to the flow direction
    const pz = f.dx;
    let lo = 0;
    let hi = 0;
    while (sameFlow(x + (lo - 1) * px, z + (lo - 1) * pz, f)) lo -= 1;
    while (sameFlow(x + (hi + 1) * px, z + (hi + 1) * pz, f)) hi += 1;
    const c = (lo + hi) / 2; // perpendicular offset to the trio's center, in cells
    return [ox + (x + 0.5 + c * px) * cellM, oz + (z + 0.5 + c * pz) * cellM];
  };
  const points = simplifyPolyline(cellPath.map(([x, z]) => laneCenter(x, z)));
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return { points, closed, length };
}

/** Collapse a world polyline to its corners — drop points collinear with their
 *  kept neighbour (which also removes the duplicates lane-center snapping makes
 *  out of a straight run). */
function simplifyPolyline(pts: readonly [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts.slice();
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, az] = out[out.length - 1];
    const [bx, bz] = pts[i];
    const [cx, cz] = pts[i + 1];
    const cross = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
    if (Math.abs(cross) > 1e-4) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ── the bake: populate vehicles on flow circuits ────────────────────────────

/**
 * Generate `count` baked vehicles, each driving its OWN goal-oriented tour of
 * distant intersections (traceGoalTour) over the nav grid. Deterministic for a
 * seed. Vehicles draw from the authored garage when given, else makeVehicle.
 * Returns fewer than `count` only when the map has too little road to route on.
 */
export function bakeTrafficVehicles(opts: {
  grid: NavGrid;
  count: number;
  seed: number;
  garage?: readonly VehicleDoc[];
}): BakedVehicle[] {
  const rng = seededRng(opts.seed);
  const isRoad = roadKindMask();
  const flow = flowStepTable();
  const { cols, rows, kinds } = opts.grid;
  // start cells = flowed (lane) cells, so the car has an initial heading.
  const starts: [number, number][] = [];
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const k = kinds[z * cols + x];
      if (isRoad[k] && flow[k]) starts.push([x, z]);
    }
  }
  if (!starts.length) return [];
  // goals = the intersections; fall back to any lane cell on a map with no junctions.
  const goals = junctionCells(opts.grid);
  const goalNodes = goals.length ? goals : starts;

  const out: BakedVehicle[] = [];
  for (let i = 0; i < opts.count; i++) {
    // A tour must make it HOME (closed) so it loops without teleporting — retry
    // from fresh starts until one does.
    let route: TrafficRoute | null = null;
    for (let attempt = 0; attempt < TRAFFIC_TUNING.bakeAttemptsPerCar && !route; attempt++) {
      const start = starts[Math.floor(rng() * starts.length)];
      const tour = traceGoalTour(opts.grid, start, goalNodes, rng);
      if (tour && tour.closed && tour.length >= TRAFFIC_TUNING.minCircuitMeters) route = tour;
    }
    if (!route) continue;
    const doc = opts.garage && opts.garage.length ? opts.garage[i % opts.garage.length] : makeVehicle(opts.seed + i + 1);
    const speed = TRAFFIC_TUNING.cruiseSpeedMin + rng() * (TRAFFIC_TUNING.cruiseSpeedMax - TRAFFIC_TUNING.cruiseSpeedMin);
    out.push({ doc, route, speed, phase: rng() * route.length });
  }
  return out;
}

export const GAME_TRAFFIC = Object.freeze({
  tuning: TRAFFIC_TUNING,
  roadCellsFromNav,
  junctionCells,
  traceGoalTour,
  bakeTrafficVehicles,
});
