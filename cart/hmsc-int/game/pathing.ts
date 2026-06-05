// game/pathing.ts — GAME_PATHING: host A* routes, lane discipline, and
// deterministic motion plans (V5).
//
// V5 doctrine: ALL NPC pathing is deterministic until a game-state change —
// routes precomputed by the host (framework/game/pathing.zig via the
// v8_bindings_game_pathing registrar), the player's effect on the world
// (a grid patch, a flow change) bumps the generation and is what
// invalidates them. Lane discipline (trio-center snap + junction apexes,
// the pathing_lab capture) is HOST-side; publishing kind classes
// (setKindClasses) is the opt-in.
//
// This door speaks the honest `__game_pathing_*` wire directly. The packed
// formats are the host's contract:
//   find  → Float32 [generation, count, x0, z0, ...]
//   plan  → Float64 [t0, duration, total, npoints, nphases,
//                    points×(x,z), cum×n, phases×(t,s,v,a,dt)]
// Plans are COMPILED host-side when the binary carries the bindings and
// unpacked here into the MotionPlan shape; SAMPLING stays JS closed-form
// (a pure function of t — zero bridge calls per frame, scrub/rewind free,
// V16). Headless (tests, the verify harness) the JS mirror in
// runtime/motion.ts builds the identical schedule.
//
// P2: profile costs, lane offsets, flow penalties, kind classes, and motion
// profiles are caller data — nothing here owns a gameplay number.

import { planMotion as planMotionJs, pointOnPath, measurePath, sampleMotion, slicePath, slicePoints } from '@reactjit/motion';
import type { MotionPlan, MotionProfile, MotionSample } from '@reactjit/motion';

export type PathPoint = [number, number]; // world x, z
export type Path = {
  points: PathPoint[];
  /** the grid generation this route was computed at — the V5 validity tag */
  generation: number;
};

export type { MotionPlan, MotionProfile, MotionSample };

declare const globalThis: any;
const host: any = globalThis;

/** True when the host pathing bindings are compiled into this binary. */
export function pathingHostReady(): boolean {
  return typeof host.__game_pathing_set_grid === 'function';
}

// ── the disruption ledger ──────────────────────────────────────────────────
// Grid geometry cached from the last publish — every patch records its
// world-rect in a bounded ring so disrupted() answers "did any change since
// my generation touch my REMAINING waypoints" without a bridge call. One
// dropped barrier re-paths only the agents actually routed through it.

type ChangeRect = { gen: number; x0: number; z0: number; x1: number; z1: number };

const MAX_CHANGES = 64;
let g_originX = 0;
let g_originZ = 0;
let g_cellSize = 1;
const g_changes: ChangeRect[] = [];

function recordChange(cellX: number, cellZ: number, w: number, h: number, gen: number): void {
  g_changes.push({
    gen,
    x0: g_originX + cellX * g_cellSize,
    z0: g_originZ + cellZ * g_cellSize,
    x1: g_originX + (cellX + w) * g_cellSize,
    z1: g_originZ + (cellZ + h) * g_cellSize,
  });
  if (g_changes.length > MAX_CHANGES) g_changes.splice(0, g_changes.length - MAX_CHANGES);
}

function asU16(values: ArrayLike<number>): Uint16Array {
  return values instanceof Uint16Array ? values : Uint16Array.from(values as any);
}

function genOf(value: unknown): number {
  const gen = Number(value);
  return Number.isFinite(gen) ? gen : 0;
}

// ── the grid (world → host) ────────────────────────────────────────────────

/** Publish/replace the whole tile-kind grid. Returns the new generation. */
function publishGrid(opts: {
  origin: [number, number];
  cellSize: number;
  cols: number;
  rows: number;
  /** row-major (z * cols + x) tile-kind INDICES — pair with setProfile costs */
  kinds: ArrayLike<number>;
}): number {
  if (!pathingHostReady()) return 0;
  g_originX = opts.origin[0];
  g_originZ = opts.origin[1];
  g_cellSize = opts.cellSize;
  g_changes.length = 0; // full republish: every older route is stale anyway
  return genOf(host.__game_pathing_set_grid(
    opts.origin[0], opts.origin[1], opts.cellSize, opts.cols, opts.rows, asU16(opts.kinds),
  ));
}

/** Patch a rect of kinds (row-major w×h). Returns the new generation. */
function updateCells(cellX: number, cellZ: number, w: number, h: number, kinds: ArrayLike<number>): number {
  if (!pathingHostReady()) return 0;
  const gen = genOf(host.__game_pathing_update_cells(cellX, cellZ, w, h, asU16(kinds)));
  if (gen) recordChange(cellX, cellZ, w, h, gen);
  return gen;
}

/** Patch a rect to ONE kind (the obstacle drop / gate open one-liner). */
function fillRect(cellX: number, cellZ: number, w: number, h: number, kindIndex: number): number {
  if (!pathingHostReady()) return 0;
  const gen = genOf(host.__game_pathing_fill_rect(cellX, cellZ, w, h, kindIndex));
  if (gen) recordChange(cellX, cellZ, w, h, gen);
  return gen;
}

/** Per-agent cost table indexed by tile-kind index; <=0 / non-finite =
 *  impassable. laneOffset in world units toward travel-right; the flow
 *  penalties (>= 1) multiply a flowed tile's cost entered against / across
 *  its flow. All caller data (P2). */
function setProfile(profileId: number, opts: {
  costs: ArrayLike<number>;
  laneOffset?: number;
  againstFlow?: number;
  crossFlow?: number;
}): void {
  if (!pathingHostReady()) return;
  host.__game_pathing_set_profile(
    profileId,
    opts.laneOffset ?? 0,
    opts.againstFlow ?? 1,
    opts.crossFlow ?? 1,
    Float32Array.from(opts.costs as any),
  );
}

/** Flow direction codes (match the host's A* neighbor order). */
export const PATH_FLOW = { none: 0, posX: 1, negX: 2, posZ: 3, negZ: 4 } as const;

/** Per-KIND flow direction — what makes directional lane TILES directional.
 *  Bumps the generation (flows reshape every precomputed route). */
function setFlows(flows: ArrayLike<number>): number {
  if (!pathingHostReady()) return 0;
  return genOf(host.__game_pathing_set_flows(Uint8Array.from(flows as any)));
}

/** Per-KIND class codes for setKindClasses. */
export const PATH_CLASS = { plain: 0, junction: 1, crosswalk: 2 } as const;

/** Publish per-KIND classes — the LANE-DISCIPLINE opt-in (V5): with classes
 *  on the host, every route gets the trio-center snap and junction apexes.
 *  Bumps the generation. */
function setKindClasses(classes: ArrayLike<number>): number {
  if (!pathingHostReady()) return 0;
  return genOf(host.__game_pathing_set_kind_classes(Uint8Array.from(classes as any)));
}

// ── routes (pre-calculated until disrupted) ────────────────────────────────

/** Host A*: world-coordinate waypoints, lane discipline applied when classes
 *  are published. null when no route exists (or the bindings aren't in). */
function find(profileId: number, from: PathPoint, to: PathPoint): Path | null {
  if (!pathingHostReady()) return null;
  const buf = host.__game_pathing_find(profileId, from[0], from[1], to[0], to[1]);
  if (!buf) return null;
  const f = new Float32Array(buf);
  const generation = f[0];
  const count = f[1] | 0;
  if (count <= 0) return null;
  const points: PathPoint[] = new Array(count);
  for (let i = 0; i < count; i++) points[i] = [f[2 + i * 2], f[3 + i * 2]];
  return { points, generation };
}

function generation(): number {
  if (!pathingHostReady()) return 0;
  return genOf(host.__game_pathing_generation());
}

/** The "until disrupted" test: true iff the grid changed since this route
 *  was computed AND a change-rect touches its REMAINING segments (from
 *  waypoint `nextIndex - 1` on). Margin defaults to one cell so a barrier
 *  dropped beside the lane still counts. */
function disrupted(path: Path, nextIndex: number, margin = g_cellSize): boolean {
  const gen = generation();
  if (gen === path.generation) return false;
  // changes older than our ring are unknowable → conservative
  if (g_changes.length === 0 || g_changes[0].gen > path.generation + 1) return true;
  const startIdx = Math.max(0, nextIndex - 1);
  for (const c of g_changes) {
    if (c.gen <= path.generation) continue;
    const x0 = c.x0 - margin, z0 = c.z0 - margin;
    const x1 = c.x1 + margin, z1 = c.z1 + margin;
    for (let i = startIdx; i < path.points.length; i++) {
      const a = path.points[Math.max(startIdx, i - 1)];
      const b = path.points[i];
      // segment bbox vs change rect — over-triggers a little, never misses
      if (Math.max(a[0], b[0]) < x0 || Math.min(a[0], b[0]) > x1) continue;
      if (Math.max(a[1], b[1]) < z0 || Math.min(a[1], b[1]) > z1) continue;
      return true;
    }
  }
  return false;
}

// ── deterministic motion (position is a pure function of t) ───────────────

const PLAN_HEADER = 5;
const PHASE_FLOATS = 5;

/** Unpack the host's packed f64 plan into the MotionPlan shape. */
function unpackPlan(buf: ArrayBuffer): MotionPlan | null {
  const f = new Float64Array(buf);
  if (f.length < PLAN_HEADER) return null;
  const n = f[3] | 0;
  const nphases = f[4] | 0;
  if (f.length < PLAN_HEADER + n * 3 + nphases * PHASE_FLOATS) return null;
  const points: [number, number][] = new Array(n);
  const cum: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    points[i] = [f[PLAN_HEADER + i * 2], f[PLAN_HEADER + i * 2 + 1]];
    cum[i] = f[PLAN_HEADER + n * 2 + i];
  }
  const phases = new Array(nphases);
  const base = PLAN_HEADER + n * 3;
  for (let i = 0; i < nphases; i++) {
    const at = base + i * PHASE_FLOATS;
    phases[i] = { t: f[at], s: f[at + 1], v: f[at + 2], a: f[at + 3], dt: f[at + 4] };
  }
  return { t0: f[0], duration: f[1], total: f[2], points, cum, phases };
}

/** Build the deterministic schedule — host-compiled when the bindings are
 *  in, identical JS math headless. The plan always ENDS AT REST; to keep
 *  cruising past an obstacle that cleared, replan with the remaining
 *  points. Sampling is always JS closed-form (sampleMotion). */
function planMotion(points: [number, number][], opts: {
  startTime: number;
  profile: MotionProfile;
  startSpeed?: number;
}): MotionPlan {
  if (typeof host.__game_pathing_plan === 'function' && points.length <= 1024) {
    const flat = new Float64Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      flat[i * 2] = points[i][0];
      flat[i * 2 + 1] = points[i][1];
    }
    const buf = host.__game_pathing_plan(
      opts.startTime,
      opts.startSpeed ?? 0,
      opts.profile.maxSpeed,
      opts.profile.accel,
      opts.profile.decel,
      opts.profile.minCornerSpeed ?? 1.3, // the reference default (runtime/motion.ts)
      flat,
    );
    if (buf) {
      const plan = unpackPlan(buf);
      if (plan) return plan;
    }
  }
  return planMotionJs(points, opts);
}

export const GAME_PATHING = Object.freeze({
  hostReady: pathingHostReady,

  // ── the grid (world → host) ────────────────────────────────────────────
  publishGrid,
  updateCells,
  fillRect,
  setProfile,
  setFlows,
  setKindClasses,
  FLOW: PATH_FLOW,
  CLASS: PATH_CLASS,

  // ── routes (pre-calculated until disrupted) ────────────────────────────
  find,
  generation,
  disrupted,

  // ── deterministic motion (position is a pure function of t) ────────────
  planMotion,
  sampleMotion,
  slicePath,
  slicePoints,
  measurePath,
  pointOnPath,
});
