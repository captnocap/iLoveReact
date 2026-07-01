import { useState, useEffect } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { since, head, onEvent, describeEvent, type EditorEvent } from '../../../runtime/editorbus';
import type { EditorState } from '../data/types';
// Side-effect import: registers the 'editor.edit' type so describeEvent() can label
// events read back off the bus even if this popover renders before AppFrame's dispatch.
import '../data/editorEvents';

// Eventbus Review — a window onto the authoring event stream. Reads the log via
// since()/head() and shows the events. No "durable / seq-ordered / on the bus" wiring
// narration: the event count proves the bus is live, and whether it's the host log or the
// in-process fallback is internal plumbing that doesn't change the user's work (req_2424).
const TAIL = 60; // most-recent events to show

export default function EventBusPopover({ state, onClose }: { state: EditorState; onClose: () => void }) {
  // Re-read the bus whenever a confirmed event lands (live tail), not only on state change.
  const [, tick] = useState(0);
  useEffect(() => onEvent(() => tick((n) => n + 1)), []);

  const total = head();
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
