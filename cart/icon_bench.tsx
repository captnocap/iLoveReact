// icon_bench — A/B comparison of icon rendering paths.
//
// Two modes, identical visual content:
//
//   SDF — pre-baked atlas, one batched instanced quad per frame regardless of
//         icon count. Goes through runtime/icons/Icon.tsx's atlas fast path.
//
//   PATH — current <Graph.Path> renderer. Each icon parses its `d` string,
//          flattens beziers, queues curve segments. Today's hot path.
//
// Toggles:
//   COUNT — 50 / 200 / 500 / 1000 / 2000 icons
//   MODE  — SDF vs PATH
//   ANIM  — pulse opacity per-icon (forces re-paint every tick)
//
// Read FPS / paint µs from the engine telemetry overlay (top-left).
//
// Both modes render the SAME 12 icon names in rotation, so geometry and
// pixel coverage are equivalent — the only differing factor is the render
// path.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, StaticSurface, Text } from '@reactjit/runtime/primitives';
import { Icon } from '@reactjit/runtime/icons/Icon';
import { Graph } from '@reactjit/runtime/primitives';
import { registerIcons } from '@reactjit/runtime/icons/registry';
import * as AllIcons from '@reactjit/runtime/icons/icons';

// Register the 12 baked icons by name so <Icon name="..."> works in the
// path-renderer mode (the atlas case routes by exact name without registry).
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

type Mode = 'sdf' | 'path';

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

export default function IconBench() {
  const [count, setCount] = useState(500);
  const [mode, setMode] = useState<Mode>('sdf');
  const [anim, setAnim] = useState(false);
  const [tick, setTick] = useState(0);

  // Pulse a frame counter at 60 Hz when ANIM is on. Each icon multiplies
  // the counter by its index for varying per-icon opacity, forcing real
  // per-frame work in both render paths (SDF and Path).
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
          Icon-bench · SDF vs Path
        </Text>
        <Box style={{ flexDirection: 'row', gap: 16 }}>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`icons ${count}`}</Text>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`renders/s ${diag.rps}`}</Text>
          <Text style={{ fontSize: 11, color: anim ? COLOR_GREEN : COLOR_DIM }}>{anim ? 'ANIM' : 'IDLE'}</Text>
          <Text style={{ fontSize: 11, color: mode === 'sdf' ? COLOR_GREEN : COLOR_AMBER, fontWeight: 'bold' }}>
            {mode === 'sdf' ? 'SDF' : 'PATH'}
          </Text>
        </Box>
      </Box>

      {/* Toggles */}
      <Box style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Toggle label="SDF" on={mode === 'sdf'} onPress={() => setMode('sdf')} accent={COLOR_GREEN} />
        <Toggle label="PATH" on={mode === 'path'} onPress={() => setMode('path')} accent={COLOR_AMBER} />
        <Box style={{ width: 12 }} />
        <Toggle label={anim ? 'ANIM ON' : 'ANIM OFF'} on={anim} onPress={() => setAnim((v) => !v)} accent={COLOR_BLUE} />
        <Box style={{ width: 12 }} />
        {COUNTS.map((c) => (
          <Toggle key={c} label={String(c)} on={c === count} onPress={() => setCount(c)} accent={COLOR_BLUE} />
        ))}
      </Box>

      {/* Icon grid */}
      <Box style={{ flexGrow: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start' }}>
        {indices.map((i) => {
          const name = ICONS[i % ICONS.length];
          // Tint cycles + pulses with `tick` so memoization can't elide work.
          const base = (i + (anim ? tick : 0)) % 360;
          const color = `hsl(${base}, 70%, 70%)`;
          return (
            <Box key={i} style={{ width: ICON_SIZE + 4, height: ICON_SIZE + 4, alignItems: 'center', justifyContent: 'center' }}>
              {mode === 'sdf'
                ? <Icon name={name} size={ICON_SIZE} color={color} />
                : <PathIcon name={name} size={ICON_SIZE} color={color} />}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
