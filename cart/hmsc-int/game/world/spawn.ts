// game/world/spawn — gameplay markers (spawn/save), trigger cells, and the
// respawn semantics over the world grid.
//
// Fresh capture of the marker/trigger/respawn behavior spread across
// cart/hmsc/world/grid.ts (trigger queries), cart/hmsc/state/usePlayerDrive.ts
// (the entered-cell trigger + save-checkpoint steps), cart/hmsc-int's
// editorWorld.placeMarker + first-spawn-wins compile rule, and the reference
// pv_respawn command (behavior references only).
//
// THE MODEL (authored in the editor's MARKERS palette, lowered to placedCells):
//   • 'spawn' — where the player (re)appears. Ordinary walkable ground.
//   • 'save'  — a checkpoint. Stepping on it persists the game and arms the
//     respawn at its PAIRED spawn cell (PlacedCell.spawnKey — the manual
//     save↔spawn link; you save HERE, you reappear THERE). An unpaired save
//     arms the respawn at the save cell itself.
//   • triggerCommand — any placed cell can carry an enter-cell command line.
//
// The reference's drive-loop steps are captured as PURE steps with inert
// returns (the skeleton's convention): debounce state rides in and out as
// data, the caller owns running the returned command line / persisting the
// save / mutating the player. Scene gating (the reference's triggersActive)
// is the caller's: which scenes fire world steps is the loop's business, not
// the grid's.

import { cellCenterToWorld, cellKey, placedCellAt, placedCellAtWorldPosition, placeCell, worldToCell, type GridCell, type PlacedCell, type WorldGridState } from './grid';
import { groundTopAtWorldPosition } from './heights';
import type { Vec3 } from '../physics';

// ── markers ──────────────────────────────────────────────────────────────────

/**
 * Place a spawn or save marker as a single placed cell. A save cell carries
 * `spawnKey`, the cellKey of the spawn it respawns the player at — never its
 * own cell (a save never spawns you on itself; a self-key is dropped).
 */
export function placeMarker(
  world: WorldGridState,
  opts: { kind: 'spawn' | 'save' | 'vehicleSpawn'; x: number; z: number; y?: number; spawnKey?: string },
  sourceLine: string,
): WorldGridState {
  const cell: GridCell = { x: opts.x, y: opts.y ?? 0, z: opts.z };
  const selfKey = cellKey(cell);
  const spawnKey = opts.kind === 'save' && opts.spawnKey && opts.spawnKey !== selfKey ? opts.spawnKey : undefined;
  return placeCell(world, opts.kind, cell, sourceLine, spawnKey ? { spawnKey } : {});
}

/**
 * The world's default spawn — where a fresh game drops the player. The first
 * 'spawn' placed cell wins (placement order; the editor's first-spawn-wins
 * compile rule made identical). undefined on a world with no spawn marker.
 */
export function defaultSpawnCell(world: WorldGridState): GridCell | undefined {
  for (const placedCell of Object.values(world.placedCells)) {
    if (placedCell.kind === 'spawn') return placedCell.cell;
  }
  return undefined;
}

/**
 * Every authored vehicle-spawn cell (PARKSPAWN-0612, req_0694) in placement
 * order — where the traffic system may materialize a vehicle. WHICH vehicle
 * each point produces is the garage's per-style spawnRate weighting
 * (GAME_VEHICLE.pickSpawn), not the cell's business.
 */
export function vehicleSpawnCells(world: WorldGridState): GridCell[] {
  const cells: GridCell[] = [];
  for (const placedCell of Object.values(world.placedCells)) {
    if (placedCell.kind === 'vehicleSpawn') cells.push(placedCell.cell);
  }
  return cells;
}

// ── respawn ──────────────────────────────────────────────────────────────────

export type RespawnPoint = {
  cell: GridCell;
  /** cell-centred, ground-snapped position; velocity is the caller's to zero */
  position: Vec3;
  /** true when walkable ground was found under the cell (y snapped to it) */
  groundedOnWorld: boolean;
};

/**
 * Resolve the armed respawn cell to a standable world position: the cell's
 * centre, y snapped to the walkable ground top under it (within step-height
 * reach of the cell centre, the reference's pv_respawn rule). No ground →
 * `fallbackY` (the caller's current height) and groundedOnWorld false.
 */
export function respawnPoint(
  world: WorldGridState,
  respawnCell: GridCell,
  stepHeightMeters: number,
  fallbackY: number,
): RespawnPoint {
  const center = cellCenterToWorld(respawnCell, world.cellSizeMeters);
  const top = groundTopAtWorldPosition(world, center, stepHeightMeters);
  return {
    cell: respawnCell,
    position: { x: center.x, y: top ?? fallbackY, z: center.z },
    groundedOnWorld: top != null,
  };
}

// ── pure world-steps (debounce as data in/out; effects are the caller's) ─────

export type TriggerStepResult = {
  /** set when a trigger fires this step — the command line for the registry */
  fired?: { command: string; cellKey: string; label?: string; kind: string };
  /** thread back into the next step (the once-per-entry debounce) */
  lastTriggerKey: string | null;
};

/**
 * The enter-cell trigger step: fires a cell's triggerCommand once per entry
 * (debounced on cell+command, so re-triggering the SAME cell needs leaving
 * it, while editing its command re-arms it in place).
 */
export function enteredTriggerStep(
  world: WorldGridState,
  position: Vec3,
  lastTriggerKey: string | null,
): TriggerStepResult {
  const placedCell = triggerCellAtWorldPosition(world, position);
  if (!placedCell?.triggerCommand) return { lastTriggerKey: null };
  const triggerKey = `${placedCell.key}:${placedCell.triggerCommand}`;
  if (lastTriggerKey === triggerKey) return { lastTriggerKey };
  return {
    fired: {
      command: placedCell.triggerCommand,
      cellKey: placedCell.key,
      ...(placedCell.triggerLabel ? { label: placedCell.triggerLabel } : {}),
      kind: placedCell.kind,
    },
    lastTriggerKey: triggerKey,
  };
}

export function triggerCellAtWorldPosition(world: WorldGridState, position: Vec3): PlacedCell | undefined {
  const placedCell = placedCellAtWorldPosition(world, position);
  return placedCell?.triggerCommand ? placedCell : undefined;
}

export type SaveStepResult = {
  /** set when a save checkpoint fires: arm player.respawnCell and persist */
  armed?: { respawnCell: GridCell; saveCellKey: string };
  /** thread back into the next step (once per entry, not every tick) */
  lastSaveCellKey: string | null;
};

/**
 * The save-checkpoint step: standing on a 'save' cell (once per entry) arms
 * the respawn at its paired spawn cell — the save cell itself when unpaired
 * or the pair dangles. The caller persists the armed state (the "stepping on
 * it saves the game" half) and records the event.
 */
export function enteredSaveStep(
  world: WorldGridState,
  position: Vec3,
  lastSaveCellKey: string | null,
): SaveStepResult {
  const cell = worldToCell(position, world.cellSizeMeters);
  const placedCell = placedCellAt(world, cell);
  if (placedCell?.kind !== 'save') return { lastSaveCellKey: null };
  if (lastSaveCellKey === placedCell.key) return { lastSaveCellKey };
  const pairedSpawn = placedCell.spawnKey ? world.placedCells[placedCell.spawnKey] : undefined;
  return {
    armed: { respawnCell: pairedSpawn?.cell ?? cell, saveCellKey: placedCell.key },
    lastSaveCellKey: placedCell.key,
  };
}
