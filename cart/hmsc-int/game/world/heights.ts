// game/world/heights — ground-height + footing semantics over the world grid.
//
// Fresh capture of cart/hmsc/world/surfaceHeights.ts + the height/footing
// queries of cart/hmsc/world/grid.ts and the GameState-coupled landform
// queries of cart/hmsc/world/landforms/registry.ts (behavior references only;
// game/kinds' capture note explicitly deferred these here). The landform kind
// MEANING (rise formulas, walkCos, footprint) stays in game/kinds — this
// module only iterates the world's landform instances and asks the registry.
//
// Two distinct height questions, kept distinct on purpose:
//   • groundTopAtWorldPosition — WALKABLE ground under a point, gated by tile
//     walkability, landform slope limits, and the step-height reach. What the
//     player can stand on (spawn/teleport/pathing; live collision is the
//     host's).
//   • landformGroundTopAt — the RAW landform surface top, no walkable gate.
//     What a PLACED object rests on (a building pad, a prop's foot).
//
// LAYER SEAM: road/junction tops slot into groundTopAtWorldPosition and
// footingKindAtWorldPosition between the placed-cell and landform layers when
// their capture lanes land (same seam as grid.ts).

import { landformKindDefinition, landformSurfaceTop, tileKindDefinition, type TileKind } from '../kinds';
import type { Vec3 } from '../physics';
import { waterBodyKindAt } from './water';
import {
  placedCellAt,
  surfaceRegionAtCell,
  worldToCell,
  WORLD_TUNING,
  type LandformPlacement,
  type PlacedCell,
  type WorldGridState,
  type WorldSurfaceRegion,
} from './grid';

// ── analytic tops (the reference math, verbatim semantics) ───────────────────

/** Top of a placed cell: its cell-base height plus the kind's render height. */
export function placedCellTopMeters(placedCell: PlacedCell, cellSizeMeters: number): number {
  return placedCell.cell.y * cellSizeMeters + tileKindDefinition(placedCell.kind).render.heightMeters;
}

/**
 * Top of a surface region: the same analytic top, sunk by the mesh-sink so
 * physics stands the player exactly on the visual surface.
 */
export function surfaceRegionTopMeters(region: WorldSurfaceRegion, cellSizeMeters: number): number {
  return region.y * cellSizeMeters
    + tileKindDefinition(region.kind).render.heightMeters
    - WORLD_TUNING.surfaceRegionMeshSinkMeters;
}

// ── landform surface queries (instances here, meaning in game/kinds) ─────────

/**
 * Up-normal Y of a landform surface at a point (central difference of the
 * rise) — the generic walkable/wall test the slope limit gates on.
 */
function landformSurfaceNormalY(lf: LandformPlacement, x: number, z: number): number {
  const def = landformKindDefinition(lf.kind);
  if (!def) return 1;
  const e = WORLD_TUNING.landformNormalProbeMeters;
  const lx = x - lf.centerX;
  const lz = z - lf.centerZ;
  const dhdx = (def.rise(lf.params, lx + e, lz, lf.field) - def.rise(lf.params, lx - e, lz, lf.field)) / (2 * e);
  const dhdz = (def.rise(lf.params, lx, lz + e, lf.field) - def.rise(lf.params, lx, lz - e, lf.field)) / (2 * e);
  return 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
}

/**
 * The raw landform surface top under a point — max over every landform whose
 * footprint covers it, NO walkable gate. undefined where no landform covers
 * the point (flat ground sits at its region/cell tops).
 */
export function landformGroundTopAt(world: WorldGridState, x: number, z: number): number | undefined {
  let top: number | undefined;
  for (const lf of world.landforms) {
    const def = landformKindDefinition(lf.kind);
    if (!def) continue;
    if (Math.hypot(x - lf.centerX, z - lf.centerZ) >= def.footprintRadius(lf.params, lf.field)) continue;
    const surface = landformSurfaceTop(lf, x, z);
    top = top == null ? surface : Math.max(top, surface);
  }
  return top;
}

/**
 * Walkable landform ground under a point: surface reported only where its
 * slope is under the kind's limit (steep faces are walls) and within reach
 * of `maxReachableTop`.
 */
export function landformWalkableTopAt(world: WorldGridState, position: Vec3, maxReachableTop: number): number | undefined {
  let top: number | undefined;
  for (const lf of world.landforms) {
    const def = landformKindDefinition(lf.kind);
    if (!def) continue;
    if (Math.hypot(position.x - lf.centerX, position.z - lf.centerZ) > def.footprintRadius(lf.params, lf.field)) continue;
    if (landformSurfaceNormalY(lf, position.x, position.z) < def.walkCos(lf.params)) continue;
    const surface = landformSurfaceTop(lf, position.x, position.z);
    if (surface > maxReachableTop) continue;
    top = top == null ? surface : Math.max(top, surface);
  }
  return top;
}

/**
 * The footing a body standing ON a landform surface reads (gait/friction/
 * noise): the kind's region footing (the carved trail, the estate road) where
 * one applies, else its surface tile — when feet rest within the standing
 * tolerance of the surface.
 */
export function landformFootingKindAt(world: WorldGridState, position: Vec3): TileKind | undefined {
  for (const lf of world.landforms) {
    const def = landformKindDefinition(lf.kind);
    if (!def) continue;
    if (Math.hypot(position.x - lf.centerX, position.z - lf.centerZ) > def.footprintRadius(lf.params, lf.field)) continue;
    if (Math.abs(landformSurfaceTop(lf, position.x, position.z) - position.y) <= WORLD_TUNING.landformStandingToleranceMeters) {
      const lx = position.x - lf.centerX;
      const lz = position.z - lf.centerZ;
      return def.surfaceFootingAt?.(lf.params, lx, lz) ?? def.surfaceTileKind(lf.params);
    }
  }
  return undefined;
}

/**
 * 'water' footing when the point is submerged in a landform's standing water
 * (a crater lake) — overrides surface footing (you're IN the water, not on
 * the bed; the host still walks the bed).
 */
export function landformWaterKindAt(world: WorldGridState, position: Vec3): TileKind | undefined {
  for (const lf of world.landforms) {
    const def = landformKindDefinition(lf.kind);
    if (!def?.submergedAt) continue;
    if (def.submergedAt(lf.params, position.x - lf.centerX, position.z - lf.centerZ, position.y, lf.baseY)) {
      return 'water';
    }
  }
  return undefined;
}

// ── the combined resolvers ───────────────────────────────────────────────────

/**
 * Position-precise footing resolver — what surface the body at `position`
 * reads. Layer order (the reference's, with the road-lane seam marked):
 * water body (wading overrides any footing) > landform water > placed cell >
 * [junction band] > [road band] > landform footing > surface region.
 */
export function footingKindAtWorldPosition(world: WorldGridState, position: Vec3): TileKind | undefined {
  const cell = worldToCell(position, world.cellSizeMeters);
  return waterBodyKindAt(world.waterBodies, position)
    ?? landformWaterKindAt(world, position)
    ?? placedCellAt(world, cell)?.kind
    ?? landformFootingKindAt(world, position)
    ?? surfaceRegionAtCell(world, cell)?.kind;
}

/**
 * Walkable ground top under a point, within `stepHeightMeters` reach above
 * the point — max over surface regions, placed cells, and walkable landform
 * surfaces ([road]/[junction] tops join via their lane). undefined when
 * nothing walkable is under it.
 */
export function groundTopAtWorldPosition(world: WorldGridState, position: Vec3, stepHeightMeters: number): number | undefined {
  const cellSizeMeters = world.cellSizeMeters;
  const cellX = Math.floor(position.x / cellSizeMeters);
  const cellZ = Math.floor(position.z / cellSizeMeters);
  const maxReachableTop = position.y + stepHeightMeters;
  let groundTop: number | undefined;

  for (const region of world.surfaceRegions) {
    const minX = region.x * cellSizeMeters;
    const minZ = region.z * cellSizeMeters;
    const maxX = minX + region.width * cellSizeMeters;
    const maxZ = minZ + region.depth * cellSizeMeters;
    if (position.x < minX || position.x >= maxX || position.z < minZ || position.z >= maxZ) continue;
    if (!tileKindDefinition(region.kind).pathing.walkable) continue;
    const top = surfaceRegionTopMeters(region, cellSizeMeters);
    if (top > maxReachableTop) continue;
    groundTop = groundTop == null ? top : Math.max(groundTop, top);
  }

  for (const placedCell of Object.values(world.placedCells)) {
    if (placedCell.cell.x !== cellX || placedCell.cell.z !== cellZ) continue;
    if (!tileKindDefinition(placedCell.kind).pathing.walkable) continue;
    const top = placedCellTopMeters(placedCell, cellSizeMeters);
    if (top > maxReachableTop) continue;
    groundTop = groundTop == null ? top : Math.max(groundTop, top);
  }

  const landformTop = landformWalkableTopAt(world, position, maxReachableTop);
  if (landformTop != null) groundTop = groundTop == null ? landformTop : Math.max(groundTop, landformTop);

  return groundTop;
}
