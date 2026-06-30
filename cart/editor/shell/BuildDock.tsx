import { Icon } from '../../../runtime/icons/Icon';
import { useTelemetry } from '../../../runtime/hooks/useTelemetry';
import { C, accentFor } from '../workspace.cls';
import { ACTIVE_BUILD } from '../data/journal';
import { editTelemetry, formatMs } from '../data/telemetry';
import { selectedObject } from '../data/content';
import { formatBytes, formatCount, formatMeters, selectionPosition, snapReadout, validationReadout } from '../data/readouts';
import type { MockState } from '../data/types';

export default function BuildDock({ state, onBuild, onEventbus }: { state: MockState; onBuild: () => void; onEventbus: () => void }) {
  const telemetry = editTelemetry(state.history);
  const activeObject = selectedObject(state);
  const position = selectionPosition(state, activeObject);
  const snap = snapReadout(state);
  const validation = validationReadout(state);
  // Real host telemetry — polled at 2Hz (cheap; never per-frame). Empty sources
  // render as 0/— instead of seeded historical data.
  const { value: fps } = useTelemetry({ kind: 'fps', pollMs: 500 });
  const { data: frame } = useTelemetry<{ frame_total_us?: number; gpu_us?: number }>({ kind: 'frame', pollMs: 500 });
  const { data: gpu } = useTelemetry<{ scene3d_triangles?: number; scene3d_draw_calls?: number }>({ kind: 'gpu', pollMs: 500 });
  const { data: system } = useTelemetry<{ process_rss_bytes?: number; mem_total_bytes?: number }>({ kind: 'system', pollMs: 1000 });
  const frameMs = frame?.frame_total_us ? frame.frame_total_us / 1000 : 0;
  const gpuMs = frame?.gpu_us ? frame.gpu_us / 1000 : 0;
  const triCount = gpu?.scene3d_triangles ?? 0;
  const drawCalls = gpu?.scene3d_draw_calls ?? 0;
  return (
    <C.HW_BuildDock>
      <C.HW_DockBuild onPress={onBuild}>
        <C.HW_DockLabel>Build:</C.HW_DockLabel>
        <C.HW_DockValue>{ACTIVE_BUILD.build}</C.HW_DockValue>
        <Icon name="CircleCheck" size={15} color={accentFor('success')} />
      </C.HW_DockBuild>
      <C.HW_DockDivider />
      <C.HW_DockGroup>
        <Icon name={validation.errors === 0 ? 'CircleCheck' : 'TriangleAlert'} size={12} color={accentFor(validation.errors === 0 ? 'success' : 'error')} />
        <C.HW_DockLabel>ERR</C.HW_DockLabel>
        <C.HW_DockValue>{validation.errors}</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockGroup>
        <Icon name="TriangleAlert" size={12} color={accentFor(validation.warnings === 0 ? 'textFaint' : 'warning')} />
        <C.HW_DockLabel>WARN</C.HW_DockLabel>
        <C.HW_DockValue>{validation.warnings}</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockDivider />
      <C.HW_DockGroup>
        <C.HW_DockLabel>POS</C.HW_DockLabel>
        <C.HW_DockCoord>X {position.x}</C.HW_DockCoord>
        <C.HW_DockCoord>Y {position.y}</C.HW_DockCoord>
        <C.HW_DockCoord>Z {position.z}</C.HW_DockCoord>
      </C.HW_DockGroup>
      <C.HW_DockGroup>
        <C.HW_DockLabel>GRID</C.HW_DockLabel>
        <C.HW_DockValue>{formatMeters(snap.gridMeters)}</C.HW_DockValue>
        <C.HW_DockLabel>ANG</C.HW_DockLabel>
        <C.HW_DockValue>{Math.max(0, Math.round(snap.angleDegrees))}deg</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockDivider />
      <C.HW_DockBuild onPress={onEventbus}>
        <Icon name="Workflow" size={12} color={accentFor(state.eventbusPopoverOpen ? 'primary' : 'textSecondary')} />
        <C.HW_DockLabel>BUS</C.HW_DockLabel>
        <C.HW_DockValue>{state.history.length}</C.HW_DockValue>
      </C.HW_DockBuild>
      <C.HW_DockGroup>
        <C.HW_DockLabel>AVG</C.HW_DockLabel>
        <C.HW_DockValue>{formatMs(telemetry.avg)}</C.HW_DockValue>
        <C.HW_DockLabel>P95</C.HW_DockLabel>
        <C.HW_DockValue>{formatMs(telemetry.p95)}</C.HW_DockValue>
        <C.HW_DockLabel>DELTA</C.HW_DockLabel>
        <C.HW_DockCoord>+{formatMs(telemetry.delta)}</C.HW_DockCoord>
      </C.HW_DockGroup>
      <C.HW_DockGroup>
        <Icon name={telemetry.parity === 'stable' ? 'CircleCheck' : 'TriangleAlert'} size={12} color={accentFor(telemetry.parity === 'stable' ? 'success' : 'warning')} />
        <C.HW_DockLabel>PARITY</C.HW_DockLabel>
        <C.HW_DockValue>{telemetry.parity}</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockDivider />
      <C.HW_DockGroup>
        <C.HW_DockLabel>FPS:</C.HW_DockLabel>
        <C.HW_DockCoord>{fps > 0 ? Math.round(fps) : '—'}</C.HW_DockCoord>
        <C.HW_DockLabel>FRAME</C.HW_DockLabel>
        <C.HW_DockValue>{frameMs > 0 ? formatMs(frameMs) : '—'}</C.HW_DockValue>
        <C.HW_DockLabel>GPU</C.HW_DockLabel>
        <C.HW_DockValue>{gpuMs > 0 ? formatMs(gpuMs) : '—'}</C.HW_DockValue>
        <C.HW_DockLabel>TRI</C.HW_DockLabel>
        <C.HW_DockValue>{formatCount(triCount)}</C.HW_DockValue>
        <C.HW_DockLabel>DC</C.HW_DockLabel>
        <C.HW_DockValue>{formatCount(drawCalls)}</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_Spacer />
      <C.HW_DockGroup>
        <Icon name="Activity" size={13} color={accentFor('textFaint')} />
        <C.HW_DockLabel>MEM</C.HW_DockLabel>
        <C.HW_DockLabel>{formatBytes(system?.process_rss_bytes)}/{formatBytes(system?.mem_total_bytes)}</C.HW_DockLabel>
      </C.HW_DockGroup>
    </C.HW_BuildDock>
  );
}
