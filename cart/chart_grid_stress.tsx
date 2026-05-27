// chart_grid_stress -- benchmark: ONE-FX cell-routing X N-charts X
// storage-buffer sparklines. Cross of cart/card_stress.tsx ONE-FX
// (one Effect renders many cells via floor(px/stride) routing) and
// cart/chart_bench.tsx SHADER mode (per-chart series via storage buffer).
//
// Three modes side-by-side at 100 / 250 / 500 / 1000 charts:
//
//   ONE-FX   : 1 <Effect>. Shader does cell routing AND segment math.
//              Storage buffer = [hovered_idx, ys[0..N*S]] flat. One draw
//              call, one pipeline, one upload per tick. React tree is
//              just an invisible hit-zone overlay (optionally off).
//   EACH-FX  : N <Effect>. Each cell renders its own chart_bench-style
//              shader, with its own SAMPLES-float storage buffer. One
//              shared pipeline (source-hash dedup), N instance binds.
//              React renders one component per chart per tick.
//   POLYLINE : N <Graph.Polyline>. Per-segment capsule SDFs from
//              framework/gpu/capsules.zig -- proven non-shader baseline.
//              Cart hands raw point array; engine batches capsules.
//
// Storage layout for ONE-FX (flat f32):
//   [0]                        hovered_idx (-1 if none)
//   [1 + c*SAMPLES + i]        ys[i] for chart c (in [0..1])
//
// Toggles:
//   N        : 100 / 250 / 500 / 1000
//   SAMPLES  : 16 / 32 / 64 / 128
//   MODE     : one-fx / each-fx / polyline
//   ANIM     : drift each series per tick (phase-shifted sine of sines)
//   HOVER-GLOW: ONE-FX only -- does the i32(ys[0]) read + branch cost?
//                When off, shader is rebuilt with no ys[0] reference.
//   OVERLAY  : skip the hit-zone overlay entirely (isolates shader cost)
//
// Stats overlay shows: N x SAMPLES total floats, KB/frame upload,
// React renders/sec, anim/idle. Read paint µs + FPS from engine telemetry.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect, Graph, Pressable, ScrollView, Text } from '@reactjit/runtime/primitives';

const COLOR_BG = '#050b16';
const COLOR_INK = '#e8eef8';
const COLOR_DIM = '#92a8c4';
const COLOR_BORDER = '#1d2c45';
const COLOR_BORDER_HOVER = '#facc15';

const CHART_W = 72;
const CHART_H = 36;
const CHART_GAP = 3;
const GRID_PAD = 6;
const COLS = 16;
const STROKE = 1.5;
const TICK_MS = 16;

const COUNTS = [100, 250, 500, 1000];
const SAMPLES_LIST = [16, 32, 64, 128];

type Mode = 'one-fx' | 'each-fx' | 'polyline';

// chart_bench's sine-of-sines waveform. Phase distinguishes parallel
// charts so the engine can't dedupe geometry across cells.
function buildSeries(n: number, tick: number, phase: number): number[] {
  const out = new Array<number>(n);
  const ph = phase * 0.41;
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    const a = Math.sin(t * 6.28 + tick * 0.05 + ph) * 0.30;
    const b = Math.sin(t * 17.0 + tick * 0.07 + ph * 1.7) * 0.14;
    const c = Math.sin(t * 3.0 + tick * 0.03 + ph * 0.7) * 0.16;
    out[i] = 0.5 + a + b + c;
  }
  return out;
}

// ─── ONE-FX shader: cell-route -> segment math -> AA. Constants baked. ─
function buildOneFxShader(opts: { rows: number; numCharts: number; samples: number; hoverGlow: boolean }): string {
  const { rows, numCharts, samples, hoverGlow } = opts;
  return `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

const COLS: f32 = ${COLS.toFixed(1)};
const ROWS: f32 = ${rows.toFixed(1)};
const NUM_CHARTS: u32 = ${numCharts}u;
const SAMPLES: u32 = ${samples}u;
const CHART_W: f32 = ${CHART_W.toFixed(1)};
const CHART_H: f32 = ${CHART_H.toFixed(1)};
const GAP: f32 = ${CHART_GAP.toFixed(1)};
const PAD: f32 = ${GRID_PAD.toFixed(1)};
const STROKE_HALF: f32 = ${(STROKE * 0.5).toFixed(4)};
const HOVER_GLOW: bool = ${hoverGlow ? 'true' : 'false'};

fn segDist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  // Pixel-space coords relative to grid origin.
  let px = in.uv.x * U.size_w - PAD;
  let py = in.uv.y * U.size_h - PAD;
  if (px < 0.0 || py < 0.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let stride_x = CHART_W + GAP;
  let stride_y = CHART_H + GAP;
  let col = floor(px / stride_x);
  let row = floor(py / stride_y);
  if (col >= COLS || row >= ROWS) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let chart_idx_f = row * COLS + col;
  if (u32(chart_idx_f) >= NUM_CHARTS) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let chart_idx = u32(chart_idx_f);

  // Local coords within the cell.
  let cx_in = px - col * stride_x;
  let cy_in = py - row * stride_y;
  if (cx_in > CHART_W || cy_in > CHART_H) { return vec4f(0.0, 0.0, 0.0, 0.0); }

  // Segment lookup -- chart_bench style, but indexed into the per-chart
  // slice of the shared storage buffer.
  let f = (cx_in / CHART_W) * f32(SAMPLES - 1u);
  let i = u32(clamp(floor(f), 0.0, f32(SAMPLES - 2u)));
  let base = 1u + chart_idx * SAMPLES;
  let xa = f32(i)       / f32(SAMPLES - 1u) * CHART_W;
  let xb = f32(i + 1u)  / f32(SAMPLES - 1u) * CHART_W;
  let ya = ys[base + i]      * CHART_H;
  let yb = ys[base + i + 1u] * CHART_H;
  let d = segDist(vec2f(cx_in, cy_in), vec2f(xa, ya), vec2f(xb, yb));
  let aa = max(fwidth(d) * 0.5, 0.5);
  let alpha = 1.0 - smoothstep(STROKE_HALF - aa, STROKE_HALF + aa, d);
  if (alpha <= 0.001) { return vec4f(0.0, 0.0, 0.0, 0.0); }

  // Optional hover-glow path: const-true branch reads ys[0]; const-false
  // branch is dead-code-eliminated and ys[0] is never sampled.
  var color = vec3f(0.24, 0.66, 1.00);
  if (HOVER_GLOW) {
    let hover_idx = i32(ys[0]);
    if (i32(chart_idx) == hover_idx) {
      color = vec3f(0.96, 0.85, 0.30);
    }
  }
  return vec4f(color * alpha, alpha);
}
`;
}

// ─── EACH-FX shader: one chart's worth of segment math. ──────────────
function buildEachFxShader(samples: number): string {
  return `
@group(0) @binding(1) var<storage, read> ys: array<f32>;
const SAMPLES: u32 = ${samples}u;
const CHART_W: f32 = ${CHART_W.toFixed(1)};
const CHART_H: f32 = ${CHART_H.toFixed(1)};
const STROKE_HALF: f32 = ${(STROKE * 0.5).toFixed(4)};
const COLOR: vec3f = vec3f(0.24, 0.66, 1.00);

fn segDist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let p_px = vec2f(in.uv.x * CHART_W, in.uv.y * CHART_H);
  let f = in.uv.x * f32(SAMPLES - 1u);
  let i = u32(clamp(floor(f), 0.0, f32(SAMPLES - 2u)));
  let xa = f32(i)      / f32(SAMPLES - 1u) * CHART_W;
  let xb = f32(i + 1u) / f32(SAMPLES - 1u) * CHART_W;
  let ya = ys[i]       * CHART_H;
  let yb = ys[i + 1u]  * CHART_H;
  let d = segDist(p_px, vec2f(xa, ya), vec2f(xb, yb));
  let aa = max(fwidth(d) * 0.5, 0.5);
  let alpha = 1.0 - smoothstep(STROKE_HALF - aa, STROKE_HALF + aa, d);
  if (alpha <= 0.001) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  return vec4f(COLOR * alpha, alpha);
}
`;
}

// ─── Cell components for EACH-FX / POLYLINE / overlay hit-zone ────────

function CellTooltip({ idx }: { idx: number }) {
  return (
    <Box style={{ position: 'absolute', left: 0, right: 0, bottom: -14, alignItems: 'center' }}>
      <Box style={{ paddingLeft: 4, paddingRight: 4, paddingTop: 1, paddingBottom: 1, backgroundColor: '#000000cc', borderRadius: 3 }}>
        <Text style={{ fontSize: 9, color: COLOR_INK, fontFamily: 'monospace' }}>{`#${idx}`}</Text>
      </Box>
    </Box>
  );
}

function cellBaseStyle(hovered: boolean) {
  return {
    width: CHART_W, height: CHART_H,
    marginRight: CHART_GAP, marginBottom: CHART_GAP,
    borderWidth: hovered ? 1 : 0,
    borderColor: hovered ? COLOR_BORDER_HOVER : 'transparent',
    position: 'relative' as const,
    overflow: 'hidden' as const,
  };
}

function EachFxCell({ idx, tick, samples, overlayOn }: { idx: number; tick: number; samples: number; overlayOn: boolean }) {
  const [hovered, setHovered] = useState(false);
  const ys = useMemo(() => buildSeries(samples, tick, idx), [samples, tick, idx]);
  const shader = useMemo(() => buildEachFxShader(samples), [samples]);
  const inner = <Effect shader={shader} data={ys} style={{ width: '100%', height: '100%' }} />;
  if (!overlayOn) return <Box style={cellBaseStyle(false)}>{inner}</Box>;
  return (
    <Pressable
      onHoverEnter={() => setHovered(true)}
      onHoverExit={() => setHovered(false)}
      style={cellBaseStyle(hovered)}
    >
      {inner}
      {hovered ? <CellTooltip idx={idx} /> : null}
    </Pressable>
  );
}

function PolylineCell({ idx, tick, samples, overlayOn }: { idx: number; tick: number; samples: number; overlayOn: boolean }) {
  const [hovered, setHovered] = useState(false);
  const pts = useMemo(() => {
    const ys = buildSeries(samples, tick, idx);
    const out: number[] = [];
    for (let i = 0; i < samples; i++) {
      out.push((i / Math.max(1, samples - 1)) * CHART_W, ys[i] * CHART_H);
    }
    return out;
  }, [samples, tick, idx]);
  const inner = (
    <Graph style={{ width: '100%', height: '100%' }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
      <Graph.Polyline points={pts} stroke="#3da9ff" strokeWidth={STROKE} />
    </Graph>
  );
  if (!overlayOn) return <Box style={cellBaseStyle(false)}>{inner}</Box>;
  return (
    <Pressable
      onHoverEnter={() => setHovered(true)}
      onHoverExit={() => setHovered(false)}
      style={cellBaseStyle(hovered)}
    >
      {inner}
      {hovered ? <CellTooltip idx={idx} /> : null}
    </Pressable>
  );
}

// ONE-FX hit-zone: invisible Pressable. Local state for tooltip; lift
// hovered_idx up so the shader buffer's ys[0] reflects it.
function HitZone({ idx, setHoveredIdx }: { idx: number; setHoveredIdx: (i: number) => void }) {
  const [me, setMe] = useState(false);
  return (
    <Pressable
      onHoverEnter={() => { setMe(true); setHoveredIdx(idx); }}
      onHoverExit={() => { setMe(false); setHoveredIdx(-1); }}
      style={{
        width: CHART_W, height: CHART_H,
        marginRight: CHART_GAP, marginBottom: CHART_GAP,
        position: 'relative',
      }}
    >
      {me ? <CellTooltip idx={idx} /> : null}
    </Pressable>
  );
}

function Toggle({ label, on, onPress, accent }: { label: string; on: boolean; onPress: () => void; accent: string }) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{
        paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: on ? accent : '#2a2a2e',
        backgroundColor: on ? '#1a1a1d' : '#121215',
      }}>
        <Text style={{ fontSize: 11, color: on ? accent : '#bdbdc4', fontWeight: 'bold' }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

export default function ChartGridStress() {
  const [count, setCount] = useState(100);
  const [samples, setSamples] = useState(32);
  const [mode, setMode] = useState<Mode>('one-fx');
  const [anim, setAnim] = useState(true);
  const [hoverGlow, setHoverGlow] = useState(true);
  const [overlayOn, setOverlayOn] = useState(true);
  const [tick, setTick] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState(-1);

  useEffect(() => {
    if (!anim) return;
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, [anim]);

  const rows = Math.ceil(count / COLS);
  const gridInnerW = COLS * CHART_W + Math.max(0, COLS - 1) * CHART_GAP;
  const gridInnerH = rows * CHART_H + Math.max(0, rows - 1) * CHART_GAP;
  const gridW = gridInnerW + GRID_PAD * 2;
  const gridH = gridInnerH + GRID_PAD * 2;

  // Renders/sec diagnostic.
  const renderCount = useRef(0);
  renderCount.current += 1;
  const [rps, setRps] = useState(0);
  useEffect(() => {
    let last = renderCount.current;
    const id = setInterval(() => {
      const r = renderCount.current;
      setRps((r - last) * 2);
      last = r;
    }, 500);
    return () => clearInterval(id);
  }, []);

  // ONE-FX storage buffer: [hovered_idx, ys[c][i]...]. Rebuilt per render.
  //
  // For 1000x128 this is ~512KB/frame; the framework grows
  // gpu_data_capacity_floats geometrically so growth-hitch is observable
  // when bumping (count, samples) past current capacity.
  //
  // Inlined buildSeries: the natural version calls buildSeries() per cell
  // which returns a fresh Array per call -- at 1000x128 that's 1001 array
  // allocations per tick. Inlining drops it to 1 alloc/tick. The trig math
  // is identical to buildSeries(); only the array structure changes.
  //
  // Float32Array won't help further: the framework marshals data via JSON
  // (v8_app.zig:2126 checks `v == .array`), and typed arrays serialize as
  // objects in JSON, not arrays -- they'd silently drop. Would need a V8
  // binding fast-path in the framework to fix.
  const oneFxData = useMemo(() => {
    if (mode !== 'one-fx') return null;
    const total = 1 + count * samples;
    const arr = new Array<number>(total);
    arr[0] = hoveredIdx;
    const t = anim ? tick : 0;
    const denom = Math.max(1, samples - 1);
    for (let c = 0; c < count; c++) {
      const ph = c * 0.41;
      const base = 1 + c * samples;
      for (let i = 0; i < samples; i++) {
        const tt = i / denom;
        const a = Math.sin(tt * 6.28 + t * 0.05 + ph) * 0.30;
        const b = Math.sin(tt * 17.0 + t * 0.07 + ph * 1.7) * 0.14;
        const c2 = Math.sin(tt * 3.0 + t * 0.03 + ph * 0.7) * 0.16;
        arr[base + i] = 0.5 + a + b + c2;
      }
    }
    return arr;
  }, [mode, count, samples, tick, anim, hoveredIdx]);

  const oneFxShader = useMemo(() => {
    if (mode !== 'one-fx') return null;
    return buildOneFxShader({ rows, numCharts: count, samples, hoverGlow });
  }, [mode, count, samples, rows, hoverGlow]);

  const charts: number[] = [];
  for (let i = 0; i < count; i++) charts.push(i);

  const uploadKB = oneFxData ? (oneFxData.length * 4) / 1024 : 0;
  const totalSamples = count * samples;

  const modeAccent =
    mode === 'one-fx' ? '#facc15' :
    mode === 'each-fx' ? '#ff7a3d' : '#34d399';

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: COLOR_BG,
      paddingTop: 12, paddingLeft: 12, paddingRight: 12, paddingBottom: 12,
      flexDirection: 'column', gap: 8,
    }}>
      {/* Header / diagnostics */}
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 14, color: COLOR_INK, fontWeight: 'bold' }}>
          chart_grid_stress · ONE-FX × N-charts × storage-buffer
        </Text>
        <Box style={{ flexDirection: 'row', gap: 14 }}>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`${count} × ${samples} = ${totalSamples} floats`}</Text>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`upload ${uploadKB.toFixed(1)} KB`}</Text>
          <Text style={{ fontSize: 11, color: COLOR_DIM }}>{`R/s ${rps}`}</Text>
          <Text style={{ fontSize: 11, color: anim ? '#5cd49a' : COLOR_DIM }}>{anim ? 'ANIM' : 'IDLE'}</Text>
          <Text style={{ fontSize: 11, color: modeAccent, fontWeight: 'bold' }}>{mode.toUpperCase()}</Text>
        </Box>
      </Box>

      {/* Mode + flags */}
      <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Toggle label="ONE-FX" on={mode === 'one-fx'} onPress={() => setMode('one-fx')} accent="#facc15" />
        <Toggle label="EACH-FX" on={mode === 'each-fx'} onPress={() => setMode('each-fx')} accent="#ff7a3d" />
        <Toggle label="POLYLINE" on={mode === 'polyline'} onPress={() => setMode('polyline')} accent="#34d399" />
        <Box style={{ width: 10 }} />
        <Toggle label={anim ? 'ANIM ON' : 'ANIM OFF'} on={anim} onPress={() => setAnim((v) => !v)} accent="#3da9ff" />
        <Toggle label={overlayOn ? 'OVERLAY ON' : 'OVERLAY OFF'} on={overlayOn} onPress={() => setOverlayOn((v) => !v)} accent="#a78bfa" />
        <Toggle label={hoverGlow ? 'HOVER-GLOW ON' : 'HOVER-GLOW OFF'} on={hoverGlow} onPress={() => setHoverGlow((v) => !v)} accent="#f472b6" />
      </Box>

      {/* N + SAMPLES */}
      <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Text style={{ fontSize: 11, color: COLOR_DIM, paddingRight: 4 }}>N</Text>
        {COUNTS.map((c) => (
          <Toggle key={`n-${c}`} label={String(c)} on={c === count} onPress={() => setCount(c)} accent="#cdd9ec" />
        ))}
        <Box style={{ width: 10 }} />
        <Text style={{ fontSize: 11, color: COLOR_DIM, paddingRight: 4 }}>samples</Text>
        {SAMPLES_LIST.map((s) => (
          <Toggle key={`s-${s}`} label={String(s)} on={s === samples} onPress={() => setSamples(s)} accent="#cdd9ec" />
        ))}
      </Box>

      <Text style={{ fontSize: 10, color: COLOR_DIM }}>
        ONE-FX: 1 draw call, 1 pipeline, 1 buffer upload/frame. EACH-FX: N draw instances (shared pipeline), N storage uploads.
        POLYLINE: N Graph.Polyline (per-segment capsules). Read paint µs / FPS from the engine telemetry overlay.
      </Text>

      {/* Grid */}
      <ScrollView style={{ flexGrow: 1, backgroundColor: '#0a0a0d', borderWidth: 1, borderColor: COLOR_BORDER, borderRadius: 6 }}>
        {mode === 'one-fx' ? (
          <Box style={{ position: 'relative', width: gridW, height: gridH }}>
            <Effect
              shader={oneFxShader!}
              data={oneFxData!}
              style={{ position: 'absolute', left: 0, top: 0, width: gridW, height: gridH }}
            />
            {overlayOn ? (
              <Box style={{
                position: 'absolute',
                left: GRID_PAD, top: GRID_PAD,
                width: gridInnerW, height: gridInnerH,
                flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start',
              }}>
                {charts.map((i) => <HitZone key={i} idx={i} setHoveredIdx={setHoveredIdx} />)}
              </Box>
            ) : null}
          </Box>
        ) : (
          <Box style={{
            flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start',
            padding: GRID_PAD,
            width: gridW,
          }}>
            {charts.map((i) => mode === 'each-fx'
              ? <EachFxCell key={i} idx={i} tick={anim ? tick : 0} samples={samples} overlayOn={overlayOn} />
              : <PolylineCell key={i} idx={i} tick={anim ? tick : 0} samples={samples} overlayOn={overlayOn} />
            )}
          </Box>
        )}
      </ScrollView>
    </Box>
  );
}
