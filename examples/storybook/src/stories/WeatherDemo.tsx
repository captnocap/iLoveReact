import React from 'react';
import { Box, Text, Divider } from '../../../../packages/shared/src';

/* ── Sun pixel grid (11 wide x 11 tall) ───────────────────── */

const SUN_LINES = [
  '  .  .  .  ',
  ' .       . ',
  '.  .   .  .',
  '   .███.   ',
  '.  █████  .',
  '   █████   ',
  '.  █████  .',
  '   .███.   ',
  '.  .   .  .',
  ' .       . ',
  '  .  .  .  ',
];

const SUN_GRID: Array<Array<'core' | 'ray' | null>> = SUN_LINES.map(line =>
  [...line].map(ch => {
    if (ch === '\u2588') return 'core';
    if (ch === '.') return 'ray';
    return null;
  })
);

const SUN_PX = 8;
const SUN_COLS = 11;
const SUN_ROWS = 11;

/* ── Cloud pixel grid (13 wide x 6 tall) ──────────────────── */

const CLOUD_LINES = [
  '    ███      ',
  '  ███████    ',
  ' █████████   ',
  '████████████ ',
  '█████████████',
  ' ███████████ ',
];

const CLOUD_GRID = CLOUD_LINES.map(line =>
  [...line].map(ch => ch !== ' ')
);

const CLOUD_PX = 6;
const CLOUD_COLS = 13;
const CLOUD_ROWS = 6;

const CLOUD_COLORS = [
  '#B0BEC5', '#90A4AE', '#78909C',
  '#607D8B', '#546E7A', '#455A64',
];

/* ── Colors ────────────────────────────────────────────────── */

const BG_CARD  = '#111827';
const BORDER   = '#1E293B';
const ACCENT   = '#60A5FA';
const WARM     = '#F59E0B';
const HOT      = '#EF4444';
const COOL     = '#06B6D4';
const BRIGHT   = '#E2E8F0';
const DIM      = '#64748B';
const MUTED    = '#475569';

/* ── Forecast data ─────────────────────────────────────────── */

const FORECAST = [
  { day: 'Mon', temp: 72 },
  { day: 'Tue', temp: 68 },
  { day: 'Wed', temp: 65 },
  { day: 'Thu', temp: 70 },
  { day: 'Fri', temp: 75 },
  { day: 'Sat', temp: 78 },
  { day: 'Sun', temp: 74 },
];

function tempColor(temp: number): string {
  if (temp >= 76) return HOT;
  if (temp >= 72) return WARM;
  if (temp >= 68) return ACCENT;
  return COOL;
}

function tempBarHeight(temp: number): number {
  const clamped = Math.max(60, Math.min(80, temp));
  return 4 + Math.round(((clamped - 60) / 20) * 16);
}

/* ── Main ──────────────────────────────────────────────────── */

export function WeatherDemoStory() {
  return (
    <Box style={{ width: '100%', height: '100%', padding: 16, gap: 12 }}>

      {/* ═══ ROW 1: Sun | Temperature | Stats ═══ */}
      <Box style={{
        flexDirection: 'row',
        gap: 20,
        flexGrow: 1,
        backgroundColor: BG_CARD,
        borderRadius: 12,
        padding: 20,
        borderWidth: 1,
        borderColor: BORDER,
      }}>

        {/* Column 1: Sun — explicit dimensions */}
        <Box style={{
          width: SUN_COLS * SUN_PX,
          height: SUN_ROWS * SUN_PX,
        }}>
          {SUN_GRID.map((row, r) => (
            <Box key={r} style={{ flexDirection: 'row' }}>
              {row.map((cell, c) => (
                <Box key={c} style={{
                  width: SUN_PX,
                  height: SUN_PX,
                  borderRadius: cell === 'core' ? 2 : cell === 'ray' ? 4 : 0,
                  backgroundColor: cell === 'core'
                    ? '#FFD93D'
                    : cell === 'ray'
                      ? '#FFA726'
                      : 'transparent',
                }} />
              ))}
            </Box>
          ))}
        </Box>

        {/* Column 2: Temperature + condition — takes remaining space */}
        <Box style={{ flexGrow: 1, gap: 4 }}>
          <Box style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E' }} />
            <Text style={{ color: DIM, fontSize: 12 }}>San Francisco, CA</Text>
          </Box>
          <Text style={{ color: '#FFFFFF', fontSize: 48, fontWeight: '700' }}>72°</Text>
          <Text style={{ color: WARM, fontSize: 16, fontWeight: '700' }}>Sunny</Text>
          <Text style={{ color: DIM, fontSize: 12 }}>Feels like 70°F</Text>
        </Box>

        {/* Column 3: Stats — explicit width so text doesn't wrap */}
        <Box style={{ width: 180, gap: 6 }}>
          <Box style={{ flexDirection: 'row', gap: 6 }}>
            <Text style={{ color: COOL, fontSize: 13, fontWeight: '700' }}>Humidity:</Text>
            <Text style={{ color: BRIGHT, fontSize: 13 }}>58%</Text>
          </Box>
          <Box style={{ flexDirection: 'row', gap: 6 }}>
            <Text style={{ color: ACCENT, fontSize: 13, fontWeight: '700' }}>Wind:</Text>
            <Text style={{ color: BRIGHT, fontSize: 13 }}>12 mph NW</Text>
          </Box>
          <Box style={{ flexDirection: 'row', gap: 6 }}>
            <Text style={{ color: MUTED, fontSize: 13, fontWeight: '700' }}>Pressure:</Text>
            <Text style={{ color: BRIGHT, fontSize: 13 }}>30.12 inHg</Text>
          </Box>
          <Box style={{ flexDirection: 'row', gap: 6 }}>
            <Text style={{ color: WARM, fontSize: 13, fontWeight: '700' }}>UV Index:</Text>
            <Text style={{ color: BRIGHT, fontSize: 13 }}>6 (High)</Text>
          </Box>
          <Box style={{ flexDirection: 'row', gap: 6 }}>
            <Text style={{ color: DIM, fontSize: 13, fontWeight: '700' }}>Visibility:</Text>
            <Text style={{ color: BRIGHT, fontSize: 13 }}>10 mi</Text>
          </Box>
        </Box>

      </Box>

      {/* ═══ ROW 2: Forecast | Cloud Cover ═══ */}
      <Box style={{ flexDirection: 'row', gap: 12, flexGrow: 1 }}>

        {/* Column 1: 7-Day Forecast — takes remaining space */}
        <Box style={{
          flexGrow: 1,
          gap: 10,
          backgroundColor: BG_CARD,
          borderRadius: 12,
          padding: 16,
          borderWidth: 1,
          borderColor: BORDER,
        }}>
          <Text style={{ color: BRIGHT, fontSize: 14, fontWeight: '700' }}>7-Day Forecast</Text>
          <Divider color={BORDER} />
          <Box style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            flexGrow: 1,
          }}>
            {FORECAST.map((f) => (
              <Box key={f.day} style={{ gap: 4, alignItems: 'center' }}>
                <Text style={{ color: DIM, fontSize: 10, fontWeight: '700' }}>{f.day}</Text>
                <Text style={{ color: tempColor(f.temp), fontSize: 13, fontWeight: '700' }}>
                  {f.temp}°
                </Text>
                <Box style={{
                  width: 16,
                  height: tempBarHeight(f.temp),
                  borderRadius: 3,
                  backgroundColor: tempColor(f.temp),
                }} />
              </Box>
            ))}
          </Box>
        </Box>

        {/* Column 2: Cloud Cover — explicit width for pixel art */}
        <Box style={{
          width: (CLOUD_COLS * CLOUD_PX) + 32,
          gap: 10,
          backgroundColor: BG_CARD,
          borderRadius: 12,
          padding: 16,
          borderWidth: 1,
          borderColor: BORDER,
        }}>
          <Text style={{ color: DIM, fontSize: 11, fontWeight: '700' }}>Cloud Cover</Text>
          <Box style={{
            width: CLOUD_COLS * CLOUD_PX,
            height: CLOUD_ROWS * CLOUD_PX,
          }}>
            {CLOUD_GRID.map((row, r) => (
              <Box key={r} style={{ flexDirection: 'row' }}>
                {row.map((filled, c) => (
                  <Box key={c} style={{
                    width: CLOUD_PX,
                    height: CLOUD_PX,
                    backgroundColor: filled ? CLOUD_COLORS[r] : 'transparent',
                  }} />
                ))}
              </Box>
            ))}
          </Box>
          <Box style={{ gap: 4 }}>
            <Box style={{ flexDirection: 'row', gap: 4 }}>
              <Text style={{ color: '#90A4AE', fontSize: 12, fontWeight: '700' }}>Coverage:</Text>
              <Text style={{ color: BRIGHT, fontSize: 12 }}>32%</Text>
            </Box>
            <Box style={{ flexDirection: 'row', gap: 4 }}>
              <Text style={{ color: '#90A4AE', fontSize: 12, fontWeight: '700' }}>Type:</Text>
              <Text style={{ color: BRIGHT, fontSize: 12 }}>Cumulus</Text>
            </Box>
            <Box style={{ flexDirection: 'row', gap: 4 }}>
              <Text style={{ color: '#90A4AE', fontSize: 12, fontWeight: '700' }}>Altitude:</Text>
              <Text style={{ color: BRIGHT, fontSize: 12 }}>6,500 ft</Text>
            </Box>
          </Box>
        </Box>

      </Box>

      {/* ═══ Footer: palette + timestamp ═══ */}
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box style={{ flexDirection: 'row', gap: 3 }}>
          {[COOL, ACCENT, '#3B82F6', WARM, HOT, '#22C55E', MUTED, BG_CARD].map((color, i) => (
            <Box key={i} style={{ width: 28, height: 10, backgroundColor: color, borderRadius: 2 }} />
          ))}
        </Box>
        <Text style={{ color: MUTED, fontSize: 10 }}>Last updated: 2 min ago</Text>
      </Box>

    </Box>
  );
}
