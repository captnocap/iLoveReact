// Logs pane — accordion table. Each event is one row; press Enter to
// expand the cursor row in place and read the full payload without
// losing the surrounding context. j/k (or arrows) move the cursor;
// stepping past the bottom returns to live tail mode.

import * as React from 'react';
import { Box, Row, Col, Text, Pressable } from '../../../runtime/primitives';
import { subscribeKey } from '../../host';
import { useEventStream, Event } from '../services/EventStream';
import { useLogLevel } from '../services/LogLevel';
import { claimInput, releaseInput, setCopyOverride } from '../services/InputClaim';

const { useState, useEffect, useRef, useMemo } = React;

const CHROME_ROWS = 6;

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
  if (imp >= 0.85) return '#f87171';
  if (imp >= 0.70) return '#fbbf24';
  if (imp >= 0.50) return '#cbd5e1';
  return '#94a3b8';
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

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

function payloadBody(ev: Event): string {
  if (ev.type.startsWith('log.') && typeof ev.payload?.msg === 'string') return ev.payload.msg;
  if (ev.payload === undefined || ev.payload === null) return '';
  if (typeof ev.payload === 'object') {
    try { return JSON.stringify(ev.payload, null, 2); } catch { return String(ev.payload); }
  }
  return String(ev.payload);
}

function formatEventFull(ev: Event): string {
  const lines: string[] = [];
  lines.push(`time:   ${fmtTime(ev.ts)}`);
  lines.push(`imp:    ${ev.imp.toFixed(3)}`);
  lines.push(`event:  ${ev.type}`);
  lines.push(`source: ${ev.src}`);
  lines.push('');
  lines.push('payload:');
  for (const line of payloadBody(ev).split('\n')) lines.push('  ' + line);
  return lines.join('\n');
}

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
  const threshold = log.value ?? 0;
  const [filter, setFilter] = useState('');
  const [editingFilter, setEditingFilter] = useState(false);
  const events = useMemo(
    () => allEvents.filter(e => e.imp >= threshold && matchesFilter(e, filter)),
    [allEvents, threshold, filter],
  );

  // Cursor tracked by event id (stable across ring-buffer eviction).
  // null = follow tail; expansion tracked the same way so it survives
  // cursor moves and new events streaming in.
  const [cursorId, setCursorId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [scrollY, setScrollY] = useState(0);
  const [scrollX, setScrollX] = useState(0);

  const cursorIdx = useMemo(
    () => cursorId === null ? -1 : events.findIndex(e => e.id === cursorId),
    [events, cursorId],
  );
  const stickToBottom = cursorIdx < 0;

  const eventsRef = useRef<Event[]>([]);
  eventsRef.current = events;
  const cursorIdxRef = useRef(cursorIdx);
  cursorIdxRef.current = cursorIdx;
  const expandedIdRef = useRef(expandedId);
  expandedIdRef.current = expandedId;
  const viewportHRef = useRef(0);
  const maxRowWidthRef = useRef(0);

  useEffect(() => () => { releaseInput(); setCopyOverride(null); }, []);

  // Copy buffer: prefer expanded, then cursor, then everything visible.
  useEffect(() => {
    setCopyOverride(() => {
      const evs = eventsRef.current;
      if (expandedId !== null) {
        const e = evs.find(x => x.id === expandedId);
        if (e) return formatEventFull(e);
      }
      if (cursorId !== null) {
        const e = evs.find(x => x.id === cursorId);
        if (e) return formatEventFull(e);
      }
      return evs.map(formatEventFull).join('\n\n---\n\n');
    });
    return () => setCopyOverride(null);
  }, [cursorId, expandedId]);

  const termRows = (typeof process !== 'undefined' && process.stdout?.rows) || 24;
  const termCols = (typeof process !== 'undefined' && process.stdout?.columns) || 80;
  const viewportH = Math.max(1, termRows - CHROME_ROWS - 1);
  viewportHRef.current = viewportH;

  // Tail mode: keep scroll pinned to the latest event.
  useEffect(() => {
    if (!stickToBottom) return;
    const max = Math.max(0, events.length - viewportH);
    setScrollY(max);
  }, [events.length, viewportH, stickToBottom]);

  // Manual mode: keep cursor in viewport when it moves.
  useEffect(() => {
    if (cursorIdx < 0) return;
    if (cursorIdx < scrollY) setScrollY(cursorIdx);
    else if (cursorIdx >= scrollY + viewportH) setScrollY(Math.max(0, cursorIdx - viewportH + 1));
  }, [cursorIdx, scrollY, viewportH]);

  // When a row is expanded, scroll so the cursor row sits near the top
  // and its detail block has room to render below it. Without this,
  // expanding a row at the bottom of a tail-pinned viewport would push
  // the detail off-screen entirely.
  useEffect(() => {
    if (expandedId === null) return;
    if (cursorIdx < 0) return;
    const desired = Math.max(0, cursorIdx - 1);
    if (scrollY > desired) setScrollY(desired);
    else if (scrollY < desired - 1) setScrollY(desired);
    // intentionally not depending on scrollY (avoid feedback loop)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId, cursorIdx]);

  useEffect(() => subscribeKey(k => {
    if (editingFilter) {
      if (k === '\x1b') { setFilter(''); setEditingFilter(false); releaseInput(); }
      else if (k === '\r' || k === '\n') { setEditingFilter(false); releaseInput(); }
      else if (k === '\x7f' || k === '\b') setFilter(f => f.slice(0, -1));
      else if (k.length === 1 && k >= ' ' && k !== '\x1b') setFilter(f => f + k);
      return;
    }
    if (k === '/') { setEditingFilter(true); claimInput(); return; }

    const evs = eventsRef.current;
    const last = evs.length - 1;
    if (last < 0) return;
    const cur = cursorIdxRef.current;
    const vh = viewportHRef.current;
    const setCursorByIdx = (idx: number) => {
      const clamped = Math.max(0, Math.min(last, idx));
      setCursorId(evs[clamped]?.id ?? null);
    };

    // Enter: expand/collapse the cursor row (or the tail row in tail mode).
    if (k === '\r' || k === '\n') {
      const idx = cur < 0 ? last : cur;
      const id = evs[idx]?.id;
      if (id === undefined) return;
      setExpandedId(prev => prev === id ? null : id);
      if (cur < 0) setCursorId(id); // pin cursor when expanding from tail
      return;
    }

    if (k === '\x1b') {
      if (expandedIdRef.current !== null) { setExpandedId(null); return; }
      // Second ESC returns to tail (live).
      setCursorId(null);
      return;
    }

    if (k === '\x1b[A' || k === 'k') {
      if (cur < 0) setCursorByIdx(last); // first up-press from tail selects last
      else setCursorByIdx(cur - 1);
      return;
    }
    if (k === '\x1b[B' || k === 'j') {
      if (cur < 0) return; // already at tail
      if (cur >= last) { setCursorId(null); setExpandedId(null); return; }
      setCursorByIdx(cur + 1);
      return;
    }

    // Horizontal scroll (collapsed table only)
    const maxScrollX = Math.max(0, maxRowWidthRef.current - 16);
    // 'l' is claimed by Shell for log-level cycle, so only arrows scroll horizontally.
    if (k === '\x1b[D') { setScrollX(x => Math.max(0, x - 8)); return; }
    if (k === '\x1b[C') { setScrollX(x => Math.min(maxScrollX, x + 8)); return; }

    if (k === '\x1b[5~') {
      const start = cur < 0 ? last : cur;
      setCursorByIdx(start - vh);
      return;
    }
    if (k === '\x1b[6~' || k === ' ') {
      if (cur < 0) return;
      const next = cur + vh;
      if (next > last) { setCursorId(null); setExpandedId(null); }
      else setCursorByIdx(next);
      return;
    }

    if (k === 'g' || k === '\x1b[H') { setCursorByIdx(0); setScrollX(0); return; }
    if (k === 'G' || k === '\x1b[F') { setCursorId(null); setExpandedId(null); setScrollX(0); return; }
  }), [editingFilter]);

  if (events.length === 0) {
    return (
      <Col>
        <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>Logs</Text>
        <Text style={{ color: '#94a3b8' }}>no events yet — waiting on dev host</Text>
        <Text style={{ color: '#64748b' }}> </Text>
        <Text style={{ color: '#64748b' }}>If the host is up but logs stay empty, the threshold</Text>
        <Text style={{ color: '#64748b' }}>may be filtering everything out. Press `l` to lower it.</Text>
      </Col>
    );
  }

  const showFilterBar = editingFilter || filter.length > 0;
  const headerChromeRows = (showFilterBar ? 2 : 1); // filter? + column header
  const footerRows = 1;
  const targetBodyRows = Math.max(1, viewportH - headerChromeRows - footerRows + 1);

  const maxScroll = Math.max(0, events.length - viewportH);
  const clamped = Math.min(scrollY, maxScroll);

  // Effective cursor for highlighting: in tail mode, pretend cursor is the last event.
  const highlightIdx = cursorIdx < 0 ? events.length - 1 : cursorIdx;

  // Build visual rows starting at `clamped`, stop when target rows filled.
  // Each event is one LogRow + (if expanded) wrapped detail lines.
  // Width budget for wrapped payload text. Account for everything left
  // of the wrapped content: NavRail (16) + Shell body padding (2+2) +
  // detail bar prefix "  │ " (4) + payload indent "  " (2) = 26 cols.
  const detailWidth = Math.max(20, termCols - 26);
  const rendered: React.ReactNode[] = [];
  let used = 0;

  // First, find cheap measurement of payload widths in the visible window
  // (for horizontal-scroll clamp).
  let maxPayload = 0;
  for (let i = clamped; i < events.length && (i - clamped) < viewportH; i++) {
    const p = fmtPayload(events[i]);
    if (p.length > maxPayload) maxPayload = p.length;
  }
  const ROW_CHROME = MARKER_W + COL_TIME + SEP.length + COL_IMP + SEP.length + COL_TYPE + SEP.length + COL_SRC + SEP.length;
  maxRowWidthRef.current = ROW_CHROME + maxPayload;
  const maxScrollX = Math.max(0, maxRowWidthRef.current - 16);
  const clampedX = Math.min(scrollX, maxScrollX);

  const toggleExpand = (id: number) => {
    setCursorId(id);
    setExpandedId(prev => prev === id ? null : id);
  };

  for (let i = clamped; i < events.length && used < targetBodyRows; i++) {
    const ev = events[i];
    const isCursor = i === highlightIdx;
    const isExpanded = expandedId === ev.id;
    const evId = ev.id;
    rendered.push(
      <Pressable key={`r-${ev.id}`} onPress={() => toggleExpand(evId)}>
        <LogRow ev={ev} scrollX={clampedX} cursor={isCursor} expanded={isExpanded} />
      </Pressable>,
    );
    used++;
    if (isExpanded) {
      const lines = renderInlineDetail(ev, detailWidth);
      for (const ln of lines) {
        if (used >= targetBodyRows) break;
        rendered.push(ln);
        used++;
      }
    }
  }

  const above = clamped;
  const below = Math.max(0, events.length - clamped - viewportH);

  return (
    <Col style={{ height: viewportH + 1 }}>
      {showFilterBar ? <FilterBar filter={filter} editing={editingFilter} /> : null}
      <Header scrollX={clampedX} />
      {rendered}
      <Row style={{ gap: 2 }}>
        <Text style={{ color: '#64748b' }}>
          ─── {events.length}/{allEvents.length} events
          {above > 0 ? `  ↑ ${above}` : ''}
          {below > 0 ? `  ↓ ${below}` : ''}
        </Text>
        {stickToBottom
          ? <Text style={{ color: '#34d399' }}>  · live</Text>
          : <Text style={{ color: '#f87171', fontWeight: 'bold' }}>  · PAUSED (G to resume)</Text>}
        {clampedX > 0 ? <Text style={{ color: '#64748b' }}>{`  ·  →${clampedX}`}</Text> : null}
        <Text style={{ color: '#64748b' }}>{`  · click row or Enter to expand · k/j ↑↓ · ESC collapse · G live · / filter`}</Text>
      </Row>
    </Col>
  );
}

function renderInlineDetail(ev: Event, width: number): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const c = impColor(ev.imp);
  const meta: Array<[string, string, string]> = [
    ['time',   fmtTime(ev.ts), '#cbd5e1'],
    ['source', ev.src,         '#cbd5e1'],
    ['imp',    ev.imp.toFixed(3), c],
    ['event',  ev.type,        c],
  ];
  const detailBg = '#1e293b';
  const bar = <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>  │ </Text>;
  const wrap = (key: string, content: React.ReactNode) => (
    <Box key={key} style={{ backgroundColor: detailBg }}>
      <Row style={{ gap: 1 }}>
        {bar}
        {content}
      </Row>
    </Box>
  );
  for (const [k, v, color] of meta) {
    out.push(wrap(`d-m-${ev.id}-${k}`,
      <>
        <Box style={{ width: 8 }}><Text style={{ color: '#94a3b8' }}>{k}</Text></Box>
        <Text style={{ color }}>{v}</Text>
      </>,
    ));
  }
  out.push(wrap(`d-ph-${ev.id}`,
    <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>payload:</Text>,
  ));
  const body = payloadBody(ev);
  if (body === '') {
    out.push(wrap(`d-pe-${ev.id}`, <Text style={{ color: '#64748b' }}>  (empty)</Text>));
    return out;
  }
  let li = 0;
  for (const seg of body.split('\n')) {
    if (seg.length === 0) {
      out.push(wrap(`d-p-${ev.id}-${li++}`, <Text> </Text>));
      continue;
    }
    for (let i = 0; i < seg.length; i += width) {
      const part = seg.slice(i, i + width);
      out.push(wrap(`d-p-${ev.id}-${li++}`,
        <Text style={{ color: '#fafafa' }}>{'  ' + part}</Text>,
      ));
    }
  }
  return out;
}

function FilterBar({ filter, editing }: { filter: string; editing: boolean }) {
  return (
    <Row style={{ gap: 1 }}>
      <Text style={{ color: editing ? '#fbbf24' : '#94a3b8', fontWeight: 'bold' }}>filter:</Text>
      <Text style={{ color: '#e5e7eb' }}>{filter}{editing ? '_' : ''}</Text>
      {!editing && filter ? <Text style={{ color: '#64748b' }}>  (/ to edit · ESC to clear)</Text> : null}
      {editing ? <Text style={{ color: '#64748b' }}>  (Enter to apply · ESC to clear · ! prefix to exclude)</Text> : null}
    </Row>
  );
}

const SEP = '  ';
const MARKER_W = 2; // marker glyph + space
const COL_TIME = 12;
const COL_IMP  = 4;
const COL_TYPE = 22;
const COL_SRC  = 28;

function Header({ scrollX }: { scrollX: number }) {
  const segs: Seg[] = [
    { text: '  ', fg: '#475569' },
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

function LogRow({ ev, scrollX, cursor, expanded }: { ev: Event; scrollX: number; cursor: boolean; expanded: boolean }) {
  const c = impColor(ev.imp);
  const payload = fmtPayload(ev);
  const marker = expanded ? '▼' : (cursor ? '▶' : ' ');
  const markerColor = (cursor || expanded) ? '#fbbf24' : '#475569';
  const timeColor = cursor ? '#e5e7eb' : '#64748b';
  const srcColor = cursor ? '#e5e7eb' : '#94a3b8';
  const payColor = cursor ? '#fafafa' : '#cbd5e1';
  const bg = (cursor || expanded) ? '#1e293b' : undefined;
  const segs: Seg[] = [
    { text: marker + ' ', fg: markerColor, bold: cursor || expanded },
    { text: padRight(fmtTime(ev.ts), COL_TIME), fg: timeColor },
    { text: SEP, fg: '#475569' },
    { text: padRight(ev.imp.toFixed(2), COL_IMP), fg: c },
    { text: SEP, fg: '#475569' },
    { text: padRight(ev.type, COL_TYPE), fg: c, bold: cursor || expanded },
    { text: SEP, fg: '#475569' },
    { text: padRight(ev.src, COL_SRC), fg: srcColor },
    { text: SEP, fg: '#475569' },
    { text: payload, fg: payColor },
  ];
  return (
    <Box style={bg ? { backgroundColor: bg } : undefined}>
      <SegRow segs={sliceSegs(segs, scrollX)} />
    </Box>
  );
}

function SegRow({ segs }: { segs: Seg[] }) {
  return (
    <Row>
      {segs.map((s, i) => (
        <Text key={i} style={{ color: s.fg, fontWeight: s.bold ? 'bold' : undefined }}>{s.text}</Text>
      ))}
    </Row>
  );
}
