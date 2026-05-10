// candle_demo — live OHLC candlestick chart, pure shader.
//
// Live model: only the rightmost candle is "active." Each tick the price
// random-walks; the active candle's close = current price, high/low track
// running extremes since open. Every TICKS_PER_CANDLE ticks, the active
// candle locks in and a new one opens at the previous close. When buffer is
// full, oldest candle scrolls off.
//
// AA fix: previous version used `min(d_body, d_wick)` to union the two SDFs
// into one. That makes fwidth(d) discontinuous wherever the closer SDF
// switches (i.e., where the wick crosses the body's top/bottom edges),
// which produced a thin halo line on each candle. Now we compute coverage
// for body and wick separately and take max — same color, same alpha,
// clean seam.
//
// Storage layout (flat f32):
//   [0] n_candles
//   [1] body_w_frac     (body width as fraction of slot width)
//   [2] wick_w_norm     (wick width in normalized half-screen units)
//   [3..7]              reserved
//   [8 + i*4 + 0..3]    open, high, low, close (each in [0..1])

import { useEffect, useRef, useState } from 'react';
import { Box, Effect, Text } from '@reactjit/runtime/primitives';

const W = 1100;
const H = 620;
const N = 12;                  // fewer candles → much bigger bodies
const FRAME_MS = 33;
const TICKS_PER_CANDLE = 45;   // ~1.5s per candle

const SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

fn sd_box(p: vec2f, b: vec2f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = u32(ys[0]);
  let body_frac = ys[1];
  let wick_w = ys[2];

  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;

  let slot_w = 2.0 / f32(n);
  let idx_f = (p.x + 1.0) / slot_w;
  if (idx_f < 0.0 || idx_f >= f32(n)) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let i = u32(floor(idx_f));

  let cx = -1.0 + (f32(i) + 0.5) * slot_w;
  let base = 8u + i * 4u;
  let o = ys[base + 0u];
  let h = ys[base + 1u];
  let l = ys[base + 2u];
  let c = ys[base + 3u];

  let y_max = -0.85;
  let y_min = 0.85;
  let y_o = mix(y_min, y_max, o);
  let y_h = mix(y_min, y_max, h);
  let y_l = mix(y_min, y_max, l);
  let y_c = mix(y_min, y_max, c);

  let bullish = c >= o;
  let color = select(vec3f(0.94, 0.36, 0.42), vec3f(0.36, 0.83, 0.55), bullish);

  // AA helper: analytic 1-pixel-wide coverage from a signed distance.
  // fwidth(d) ~= pixel size in d-units. smoothstep over half a pixel
  // either side gives a true 1-pixel AA edge instead of the ~4-pixel
  // soft halo a full-fwidth window would produce.
  // (That softness was the ghost line floating above/below bodies.)
  // Wick: thin vertical box from low to high.
  let wick_cy = (y_h + y_l) * 0.5;
  let wick_hh = abs(y_l - y_h) * 0.5;
  let q_w = vec2f(p.x - cx, p.y - wick_cy);
  let d_w = sd_box(q_w, vec2f(wick_w, wick_hh));
  let aa_w = max(fwidth(d_w) * 0.5, 0.0003);
  let cov_w = 1.0 - smoothstep(-aa_w, aa_w, d_w);

  // Body: rect from open to close.
  let body_cy = (y_o + y_c) * 0.5;
  let body_hh = max(abs(y_o - y_c) * 0.5, 0.004);
  let body_hw = slot_w * 0.5 * body_frac;
  let q_b = vec2f(p.x - cx, p.y - body_cy);
  let d_b = sd_box(q_b, vec2f(body_hw, body_hh));
  let aa_b = max(fwidth(d_b) * 0.5, 0.0003);
  let cov_b = 1.0 - smoothstep(-aa_b, aa_b, d_b);

  // Explicit over-composite, body on top of wick. Both share color,
  // so this collapses to additive coverage cov_b + cov_w*(1 - cov_b) --
  // smoother than max() at the join and robust to future color tweaks.
  let cov = cov_b + cov_w * (1.0 - cov_b);
  if (cov <= 0.001) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  return vec4f(color * cov, cov);
}
`;

type Candle = { o: number; h: number; l: number; c: number };

function seedSeries(n: number): Candle[] {
  const arr: Candle[] = [];
  let prev = 0.5;
  for (let i = 0; i < n; i++) {
    const o = prev;
    const drift = (Math.random() - 0.5) * 0.08;
    const c = Math.max(0.06, Math.min(0.94, o + drift));
    const lo = Math.min(o, c) - Math.random() * 0.03;
    const hi = Math.max(o, c) + Math.random() * 0.03;
    arr.push({ o, h: Math.min(0.98, hi), l: Math.max(0.02, lo), c });
    prev = c;
  }
  return arr;
}

export default function CandleDemo() {
  // The candle history lives in a ref so we mutate in place; a state counter
  // forces re-render each tick. Cheaper than rebuilding the array.
  const candlesRef = useRef<Candle[]>(seedSeries(N));
  const priceRef = useRef(candlesRef.current[N - 1].c);
  const tickRef = useRef(0);
  const [, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      // Random walk the live price.
      const step = (Math.random() - 0.5) * 0.012;
      priceRef.current = Math.max(0.04, Math.min(0.96, priceRef.current + step));

      const arr = candlesRef.current;
      const last = arr[arr.length - 1];
      last.c = priceRef.current;
      if (priceRef.current > last.h) last.h = priceRef.current;
      if (priceRef.current < last.l) last.l = priceRef.current;

      tickRef.current += 1;
      if (tickRef.current >= TICKS_PER_CANDLE) {
        tickRef.current = 0;
        const open = priceRef.current;
        arr.push({ o: open, h: open, l: open, c: open });
        if (arr.length > N) arr.shift();
      }

      setFrame((f) => (f + 1) | 0);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, []);

  // Rebuild data array each frame (small — 8 + N*4 floats = 248 floats).
  // Keeps allocations in one place; avoids stale memo.
  const arr = candlesRef.current;
  const data: number[] = [];
  data.push(N);
  data.push(0.78);              // wider body
  data.push(0.006);             // proportionally thicker wick
  data.push(0.0); data.push(0.0); data.push(0.0); data.push(0.0); data.push(0.0);
  for (const k of arr) data.push(k.o, k.h, k.l, k.c);

  // Right-edge price scale.
  const scale = [0.0, 0.25, 0.5, 0.75, 1.0].map((p) => {
    const top = H * (0.5 + (0.85 - 1.7 * p) / 2);
    return (
      <Box
        key={p}
        style={{
          position: 'absolute',
          left: 0, top: top - 7, width: W,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
        }}
      >
        <Text style={{ fontSize: 10, color: '#3d4a60', paddingRight: 6 }}>{(100 * p).toFixed(0)}</Text>
      </Box>
    );
  });

  // Live price readout in top-right corner.
  const last = arr[arr.length - 1];
  const bullish = last.c >= last.o;
  const priceColor = bullish ? '#5cd49a' : '#ef6b75';
  const delta = ((last.c - last.o) / Math.max(0.001, last.o)) * 100;

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: '#0b1018',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Box style={{ width: W, height: H, position: 'relative' }}>
        <Effect shader={SHADER} data={data} style={{ width: W, height: H }} />
        {scale}
        <Box style={{ position: 'absolute', left: 14, top: 12, flexDirection: 'column' }}>
          <Text style={{ fontSize: 10, color: '#7f93b1', letterSpacing: 1 }}>LAST</Text>
          <Text style={{ fontSize: 22, color: priceColor, fontWeight: 'bold' }}>{(last.c * 100).toFixed(2)}</Text>
          <Text style={{ fontSize: 11, color: priceColor }}>
            {`${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%`}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
