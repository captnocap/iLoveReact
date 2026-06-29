// game/traffic/ — GAME_TRAFFIC: ambient road traffic from HAND-AUTHORED paths
// (USER req_2076), baked for the no-V8 compiled world.
//
// WHOLE-LOOP authoring: the author draws each route by hand in the world editor —
// a TrafficPath is an ordered run of world-space waypoints + a `loop` flag. What's
// drawn IS the car's route. There is NO tile-grid derivation: the old flow-trace
// BFS generator (roadNetworkMask / junctionCells / traceGoalTour / lane-center
// snap / string-pull) was ripped out wholesale (the user's verdict: "this is just
// spaghetti, lets change this up to being hand-authored pathing that can be used").
//
// This file turns authored paths into baked vehicles: each path becomes one or
// more cars (spread evenly by phase) driving its polyline. compile/worldTraffic.ts
// flattens them into the TRAFFIC lump; world_loader.zig samples the polyline per
// frame (arc-length = speed*t + phase, mod loop length).
//
// V5/V21 doctrine made concrete: deterministic, precomputed routes (closed-form
// until a game-state change), zero per-frame pathfinding. A hand-authored path
// network IS V21's "baked dictionary of micro-paths" — this is the doctrine, not
// a retreat from it.

import type { TrafficPath } from '../../design';
import { makeVehicle, type VehicleDoc } from '../vehicle';
import { seededRng } from '../chance';

/** Gameplay knobs — P2 (no inline magic values; one registered table). */
export const TRAFFIC_TUNING = {
  /** city cruise speed (m/s) a path falls back to when it sets no speed. */
  defaultSpeed: 7,
  /** cars per authored path when the path sets no count. */
  defaultCarsPerPath: 1,
  /** reproducibility seed for vehicle looks (deterministic bake). */
  bakeSeed: 1337,
  /** a path needs at least this many distinct waypoints to drive (a line, not a dot). */
  minPoints: 2,
} as const;

/** A baked vehicle route: world-space corner points; `closed` = loops cleanly.
 *  A looping route's last point repeats its first (points[n-1] == points[0]) so
 *  world_loader.zig's sampleRoute wraps seamlessly with no teleport. */
export type TrafficRoute = {
  points: [number, number][];
  closed: boolean;
  /** total arc length (m). */
  length: number;
};

/** One baked vehicle: a visual doc + its route + cruise speed + phase head-start. */
export type BakedVehicle = {
  doc: VehicleDoc;
  route: TrafficRoute;
  /** constant cruise speed (m/s). */
  speed: number;
  /** arc-length head start (m) so multiple cars on one path don't stack. */
  phase: number;
};

/** Build the drivable polyline for an authored path.
 *
 *  The loop seam contract (world_loader.zig sampleRoute): the runtime walks
 *  consecutive segments and does NOT wrap last→first, so a route only loops
 *  cleanly when its last point equals its first. We honour that here:
 *   • a LOOP route is the authored points with the first point appended (close the
 *     ring);
 *   • an OPEN path is mirrored back out-and-back and closed onto its start, so the
 *     car ping-pongs forever without a teleport.
 *  Consecutive duplicate waypoints (a double-click on one cell) are dropped first.
 *  Returns null if fewer than `minPoints` distinct waypoints survive. */
export function routeFromPath(path: TrafficPath): TrafficRoute | null {
  const dedup: [number, number][] = [];
  for (const p of path.points) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.hypot(p.x - last[0], p.z - last[1]) > 1e-3) dedup.push([p.x, p.z]);
  }
  if (dedup.length < TRAFFIC_TUNING.minPoints) return null;

  const points: [number, number][] = path.loop
    ? [...dedup, dedup[0]]
    : [...dedup, ...dedup.slice(0, -1).reverse()]; // A,B,C,D → A,B,C,D,C,B,A (ends at A == start)

  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return { points, closed: true, length };
}

/**
 * Bake the authored traffic paths into vehicles. Each path drives `cars` cars
 * (its own count, else the default) spread evenly by phase along the loop, each
 * with a deterministic look. Paths too short to drive are skipped. Deterministic
 * for a seed — the compiled world is reproducible.
 */
export function bakeAuthoredTraffic(opts: {
  paths: readonly TrafficPath[];
  seed?: number;
  garage?: readonly VehicleDoc[];
}): BakedVehicle[] {
  const seed = opts.seed ?? TRAFFIC_TUNING.bakeSeed;
  const rng = seededRng(seed);
  const out: BakedVehicle[] = [];
  let vehicleSeq = 0;
  for (const path of opts.paths) {
    const route = routeFromPath(path);
    if (!route || route.length <= 1e-4) continue;
    const cars = Math.max(1, Math.floor(path.cars ?? TRAFFIC_TUNING.defaultCarsPerPath));
    const speed = path.speed ?? TRAFFIC_TUNING.defaultSpeed;
    for (let c = 0; c < cars; c++) {
      vehicleSeq += 1;
      const doc = opts.garage && opts.garage.length
        ? opts.garage[vehicleSeq % opts.garage.length]
        : makeVehicle(seed + vehicleSeq);
      // Spread cars evenly around the loop; a small jitter keeps a single-car
      // path from always starting exactly at the first waypoint.
      const phase = ((c / cars) * route.length + rng() * 0.001 * route.length) % route.length;
      out.push({ doc, route, speed, phase });
    }
  }
  return out;
}

export const GAME_TRAFFIC = Object.freeze({
  tuning: TRAFFIC_TUNING,
  routeFromPath,
  bakeAuthoredTraffic,
});
