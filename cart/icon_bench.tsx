// icon_bench — A/B/C comparison of icon rendering paths.
//
// Three modes, identical visual content:
//
//   SDF    — pre-baked atlas, one batched instanced quad per frame regardless
//            of icon count. Goes through runtime/icons/Icon.tsx's atlas fast
//            path → framework/gpu/sdf_icons.zig.
//
//   PATH   — current <Graph.Path> renderer. Each icon parses its `d` string,
//            flattens beziers, queues curve segments. Today's hot path.
//
//   PATH+SS — PATH wrapped in <StaticSurface> per-cell. Today's band-aid:
//             paint cost collapses to a GPU-cached quad as long as nothing
//             changes in that cell. ANIM ON forces re-paint and busts the
//             cache, so the saving evaporates.
//
// Toggles:
//   COUNT — 50 / 200 / 500 / 1000 / 2000 icons
//   ANIM  — pulse size+opacity per-icon at 60Hz so re-paint can't be elided
//
// FPS / paint µs come from the engine telemetry overlay (top-left). With ANIM
// ON at 1000+ icons, SDF should stay smooth while PATH and PATH+SS choke.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Graph, Pressable, StaticSurface, Text } from '@reactjit/runtime/primitives';
import { Icon } from '@reactjit/runtime/icons/Icon';
import { registerIcons } from '@reactjit/runtime/icons/registry';
import * as AllIcons from '@reactjit/runtime/icons/icons';

registerIcons({
  Heart: (AllIcons as any).Heart,
  Search: (AllIcons as any).Search,
  ArrowRight: (AllIcons as any).ArrowRight,
  Plus: (AllIcons as any).Plus,
  X: (AllIcons as any).X,
  Settings: (AllIcons as any).Settings,
  Star: (AllIcons as any).Star,
  Home: (AllIcons as any).Home,
  Eye: (AllIcons as any).Eye,
  User: (AllIcons as any).User,
  Bell: (AllIcons as any).Bell,
  Bookmark: (AllIcons as any).Bookmark,
});

const ICONS = [
  'Heart', 'Search', 'ArrowRight', 'Plus', 'X', 'Settings',
  'Star', 'Home', 'Eye', 'User', 'Bell', 'Bookmark',
];

const COUNTS = [50, 200, 500, 1000, 2000];
const TICK_MS = 16;
const ICON_SIZE = 24;
const COLOR_BG = '#0b1018';
const COLOR_INK = '#e8eef8';
const COLOR_DIM = '#7f93b1';
const COLOR_GREEN = '#34d399';
const COLOR_BLUE = '#3da9ff';
const COLOR_AMBER = '#ff9f43';
const COLOR_PINK = '#f472b6';

type Mode = 'sdf' | 'path' | 'path-ss';

// ── HSL → hex (parseColor in the engine accepts hex/rgb/named, NOT hsl) ──
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const x = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return Math.round(255 * x).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ── Path-mode icon — bypasses Icon.tsx's atlas fast path so we measure the
// pure <Graph.Path> render cost. Identical visual + sizing.
const HALF = 12;
function pathToD(poly: number[]): string {
  if (poly.length < 4) return '';
  let out = `M ${poly[0] - HALF},${poly[1] - HALF}`;
  for (let i = 2; i < poly.length; i += 2) {
    out += ` L ${poly[i] - HALF},${poly[i + 1] - HALF}`;
  }
  return out;
}

function PathIcon({ name, color, size }: { name: string; color: string; size: number }) {
  const data = (AllIcons as any)[name] as number[][] | undefined;
  if (!data) return <Box style={{ width: size, height: size }} />;
  return (
    <Box style={{ width: size, height: size, overflow: 'hidden' }}>
      <Graph
        style={{ width: size, height: size }}
        viewX={0}
        viewY={0}
        viewZoom={size / 24}
      >
        {data.map((poly, i) => (
          <Graph.Path key={i} d={pathToD(poly)} stroke={color} strokeWidth={2} fill="none" />
        ))}
      </Graph>
    </Box>
  );
}

function Toggle({ label, on, onPress, accent }: { label: string; on: boolean; onPress: () => void; accent: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6,
        borderRadius: 6,
        backgroundColor: on ? accent : '#1a2333',
        borderWidth: 1,
        borderColor: on ? accent : '#243044',
      }}
    >
      <Text style={{ fontSize: 11, color: on ? COLOR_BG : COLOR_INK, fontWeight: 'bold' }}>{label}</Text>
    </Pressable>
  );
}

// ── Single tile renderer per mode. Wrapped in <StaticSurface> for path-ss
// only — the cache collapses to a GPU quad while nothing in the cell changes,
// then re-bakes the moment ANIM forces a prop update.
function Tile({ mode, name, color, size }: { mode: Mode; name: string; color: string; size: number }) {
  if (mode === 'sdf') return <Icon name={name} size={size} color={color} />;
  if (mode === 'path') return <PathIcon name={name} color={color} size={size} />;
  return (
    <StaticSurface staticKey={`${name}-${color}-${size}`}>
      <PathIcon name={name} color={color} size={size} />
    </StaticSurface>
  );
}

export default function IconBench() {
  const [count, setCount] = useState(500);
  const [mode, setMode] = useState<Mode>('sdf');
  const [anim, setAnim] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!anim) return;
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, [anim]);

  const renderCount = useRef(0);
  renderCount.current += 1;
  const [diag, setDiag] = useState({ rps: 0 });
  useEffect(() => {
    let last = renderCount.current;
    const id = setInterval(() => {
      const r = renderCount.current;
      setDiag({ rps: (r - last) * 2 });
      last = r;
    }, 500);
    return () => clearInterval(id);
  }, []);

  const indices = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < count; i++) arr.push(i);
    return arr;
  }, [count]);

  // Pre-compute the ICONS color rotation (one hex per index) so we don't
  // recompute hslToHex × 2000 in render. When ANIM is on, the carousel of
  // colors shifts by `tick`, every cell gets a new color every frame.
  const palette = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 360; i++) out.push(hslToHex(i, 70, 70));
    return out;
  }, []);

  const status =
    mode === 'sdf' ? { label: 'SDF', color: COLOR_GREEN } :
    mode === 'path' ? { label: 'PATH', color: COLOR_AMBER } :
    { label: 'PATH+SS', color: COLOR_PINK };

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: COLOR_BG,
      paddingTop: 16, paddingLeft: 16, paddingRight: 16, paddingBottom: 16,
      flexDirection: 'column', gap: 10,
    }}>
      {/* Header */}
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 16, color: COLOR_INK, fontWeight: 'bold' }}>
          Icon-bench · SDF vs Path vs Path+StaticSurface
        </Text>
        <Box style={{ flexDirection: 'row', gap: 16 }}>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`icons ${count}`}</Text>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`renders/s ${diag.rps}`}</Text>
          <Text style={{ fontSize: 11, color: anim ? COLOR_GREEN : COLOR_DIM }}>{anim ? 'ANIM' : 'IDLE'}</Text>
          <Text style={{ fontSize: 11, color: status.color, fontWeight: 'bold' }}>{status.label}</Text>
        </Box>
      </Box>

      {/* Toggles */}
      <Box style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Toggle label="SDF" on={mode === 'sdf'} onPress={() => setMode('sdf')} accent={COLOR_GREEN} />
        <Toggle label="PATH" on={mode === 'path'} onPress={() => setMode('path')} accent={COLOR_AMBER} />
        <Toggle label="PATH+SS" on={mode === 'path-ss'} onPress={() => setMode('path-ss')} accent={COLOR_PINK} />
        <Box style={{ width: 12 }} />
        <Toggle label={anim ? 'ANIM ON' : 'ANIM OFF'} on={anim} onPress={() => setAnim((v) => !v)} accent={COLOR_BLUE} />
        <Box style={{ width: 12 }} />
        {COUNTS.map((c) => (
          <Toggle key={c} label={String(c)} on={c === count} onPress={() => setCount(c)} accent={COLOR_BLUE} />
        ))}
      </Box>

      {/* Helper text */}
      <Text style={{ fontSize: 10, color: COLOR_DIM }}>
        ANIM ON: every icon's hue shifts every frame (visible color rotation) and tile size pulses ±20% so re-paint can't be elided. Read paint µs / FPS from the telemetry overlay.
      </Text>

      {/* Icon grid */}
      <Box style={{ flexGrow: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start' }}>
        {indices.map((i) => {
          const hue = (i * 19 + (anim ? tick : 0)) % 360;
          const color = palette[hue];
          // Pulse the tile size 24 ± 4 over a ~40-frame cycle when ANIM is on,
          // so the visual change is unmistakable (color alone is subtle).
          const pulse = anim
            ? 1.0 + 0.18 * Math.sin((i + tick) * 0.31)
            : 1.0;
          const sz = Math.round(ICON_SIZE * pulse);
          return (
            <Box
              key={i}
              style={{
                width: ICON_SIZE + 4, height: ICON_SIZE + 4,
                flexShrink: 0, flexGrow: 0,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Tile mode={mode} name={ICONS[i % ICONS.length]} color={color} size={sz} />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
