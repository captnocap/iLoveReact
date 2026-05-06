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

const CHROME_ROWS = 6; // title 2 + tabs 1 + footer 1 + paneY-padding 2

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

function trim(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function LogsPane() {
  const events = useEventStream(500);
  const [scrollY, setScrollY] = useState(0);
  const [stickToBottom, setStickToBottom] = useState(true);
  const lastSeenCount = useRef(0);

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
    if (k === '\x1b[A' || k === 'k') { setStickToBottom(false); setScrollY(y => Math.max(0, y - 1)); }
    else if (k === '\x1b[B' || k === 'j') { setStickToBottom(false); setScrollY(y => y + 1); }
    else if (k === '\x1b[5~') { setStickToBottom(false); setScrollY(y => Math.max(0, y - viewportH)); }
    else if (k === '\x1b[6~' || k === ' ') { setStickToBottom(false); setScrollY(y => y + viewportH); }
    else if (k === 'g' || k === '\x1b[H') { setStickToBottom(false); setScrollY(0); }
    else if (k === 'G' || k === '\x1b[F') { setStickToBottom(true); }
  }), [viewportH]);

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

  const maxScroll = Math.max(0, events.length - viewportH);
  const clamped = Math.min(scrollY, maxScroll);
  const slice = events.slice(clamped, clamped + viewportH);
  const above = clamped;
  const below = Math.max(0, events.length - clamped - viewportH);

  return (
    <box flexDirection="column" height={viewportH + 1}>
      <Header />
      {slice.slice(0, viewportH - 1).map(ev => <Row key={ev.id} ev={ev} />)}
      <box flexDirection="row" gap={2}>
        <text fg="#64748b">
          ─── {events.length} events
          {above > 0 ? `  ↑ ${above}` : ''}
          {below > 0 ? `  ↓ ${below}` : ''}
          {stickToBottom ? '  · live' : '  · paused'}
          {`  ·  k/j ↑↓ · PgUp/PgDn · G live`}
        </text>
      </box>
    </box>
  );
}

function Header() {
  return (
    <box flexDirection="row" gap={1}>
      <box width={12}><text fg="#475569" bold>time</text></box>
      <box width={5}><text fg="#475569" bold>imp</text></box>
      <box width={22}><text fg="#475569" bold>event</text></box>
      <box width={28}><text fg="#475569" bold>source</text></box>
      <text fg="#475569" bold>message / payload</text>
    </box>
  );
}

function Row({ ev }: { ev: Event }) {
  const c = impColor(ev.imp);
  const payload = fmtPayload(ev);
  return (
    <box flexDirection="row" gap={1}>
      <box width={12}><text fg="#64748b">{fmtTime(ev.ts)}</text></box>
      <box width={5}><text fg={c}>{ev.imp.toFixed(2)}</text></box>
      <box width={22}><text fg={c}>{trim(ev.type, 22)}</text></box>
      <box width={28}><text fg="#94a3b8">{trim(ev.src, 28)}</text></box>
      {payload ? <text fg="#cbd5e1">{trim(payload, 80)}</text> : null}
    </box>
  );
}
