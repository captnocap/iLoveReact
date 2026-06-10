// game/world/navGrid — the NAV BAKE (MICROGRID-0610): the world → path-grid
// derivation. GAME_PATHING.publishGrid has had a typed wire and ZERO producers;
// this module is the producer — ONE pure function folding the three world
// layers into the kind grid the host A* consumes:
//
//   1. PAINTED ground — the editor's 1m tile cells, upsampled to nav cells
//      (unpainted ground paths as the caller's emptyKind).
//   2. FLOOR MICRO-CELLS — ground-level floor pieces project their 3×3 kinds
//      (game/build/microGrid): building interiors become pathable surface.
//      Elevated floors (y above groundLevelMaxYMeters) are EXCLUDED — they
//      await the multi-level surface-nav lane; nothing here precludes it.
//   3. PIECE COLLIDERS — the SAME placedPieceColliders geometry live-play
//      physics uses (V24: one model). Ground-band blockers stamp the wall
//      kind; door/arch/garage openings need NO special case here because the
//      collider bands are already SPLIT around them — the opening's cells
//      simply keep their floor kind and stay walkable. Overhead bands (a band
//      whose bottom clears head height) never block; curb-height tops within
//      the walker's step-up never block. Props are placed pieces too, so the
//      user's dresser blocks its footprint cells by DERIVATION — move the
//      dresser, the cells free themselves.
//
// RESOLUTION: nav cells default to 0.5m — 2×2 per tile. The grid is per-CELL
// kinds, so it cannot express "this 1m cell's edge is blocked"; at 0.5m a
// thin wall ON a tile boundary blocks exactly the two quarter-strips its slab
// overlaps instead of eating a full meter off both rooms. This is the
// "finer grid within the tile system" the user asked for, applied where it
// matters (pathing legality) without touching the authored 1m substrate.
//
// Pure CPU, no host calls — the caller hands the result to
// GAME_PATHING.publishGrid. P4 suite: navGrid.test.ts.

import { TILE_KIND_INDEX, type TileKind } from '../kinds';
import { placedPieceColliders, placedPieceDef, pieceBounds, type PlacedBuildPiece } from '../build/placed';
import { carriesMicroGrid, floorCellRects } from '../build/microGrid';

export const NAV_TUNING = {
  /** nav cells are this fraction of a tile — 0.5m = 2×2 per 1m cell */
  cellSizeMeters: 0.5,
  /** pieces BASED at/below this are ground level and project into the grid */
  groundLevelMaxYMeters: 0.5,
  /** a collider band whose bottom clears this is overhead — walk under it */
  walkUnderClearanceMeters: 1.5,
  /** a solid top at/below this is a curb/pad — step up, never a blocker */
  stepUpMeters: 0.35,
  /** a rect must overlap a nav cell by more than this (meters) to claim it —
   *  flush-touching neighbours stay free */
  overlapEpsilonMeters: 0.02,
  /** what blocked cells stamp as (full-block profile, LoS irrelevant here) */
  blockKind: 'wall' as TileKind,
  /** what ramp/stair footprints stamp as (walkable link surface) */
  linkKind: 'sidewalk' as TileKind,
} as const;

export type NavGrid = {
  origin: [number, number];
  cellSize: number;
  cols: number;
  rows: number;
  /** row-major TILE_KINDS indices — publishGrid-ready */
  kinds: Uint16Array;
};

export function bakeNavGrid(opts: {
  /** world position of painted cell (0,0)'s min corner */
  origin: [number, number];
  /** painted grid dimensions, 1m tiles */
  cols: number;
  rows: number;
  /** row-major painted TILE_KINDS indices, -1 = unpainted */
  paintedKinds: ArrayLike<number>;
  /** what unpainted ground paths as */
  emptyKind: TileKind;
  pieces?: readonly PlacedBuildPiece[];
  cellSize?: number;
}): NavGrid {
  const cell = opts.cellSize ?? NAV_TUNING.cellSizeMeters;
  const scale = Math.max(1, Math.round(1 / cell));
  const cols = opts.cols * scale;
  const rows = opts.rows * scale;
  const kinds = new Uint16Array(cols * rows);
  const emptyIdx = TILE_KIND_INDEX[opts.emptyKind];

  // 1) painted ground, upsampled (each tile spans scale×scale nav cells).
  for (let z = 0; z < rows; z++) {
    const tz = Math.floor(z / scale);
    for (let x = 0; x < cols; x++) {
      const tx = Math.floor(x / scale);
      const k = Number(opts.paintedKinds[tz * opts.cols + tx]);
      kinds[z * cols + x] = k >= 0 ? k : emptyIdx;
    }
  }

  const pieces = opts.pieces ?? [];
  const grid: NavGrid = { origin: [opts.origin[0], opts.origin[1]], cellSize: cell, cols, rows, kinds };
  if (!pieces.length) return grid;

  const eps = NAV_TUNING.overlapEpsilonMeters;
  const stampRect = (minX: number, minZ: number, maxX: number, maxZ: number, kindIdx: number) => {
    const x0 = Math.max(0, Math.floor((minX - opts.origin[0] + eps) / cell));
    const x1 = Math.min(cols - 1, Math.ceil((maxX - opts.origin[0] - eps) / cell) - 1);
    const z0 = Math.max(0, Math.floor((minZ - opts.origin[1] + eps) / cell));
    const z1 = Math.min(rows - 1, Math.ceil((maxZ - opts.origin[1] - eps) / cell) - 1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) kinds[z * cols + x] = kindIdx;
  };

  // 2) ground-level floors: the 3×3 micro-cells (kind per cell).
  //    Then ramps/stairs as walkable link footprints.
  for (const piece of pieces) {
    if (piece.y > NAV_TUNING.groundLevelMaxYMeters) continue;
    const def = placedPieceDef(piece);
    if (carriesMicroGrid(def.kind)) {
      for (const r of floorCellRects(piece)) stampRect(r.minX, r.minZ, r.maxX, r.maxZ, TILE_KIND_INDEX[r.kind]);
    } else if (def.kind === 'ramp' || def.kind === 'stairs') {
      const b = pieceBounds(piece);
      stampRect(b.minX, b.minZ, b.maxX, b.maxZ, TILE_KIND_INDEX[NAV_TUNING.linkKind]);
    }
  }

  // 3) collider blocking — the live-play collision geometry, ground bands only.
  //    Door/arch openings are already gaps in these bands, so they stay open.
  //    Ramps/stairs are EXCLUDED: their collider bands ARE the walkable slope
  //    (full-width sloped slab strips, blocksPlayer for side collision) — the
  //    link stamp above is their nav truth, not a wall.
  const blockIdx = TILE_KIND_INDEX[NAV_TUNING.blockKind];
  const blockers = pieces.filter((p) => {
    const k = placedPieceDef(p).kind;
    return k !== 'ramp' && k !== 'stairs';
  });
  const colliders = placedPieceColliders(blockers);
  for (const r of colliders.rects) {
    if (!r.blocksPlayer) continue;
    if ((r.floorMeters ?? 0) > NAV_TUNING.walkUnderClearanceMeters) continue;
    if (r.topMeters <= NAV_TUNING.stepUpMeters) continue;
    stampRect(r.minX, r.minZ, r.maxX, r.maxZ, blockIdx);
  }
  for (const o of colliders.orientedRects) {
    if (!o.blocksPlayer) continue;
    if ((o.floorMeters ?? 0) > NAV_TUNING.walkUnderClearanceMeters) continue;
    if (o.topMeters <= NAV_TUNING.stepUpMeters) continue;
    // conservative envelope of the rotated rect about its pivot
    const hx = (o.maxX - o.minX) / 2;
    const hz = (o.maxZ - o.minZ) / 2;
    const cx = (o.minX + o.maxX) / 2 - o.pivotX;
    const cz = (o.minZ + o.maxZ) / 2 - o.pivotZ;
    const cos = Math.abs(Math.cos(o.yawRadians));
    const sin = Math.abs(Math.sin(o.yawRadians));
    const ex = hx * cos + hz * sin;
    const ez = hx * sin + hz * cos;
    const rcx = o.pivotX + cx * Math.cos(o.yawRadians) - cz * Math.sin(o.yawRadians);
    const rcz = o.pivotZ + cx * Math.sin(o.yawRadians) + cz * Math.cos(o.yawRadians);
    stampRect(rcx - ex, rcz - ez, rcx + ex, rcz + ez, blockIdx);
  }

  return grid;
}

/** Read one nav cell's kind index by WORLD position (debug/test convenience). */
export function navKindAt(grid: NavGrid, x: number, z: number): number {
  const cx = Math.floor((x - grid.origin[0]) / grid.cellSize);
  const cz = Math.floor((z - grid.origin[1]) / grid.cellSize);
  if (cx < 0 || cz < 0 || cx >= grid.cols || cz >= grid.rows) return -1;
  return grid.kinds[cz * grid.cols + cx]!;
}
