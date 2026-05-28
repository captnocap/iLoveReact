import { useEffect, useState } from 'react';
import { Box, Canvas, Pressable, Text } from '@reactjit/runtime/primitives';
import { DEFAULT_LIVE_SYNC_INTERVAL_MS, type GameState, type GridCell, type PlacedCell } from '../hmsc/design';
import { createInitialGameState, readLivePlayerSnapshot, readStoredGameState } from '../hmsc/state/gameState';
import { cellCenterToWorld, cellKey, chunkKeyForCell, worldToCell } from '../hmsc/world/grid';
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

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'blocked';
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function DiagnosticsRow(props: { label: string; value: string; swatch?: string }) {
  return (
    <Box style={{ flexDirection: 'row', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
      <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>{props.label}</Text>
      <Box style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexShrink: 1 }}>
        {props.swatch ? <Box style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: props.swatch, borderWidth: 1, borderColor: '#475569' }} /> : null}
        <Text fontSize={10} color="#e2e8f0" style={{ fontFamily: 'monospace', textAlign: 'right' }}>{props.value}</Text>
      </Box>
    </Box>
  );
}

function TileDiagnostics(props: { state: GameState; cell: GridCell; placedCell?: PlacedCell }) {
  const placedCell = props.placedCell;
  const center = cellCenterToWorld(props.cell, props.state.world.cellSizeMeters);
  const chunkKey = chunkKeyForCell(props.cell, props.state.world.chunkCellSpan);
  const definition = placedCell ? tileKindDefinition(placedCell.kind) : null;

  return (
    <Box style={{ width: 318, height: '100%', borderLeftWidth: 1, borderLeftColor: '#1f2937', backgroundColor: '#0b1220', padding: 14, gap: 10 }}>
      <Box style={{ gap: 2 }}>
        <Text fontSize={13} color="#f8fafc" style={{ fontWeight: 800 }}>TILE DIAGNOSTICS</Text>
        <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace' }}>{cellKey(props.cell)}</Text>
      </Box>

      <Box style={{ gap: 6, paddingTop: 8, paddingBottom: 8, borderTopWidth: 1, borderTopColor: '#1f2937', borderBottomWidth: 1, borderBottomColor: '#1f2937' }}>
        <DiagnosticsRow label="cell.x" value={String(props.cell.x)} />
        <DiagnosticsRow label="cell.y" value={String(props.cell.y)} />
        <DiagnosticsRow label="cell.z" value={String(props.cell.z)} />
        <DiagnosticsRow label="chunk" value={chunkKey} />
        <DiagnosticsRow label="world.center.x" value={formatNumber(center.x)} />
        <DiagnosticsRow label="world.center.y" value={formatNumber(center.y)} />
        <DiagnosticsRow label="world.center.z" value={formatNumber(center.z)} />
      </Box>

      {definition ? (
        <Box style={{ gap: 6 }}>
          <DiagnosticsRow label="kind" value={definition.kind} />
          <DiagnosticsRow label="label" value={definition.label} />
          <DiagnosticsRow label="texture" value={definition.render.textureKey} />
          <DiagnosticsRow label="render.color" value={definition.render.color} swatch={definition.render.color} />
          <DiagnosticsRow label="render.height_m" value={formatNumber(definition.render.heightMeters)} />
          <DiagnosticsRow label="path.walkable" value={definition.pathing.walkable ? 'true' : 'false'} />
          <DiagnosticsRow label="path.cost" value={formatNumber(definition.pathing.movementCost)} />
          <DiagnosticsRow label="blocks_los" value={definition.pathing.blocksLineOfSight ? 'true' : 'false'} />
        </Box>
      ) : (
        <Box style={{ gap: 6 }}>
          <DiagnosticsRow label="kind" value="empty" />
          <DiagnosticsRow label="texture" value="none" />
          <DiagnosticsRow label="path.walkable" value="false" />
          <DiagnosticsRow label="path.cost" value="blocked" />
        </Box>
      )}

      <Box style={{ gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#1f2937' }}>
        <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>created_by</Text>
        <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>
          {placedCell?.createdByCommand ?? 'none'}
        </Text>
      </Box>
    </Box>
  );
}

export function MapCanvas() {
  const [state, setState] = useState<GameState>(loadMapState);
  const [selectedCell, setSelectedCell] = useState<GridCell | null>(null);

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
  const diagnosticsCell = selectedCell ?? playerCell;
  const diagnosticsKey = cellKey(diagnosticsCell);
  const selectedPlacedCell = placedCellsByKey[diagnosticsKey];

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
      <Box style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <Canvas style={{ flex: 1, backgroundColor: '#080d16' }}>
          {cells.map((cell) => {
            const key = cellKey(cell);
            const placedCell = placedCellsByKey[key];
            const selected = key === diagnosticsKey;
            return (
              <Canvas.Node
                key={key}
                gx={canvasX(cell.x, bounds)}
                gy={canvasY(cell.z, bounds)}
                gw={MAP_CELL_PIXELS}
                gh={MAP_CELL_PIXELS}
              >
                <Pressable
                  onPress={() => setSelectedCell(cell)}
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor: placedCell ? cellFill(placedCell) : '#0d1320',
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? '#f8fafc' : placedCell ? '#334155' : '#172033',
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
        <TileDiagnostics state={state} cell={diagnosticsCell} placedCell={selectedPlacedCell} />
      </Box>
    </Box>
  );
}
