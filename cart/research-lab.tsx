// research-lab — Claude in a terminal, a live Firefox window, and a sources
// panel that fills in automatically as Claude does research.
//
// Layout (left → right):
//   [ claude tui ]  [ firefox window ]  [ collected sources ]
//
// Pattern: the cart captures the already-running stealth Firefox by window
// name via XShm (`window:Firefox`). browse only allows one session at a
// time (single global SESSION_FILE); if one is already running, claude's
// in-terminal `browse curl ...` / `browse search ...` auto-discovers it.
// If none is running, start one outside the cart: `browse --port 7332 &`.
//
// The sources panel polls `list_tabs` over the same TCP bridge useBrowse
// uses, so it sees whatever tabs Claude opens. URLs are deduplicated and
// ranked by visit count + recency.
//
// To run:   ./scripts/dev research-lab

import { useEffect, useRef, useState } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, Render, Terminal } from '@reactjit/runtime/primitives';
import { browseRequest, setBrowsePort } from '@reactjit/runtime/hooks/useBrowse';
import { useProcess } from '@reactjit/runtime/hooks/useProcess';

const BROWSE_PORT = 7332;
const RENDER_SRC  = 'window:Firefox';
const POLL_MS     = 1500;

interface Source {
  url: string;
  host: string;
  title: string;
  firstSeen: number;
  lastSeen: number;
  visits: number;       // number of distinct poll windows the tab was present
  active: boolean;      // currently the active tab in the session
}

export default function App() {
  const [sources, setSources]   = useState<Record<string, Source>>({});
  const [status, setStatus]     = useState<'starting' | 'live' | 'down'>('starting');
  const [activity, setActivity] = useState<string>('');
  const presentRef              = useRef<Set<string>>(new Set());

  // Spawn the stealth browse session ourselves. If one is already running
  // (single global SESSION_FILE), this child exits 1 and the existing one
  // keeps serving — either way the cart polls + renders the live window.
  const proc = useProcess({
    cmd: 'python',
    args: ['-m', 'browse.session', '--port', String(BROWSE_PORT), '--disposable'],
    stdin: 'ignore',
  });

  useEffect(() => { setBrowsePort(BROWSE_PORT); }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: any = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const r: any = await browseRequest({ cmd: 'list_tabs' });
        if (cancelled) return;
        setStatus('live');

        const tabs: any[] = Array.isArray(r?.tabs) ? r.tabs : [];
        const now = Date.now();
        const seenThisTick = new Set<string>();
        let activeUrl = '';

        setSources(prev => {
          const next: Record<string, Source> = { ...prev };
          for (const t of tabs) {
            const url = String(t.url || '');
            if (!/^https?:/.test(url)) continue;
            seenThisTick.add(url);
            const title = String(t.title || '');
            const wasPresent = presentRef.current.has(url);
            const existing = next[url];
            const visits = existing ? (wasPresent ? existing.visits : existing.visits + 1) : 1;
            next[url] = {
              url,
              host: hostOf(url),
              title: title || existing?.title || '',
              firstSeen: existing?.firstSeen ?? now,
              lastSeen: now,
              visits,
              active: !!t.active,
            };
            if (t.active) activeUrl = url;
          }
          // Mark all non-present as inactive
          for (const u of Object.keys(next)) {
            if (!seenThisTick.has(u)) next[u].active = false;
          }
          return next;
        });

        presentRef.current = seenThisTick;
        if (activeUrl) setActivity(`active: ${truncate(activeUrl, 60)}`);
        else setActivity(`${tabs.length} tab${tabs.length === 1 ? '' : 's'}`);
      } catch (e: any) {
        if (!cancelled) {
          setStatus('down');
          setActivity('browse session not reachable');
        }
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  const list = Object.values(sources).sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (b.visits !== a.visits) return b.visits - a.visits;
    return b.lastSeen - a.lastSeen;
  });

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b1020' }}>
      {/* top bar */}
      <Row style={{
        paddingTop: 6, paddingBottom: 6, paddingLeft: 12, paddingRight: 12,
        backgroundColor: '#111827', alignItems: 'center', gap: 12,
      }}>
        <Text style={{ color: '#fbbf24', fontSize: 12, fontWeight: 'bold' }}>research-lab</Text>
        <Text style={{ color: statusColor(status), fontSize: 11 }}>
          {status === 'live' ? '● live' : status === 'down' ? '× down' : '○ starting'}
        </Text>
        <Text style={{ color: '#94a3b8', fontSize: 11, flexGrow: 1 }}>{activity}</Text>
        <Text style={{ color: '#475569', fontSize: 10 }}>
          {`browse :${BROWSE_PORT} · sources ${list.length}`}
        </Text>
      </Row>

      {/* three-pane body */}
      <Row style={{ flexGrow: 1, padding: 6, gap: 6 }}>
        {/* claude tui */}
        <Col style={{
          flexBasis: 0, flexGrow: 3,
          borderRadius: 6, overflow: 'hidden', backgroundColor: '#000',
          borderWidth: 1, borderColor: '#1f2937',
        }}>
          <PaneHeader label="claude" hint="type research request below" />
          <Terminal shell="claude" style={{ flexGrow: 1, width: '100%' }} />
        </Col>

        {/* firefox */}
        <Col style={{
          flexBasis: 0, flexGrow: 5,
          borderRadius: 6, overflow: 'hidden', backgroundColor: '#000',
          borderWidth: 1, borderColor: '#1f2937',
        }}>
          <PaneHeader label="firefox" hint={`pid ${proc.pid || '—'} · ${proc.state}`} />
          {status === 'live' ? (
            <Render renderSrc={RENDER_SRC} style={{ flexGrow: 1, width: '100%' }} />
          ) : (
            <Col style={{
              flexGrow: 1, width: '100%',
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: '#0b1020', gap: 8, padding: 24,
            }}>
              <Text style={{ color: '#fbbf24', fontSize: 14, fontWeight: 'bold' }}>
                {proc.state === 'error' ? 'failed to spawn browse'
                  : proc.state === 'stopped' ? 'browse session exited'
                  : 'launching browse session…'}
              </Text>
              <Text style={{ color: '#94a3b8', fontSize: 11 }}>
                {`python -m browse.session --port ${BROWSE_PORT} --disposable`}
              </Text>
              {proc.error && (
                <Text style={{ color: '#f87171', fontSize: 11 }}>{proc.error}</Text>
              )}
            </Col>
          )}
        </Col>

        {/* sources */}
        <Col style={{
          flexBasis: 0, flexGrow: 3,
          borderRadius: 6, overflow: 'hidden', backgroundColor: '#0f172a',
          borderWidth: 1, borderColor: '#1f2937',
        }}>
          <PaneHeader label="sources" hint="auto-collected from tabs" />
          {list.length === 0 ? (
            <Col style={{ padding: 12, gap: 6 }}>
              <Text style={{ color: '#94a3b8', fontSize: 11 }}>
                Tell claude in the terminal something like:
              </Text>
              <Text style={{
                color: '#e5e7eb', fontSize: 11, fontFamily: 'monospace',
                backgroundColor: '#1e293b', padding: 8, borderRadius: 4,
              }}>
                research the best espresso machines under $500 using browse
              </Text>
              <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
                Every URL it visits in this firefox session shows up here.
              </Text>
            </Col>
          ) : (
            <ScrollView style={{ flexGrow: 1 }}>
              <Col style={{ gap: 6, padding: 6 }}>
                {list.map((s, i) => <SourceCard key={s.url} src={s} rank={i + 1} />)}
              </Col>
            </ScrollView>
          )}
        </Col>
      </Row>
    </Box>
  );
}

function SourceCard({ src, rank }: { src: Source; rank: number }) {
  const onOpen = () => {
    browseRequest({ cmd: 'navigate', url: src.url }).catch(() => {});
  };
  return (
    <Pressable onPress={onOpen}>
      <Box style={{
        flexDirection: 'column',
        backgroundColor: src.active ? '#1e3a8a' : '#1e293b',
        borderRadius: 4, padding: 8, gap: 2,
        borderWidth: 1, borderColor: src.active ? '#3b82f6' : '#334155',
      }}>
        <Row style={{ gap: 6, alignItems: 'center' }}>
          <Text style={{
            color: '#fbbf24', fontSize: 10, fontWeight: 'bold',
            width: 18,
          }}>{`#${rank}`}</Text>
          <Text style={{
            color: '#e5e7eb', fontSize: 12, fontWeight: 'bold', flexGrow: 1,
          }}>{src.title || src.host}</Text>
          {src.active && (
            <Text style={{ color: '#60a5fa', fontSize: 9, fontWeight: 'bold' }}>ACTIVE</Text>
          )}
        </Row>
        <Text style={{ color: '#93c5fd', fontSize: 10 }}>{src.host}</Text>
        <Text style={{ color: '#64748b', fontSize: 9 }}>{truncate(src.url, 80)}</Text>
        <Row style={{ gap: 8, marginTop: 2 }}>
          <Text style={{ color: '#94a3b8', fontSize: 9 }}>
            {`visits ${src.visits}`}
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 9 }}>
            {`${ago(src.lastSeen)} ago`}
          </Text>
        </Row>
      </Box>
    </Pressable>
  );
}

function PaneHeader({ label, hint }: { label: string; hint: string }) {
  return (
    <Row style={{
      paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8,
      backgroundColor: '#1f2937', alignItems: 'center', gap: 8,
    }}>
      <Text style={{ color: '#fbbf24', fontSize: 11, fontWeight: 'bold' }}>{label}</Text>
      <Text style={{ color: '#64748b', fontSize: 10 }}>{hint}</Text>
    </Row>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function statusColor(s: 'starting' | 'live' | 'down'): string {
  if (s === 'live') return '#34d399';
  if (s === 'down') return '#f87171';
  return '#fbbf24';
}
