import type { GameState, GridCell } from '../design';
import { canPathThroughCell, cellKey, placedCellAt } from './grid';
import { tileKindDefinition } from './tileKinds';

type PathNode = {
  cell: GridCell;
  priority: number;
};

const ORTHOGONAL_NEIGHBORS: ReadonlyArray<Pick<GridCell, 'x' | 'z'>> = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

function manhattanDistance(a: GridCell, b: GridCell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z) + Math.abs(a.y - b.y);
}

function movementCostForCell(state: GameState, cell: GridCell): number {
  const placedCell = placedCellAt(state, cell);
  if (!placedCell) return Infinity;
  return tileKindDefinition(placedCell.kind).pathing.movementCost;
}

function neighborsForCell(cell: GridCell): GridCell[] {
  return ORTHOGONAL_NEIGHBORS.map((offset) => ({
    x: cell.x + offset.x,
    y: cell.y,
    z: cell.z + offset.z,
  }));
}

function lowestPriorityIndex(openSet: PathNode[]): number {
  let bestIndex = 0;
  let bestPriority = openSet[0]?.priority ?? Infinity;
  for (let i = 1; i < openSet.length; i += 1) {
    if (openSet[i].priority < bestPriority) {
      bestPriority = openSet[i].priority;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function rebuildPath(cameFrom: Record<string, string>, cellsByKey: Record<string, GridCell>, goalKey: string): GridCell[] {
  const path: GridCell[] = [];
  let currentKey: string | undefined = goalKey;
  while (currentKey) {
    const cell = cellsByKey[currentKey];
    if (!cell) break;
    path.push(cell);
    currentKey = cameFrom[currentKey];
  }
  return path.reverse();
}

export function findGridPath(state: GameState, start: GridCell, goal: GridCell): GridCell[] {
  if (!canPathThroughCell(state, start) || !canPathThroughCell(state, goal)) return [];

  const startKey = cellKey(start);
  const goalKey = cellKey(goal);
  const openSet: PathNode[] = [{ cell: start, priority: 0 }];
  const cameFrom: Record<string, string> = {};
  const costSoFar: Record<string, number> = { [startKey]: 0 };
  const cellsByKey: Record<string, GridCell> = { [startKey]: start, [goalKey]: goal };

  while (openSet.length > 0) {
    const currentIndex = lowestPriorityIndex(openSet);
    const current = openSet.splice(currentIndex, 1)[0].cell;
    const currentKey = cellKey(current);
    if (currentKey === goalKey) return rebuildPath(cameFrom, cellsByKey, goalKey);

    for (const next of neighborsForCell(current)) {
      if (!canPathThroughCell(state, next)) continue;
      const nextKey = cellKey(next);
      const nextCost = costSoFar[currentKey] + movementCostForCell(state, next);
      if (costSoFar[nextKey] !== undefined && nextCost >= costSoFar[nextKey]) continue;

      costSoFar[nextKey] = nextCost;
      cellsByKey[nextKey] = next;
      cameFrom[nextKey] = currentKey;
      openSet.push({
        cell: next,
        priority: nextCost + manhattanDistance(next, goal),
      });
    }
  }

  return [];
}
