import { useState, useEffect } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { since, head, isHostBacked, onEvent, describeEvent, type EditorEvent } from '../../../runtime/editorbus';
import type { EditorState } from '../data/types';
// Side-effect import: registers the 'editor.edit' type so describeEvent() can label
// events read back off the bus even if this popover renders before AppFrame's dispatch.
import '../data/editorEvents';

// Eventbus Review — an honest window onto the REAL authoring bus (the editorbus door,
// host-backed by framework/events/editor_bus.zig when built in). It reads the durable,
// seq-ordered log via since()/head() rather than the local undo array, and says plainly
// whether it's on the host bus or the in-process fallback (req_2422, req_2424).
const TAIL = 60; // most-recent events to show

export default function EventBusPopover({ state, onClose }: { state: EditorState; onClose: () => void }) {
  // Re-read the bus whenever a confirmed event lands (live tail), not only on state change.
  const [, tick] = useState(0);
  useEffect(() => onEvent(() => tick((n) => n + 1)), []);

  const total = head();
  const backed = isHostBacked();
  const events: EditorEvent[] = since(Math.max(0, total - TAIL)).reverse(); // newest first
  const undoable = state.history.filter((event) => event.undoable).length;

  return (
    <C.HW_DockPopover>
      <C.HW_DockPopoverHead>
        <Icon name="Workflow" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>Eventbus Review</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>{total} events</C.HW_PillTextOn></C.HW_PillOn>
        <C.HW_Pill><C.HW_PillText>{undoable} undoable</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill><C.HW_PillText>{state.redo.length} redo</C.HW_PillText></C.HW_Pill>
        <C.HW_Spacer />
        <C.HW_Pill onPress={onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
      </C.HW_DockPopoverHead>
      {/* Honest wiring status — the door tells us which side is live. */}
      <C.HW_EventSummary>
        <C.HW_DockGroup>
          <Icon name="Workflow" size={12} color={accentFor(backed ? 'primary' : 'textDim')} />
          <C.HW_DockValue>{backed ? 'on the editor bus · durable, seq-ordered' : 'local fallback · host bus not built into this binary'}</C.HW_DockValue>
        </C.HW_DockGroup>
      </C.HW_EventSummary>
      <C.HW_DockHistoryRows>
        {events.map((event) => (
          <C.HW_DockHistoryRow key={event.seq}>
            <C.HW_KeyText>#{event.seq}</C.HW_KeyText>
            <C.HW_FormValue>{describeEvent(event)}</C.HW_FormValue>
            <C.HW_HistoryMeta>{(event.payload as { meta?: string } | undefined)?.meta ?? ''}</C.HW_HistoryMeta>
            <C.HW_Spacer />
            <C.HW_DockLabel>{event.origin}</C.HW_DockLabel>
          </C.HW_DockHistoryRow>
        ))}
      </C.HW_DockHistoryRows>
    </C.HW_DockPopover>
  );
}
