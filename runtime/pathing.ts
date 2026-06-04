// pathing — the JS face of the host's tile-grid A* (__path_* bindings,
// framework/v8_bindings_pathing.zig). Importing this file is what opts a cart
// into the `pathing` ingredient (sdk/dependency-registry.json metafile gate).
//
// The shape of the capability:
//
//   publishPathGrid({ origin, cellSize, cols, rows, kinds })   // world → host
//   setPathProfile(VEHICLE, { costs, laneOffset: 0.27 })       // per-agent costs
//   const path = findPath(VEHICLE, [x, z], [gx, gz]);          // host A*
//   ... follow path.points until pathDisrupted(path, nextIdx) ...
//   fillPathRect(cx, cz, 1, 1, BLOCKED_KIND);                  // disruption!
//
// Pre-calculated until disrupted: a Path carries the grid generation it was
// computed at. Every grid patch bumps the host generation AND records the
// changed world-rect here; pathDisrupted() answers "did any change since my
// generation touch my REMAINING waypoints" — so one dropped barrier only
// re-paths the agents actually routed through it.
//
// laneOffset shifts waypoints toward travel-right (right = forward x up), so
// opposite directions take opposite sides — vehicles hold their lane,
// pedestrians keep to one edge of the walkway.

export type PathPoint = [number, number]; // world x, z
export type Path = {
  points: PathPoint[];
  generation: number;
};

type ChangeRect = { gen: number; x0: number; z0: number; x1: number; z1: number };

const host: any = globalThis;

// Grid geometry cached from the last publish — change rects are recorded in
// WORLD units so pathDisrupted needs no cell math at query time.
let g_originX = 0;
let g_originZ = 0;
let g_cellSize = 1;

// Recent grid patches (world rects), bounded ring. A path older than the
// oldest recorded change can't be safely tested → conservatively disrupted.
const MAX_CHANGES = 64;
const g_changes: ChangeRect[] = [];

function pathHostReady(): boolean {
  return typeof host.__path_set_grid === 'function';
}

function asU16(kinds: ArrayLike<number>): Uint16Array {
  return kinds instanceof Uint16Array ? kinds : Uint16Array.from(kinds as any);
}

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

/** Publish/replace the whole tile-kind grid. Returns the new generation. */
export function publishPathGrid(opts: {
  origin: [number, number];
  cellSize: number;
  cols: number;
  rows: number;
  /** row-major (z * cols + x) tile-kind INDICES — pair with setPathProfile costs */
  kinds: ArrayLike<number>;
}): number {
  if (!pathHostReady()) return 0;
  g_originX = opts.origin[0];
  g_originZ = opts.origin[1];
  g_cellSize = opts.cellSize;
  g_changes.length = 0; // full republish: every older path is stale anyway
  const gen = Number(host.__path_set_grid(
    opts.origin[0], opts.origin[1], opts.cellSize, opts.cols, opts.rows, asU16(opts.kinds),
  ));
  return Number.isFinite(gen) ? gen : 0;
}

/** Patch a rect of kinds (row-major w×h). Returns the new generation. */
export function updatePathCells(cellX: number, cellZ: number, w: number, h: number, kinds: ArrayLike<number>): number {
  if (!pathHostReady()) return 0;
  const gen = Number(host.__path_update_cells(cellX, cellZ, w, h, asU16(kinds)));
  if (Number.isFinite(gen)) recordChange(cellX, cellZ, w, h, gen);
  return Number.isFinite(gen) ? gen : 0;
}

/** Patch a rect to ONE kind (the obstacle drop / gate open one-liner). */
export function fillPathRect(cellX: number, cellZ: number, w: number, h: number, kindIndex: number): number {
  if (!pathHostReady()) return 0;
  const gen = Number(host.__path_fill_rect(cellX, cellZ, w, h, kindIndex));
  if (Number.isFinite(gen)) recordChange(cellX, cellZ, w, h, gen);
  return Number.isFinite(gen) ? gen : 0;
}

/** Per-agent cost table, indexed by tile-kind index. <=0 / non-finite = that
 *  kind is impassable for this profile. laneOffset in world units.
 *  againstFlow / crossFlow (>= 1) multiply a flowed tile's cost when entered
 *  against / across its flow direction — see setPathFlows. */
export function setPathProfile(profileId: number, opts: {
  costs: ArrayLike<number>;
  laneOffset?: number;
  againstFlow?: number;
  crossFlow?: number;
}): void {
  if (!pathHostReady()) return;
  host.__path_set_profile(
    profileId,
    opts.laneOffset ?? 0,
    opts.againstFlow ?? 1,
    opts.crossFlow ?? 1,
    Float32Array.from(opts.costs as any),
  );
}

/** Flow direction codes for setPathFlows (match the host's A* neighbor order). */
export const PATH_FLOW = { none: 0, posX: 1, negX: 2, posZ: 3, negZ: 4 } as const;

/**
 * Per-KIND flow direction — what makes directional lane TILES directional
 * (hmsc's laneNorth/laneSouth/laneEast/laneWest). A profile pays its
 * againstFlow/crossFlow multipliers to enter a flowed kind the wrong way, so
 * right-hand traffic falls out of the painted grid and turns resolve in
 * flow-neutral junction tiles. Bumps the generation (flows reshape routes).
 */
export function setPathFlows(flows: ArrayLike<number>): number {
  if (!pathHostReady()) return 0;
  const gen = Number(host.__path_set_flows(Uint8Array.from(flows as any)));
  return Number.isFinite(gen) ? gen : 0;
}

/** Host A*: world-coordinate corner waypoints, lane offset applied. null when
 *  no route exists (or the host binding isn't compiled in). */
export function findPath(profileId: number, from: PathPoint, to: PathPoint): Path | null {
  if (!pathHostReady()) return null;
  const buf = host.__path_find(profileId, from[0], from[1], to[0], to[1]);
  if (!buf) return null;
  const f = new Float32Array(buf);
  const generation = f[0];
  const count = f[1] | 0;
  if (count <= 0) return null;
  const points: PathPoint[] = new Array(count);
  for (let i = 0; i < count; i++) points[i] = [f[2 + i * 2], f[3 + i * 2]];
  return { points, generation };
}

export function pathGeneration(): number {
  if (!pathHostReady()) return 0;
  const gen = Number(host.__path_generation());
  return Number.isFinite(gen) ? gen : 0;
}

/**
 * The "until disrupted" test: true iff the grid changed since this path was
 * computed AND a change-rect touches the path's REMAINING segments (from
 * waypoint `nextIndex - 1` on). Margin defaults to one cell so a barrier
 * dropped beside the lane still counts.
 */
export function pathDisrupted(path: Path, nextIndex: number, margin = g_cellSize): boolean {
  const gen = pathGeneration();
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
