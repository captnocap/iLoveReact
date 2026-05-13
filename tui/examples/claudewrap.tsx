// claudewrap — Claude Code wrapped in a TUI shell with tabs + PiP.
//
// The Terminal node is mounted ONCE at a stable JSX position with a
// stable key. Tabs vary only its style: full-window on "main", a
// fixed-width side strip on other tabs. React keeps the same instance
// across tab switches → same node.id → same vterm slot → same PTY →
// same live Claude Code session.
//
// Run with:  scripts/ship-tui tui/examples/claudewrap.tsx
//            zig-out/bin/claudewrap
//
// Click a tab to switch. Click into the terminal to focus it (typing
// goes to claude). Ctrl+] drops terminal focus back to the cart.

import * as React from 'react';
import { Box, Col, Row, Text, Pressable, Terminal } from '../../runtime/primitives';
import { subscribeKey, leave } from '../host';

const palette = {
  bg:     '#0b1020',
  bar:    '#111827',
  border: '#1f2937',
  ink:    '#e5e7eb',
  dim:    '#94a3b8',
  accent: '#fbbf24',
};

type TabId = 'main' | 'ifttt' | 'notes' | 'help';

const TABS: { id: TabId; label: string }[] = [
  { id: 'main',  label: '1 claude'  },
  { id: 'ifttt', label: '2 ifttt'   },
  { id: 'notes', label: '3 notes'   },
  { id: 'help',  label: '4 help'    },
];

// ── IFTTT activity tail ──────────────────────────────────────────
//
// The launcher (scripts/claude-ss) writes guest hook events to
// ~/.cache/reactjit/ifttt-latest.log, one JSON line per event. We
// poll it on a timer; once vsock lands the same panel can subscribe
// to a bus channel and the poller becomes the fallback path.

interface IftttEvent {
  event: string;
  ts: number;
  payload: any;
  raw: string;
}

const IFTTT_LOG_PATH = (() => {
  const home = (globalThis as any).__env?.('HOME') ?? '/tmp';
  return `${home}/.cache/reactjit/ifttt-latest.log`;
})();

// The wrapper spawns claude-ss as its embedded shell — the terminal IS
// the microVM. Launch claudewrap from the repo root (or `cd` there
// first), since scripts/claude-ss is a relative path. When we later
// teach the Terminal primitive to take args, --task=<id> from the
// planning UI will flow in here too.
const CLAUDE_SS_LAUNCHER = (() => {
  const root = (globalThis as any).__env?.('REACTJIT_ROOT')
    || (globalThis as any).__cwd?.()
    || '.';
  return `${root}/scripts/claude-ss`;
})();

export default function ClaudeCart() {
  const [tab, setTab] = React.useState<TabId>('main');
  const [notes, setNotes] = React.useState<string[]>([
    'PiP demo: the claude session in the side strip on the right is the same',
    'shell as the one filling the screen on the "1 claude" tab — no respawn.',
    '',
    'click a tab title to switch. clicks outside the terminal box drop',
    'terminal focus, so the tab bar is always reachable.',
  ]);

  React.useEffect(() => subscribeKey(k => {
    // These only fire when Terminal isn't focused (host routes all
    // keystrokes to the PTY while a Terminal owns focus). After Ctrl+]
    // the cart sees keys again.
    if (k === 'q') { leave(); process.exit(0); }
    if (k === '1') setTab('main');
    if (k === '2') setTab('ifttt');
    if (k === '3') setTab('notes');
    if (k === '4') setTab('help');
  }), []);

  const ifttt = useIftttTail(IFTTT_LOG_PATH);

  // ── per-tab style for the SAME terminal instance ─────────────────
  const termStyle = tab === 'main'
    ? { flexGrow: 1, height: '100%' as const }
    : { width: 40, height: '100%' as const, borderWidth: 1, borderColor: palette.accent };

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: palette.bg }}>
      <TabBar tab={tab} onSelect={setTab} />
      <Row style={{ flexGrow: 1 }} key="body">
        {tab !== 'main' && (
          <Col key="page" style={{ flexGrow: 1, padding: 1 }}>
            {tab === 'ifttt' && <IftttPage events={ifttt} />}
            {tab === 'notes' && <NotesPage lines={notes} />}
            {tab === 'help'  && <HelpPage />}
          </Col>
        )}
        <Terminal key="term" shell={CLAUDE_SS_LAUNCHER} style={termStyle} />
      </Row>
      <StatusBar tab={tab} />
    </Col>
  );
}

function TabBar({ tab, onSelect }: { tab: TabId; onSelect: (t: TabId) => void }) {
  return (
    <Row style={{ height: 1, backgroundColor: palette.bar }}>
      {TABS.map(t => {
        const active = t.id === tab;
        return (
          <Pressable key={t.id} onPress={() => onSelect(t.id)}>
            <Box style={{
              paddingLeft: 2, paddingRight: 2,
              backgroundColor: active ? palette.accent : palette.bar,
            }}>
              <Text style={{
                color: active ? '#000000' : palette.dim,
                fontWeight: active ? 'bold' : 'normal',
              }}>{t.label}</Text>
            </Box>
          </Pressable>
        );
      })}
    </Row>
  );
}

function NotesPage({ lines }: { lines: string[] }) {
  return (
    <Col style={{ gap: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>notes</Text>
      {lines.map((l, i) => (
        <Text key={i} style={{ color: palette.ink }}>{l || ' '}</Text>
      ))}
    </Col>
  );
}

function HelpPage() {
  return (
    <Col style={{ gap: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>help</Text>
      <Text style={{ color: palette.ink }}>click a tab or press 1–4 to switch</Text>
      <Text style={{ color: palette.ink }}>click into the terminal box to type into claude</Text>
      <Text style={{ color: palette.ink }}>Ctrl+] drops terminal focus back to the cart</Text>
      <Text style={{ color: palette.ink }}>ifttt tab: live claude-code lifecycle events from inside the VM</Text>
      <Text style={{ color: palette.ink }}>q quits (only when terminal isn't focused)</Text>
    </Col>
  );
}

// ── IFTTT activity ───────────────────────────────────────────────

function useIftttTail(path: string): IftttEvent[] {
  const [events, setEvents] = React.useState<IftttEvent[]>([]);
  const seenLines = React.useRef(0);

  React.useEffect(() => {
    const tick = () => {
      const g: any = globalThis;
      let text = '';
      try { text = g.__readFile?.(path) ?? ''; } catch { return; }
      if (!text) return;
      const lines = text.split('\n').filter(l => l.length > 0);
      if (lines.length <= seenLines.current) return;
      const fresh = lines.slice(seenLines.current);
      seenLines.current = lines.length;
      const parsed: IftttEvent[] = fresh.map(raw => {
        try {
          const obj = JSON.parse(raw);
          return { event: String(obj.event ?? '?'), ts: Number(obj.ts ?? 0), payload: obj.payload ?? null, raw };
        } catch {
          return { event: 'unparsed', ts: Date.now(), payload: raw, raw };
        }
      });
      setEvents(prev => [...prev, ...parsed].slice(-200));
    };
    tick();
    const h = setInterval(tick, 500);
    return () => clearInterval(h);
  }, [path]);

  return events;
}

function IftttPage({ events }: { events: IftttEvent[] }) {
  const empty = events.length === 0;
  return (
    <Col style={{ gap: 0, flexGrow: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>ifttt activity</Text>
      <Text style={{ color: palette.dim }}>polling {IFTTT_LOG_PATH}</Text>
      <Text> </Text>
      {empty && (
        <Text style={{ color: palette.dim }}>
          no events yet — run claude-ss in another tab/term, then interact with claude
        </Text>
      )}
      {!empty && events.slice().reverse().slice(0, 40).map((e, i) => (
        <Row key={`${e.ts}-${i}`} style={{ gap: 1 }}>
          <Text style={{ color: palette.dim }}>{formatTs(e.ts)}</Text>
          <Text style={{ color: eventColor(e.event), fontWeight: 'bold' }}>{e.event}</Text>
          <Text style={{ color: palette.ink }}>{payloadPreview(e.payload)}</Text>
        </Row>
      ))}
    </Col>
  );
}

function formatTs(ms: number): string {
  if (!ms) return '--:--:--';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function eventColor(name: string): string {
  if (name.startsWith('PreTool'))  return '#60a5fa';
  if (name.startsWith('PostTool')) return '#34d399';
  if (name === 'UserPromptSubmit') return palette.accent;
  if (name === 'Notification')     return '#f472b6';
  if (name.startsWith('Stop'))     return '#f87171';
  return palette.ink;
}

function payloadPreview(p: any): string {
  if (p == null) return '';
  if (typeof p === 'string') return p.slice(0, 80);
  try {
    const s = JSON.stringify(p);
    // Show the tool name if it's a tool event; else first ~80 chars.
    if (p.tool_name) return `${p.tool_name}`;
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
  } catch { return ''; }
}

function StatusBar({ tab }: { tab: TabId }) {
  return (
    <Row style={{ height: 1, backgroundColor: palette.bar, paddingLeft: 1, paddingRight: 1 }}>
      <Text style={{ color: palette.dim }}>tab: </Text>
      <Text style={{ color: palette.accent }}>{tab}</Text>
      <Box style={{ flexGrow: 1 }} />
      <Text style={{ color: palette.dim }}>Ctrl+] unfocus terminal · q quit</Text>
    </Row>
  );
}
