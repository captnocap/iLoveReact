import type { GameState, GridCell, TileKind } from '../design';
import { commandCell, placeCell } from './grid';

export type DemoMapCell = {
  kind: TileKind;
  cell: GridCell;
};

function rect(kind: TileKind, x0: number, z0: number, width: number, depth: number, y = 0): DemoMapCell[] {
  const cells: DemoMapCell[] = [];
  for (let z = z0; z < z0 + depth; z += 1) {
    for (let x = x0; x < x0 + width; x += 1) {
      cells.push({ kind, cell: commandCell(x, z, y) });
    }
  }
  return cells;
}

function ring(kind: TileKind, x0: number, z0: number, width: number, depth: number, y = 0): DemoMapCell[] {
  const cells: DemoMapCell[] = [];
  for (let z = z0; z < z0 + depth; z += 1) {
    for (let x = x0; x < x0 + width; x += 1) {
      const isEdge = x === x0 || x === x0 + width - 1 || z === z0 || z === z0 + depth - 1;
      if (isEdge) cells.push({ kind, cell: commandCell(x, z, y) });
    }
  }
  return cells;
}

export const HMSC_DEMO_MAP_CELLS: DemoMapCell[] = [
  ...rect('asphalt', -7, -1, 15, 3),
  ...rect('asphalt', -1, -6, 3, 13),
  ...rect('sidewalk', -7, -2, 15, 1),
  ...rect('sidewalk', -7, 2, 15, 1),
  ...rect('sidewalk', -2, -6, 1, 13),
  ...rect('sidewalk', 2, -6, 1, 13),
  ...rect('sidewalk', 4, -5, 5, 5),
  ...ring('wall', 4, -5, 5, 5),
  { kind: 'door', cell: commandCell(6, -1) },
  { kind: 'marker', cell: commandCell(0, 0) },
];

export function addDemoMapToState(state: GameState): GameState {
  return HMSC_DEMO_MAP_CELLS.reduce(
    (currentState, demoCell) => placeCell(currentState, demoCell.kind, demoCell.cell, 'demoMap'),
    state,
  );
}
