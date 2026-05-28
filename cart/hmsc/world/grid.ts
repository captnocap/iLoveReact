import type { GameState, GridCell, PlacedCell, TileKind, Vec3 } from '../design';
import { tileKindDefinition } from './tileKinds';

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

export function placeCell(state: GameState, kind: TileKind, cell: GridCell, sourceLine: string): GameState {
  const key = cellKey(cell);
  const placedCell: PlacedCell = {
    key,
    kind,
    cell,
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

export function canPathThroughCell(state: GameState, cell: GridCell): boolean {
  const placedCell = placedCellAt(state, cell);
  if (!placedCell) return false;
  return tileKindDefinition(placedCell.kind).pathing.walkable;
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
