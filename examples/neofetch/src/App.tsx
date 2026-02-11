/**
 * Neofetch — system info display.
 *
 * Written following the same patterns as the storybook demos:
 * explicit fontSize on every Text, hardcoded pixel values,
 * proper Box nesting with gap/padding.
 */

import React from 'react';
import { Box, Text } from '@ilovereact/core';
import type { SystemInfo } from './sysinfo';

/* ── heart pixel grid (13 wide × 10 tall) ──────────────────── */

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

/* ── palette ────────────────────────────────────────────────── */

const PALETTE = [
  '#e94560', '#ff6b6b', '#533483', '#845ec2',
  '#0f3460', '#4b8bbe', '#16213e', '#1a1a2e',
];

/* ── colors ──────────────────────────────────────────────────── */

const ACCENT = '#e94560';
const BRIGHT = '#e0e0f0';
const DIM    = '#444466';

/* ── sub-components ──────────────────────────────────────────── */

function Heart() {
  return (
    <Box style={{ flexDirection: 'column', paddingTop: 4 }}>
      {HEART_GRID.map((row, r) => (
        <Box key={r} style={{ flexDirection: 'row' }}>
          {row.map((filled, c) => (
            <Box key={c} style={{
              width: 12,
              height: 12,
              backgroundColor: filled ? HEART_COLORS[r] : 'transparent',
            }} />
          ))}
        </Box>
      ))}
    </Box>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <Box style={{ flexDirection: 'row', gap: 4 }}>
      <Box style={{ width: 70 }}>
        <Text style={{ color: ACCENT, fontSize: 14, fontWeight: 'bold' }}>{label}:</Text>
      </Box>
      <Box style={{ flexGrow: 1 }}>
        <Text style={{ color: BRIGHT, fontSize: 14 }}>{value}</Text>
      </Box>
    </Box>
  );
}

function ColorPalette() {
  return (
    <Box style={{ flexDirection: 'row', gap: 2 }}>
      {PALETTE.map((color, i) => (
        <Box key={i} style={{ width: 28, height: 14, backgroundColor: color, borderRadius: 2 }} />
      ))}
    </Box>
  );
}

/* ── main ────────────────────────────────────────────────────── */

export default function App({ info, showFps }: { info: SystemInfo; showFps?: number }) {
  const title = `${info.user}@${info.hostname}`;

  return (
    <Box style={{
      width: '100%',
      height: '100%',
      backgroundColor: '#0a0a0f',
      padding: 32,
      flexDirection: 'column',
    }}>
      <Box style={{
        flexDirection: 'row',
        gap: 24,
        backgroundColor: '#0e0e18',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#1a1a2e',
        padding: 24,
      }}>
        <Heart />
        <Box style={{ flexDirection: 'column', gap: 4, flexGrow: 1 }}>
          <Text style={{ color: ACCENT, fontSize: 18, fontWeight: 'bold' }}>{title}</Text>
          <Box style={{ height: 1, backgroundColor: DIM }} />
          <Box style={{ height: 4 }} />
          <InfoLine label="OS"     value={info.os} />
          <InfoLine label="Kernel" value={info.kernel} />
          <InfoLine label="Uptime" value={info.uptime} />
          <InfoLine label="Shell"  value={info.shell} />
          <InfoLine label="CPU"    value={info.cpu} />
          <InfoLine label="Memory" value={info.memory} />
          <InfoLine label="Arch"   value={info.arch} />
          <Box style={{ height: 12 }} />
          <ColorPalette />
        </Box>
      </Box>
      {showFps !== undefined && (
        <Box style={{ paddingTop: 8, alignItems: 'end' }}>
          <Text style={{ color: DIM, fontSize: 10 }}>{showFps} FPS — press Escape to quit</Text>
        </Box>
      )}
    </Box>
  );
}
