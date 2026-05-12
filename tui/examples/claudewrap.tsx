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

type TabId = 'main' | 'notes' | 'help';

const TABS: { id: TabId; label: string }[] = [
  { id: 'main',  label: '1 claude'  },
  { id: 'notes', label: '2 notes'   },
  { id: 'help',  label: '3 help'    },
];

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
    if (k === '2') setTab('notes');
    if (k === '3') setTab('help');
  }), []);

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
            {tab === 'notes' && <NotesPage lines={notes} />}
            {tab === 'help'  && <HelpPage />}
          </Col>
        )}
        <Terminal key="term" shell="claude" style={termStyle} />
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
      <Text style={{ color: palette.ink }}>click a tab or press 1 / 2 / 3 to switch</Text>
      <Text style={{ color: palette.ink }}>click into the terminal box to type into claude</Text>
      <Text style={{ color: palette.ink }}>Ctrl+] drops terminal focus back to the cart</Text>
      <Text style={{ color: palette.ink }}>q quits (only when terminal isn't focused)</Text>
    </Col>
  );
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
