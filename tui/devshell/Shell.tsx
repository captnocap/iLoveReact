// Dev-shell top-level layout. Title bar + tab strip + active pane + footer.
//
// Wires tab switching (number keys), quit (q / ctrl-c), and the placeholder
// hotkey reservations (F2 restart, F3 rebuild, F5 pick). Real pane contents
// live in panes/*.

import { createElement, useState, useEffect } from 'react';
import { subscribeKey } from '../host';
import { BundlePane } from './panes/Bundle';
import { useTelemetry, Telemetry } from './services/Telemetry';

type TabId = 'logs' | 'events' | 'inspect' | 'bundle' | 'status';
const TABS: { id: TabId; label: string }[] = [
  { id: 'logs',    label: 'Logs' },
  { id: 'events',  label: 'Events' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'bundle',  label: 'Bundle' },
  { id: 'status',  label: 'Status' },
];

declare const __exists: ((path: string) => boolean) | undefined;
const probeHost = () => (typeof __exists === 'function') ? __exists('/tmp/reactjit.sock') : false;

export function Shell({ cart }: { cart: string }) {
  const [active, setActive] = useState<TabId>('status');
  const [tick, setTick] = useState(0);
  const [hostUp, setHostUp] = useState(false);
  const tel = useTelemetry();

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 200);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { setHostUp(probeHost()); }, [tick]);

  useEffect(() => subscribeKey(k => {
    if (k >= '1' && k <= '5') {
      const idx = parseInt(k, 10) - 1;
      if (TABS[idx]) setActive(TABS[idx].id);
    }
  }), []);

  const spinner = '|/-\\'[tick % 4];

  return (
    <box width="fill" height="fill" bg="#0b1020" fg="#e5e7eb" flexDirection="column">
      {/* Title bar — left group + spacer + right (telemetry) group */}
      <box flexDirection="row" paddingX={1} bg="#111827">
        <box flexDirection="row" gap={2}>
          <text bold fg="#60a5fa">rjit</text>
          <text fg="#cbd5e1">cart=<text bold fg="#fbbf24">{cart}</text></text>
          <text fg={hostUp ? '#34d399' : '#f87171'}>host {hostUp ? '● up' : '○ down'}</text>
        </box>
        <box flexGrow={1} />
        <TelemetryStrip tel={tel} hostUp={hostUp} spinner={spinner} />
      </box>

      {/* Tab strip — single row, selection via bg + bold */}
      <box flexDirection="row" gap={1} paddingX={1} bg="#0b1020">
        {TABS.map((t, i) => {
          const sel = active === t.id;
          return (
            <box key={t.id} bg={sel ? '#1e293b' : undefined} paddingX={1}>
              <text fg={sel ? '#fbbf24' : '#94a3b8'} bold={sel}>{i + 1}·{t.label}</text>
            </box>
          );
        })}
      </box>

      {/* Active pane — no border, just inset */}
      <box flexGrow={1} paddingX={2} paddingY={1}>
        <ActivePane id={active} cart={cart} hostUp={hostUp} tick={tick} />
      </box>

      {/* Footer — single row */}
      <box flexDirection="row" gap={2} paddingX={1} bg="#111827">
        <text fg="#64748b">1..5 tab · F2 restart · F3 rebuild · F5 pick · q quit</text>
      </box>
    </box>
  );
}

// Live telemetry strip pinned to the title bar's right edge. Always
// visible regardless of which tab is active. Reads from the dev host
// over /tmp/reactjit.sock (TELEMETRY verb), so reflects the cart's
// frame loop — not the devshell's own renderer.
function TelemetryStrip({ tel, hostUp, spinner }: { tel: Telemetry | null; hostUp: boolean; spinner: string }) {
  const dim = '#475569';
  const sep = <text fg={dim}>·</text>;
  if (!hostUp || !tel) {
    return (
      <box flexDirection="row" gap={1}>
        <text fg={dim}>—fps {sep} —nodes {sep} L— {sep} P— {sep} {spinner}</text>
      </box>
    );
  }
  const fps = tel.fps | 0;
  const fpsColor = fps >= 55 ? '#34d399' : fps >= 30 ? '#fbbf24' : '#f87171';
  const lay = (tel.layout_us / 1000).toFixed(1);
  const pnt = (tel.paint_us / 1000).toFixed(1);
  return (
    <box flexDirection="row" gap={1}>
      <text fg={fpsColor} bold>{fps}fps</text>
      {sep}
      <text fg="#cbd5e1">{tel.node_count} nodes</text>
      {sep}
      <text fg="#cbd5e1">L {lay}ms</text>
      {sep}
      <text fg="#cbd5e1">P {pnt}ms</text>
      {sep}
      <text fg="#94a3b8">{spinner}</text>
    </box>
  );
}

function ActivePane({ id, cart, hostUp, tick }: { id: TabId; cart: string; hostUp: boolean; tick: number }) {
  if (id === 'status') return <StatusPane cart={cart} hostUp={hostUp} tick={tick} />;
  if (id === 'logs')    return <Placeholder name="Logs"        next="spawn dev host as child, capture stdout/stderr via __spawn + __childReadLine, ring-buffer, render scrollable" />;
  if (id === 'events')  return <Placeholder name="Eventlog"    next="extend dev_ipc.zig with QUERY-EVENTS command; reuse SQL filter from cart/eventlog" />;
  if (id === 'inspect') return <Placeholder name="Inspector"   next="extend dev_ipc.zig with PICK-ELEMENT (request) + ELEMENT-INFO (reply); cart enters pick mode" />;
  if (id === 'bundle')  return <BundlePane cart={cart} />;
  return null;
}

function StatusPane({ cart, hostUp, tick }: { cart: string; hostUp: boolean; tick: number }) {
  return (
    <box flexDirection="column">
      <text fg="#fbbf24" bold>Target cart</text>
      <Row k="name"        v={cart} />
      <Row k="dev host"    v={hostUp ? 'connected at /tmp/reactjit.sock' : 'not running'}
                            kc={hostUp ? '#34d399' : '#f87171'} />
      <Row k="renderer"    v={hostUp ? 'GPU host (Zig · SDL3 · WebGPU)' : '—'} />
      <Row k="bundle"      v={`.cache/bundle-${cart}.js`} />

      <text fg="#64748b"> </text>
      <text fg="#fbbf24" bold>Devshell (this UI)</text>
      <Row k="renderer"    v="tui/host.ts (24-bit ANSI, dirty diff)" />
      <Row k="runtime"     v="tools/v8cli (Zig · V8)" />
      <Row k="heartbeat"   v={`${tick} ticks · 5Hz`} />

      <text fg="#64748b"> </text>
      <text fg="#64748b">Press 1..5 to switch tabs. Other panes are placeholders.</text>
    </box>
  );
}

function Row({ k, v, kc }: { k: string; v: string; kc?: string }) {
  return (
    <box flexDirection="row" gap={2}>
      <box width={14}><text fg="#94a3b8">{k}</text></box>
      <text fg={kc ?? '#e5e7eb'}>{v}</text>
    </box>
  );
}

function Placeholder({ name, next }: { name: string; next: string }) {
  return (
    <box flexDirection="column" gap={1}>
      <text fg="#fbbf24" bold>{name}</text>
      <text fg="#94a3b8">not yet wired</text>
      <text fg="#cbd5e1">next step: {next}</text>
    </box>
  );
}
