import { Icon } from '../../../runtime/icons/Icon';
import { useTelemetry } from '../../../runtime/hooks/useTelemetry';
import { C, accentFor } from '../workspace.cls';
import { ACTIVE_BUILD, BUILD_NOTES } from '../data/journal';
import { editTelemetry, formatMs } from '../data/telemetry';
import type { MockState } from '../data/types';

export default function BuildDock({ state, onBuild, onEventbus }: { state: MockState; onBuild: () => void; onEventbus: () => void }) {
  const reversible = state.history.filter((event) => event.undoable).length;
  const telemetry = editTelemetry(state.history);
  // Real render perf from the host frame telemetry — polled at 2Hz (cheap; never
  // per-frame). FPS reads the true refresh, not a mocked 60. Frame/GPU are the
  // honest µs→ms timings; 3D triangle/draw-call/mem readouts await their own
  // world-render doors (no host source yet — shown as '—' rather than faked).
  const { value: fps } = useTelemetry({ kind: 'fps', pollMs: 500 });
  const { data: frame } = useTelemetry<{ frame_total_us?: number; gpu_us?: number }>({ kind: 'frame', pollMs: 500 });
  const frameMs = frame?.frame_total_us ? frame.frame_total_us / 1000 : 0;
  const gpuMs = frame?.gpu_us ? frame.gpu_us / 1000 : 0;
  return (
    <C.HW_BuildDock>
      <C.HW_DockBuild onPress={onBuild}>
        <C.HW_DockLabel>Build:</C.HW_DockLabel>
        <C.HW_DockValue>{ACTIVE_BUILD.build}</C.HW_DockValue>
        <Icon name="CircleCheck" size={15} color={accentFor('success')} />
      </C.HW_DockBuild>
      <C.HW_DockDivider />
      <C.HW_DockGroup>
        <Icon name="CircleCheck" size={12} color={accentFor('success')} />
        <C.HW_DockValue>No Errors</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockGroup>
        <Icon name="TriangleAlert" size={12} color={accentFor('warning')} />
        <C.HW_DockValue>2 Warnings</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockDivider />
      <C.HW_DockGroup>
        <C.HW_DockLabel>GO TO POSITION</C.HW_DockLabel>
        <C.HW_DockCoord>X {state.cursor.x}</C.HW_DockCoord>
        <C.HW_DockCoord>Y {state.cursor.y}</C.HW_DockCoord>
        <C.HW_DockCoord>Z {state.cursor.z}</C.HW_DockCoord>
      </C.HW_DockGroup>
      <C.HW_DockGroup>
        <C.HW_DockLabel>GRID</C.HW_DockLabel>
        <C.HW_DockValue>0.25m</C.HW_DockValue>
        <C.HW_DockLabel>ANGLE</C.HW_DockLabel>
        <C.HW_DockValue>45 deg</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockDivider />
      <C.HW_DockBuild onPress={onEventbus}>
        <Icon name="Workflow" size={12} color={accentFor(state.eventbusPopoverOpen ? 'primary' : 'textSecondary')} />
        <C.HW_DockLabel>EVENTBUS</C.HW_DockLabel>
        <C.HW_DockValue>{state.history.length} events</C.HW_DockValue>
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
        <C.HW_DockValue>placement parity {telemetry.parity}</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockDivider />
      <C.HW_DockGroup>
        <C.HW_DockLabel>FPS:</C.HW_DockLabel>
        <C.HW_DockCoord>{fps > 0 ? Math.round(fps) : '—'}</C.HW_DockCoord>
        <C.HW_DockLabel>FRAME</C.HW_DockLabel>
        <C.HW_DockValue>{frameMs > 0 ? formatMs(frameMs) : '—'}</C.HW_DockValue>
        <C.HW_DockLabel>GPU</C.HW_DockLabel>
        <C.HW_DockValue>{gpuMs > 0 ? formatMs(gpuMs) : '—'}</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockDivider />
      <C.HW_DockGroup>
        <Icon name="GitMerge" size={12} color={accentFor('primary')} />
        <C.HW_DockValue>{BUILD_NOTES.length} build notes</C.HW_DockValue>
        <C.HW_DockLabel>{reversible} reversible</C.HW_DockLabel>
      </C.HW_DockGroup>
      <C.HW_Spacer />
      <C.HW_DockGroup>
        <Icon name="CircleCheck" size={13} color={accentFor('success')} />
        <C.HW_DockValue>Up to date</C.HW_DockValue>
        <C.HW_DockLabel>12.4 GB / 31.9 GB</C.HW_DockLabel>
      </C.HW_DockGroup>
    </C.HW_BuildDock>
  );
}
