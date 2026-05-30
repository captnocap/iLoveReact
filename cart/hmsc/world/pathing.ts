import type { GameState, GridCell } from '../design';
import { cellKey, tileKindAtCell } from './grid';
import { tileKindDefinition, type TileTraversalMode } from './tileKinds';

export type PathAgentKind = 'pedestrian' | 'runner' | 'vehicle';

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

function movementCostForCell(state: GameState, cell: GridCell, agent: PathAgentKind): number {
  // Resolve through the shared cell-granular resolver so A* covers the WHOLE
  // world (surfaceRegions, road bands, junction bands), not just hand-placed
  // cells — previously this read placedCellAt only, so NPCs couldn't path across
  // a sidewalk/road chunk. See grid.tileKindAtCell + WORLD_AUTHORING_PLAN Phase 1.
  // FLOW HINT slice-in: a future directional NPC-flow layer scales cost HERE
  // (see WORLD_AUTHORING_PLAN -> Future layer: NPC flow hints).
  const kind = tileKindAtCell(state, cell);
  if (!kind) return Infinity;
  const tile = tileKindDefinition(kind);
  if (!tile.pathing.walkable || !tile.npc.traversable) return Infinity;
  const mode: TileTraversalMode = agent === 'vehicle' ? 'drive' : agent === 'runner' ? 'run' : 'walk';
  if (!tile.traversal.allowedModes.includes(mode)) return Infinity;
  const baseCost = agent === 'vehicle' ? tile.npc.vehicleCost : agent === 'runner' ? tile.npc.runCost : tile.npc.walkCost;
  if (!Number.isFinite(baseCost)) return Infinity;
  const doorCost = tile.door.isDoor ? tile.door.openCost : 0;
  const narrowCost = tile.traversal.width === 'narrow' ? 0.22 : 0;
  return baseCost * tile.pathing.movementCost + doorCost + narrowCost;
}

function canTraverseCell(state: GameState, cell: GridCell, agent: PathAgentKind): boolean {
  return Number.isFinite(movementCostForCell(state, cell, agent));
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

export function findGridPath(state: GameState, start: GridCell, goal: GridCell, agent: PathAgentKind = 'pedestrian'): GridCell[] {
  if (!canTraverseCell(state, start, agent) || !canTraverseCell(state, goal, agent)) return [];

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
      if (!canTraverseCell(state, next, agent)) continue;
      const nextKey = cellKey(next);
      const nextCost = costSoFar[currentKey] + movementCostForCell(state, next, agent);
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
