// devEventLog — observability cart that tails the SQLite events db.
//
// Run as its own ship'd binary alongside the dev host. Two processes,
// two V8 isolates, two ring buffers — no shared React tree, no feedback
// loop. Both processes write to the SAME ~/.cache/reactjit/events.db
// (WAL mode lets multiple readers + one writer coexist), and this cart
// queries that db every refresh tick.
//
// The cart filters out its OWN session_id so it doesn't display its own
// renders/log calls. What you see is everyone else's traffic — the dev
// host you're poking at, plus any other reactjit binaries running.

import { useEffect, useMemo, useState } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, TextInput } from '@reactjit/runtime/primitives';
import { bus } from '@reactjit/runtime/eventBus';
import * as sqlite from '@reactjit/runtime/hooks/sqlite';

interface BusEvent {
  id: number;
  ts: number;
  type: string;
  src: string;
  imp: number;
  par: number | null;
  sid: string;
  payload: any;
}

const BG = '#0c0d10';
const PANEL = '#15171c';
const PANEL_HI = '#1c1f26';
const TEXT = '#e8e6e1';
const TEXT_DIM = '#8a8a8a';
const ACCENT = '#5fbf9f';
const BORDER = '#262932';

const REFRESH_MS = 400;
const MAX_EVENTS = 500;

const TIERS: { label: string; minImp: number; color: string }[] = [
  { label: 'all', minImp: 0, color: TEXT_DIM },
  { label: '≥0.3', minImp: 0.3, color: '#5b8cff' },
  { label: '≥0.5', minImp: 0.5, color: '#d4b85a' },
  { label: '≥0.7', minImp: 0.7, color: '#e08a4a' },
  { label: '≥0.9', minImp: 0.9, color: '#e25555' },
];

function colorForImp(imp: number): string {
  if (imp >= 0.9) return '#e25555';
  if (imp >= 0.7) return '#e08a4a';
  if (imp >= 0.5) return '#d4b85a';
  if (imp >= 0.3) return '#5b8cff';
  return TEXT_DIM;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function payloadPreview(payload: any): string {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  try {
    const s = JSON.stringify(payload);
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  } catch {
    return String(payload);
  }
}

function payloadFull(payload: any): string {
  if (payload == null) return '{}';
  try { return JSON.stringify(payload, null, 2); } catch { return String(payload); }
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return s; }
}

export interface EventLogProps {
  /** Default minimum importance for the filter. Set to 0.3 to hide
   *  steady-state host.flush noise; 0 to show everything. */
  defaultMinImportance?: number;
  /** Refresh interval ms. Lower = more reactive, more host.flush
   *  feedback loop. Default 400. */
  refreshMs?: number;
}

export function EventLog({ defaultMinImportance = 0.3, refreshMs = REFRESH_MS }: EventLogProps = {}) {
  const [events, setEvents] = useState<BusEvent[]>([]);
  const [minImp, setMinImp] = useState(defaultMinImportance);
  const [typeFilter, setTypeFilter] = useState('');
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [ownSid] = useState(() => bus.sessionId());
  const [dbHandle, setDbHandle] = useState<number>(0);
  const [dbErr, setDbErr] = useState<string>('');

  // Open the events db once. This is the bus's canonical SQLite file
  // (`~/.cache/reactjit/events.db`); both this process and the dev host
  // share it via WAL. Path comes from the bus's host fn so we don't have
  // to know $HOME on the JS side.
  useEffect(() => {
    const path = bus.dbPath();
    if (!path) {
      setDbErr('bus has no db path (sqlite not linked?)');
      return;
    }
    try {
      const h = sqlite.open(path);
      setDbHandle(h);
      return () => { try { sqlite.close(h); } catch {} };
    } catch (e: any) {
      setDbErr(`open failed: ${e?.message || e}`);
    }
  }, []);

  useEffect(() => {
    if (paused) return;
    if (!dbHandle) return;
    const tick = () => {
      try {
        // Push filters into SQL. With high event rates (the bus does
        // 1000+/sec under card_stress) the in-memory ring window of
        // MAX_EVENTS scrolls past in fractions of a second — useless
        // for "find me a specific event type." Filtering at the SQL
        // layer means the LIMIT applies to MATCHING events, so a
        // search for "fps" returns the last MAX_EVENTS fps lines,
        // covering minutes of session instead of ms.
        const needle = typeFilter.trim();
        const wheres: string[] = ['session_id != ?'];
        const params: any[] = [ownSid];
        if (minImp > 0) {
          wheres.push('importance >= ?');
          params.push(minImp);
        }
        if (needle) {
          wheres.push('(event_type LIKE ? OR source LIKE ? OR payload LIKE ?)');
          const pat = `%${needle}%`;
          params.push(pat, pat, pat);
        }
        params.push(MAX_EVENTS);
        const sql = `SELECT id, ts_ms, session_id, event_type, source, importance, parent_id, payload
                       FROM events
                       WHERE ${wheres.join(' AND ')}
                       ORDER BY id DESC
                       LIMIT ?`;
        const rows = sqlite.query<{
          id: number; ts_ms: number; session_id: string;
          event_type: string; source: string; importance: number;
          parent_id: number | null; payload: string | null;
        }>(dbHandle, sql, params);
        const mapped: BusEvent[] = rows.map(r => ({
          id: r.id,
          ts: r.ts_ms,
          type: r.event_type,
          src: r.source,
          imp: r.importance,
          par: r.parent_id,
          sid: r.session_id,
          payload: r.payload ? safeJson(r.payload) : null,
        }));
        setEvents(mapped);
      } catch (e: any) {
        setDbErr(`query failed: ${e?.message || e}`);
      }
    };
    tick();
    const id = setInterval(tick, refreshMs);
    return () => clearInterval(id);
  }, [paused, refreshMs, dbHandle, ownSid, minImp, typeFilter]);

  // Filtering already happened at the SQL layer; render straight from
  // the resultset. (Kept the variable name `filtered` so the JSX below
  // doesn't need to change.)
  const filtered = events;

  const counts = useMemo(() => {
    let high = 0, mid = 0, low = 0;
    for (const e of events) {
      if (e.imp >= 0.7) high++;
      else if (e.imp >= 0.3) mid++;
      else low++;
    }
    return { high, mid, low };
  }, [events]);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: BG, padding: 16 }}>
      <Col style={{ width: '100%', height: '100%', gap: 12 }}>

        <Row style={{ width: '100%', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Col style={{ gap: 4 }}>
            <Text fontSize={20} color={TEXT} bold style={{ letterSpacing: 1 }}>EVENT LOG</Text>
            <Text fontSize={11} color={TEXT_DIM}>
              own session {ownSid || '—'} · {events.length} loaded
              {dbErr ? ` · ${dbErr}` : ''}
            </Text>
          </Col>
          <Row style={{ gap: 6, alignItems: 'center' }}>
            <Pressable onPress={() => setPaused(p => !p)}>
              <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, backgroundColor: paused ? ACCENT : PANEL, borderRadius: 4 }}>
                <Text fontSize={11} color={paused ? BG : TEXT} bold>{paused ? 'paused' : 'pause'}</Text>
              </Box>
            </Pressable>
            <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, backgroundColor: PANEL, borderRadius: 4 }}>
              <Text fontSize={11} color="#e25555" bold>{counts.high}</Text>
            </Box>
            <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, backgroundColor: PANEL, borderRadius: 4 }}>
              <Text fontSize={11} color="#d4b85a" bold>{counts.mid}</Text>
            </Box>
            <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, backgroundColor: PANEL, borderRadius: 4 }}>
              <Text fontSize={11} color={TEXT_DIM} bold>{counts.low}</Text>
            </Box>
          </Row>
        </Row>

        <Row style={{ width: '100%', gap: 12, alignItems: 'center' }}>
          <Row style={{ gap: 4 }}>
            {TIERS.map(t => {
              const on = t.minImp === minImp;
              return (
                <Pressable key={t.label} onPress={() => setMinImp(t.minImp)}>
                  <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, backgroundColor: on ? PANEL_HI : PANEL, borderRadius: 4, borderWidth: on ? 1 : 0, borderColor: t.color }}>
                    <Text fontSize={10} color={on ? t.color : TEXT_DIM} bold>{t.label}</Text>
                  </Box>
                </Pressable>
              );
            })}
          </Row>
          <Box style={{ flexGrow: 1, backgroundColor: PANEL, borderRadius: 4, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6 }}>
            <TextInput
              value={typeFilter}
              onChangeText={(t: string) => setTypeFilter(t)}
              placeholder="filter by type, source, or payload (substring)"
              style={{ color: TEXT, fontSize: 12 }}
            />
          </Box>
          <Text fontSize={11} color={TEXT_DIM}>{filtered.length} shown</Text>
        </Row>

        <Box style={{ flexGrow: 1, minHeight: 0, backgroundColor: PANEL, borderRadius: 6, padding: 8 }}>
          <ScrollView style={{ width: '100%', height: '100%' }}>
            <Col style={{ gap: 2 }}>
              {filtered.length === 0 ? (
                <Box style={{ padding: 20 }}>
                  <Text fontSize={12} color={TEXT_DIM}>no events match · waiting for traffic…</Text>
                </Box>
              ) : (
                filtered.map(e => (
                  <EventRow
                    key={e.id}
                    event={e}
                    expanded={expanded === e.id}
                    onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                  />
                ))
              )}
            </Col>
          </ScrollView>
        </Box>
      </Col>
    </Box>
  );
}

function EventRow({ event, expanded, onToggle }: { event: BusEvent; expanded: boolean; onToggle: () => void }) {
  const c = colorForImp(event.imp);
  const preview = payloadPreview(event.payload);
  return (
    <Pressable onPress={onToggle}>
      <Col style={{ width: '100%', borderRadius: 4, backgroundColor: expanded ? PANEL_HI : 'transparent', padding: 6, gap: 4 }}>
        <Row style={{ gap: 10, alignItems: 'center' }}>
          <Text fontSize={10} color={TEXT_DIM} style={{ fontFamily: 'mono', minWidth: 90 }}>{fmtTime(event.ts)}</Text>
          <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
          <Text fontSize={11} color={c} bold style={{ minWidth: 56 }}>{event.imp.toFixed(2)}</Text>
          <Text fontSize={12} color={TEXT} style={{ fontFamily: 'mono', minWidth: 220 }}>{event.type}</Text>
          <Text fontSize={10} color={TEXT_DIM} style={{ minWidth: 200 }}>{event.src}</Text>
          <Text fontSize={10} color={TEXT_DIM} style={{ flexGrow: 1 }} numberOfLines={1}>{preview}</Text>
          {event.par != null ? (
            <Text fontSize={10} color={ACCENT} style={{ fontFamily: 'mono' }}>↑{event.par}</Text>
          ) : null}
        </Row>
        {expanded ? (
          <Box style={{ marginLeft: 100, padding: 8, backgroundColor: BG, borderRadius: 4, borderLeftWidth: 2, borderLeftColor: c, borderColor: BORDER }}>
            <Text fontSize={11} color={TEXT} style={{ fontFamily: 'mono' }}>{payloadFull(event.payload)}</Text>
          </Box>
        ) : null}
      </Col>
    </Pressable>
  );
}

export default EventLog;
