import { useEffect, useState } from 'react';
import { Box, Canvas, Pressable, ScrollView, Text } from '@reactjit/runtime/primitives';
import { DEFAULT_LIVE_SYNC_INTERVAL_MS, type GameState, type GridCell, type PlacedCell, type WorldSurfaceRegion } from '../hmsc/design';
import { createInitialGameState, readLivePlayerSnapshot, readStoredGameState } from '../hmsc/state/gameState';
import { cellCenterToWorld, cellKey, chunkKeyForCell, surfaceRegionAtCell, worldToCell } from '../hmsc/world/grid';
import { tileKindDefinition } from '../hmsc/world/tileKinds';
import { movementSurfaceForPlayer } from '../hmsc/state/hostPhysics';
import { placedCellTopMeters, surfaceRegionTopMeters } from '../hmsc/world/surfaceHeights';

const MAP_CELL_PIXELS = 4;
const MAP_CONTEXT_WATER_MARGIN_CELLS = 64;
const MAP_FALLBACK_HALF_SPAN_CELLS = 4;
const MAP_INITIAL_VIEW_ZOOM = 0.28;
const MAP_GRID_MINOR_CELLS = 16;
const MAP_GRID_MAJOR_EVERY = 4;
const MAP_GRID_STROKE_PIXELS = 1;
const MAP_WATER_BACKGROUND_ID = 'hmsc-int-water-context';

type MapBounds = {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
};

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
    && a.player.physics.velocity.x === b.player.physics.velocity.x
    && a.player.physics.velocity.y === b.player.physics.velocity.y
    && a.player.physics.velocity.z === b.player.physics.velocity.z
    && a.player.physics.grounded === b.player.physics.grounded
    && a.player.yawDegrees === b.player.yawDegrees
    && a.player.noclip === b.player.noclip
    && a.world.layout.key === b.world.layout.key
    && Object.keys(a.world.placedCells).length === Object.keys(b.world.placedCells).length
    && a.world.surfaceRegions.length === b.world.surfaceRegions.length;
}

function cellFill(placedCell: PlacedCell): string {
  return tileKindDefinition(placedCell.kind).render.color;
}

function regionFill(region: WorldSurfaceRegion): string {
  return tileKindDefinition(region.kind).render.color;
}

function mapBounds(placedCells: PlacedCell[], surfaceRegions: WorldSurfaceRegion[]): MapBounds {
  const framedRegions = surfaceRegions.filter((region) => region.kind !== 'water');
  if (placedCells.length === 0 && framedRegions.length === 0) {
    return {
      minX: -MAP_FALLBACK_HALF_SPAN_CELLS,
      minZ: -MAP_FALLBACK_HALF_SPAN_CELLS,
      maxX: MAP_FALLBACK_HALF_SPAN_CELLS,
      maxZ: MAP_FALLBACK_HALF_SPAN_CELLS,
    };
  }
  const firstRegion = framedRegions[0];
  let minX = firstRegion ? firstRegion.x : placedCells[0].cell.x;
  let maxX = firstRegion ? firstRegion.x + firstRegion.width - 1 : placedCells[0].cell.x;
  let minZ = firstRegion ? firstRegion.z : placedCells[0].cell.z;
  let maxZ = firstRegion ? firstRegion.z + firstRegion.depth - 1 : placedCells[0].cell.z;
  for (const region of framedRegions) {
    minX = Math.min(minX, region.x);
    maxX = Math.max(maxX, region.x + region.width - 1);
    minZ = Math.min(minZ, region.z);
    maxZ = Math.max(maxZ, region.z + region.depth - 1);
  }
  for (const placedCell of placedCells) {
    minX = Math.min(minX, placedCell.cell.x);
    maxX = Math.max(maxX, placedCell.cell.x);
    minZ = Math.min(minZ, placedCell.cell.z);
    maxZ = Math.max(maxZ, placedCell.cell.z);
  }
  return {
    minX: minX - MAP_CONTEXT_WATER_MARGIN_CELLS,
    minZ: minZ - MAP_CONTEXT_WATER_MARGIN_CELLS,
    maxX: maxX + MAP_CONTEXT_WATER_MARGIN_CELLS,
    maxZ: maxZ + MAP_CONTEXT_WATER_MARGIN_CELLS,
  };
}

function mapPixelWidth(bounds: MapBounds): number {
  return (bounds.maxX - bounds.minX + 1) * MAP_CELL_PIXELS;
}

function mapPixelHeight(bounds: MapBounds): number {
  return (bounds.maxZ - bounds.minZ + 1) * MAP_CELL_PIXELS;
}

function canvasNodeCenterX(cellX: number, widthCells: number, bounds: MapBounds): number {
  return (cellX - bounds.minX) * MAP_CELL_PIXELS + widthCells * MAP_CELL_PIXELS / 2;
}

function canvasNodeCenterY(cellZ: number, depthCells: number, bounds: MapBounds): number {
  return (cellZ - bounds.minZ) * MAP_CELL_PIXELS + depthCells * MAP_CELL_PIXELS / 2;
}

function canvasWorldX(worldX: number, state: GameState, bounds: MapBounds): number {
  return (worldX / state.world.cellSizeMeters - bounds.minX) * MAP_CELL_PIXELS;
}

function canvasWorldY(worldZ: number, state: GameState, bounds: MapBounds): number {
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

function DiagnosticsSection(props: { title: string; children: any }) {
  return (
    <Box style={{ gap: 6, paddingTop: 8, paddingBottom: 8, borderTopWidth: 1, borderTopColor: '#1f2937' }}>
      <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace', fontWeight: 800 }}>{props.title}</Text>
      {props.children}
    </Box>
  );
}

function formatBoolean(value: boolean): string {
  return value ? 'true' : 'false';
}

function formatVector3(value: { x: number; y: number; z: number }): string {
  return `${formatNumber(value.x)}, ${formatNumber(value.y)}, ${formatNumber(value.z)}`;
}

function tileBlocksPlayer(definition: ReturnType<typeof tileKindDefinition>): boolean {
  return definition.surface.material !== 'water' && !definition.pathing.walkable;
}

function collisionTopForCell(state: GameState, placedCell?: PlacedCell, surfaceRegion?: WorldSurfaceRegion): number | null {
  if (placedCell) return placedCellTopMeters(placedCell, state.world.cellSizeMeters);
  if (surfaceRegion) return surfaceRegionTopMeters(surfaceRegion, state.world.cellSizeMeters);
  return null;
}

function PlayerMovementDiagnostics(props: { state: GameState; playerCell: GridCell }) {
  const walkSurface = movementSurfaceForPlayer(props.state, false);
  const runSurface = movementSurfaceForPlayer(props.state, true);
  const speed = Math.hypot(
    props.state.player.physics.velocity.x,
    props.state.player.physics.velocity.y,
    props.state.player.physics.velocity.z,
  );
  const horizontalSpeed = Math.hypot(
    props.state.player.physics.velocity.x,
    props.state.player.physics.velocity.z,
  );
  const effectiveWalkSpeed = props.state.player.walkSpeedMetersPerSecond * walkSurface.speedMultiplier;
  const effectiveRunSpeed = props.state.player.runSpeedMetersPerSecond * runSurface.speedMultiplier;

  return (
    <DiagnosticsSection title="PLAYER MOVEMENT">
      <DiagnosticsRow label="player.cell" value={cellKey(props.playerCell)} />
      <DiagnosticsRow label="player.pos" value={formatVector3(props.state.player.position)} />
      <DiagnosticsRow label="velocity" value={formatVector3(props.state.player.physics.velocity)} />
      <DiagnosticsRow label="speed_mps" value={formatNumber(speed)} />
      <DiagnosticsRow label="horiz_mps" value={formatNumber(horizontalSpeed)} />
      <DiagnosticsRow label="yaw_deg" value={formatNumber(props.state.player.yawDegrees)} />
      <DiagnosticsRow label="grounded" value={formatBoolean(props.state.player.physics.grounded)} />
      <DiagnosticsRow label="noclip" value={formatBoolean(props.state.player.noclip)} />
      <DiagnosticsRow label="surface" value={walkSurface.label} />
      <DiagnosticsRow label="walk_mps" value={formatNumber(effectiveWalkSpeed)} />
      <DiagnosticsRow label="run_mps" value={formatNumber(effectiveRunSpeed)} />
      <DiagnosticsRow label="accel_x" value={formatNumber(walkSurface.accelerationMultiplier)} />
      <DiagnosticsRow label="friction" value={formatNumber(walkSurface.friction)} />
      <DiagnosticsRow label="bounce" value={formatNumber(walkSurface.restitution)} />
    </DiagnosticsSection>
  );
}

function TileDiagnostics(props: { state: GameState; cell: GridCell; placedCell?: PlacedCell; surfaceRegion?: WorldSurfaceRegion }) {
  const placedCell = props.placedCell;
  const surfaceRegion = props.surfaceRegion;
  const center = cellCenterToWorld(props.cell, props.state.world.cellSizeMeters);
  const chunkKey = chunkKeyForCell(props.cell, props.state.world.chunkCellSpan);
  const playerCell = worldToCell(props.state.player.position, props.state.world.cellSizeMeters);
  const definition = placedCell
    ? tileKindDefinition(placedCell.kind)
    : surfaceRegion
      ? tileKindDefinition(surfaceRegion.kind)
      : null;
  const collisionTop = collisionTopForCell(props.state, placedCell, surfaceRegion);

  return (
    <Box style={{ width: 360, height: '100%', borderLeftWidth: 1, borderLeftColor: '#1f2937', backgroundColor: '#0b1220' }}>
      <ScrollView style={{ flex: 1, padding: 14 }} showScrollbar>
        <Box style={{ gap: 10 }}>
          <Box style={{ gap: 2 }}>
            <Text fontSize={13} color="#f8fafc" style={{ fontWeight: 800 }}>MAP DIAGNOSTICS</Text>
            <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace' }}>{cellKey(props.cell)}</Text>
          </Box>

          <DiagnosticsSection title="CELL">
            <DiagnosticsRow label="cell.x" value={String(props.cell.x)} />
            <DiagnosticsRow label="cell.y" value={String(props.cell.y)} />
            <DiagnosticsRow label="cell.z" value={String(props.cell.z)} />
            <DiagnosticsRow label="chunk" value={chunkKey} />
            <DiagnosticsRow label="world.center.x" value={formatNumber(center.x)} />
            <DiagnosticsRow label="world.center.y" value={formatNumber(center.y)} />
            <DiagnosticsRow label="world.center.z" value={formatNumber(center.z)} />
          </DiagnosticsSection>

          {definition ? (
            <>
              <DiagnosticsSection title="TILE">
                <DiagnosticsRow label="kind" value={definition.kind} />
                <DiagnosticsRow label="label" value={definition.label} />
                <DiagnosticsRow label="texture" value={definition.render.textureKey} />
                <DiagnosticsRow label="trigger" value={placedCell?.triggerCommand ?? 'none'} />
                <DiagnosticsRow label="trigger.label" value={placedCell?.triggerLabel ?? 'none'} />
                <DiagnosticsRow label="surface.region" value={surfaceRegion?.id ?? 'none'} />
                <DiagnosticsRow label="render.color" value={definition.render.color} swatch={definition.render.color} />
                <DiagnosticsRow label="render.height_m" value={formatNumber(definition.render.heightMeters)} />
              </DiagnosticsSection>

              <DiagnosticsSection title="COLLISION">
                <DiagnosticsRow label="player_blocks" value={formatBoolean(tileBlocksPlayer(definition))} />
                <DiagnosticsRow label="ground_surface" value={formatBoolean(!tileBlocksPlayer(definition))} />
                <DiagnosticsRow label="collision.top_m" value={collisionTop == null ? 'none' : formatNumber(collisionTop)} />
                <DiagnosticsRow label="step_height_m" value={formatNumber(props.state.config.physics.playerStepHeightMeters)} />
                <DiagnosticsRow label="capsule.radius" value={formatNumber(props.state.config.physics.playerCapsuleRadiusMeters)} />
                <DiagnosticsRow label="capsule.height" value={formatNumber(props.state.config.physics.playerCapsuleHeightMeters)} />
                <DiagnosticsRow label="wall_bounce" value={formatNumber(props.state.config.physics.wallRestitution)} />
              </DiagnosticsSection>

              <DiagnosticsSection title="MOVEMENT SURFACE">
                <DiagnosticsRow label="material" value={definition.surface.material} />
                <DiagnosticsRow label="walk_x" value={formatNumber(definition.surface.walkSpeedMultiplier)} />
                <DiagnosticsRow label="run_x" value={formatNumber(definition.surface.runSpeedMultiplier)} />
                <DiagnosticsRow label="vehicle_x" value={formatNumber(definition.surface.vehicleSpeedMultiplier)} />
                <DiagnosticsRow label="accel_x" value={formatNumber(definition.surface.accelerationMultiplier)} />
                <DiagnosticsRow label="friction" value={formatNumber(definition.surface.friction)} />
                <DiagnosticsRow label="lateral_grip" value={formatNumber(definition.surface.lateralGrip)} />
                <DiagnosticsRow label="restitution" value={formatNumber(definition.surface.restitution)} />
              </DiagnosticsSection>

              <DiagnosticsSection title="NPC / PATHING">
                <DiagnosticsRow label="path.walkable" value={formatBoolean(definition.pathing.walkable)} />
                <DiagnosticsRow label="path.cost" value={formatNumber(definition.pathing.movementCost)} />
                <DiagnosticsRow label="npc.traversable" value={formatBoolean(definition.npc.traversable)} />
                <DiagnosticsRow label="npc.walk_cost" value={formatNumber(definition.npc.walkCost)} />
                <DiagnosticsRow label="npc.run_cost" value={formatNumber(definition.npc.runCost)} />
                <DiagnosticsRow label="npc.vehicle_cost" value={formatNumber(definition.npc.vehicleCost)} />
                <DiagnosticsRow label="modes" value={definition.traversal.allowedModes.join(',') || 'none'} />
                <DiagnosticsRow label="width" value={definition.traversal.width} />
                <DiagnosticsRow label="max_step_m" value={formatNumber(definition.traversal.maxStepUpMeters)} />
                <DiagnosticsRow label="clearance_m" value={formatNumber(definition.traversal.minClearanceMeters)} />
                <DiagnosticsRow label="slope_deg" value={formatNumber(definition.traversal.slopeLimitDegrees)} />
                <DiagnosticsRow label="vehicle_grip" value={formatNumber(definition.traversal.vehicleGripMultiplier)} />
              </DiagnosticsSection>

              <DiagnosticsSection title="COVER / VISIBILITY">
                <DiagnosticsRow label="cover" value={definition.cover.height} />
                <DiagnosticsRow label="protection" value={formatNumber(definition.cover.protection)} />
                <DiagnosticsRow label="concealment" value={formatNumber(definition.cover.concealment)} />
                <DiagnosticsRow label="shoot_over" value={formatBoolean(definition.cover.shootOver)} />
                <DiagnosticsRow label="lean_around" value={formatBoolean(definition.cover.leanAround)} />
                <DiagnosticsRow label="los_block" value={formatBoolean(definition.visibility.blocksLineOfSight)} />
                <DiagnosticsRow label="opacity" value={formatNumber(definition.visibility.opacity)} />
                <DiagnosticsRow label="light_transmit" value={formatNumber(definition.visibility.lightTransmission)} />
                <DiagnosticsRow label="sound_occlude" value={formatNumber(definition.visibility.soundOcclusion)} />
              </DiagnosticsSection>

              <DiagnosticsSection title="DOOR">
                <DiagnosticsRow label="is_door" value={formatBoolean(definition.door.isDoor)} />
                <DiagnosticsRow label="state" value={definition.door.defaultState} />
                <DiagnosticsRow label="interaction" value={definition.door.interaction} />
                <DiagnosticsRow label="width_m" value={formatNumber(definition.door.widthMeters)} />
                <DiagnosticsRow label="closed_blocks_move" value={formatBoolean(definition.door.blocksMovementWhenClosed)} />
                <DiagnosticsRow label="closed_blocks_los" value={formatBoolean(definition.door.blocksLineOfSightWhenClosed)} />
                <DiagnosticsRow label="vehicle_pass" value={formatBoolean(definition.door.vehiclePassable)} />
                <DiagnosticsRow label="open_cost" value={formatNumber(definition.door.openCost)} />
              </DiagnosticsSection>
            </>
          ) : (
            <DiagnosticsSection title="TILE">
              <DiagnosticsRow label="kind" value="empty" />
              <DiagnosticsRow label="texture" value="none" />
              <DiagnosticsRow label="player_blocks" value="true" />
              <DiagnosticsRow label="ground_surface" value="false" />
              <DiagnosticsRow label="path.walkable" value="false" />
              <DiagnosticsRow label="path.cost" value="blocked" />
            </DiagnosticsSection>
          )}

          <PlayerMovementDiagnostics state={props.state} playerCell={playerCell} />

          <Box style={{ gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#1f2937' }}>
            <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>created_by</Text>
            <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>
              {placedCell?.createdByCommand ?? surfaceRegion?.label ?? 'none'}
            </Text>
          </Box>
        </Box>
      </ScrollView>
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
  const surfaceRegions = state.world.surfaceRegions;
  const mappedSurfaceRegions = surfaceRegions.filter((region) => region.kind !== 'water');
  const placedCellsByKey = state.world.placedCells;
  const bounds = mapBounds(placedCells, surfaceRegions);
  const boundsPixelWidth = mapPixelWidth(bounds);
  const boundsPixelHeight = mapPixelHeight(bounds);
  const playerCell = worldToCell(state.player.position, state.world.cellSizeMeters);
  const playerChunkKey = chunkKeyForCell(playerCell, state.world.chunkCellSpan);
  const diagnosticsCell = selectedCell ?? playerCell;
  const diagnosticsKey = cellKey(diagnosticsCell);
  const selectedPlacedCell = placedCellsByKey[diagnosticsKey];
  const selectedSurfaceRegion = surfaceRegionAtCell(state, diagnosticsCell);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#080d16' }}>
      <Box style={{ height: 56, paddingLeft: 14, paddingRight: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#1f2937', backgroundColor: '#111827' }}>
        <Box>
          <Text fontSize={15} color="#f8fafc" style={{ fontWeight: 800 }}>HMSC INTERNAL MAP</Text>
          <Text fontSize={11} color="#94a3b8">
            layout {state.world.layout.widthCells}x{state.world.layout.depthCells}  cells {placedCells.length}  land regions {mappedSurfaceRegions.length}  player cell {cellKey(playerCell)}  chunk {playerChunkKey}
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
        <Canvas
          style={{ flex: 1, backgroundColor: '#080d16' }}
          viewX={boundsPixelWidth / 2}
          viewY={boundsPixelHeight / 2}
          viewZoom={MAP_INITIAL_VIEW_ZOOM}
          gridStep={MAP_CELL_PIXELS * MAP_GRID_MINOR_CELLS}
          gridStroke={MAP_GRID_STROKE_PIXELS}
          gridColor="#17324a"
          gridMajorColor="#2c536f"
          gridMajorEvery={MAP_GRID_MAJOR_EVERY}
        >
          <Canvas.Node
            key={MAP_WATER_BACKGROUND_ID}
            gx={boundsPixelWidth / 2}
            gy={boundsPixelHeight / 2}
            gw={boundsPixelWidth}
            gh={boundsPixelHeight}
          >
            <Box style={{ width: '100%', height: '100%', backgroundColor: tileKindDefinition('water').render.color }} />
          </Canvas.Node>
          {mappedSurfaceRegions.map((region) => (
            <Canvas.Node
              key={region.id}
              gx={canvasNodeCenterX(region.x, region.width, bounds)}
              gy={canvasNodeCenterY(region.z, region.depth, bounds)}
              gw={region.width * MAP_CELL_PIXELS}
              gh={region.depth * MAP_CELL_PIXELS}
            >
              <Pressable
                onPress={() => setSelectedCell({ x: region.x, y: region.y, z: region.z })}
                style={{
                  width: '100%',
                  height: '100%',
                  backgroundColor: regionFill(region),
                  borderWidth: 1,
                  borderColor: '#1f2937',
                }}
              />
            </Canvas.Node>
          ))}
          {placedCells.map((placedCell) => {
            const cell = placedCell.cell;
            const key = placedCell.key;
            const selected = key === diagnosticsKey;
            return (
              <Canvas.Node
                key={key}
                gx={canvasNodeCenterX(cell.x, 1, bounds)}
                gy={canvasNodeCenterY(cell.z, 1, bounds)}
                gw={MAP_CELL_PIXELS}
                gh={MAP_CELL_PIXELS}
              >
                <Pressable
                  onPress={() => setSelectedCell(cell)}
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor: cellFill(placedCell),
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? '#f8fafc' : '#334155',
                  }}
                />
              </Canvas.Node>
            );
          })}
          <Canvas.Node
            gx={canvasWorldX(state.player.position.x, state, bounds)}
            gy={canvasWorldY(state.player.position.z, state, bounds)}
            gw={16}
            gh={16}
          >
            <Box style={{ width: '100%', height: '100%', borderRadius: 999, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#dcfce7' }} />
          </Canvas.Node>
        </Canvas>
        <TileDiagnostics state={state} cell={diagnosticsCell} placedCell={selectedPlacedCell} surfaceRegion={selectedSurfaceRegion} />
      </Box>
    </Box>
  );
}
