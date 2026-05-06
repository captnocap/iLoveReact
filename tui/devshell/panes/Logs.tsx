// Logs pane — tails the dev host's event ring (latest 500) and renders
// one row per event. Newest at bottom. Auto-scrolls to bottom while at
// the bottom; pinning to a row stops auto-scroll until you press G.
//
// No SQL on the host side — EVENTS IPC reads directly from the
// in-memory ring. Polling at 1Hz so a busy session doesn't add
// pressure.

import { createElement, useState, useEffect, useRef } from 'react';
import { subscribeKey } from '../../host';
import { useEventStream, Event } from '../services/EventStream';
import { useLogLevel } from '../services/LogLevel';
import { claimInput, releaseInput, setCopyOverride } from '../services/InputClaim';

const CHROME_ROWS = 6; // title 2 + tabs 1 + footer 1 + paneY-padding 2

// Render each row as colored segments so we can drop characters from the
// left when scrolling horizontally without losing per-column color.
type Seg = { text: string; fg: string; bold?: boolean };

function padRight(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

function sliceSegs(segs: Seg[], from: number): Seg[] {
  let drop = from;
  const out: Seg[] = [];
  for (const s of segs) {
    if (drop >= s.text.length) { drop -= s.text.length; continue; }
    out.push({ ...s, text: s.text.slice(drop) });
    drop = 0;
  }
  return out;
}

function impColor(imp: number): string {
  if (imp >= 0.85) return '#f87171';   // error
  if (imp >= 0.70) return '#fbbf24';   // warn
  if (imp >= 0.50) return '#cbd5e1';   // info / default
  return '#94a3b8';                    // debug / trace
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

// log.* events have payload {msg, scope, level} — surface the msg
// directly so the row reads naturally. For other event types, render
// the JSON payload unmolested.
function fmtPayload(ev: Event): string {
  const p = ev.payload;
  if (p === null || p === undefined) return '';
  if (typeof p !== 'object') return String(p);
  if (ev.type.startsWith('log.') && typeof p.msg === 'string') return p.msg;
  try {
    const s = JSON.stringify(p);
    return s === '{}' ? '' : s;
  } catch { return ''; }
}

// Format one event as a multi-line plain-text record for copy-paste.
// No truncation, no wrapping — payload is rendered as pretty-printed
// JSON so consumers can paste into a JSON-aware tool.
function formatEventFull(ev: Event): string {
  const lines: string[] = [];
  lines.push(`time:   ${fmtTime(ev.ts)}`);
  lines.push(`imp:    ${ev.imp.toFixed(3)}`);
  lines.push(`event:  ${ev.type}`);
  lines.push(`source: ${ev.src}`);
  lines.push('');
  lines.push('payload:');
  let body = '';
  if (ev.type.startsWith('log.') && typeof ev.payload?.msg === 'string') {
    body = ev.payload.msg;
  } else if (ev.payload === undefined || ev.payload === null) {
    body = '';
  } else if (typeof ev.payload === 'object') {
    try { body = JSON.stringify(ev.payload, null, 2); } catch { body = String(ev.payload); }
  } else {
    body = String(ev.payload);
  }
  for (const line of body.split('\n')) lines.push('  ' + line);
  return lines.join('\n');
}

// Substring filter. Empty = match everything. `!foo` excludes any event
// whose haystack includes "foo". Otherwise include only events whose
// haystack includes the term. Case-insensitive.
function matchesFilter(ev: Event, filter: string): boolean {
  if (!filter) return true;
  const exclude = filter.startsWith('!');
  const term = (exclude ? filter.slice(1) : filter).toLowerCase();
  if (!term) return true;
  let payloadStr = '';
  try { payloadStr = JSON.stringify(ev.payload || ''); } catch {}
  const hay = (ev.type + ' ' + ev.src + ' ' + payloadStr).toLowerCase();
  const hit = hay.includes(term);
  return exclude ? !hit : hit;
}

export function LogsPane() {
  const allEvents = useEventStream(500);
  const log = useLogLevel();
  // Display-side filter — host filter only gates what's stored going
  // forward, so old events from a previous lower threshold linger in
  // the ring. Re-apply the current threshold here so changing level
  // clears them from view immediately.
  const threshold = log.value ?? 0;
  const [filter, setFilter] = useState('');
  const [editingFilter, setEditingFilter] = useState(false);
  const events = allEvents.filter(e => e.imp >= threshold && matchesFilter(e, filter));
  const [scrollY, setScrollY] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  const [stickToBottom, setStickToBottom] = useState(true);
  // Detail mode — when non-null, the pane replaces the row list with a
  // pretty-printed view of one event (payload word-wrapped to terminal
  // width). Enter opens it on the most recent event; n/p step.
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  const lastSeenCount = useRef(0);
  // Refs that the keypress closure reads — lets the closure see live
  // values without resubscribing on every event.
  const eventsLenRef = useRef(0);
  const viewportHRef = useRef(0);
  const maxRowWidthRef = useRef(0);
  const eventsRef = useRef<Event[]>([]);
  eventsRef.current = events;

  // Release the input claim if the pane unmounts mid-edit.
  useEffect(() => () => { releaseInput(); setCopyOverride(null); }, []);

  // Install a copy override while in detail view — y will then yank
  // the focused event's full unwrapped data instead of the screen.
  useEffect(() => {
    if (detailIdx === null) { setCopyOverride(null); return; }
    setCopyOverride(() => {
      const evs = eventsRef.current;
      const idx = Math.min(detailIdx, evs.length - 1);
      return idx >= 0 ? formatEventFull(evs[idx]) : '';
    });
    return () => setCopyOverride(null);
  }, [detailIdx]);

  const termRows = (typeof process !== 'undefined' && process.stdout?.rows) || 24;
  const viewportH = Math.max(1, termRows - CHROME_ROWS - 1);

  // Auto-scroll: while sticky, jump scrollY to the bottom whenever new
  // events arrive. Once the user scrolls up, stickToBottom = false until
  // they hit G or scroll back to the bottom.
  useEffect(() => {
    if (!stickToBottom) return;
    const max = Math.max(0, events.length - viewportH);
    setScrollY(max);
    lastSeenCount.current = events.length;
  }, [events.length, viewportH, stickToBottom]);

  useEffect(() => subscribeKey(k => {
    if (editingFilter) {
      // Modal text input. Shell skips its global handlers because
      // claimInput() was called when we entered the editor.
      if (k === '\x1b' /* ESC */) { setFilter(''); setEditingFilter(false); releaseInput(); }
      else if (k === '\r' || k === '\n') { setEditingFilter(false); releaseInput(); }
      else if (k === '\x7f' || k === '\b') setFilter(f => f.slice(0, -1));
      else if (k.length === 1 && k >= ' ' && k !== '\x1b') setFilter(f => f + k);
      return;
    }
    // Detail mode — ESC closes, n/p step within the events list.
    if (detailIdx !== null) {
      if (k === '\x1b') { setDetailIdx(null); return; }
      if (k === 'n' || k === 'j' || k === '\x1b[B') {
        setDetailIdx(i => (i === null) ? null : Math.min(eventsLenRef.current - 1, i + 1));
        return;
      }
      if (k === 'p' || k === 'k' || k === '\x1b[A') {
        setDetailIdx(i => (i === null) ? null : Math.max(0, i - 1));
        return;
      }
      // Fall through — other keys still work in detail mode (l/y/etc.)
    } else if (k === '\r' || k === '\n') {
      // Enter opens detail on the bottom-most visible event.
      const events = eventsRef.current;
      if (events.length > 0) setDetailIdx(events.length - 1);
      return;
    }
    if (k === '/') { setEditingFilter(true); claimInput(); return; }
    const maxScrollY = Math.max(0, eventsLenRef.current - viewportHRef.current);
    const maxScrollX = Math.max(0, maxRowWidthRef.current - 16);
    if (k === '\x1b[A' || k === 'k') { setStickToBottom(false); setScrollY(y => Math.max(0, y - 1)); }
    else if (k === '\x1b[B' || k === 'j') {
      // Auto-resume live tail when scrolling down past the bottom.
      setScrollY(y => {
        const next = Math.min(y + 1, maxScrollY);
        if (next >= maxScrollY) setStickToBottom(true);
        return next;
      });
    }
    else if (k === '\x1b[D' || k === 'h') setScrollX(x => Math.max(0, x - 8));
    else if (k === '\x1b[C') setScrollX(x => Math.min(maxScrollX, x + 8));
    else if (k === '\x1b[5~') { setStickToBottom(false); setScrollY(y => Math.max(0, y - viewportHRef.current)); }
    else if (k === '\x1b[6~' || k === ' ') {
      setScrollY(y => {
        const next = Math.min(y + viewportHRef.current, maxScrollY);
        if (next >= maxScrollY) setStickToBottom(true);
        return next;
      });
    }
    else if (k === 'g' || k === '\x1b[H') { setStickToBottom(false); setScrollY(0); setScrollX(0); }
    else if (k === 'G' || k === '\x1b[F') { setStickToBottom(true); setScrollX(0); }
  }), [editingFilter, detailIdx]);

  if (events.length === 0) {
    return (
      <box flexDirection="column">
        <text fg="#fbbf24" bold>Logs</text>
        <text fg="#94a3b8">no events yet — waiting on dev host</text>
        <text fg="#64748b"> </text>
        <text fg="#64748b">If the host is up but logs stay empty, the threshold</text>
        <text fg="#64748b">may be filtering everything out. Press `l` to lower it.</text>
      </box>
    );
  }

  if (detailIdx !== null && detailIdx < events.length) {
    const termCols = (typeof process !== 'undefined' && process.stdout?.columns) || 80;
    return (
      <DetailView
        ev={events[detailIdx]}
        idx={detailIdx}
        total={events.length}
        cols={termCols - 4}
      />
    );
  }

  const maxScroll = Math.max(0, events.length - viewportH);
  const clamped = Math.min(scrollY, maxScroll);
  const slice = events.slice(clamped, clamped + viewportH);
  const above = clamped;
  const below = Math.max(0, events.length - clamped - viewportH);

  // Bound horizontal scroll to the longest visible row's content width
  // so → can't run off into infinity. ROW_CHROME = sum of fixed col
  // widths + their separators (74), payload is variable.
  const ROW_CHROME = COL_TIME + SEP.length + COL_IMP + SEP.length + COL_TYPE + SEP.length + COL_SRC + SEP.length;
  let maxPayload = 0;
  for (const ev of slice) {
    const p = fmtPayload(ev);
    if (p.length > maxPayload) maxPayload = p.length;
  }
  const maxRowWidth = ROW_CHROME + maxPayload;
  const maxScrollX = Math.max(0, maxRowWidth - 16);
  const clampedX = Math.min(scrollX, maxScrollX);

  // Stash live values for the keypress closure (which captures only on
  // mount due to fixed deps).
  eventsLenRef.current = events.length;
  viewportHRef.current = viewportH;
  maxRowWidthRef.current = maxRowWidth;

  const showFilterBar = editingFilter || filter.length > 0;
  return (
    <box flexDirection="column" height={viewportH + 1}>
      {showFilterBar ? <FilterBar filter={filter} editing={editingFilter} /> : null}
      <Header scrollX={clampedX} />
      {slice.slice(0, viewportH - (showFilterBar ? 2 : 1)).map(ev =>
        <Row key={ev.id} ev={ev} scrollX={clampedX} />
      )}
      <box flexDirection="row" gap={2}>
        <text fg="#64748b">
          ─── {events.length}/{allEvents.length} events
          {above > 0 ? `  ↑ ${above}` : ''}
          {below > 0 ? `  ↓ ${below}` : ''}
        </text>
        {stickToBottom
          ? <text fg="#34d399">  · live</text>
          : <text fg="#f87171" bold>  · PAUSED (G to resume)</text>}
        {clampedX > 0 ? <text fg="#64748b">{`  ·  →${clampedX}`}</text> : null}
        <text fg="#64748b">{`  ·  / filter · k/j ↑↓ · h/→ ←→ · G live`}</text>
      </box>
    </box>
  );
}

function DetailView({ ev, idx, total, cols }: { ev: Event; idx: number; total: number; cols: number }) {
  const c = impColor(ev.imp);
  // Pretty-print payload. log.* events get the .msg field; everything
  // else gets full JSON with 2-space indent.
  let body = '';
  if (ev.type.startsWith('log.') && typeof ev.payload?.msg === 'string') {
    body = ev.payload.msg;
  } else if (ev.payload === undefined || ev.payload === null) {
    body = '';
  } else if (typeof ev.payload === 'object') {
    try { body = JSON.stringify(ev.payload, null, 2); } catch { body = String(ev.payload); }
  } else {
    body = String(ev.payload);
  }
  const lines: string[] = [];
  const width = Math.max(20, cols);
  // Honour explicit \n breaks, then wrap each segment to `width`.
  for (const seg of body.split('\n')) {
    if (seg.length === 0) { lines.push(''); continue; }
    for (let i = 0; i < seg.length; i += width) {
      lines.push(seg.slice(i, i + width));
    }
  }
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={2}>
        <text fg="#fbbf24" bold>{`detail ${idx + 1}/${total}`}</text>
        <text fg="#64748b">— ESC close · n/p next/prev</text>
      </box>
      <text> </text>
      <box flexDirection="row" gap={2}>
        <box width={10}><text fg="#94a3b8">time</text></box>
        <text fg="#e5e7eb">{fmtTime(ev.ts)}</text>
      </box>
      <box flexDirection="row" gap={2}>
        <box width={10}><text fg="#94a3b8">imp</text></box>
        <text fg={c}>{ev.imp.toFixed(3)}</text>
      </box>
      <box flexDirection="row" gap={2}>
        <box width={10}><text fg="#94a3b8">event</text></box>
        <text fg={c} bold>{ev.type}</text>
      </box>
      <box flexDirection="row" gap={2}>
        <box width={10}><text fg="#94a3b8">source</text></box>
        <text fg="#cbd5e1">{ev.src}</text>
      </box>
      <text> </text>
      <text fg="#94a3b8" bold>payload:</text>
      {lines.length === 0
        ? <text fg="#64748b">  (empty)</text>
        : lines.map((ln, i) => <text key={i} fg="#e5e7eb">  {ln}</text>)}
    </box>
  );
}

function FilterBar({ filter, editing }: { filter: string; editing: boolean }) {
  return (
    <box flexDirection="row" gap={1}>
      <text fg={editing ? '#fbbf24' : '#94a3b8'} bold>filter:</text>
      <text fg="#e5e7eb">{filter}{editing ? '_' : ''}</text>
      {!editing && filter ? <text fg="#64748b">  (/ to edit · ESC to clear)</text> : null}
      {editing ? <text fg="#64748b">  (Enter to apply · ESC to clear · ! prefix to exclude)</text> : null}
    </box>
  );
}

// Header / Row both build a left-to-right segment list and then drop
// `scrollX` characters off the front. That's how horizontal scroll
// works without ANSI cursor positioning per cell — the host's
// flex layout just sees a shorter row.
const SEP = '  ';
const COL_TIME = 12;
const COL_IMP  = 4;
const COL_TYPE = 22;
const COL_SRC  = 28;

function Header({ scrollX }: { scrollX: number }) {
  const segs: Seg[] = [
    { text: padRight('time', COL_TIME), fg: '#475569', bold: true },
    { text: SEP, fg: '#475569' },
    { text: padRight('imp', COL_IMP), fg: '#475569', bold: true },
    { text: SEP, fg: '#475569' },
    { text: padRight('event', COL_TYPE), fg: '#475569', bold: true },
    { text: SEP, fg: '#475569' },
    { text: padRight('source', COL_SRC), fg: '#475569', bold: true },
    { text: SEP, fg: '#475569' },
    { text: 'message / payload', fg: '#475569', bold: true },
  ];
  return <SegRow segs={sliceSegs(segs, scrollX)} />;
}

function Row({ ev, scrollX }: { ev: Event; scrollX: number }) {
  const c = impColor(ev.imp);
  const payload = fmtPayload(ev);
  const segs: Seg[] = [
    { text: padRight(fmtTime(ev.ts), COL_TIME), fg: '#64748b' },
    { text: SEP, fg: '#475569' },
    { text: padRight(ev.imp.toFixed(2), COL_IMP), fg: c },
    { text: SEP, fg: '#475569' },
    { text: padRight(ev.type, COL_TYPE), fg: c },
    { text: SEP, fg: '#475569' },
    { text: padRight(ev.src, COL_SRC), fg: '#94a3b8' },
    { text: SEP, fg: '#475569' },
    { text: payload, fg: '#cbd5e1' },
  ];
  return <SegRow segs={sliceSegs(segs, scrollX)} />;
}

function SegRow({ segs }: { segs: Seg[] }) {
  return (
    <box flexDirection="row">
      {segs.map((s, i) => (
        <text key={i} fg={s.fg} bold={s.bold}>{s.text}</text>
      ))}
    </box>
  );
}
