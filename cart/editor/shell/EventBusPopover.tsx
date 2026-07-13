import { useState, useEffect } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { since, head, onEvent, describeEvent, type EditorEvent } from '../../../runtime/editorbus';
import { undoDepths } from '../data/commands';
import { formatMs } from '../data/telemetry';
import type { EditorState } from '../data/types';
import type { MapPaintPayload, PiecePlacementPayload } from '../data/editorEvents';
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

type Row = { key: string; title: string; detail: string; time: string; type: string; origin: string };

function clock(ms: number | undefined): string {
  if (!ms) return '--:--:--.---';
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function f(n: number | undefined, digits = 2): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '-';
}

function isPiecePlacement(payload: unknown): payload is PiecePlacementPayload {
  const p = payload as Partial<PiecePlacementPayload> | null;
  return !!p && typeof p.pieceId === 'string' && Array.isArray(p.positions) && typeof p.inputToAppliedMs === 'number';
}

function isMapPaint(payload: unknown): payload is MapPaintPayload {
  const p = payload as Partial<MapPaintPayload> | null;
  return !!p && typeof p.action === 'string' && typeof p.channel === 'string' && typeof p.durationMs === 'number';
}

function placementDetail(p: PiecePlacementPayload): string {
  const first = p.positions[0];
  const pos = first ? `pos=(${f(first.x)},${f(first.y)},${f(first.z)}) floor=${first.floor} yaw=${Math.round(first.yawDegrees)}` : 'pos=-';
  const slots = p.slots.length ? `slots=${p.slots.map((s) => `${s.role}:${s.material}`).join(',')}` : `material=${p.material}`;
  return [
    `piece=${p.pieceId}`,
    `kind=${p.kind}`,
    slots,
    pos,
    `count=${p.count}`,
    p.replaced ? `replaced=${p.replaced}` : '',
    `input=${clock(p.inputAtMs)}`,
    `apply=${formatMs(p.applyMs)}`,
    `applied=+${formatMs(p.inputToAppliedMs)}`,
  ].filter(Boolean).join('  ');
}

function mapPaintDetail(p: MapPaintPayload): string {
  const from = p.start ? `from=(${f(p.start.x)},${f(p.start.z)})` : '';
  const to = p.end ? `to=(${f(p.end.x)},${f(p.end.z)})` : '';
  const chunk = p.chunk ? `chunk=(${p.chunk.cx},${p.chunk.cz})` : '';
  const target = [
    p.tileLabel ? `tile=${p.tileLabel}` : '',
    p.material ? `material=${p.material}` : '',
    p.floraLabel ? `flora=${p.floraLabel}` : '',
    p.zoneLabel ? `zone=${p.zoneLabel}` : '',
    p.roadId ? `road=#${p.roadId}` : '',
    typeof p.bindingCount === 'number' ? `bindings=${p.bindingCount}` : '',
  ].filter(Boolean).join('  ');
  return [
    `channel=${p.channel}`,
    `mode=${p.mode}`,
    p.terrainTool ? `tool=${p.terrainTool}` : '',
    p.shape ? `shape=${p.shape}` : '',
    typeof p.radiusM === 'number' ? `radius=${f(p.radiusM, 1)}m` : '',
    typeof p.heightM === 'number' && p.channel !== 'tile' && p.channel !== 'flora' && p.channel !== 'zone' ? `height=${f(p.heightM, 1)}m` : '',
    target,
    from,
    to,
    chunk,
    typeof p.samples === 'number' ? `samples=${p.samples}` : '',
    typeof p.stamps === 'number' ? `stamps=${p.stamps}` : '',
    typeof p.touchedChunks === 'number' ? `chunks=${p.touchedChunks}` : '',
    p.waterDry ? 'dry' : '',
    `duration=${formatMs(p.durationMs)}`,
    `ready=+${formatMs(p.inputToMaterializedMs)}`,
    p.droppedBefore ? `dropped=${p.droppedBefore}` : '',
    `at=${clock(p.materializedAtMs)}`,
  ].filter(Boolean).join('  ');
}

function commandTrace(e: EditorEvent): string {
  if (!e.commandId) return '';
  return [
    `cmd=${e.commandId}`,
    e.source ? `source=${e.source}` : '',
    e.phase ? `phase=${e.phase}` : '',
    e.actionId ? `action=${e.actionId}` : '',
  ].filter(Boolean).join('  ');
}

function busRow(e: EditorEvent): Row {
  if (e.type === 'piece.place' && isPiecePlacement(e.payload)) {
    const p = e.payload;
    return {
      key: `#${e.seq}`,
      title: p.count === 1 ? `${p.action} ${p.label}` : `${p.action} ${p.count}x ${p.label}`,
      detail: [placementDetail(p), commandTrace(e)].filter(Boolean).join('  '),
      time: clock(e.ts),
      type: e.type,
      origin: e.origin,
    };
  }
  if (e.type === 'map.paint' && isMapPaint(e.payload)) {
    const p = e.payload;
    return {
      key: `#${e.seq}`,
      title: p.label,
      detail: [mapPaintDetail(p), commandTrace(e)].filter(Boolean).join('  '),
      time: clock(e.ts),
      type: e.type,
      origin: e.origin,
    };
  }
  const payload = (e.payload ?? {}) as { meta?: string; editMs?: number; reason?: string };
  const timing = typeof payload.editMs === 'number' ? `apply=${formatMs(payload.editMs)}` : '';
  return {
    key: `#${e.seq}`,
    title: describeEvent(e),
    detail: [payload.meta ?? '', payload.reason ?? '', timing, commandTrace(e)].filter(Boolean).join('  '),
    time: clock(e.ts),
    type: e.type,
    origin: e.origin,
  };
}

export default function EventBusPopover({ state, onClose }: { state: EditorState; onClose: () => void }) {
  // Re-read whenever a confirmed event lands (live tail), not only on state change.
  const [, tick] = useState(0);
  useEffect(() => onEvent(() => tick((n) => n + 1)), []);

  const total = head();
  const busEvents: EditorEvent[] = since(Math.max(0, total - TAIL)).reverse(); // newest first
  const onBus = busEvents.length > 0;
  const rows: Row[] = onBus
    ? busEvents.map(busRow)
    : state.history.map((h) => ({
        key: h.id,
        title: `${h.verb} ${h.target}`,
        detail: [
          h.meta,
          typeof h.emptyMs === 'number' ? `apply=${formatMs(h.emptyMs)}` : '',
          typeof h.richMs === 'number' ? `ready=+${formatMs(h.richMs)}` : '',
        ].filter(Boolean).join('  '),
        time: clock(h.atMs),
        type: h.eventType ?? 'session.history',
        origin: h.undoable ? 'undoable' : 'checkpoint',
      }));
  const count = onBus ? total : state.history.length;
  const depths = undoDepths(state);

  return (
    <C.HW_DockPopover>
      <C.HW_DockPopoverHead>
        <Icon name="Workflow" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>Eventbus Review</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>{count} events</C.HW_PillTextOn></C.HW_PillOn>
        <C.HW_Pill><C.HW_PillText>{depths.undo} {depths.source} undo</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill><C.HW_PillText>{depths.redo} redo</C.HW_PillText></C.HW_Pill>
        <C.HW_Spacer />
        <C.HW_Pill onPress={onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
      </C.HW_DockPopoverHead>
      <C.HW_DockHistoryRows>
        {rows.map((row, i) => (
          <C.HW_EventRow key={`${row.key}:${i}`}>
            <C.HW_EventTop>
              <C.HW_KeyText>{row.key}</C.HW_KeyText>
              <C.HW_EventTitle>{row.title}</C.HW_EventTitle>
              <C.HW_Spacer />
              <C.HW_EventType>{row.type}</C.HW_EventType>
              <C.HW_EventTime>{row.time}</C.HW_EventTime>
              <C.HW_DockLabel>{row.origin}</C.HW_DockLabel>
            </C.HW_EventTop>
            <C.HW_EventDetail>{row.detail}</C.HW_EventDetail>
          </C.HW_EventRow>
        ))}
      </C.HW_DockHistoryRows>
    </C.HW_DockPopover>
  );
}
