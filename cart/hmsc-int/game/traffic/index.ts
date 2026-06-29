// game/traffic/ — GAME_TRAFFIC: ambient road traffic, slice 1 (vehicles).
//
// The doctrine (V5): "pathing_lab's host A* + deterministic motion plans are
// the START of the real traffic and civilian systems … ALL NPC pathing is
// deterministic until a game-state change." This module is that seed. Each
// vehicle agent is a DETERMINISTIC motion plan along a host-A* route: position
// is a pure function of time (runtime/motion sampleMotion) until the plan ends
// and the agent retargets. No per-frame integration, no allocation in the hot
// path — the same plan-once/sample-exactly contract the player's locomotion and
// the cutscene rails already ride.
//
// THE PIPELINE the user named ("we already have road pathing, start there"):
//   1. the live nav publish (NAVLIVE-0610) bakes the active map → host A* grid
//      with the VEHICLE profile (right-hand lane discipline, wrong-way penalty);
//   2. roadCellsFromNav reads that baked grid back for vehicle-road cells — the
//      spawn/destination pool;
//   3. createTrafficSim seeds N agents, routes each between road cells via
//      GAME_PATHING.find, and drives it with GAME_PATHING.planMotion;
//   4. the render layer samples each agent's pose per frame.
//
// The V21 ambient end-state (token-dictionary micro-paths, population
// homeostasis) supersedes the per-agent A* here for the FROZEN world at scale —
// this is the live, in-bubble traffic the deterministic seed buys first.

import { TILE_KINDS, tileKindDefinition } from '../kinds';
import type { NavGrid } from '../world/navGrid';
import { GAME_PATHING } from '../pathing';
import type { MotionPlan, MotionProfile, Path, PathPoint } from '../pathing';
import { makeVehicle, type VehicleDoc } from '../vehicle';
import { seededRng } from '../chance';

/** Gameplay knobs — P2 (no inline magic values; one registered table). */
export const TRAFFIC_TUNING = {
  /** the city driving feel — modest top speed, gentle throttle/brakes (m/s, m/s²). */
  vehicleProfile: { maxSpeed: 9, accel: 3, decel: 5, minCornerSpeed: 2 } as MotionProfile,
  /** cap on road cells scanned out of the baked grid (the spawn/dest pool). */
  maxRoadPoints: 4096,
  /** a retarget route shorter than this (m) is rejected — keep trips worth driving. */
  minTripMeters: 12,
  /** how many destinations to try before an agent gives up this tick. */
  retargetAttempts: 6,
} as const;

/** A road cell center in world space, pulled from the baked nav grid. */
export type RoadPoint = PathPoint;

/**
 * Every vehicle-preferred road cell center in the baked nav grid, in world
 * space. "Road" = the kind's npc profile is `preferredByVehicles` (lanes,
 * junctions, plain road) — the same registry flag the A* cost table reads, so
 * the pool and the routing agree by construction. Strided to `maxRoadPoints`
 * when a window is dense, and the truncation is the caller's to notice (the
 * count is returned).
 */
export function roadCellsFromNav(
  grid: NavGrid,
  maxPoints = TRAFFIC_TUNING.maxRoadPoints,
): RoadPoint[] {
  const isRoadKind = roadKindMask();
  const [ox, oz] = grid.origin;
  const cell = grid.cellSize;
  const points: RoadPoint[] = [];
  for (let z = 0; z < grid.rows; z++) {
    for (let x = 0; x < grid.cols; x++) {
      const idx = grid.kinds[z * grid.cols + x];
      if (!isRoadKind[idx]) continue;
      points.push([ox + (x + 0.5) * cell, oz + (z + 0.5) * cell]);
    }
  }
  if (points.length <= maxPoints) return points;
  // Even stride keeps the pool spread across the window instead of clipping a corner.
  const stride = Math.ceil(points.length / maxPoints);
  const strided: RoadPoint[] = [];
  for (let i = 0; i < points.length; i += stride) strided.push(points[i]);
  return strided;
}

/** TILE_KINDS-indexed boolean: is this kind a vehicle road? (computed once.) */
function roadKindMask(): boolean[] {
  const mask = new Array<boolean>(TILE_KINDS.length);
  for (let i = 0; i < TILE_KINDS.length; i++) {
    mask[i] = tileKindDefinition(TILE_KINDS[i]).npc.preferredByVehicles === true;
  }
  return mask;
}

/** One live traffic agent: a vehicle visual + its current motion plan. */
export type TrafficAgent = {
  id: string;
  doc: VehicleDoc;
  /** the live deterministic plan; null between retargets (stationary that tick). */
  plan: MotionPlan | null;
  /** where the next route starts from (last sampled position). */
  at: PathPoint;
  /** the grid generation the live plan's route was found at (disruption check). */
  routeGeneration: number;
};

/** A pose read for one agent at a time t — what the render layer draws. */
export type TrafficPose = {
  id: string;
  doc: VehicleDoc;
  x: number;
  z: number;
  /** travel heading in degrees (atan2(dx,dz) — forward = [sin,cos]). */
  headingDeg: number;
  speed: number;
};

export type TrafficFindPath = (profileId: number, from: PathPoint, to: PathPoint) => Path | null;

export type TrafficSimOptions = {
  /** the baked nav grid (GAME_WORLD.publishNavGrid().grid). */
  grid: NavGrid;
  /** how many vehicles to populate. */
  count: number;
  /** reproducibility seed. */
  seed: number;
  /** the nav VEHICLE profile id (GAME_WORLD.navProfiles.vehicle). */
  vehicleProfile: number;
  /** authored garage docs to draw from, cycled; falls back to makeVehicle(seed). */
  garage?: readonly VehicleDoc[];
  /** host A* (injected for tests); defaults to GAME_PATHING.find. */
  find?: TrafficFindPath;
};

/**
 * The live traffic sim. `advance(now)` keeps every agent on a route (retargets
 * the moment a plan finishes or its route is disrupted); `poses(now)` reads the
 * exact pose of each agent at time t. Deterministic for a given seed + grid.
 */
export type TrafficSim = {
  agents: TrafficAgent[];
  /** count of road cells the spawn/dest pool was drawn from. */
  roadPointCount: number;
  advance(now: number): void;
  poses(now: number): TrafficPose[];
};

export function createTrafficSim(opts: TrafficSimOptions): TrafficSim {
  const find = opts.find ?? GAME_PATHING.find;
  const profile = TRAFFIC_TUNING.vehicleProfile;
  const roadPoints = roadCellsFromNav(opts.grid);
  const rng = seededRng(opts.seed);
  const agents: TrafficAgent[] = [];

  const randomRoadPoint = (): RoadPoint | null =>
    roadPoints.length ? roadPoints[Math.floor(rng() * roadPoints.length)] : null;

  for (let i = 0; i < opts.count; i++) {
    const spawn = randomRoadPoint();
    if (!spawn) break;
    const doc = opts.garage && opts.garage.length
      ? opts.garage[i % opts.garage.length]
      : makeVehicle(opts.seed + i + 1);
    agents.push({ id: `traffic.${i}`, doc, plan: null, at: spawn, routeGeneration: 0 });
  }

  /** Route an agent to a fresh distant road cell and plan its drive. */
  const retarget = (agent: TrafficAgent, now: number, startSpeed: number): void => {
    for (let attempt = 0; attempt < TRAFFIC_TUNING.retargetAttempts; attempt++) {
      const dest = randomRoadPoint();
      if (!dest) return;
      if (Math.hypot(dest[0] - agent.at[0], dest[1] - agent.at[1]) < TRAFFIC_TUNING.minTripMeters) continue;
      const path = find(opts.vehicleProfile, agent.at, dest);
      if (!path || path.points.length < 2) continue;
      agent.plan = GAME_PATHING.planMotion(path.points, { startTime: now, profile, startSpeed });
      agent.routeGeneration = path.generation;
      return;
    }
  };

  return {
    agents,
    roadPointCount: roadPoints.length,
    advance(now: number) {
      for (const agent of agents) {
        const plan = agent.plan;
        if (plan && now - plan.t0 < plan.duration) {
          // Mid-route: hold the plan unless the grid changed under it.
          if (!GAME_PATHING.disrupted({ points: plan.points, generation: agent.routeGeneration }, 1)) continue;
          const cut = GAME_PATHING.sampleMotion(plan, now);
          agent.at = [cut.x, cut.z];
          retarget(agent, now, cut.speed);
          continue;
        }
        // No plan, or the plan just finished — settle at the end and drive on.
        if (plan) {
          const end = GAME_PATHING.sampleMotion(plan, now);
          agent.at = [end.x, end.z];
        }
        retarget(agent, now, 0);
      }
    },
    poses(now: number): TrafficPose[] {
      const out: TrafficPose[] = [];
      for (const agent of agents) {
        if (!agent.plan) continue;
        const m = GAME_PATHING.sampleMotion(agent.plan, now);
        out.push({ id: agent.id, doc: agent.doc, x: m.x, z: m.z, headingDeg: m.headingDeg, speed: m.speed });
      }
      return out;
    },
  };
}

export const GAME_TRAFFIC = Object.freeze({
  tuning: TRAFFIC_TUNING,
  roadCellsFromNav,
  createTrafficSim,
});
