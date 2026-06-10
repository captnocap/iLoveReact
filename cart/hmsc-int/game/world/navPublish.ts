// game/world/navPublish — the LIVE half of the nav bake (NAVLIVE-0610): fold
// the active map (painted heightfield landforms + placed pieces) through
// bakeNavGrid and hand the result to the host A* via GAME_PATHING, together
// with the kind-table derivations the routes need:
//
//   • flows        — per-kind PATH_FLOW codes from each kind's `flow` field
//                    (tileFlowVector), what makes lane TILES directional;
//   • kind classes — junction/crosswalk (the lane-discipline opt-in: trio
//                    snap + junction apexes happen host-side once published);
//   • profiles     — WALKER (npc.walkCost) and VEHICLE (npc.vehicleCost)
//                    cost tables straight off the kind registry (P2: the
//                    table is the data; nothing here owns a gameplay number).
//
// THE HOST CAP. framework/game/pathing.zig MAX_CELLS = 16384 (mirrored here
// as PATHING_GRID_LIMITS — keep them in sync, the PHYSICS_LIMITS pattern).
// One painted chunk is 120×120 tiles = 57,600 nav cells at the ruled 0.5m
// resolution, so a real map CANNOT publish whole under today's cap. Rather
// than silently skip (or silently coarsen the user-ruled 0.5m cells), the
// publish WINDOWS: when the full bake fits it ships whole; when it doesn't,
// a square window of host-capacity cells centred on `center` (the player)
// ships instead, and the truncation is REPORTED in the return value (no
// silent caps). Raising MAX_CELLS host-side makes full maps publish again
// with zero changes here — the window is the fallback, not the design.

import { GAME_PATHING, PATH_CLASS, PATH_FLOW } from '../pathing';
import { TILE_KINDS, tileFlowVector, tileKindDefinition } from '../kinds';
import type { PlacedBuildPiece } from '../build/placed';
import type { LandformPlacement } from './grid';
import { bakeNavGrid, NAV_TUNING, type NavGrid } from './navGrid';
import type { TileKind } from '../kinds';

/** Mirror of framework/game/pathing.zig grid bounds — keep in sync. */
export const PATHING_GRID_LIMITS = {
  cells: 16384,
  kinds: 64,
  profiles: 8,
} as const;

/** Profile ids this module publishes. Callers pass these to GAME_PATHING.find. */
export const NAV_PROFILES = { walker: 0, vehicle: 1 } as const;

// ── kind-table derivations (pure, P4-testable) ─────────────────────────────

/** Per-kind PATH_FLOW codes in TILE_KINDS order (none for flow-neutral). */
export function navFlowTable(): Uint8Array {
  const flows = new Uint8Array(TILE_KINDS.length);
  for (let i = 0; i < TILE_KINDS.length; i++) {
    const v = tileFlowVector(TILE_KINDS[i] as TileKind);
    flows[i] = !v ? PATH_FLOW.none
      : v.dx > 0 ? PATH_FLOW.posX
      : v.dx < 0 ? PATH_FLOW.negX
      : v.dz > 0 ? PATH_FLOW.posZ
      : PATH_FLOW.negZ;
  }
  return flows;
}

/** Per-kind lane-discipline classes (junction / crosswalk / plain). */
export function navClassTable(): Uint8Array {
  const classes = new Uint8Array(TILE_KINDS.length);
  for (let i = 0; i < TILE_KINDS.length; i++) {
    const k = TILE_KINDS[i];
    classes[i] = k === 'junction' ? PATH_CLASS.junction
      : k === 'crosswalk' ? PATH_CLASS.crosswalk
      : PATH_CLASS.plain;
  }
  return classes;
}

/** Per-kind A* costs from the registry's npc profile. <=0 = impassable (the
 *  host wire contract), so non-traversable and Infinity both ship as -1. */
export function navProfileCosts(profile: keyof typeof NAV_PROFILES): Float32Array {
  const costs = new Float32Array(TILE_KINDS.length);
  for (let i = 0; i < TILE_KINDS.length; i++) {
    const npc = tileKindDefinition(TILE_KINDS[i] as TileKind).npc;
    const raw = profile === 'vehicle' ? npc.vehicleCost : npc.walkCost;
    costs[i] = npc.traversable && Number.isFinite(raw) && raw > 0 ? raw : -1;
  }
  return costs;
}

// ── the painted ground (landforms → one 1m kind grid) ──────────────────────

export type PaintedGrid = {
  /** world position of cell (0,0)'s min corner */
  origin: [number, number];
  cols: number;
  rows: number;
  /** row-major TILE_KINDS indices, -1 = unpainted */
  kinds: Int16Array;
};

/** Fold every painted landform's per-cell tile grid (field.tiles — the
 *  editor's 1m paint riding the heightfield drape) into ONE world-space 1m
 *  grid over their bounding rect. Landforms without a tile field contribute
 *  nothing. null when nothing painted. */
export function paintedGridFromLandforms(landforms: readonly LandformPlacement[]): PaintedGrid | null {
  type Painted = { minX: number; minZ: number; tiles: { cols: number; rows: number; idx: number[] } };
  const painted: Painted[] = [];
  for (const lf of landforms) {
    const tiles = lf.field?.tiles;
    if (!tiles || tiles.cols <= 0 || tiles.rows <= 0) continue;
    // The tile grid spans the landform footprint at 1 tile = 1m, centred on
    // (centerX, centerZ) — the floorToLandform contract.
    painted.push({ minX: lf.centerX - tiles.cols / 2, minZ: lf.centerZ - tiles.rows / 2, tiles });
  }
  if (!painted.length) return null;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of painted) {
    minX = Math.min(minX, p.minX);
    minZ = Math.min(minZ, p.minZ);
    maxX = Math.max(maxX, p.minX + p.tiles.cols);
    maxZ = Math.max(maxZ, p.minZ + p.tiles.rows);
  }
  minX = Math.floor(minX); minZ = Math.floor(minZ);
  const cols = Math.ceil(maxX) - minX;
  const rows = Math.ceil(maxZ) - minZ;
  const kinds = new Int16Array(cols * rows).fill(-1);
  for (const p of painted) {
    const ox = Math.round(p.minX) - minX;
    const oz = Math.round(p.minZ) - minZ;
    for (let z = 0; z < p.tiles.rows; z++) {
      const src = z * p.tiles.cols;
      const dst = (oz + z) * cols + ox;
      for (let x = 0; x < p.tiles.cols; x++) {
        const v = p.tiles.idx[src + x];
        if (v !== undefined && v >= 0) kinds[dst + x] = v;
      }
    }
  }
  return { origin: [minX, minZ], cols, rows, kinds };
}

/** Clip a painted grid to a square window (side in 1m cells) centred on a
 *  world point, clamped inside the grid. Pure — the windowed-publish step. */
export function clipPaintedGrid(grid: PaintedGrid, center: [number, number], sideCells: number): PaintedGrid {
  const side = Math.max(1, Math.min(sideCells, Math.max(grid.cols, grid.rows)));
  const w = Math.min(side, grid.cols);
  const h = Math.min(side, grid.rows);
  let x0 = Math.round(center[0] - grid.origin[0] - w / 2);
  let z0 = Math.round(center[1] - grid.origin[1] - h / 2);
  x0 = Math.max(0, Math.min(grid.cols - w, x0));
  z0 = Math.max(0, Math.min(grid.rows - h, z0));
  const kinds = new Int16Array(w * h);
  for (let z = 0; z < h; z++) {
    kinds.set(grid.kinds.subarray((z0 + z) * grid.cols + x0, (z0 + z) * grid.cols + x0 + w), z * w);
  }
  return { origin: [grid.origin[0] + x0, grid.origin[1] + z0], cols: w, rows: h, kinds };
}

// ── the publish ─────────────────────────────────────────────────────────────

export type NavPublishResult = {
  /** host generation after the publish (0 = host bindings absent or rejected) */
  generation: number;
  /** what was baked (post-window) */
  cols: number;
  rows: number;
  cellSize: number;
  /** true when the full map exceeded the host cap and a window shipped */
  windowed: boolean;
  /** the window's world centre when windowed */
  center?: [number, number];
  grid: NavGrid | null;
};

const EMPTY_RESULT: NavPublishResult = Object.freeze({
  generation: 0, cols: 0, rows: 0, cellSize: NAV_TUNING.cellSizeMeters, windowed: false, grid: null,
});

/** Bake the active map and publish grid + flows + classes + profiles to the
 *  host. Full-map when it fits PATHING_GRID_LIMITS.cells; otherwise a square
 *  window centred on `center` (player / spawn). Returns what shipped. */
export function publishNavGrid(opts: {
  landforms: readonly LandformPlacement[];
  pieces?: readonly PlacedBuildPiece[];
  /** what unpainted ground paths as */
  emptyKind?: TileKind;
  /** window anchor when the map exceeds the host cap (world x,z) */
  center?: [number, number];
}): NavPublishResult {
  let painted = paintedGridFromLandforms(opts.landforms);
  if (!painted) return EMPTY_RESULT;

  const cell = NAV_TUNING.cellSizeMeters;
  const scale = Math.max(1, Math.round(1 / cell));
  const fits = (g: PaintedGrid) => g.cols * scale * g.rows * scale <= PATHING_GRID_LIMITS.cells;
  let windowed = false;
  let center = opts.center;
  if (!fits(painted)) {
    // Square window of host-capacity nav cells, in 1m tiles.
    const sideTiles = Math.floor(Math.sqrt(PATHING_GRID_LIMITS.cells) / scale);
    center = center ?? [painted.origin[0] + painted.cols / 2, painted.origin[1] + painted.rows / 2];
    painted = clipPaintedGrid(painted, center, sideTiles);
    windowed = true;
  }

  const grid = bakeNavGrid({
    origin: painted.origin,
    cols: painted.cols,
    rows: painted.rows,
    paintedKinds: painted.kinds,
    emptyKind: opts.emptyKind ?? 'mud',
    pieces: opts.pieces,
  });

  const generation = GAME_PATHING.publishGrid({
    origin: grid.origin,
    cellSize: grid.cellSize,
    cols: grid.cols,
    rows: grid.rows,
    kinds: grid.kinds,
  });
  // Tables ride every publish — cheap, and the host swaps them atomically
  // (each bumps the generation, which is what invalidates routes anyway).
  GAME_PATHING.setFlows(navFlowTable());
  GAME_PATHING.setKindClasses(navClassTable());
  GAME_PATHING.setProfile(NAV_PROFILES.walker, { costs: navProfileCosts('walker') });
  GAME_PATHING.setProfile(NAV_PROFILES.vehicle, {
    costs: navProfileCosts('vehicle'),
    // vehicles keep right inside their trio (the host snaps to trio centre;
    // the offset biases toward the legal half) and pay hard for wrong-way.
    laneOffset: 1,
    againstFlow: 8,
    crossFlow: 2,
  });

  return { generation, cols: grid.cols, rows: grid.rows, cellSize: grid.cellSize, windowed, center, grid };
}
