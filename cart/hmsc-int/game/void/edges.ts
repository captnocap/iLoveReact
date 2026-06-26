// void/edges.ts — the EDGE PROFILE: what the AUTHOR declared the skybox void
// should become past each map edge, so the procedural shell continues it instead
// of dropping generic filler (USER req_2005, supersedes the req_1970 auto-detect).
//
// The author paints void-edge tiles on the real edge of their map (the cell stays
// a real road/water/grass tile — no gap — and ALSO records a VoidEdgeDecl). This
// module turns those sparse per-cell declarations into the few EXITS the void
// generators consume: "a road leaves here, THIS wide, headed THIS way", "a river
// seams out here", "the coast opens here", "grass runs out here". Un-declared
// edges get nothing — the void stays the generic hash-city there (pure opt-in).
//
// Adjacent same-kind cells on the same edge are GROUPED into one wide exit, so a
// painted 10-tile road run continues as one 10-tile road, not ten thin slivers.
//
// Pure function of the authored world + core rectangle — testable headless and
// deterministic (discipline #3). Both the live editor batch and the compiled bake
// share the ONE profile (rule of two — no second copy to drift).

import type { WorldState, VoidEdgeDecl, VoidEdgeKind } from '../../design';
import type { WorldCore } from './distance';

// The four core edges, each with its outward unit normal (axis-aligned — the
// rectangle's sides). Continuations run straight out along these.
export type EdgeSide = 'minX' | 'maxX' | 'minZ' | 'maxZ';
const SIDE_NORMAL: Record<EdgeSide, [number, number]> = {
  minX: [-1, 0], maxX: [1, 0], minZ: [0, -1], maxZ: [0, 1],
};

// A road that leaves the map: boundary-crossing midpoint, outward normal, width.
export type RoadExit = { x: number; z: number; nx: number; nz: number; width: number };
// Water leaving the map: + how wide along the edge, its surface height, and
// whether it's the open coast (sea) or a river.
export type WaterEdge = { x: number; z: number; nx: number; nz: number; span: number; surfaceY: number; sea: boolean };
// Grass running out past the map: a field strip of this width heads outward.
export type GrassEdge = { x: number; z: number; nx: number; nz: number; span: number };

export type EdgeProfile = { roadExits: RoadExit[]; waterEdges: WaterEdge[]; grassEdges: GrassEdge[] };
export const EMPTY_EDGE_PROFILE: EdgeProfile = { roadExits: [], waterEdges: [], grassEdges: [] };

// Default void-water surface height when no authored body is nearby to match —
// roughly ground level, so the river/sea reads as sitting in the world.
const DEFAULT_VOID_WATER_Y = 0;

// Which map edge a declared cell sits on = the nearest core side. Edge cells land
// within half a cell of their boundary, so the min distance is unambiguous.
function sideOf(wx: number, wz: number, core: WorldCore): EdgeSide {
  const d: Record<EdgeSide, number> = {
    minX: wx - core.minX, maxX: core.maxX - wx, minZ: wz - core.minZ, maxZ: core.maxZ - wz,
  };
  let best: EdgeSide = 'minX';
  for (const s of Object.keys(d) as EdgeSide[]) if (d[s] < d[best]) best = s;
  return best;
}

// The boundary X (or Z) the exits sit on for a side — the rim of the authored map.
function edgeAxisValue(side: EdgeSide, core: WorldCore): number {
  return side === 'minX' ? core.minX : side === 'maxX' ? core.maxX : side === 'minZ' ? core.minZ : core.maxZ;
}

// Nearest authored water surface to a point, so a void river/sea continues at the
// SAME level as the lake it grows from (no step at the seam). Falls back to a flat
// default when the author declared water with no body nearby.
function nearestWaterSurfaceY(world: WorldState, wx: number, wz: number): number {
  let best = DEFAULT_VOID_WATER_Y;
  let bestD = Infinity;
  for (const b of world.waterBodies ?? []) {
    const cx = Math.max(b.x, Math.min(wx, b.x + b.width));
    const cz = Math.max(b.z, Math.min(wz, b.z + b.depth));
    const dist = Math.hypot(wx - cx, wz - cz);
    if (dist < bestD) { bestD = dist; best = b.surfaceY; }
  }
  return best;
}

// Read the authored declarations → the exits the void generators continue. Pure;
// memoize on the world where it's called.
export function buildEdgeProfile(world: WorldState, core: WorldCore): EdgeProfile {
  const out = EMPTY_EDGE_PROFILE;
  if (!world || !(core.maxX > core.minX) || !(core.maxZ > core.minZ)) return out;
  const cell = world.cellSizeMeters;
  const decls = world.voidEdges ?? [];
  if (decls.length === 0) return { roadExits: [], waterEdges: [], grassEdges: [] };

  // Bucket by (side, kind); within a bucket sort by tangential cell index and
  // merge adjacent cells into runs.
  const buckets = new Map<string, { t: number; cellWx: number; cellWz: number }[]>();
  for (const d of decls) {
    const wx = (d.x + 0.5) * cell;
    const wz = (d.z + 0.5) * cell;
    const side = sideOf(wx, wz, core);
    const tangential = side === 'minX' || side === 'maxX' ? d.z : d.x;
    const key = `${side}|${d.kind}`;
    const arr = buckets.get(key) ?? [];
    arr.push({ t: tangential, cellWx: wx, cellWz: wz });
    buckets.set(key, arr);
  }

  const roadExits: RoadExit[] = [];
  const waterEdges: WaterEdge[] = [];
  const grassEdges: GrassEdge[] = [];
  for (const [key, cells] of buckets) {
    const [sideStr, kindStr] = key.split('|');
    const side = sideStr as EdgeSide;
    const kind = kindStr as VoidEdgeKind;
    const [nx, nz] = SIDE_NORMAL[side];
    const alongX = side === 'minZ' || side === 'maxZ'; // edge runs along X
    cells.sort((a, b) => a.t - b.t);
    // Walk sorted cells, breaking a run wherever a gap > 1 cell appears.
    let start = 0;
    for (let i = 1; i <= cells.length; i += 1) {
      const broken = i === cells.length || cells[i]!.t - cells[i - 1]!.t > 1;
      if (!broken) continue;
      const run = cells.slice(start, i);
      start = i;
      const span = run.length * cell;
      // Exit sits on the boundary rim, centred on the run.
      const midT = (run[0]!.t + run[run.length - 1]!.t) / 2;
      const midMeters = (midT + 0.5) * cell;
      const x = alongX ? midMeters : edgeAxisValue(side, core);
      const z = alongX ? edgeAxisValue(side, core) : midMeters;
      if (kind === 'road') roadExits.push({ x, z, nx, nz, width: span });
      else if (kind === 'grass') grassEdges.push({ x, z, nx, nz, span });
      else waterEdges.push({ x, z, nx, nz, span, surfaceY: nearestWaterSurfaceY(world, x, z), sea: kind === 'sea' });
    }
  }
  return { roadExits, waterEdges, grassEdges };
}
