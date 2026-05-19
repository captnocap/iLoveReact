// tui_window_smoke — minimal smoke test for the TUI <Window> path.
// Ships via ship-tui. The TUI binary opens an SDL3 window on mount
// because <Window> is in the initial tree.
//
//   scripts/ship-tui cart/tui_window_smoke.tsx
//   zig-out/bin/tui_window_smoke
//
// Expected: ANSI text in the terminal AND a real GUI window pops up.

import * as React from 'react';
import { Box, Col, Row, Text, Window } from '@reactjit/runtime/primitives';

export default function TuiWindowSmoke() {
  return (
    <Col style={{ width: '100%', height: '100%', padding: 1, backgroundColor: '#0b1020' }}>
      <Text style={{ color: '#fbbf24' }}>tui_window_smoke</Text>
      <Text style={{ color: '#94a3b8' }}>{'a real GUI window should appear alongside this ANSI shell'}</Text>
      <Window title="hello from the TUI" width={560} height={360}>
        <Col
          style={{
            width: '100%',
            height: '100%',
            padding: 3,
            gap: 2,
            backgroundColor: '#0f172a',
          }}
        >
          <Text style={{ color: '#fbbf24', fontSize: 22 }}>
            Hello from the TUI's React tree
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 13 }}>
            This window is a real SDL3 surface. ANSI grid + GUI window share one
            reconciler, one component tree, one JS state.
          </Text>
          <Row style={{ gap: 2 }}>
            <Box
              style={{
                padding: 2,
                backgroundColor: '#1e40af',
                borderRadius: 1,
              }}
            >
              <Text style={{ color: '#dbeafe' }}>blue tile</Text>
            </Box>
            <Box
              style={{
                padding: 2,
                backgroundColor: '#7e22ce',
                borderRadius: 1,
              }}
            >
              <Text style={{ color: '#f3e8ff' }}>purple tile</Text>
            </Box>
            <Box
              style={{
                padding: 2,
                backgroundColor: '#16a34a',
                borderRadius: 1,
              }}
            >
              <Text style={{ color: '#dcfce7' }}>green tile</Text>
            </Box>
          </Row>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: '#475569', fontSize: 11 }}>
            close this window from the WM — the TUI shell keeps running
          </Text>
        </Col>
      </Window>
    </Col>
  );
}
