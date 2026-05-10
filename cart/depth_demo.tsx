// depth_demo -- order-book depth chart. Cumulative bid (left, green) and
// ask (right, red) volumes plotted vs price, filled area + crisp upper line.
//
// Bids: cumulative volume from mid going LEFT (price decreasing).
// Asks: cumulative volume from mid going RIGHT (price increasing).
// Both reach larger volumes as you move away from the mid price.
//
// Storage layout (flat f32):
//   [0] n               (total samples; bid count == ask count == n/2)
//   [1] baseline_y      (bottom of fill, e.g., +0.85)
//   [2] top_y           (top of chart, e.g., -0.85; note negative = up)
//   [3] reserved
//   [4 + i]             cumulative volume at sample i, normalized [0..1]
//
// Sample layout: i in [0, n/2) are bids (leftmost = deepest, rightmost = mid),
// i in [n/2, n) are asks (leftmost = mid, rightmost = deepest).

import { useEffect, useRef, useState } from 'react';
import { Box, Effect, Text } from '@reactjit/runtime/primitives';

const W = 880;
const H = 440;
const N = 120;          // 60 bid + 60 ask samples

const SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = u32(ys[0]);
  let baseline = ys[1];
  let top_y = ys[2];

  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;
  if (p.x < -1.0 || p.x > 1.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }

  // Sample index by x position. Linear interp between adjacent samples.
  let idx_f = (p.x + 1.0) * 0.5 * f32(n - 1u);
  let i = u32(floor(idx_f));
  let i_next = min(i + 1u, n - 1u);
  let frac = idx_f - floor(idx_f);
  let v0 = ys[4u + i];
  let v1 = ys[4u + i_next];
  let v = mix(v0, v1, frac);

  // Curve y in screen space.
  let v_y = mix(baseline, top_y, v);

  let is_bid = step(p.x, 0.0);
  let bid_color = vec3f(0.30, 0.82, 0.55);
  let ask_color = vec3f(0.94, 0.42, 0.50);
  let color = mix(ask_color, bid_color, is_bid);

  // Fill: between v_y (top of curve) and baseline (bottom).
  // smoothstep(v_y, v_y+aa, p.y) goes 0 above curve to 1 below. Then clamp to baseline.
  let aa_y = max(fwidth(p.y) * 0.5, 0.001);
  let fill_a = smoothstep(v_y - aa_y, v_y + aa_y, p.y) * step(p.y, baseline + aa_y);

  // Crisp upper-edge line.
  let line_d = abs(p.y - v_y);
  let aa_l = max(fwidth(p.y) * 0.5, 0.001);
  let line_a = 1.0 - smoothstep(0.0024, 0.0024 + aa_l, line_d);

  // Fill at lower opacity, line at full.
  var rgb = vec3f(0.0);
  var alpha = 0.0;
  let src_fill = fill_a * 0.42;
  rgb = color * src_fill + rgb * (1.0 - src_fill);
  alpha = src_fill + alpha * (1.0 - src_fill);

  let line_color = color * 1.25;
  rgb = line_color * line_a + rgb * (1.0 - line_a);
  alpha = line_a + alpha * (1.0 - line_a);

  // Mid-price marker: thin vertical line at p.x = 0.
  let mid_d = abs(p.x);
  let aa_m = max(fwidth(p.x) * 0.5, 0.0005);
  let mid_a = (1.0 - smoothstep(0.0014, 0.0014 + aa_m, mid_d)) * step(p.y, baseline) * step(top_y, p.y);
  let mid_color = vec3f(0.36, 0.44, 0.58);
  rgb = mid_color * mid_a + rgb * (1.0 - mid_a);
  alpha = mid_a + alpha * (1.0 - mid_a);

  if (alpha <= 0.001) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  return vec4f(rgb, alpha);
}
`;

// Generate a plausible depth profile: cumulative volume rises with distance
// from mid, with some random "walls" (level concentration) to make it look
// real. Both sides are independent.
function buildDepth(seed: number): number[] {
  const half = N / 2;
  const out = new Array<number>(N);
  // Seedable rand.
  let s = seed | 0;
  const rand = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Bids: cumulative going from index 0 (deepest, highest cum) to index half (mid, 0).
  let bidCum = 1.0;
  for (let i = 0; i < half; i++) {
    out[i] = bidCum;
    const stepDown = 0.005 + rand() * 0.04;   // decay toward mid
    bidCum = Math.max(0, bidCum - stepDown);
  }
  // Asks: from index half (mid, 0) growing to deepest (largest cum).
  let askCum = 0.0;
  for (let i = 0; i < half; i++) {
    out[half + i] = askCum;
    const stepUp = 0.005 + rand() * 0.04;
    askCum = Math.min(1.0, askCum + stepUp);
  }
  return out;
}

export default function DepthDemo() {
  // Live drift: every tick, nudge a few volumes up/down so the walls breathe.
  const volsRef = useRef<number[]>(buildDepth(2024));
  const [, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const a = volsRef.current;
      // Walk a few random samples by a tiny amount, then re-cumulate so the
      // curve stays monotone toward each side.
      for (let k = 0; k < 4; k++) {
        const i = (Math.random() * a.length) | 0;
        a[i] = Math.max(0, Math.min(1, a[i] + (Math.random() - 0.5) * 0.02));
      }
      // Enforce monotonicity from each end toward mid.
      const half = a.length / 2;
      for (let i = 1; i < half; i++) {
        if (a[i] > a[i - 1]) a[i] = a[i - 1];
      }
      for (let i = half + 1; i < a.length; i++) {
        if (a[i] < a[i - 1]) a[i] = a[i - 1];
      }
      setFrame((f) => (f + 1) | 0);
    }, 60);
    return () => clearInterval(id);
  }, []);

  const data: number[] = [];
  data.push(N);
  data.push(0.85);    // baseline
  data.push(-0.85);   // top_y
  data.push(0);
  for (const v of volsRef.current) data.push(v);

  // Y-axis tick labels (volume).
  const ticks = [0.0, 0.25, 0.5, 0.75, 1.0].map((p) => {
    const top = H * (0.5 + (0.85 - 1.7 * p) / 2);
    return (
      <Box
        key={p}
        style={{
          position: 'absolute',
          left: 6, top: top - 7,
        }}
      >
        <Text style={{ fontSize: 10, color: '#3d4a60' }}>{(p * 100).toFixed(0)}%</Text>
      </Box>
    );
  });

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: '#0b1018',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Box style={{ width: W, height: H, position: 'relative' }}>
        <Effect shader={SHADER} data={data} style={{ width: W, height: H }} />
        {ticks}
        <Box style={{ position: 'absolute', left: 16, top: 12 }}>
          <Text style={{ fontSize: 11, color: '#7f93b1', letterSpacing: 1 }}>BIDS</Text>
        </Box>
        <Box style={{ position: 'absolute', right: 16, top: 12 }}>
          <Text style={{ fontSize: 11, color: '#7f93b1', letterSpacing: 1 }}>ASKS</Text>
        </Box>
        <Box style={{ position: 'absolute', left: W * 0.5 - 30, bottom: 8, width: 60, alignItems: 'center' }}>
          <Text style={{ fontSize: 10, color: '#56688a' }}>MID</Text>
        </Box>
      </Box>
    </Box>
  );
}
