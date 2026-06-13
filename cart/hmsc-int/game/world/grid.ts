// game/world/grid — THE WORLD GRID STATE (V4: "the tile system IS the system").
//
// The substrate every other system stands on: the construction-grid state the
// authored map lowers to (surface regions, placed cells, landform instances),
// the cell math (1 tile = 1 meter, R4), and the pure mutators/resolvers over
// it. Fresh capture of cart/hmsc/world/grid.ts + the world slice of
// cart/hmsc/design.ts (behavior references only — V15-TRANSITION: read, never
// moved/copied/imported).
//
// What a cell MEANS resolves through game/kinds (P2: the tables are the data);
// this module stores `kind` and never re-derives a kind's meaning. Functions
// are pure state-in/state-out (the skeleton's inert-return convention): the
// command vocabulary owns mutating its ctx with what these return.
//
// LAYER SEAM (documented, deliberate): the old resolvers layered road bands,
// junction bands, and building blockers between placed cells and surface
// regions. Roads/junctions/buildings are SEPARATE capture lanes (see
// NOT_YET_CAPTURED in game/commands/vocabulary.ts); their layers slot back
// into the documented order below when they land. Until then the resolvers
// cover the captured layers only — absent layers resolve as absent, never
// faked.

import { isTileKind, tileKindDefinition, type TileKind } from '../kinds';
import type { LandformField } from '../kinds';
import type { Vec3 } from '../physics';
import type { WaterBody } from './water';

// ── P2 tuning: every behavior-affecting number is table data ─────────────────

export const WORLD_TUNING = {
  /** R4: 1 tile = 1 meter — the world-scale contract. */
  defaultCellSizeMeters: 1,
  /**
   * Surface-region mesh tops sink this far below the analytic top so coplanar
   * regions don't z-fight (the reference's WORLD_SURFACE_REGION_MESH_SINK_METERS).
   * Physics stands the player on the SUNK top — see-it == walk-it.
   */
  surfaceRegionMeshSinkMeters: 0.01,
  /** Feet within this of a landform surface count as standing ON it (footing). */
  landformStandingToleranceMeters: 0.6,
  /** Central-difference half-step for the landform surface normal (walkable gate). */
  landformNormalProbeMeters: 0.5,
} as const;

// ── the state (what the authored map lowers to) ──────────────────────────────

export type GridCell = { x: number; y: number; z: number };

/**
 * A single placed cell on the construction grid. `kind` resolves through
 * game/kinds. Gameplay markers ride here: a 'save' cell carries `spawnKey`,
 * the cellKey of the 'spawn' cell it respawns the player at — always a
 * DIFFERENT cell (a save never spawns you on itself); absent on spawn cells
 * and unpaired saves. `triggerCommand` runs when the player enters the cell.
 */
export type PlacedCell = {
  key: string;
  kind: TileKind;
  cell: GridCell;
  triggerCommand?: string;
  triggerLabel?: string;
  spawnKey?: string;
  createdByCommand: string;
};

/** A chunk-native rectangle of one tile kind — the bulk-paint unit (wv_fill). */
export type WorldSurfaceRegion = {
  id: string;
  label: string;
  kind: TileKind;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  zoneKey: string;
};

/**
 * A placed landform — registry-driven terrain (mountains, hills, painted
 * 'heightfield' grids). Pure data: `kind` resolves through game/kinds'
 * landform registry; `field` is the baked grid a painted kind carries
 * instead of a formula.
 */
export type LandformPlacement = {
  id: string;
  kind: string;
  label: string;
  centerX: number;
  centerZ: number;
  baseY: number;
  params: Record<string, number>;
  field?: LandformField;
  createdByCommand: string;
};

/**
 * The world-grid slice this door owns. Field names match the reference
 * GameState's `world.*` dot paths so saved command sequences (gv_state/
 * gv_set) keep meaning the same thing. Other world layers (roads, junctions,
 * props, buildings, interiors, zones, npcs) belong to their own capture
 * lanes and join this state when they land.
 */
export type WorldGridState = {
  cellSizeMeters: number;
  surfaceRegions: WorldSurfaceRegion[];
  placedCells: Record<string, PlacedCell>;
  landforms: LandformPlacement[];
  // Bodies of water (world/water): footprint + a surface level; depth is derived
  // against the bed. A first-class world layer, peer of surfaceRegions/landforms.
  waterBodies: WaterBody[];
};

export function createWorldGridState(): WorldGridState {
  return {
    cellSizeMeters: WORLD_TUNING.defaultCellSizeMeters,
    surfaceRegions: [],
    placedCells: {},
    landforms: [],
    waterBodies: [],
  };
}

// ── cell math ────────────────────────────────────────────────────────────────

export function cellKey(cell: GridCell): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

export function worldToCell(position: Vec3, cellSizeMeters: number): GridCell {
  return {
    x: Math.floor(position.x / cellSizeMeters),
    y: Math.floor(position.y / cellSizeMeters),
    z: Math.floor(position.z / cellSizeMeters),
  };
}

export function cellCenterToWorld(cell: GridCell, cellSizeMeters: number): Vec3 {
  return {
    x: (cell.x + 0.5) * cellSizeMeters,
    y: (cell.y + 0.5) * cellSizeMeters,
    z: (cell.z + 0.5) * cellSizeMeters,
  };
}

// ── mutators (pure: state in, state out) ─────────────────────────────────────

export type PlaceCellOptions = {
  triggerCommand?: string;
  triggerLabel?: string;
  /** For a 'save' cell: the cellKey of the paired 'spawn' cell to respawn at. */
  spawnKey?: string;
};

export function placeCell(
  world: WorldGridState,
  kind: TileKind,
  cell: GridCell,
  sourceLine: string,
  options: PlaceCellOptions = {},
): WorldGridState {
  if (!isTileKind(kind)) throw new Error(`unknown tile kind ${kind}`);
  const key = cellKey(cell);
  const placedCell: PlacedCell = {
    key,
    kind,
    cell,
    ...(options.triggerCommand ? { triggerCommand: options.triggerCommand } : {}),
    ...(options.triggerLabel ? { triggerLabel: options.triggerLabel } : {}),
    ...(options.spawnKey ? { spawnKey: options.spawnKey } : {}),
    createdByCommand: sourceLine,
  };
  return { ...world, placedCells: { ...world.placedCells, [key]: placedCell } };
}

export function removeCell(world: WorldGridState, cell: GridCell): WorldGridState {
  const next = { ...world.placedCells };
  delete next[cellKey(cell)];
  return { ...world, placedCells: next };
}

/** Append a surface region. Later regions win at a cell (newest-first scan). */
export function addSurfaceRegion(world: WorldGridState, region: WorldSurfaceRegion): WorldGridState {
  return { ...world, surfaceRegions: [...world.surfaceRegions, region] };
}

/**
 * Set or clear (`triggerCommand: null`) the enter-cell trigger on an existing
 * placed cell. No placed cell at the target → unchanged state (the command
 * layer reports the miss).
 */
export function setCellTrigger(
  world: WorldGridState,
  cell: GridCell,
  triggerCommand: string | null,
  triggerLabel?: string,
): WorldGridState {
  const key = cellKey(cell);
  const placedCell = world.placedCells[key];
  if (!placedCell) return world;
  const next: PlacedCell = {
    ...placedCell,
    ...(triggerCommand ? { triggerCommand } : {}),
    ...(triggerCommand && triggerLabel ? { triggerLabel } : {}),
  };
  if (!triggerCommand) {
    delete next.triggerCommand;
    delete next.triggerLabel;
  }
  return { ...world, placedCells: { ...world.placedCells, [key]: next } };
}

export function placeLandform(world: WorldGridState, landform: LandformPlacement): WorldGridState {
  return { ...world, landforms: [...world.landforms, landform] };
}

export function removeLandform(world: WorldGridState, id: string): WorldGridState {
  return { ...world, landforms: world.landforms.filter((lf) => lf.id !== id) };
}

/** Append a body of water. */
export function addWaterBody(world: WorldGridState, body: WaterBody): WorldGridState {
  return { ...world, waterBodies: [...(world.waterBodies ?? []), body] };
}

export function removeWaterBody(world: WorldGridState, id: string): WorldGridState {
  return { ...world, waterBodies: (world.waterBodies ?? []).filter((b) => b.id !== id) };
}

// ── resolvers ────────────────────────────────────────────────────────────────

export function placedCellAt(world: WorldGridState, cell: GridCell): PlacedCell | undefined {
  return world.placedCells[cellKey(cell)];
}

export function placedCellAtWorldPosition(world: WorldGridState, position: Vec3): PlacedCell | undefined {
  return placedCellAt(world, worldToCell(position, world.cellSizeMeters));
}

/** Newest-first: a later fill paints over what's under it. */
export function surfaceRegionAtCell(world: WorldGridState, cell: GridCell): WorldSurfaceRegion | undefined {
  for (let index = world.surfaceRegions.length - 1; index >= 0; index -= 1) {
    const region = world.surfaceRegions[index];
    if (
      cell.y === region.y
      && cell.x >= region.x
      && cell.x < region.x + region.width
      && cell.z >= region.z
      && cell.z < region.z + region.depth
    ) {
      return region;
    }
  }
  return undefined;
}

/**
 * Cell-granular kind resolver — what kind is at this cell, across the
 * captured layers. Layer order (documented for the lanes that slot back in):
 * placed cell > [junction band] > [road band] > surface region.
 */
export function tileKindAtCell(world: WorldGridState, cell: GridCell): TileKind | undefined {
  return placedCellAt(world, cell)?.kind ?? surfaceRegionAtCell(world, cell)?.kind;
}

export function canPathThroughCell(world: WorldGridState, cell: GridCell): boolean {
  const kind = tileKindAtCell(world, cell);
  if (!kind) return false;
  return tileKindDefinition(kind).pathing.walkable;
}
