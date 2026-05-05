// Dev-shell top-level layout. Title bar + tab strip + active pane + footer.
//
// Wires tab switching (number keys), quit (q / ctrl-c), and the placeholder
// hotkey reservations (F2 restart, F3 rebuild, F5 pick). Real pane contents
// live in panes/*.

import { createElement, useState, useEffect } from 'react';
import { subscribeKey } from '../host';

type TabId = 'logs' | 'events' | 'inspect' | 'bundle' | 'status';
const TABS: { id: TabId; label: string }[] = [
  { id: 'logs',    label: 'Logs' },
  { id: 'events',  label: 'Events' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'bundle',  label: 'Bundle' },
  { id: 'status',  label: 'Status' },
];

declare const __exists: (path: string) => boolean;

export function Shell({ cart }: { cart: string }) {
  const [active, setActive] = useState<TabId>('status');
  const [tick, setTick] = useState(0);
  const [hostUp, setHostUp] = useState(false);

  // 5Hz heartbeat — drives spinner, time display, socket probe.
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 200);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setHostUp(__exists('/tmp/reactjit.sock'));
  }, [tick]);

  useEffect(() => subscribeKey(k => {
    if (k >= '1' && k <= '5') {
      const idx = parseInt(k, 10) - 1;
      if (TABS[idx]) setActive(TABS[idx].id);
    }
  }), []);

  const spinner = '|/-\\'[tick % 4];
  const now = new Date().toLocaleTimeString();

  return (
    <box width="fill" height="fill" bg="#0b1020" fg="#e5e7eb" flexDirection="column">
      {/* Title bar */}
      <box flexDirection="row" gap={2} padding={1} bg="#111827" align="center">
        <box bg="#1d4ed8" fg="#ffffff" padding={1} border borderColor="#60a5fa">
          <text bold>rjit devshell</text>
        </box>
        <text fg="#cbd5e1">cart=<text bold fg="#fbbf24">{cart}</text></text>
        <text fg={hostUp ? '#34d399' : '#f87171'}>host {hostUp ? '● up' : '○ down'}</text>
        <text fg="#94a3b8">{spinner} {now}</text>
      </box>

      {/* Tab strip */}
      <box flexDirection="row" gap={1} padding={1} bg="#0b1020">
        {TABS.map((t, i) => {
          const sel = active === t.id;
          return (
            <box key={t.id}
              bg={sel ? '#1e293b' : undefined}
              fg={sel ? '#fbbf24' : '#94a3b8'}
              padding={1}
              border={sel}
              borderColor="#fbbf24">
              <text bold={sel}>[{i + 1}] {t.label}</text>
            </box>
          );
        })}
      </box>

      {/* Active pane */}
      <box flexGrow={1} padding={1} border borderColor="#334155">
        <ActivePane id={active} cart={cart} hostUp={hostUp} tick={tick} />
      </box>

      {/* Footer */}
      <box flexDirection="row" gap={2} padding={1} bg="#111827">
        <text fg="#64748b">[1..5] tab</text>
        <text fg="#64748b">F2 restart</text>
        <text fg="#64748b">F3 rebuild</text>
        <text fg="#64748b">F5 pick</text>
        <text fg="#64748b">q quit</text>
      </box>
    </box>
  );
}

function ActivePane({ id, cart, hostUp, tick }: { id: TabId; cart: string; hostUp: boolean; tick: number }) {
  if (id === 'status') return <StatusPane cart={cart} hostUp={hostUp} tick={tick} />;
  if (id === 'logs')    return <Placeholder name="Logs"        next="spawn dev host as child, capture stdout/stderr via __spawn + __childReadLine, ring-buffer, render scrollable" />;
  if (id === 'events')  return <Placeholder name="Eventlog"    next="extend dev_ipc.zig with QUERY-EVENTS command; reuse SQL filter from cart/eventlog" />;
  if (id === 'inspect') return <Placeholder name="Inspector"   next="extend dev_ipc.zig with PICK-ELEMENT (request) + ELEMENT-INFO (reply); cart enters pick mode" />;
  if (id === 'bundle')  return <Placeholder name="Bundle Stats" next="parse .cache/bundle-{cart}.js.metafile.json; render top modules by size" />;
  return null;
}

function StatusPane({ cart, hostUp, tick }: { cart: string; hostUp: boolean; tick: number }) {
  return (
    <box flexDirection="column" gap={1}>
      <text fg="#fbbf24" bold>Status</text>
      <Row k="cart"        v={cart} />
      <Row k="dev host"    v={hostUp ? 'connected at /tmp/reactjit.sock' : 'not running'}
                            kc={hostUp ? '#34d399' : '#f87171'} />
      <Row k="heartbeat"   v={`${tick} ticks · 5Hz`} />
      <Row k="renderer"    v="tui/host.ts (24-bit ANSI, dirty-frame diff)" />
      <Row k="runtime"     v="tools/v8cli (zig + V8) · no node, no bun" />
      <text fg="#64748b">{`\nPress 1..5 to switch tabs. Other panes are placeholders — see plan in each.`}</text>
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
