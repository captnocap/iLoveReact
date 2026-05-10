// EasingsTweenArch — three-architecture comparison of N animated tiles.
// Sibling of the Easings 31-curve matrix: same architecture family
// (host-driven vs JS loop) but sweeps tile COUNT (50/200/500/1000)
// instead of curves, so the cost-vs-scale shape is visible.
//
//   JS_LOOP   : per-tile useEffect + RAF + JS easing math + setState.
//   ZIG_MATH  : same loop pattern, but easing eval crosses V8↔Zig via
//               math.smootherstep per tile per frame (mirrors what
//               easings-zig-math does today — math in Zig, loop in JS).
//   ZIG_FLOW  : no JS loop. Each tile sets borderDashOn / borderDashOff /
//               borderFlowSpeed once; the engine's border_dash module
//               advances phase Zig-side every frame. Stand-in for the
//               perf shape a real <Tween prop="opacity"> would have.
//
// Toggle MODE × COUNT and read fps/paint from the dev panel.

import { useEffect, useMemo, useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/runtime/primitives';
import { easeOutCubic } from '@reactjit/runtime/easing';
import { math } from '@reactjit/runtime/hooks/math';

const COUNTS = [50, 200, 500, 1000];
type Mode = 'js_loop' | 'zig_math' | 'zig_flow';

const TILE_W = 28;
const TILE_H = 28;
const TILE_GAP = 4;

const COLOR_BG = '#050b16';
const COLOR_INK = '#e8eef8';
const COLOR_DIM = '#92a8c4';
const COLOR_BORDER = '#1d2c45';
const COLOR_TILE = '#3a78c8';

function TileJsLoop({ phaseOffset }: { phaseOffset: number }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      const u = ((elapsed + phaseOffset) % 2) / 2;
      const eased = easeOutCubic(u < 0.5 ? u * 2 : (1 - u) * 2);
      setT(eased);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phaseOffset]);
  return (
    <Box
      style={{
        width: TILE_W,
        height: TILE_H,
        marginRight: TILE_GAP,
        marginBottom: TILE_GAP,
        backgroundColor: COLOR_TILE,
        opacity: 0.2 + t * 0.8,
      }}
    />
  );
}

function TileZigMath({ phaseOffset }: { phaseOffset: number }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      const u = ((elapsed + phaseOffset) % 2) / 2;
      const folded = u < 0.5 ? u * 2 : (1 - u) * 2;
      const eased = math.smootherstep(0, 1, folded);
      setT(eased);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phaseOffset]);
  return (
    <Box
      style={{
        width: TILE_W,
        height: TILE_H,
        marginRight: TILE_GAP,
        marginBottom: TILE_GAP,
        backgroundColor: COLOR_TILE,
        opacity: 0.2 + t * 0.8,
      }}
    />
  );
}

function TileZigFlow({ phaseOffset }: { phaseOffset: number }) {
  const speed = 30 + ((phaseOffset * 4) % 20);
  return (
    <Box
      style={{
        width: TILE_W,
        height: TILE_H,
        marginRight: TILE_GAP,
        marginBottom: TILE_GAP,
        backgroundColor: COLOR_TILE,
        borderWidth: 1,
        borderColor: COLOR_INK,
        borderDashOn: 4,
        borderDashOff: 3,
        borderFlowSpeed: speed,
      } as any}
    />
  );
}

function Toggle({ label, on, onPress, accent }: { label: string; on: boolean; onPress: () => void; accent: string }) {
  return (
    <Pressable onPress={onPress}>
      <Box
        style={{
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 6,
          paddingBottom: 6,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: on ? accent : '#2a2a2e',
          backgroundColor: on ? '#1a1a1d' : '#121215',
        }}
      >
        <Text style={{ fontSize: 11, color: on ? accent : '#bdbdc4' }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

export function EasingsTweenArch() {
  const [count, setCount] = useState(50);
  const [mode, setMode] = useState<Mode>('js_loop');
  const tiles = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < count; i++) arr.push(i);
    return arr;
  }, [count]);

  const Tile = mode === 'js_loop' ? TileJsLoop : mode === 'zig_math' ? TileZigMath : TileZigFlow;

  return (
    <Box
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: COLOR_BG,
        paddingTop: 14,
        paddingLeft: 14,
        paddingRight: 14,
        paddingBottom: 14,
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 14, color: COLOR_INK, fontWeight: 'bold' }}>
          Tween-arch · 3 architectures × 4 scales
        </Text>
        <Box style={{ flexDirection: 'row', gap: 14 }}>
          <Text style={{ fontSize: 10, color: COLOR_DIM }}>{`mode ${mode}`}</Text>
          <Text style={{ fontSize: 10, color: COLOR_DIM }}>{`tiles ${count}`}</Text>
        </Box>
      </Box>

      <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Toggle label="JS_LOOP" on={mode === 'js_loop'} onPress={() => setMode('js_loop')} accent="#ff7a3d" />
        <Toggle label="ZIG_MATH" on={mode === 'zig_math'} onPress={() => setMode('zig_math')} accent="#34d399" />
        <Toggle label="ZIG_FLOW" on={mode === 'zig_flow'} onPress={() => setMode('zig_flow')} accent="#facc15" />
        <Box style={{ width: 10 }} />
        {COUNTS.map((c) => (
          <Toggle key={c} label={String(c)} on={c === count} onPress={() => setCount(c)} accent="#3da9ff" />
        ))}
      </Box>

      <Box
        style={{
          flexGrow: 1,
          backgroundColor: '#0a0a0d',
          borderWidth: 1,
          borderColor: COLOR_BORDER,
          borderRadius: 6,
          padding: 6,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignContent: 'flex-start',
          overflow: 'hidden',
        }}
      >
        {tiles.map((i) => (
          <Tile key={i} phaseOffset={i * 0.07} />
        ))}
      </Box>
    </Box>
  );
}
