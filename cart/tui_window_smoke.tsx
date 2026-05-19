// tui_window_smoke — smoke test reproducing claudewrap's SettingsWindow
// layout shape so the layout-dump diagnostic can show exactly how
// PanelNav children land.
//
//   scripts/ship-tui cart/tui_window_smoke.tsx
//   RJIT_DUMP_LAYOUT=1 zig-out/bin/tui_window_smoke

import * as React from 'react';
import { Box, Col, Row, Text, Pressable, Window } from '@reactjit/runtime/primitives';

const PANELS = ['bridge', 'backends', 'memory', 'library', 'vm', 'canvas'];

export default function TuiWindowSmoke() {
  return (
    <Col style={{ width: '100%', height: '100%' }}>
      <Text style={{ color: '#fbbf24' }}>tui_window_smoke</Text>
      <Window title="smoke · panel-nav repro" width={900} height={620}>
        <Row style={{ width: '100%', height: '100%', backgroundColor: '#0b1020' }}>
          <Col style={{
            width: 18,
            height: '100%',
            backgroundColor: '#111827',
            paddingTop: 1,
            paddingBottom: 1,
            gap: 0,
          }}>
            <Box style={{ paddingLeft: 1, paddingBottom: 1 }}>
              <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>panels</Text>
            </Box>
            {PANELS.map((label, i) => (
              <Pressable key={label}>
                <Box style={{
                  paddingLeft: 2,
                  paddingRight: 2,
                  backgroundColor: i === 0 ? '#fbbf24' : '#111827',
                }}>
                  <Text style={{
                    color: i === 0 ? '#000000' : '#94a3b8',
                    fontWeight: i === 0 ? 'bold' : 'normal',
                  }}>{label}</Text>
                </Box>
              </Pressable>
            ))}
          </Col>
          <Col style={{ flexGrow: 1, padding: 1 }}>
            {/* Inner Col mimics what BridgePanel returns — nested. */}
            <Col style={{ gap: 1, flexGrow: 1 }}>
              <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>bridge</Text>
              <Row style={{ gap: 1 }}>
                <Text style={{ color: '#94a3b8' }}>port</Text>
                <Box style={{ width: 8, borderWidth: 1, borderColor: '#475569', paddingLeft: 1, paddingRight: 1 }}>
                  <Text>7781</Text>
                </Box>
                <Text style={{ color: '#94a3b8' }}>(changes rebind on save — open/close panel to retry)</Text>
              </Row>
              <Text style={{ color: '#94a3b8', fontWeight: 'bold' }}>endpoints</Text>
            </Col>
          </Col>
        </Row>
      </Window>
    </Col>
  );
}
