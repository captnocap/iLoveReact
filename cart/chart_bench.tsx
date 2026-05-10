// chart_bench — A/B/C/D comparison of line-chart rendering paths.
//
// Single line chart, N data points, four render modes:
//
//   PATH     — <Graph.Path d="M ... L ... L ..."> baseline. Engine re-parses
//              the d-string + flattens curves every frame. Today's hot path.
//
//   PATH+SS  — same wrapped in <StaticSurface>. Cache wins big when the
//              chart is idle; collapses to PATH speed under ANIM (data
//              changes per frame → cache invalidates per frame).
//
//   POLYLINE — <Graph.Polyline points={[x,y,…]}>. New primitive: cart
//              hands a raw point array, engine parses ONCE at update time
//              and emits a batched capsule SDF per segment every paint.
//              No d-string, no bezier flattening, no per-frame parse.
//              The chart-side analog of the SDF icon win.
//
//   SHADER   — single <Effect> node, WGSL fragment computes per-pixel
//              distance to nearest line segment from a data array baked
//              into the shader source. ZERO nodes per data point —
//              everything happens on the GPU. The "icon SDF for charts"
//              equivalent: shared GPU resource, all "instances" collapse
//              to one quad. Caveat: data is currently inlined in the
//              shader source (works for static charts; live data needs a
//              storage-buffer upload, deferred).
//
// Toggles:
//   N      — 100 / 500 / 1000 / 5000 data points
//   ANIM   — drift the data per-tick (each value gets a phase-shifted sine
//            ride). Forces real per-frame work; cache-bandaids collapse.
//
// FPS / paint µs come from the engine telemetry overlay.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect, Graph, Pressable, StaticSurface, Text } from '@reactjit/runtime/primitives';

const TICK_MS = 16;
const COUNTS = [100, 500, 1000, 5000];
const GRID_COUNTS = [1, 4, 10, 25, 50, 100];
const CHART_W = 280;   // smaller so a grid of charts fits
const CHART_H = 140;
const STROKE = 2;

const COLOR_BG = '#0b1018';
const COLOR_INK = '#e8eef8';
const COLOR_DIM = '#7f93b1';
const COLOR_PLOT_BG = '#0a0a0d';
const COLOR_LINE = '#3da9ff';
const COLOR_GREEN = '#34d399';
const COLOR_AMBER = '#ff9f43';
const COLOR_PINK = '#f472b6';
const COLOR_YELLOW = '#facc15';

type Mode = 'path' | 'path-ss' | 'polyline' | 'shader';

// Generate a sine-of-sines waveform: looks like a chart, varies per index.
// `phase` distinguishes parallel charts so each grid cell has its own
// geometry (no dedup tricks possible on the engine side).
function buildSeries(n: number, tick: number, phase: number): number[] {
  const out = new Array<number>(n);
  const ph = phase * 0.41;
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    const a = Math.sin(t * 6.28 + tick * 0.05 + ph) * 0.35;
    const b = Math.sin(t * 17.0 + tick * 0.07 + ph * 1.7) * 0.18;
    const c = Math.sin(t * 3.0 + tick * 0.03 + ph * 0.7) * 0.20;
    out[i] = 0.5 + a + b + c;
  }
  return out;
}

// Map normalized values to pixel coords. Returns flat {x0,y0,x1,y1,…}
// suitable for <Graph.Polyline> AND for the d-string builder.
function pointsFromSeries(series: number[]): number[] {
  const n = series.length;
  const out = new Array<number>(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = (i / Math.max(1, n - 1)) * CHART_W;
    out[i * 2 + 1] = (1 - series[i]) * CHART_H;
  }
  return out;
}

function pointsToD(pts: number[]): string {
  if (pts.length < 4) return '';
  let out = `M ${pts[0]} ${pts[1]}`;
  for (let i = 2; i + 1 < pts.length; i += 2) out += ` L ${pts[i]} ${pts[i + 1]}`;
  return out;
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

function ChartFrame({ children }: { children: any }) {
  return (
    <Box style={{
      width: CHART_W, height: CHART_H,
      backgroundColor: COLOR_PLOT_BG,
      borderWidth: 1, borderColor: '#1d2c45',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {children}
    </Box>
  );
}

function PathChart({ pts, color, ss }: { pts: number[]; color: string; ss: boolean }) {
  const d = useMemo(() => pointsToD(pts), [pts]);
  const inner = (
    <Graph style={{ width: CHART_W, height: CHART_H }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
      <Graph.Path d={d} stroke={color} strokeWidth={STROKE} fill="none" />
    </Graph>
  );
  if (!ss) return <ChartFrame>{inner}</ChartFrame>;
  // staticKey changes every time data changes → cache invalidates with
  // ANIM ON, holds while IDLE. That's the band-aid behavior we're testing.
  return (
    <ChartFrame>
      <StaticSurface staticKey={`ss-${pts.length}-${pts[1] | 0}`}>{inner}</StaticSurface>
    </ChartFrame>
  );
}

function PolylineChart({ pts, color }: { pts: number[]; color: string }) {
  return (
    <ChartFrame>
      <Graph style={{ width: CHART_W, height: CHART_H }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
        <Graph.Polyline points={pts} stroke={color} strokeWidth={STROKE} />
      </Graph>
    </ChartFrame>
  );
}

// Static shader source — N is the only thing that changes the WGSL text
// (so the source string is stable when only data values drift). Data lives
// in a storage buffer at @group(0) @binding(1), uploaded once per change.
// Per-fragment work is O(1): look up segment by uv.x → read two adjacent
// y values from the buffer → distance to that segment → smoothstep stroke.
//
// Distance is computed in PIXEL space, not UV — UV is anisotropic
// (1100×320 chart) so a "distance of 0.01" means different things in x vs y.
// At low N where segments are wide, that anisotropy made segments look
// chunky/broken. Pixel-space distance fixes the aspect-ratio bug.
function ShaderChart({ pts, color }: { pts: number[]; color: string }) {
  const n = pts.length / 2;

  const wgsl = useMemo(() => {
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    return `
@group(0) @binding(1) var<storage, read> ys: array<f32>;
const N: u32 = ${n}u;
const CHART_W: f32 = ${CHART_W.toFixed(1)};
const CHART_H: f32 = ${CHART_H.toFixed(1)};
const STROKE_HALF: f32 = ${(STROKE * 0.5).toFixed(4)};
const COLOR: vec3f = vec3f(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)});

fn segDist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  // Work in pixel space so distances are isotropic.
  let p_px = vec2f(in.uv.x * CHART_W, in.uv.y * CHART_H);
  let f = in.uv.x * f32(N - 1u);
  let i = u32(clamp(floor(f), 0.0, f32(N - 2u)));
  let xa = f32(i)     / f32(N - 1u) * CHART_W;
  let xb = f32(i + 1u) / f32(N - 1u) * CHART_W;
  // Storage-buffer reads: ys[] holds normalized y in [0..1].
  let ya = ys[i] * CHART_H;
  let yb = ys[i + 1u] * CHART_H;
  let d = segDist(p_px, vec2f(xa, ya), vec2f(xb, yb));
  let aa = fwidth(d) * 0.7;
  let alpha = 1.0 - smoothstep(STROKE_HALF - aa, STROKE_HALF + aa, d);
  if (alpha <= 0.001) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  return vec4f(COLOR * alpha, alpha);
}
`;
  // Source depends only on N + color — NOT on the y values. Drift the data
  // and the WGSL string stays identical → no pipeline recompile.
  }, [n, color]);

  // Pack just the y values into a flat array; the shader knows x positions
  // come from the index. Half the upload size of (x, y) pairs.
  const ys = useMemo(() => {
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = pts[i * 2 + 1] / CHART_H;
    return out;
  }, [pts, n]);

  return (
    <ChartFrame>
      <Effect shader={wgsl} data={ys} style={{ flexGrow: 1 }} />
    </ChartFrame>
  );
}

// Each grid cell is its own chart with a unique phase offset so the engine
// can't dedup geometry across cells. Memoizing per-cell keeps React out of
// the hot path — the only thing that changes per frame is `tick`.
const ChartCell = memo(function ChartCell({
  mode, count, tick, phase,
}: {
  mode: Mode; count: number; tick: number; phase: number;
}) {
  const series = useMemo(() => buildSeries(count, tick, phase), [count, tick, phase]);
  const pts = useMemo(() => pointsFromSeries(series), [series]);
  if (mode === 'path')     return <PathChart pts={pts} color={COLOR_LINE} ss={false} />;
  if (mode === 'path-ss')  return <PathChart pts={pts} color={COLOR_LINE} ss={true} />;
  if (mode === 'polyline') return <PolylineChart pts={pts} color={COLOR_LINE} />;
  return <ShaderChart pts={pts} color={COLOR_LINE} />;
});

export default function ChartBench() {
  const [count, setCount] = useState(500);
  const [mode, setMode] = useState<Mode>('path');
  const [grid, setGrid] = useState(10);
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

  const cells = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < grid; i++) out.push(i);
    return out;
  }, [grid]);

  const status =
    mode === 'path'     ? { label: 'PATH',     color: COLOR_AMBER } :
    mode === 'path-ss'  ? { label: 'PATH+SS',  color: COLOR_PINK } :
    mode === 'polyline' ? { label: 'POLYLINE', color: COLOR_GREEN } :
                          { label: 'SHADER',   color: COLOR_YELLOW };

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: COLOR_BG,
      paddingTop: 12, paddingLeft: 12, paddingRight: 12, paddingBottom: 12,
      flexDirection: 'column', gap: 8,
    }}>
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 14, color: COLOR_INK, fontWeight: 'bold' }}>
          Chart-bench · Path vs Path+SS vs Polyline vs Shader
        </Text>
        <Box style={{ flexDirection: 'row', gap: 14 }}>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`charts ${grid} × ${count}pts = ${grid * count}`}</Text>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`renders/s ${diag.rps}`}</Text>
          <Text style={{ fontSize: 11, color: anim ? COLOR_GREEN : COLOR_DIM }}>{anim ? 'ANIM' : 'IDLE'}</Text>
          <Text style={{ fontSize: 11, color: status.color, fontWeight: 'bold' }}>{status.label}</Text>
        </Box>
      </Box>

      {/* Mode + Anim row */}
      <Box style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Toggle label="PATH"     on={mode === 'path'}     onPress={() => setMode('path')}     accent={COLOR_AMBER} />
        <Toggle label="PATH+SS"  on={mode === 'path-ss'}  onPress={() => setMode('path-ss')}  accent={COLOR_PINK} />
        <Toggle label="POLYLINE" on={mode === 'polyline'} onPress={() => setMode('polyline')} accent={COLOR_GREEN} />
        <Toggle label="SHADER"   on={mode === 'shader'}   onPress={() => setMode('shader')}   accent={COLOR_YELLOW} />
        <Box style={{ width: 12 }} />
        <Toggle label={anim ? 'ANIM ON' : 'ANIM OFF'} on={anim} onPress={() => setAnim((v) => !v)} accent={COLOR_LINE} />
      </Box>

      {/* Grid + points knobs */}
      <Box style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 11, color: COLOR_DIM, paddingTop: 8, paddingRight: 4 }}>charts</Text>
        {GRID_COUNTS.map((g) => (
          <Toggle key={`g-${g}`} label={String(g)} on={g === grid} onPress={() => setGrid(g)} accent={COLOR_INK} />
        ))}
        <Box style={{ width: 12 }} />
        <Text style={{ fontSize: 11, color: COLOR_DIM, paddingTop: 8, paddingRight: 4 }}>pts/chart</Text>
        {COUNTS.map((c) => (
          <Toggle key={`c-${c}`} label={String(c)} on={c === count} onPress={() => setCount(c)} accent={COLOR_LINE} />
        ))}
      </Box>

      <Text style={{ fontSize: 10, color: COLOR_DIM }}>
        ANIM ON: every chart's data drifts every frame. With charts={grid} and pts={count}, that's {grid * count} animated values per frame. Read paint µs / FPS from the telemetry overlay.
      </Text>

      {/* Chart grid */}
      <Box style={{
        flexGrow: 1, flexDirection: 'row', flexWrap: 'wrap',
        alignContent: 'flex-start', gap: 6,
      }}>
        {cells.map((i) => (
          <Box key={i} style={{ flexShrink: 0, flexGrow: 0 }}>
            <ChartCell mode={mode} count={count} tick={anim ? tick : 0} phase={i} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
