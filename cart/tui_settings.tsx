// tui_settings — a "TUI" cart whose settings menu spawns a real GUI window.
//
// Main SDL window = bash <Terminal> + a chrome strip — feels like a TUI.
// Press F1 (or click the strip) → opens a second SDL window via <Window>
// containing standard React primitives (Pressables, swatches, etc.). That
// second window is a GUI, and its state is bound back into the TUI host.
//
//   scripts/ship cart/tui_settings.tsx

import * as React from 'react';
import { useState } from 'react';
import { Box, Col, Row, Text, Pressable, Terminal, Window } from '@reactjit/runtime/primitives';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';

const PALETTE: { name: string; chrome: string; ink: string }[] = [
  { name: 'midnight', chrome: '#111827', ink: '#fbbf24' },
  { name: 'forest',   chrome: '#14532d', ink: '#bbf7d0' },
  { name: 'plum',     chrome: '#3b0764', ink: '#f0abfc' },
  { name: 'sand',     chrome: '#78350f', ink: '#fde68a' },
];

export default function TuiSettings() {
  const [showSettings, setShowSettings] = useState(false);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [label, setLabel] = useState('tui_settings');
  const palette = PALETTE[paletteIdx];

  useIFTTT('key:f1', () => setShowSettings(v => !v));
  useIFTTT('key:escape', () => setShowSettings(false));

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: '#0b1020' }}>
      <Row
        style={{
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 6,
          paddingBottom: 6,
          gap: 16,
          backgroundColor: palette.chrome,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: palette.ink, fontWeight: 700 }}>{label}</Text>
        <Text style={{ color: '#94a3b8' }}>{`palette: ${palette.name}`}</Text>
        <Box style={{ flexGrow: 1 }} />
        <Pressable
          onPress={() => setShowSettings(v => !v)}
          style={{
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 4,
            paddingBottom: 4,
            borderRadius: 6,
            backgroundColor: '#1f2937',
          }}
        >
          <Text style={{ color: '#e5e7eb' }}>
            {showSettings ? 'Close Settings (F1)' : 'Settings (F1)'}
          </Text>
        </Pressable>
      </Row>

      <Box style={{ flexGrow: 1 }}>
        <Terminal shell="/bin/bash" autoFocus style={{ width: '100%', height: '100%' }} />
      </Box>

      {showSettings && (
        <Window
          title="Settings"
          width={420}
          height={360}
          onClose={() => setShowSettings(false)}
        >
          <Col
            style={{
              width: '100%',
              height: '100%',
              padding: 16,
              gap: 16,
              backgroundColor: '#0f172a',
            }}
          >
            <Text style={{ color: '#e5e7eb', fontSize: 18, fontWeight: 700 }}>
              Settings
            </Text>
            <Text style={{ color: '#94a3b8', fontSize: 12 }}>
              This window is a separate native SDL2 window. State here is
              bound into the TUI host on the left.
            </Text>

            <Col style={{ gap: 6 }}>
              <Text style={{ color: '#cbd5e1', fontSize: 13 }}>Palette</Text>
              <Row style={{ gap: 8, flexWrap: 'wrap' }}>
                {PALETTE.map((p, i) => (
                  <Pressable
                    key={p.name}
                    onPress={() => setPaletteIdx(i)}
                    style={{
                      paddingLeft: 10,
                      paddingRight: 10,
                      paddingTop: 6,
                      paddingBottom: 6,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: i === paletteIdx ? p.ink : 'transparent',
                      backgroundColor: p.chrome,
                    }}
                  >
                    <Text style={{ color: p.ink }}>{p.name}</Text>
                  </Pressable>
                ))}
              </Row>
            </Col>

            <Col style={{ gap: 6 }}>
              <Text style={{ color: '#cbd5e1', fontSize: 13 }}>Header label</Text>
              <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                {['tui_settings', 'wrapt', 'shell', 'ops'].map(l => (
                  <Pressable
                    key={l}
                    onPress={() => setLabel(l)}
                    style={{
                      paddingLeft: 10,
                      paddingRight: 10,
                      paddingTop: 4,
                      paddingBottom: 4,
                      borderRadius: 6,
                      backgroundColor: l === label ? '#1f2937' : '#111827',
                      borderWidth: 1,
                      borderColor: l === label ? '#475569' : '#1f2937',
                    }}
                  >
                    <Text style={{ color: '#e5e7eb' }}>{l}</Text>
                  </Pressable>
                ))}
              </Row>
            </Col>

            <Box style={{ flexGrow: 1 }} />

            <Row style={{ justifyContent: 'flex-end' }}>
              <Pressable
                onPress={() => setShowSettings(false)}
                style={{
                  paddingLeft: 14,
                  paddingRight: 14,
                  paddingTop: 6,
                  paddingBottom: 6,
                  borderRadius: 6,
                  backgroundColor: '#1e293b',
                }}
              >
                <Text style={{ color: '#e5e7eb' }}>Done</Text>
              </Pressable>
            </Row>
          </Col>
        </Window>
      )}
    </Col>
  );
}
