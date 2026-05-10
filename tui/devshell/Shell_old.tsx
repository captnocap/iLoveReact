// Dev-shell top-level layout. Runs as a normal cart on the TUI backend
// — same Box/Text/Pressable primitives a GPU cart would use, same
// renderer/hostConfig reconciler. tui/host.ts paints them to a
// character grid.
//
// Wires tab switching (number keys), help overlay, screen-copy hotkey,
// and pane mounting. F2/F3/F5 are reserved.

import * as React from 'react';
import { Box, Row, Col, Text } from '../../runtime/primitives';
import { subscribeKey, headlessSnapshot } from '../host';
import { BundlePane } from './panes/Bundle';
import { LogsPane } from './panes/Logs';
import { useTelemetry, Telemetry } from './services/Telemetry';
import { useLogLevel } from './services/LogLevel';
import { copyToClipboard } from './services/clipboard';
import { isInputClaimed, getCopyOverride } from './services/InputClaim';

const { useState, useEffect } = React;

type TabId = 'logs' | 'events' | 'inspect' | 'bundle' | 'status';
const TABS: { id: TabId; label: string }[] = [
  { id: 'logs',    label: 'Logs' },
  { id: 'events',  label: 'Events' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'bundle',  label: 'Bundle' },
  { id: 'status',  label: 'Status' },
];

const palette = {
  page:   '#0b1020',
  card:   '#111827',
  ink:    '#e5e7eb',
  dim:    '#94a3b8',
  faint:  '#64748b',
  muted:  '#475569',
  accent: '#fbbf24',
  good:   '#34d399',
  bad:    '#f87171',
  blue:   '#60a5fa',
  pin:    '#1e293b',
};

declare const __exists: ((path: string) => boolean) | undefined;
const probeHost = (): boolean => (typeof __exists === 'function') ? __exists('/tmp/reactjit.sock') : false;

export default function Shell() {
  const cart = (typeof process !== 'undefined' && process.argv?.[2]) || '<no cart>';
  const [active, setActive] = useState<TabId>('status');
  const [tick, setTick] = useState(0);
  const [hostUp, setHostUp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const tel = useTelemetry();
  const log = useLogLevel();

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 200);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { setHostUp(probeHost()); }, [tick]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => subscribeKey(k => {
    if (isInputClaimed()) return;
    if (k === 'q') process.exit(0);
    if (k >= '1' && k <= '5') {
      const idx = parseInt(k, 10) - 1;
      if (TABS[idx]) setActive(TABS[idx].id);
      return;
    }
    if (k === '?') { setShowHelp(h => !h); return; }
    if (k === 'l') { log.cycle(); return; }
    if (k === 'y') {
      const override = getCopyOverride();
      const cols = (process.stdout?.columns) || 80;
      const rows = (process.stdout?.rows) || 24;
      const text = override ? override() : headlessSnapshot(cols, rows);
      copyToClipboard(text);
      const lines = text ? text.split('\n').length : 0;
      setToast(override
        ? `✓ copied ${text.length} chars · ${lines} lines`
        : `✓ copied ${rows}×${cols} as plain text`);
      return;
    }
    if (k === '\x1b' && showHelp) setShowHelp(false);
  }), [showHelp]);

  const spinner = '|/-\\'[tick % 4];

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: palette.page, color: palette.ink, flexDirection: 'column' }}>
      {/* Title bar — two rows. */}
      <Col style={{ backgroundColor: palette.card }}>
        <Row style={{ paddingLeft: 1, paddingRight: 1 }}>
          {toast ? (
            <Row><Text style={{ color: palette.good, fontWeight: 'bold' }}>{toast}</Text></Row>
          ) : (
            <Row style={{ gap: 2 }}>
              <Text style={{ color: palette.blue, fontWeight: 'bold' }}>rjit</Text>
              <Text style={{ color: '#cbd5e1' }}>cart=<Text style={{ color: palette.accent, fontWeight: 'bold' }}>{cart}</Text></Text>
              <Text style={{ color: hostUp ? palette.good : palette.bad }}>host {hostUp ? '● up' : '○ down'}</Text>
              <Text style={{ color: log.color }}>log:{log.name ?? '—'}</Text>
            </Row>
          )}
        </Row>
        <Row style={{ paddingLeft: 1, paddingRight: 1 }}>
          <Box style={{ flexGrow: 1 }} />
          <TelemetryStrip tel={tel} hostUp={hostUp} spinner={spinner} />
        </Row>
      </Col>

      {/* Tab strip */}
      <Row style={{ gap: 1, paddingLeft: 1, paddingRight: 1, backgroundColor: palette.page }}>
        {TABS.map((t, i) => {
          const sel = active === t.id;
          return (
            <Box key={t.id} style={{ backgroundColor: sel ? palette.pin : undefined, paddingLeft: 1, paddingRight: 1 }}>
              <Text style={{ color: sel ? palette.accent : palette.dim, fontWeight: sel ? 'bold' : undefined }}>
                {i + 1}·{t.label}
              </Text>
            </Box>
          );
        })}
      </Row>

      {/* Active pane */}
      <Box style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
        {showHelp ? <HelpPane /> : <ActivePane id={active} cart={cart} hostUp={hostUp} tick={tick} />}
      </Box>

      {/* Footer */}
      <Row style={{ gap: 2, paddingLeft: 1, paddingRight: 1, backgroundColor: palette.card }}>
        <Text style={{ color: palette.faint }}>1..5 tab · l log · y copy · ? help · q quit</Text>
      </Row>
    </Box>
  );
}

function TelemetryStrip({ tel, hostUp, spinner }: { tel: Telemetry | null; hostUp: boolean; spinner: string }) {
  const dim = palette.muted;
  const sep = <Text style={{ color: dim }}>·</Text>;
  if (!hostUp || !tel) {
    return (
      <Row style={{ gap: 1 }}>
        <Text style={{ color: dim }}>—fps {sep} —nodes {sep} L— {sep} P— {sep} {spinner}</Text>
      </Row>
    );
  }
  const fps = tel.fps | 0;
  const fpsColor = fps >= 55 ? palette.good : fps >= 30 ? palette.accent : palette.bad;
  const lay = (tel.layout_us / 1000).toFixed(1);
  const pnt = (tel.paint_us / 1000).toFixed(1);
  return (
    <Row style={{ gap: 1 }}>
      <Text style={{ color: fpsColor, fontWeight: 'bold' }}>{fps}fps</Text>
      {sep}
      <Text style={{ color: '#cbd5e1' }}>{tel.node_count} nodes</Text>
      {sep}
      <Text style={{ color: '#cbd5e1' }}>L {lay}ms</Text>
      {sep}
      <Text style={{ color: '#cbd5e1' }}>P {pnt}ms</Text>
      {sep}
      <Text style={{ color: palette.dim }}>{spinner}</Text>
    </Row>
  );
}

function ActivePane({ id, cart, hostUp, tick }: { id: TabId; cart: string; hostUp: boolean; tick: number }) {
  if (id === 'status') return <StatusPane cart={cart} hostUp={hostUp} tick={tick} />;
  if (id === 'logs')    return <LogsPane />;
  if (id === 'events')  return <Placeholder name="Eventlog"    next="extend dev_ipc.zig with QUERY-EVENTS command; reuse SQL filter from cart/eventlog" />;
  if (id === 'inspect') return <Placeholder name="Inspector"   next="extend dev_ipc.zig with PICK-ELEMENT (request) + ELEMENT-INFO (reply); cart enters pick mode" />;
  if (id === 'bundle')  return <BundlePane cart={cart} />;
  return null;
}

function StatusPane({ cart, hostUp, tick }: { cart: string; hostUp: boolean; tick: number }) {
  return (
    <Col>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>Target cart</Text>
      <KV k="name"        v={cart} />
      <KV k="dev host"    v={hostUp ? 'connected at /tmp/reactjit.sock' : 'not running'}
                          kc={hostUp ? palette.good : palette.bad} />
      <KV k="renderer"    v={hostUp ? 'GPU host (Zig · SDL3 · WebGPU)' : '—'} />
      <KV k="bundle"      v={`.cache/bundle-${cart}.js`} />

      <Text style={{ color: palette.faint }}> </Text>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>Devshell (this UI)</Text>
      <KV k="renderer"    v="tui/host.ts (24-bit ANSI, dirty diff)" />
      <KV k="primitives"  v="runtime/primitives.tsx (shared with GPU host)" />
      <KV k="reconciler"  v="renderer/hostConfig.ts (shared with GPU host)" />
      <KV k="runtime"     v="tools/v8cli (Zig · V8)" />
      <KV k="heartbeat"   v={`${tick} ticks · 5Hz`} />

      <Text style={{ color: palette.faint }}> </Text>
      <Text style={{ color: palette.faint }}>Press 1..5 to switch tabs. Other panes are placeholders.</Text>
    </Col>
  );
}

function KV({ k, v, kc }: { k: string; v: string; kc?: string }) {
  return (
    <Row style={{ gap: 2 }}>
      <Box style={{ width: 14 }}><Text style={{ color: palette.dim }}>{k}</Text></Box>
      <Text style={{ color: kc ?? palette.ink }}>{v}</Text>
    </Row>
  );
}

function HelpPane() {
  return (
    <Col>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>Hotkeys</Text>
      <Text> </Text>
      <Hk k="1..5"      d="switch pane (Logs / Events / Inspect / Bundle / Status)" />
      <Hk k="y"         d="copy current screen as plain text to clipboard (OSC 52)" />
      <Hk k="l"         d="cycle log level: trace · debug · info · warn · error" />
      <Hk k="Tab/⇧Tab"  d="cycle keyboard focus across Pressables / TextInputs" />
      <Hk k="Enter"     d="activate focused element" />
      <Text> </Text>
      <Text style={{ color: '#cbd5e1', fontWeight: 'bold' }}>Inside Logs pane</Text>
      <Hk k="/"         d="filter (substring match; ! prefix excludes); Enter applies, ESC clears" />
      <Hk k="Enter"     d="open detail view on bottom event (full payload, word-wrapped)" />
      <Hk k="n / p"     d="(in detail) next / previous event" />
      <Hk k="↑/↓ k/j"   d="scroll one row" />
      <Hk k="←/→ h"     d="horizontal scroll (8 cols)" />
      <Hk k="G"         d="resume live tail" />
      <Hk k="?"         d="toggle this help (or ESC)" />
      <Hk k="q / ⌃C"    d="quit" />
      <Text> </Text>
      <Text style={{ color: '#cbd5e1', fontWeight: 'bold' }}>Inside Bundle pane</Text>
      <Hk k="↑/↓ k/j"   d="scroll one row" />
      <Hk k="PgUp/PgDn / Space" d="scroll one page" />
      <Hk k="g / G"     d="top / bottom" />
      <Text> </Text>
      <Text style={{ color: '#cbd5e1', fontWeight: 'bold' }}>Reserved</Text>
      <Hk k="F2"        d="restart dev host (not wired yet)" />
      <Hk k="F3"        d="rebuild current cart (not wired yet)" />
      <Hk k="F5"        d="pick element (not wired yet)" />
      <Text> </Text>
      <Text style={{ color: palette.faint }}>y avoids terminal selection — output is the exact grid we paint, no ANSI, no box-drawing artifacts.</Text>
    </Col>
  );
}

function Hk({ k, d }: { k: string; d: string }) {
  return (
    <Row style={{ gap: 2 }}>
      <Box style={{ width: 20 }}><Text style={{ color: palette.accent }}>{k}</Text></Box>
      <Text style={{ color: '#cbd5e1' }}>{d}</Text>
    </Row>
  );
}

function Placeholder({ name, next }: { name: string; next: string }) {
  return (
    <Col style={{ gap: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>{name}</Text>
      <Text style={{ color: palette.dim }}>not yet wired</Text>
      <Text style={{ color: '#cbd5e1' }}>next step: {next}</Text>
    </Col>
  );
}
