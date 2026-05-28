import { useEffect, useState } from 'react';
import { Box, Canvas, Pressable, Text } from '@reactjit/runtime/primitives';
import { DEFAULT_LIVE_SYNC_INTERVAL_MS, type GameState, type GridCell, type PlacedCell } from '../hmsc/design';
import { createInitialGameState, readLivePlayerSnapshot, readStoredGameState } from '../hmsc/state/gameState';
import { cellKey, chunkKeyForCell, worldToCell } from '../hmsc/world/grid';
import { tileKindDefinition } from '../hmsc/world/tileKinds';

const MAP_CELL_PIXELS = 32;
const MAP_PADDING_CELLS = 2;

function loadMapState(): GameState {
  const state = readStoredGameState() ?? createInitialGameState();
  const livePlayer = readLivePlayerSnapshot();
  if (!livePlayer) return state;
  return {
    ...state,
    sessionName: livePlayer.sessionName,
    updatedAt: livePlayer.updatedAt,
    player: {
      ...state.player,
      ...livePlayer.player,
    },
  };
}

function sameMapView(a: GameState, b: GameState): boolean {
  return a.updatedAt === b.updatedAt
    && a.player.position.x === b.player.position.x
    && a.player.position.y === b.player.position.y
    && a.player.position.z === b.player.position.z
    && a.player.yawDegrees === b.player.yawDegrees
    && Object.keys(a.world.placedCells).length === Object.keys(b.world.placedCells).length;
}

function cellFill(placedCell: PlacedCell): string {
  return tileKindDefinition(placedCell.kind).render.color;
}

function mapBounds(placedCells: PlacedCell[]): { minX: number; minZ: number; maxX: number; maxZ: number } {
  if (placedCells.length === 0) return { minX: -4, minZ: -4, maxX: 4, maxZ: 4 };
  let minX = placedCells[0].cell.x;
  let maxX = placedCells[0].cell.x;
  let minZ = placedCells[0].cell.z;
  let maxZ = placedCells[0].cell.z;
  for (const placedCell of placedCells) {
    minX = Math.min(minX, placedCell.cell.x);
    maxX = Math.max(maxX, placedCell.cell.x);
    minZ = Math.min(minZ, placedCell.cell.z);
    maxZ = Math.max(maxZ, placedCell.cell.z);
  }
  return {
    minX: minX - MAP_PADDING_CELLS,
    minZ: minZ - MAP_PADDING_CELLS,
    maxX: maxX + MAP_PADDING_CELLS,
    maxZ: maxZ + MAP_PADDING_CELLS,
  };
}

function visibleCells(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): GridCell[] {
  const cells: GridCell[] = [];
  for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      cells.push({ x, y: 0, z });
    }
  }
  return cells;
}

function canvasX(cellX: number, bounds: { minX: number }): number {
  return (cellX - bounds.minX) * MAP_CELL_PIXELS;
}

function canvasY(cellZ: number, bounds: { minZ: number }): number {
  return (cellZ - bounds.minZ) * MAP_CELL_PIXELS;
}

function canvasWorldX(worldX: number, state: GameState, bounds: { minX: number }): number {
  return (worldX / state.world.cellSizeMeters - bounds.minX) * MAP_CELL_PIXELS;
}

function canvasWorldY(worldZ: number, state: GameState, bounds: { minZ: number }): number {
  return (worldZ / state.world.cellSizeMeters - bounds.minZ) * MAP_CELL_PIXELS;
}

export function MapCanvas() {
  const [state, setState] = useState<GameState>(loadMapState);

  useEffect(() => {
    const refreshLiveMapState = () => {
      const nextState = loadMapState();
      setState((current) => sameMapView(current, nextState) ? current : nextState);
    };
    refreshLiveMapState();
    const timer = setInterval(refreshLiveMapState, DEFAULT_LIVE_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const placedCells = Object.values(state.world.placedCells);
  const placedCellsByKey = state.world.placedCells;
  const bounds = mapBounds(placedCells);
  const cells = visibleCells(bounds);
  const playerCell = worldToCell(state.player.position, state.world.cellSizeMeters);
  const playerChunkKey = chunkKeyForCell(playerCell, state.world.chunkCellSpan);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#080d16' }}>
      <Box style={{ height: 56, paddingLeft: 14, paddingRight: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#1f2937', backgroundColor: '#111827' }}>
        <Box>
          <Text fontSize={15} color="#f8fafc" style={{ fontWeight: 800 }}>HMSC INTERNAL MAP</Text>
          <Text fontSize={11} color="#94a3b8">
            cells {placedCells.length}  player cell {cellKey(playerCell)}  chunk {playerChunkKey}
          </Text>
        </Box>
        <Pressable
          onPress={() => setState(loadMapState())}
          style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a' }}
        >
          <Text fontSize={11} color="#f8fafc" style={{ fontWeight: 800 }}>REFRESH</Text>
        </Pressable>
      </Box>
      <Canvas style={{ flex: 1, backgroundColor: '#080d16' }}>
        {cells.map((cell) => {
          const key = cellKey(cell);
          const placedCell = placedCellsByKey[key];
          return (
            <Canvas.Node
              key={key}
              gx={canvasX(cell.x, bounds)}
              gy={canvasY(cell.z, bounds)}
              gw={MAP_CELL_PIXELS}
              gh={MAP_CELL_PIXELS}
            >
              <Box
                style={{
                  width: '100%',
                  height: '100%',
                  backgroundColor: placedCell ? cellFill(placedCell) : '#0d1320',
                  borderWidth: 1,
                  borderColor: placedCell ? '#334155' : '#172033',
                }}
              />
            </Canvas.Node>
          );
        })}
        <Canvas.Node
          gx={canvasWorldX(state.player.position.x, state, bounds) - 8}
          gy={canvasWorldY(state.player.position.z, state, bounds) - 8}
          gw={16}
          gh={16}
        >
          <Box style={{ width: '100%', height: '100%', borderRadius: 999, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#dcfce7' }} />
        </Canvas.Node>
      </Canvas>
    </Box>
  );
}
