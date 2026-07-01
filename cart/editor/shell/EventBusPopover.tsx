import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import type { EditorState } from '../data/types';

// Eventbus Review — an honest look at the in-memory edit stream: what events happened,
// what's undoable/redoable, and the plain fact that the eventbus host isn't wired yet.
//
// It is NOT a performance dashboard. The old perf grid (avg/p95/"rich map delta"/latest)
// and "authoring cost trace" were theater: they measured an empty-vs-rich-placement
// distinction the editor never actually records (emptyMs === richMs === editMs in
// AppFrame), so "rich map delta" was structurally always +0.0ms and the "target: empty
// map placement ~= fully authored rich map placement" line was a design goal leaked into
// the UI. Real frame/gpu telemetry lives in the Performance popover, not here (req_2422).
export default function EventBusPopover({ state, onClose }: { state: EditorState; onClose: () => void }) {
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
      {/* Honest status: the edit log is an in-memory, session-local list — no autosave,
          no multiplayer, no fan-out yet. Those arrive when the eventbus host owns this
          stream. Until then this popover is a straight review of the in-memory events. */}
      <C.HW_EventSummary>
        <C.HW_DockGroup>
          <Icon name="Workflow" size={12} color={accentFor('textDim')} />
          <C.HW_DockValue>eventbus host: not wired</C.HW_DockValue>
        </C.HW_DockGroup>
        <C.HW_DockGroup>
          <Icon name="Cpu" size={12} color={accentFor('textDim')} />
          <C.HW_DockValue>session-local, in-memory</C.HW_DockValue>
        </C.HW_DockGroup>
      </C.HW_EventSummary>
      <C.HW_DockHistoryRows>
        {state.history.map((event) => (
          <C.HW_DockHistoryRow key={event.id}>
            <C.HW_KeyText>{event.verb.toUpperCase()}</C.HW_KeyText>
            <C.HW_FormValue>{event.target}</C.HW_FormValue>
            <C.HW_HistoryMeta>{event.meta}</C.HW_HistoryMeta>
            <C.HW_Spacer />
            <C.HW_DockLabel>{event.undoable ? 'undoable' : 'checkpoint'}</C.HW_DockLabel>
          </C.HW_DockHistoryRow>
        ))}
      </C.HW_DockHistoryRows>
    </C.HW_DockPopover>
  );
}
