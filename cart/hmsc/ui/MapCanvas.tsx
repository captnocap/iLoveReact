import { Box, Canvas, Text } from '@reactjit/runtime/primitives';
import type { GameState, GridCell, PlacedCell, SpawnedEntity } from '../design';
import { cellKey, chunkKeyForCell, visibleCellsAround, worldToCell } from '../world/grid';

const MAP_CELL_PIXELS = 24;
const MAP_VISIBLE_RADIUS_CELLS = 14;

const CELL_COLORS: Record<string, string> = {
  asphalt: '#20242d',
  sidewalk: '#596170',
  wall: '#cbd5e1',
  door: '#f59e0b',
  marker: '#22d3ee',
};

function cellFill(placedCell: PlacedCell | undefined): string {
  if (!placedCell) return '#111827';
  return CELL_COLORS[placedCell.kind] ?? '#7c3aed';
}

function cellStroke(cell: GridCell, chunkCellSpan: number): string {
  const onChunkLine = cell.x % chunkCellSpan === 0 || cell.z % chunkCellSpan === 0;
  return onChunkLine ? '#334155' : '#1f2937';
}

function cellToCanvasX(cell: GridCell): number {
  return cell.x * MAP_CELL_PIXELS;
}

function cellToCanvasY(cell: GridCell): number {
  return cell.z * MAP_CELL_PIXELS;
}

function entityToCanvas(entity: SpawnedEntity): { x: number; y: number } {
  return {
    x: entity.position.x * MAP_CELL_PIXELS,
    y: entity.position.z * MAP_CELL_PIXELS,
  };
}

export function MapCanvas(props: { state: GameState }) {
  const state = props.state;
  const playerCell = worldToCell(state.player.position, state.world.cellSizeMeters);
  const playerChunkKey = chunkKeyForCell(playerCell, state.world.chunkCellSpan);
  const visibleCells = visibleCellsAround(playerCell, MAP_VISIBLE_RADIUS_CELLS);
  const spawnedEntities = Object.values(state.world.spawnedEntities);

  return (
    <Box style={{ flex: 1, backgroundColor: '#0b1020' }}>
      <Box style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#1e293b', backgroundColor: '#111827', gap: 4 }}>
        <Text fontSize={16} color="#f8fafc" style={{ fontWeight: 800 }}>HITMAN SHITCITY</Text>
        <Text fontSize={11} color="#94a3b8">
          pos {state.player.position.x.toFixed(2)}, {state.player.position.y.toFixed(2)}, {state.player.position.z.toFixed(2)}
          {'  '}cell {cellKey(playerCell)}
          {'  '}chunk {playerChunkKey}
          {'  '}scene {state.sceneStep}
        </Text>
      </Box>
      <Canvas style={{ flex: 1, backgroundColor: '#0b1020' }}>
        {visibleCells.map((cell) => {
          const key = cellKey(cell);
          const placedCell = state.world.placedCells[key];
          return (
            <Canvas.Node
              key={key}
              gx={cellToCanvasX(cell)}
              gy={cellToCanvasY(cell)}
              gw={MAP_CELL_PIXELS}
              gh={MAP_CELL_PIXELS}
            >
              <Box
                style={{
                  width: '100%',
                  height: '100%',
                  backgroundColor: cellFill(placedCell),
                  borderWidth: 1,
                  borderColor: cellStroke(cell, state.world.chunkCellSpan),
                }}
              />
            </Canvas.Node>
          );
        })}
        {spawnedEntities.map((entity) => {
          const point = entityToCanvas(entity);
          return (
            <Canvas.Node key={entity.id} gx={point.x - 7} gy={point.y - 7} gw={14} gh={14}>
              <Box style={{ width: '100%', height: '100%', borderRadius: 999, backgroundColor: '#fb7185', borderWidth: 2, borderColor: '#ffe4e6' }} />
            </Canvas.Node>
          );
        })}
        <Canvas.Node
          gx={state.player.position.x * MAP_CELL_PIXELS - 9}
          gy={state.player.position.z * MAP_CELL_PIXELS - 9}
          gw={18}
          gh={18}
        >
          <Box style={{ width: '100%', height: '100%', borderRadius: 999, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#dcfce7' }} />
        </Canvas.Node>
      </Canvas>
    </Box>
  );
}
