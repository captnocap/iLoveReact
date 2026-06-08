import { useEffect } from 'react';
import type { GameState } from '../design';
import { landformColliderData } from '../world/landforms';
import type { TerrainColliderData } from '../world/terrain';

declare const globalThis: any;

// Upload every heightfield landform (mountains, hills, …) to the host as terrain
// colliders. Each landform bakes its grid once and exposes the SAME
// TerrainColliderData shape, so registration is one loop regardless of kind — see
// __hmsc_register_heightfield in framework/v8_bindings_physics_lab.zig. No-ops on a
// host that predates the collider (the cart still runs; terrain just isn't solid
// until the host is rebuilt). Host cap is HMSC_MAX_HEIGHTFIELDS; excess is dropped.
// A heightfield collider plus the rotation it's registered under. yaw 0 (the
// landforms) is axis-aligned; a rotated building's floor (the parking garage)
// carries its yaw + pivot so the host samples the grid in the rotated frame —
// the ramp you walk follows the rotated model (see-it == walk-it at any angle).
type OrientedCollider = TerrainColliderData & { yaw: number; pivotX: number; pivotZ: number };

function collectTerrainColliders(state: GameState): OrientedCollider[] {
  const colliders: OrientedCollider[] = [];
  // Every heightfield landform (mountain, hills, estate, painted) bakes its grid
  // once and exposes the SAME TerrainColliderData; they are not rotated (yaw 0).
  for (const lf of state.world.landforms ?? []) {
    colliders.push({ ...landformColliderData(lf), yaw: 0, pivotX: 0, pivotZ: 0 });
  }
  return colliders;
}

export function registerTerrainColliders(state: GameState): void {
  const register = globalThis.__hmsc_register_heightfield;
  if (typeof register !== 'function') return;
  if (typeof globalThis.__hmsc_clear_heightfields === 'function') globalThis.__hmsc_clear_heightfields();
  collectTerrainColliders(state).forEach((c, index) => {
    register(index, c.originX, c.originZ, c.cell, c.cols, c.rows, c.baseY, c.walkCos, c.heights, c.yaw, c.pivotX, c.pivotZ);
  });
}

// Keep the host's terrain colliders in sync with the world's landforms. Re-runs
// only when a landform array's identity changes (load / reset), since the drive
// preserves world identity across movement frames.
export function useTerrainColliders(state: GameState): void {
  useEffect(() => {
    registerTerrainColliders(state);
  }, [state.world.landforms]);
}
