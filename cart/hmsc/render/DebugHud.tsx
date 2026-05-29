import { Box, Text } from '@reactjit/runtime/primitives';
import { useTelemetry } from '@reactjit/runtime/hooks/useTelemetry';
import type { GameState, Vec3 } from '../design';
import { movementSurfaceForPlayer } from '../state/hostPhysics';
import { worldToCell } from '../world/grid';

type HmscDebugHudProps = {
  state: GameState;
  cameraYawDegrees: number;
  cameraPitchRadians: number;
  aiming: boolean;
  mouseFocused: boolean;
  playerMoving: boolean;
  playerRunning: boolean;
  hostPhysicsUs: number;
};

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fmtUs(value: unknown): string {
  const us = num(value);
  return us >= 1000 ? `${(us / 1000).toFixed(2)}ms` : `${us.toFixed(0)}us`;
}

function fmtVec3(value: Vec3): string {
  return `${value.x.toFixed(2)}, ${value.y.toFixed(2)}, ${value.z.toFixed(2)}`;
}

function row(label: string, value: string, color = '#e2e8f0') {
  return (
    <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace', lineHeight: 14 }}>
      {label} <Text fontSize={10} color={color} style={{ fontFamily: 'monospace', fontWeight: 800 }}>{value}</Text>
    </Text>
  );
}

function section(label: string) {
  return <Text fontSize={10} color="#38bdf8" style={{ fontFamily: 'monospace', fontWeight: 900, lineHeight: 14 }}>{label}</Text>;
}

export function HmscDebugHud(props: HmscDebugHudProps) {
  // DIAGNOSTIC: polls slowed to 1000ms. Every poll changes the on-screen
  // numbers, which dirties the 2D draw data and forces a full GPU buffer
  // re-upload (gpu.zig data_changed path) — i.e. the HUD refresh IS the GPU
  // spike it displays. At 1000ms the spikes should drop to ~1/sec. Was 250/500.
  const fps = useTelemetry({ kind: 'fps', pollMs: 1000 }).value;
  const frame = useTelemetry<any>({ kind: 'frame', pollMs: 1000 }).data;
  const gpu = useTelemetry<any>({ kind: 'gpu', pollMs: 1000 }).data;
  const nodes = useTelemetry<any>({ kind: 'nodes', pollMs: 1000 }).data;
  const input = useTelemetry<any>({ kind: 'input', pollMs: 1000 }).data;
  const surface = movementSurfaceForPlayer(props.state, props.playerRunning);
  const player = props.state.player;
  const cell = worldToCell(player.position, props.state.world.cellSizeMeters);
  const spawnedCount = Object.keys(props.state.world.spawnedEntities).length;
  const placedCount = Object.keys(props.state.world.placedCells).length;
  const totalFrameUs = num(frame?.frame_total_us);
  const knownFrameUs = num(frame?.tick_us) + num(frame?.layout_us) + num(frame?.paint_us) + num(frame?.gpu_us);
  const otherFrameUs = Math.max(0, totalFrameUs - knownFrameUs);
  const fpsColor = fps >= 120 ? '#86efac' : fps >= 60 ? '#facc15' : '#fb7185';

  return (
    <Box style={{
      position: 'absolute',
      top: 14,
      right: 14,
      width: 382,
      padding: 10,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: '#1e3a5f',
      backgroundColor: '#020617e6',
      gap: 5,
      zIndex: 5,
    }}>
      <Text fontSize={12} color="#f8fafc" style={{ fontWeight: 900, letterSpacing: 0 }}>HMSC DEBUG HUD</Text>
      <Box style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
        {row('fps', fps.toFixed(0), fpsColor)}
        {row('frame', fmtUs(frame?.frame_total_us))}
        {row('host phys', fmtUs(props.hostPhysicsUs))}
        {row('draw', fmtUs(gpu?.scene3d_draw_us))}
      </Box>
      <Box style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
        {row('tick', fmtUs(frame?.tick_us))}
        {row('layout', fmtUs(frame?.layout_us))}
        {row('paint', fmtUs(frame?.paint_us))}
        {row('gpu', fmtUs(frame?.gpu_us))}
        {row('other', fmtUs(otherFrameUs))}
      </Box>
      {section('render')}
      <Box style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
        {row('3d calls', num(gpu?.scene3d_draw_calls).toLocaleString())}
        {row('instances', num(gpu?.scene3d_instances).toLocaleString())}
        {row('meshes', `${num(gpu?.scene3d_meshes_collected).toLocaleString()}/${num(gpu?.scene3d_mesh_children).toLocaleString()}`)}
        {row('dropped', num(gpu?.scene3d_meshes_dropped).toLocaleString(), num(gpu?.scene3d_meshes_dropped) > 0 ? '#fb7185' : '#86efac')}
      </Box>
      <Box style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
        {row('nodes', `${num(nodes?.visible).toLocaleString()}/${num(nodes?.total).toLocaleString()}`)}
        {row('zero', num(nodes?.zero_size).toLocaleString())}
        {row('glyphs', `${num(gpu?.glyph_count).toLocaleString()}/${num(gpu?.glyph_capacity).toLocaleString()}`)}
        {row('rects', `${num(gpu?.rect_count).toLocaleString()}/${num(gpu?.rect_capacity).toLocaleString()}`)}
      </Box>
      {section('player')}
      <Box style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
        {row('pos', fmtVec3(player.position))}
        {row('cell', `${cell.x}, ${cell.y}, ${cell.z}`)}
      </Box>
      <Box style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
        {row('vel', fmtVec3(player.physics.velocity))}
        {row('ground', player.physics.grounded ? '1' : '0', player.physics.grounded ? '#86efac' : '#facc15')}
        {row('yaw', `${player.yawDegrees.toFixed(1)}deg`)}
      </Box>
      <Box style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
        {row('surface', surface.label)}
        {row('friction', surface.friction.toFixed(2))}
        {row('speed x', surface.speedMultiplier.toFixed(2))}
        {row('move', props.playerMoving ? '1' : '0')}
        {row('run', props.playerRunning ? '1' : '0')}
      </Box>
      {section('camera/input')}
      <Box style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
        {row('cam yaw', `${props.cameraYawDegrees.toFixed(1)}deg`)}
        {row('pitch', props.cameraPitchRadians.toFixed(3))}
        {row('aim', props.aiming ? '1' : '0', props.aiming ? '#facc15' : '#94a3b8')}
        {row('focus', props.mouseFocused ? '1' : '0', props.mouseFocused ? '#86efac' : '#94a3b8')}
      </Box>
      <Box style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
        {row('input active', String(num(input?.active_count)))}
        {row('focus id', String(num(input?.focused_id, -1)))}
        {row('selected', input?.has_selection ? '1' : '0')}
      </Box>
      {section('world')}
      <Box style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
        {row('scene', props.state.sceneStep)}
        {row('cells', placedCount.toLocaleString())}
        {row('regions', props.state.world.surfaceRegions.length.toLocaleString())}
        {row('entities', spawnedCount.toLocaleString())}
      </Box>
    </Box>
  );
}
