// game/world/colliders — the world→physics adapter (V1: physics is ONE
// host-side system; the world door derives collider DATA and feeds the
// GAME_PHYSICS door — it never simulates).
//
// Fresh capture of the world-derivation half of cart/hmsc/state/hostPhysics.ts
// (its wire half already landed in game/physics.ts — the types produced here
// are THAT door's CollisionRect/Heightfield, so the seam is exact) plus the
// terrain bake of cart/hmsc/world/terrain.ts + the landform-collider loop of
// cart/hmsc/state/terrainColliders.ts (behavior references only).
//
// Two collider families from the captured layers:
//   • flat solids — surface regions + placed cells → CollisionRect[] (the
//     stand-on/bump-into bands the host steps against every frame);
//   • terrain — landform instances → Heightfield[] (baked once, registered
//     with the host so it samples the real sloped surface; see-it == walk-it:
//     the SAME kind rise that meshes the hill bakes the collider).
//
// Roads, junctions, props, and buildings contribute their rects via their own
// capture lanes (the hostPhysics reference shows where each folds in).
//
// NO SILENT CAPS: every bound here is a host wire fact (game/physics.ts
// PHYSICS_LIMITS, the host's heightfield slot table) and every truncation is
// reported in the return value, never swallowed.

import { landformKindDefinition, tileKindDefinition } from '../kinds';
import { GAME_PHYSICS, PHYSICS_LIMITS, type CollisionRect, type Heightfield } from '../physics';
import { placedCellTopMeters, surfaceRegionTopMeters } from './heights';
import type { LandformPlacement, WorldGridState } from './grid';

// Host wire fact: framework/game/physics.zig MAX_HEIGHTFIELDS — slots at or
// past it are rejected by the registrar. Mirrored here so derivation can
// report drops instead of discovering them as silent host refusals.
export const WORLD_HEIGHTFIELD_SLOTS = 64;

export type WorldCollisionRects = {
  rects: CollisionRect[];
  /** rects past the host cap (PHYSICS_LIMITS.rects), dropped in layer order */
  dropped: number;
};

export type WorldHeightfields = {
  fields: Heightfield[];
  /** landforms past the host slot table (or with unknown kinds), not baked */
  dropped: number;
};

/**
 * The flat solid bands of the captured world layers, in the reference's layer
 * order (regions, then placed cells). A tile blocks the player when it is
 * neither water nor walkable (a wall); walkable tops are stand-on-only
 * surfaces. Friction/restitution come from the kind's surface profile (P2:
 * the table is the data).
 */
export function worldCollisionRects(world: WorldGridState): WorldCollisionRects {
  const cellSize = world.cellSizeMeters;
  const rects: CollisionRect[] = [];
  let dropped = 0;
  const push = (rect: CollisionRect) => {
    if (rects.length >= PHYSICS_LIMITS.rects) {
      dropped += 1;
      return;
    }
    rects.push(rect);
  };

  for (const region of world.surfaceRegions) {
    const tile = tileKindDefinition(region.kind);
    const minX = region.x * cellSize;
    const minZ = region.z * cellSize;
    push({
      minX,
      minZ,
      maxX: minX + region.width * cellSize,
      maxZ: minZ + region.depth * cellSize,
      topMeters: surfaceRegionTopMeters(region, cellSize),
      blocksPlayer: tile.surface.material !== 'water' && !tile.pathing.walkable,
      friction: tile.surface.friction,
      restitution: tile.surface.restitution,
    });
  }

  for (const placedCell of Object.values(world.placedCells)) {
    const tile = tileKindDefinition(placedCell.kind);
    const minX = placedCell.cell.x * cellSize;
    const minZ = placedCell.cell.z * cellSize;
    push({
      minX,
      minZ,
      maxX: minX + cellSize,
      maxZ: minZ + cellSize,
      topMeters: placedCellTopMeters(placedCell, cellSize),
      blocksPlayer: tile.surface.material !== 'water' && !tile.pathing.walkable,
      friction: tile.surface.friction,
      restitution: tile.surface.restitution,
    });
  }

  return { rects, dropped };
}

/**
 * Bake one landform into the host heightfield wire shape: a cols×rows grid of
 * the kind's rise sampled across its footprint (cols == rows == the kind's
 * resolution; a painted field bakes its own grid 1:1 — no resampling blur).
 * null for an unregistered kind.
 */
export function bakeLandformHeightfield(lf: LandformPlacement, slot: number): Heightfield | null {
  const def = landformKindDefinition(lf.kind);
  if (!def) return null;
  const halfWidth = def.footprintRadius(lf.params, lf.field);
  const resolution = typeof def.resolution === 'function' ? def.resolution(lf.field) : def.resolution;
  const cols = resolution;
  const rows = resolution;
  const width = halfWidth * 2;
  const step = width / (cols - 1);
  const heights = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      heights[j * cols + i] = def.rise(lf.params, -halfWidth + i * step, -halfWidth + j * step, lf.field);
    }
  }
  return {
    slot,
    originX: lf.centerX - halfWidth,
    originZ: lf.centerZ - halfWidth,
    cellSizeMeters: step,
    cols,
    rows,
    baseY: lf.baseY,
    walkableSlopeCos: def.walkCos(lf.params),
    heights,
  };
}

/**
 * Every landform baked to a host heightfield, slots assigned in array order
 * (re-deriving after a world edit re-registers the same slots — replacement,
 * not leak). Landforms past the slot table, and unknown kinds, count as
 * dropped.
 */
export function worldHeightfields(world: WorldGridState): WorldHeightfields {
  const fields: Heightfield[] = [];
  let dropped = 0;
  for (const lf of world.landforms) {
    if (fields.length >= WORLD_HEIGHTFIELD_SLOTS) {
      dropped += 1;
      continue;
    }
    const field = bakeLandformHeightfield(lf, fields.length);
    if (field) fields.push(field);
    else dropped += 1;
  }
  return { fields, dropped };
}

/**
 * Push the world's terrain colliders to the host: clear, then register every
 * baked field (GAME_PHYSICS no-ops when the bindings aren't compiled in —
 * the world just isn't solid until the gate flips). Returns what was
 * registered/dropped so callers can surface the truth.
 */
export function registerWorldHeightfields(world: WorldGridState): WorldHeightfields {
  const baked = worldHeightfields(world);
  GAME_PHYSICS.clearHeightfields();
  for (const field of baked.fields) GAME_PHYSICS.registerHeightfield(field);
  return baked;
}
