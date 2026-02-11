import React from 'react';
import { Box, Text, Divider, Spacer } from '../../../../packages/shared/src';

/* ── heart pixel grid (13 wide x 10 tall) ──────────────────── */

const HEART_LINES = [
  '  ███   ███  ',
  ' █████ █████ ',
  '█████████████',
  '█████████████',
  ' ███████████ ',
  '  █████████  ',
  '   ███████   ',
  '    █████    ',
  '     ███     ',
  '      █      ',
];

const HEART_GRID = HEART_LINES.map(line =>
  [...line].map(ch => ch !== ' ')
);

const HEART_COLORS = [
  '#ff6b9d', '#ff5277', '#e94560', '#e94560',
  '#d63447', '#c62828', '#b71c1c', '#9a0007',
  '#7f0000', '#5d0000',
];

const HEART_PX = 12;
const HEART_COLS = 13;
const HEART_ROWS = 10;

/* ── palette ────────────────────────────────────────────────── */

const PALETTE = [
  '#e94560', '#ff6b6b', '#533483', '#845ec2',
  '#0f3460', '#4b8bbe', '#16213e', '#1a1a2e',
];

/* ── colors ──────────────────────────────────────────────────── */

const ACCENT = '#e94560';
const BRIGHT = '#e0e0f0';
const DIM    = '#444466';

/* ── main ────────────────────────────────────────────────────── */

export function NeofetchDemoStory() {
  const title = 'siah@archlinux';

  return (
    <Box style={{ gap: 16, padding: 16 }}>
      {/* Card */}
      <Box style={{
        gap: 12,
        backgroundColor: '#0e0e18',
        borderRadius: 12,
        padding: 24,
        borderWidth: 1,
        borderColor: '#1a1a2e',
      }}>
        <Text style={{ color: ACCENT, fontSize: 18, fontWeight: '700' }}>{title}</Text>

        <Divider color={DIM} />

        {/* Heart + Info side by side */}
        <Box style={{ flexDirection: 'row', gap: 24 }}>

          {/* Heart — explicit dimensions */}
          <Box style={{
            width: HEART_COLS * HEART_PX,
            height: HEART_ROWS * HEART_PX,
            paddingTop: 4,
          }}>
            {HEART_GRID.map((row, r) => (
              <Box key={r} style={{ flexDirection: 'row' }}>
                {row.map((filled, c) => (
                  <Box key={c} style={{
                    width: HEART_PX,
                    height: HEART_PX,
                    backgroundColor: filled ? HEART_COLORS[r] : 'transparent',
                  }} />
                ))}
              </Box>
            ))}
          </Box>

          {/* Info */}
          <Box style={{ gap: 4 }}>
            <Box style={{ flexDirection: 'row', gap: 4 }}>
              <Text style={{ color: ACCENT, fontSize: 14, fontWeight: '700' }}>OS:</Text>
              <Text style={{ color: BRIGHT, fontSize: 14 }}>Arch Linux x86_64</Text>
            </Box>
            <Box style={{ flexDirection: 'row', gap: 4 }}>
              <Text style={{ color: ACCENT, fontSize: 14, fontWeight: '700' }}>Kernel:</Text>
              <Text style={{ color: BRIGHT, fontSize: 14 }}>6.14.0-37-generic</Text>
            </Box>
            <Box style={{ flexDirection: 'row', gap: 4 }}>
              <Text style={{ color: ACCENT, fontSize: 14, fontWeight: '700' }}>Uptime:</Text>
              <Text style={{ color: BRIGHT, fontSize: 14 }}>3 hours, 42 mins</Text>
            </Box>
            <Box style={{ flexDirection: 'row', gap: 4 }}>
              <Text style={{ color: ACCENT, fontSize: 14, fontWeight: '700' }}>Shell:</Text>
              <Text style={{ color: BRIGHT, fontSize: 14 }}>/bin/zsh</Text>
            </Box>
            <Box style={{ flexDirection: 'row', gap: 4 }}>
              <Text style={{ color: ACCENT, fontSize: 14, fontWeight: '700' }}>CPU:</Text>
              <Text style={{ color: BRIGHT, fontSize: 14 }}>AMD Ryzen 9 7950X (32)</Text>
            </Box>
            <Box style={{ flexDirection: 'row', gap: 4 }}>
              <Text style={{ color: ACCENT, fontSize: 14, fontWeight: '700' }}>Memory:</Text>
              <Text style={{ color: BRIGHT, fontSize: 14 }}>8192 MiB / 32768 MiB</Text>
            </Box>
            <Box style={{ flexDirection: 'row', gap: 4 }}>
              <Text style={{ color: ACCENT, fontSize: 14, fontWeight: '700' }}>Arch:</Text>
              <Text style={{ color: BRIGHT, fontSize: 14 }}>x86_64</Text>
            </Box>
          </Box>

        </Box>

        <Spacer size={4} />

        {/* Color palette */}
        <Box style={{ flexDirection: 'row', gap: 2 }}>
          {PALETTE.map((color, i) => (
            <Box key={i} style={{ width: 28, height: 14, backgroundColor: color, borderRadius: 2 }} />
          ))}
        </Box>
      </Box>

      {/* Footer */}
      <Box style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: DIM, fontSize: 10 }}>60 FPS - press Escape to quit</Text>
      </Box>
    </Box>
  );
}
