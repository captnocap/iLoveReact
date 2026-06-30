import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { editTelemetry, formatMs } from '../data/telemetry';
import type { MockState } from '../data/types';

export default function EventBusPopover({ state, onClose }: { state: MockState; onClose: () => void }) {
  const telemetry = editTelemetry(state.history);
  const latest = telemetry.samples[0];
  const undoable = state.history.filter((event) => event.undoable).length;
  return (
    <C.HW_DockPopover>
      <C.HW_DockPopoverHead>
        <Icon name="Workflow" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>Eventbus Review</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>{state.history.length} in-memory events</C.HW_PillTextOn></C.HW_PillOn>
        <C.HW_Pill><C.HW_PillText>{undoable} undoable</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill><C.HW_PillText>{state.redo.length} redo</C.HW_PillText></C.HW_Pill>
        <C.HW_Spacer />
        <C.HW_Pill onPress={onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
      </C.HW_DockPopoverHead>
      <C.HW_DockPerfGrid>
        <C.HW_PerfTile>
          <C.HW_PerfValue>{formatMs(telemetry.avg)}</C.HW_PerfValue>
          <C.HW_PerfLabel>avg time / edit</C.HW_PerfLabel>
        </C.HW_PerfTile>
        <C.HW_PerfTile>
          <C.HW_PerfValue>{formatMs(telemetry.p95)}</C.HW_PerfValue>
          <C.HW_PerfLabel>p95 edit cost</C.HW_PerfLabel>
        </C.HW_PerfTile>
        <C.HW_PerfTile>
          <C.HW_PerfValue>+{formatMs(telemetry.delta)}</C.HW_PerfValue>
          <C.HW_PerfLabel>rich map delta</C.HW_PerfLabel>
        </C.HW_PerfTile>
        <C.HW_PerfTile>
          <C.HW_PerfValue>{latest ? formatMs(latest.richMs) : '0.0ms'}</C.HW_PerfValue>
          <C.HW_PerfLabel>latest event</C.HW_PerfLabel>
        </C.HW_PerfTile>
      </C.HW_DockPerfGrid>
      <C.HW_DockTrace>
        <C.HW_GroupTitle>
          <Icon name="Activity" size={12} color={accentFor('primary')} />
          <C.HW_GroupText>AUTHORING COST TRACE</C.HW_GroupText>
          <C.HW_Spacer />
          <C.HW_StatusText>target: empty map placement ~= fully authored rich map placement</C.HW_StatusText>
        </C.HW_GroupTitle>
        <C.HW_Sparkline>
          {telemetry.samples.map((event) => (
            <C.HW_SparkCell key={event.id} style={{ height: Math.max(8, Math.min(38, Math.floor(event.richMs * 1.8))), backgroundColor: event.richMs - event.emptyMs <= 1 ? accentFor('primary') : accentFor('warning') }} />
          ))}
        </C.HW_Sparkline>
      </C.HW_DockTrace>
      <C.HW_EventSummary>
        <C.HW_DockGroup>
          <Icon name="CircleCheck" size={12} color={accentFor('success')} />
          <C.HW_DockValue>autosave ready</C.HW_DockValue>
        </C.HW_DockGroup>
        <C.HW_DockGroup>
          <Icon name="Radio" size={12} color={accentFor('primary')} />
          <C.HW_DockValue>session local</C.HW_DockValue>
        </C.HW_DockGroup>
        <C.HW_DockGroup>
          <Icon name="Users" size={12} color={accentFor('textDim')} />
          <C.HW_DockValue>invite idle</C.HW_DockValue>
        </C.HW_DockGroup>
        <C.HW_Spacer />
        <C.HW_StatusText>review surface only - editor canvas keeps its height</C.HW_StatusText>
      </C.HW_EventSummary>
      <C.HW_DockHistoryRows>
        {state.history.map((event) => (
          <C.HW_DockHistoryRow key={event.id}>
            <C.HW_KeyText>{event.verb.toUpperCase()}</C.HW_KeyText>
            <C.HW_FormValue>{event.target}</C.HW_FormValue>
            <C.HW_HistoryMeta>{event.meta}</C.HW_HistoryMeta>
            <C.HW_Spacer />
            <C.HW_DockLabel>empty</C.HW_DockLabel>
            <C.HW_DockValue>{formatMs(event.emptyMs ?? 0)}</C.HW_DockValue>
            <C.HW_DockLabel>rich</C.HW_DockLabel>
            <C.HW_DockValue>{formatMs(event.richMs ?? 0)}</C.HW_DockValue>
            <C.HW_DockLabel>{event.undoable ? 'undoable' : 'checkpoint'}</C.HW_DockLabel>
          </C.HW_DockHistoryRow>
        ))}
      </C.HW_DockHistoryRows>
    </C.HW_DockPopover>
  );
}
