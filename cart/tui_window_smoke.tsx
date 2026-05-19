// tui_window_smoke — minimal smoke test for the TUI <Window> path.
// Ships via ship-tui. The TUI binary opens an SDL3 window on mount
// because <Window> is in the initial tree.
//
//   scripts/ship-tui cart/tui_window_smoke.tsx
//   zig-out/bin/tui_window_smoke
//
// Expected: ANSI text in the terminal AND a real GUI window pops up.

import * as React from 'react';
import { Col, Text, Window } from '@reactjit/runtime/primitives';

export default function TuiWindowSmoke() {
  return (
    <Col style={{ width: '100%', height: '100%', padding: 1, backgroundColor: '#0b1020' }}>
      <Text style={{ color: '#fbbf24' }}>tui_window_smoke</Text>
      <Text style={{ color: '#94a3b8' }}>{'a real GUI window should appear alongside this ANSI shell'}</Text>
      <Window title="hello from the TUI" width={520} height={320}>
        <Col style={{ width: '100%', height: '100%', backgroundColor: '#1f2937' }}>
          <Text style={{ color: '#e5e7eb' }}>this is rendered into a real SDL3 window</Text>
        </Col>
      </Window>
    </Col>
  );
}
