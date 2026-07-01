import { useState, useEffect } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { since, head, onEvent, describeEvent, type EditorEvent } from '../../../runtime/editorbus';
import type { EditorState } from '../data/types';
// Side-effect import: registers the 'editor.edit' type so describeEvent() can label events
// read back off the bus even if this popover renders before AppFrame's first dispatch.
import '../data/editorEvents';

// Eventbus Review — a window onto the authoring event stream. Prefers the real bus (the
// editorbus door, host-backed once built in), but the bus starts EMPTY: it only fills from
// edits dispatched after boarding, and the in-process fallback log resets on a hot reload. So
// when the bus has nothing, we show the session's local edit log instead — the review always
// reflects your edits rather than a blank void, and upgrades to the real durable stream the
// moment events flow (req_2424, req_2458).
const TAIL = 60; // most-recent events to show

type Row = { key: string; label: string; meta: string; tag: string };

export default function EventBusPopover({ state, onClose }: { state: EditorState; onClose: () => void }) {
  // Re-read whenever a confirmed event lands (live tail), not only on state change.
  const [, tick] = useState(0);
  useEffect(() => onEvent(() => tick((n) => n + 1)), []);

  const total = head();
  const busEvents: EditorEvent[] = since(Math.max(0, total - TAIL)).reverse(); // newest first
  const onBus = busEvents.length > 0;
  const rows: Row[] = onBus
    ? busEvents.map((e) => ({
        key: `#${e.seq}`,
        label: describeEvent(e),
        meta: (e.payload as { meta?: string } | undefined)?.meta ?? '',
        tag: e.origin,
      }))
    : state.history.map((h) => ({
        key: h.verb.toUpperCase(),
        label: h.target,
        meta: h.meta,
        tag: h.undoable ? 'undoable' : 'checkpoint',
      }));
  const count = onBus ? total : state.history.length;
  const undoable = state.history.filter((event) => event.undoable).length;

  return (
    <C.HW_DockPopover>
      <C.HW_DockPopoverHead>
        <Icon name="Workflow" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>Eventbus Review</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>{count} events</C.HW_PillTextOn></C.HW_PillOn>
        <C.HW_Pill><C.HW_PillText>{undoable} undoable</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill><C.HW_PillText>{state.redo.length} redo</C.HW_PillText></C.HW_Pill>
        <C.HW_Spacer />
        <C.HW_Pill onPress={onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
      </C.HW_DockPopoverHead>
      <C.HW_DockHistoryRows>
        {rows.map((row, i) => (
          <C.HW_DockHistoryRow key={`${row.key}:${i}`}>
            <C.HW_KeyText>{row.key}</C.HW_KeyText>
            <C.HW_FormValue>{row.label}</C.HW_FormValue>
            <C.HW_HistoryMeta>{row.meta}</C.HW_HistoryMeta>
            <C.HW_Spacer />
            <C.HW_DockLabel>{row.tag}</C.HW_DockLabel>
          </C.HW_DockHistoryRow>
        ))}
      </C.HW_DockHistoryRows>
    </C.HW_DockPopover>
  );
}
