// Hotkey reference. Sectioned by scope: global, then per-pane. Mirrors
// what subscribeKey actually wires — keep these in sync when keys move.

import * as React from 'react';
import { Box, Col, Row, Text } from '../../../runtime/primitives';

export function HelpPane() {
  return (
    <Col>
      <Text style={{ color: 'theme:accent', fontWeight: 'bold' }}>Hotkeys</Text>
      <Text> </Text>
      <Hk k="1..5"      d="switch pane (Status / Logs / Events / Inspect / Bundle)" />
      <Hk k="y"         d="copy current screen as plain text to clipboard (OSC 52)" />
      <Hk k="l"         d="cycle log level: trace · debug · info · warn · error" />
      <Hk k="Tab/⇧Tab"  d="cycle keyboard focus across Pressables / TextInputs" />
      <Hk k="Enter"     d="activate focused element" />
      <Text> </Text>
      <Text style={{ color: 'theme:ink', fontWeight: 'bold' }}>Inside Logs pane</Text>
      <Hk k="/"         d="filter (substring match; ! prefix excludes); Enter applies, ESC clears" />
      <Hk k="Enter"     d="open detail view on bottom event (full payload, word-wrapped)" />
      <Hk k="n / p"     d="(in detail) next / previous event" />
      <Hk k="↑/↓ k/j"   d="scroll one row" />
      <Hk k="←/→ h"     d="horizontal scroll (8 cols)" />
      <Hk k="G"         d="resume live tail" />
      <Hk k="?"         d="toggle this help (or ESC)" />
      <Hk k="q / ⌃C"    d="quit" />
      <Text> </Text>
      <Text style={{ color: 'theme:ink', fontWeight: 'bold' }}>Inside Bundle pane</Text>
      <Hk k="↑/↓ k/j"            d="scroll one row" />
      <Hk k="PgUp/PgDn / Space"  d="scroll one page" />
      <Hk k="g / G"              d="top / bottom" />
      <Text> </Text>
      <Text style={{ color: 'theme:ink', fontWeight: 'bold' }}>Reserved</Text>
      <Hk k="F2" d="restart dev host (not wired yet)" />
      <Hk k="F3" d="rebuild current cart (not wired yet)" />
      <Hk k="F5" d="pick element (not wired yet)" />
      <Text> </Text>
      <Text style={{ color: 'theme:inkFaint' }}>y avoids terminal selection — output is the exact grid we paint, no ANSI, no box-drawing artifacts.</Text>
    </Col>
  );
}

function Hk({ k, d }: { k: string; d: string }) {
  return (
    <Row style={{ gap: 2 }}>
      <Box style={{ width: 20 }}><Text style={{ color: 'theme:accent' }}>{k}</Text></Box>
      <Text style={{ color: 'theme:ink' }}>{d}</Text>
    </Row>
  );
}
