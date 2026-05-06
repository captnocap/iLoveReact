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

export function LogsPane() {
  const events = useEventStream(500);
  const [scrollY, setScrollY] = useState(0);
  const [scrollX, setScrollX] = useState(0);
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
    else if (k === '\x1b[D' || k === 'h') setScrollX(x => Math.max(0, x - 8));
    else if (k === '\x1b[C') setScrollX(x => x + 8);
    else if (k === '\x1b[5~') { setStickToBottom(false); setScrollY(y => Math.max(0, y - viewportH)); }
    else if (k === '\x1b[6~' || k === ' ') { setStickToBottom(false); setScrollY(y => y + viewportH); }
    else if (k === 'g' || k === '\x1b[H') { setStickToBottom(false); setScrollY(0); setScrollX(0); }
    else if (k === 'G' || k === '\x1b[F') { setStickToBottom(true); setScrollX(0); }
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
      <Header scrollX={scrollX} />
      {slice.slice(0, viewportH - 1).map(ev => <Row key={ev.id} ev={ev} scrollX={scrollX} />)}
      <box flexDirection="row" gap={2}>
        <text fg="#64748b">
          ─── {events.length} events
          {above > 0 ? `  ↑ ${above}` : ''}
          {below > 0 ? `  ↓ ${below}` : ''}
          {stickToBottom ? '  · live' : '  · paused'}
          {scrollX > 0 ? `  ·  →${scrollX}` : ''}
          {`  ·  k/j ↑↓ · h/→ ←→ · PgUp/PgDn · G live`}
        </text>
      </box>
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
