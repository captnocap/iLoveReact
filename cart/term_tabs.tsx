// term_tabs — TUI smoke for named <Terminal session="..."> pipes.
//
// One <Terminal> at a time, swapping its `session` prop. Inactive tabs keep
// their PTYs running in the background; switching back snaps to the live
// state with full scrollback intact.
//
// Run:  scripts/tui cart/term_tabs.tsx
//
// Keys:
//   F1..F9     — switch to tab 1..9 (lazy-created on first press)
//   +          — add a new tab (unfocused only)
//   x          — close current tab (unfocused only)
//   Ctrl+]     — release terminal focus (back to host shortcuts)
//   q / Ctrl+C — quit
//
// While a terminal is focused, all typing goes to the PTY EXCEPT the
// hotkeys above (F1..F9, Ctrl+]). The hotkeys bypass Terminal forwarding
// via subscribeHotkey so they never reach the inner shell.

import * as React from 'react';
import { Box, Row, Col, Text, Pressable, Terminal } from '../runtime/primitives';
import { subscribeKey, subscribeHotkey } from '../tui/host';

const palette = {
  page: '#0b1020',
  rail: '#0f172a',
  tab: '#1e293b',
  tabActive: '#1d4ed8',
  border: '#334155',
  borderActive: '#60a5fa',
  ink: '#e5e7eb',
  dim: '#94a3b8',
  accent: '#fbbf24',
};

type Tab = { id: number; label: string };

export default function TermTabs() {
  const [tabs, setTabs] = React.useState<Tab[]>([
    { id: 1, label: 'tab-1' },
    { id: 2, label: 'tab-2' },
    { id: 3, label: 'tab-3' },
  ]);
  const [active, setActive] = React.useState(1);
  const nextIdRef = React.useRef(4);

  // Keep callbacks fresh without re-subscribing each render — subscribe
  // once at mount, read live state through refs.
  const tabsRef = React.useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = React.useRef(active);
  activeRef.current = active;

  // F1..F9 are routed by tui/host through subscribeHotkey so they bypass
  // the focused-Terminal forward. The inner shell never sees them.
  React.useEffect(() => {
    const fkeys = [
      '\x1bOP', '\x1bOQ', '\x1bOR', '\x1bOS', // F1..F4
      '\x1b[15~', '\x1b[17~', '\x1b[18~',     // F5..F7
      '\x1b[19~', '\x1b[20~',                  // F8..F9
    ];
    const offs = fkeys.map((seq, i) =>
      subscribeHotkey(seq, () => {
        const t = tabsRef.current[i];
        if (t) setActive(t.id);
      })
    );
    return () => offs.forEach(off => off());
  }, []);

  // Unfocused-only shortcuts (subscribeKey fires AFTER the terminal-forward
  // check, so a focused Terminal eats these — release focus with Ctrl+] first).
  React.useEffect(() => subscribeKey(k => {
    if (k === 'q') process.exit(0);
    if (k === '+') {
      const id = nextIdRef.current++;
      setTabs(prev => [...prev, { id, label: `tab-${id}` }]);
      setActive(id);
    }
    if (k === 'x') {
      const cur = activeRef.current;
      const all = tabsRef.current;
      if (all.length <= 1) return; // don't close the last one
      const idx = all.findIndex(t => t.id === cur);
      const next = all[idx + 1] ?? all[idx - 1] ?? all[0];
      setTabs(prev => prev.filter(t => t.id !== cur));
      if (next) setActive(next.id);
    }
  }), []);

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: palette.page, padding: 1, gap: 1 }}>
      {/* Header */}
      <Row style={{ gap: 2, alignItems: 'center' }}>
        <Box style={{ backgroundColor: palette.tabActive, padding: 1, borderWidth: 1, borderColor: palette.borderActive }}>
          <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>term_tabs · named-session smoke</Text>
        </Box>
        <Text style={{ color: palette.dim }}>F1..F9 switch · + add · x close · ⌃] unfocus · q quit</Text>
      </Row>

      {/* Tab bar */}
      <Row style={{ gap: 1 }}>
        {tabs.map((t, i) => {
          const isActive = t.id === active;
          return (
            <Pressable key={t.id} onPress={() => setActive(t.id)}>
              <Box style={{
                backgroundColor: isActive ? palette.tabActive : palette.tab,
                borderWidth: 1,
                borderColor: isActive ? palette.borderActive : palette.border,
                paddingLeft: 1,
                paddingRight: 1,
              }}>
                <Text style={{
                  color: isActive ? '#ffffff' : palette.ink,
                  fontWeight: isActive ? 'bold' : 'normal',
                }}>
                  {`[F${i + 1}] ${t.label}`}
                </Text>
              </Box>
            </Pressable>
          );
        })}
      </Row>

      {/* Single Terminal, session prop swaps as `active` changes.
          Inactive sessions keep streaming in the background. */}
      <Box style={{ flexGrow: 1, borderWidth: 1, borderColor: palette.border }}>
        <Terminal
          shell="bash"
          session={`term-tabs-${active}`}
          autoFocus
          style={{ width: '100%', height: '100%' }}
        />
      </Box>

      <Text style={{ color: palette.dim }}>
        active = {`term-tabs-${active}`} · {tabs.length} session{tabs.length === 1 ? '' : 's'} alive (PTYs persist while you switch tabs)
      </Text>
    </Col>
  );
}
