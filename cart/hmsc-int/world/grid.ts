import type { GameState, GridCell, PlacedCell, TileKind, Vec3, WorldSurfaceRegion } from '../design';
import { tileKindDefinition, type TileKindDefinition } from './tileKinds';
import { placedCellTopMeters, surfaceRegionTopMeters } from './surfaceHeights';
import { roadBandKindAtCell, roadBandKindAtWorldPosition, roadTopAtWorldPosition } from './roads';
import { junctionBandKindAtCell, junctionBandKindAtWorldPosition, junctionTopAtWorldPosition } from './roadJunctions';
import { landformTileKindAtWorldPosition, landformTopAtWorldPosition, landformWaterKindAtWorldPosition } from './landforms';

export type PlaceCellOptions = {
  triggerCommand?: string;
  triggerLabel?: string;
  // For a 'save' cell: the cellKey of the paired 'spawn' cell to respawn at.
  spawnKey?: string;
};

export function cellKey(cell: GridCell): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

export function chunkKeyForCell(cell: GridCell, chunkCellSpan: number): string {
  const cx = Math.floor(cell.x / chunkCellSpan);
  const cz = Math.floor(cell.z / chunkCellSpan);
  return `${cx},${cz}`;
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

export function commandCell(x: number, z: number, y = 0): GridCell {
  return { x, y, z };
}

export function placeCell(state: GameState, kind: TileKind, cell: GridCell, sourceLine: string, options: PlaceCellOptions = {}): GameState {
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
  return {
    ...state,
    world: {
      ...state.world,
      placedCells: {
        ...state.world.placedCells,
        [key]: placedCell,
      },
    },
  };
}

export function placedCellAt(state: GameState, cell: GridCell): PlacedCell | undefined {
  return state.world.placedCells[cellKey(cell)];
}

// Append a surface region (a chunk-native rectangle of one kind). The base unit
// the chunk painter emits via wv_fill; also useful for hand-authoring districts.
// Immutable push, mirroring placeCell.
export function addSurfaceRegion(state: GameState, region: WorldSurfaceRegion): GameState {
  return {
    ...state,
    world: {
      ...state.world,
      surfaceRegions: [...state.world.surfaceRegions, region],
    },
  };
}

export function surfaceRegionAtCell(state: GameState, cell: GridCell): WorldSurfaceRegion | undefined {
  for (let index = state.world.surfaceRegions.length - 1; index >= 0; index -= 1) {
    const region = state.world.surfaceRegions[index];
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

export function setCellTrigger(state: GameState, cell: GridCell, triggerCommand: string | null, triggerLabel?: string): GameState {
  const key = cellKey(cell);
  const placedCell = state.world.placedCells[key];
  if (!placedCell) return state;
  const nextPlacedCell: PlacedCell = {
    ...placedCell,
    ...(triggerCommand ? { triggerCommand } : {}),
    ...(triggerCommand && triggerLabel ? { triggerLabel } : {}),
  };
  if (!triggerCommand) {
    delete nextPlacedCell.triggerCommand;
    delete nextPlacedCell.triggerLabel;
  }
  return {
    ...state,
    world: {
      ...state.world,
      placedCells: {
        ...state.world.placedCells,
        [key]: nextPlacedCell,
      },
    },
  };
}

export function placedCellAtWorldPosition(state: GameState, position: Vec3): PlacedCell | undefined {
  return placedCellAt(state, worldToCell(position, state.world.cellSizeMeters));
}

export function triggerCellAtWorldPosition(state: GameState, position: Vec3): PlacedCell | undefined {
  const placedCell = placedCellAtWorldPosition(state, position);
  return placedCell?.triggerCommand ? placedCell : undefined;
}

export function tileKindAtWorldPosition(state: GameState, position: Vec3): TileKind | undefined {
  const cell = worldToCell(position, state.world.cellSizeMeters);
  // Pavement sits on top of the chunk it is laid in, so its band kind wins over
  // the chunk surface underneath. Junctions sit on top of roads, so they win
  // over roads (a placed cell still wins over everything).
  // Submerged in a landform's water (a crater lake) overrides any footing —
  // you're wading, not standing on the bed.
  return landformWaterKindAtWorldPosition(state, position)
    ?? placedCellAt(state, cell)?.kind
    ?? junctionBandKindAtWorldPosition(state, position)
    ?? roadBandKindAtWorldPosition(state, position)
    // Registry landforms report their surface/region footing (a mountain trail's
    // 'mud', an estate road's 'road', else the kind's surface tile).
    ?? landformTileKindAtWorldPosition(state, position)
    ?? surfaceRegionAtCell(state, cell)?.kind;
}

export function tileDefinitionAtWorldPosition(state: GameState, position: Vec3): TileKindDefinition | undefined {
  const kind = tileKindAtWorldPosition(state, position);
  return kind ? tileKindDefinition(kind) : undefined;
}

export function groundTopAtWorldPosition(state: GameState, position: Vec3, stepHeightMeters: number): number | undefined {
  const cellSizeMeters = state.world.cellSizeMeters;
  const cellX = Math.floor(position.x / cellSizeMeters);
  const cellZ = Math.floor(position.z / cellSizeMeters);
  const maxReachableTop = position.y + stepHeightMeters;
  let groundTop: number | undefined;

  for (const region of state.world.surfaceRegions) {
    const minX = region.x * cellSizeMeters;
    const minZ = region.z * cellSizeMeters;
    const maxX = minX + region.width * cellSizeMeters;
    const maxZ = minZ + region.depth * cellSizeMeters;
    if (position.x < minX || position.x >= maxX || position.z < minZ || position.z >= maxZ) continue;
    const tile = tileKindDefinition(region.kind);
    if (!tile.pathing.walkable) continue;
    const top = surfaceRegionTopMeters(region, cellSizeMeters);
    if (top > maxReachableTop) continue;
    groundTop = groundTop == null ? top : Math.max(groundTop, top);
  }

  for (const placedCell of Object.values(state.world.placedCells)) {
    if (placedCell.cell.x !== cellX || placedCell.cell.z !== cellZ) continue;
    const tile = tileKindDefinition(placedCell.kind);
    if (!tile.pathing.walkable) continue;
    const top = placedCellTopMeters(placedCell, cellSizeMeters);
    if (top > maxReachableTop) continue;
    groundTop = groundTop == null ? top : Math.max(groundTop, top);
  }

  const roadTop = roadTopAtWorldPosition(state, position, maxReachableTop);
  if (roadTop != null) groundTop = groundTop == null ? roadTop : Math.max(groundTop, roadTop);

  const junctionTop = junctionTopAtWorldPosition(state, position, maxReachableTop);
  if (junctionTop != null) groundTop = groundTop == null ? junctionTop : Math.max(groundTop, junctionTop);

  const landformTop = landformTopAtWorldPosition(state, position, maxReachableTop);
  if (landformTop != null) groundTop = groundTop == null ? landformTop : Math.max(groundTop, landformTop);

  return groundTop;
}

// Cell-granular kind resolver — the grid-consumer twin of
// tileKindAtWorldPosition (which stays position-precise for surface physics,
// reading sub-cell road/junction/mountain band geometry). Maps and NPC A*
// pathing share THIS one so they agree on "what kind is at this cell" across
// every world layer, not just placed cells. Layering matches the world-position
// resolver minus the position-only mountain trail: a placed cell wins, then the
// junction band, then the road band, then the chunk surface region.
export function tileKindAtCell(state: GameState, cell: GridCell): TileKind | undefined {
  return placedCellAt(state, cell)?.kind
    ?? junctionBandKindAtCell(state, cell)
    ?? roadBandKindAtCell(state, cell)
    ?? surfaceRegionAtCell(state, cell)?.kind;
}

export function canPathThroughCell(state: GameState, cell: GridCell): boolean {
  const kind = tileKindAtCell(state, cell);
  if (!kind) return false;
  return tileKindDefinition(kind).pathing.walkable;
}

export function canOccupyWorldPosition(state: GameState, position: Vec3): boolean {
  return canPathThroughCell(state, worldToCell(position, state.world.cellSizeMeters));
}

export function removeCell(state: GameState, cell: GridCell): GameState {
  const key = cellKey(cell);
  const nextPlacedCells = { ...state.world.placedCells };
  delete nextPlacedCells[key];
  return {
    ...state,
    world: {
      ...state.world,
      placedCells: nextPlacedCells,
    },
  };
}

export function visibleCellsAround(center: GridCell, radiusCells: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let z = center.z - radiusCells; z <= center.z + radiusCells; z += 1) {
    for (let x = center.x - radiusCells; x <= center.x + radiusCells; x += 1) {
      cells.push({ x, y: center.y, z });
    }
  }
  return cells;
}

export function placedCellsNearPlayer(state: GameState, radiusCells: number): PlacedCell[] {
  const center = worldToCell(state.player.position, state.world.cellSizeMeters);
  return Object.values(state.world.placedCells).filter((placedCell) => (
    Math.abs(placedCell.cell.x - center.x) <= radiusCells &&
    Math.abs(placedCell.cell.z - center.z) <= radiusCells &&
    placedCell.cell.y === center.y
  ));
}
