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

import { TILE_KINDS, tileFlowVector, tileKindDefinition, type TileKind } from '../kinds';
import type { NavGrid } from '../world/navGrid';
import { makeVehicle, type VehicleDoc } from '../vehicle';
import { seededRng } from '../chance';

/** Gameplay knobs — P2 (no inline magic values; one registered table). */
export const TRAFFIC_TUNING = {
  /** city cruise speed range (m/s) — each vehicle samples within. */
  cruiseSpeedMin: 5,
  cruiseSpeedMax: 9,
  /** a baked circuit must be at least this long (m) to be worth driving. */
  minCircuitMeters: 24,
  /** trace ceiling — stop following flow after this many cells (loop or bust). */
  maxCircuitCells: 4096,
  /** cap on DISTINCT loops collected from the map (cars spread across them). */
  maxLoops: 32,
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

/** Is this kind a vehicle road? (lanes, junctions, plain road.) */
function roadKindMask(): boolean[] {
  return TILE_KINDS.map((k) => tileKindDefinition(k as TileKind).npc.preferredByVehicles === true);
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

// ── the flow-follow circuit tracer (pure, headless) ─────────────────────────

/**
 * Follow lane flow from a start cell into a route polyline. The walk holds the
 * lane discipline: it never steps into a cell whose flow OPPOSES travel (the
 * oncoming lane), prefers going straight, and turns at junctions / lane ends.
 * The walk closes on the FIRST REVISITED cell — the sub-path from that cell is a
 * real cycle the vehicle drives forever (the lead-in tail is discarded). An open
 * walk (dead-ends before cycling) returns `closed: false` and is rejected by the
 * bake — a loop is the only shape that drives without teleport-wrapping. null if
 * the start can't move.
 */
export function traceFlowCircuit(grid: NavGrid, start: [number, number], rng?: () => number): TrafficRoute | null {
  const isRoad = roadKindMask();
  const flow = flowStepTable();
  const { cols, rows, kinds } = grid;
  const [ox, oz] = grid.origin;
  const cellM = grid.cellSize;

  const at = (x: number, z: number): number => (x < 0 || z < 0 || x >= cols || z >= rows ? -1 : kinds[z * cols + x]);
  const road = (x: number, z: number): boolean => { const k = at(x, z); return k >= 0 && isRoad[k]; };
  const opposes = (x: number, z: number, dir: Step): boolean => {
    const f = at(x, z) >= 0 ? flow[at(x, z)] : null;
    return !!f && (f.dx * dir.dx + f.dz * dir.dz) < 0; // entering against the lane
  };

  const [sx, sz] = start;
  if (!road(sx, sz)) return null;
  // initial heading: the start's own flow, else the first legal neighbor.
  let dir = (at(sx, sz) >= 0 ? flow[at(sx, sz)] : null) ?? STEPS.find((s) => road(sx + s.dx, sz + s.dz) && !opposes(sx + s.dx, sz + s.dz, s)) ?? null;
  if (!dir) return null;

  // straight-ahead alignment score: prefer continuing the current heading.
  const score = (s: Step): number => s.dx * dir!.dx + s.dz * dir!.dz;

  const cellPath: [number, number][] = [[sx, sz]];
  const seenAt = new Map<number, number>([[sz * cols + sx, 0]]);
  let cx = sx;
  let cz = sz;
  let loopStart = -1; // cellPath index where the closed cycle begins
  for (let step = 0; step < TRAFFIC_TUNING.maxCircuitCells; step++) {
    // Legal moves: on-road, with the flow, never a U-turn.
    const legal = STEPS.filter((s) =>
      !(s.dx === -dir!.dx && s.dz === -dir!.dz) && road(cx + s.dx, cz + s.dz) && !opposes(cx + s.dx, cz + s.dz, s));
    if (!legal.length) break; // dead end before a cycle — open walk, rejected by the bake
    // Hold the lane straight by default; at a real fork EXPLORE (rng) so distinct
    // seeds discover distinct loops. Deterministic (straight-first) without an rng.
    const straight = legal.find((s) => s.dx === dir!.dx && s.dz === dir!.dz);
    const pick = rng
      ? (straight && rng() < 0.65 ? straight : legal[Math.floor(rng() * legal.length)])
      : legal.slice().sort((a, b) => score(b) - score(a))[0];
    const nx = cx + pick.dx;
    const nz = cz + pick.dz;
    const key = nz * cols + nx;
    const prior = seenAt.get(key);
    if (prior !== undefined) { loopStart = prior; break; } // revisited → cycle found
    seenAt.set(key, cellPath.length);
    cellPath.push([nx, nz]);
    cx = nx; cz = nz;
    // a flowed cell snaps the heading to its lane; a neutral cell keeps it.
    dir = flow[at(cx, cz)] ?? pick;
  }

  const closed = loopStart >= 0;
  // The drive is the CYCLE only (drop the lead-in tail before the loop entry).
  const cycle = closed ? cellPath.slice(loopStart) : cellPath;
  const corners = collapseCollinear(cycle);
  const points: [number, number][] = corners.map(([x, z]) => [ox + (x + 0.5) * cellM, oz + (z + 0.5) * cellM]);
  if (closed && points.length > 1) points.push(points[0]); // close the loop exactly
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return { points, closed, length };
}

/** Drop interior cells that lie on a straight run — keep only the turn corners. */
function collapseCollinear(cells: readonly [number, number][]): [number, number][] {
  if (cells.length <= 2) return cells.slice();
  const out: [number, number][] = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    const [ax, az] = out[out.length - 1];
    const [bx, bz] = cells[i];
    const [cx, cz] = cells[i + 1];
    const turned = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
    if (turned !== 0) out.push(cells[i]);
  }
  out.push(cells[cells.length - 1]);
  return out;
}

// ── the bake: populate vehicles on flow circuits ────────────────────────────

/**
 * Generate `count` baked vehicles on looping flow circuits over the nav grid.
 * Deterministic for a seed. Vehicles draw from the authored garage when given,
 * else makeVehicle(seed). Returns fewer than `count` only if the map has too
 * little road to seed them.
 */
export function bakeTrafficVehicles(opts: {
  grid: NavGrid;
  count: number;
  seed: number;
  garage?: readonly VehicleDoc[];
}): BakedVehicle[] {
  const rng = seededRng(opts.seed);
  const isRoad = roadKindMask();
  const { cols, rows, kinds } = opts.grid;
  // seed cells = vehicle-road cells with at least one flowed (lane) cell, so the
  // tracer has a heading to follow.
  const seeds: [number, number][] = [];
  const flow = flowStepTable();
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const k = kinds[z * cols + x];
      if (isRoad[k] && flow[k]) seeds.push([x, z]);
    }
  }
  if (!seeds.length) return [];

  // Discover DISTINCT closed loops by tracing the lane flow DETERMINISTICALLY
  // (straight-follow) from every seed cell — random turning just dead-ends before
  // it cycles, so the clean straight-follow is what actually finds the loops. The
  // signature dedupes the same cycle reached from different entry cells. CLOSED
  // only: an open walk teleport-wraps from its dead-end, reading as a vanishing car.
  const loops: TrafficRoute[] = [];
  const seenLoops = new Set<string>();
  for (const seed of seeds) {
    if (loops.length >= TRAFFIC_TUNING.maxLoops) break;
    const route = traceFlowCircuit(opts.grid, seed);
    if (!route || !route.closed || route.length < TRAFFIC_TUNING.minCircuitMeters) continue;
    const sig = loopSignature(route);
    if (seenLoops.has(sig)) continue;
    seenLoops.add(sig);
    loops.push(route);
  }
  if (!loops.length) return [];

  // Spread `count` vehicles across the loops (round-robin) — multiple cars can
  // share a loop, each at a random phase so they don't stack at the seam.
  const out: BakedVehicle[] = [];
  for (let i = 0; i < opts.count; i++) {
    const route = loops[i % loops.length];
    const doc = opts.garage && opts.garage.length ? opts.garage[i % opts.garage.length] : makeVehicle(opts.seed + i + 1);
    const speed = TRAFFIC_TUNING.cruiseSpeedMin + rng() * (TRAFFIC_TUNING.cruiseSpeedMax - TRAFFIC_TUNING.cruiseSpeedMin);
    out.push({ doc, route, speed, phase: rng() * route.length });
  }
  return out;
}

/** Rotation-invariant key for a loop — the set of its corner cells. Dedupes the
 *  same cycle discovered from different entry points. */
function loopSignature(route: TrafficRoute): string {
  return route.points.map(([x, z]) => `${Math.round(x)},${Math.round(z)}`).sort().join('|');
}

export const GAME_TRAFFIC = Object.freeze({
  tuning: TRAFFIC_TUNING,
  roadCellsFromNav,
  traceFlowCircuit,
  bakeTrafficVehicles,
});
