// bar_demo — bar chart, pure shader. One quad. Rounded-top bars.
//
// Per fragment: derive bar index from x, look up that bar's height from the
// storage buffer, run a rounded-rect SDF against it. AA via fwidth(d).
//
// Storage layout (flat f32):
//   [0] n_bars
//   [1] gap_norm        (gap between bars in normalized half-screen units)
//   [2] corner_radius   (normalized)
//   [3] baseline_y      (in shader p.y space, [-1,1], +0.85 ≈ near bottom)
//   [4] max_height      (in p.y span — how far above baseline a 100% bar goes)
//   [5..7]              (reserved)
//   [8 + i*4 + 0]       height_norm (0..1)
//   [8 + i*4 + 1..3]    r, g, b

import { useEffect, useMemo, useState } from 'react';
import { Box, Effect, Text } from '@reactjit/runtime/primitives';

const W = 720;
const H = 360;

const LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TARGETS = [42, 58, 51, 66, 73, 88, 95, 91, 78, 64, 55, 70];

const SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

fn sd_round_box(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = u32(ys[0]);
  let gap = ys[1];
  let corner = ys[2];
  let baseline = ys[3];
  let max_h = ys[4];

  // p: shader space, x in [-1,1], y in [-1,1] (positive = down).
  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;

  let bar_w = 2.0 / f32(n);
  let idx_f = (p.x + 1.0) / bar_w;
  if (idx_f < 0.0 || idx_f >= f32(n)) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let i = u32(floor(idx_f));

  let bar_cx = -1.0 + (f32(i) + 0.5) * bar_w;
  let base = 8u + i * 4u;
  let h_norm = ys[base + 0u];
  let cr = ys[base + 1u];
  let cg = ys[base + 2u];
  let cb = ys[base + 3u];

  // Bar spans from baseline (bottom) up to baseline - h_norm*max_h.
  // In screen-y, "up" is negative, so top has smaller y than baseline.
  let top_y = baseline - h_norm * max_h;
  let bar_cy = (top_y + baseline) * 0.5;
  let bar_hh = (baseline - top_y) * 0.5;
  let bar_hw = bar_w * 0.5 - gap;

  // Clip below the baseline so rounded corners only show on top.
  // Trick: shift the SDF probe point so bottom of bar is "below" baseline
  // and outside the round-box's rounded zone.
  let q = vec2f(p.x - bar_cx, p.y - bar_cy);
  let d = sd_round_box(q, vec2f(bar_hw, bar_hh), corner);

  // Square bottom: re-test against the bottom edge alone, no rounding.
  // Ensures bars sit flat on the baseline.
  let bottom_clip = p.y - baseline;  // > 0 means below baseline → outside

  let outside = max(d, bottom_clip);
  let aa = max(fwidth(outside), 0.0005);
  let cov = 1.0 - smoothstep(-aa, aa, outside);
  if (cov <= 0.001) { return vec4f(0.0, 0.0, 0.0, 0.0); }

  // Subtle vertical gradient: top slightly brighter than bottom.
  let t = clamp((baseline - p.y) / max_h, 0.0, 1.0);  // 0 at base, 1 at top
  let shade = 0.85 + 0.15 * t;
  let rgb = vec3f(cr, cg, cb) * shade;
  return vec4f(rgb * cov, cov);
}
`;

export default function BarDemo() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 33);
    return () => clearInterval(id);
  }, []);

  // Each bar breathes. Plus a slow global trend so the whole chart drifts.
  const heights = useMemo(() => {
    return TARGETS.map((t, i) =>
      t * (0.85 + 0.15 * Math.sin(tick * 0.04 + i * 0.7))
    );
  }, [tick]);
  const maxVal = 100;

  // Color: lerp blue→green by height. High bars greener, low bars bluer.
  const data = useMemo(() => {
    const n = heights.length;
    const out: number[] = [];
    out.push(n);
    out.push(0.012);                 // gap
    out.push(0.04);                  // corner radius
    out.push(0.85);                  // baseline (screen-y, near bottom)
    out.push(1.55);                  // max height (so 100% bar reaches y=-0.70)
    out.push(0.0); out.push(0.0); out.push(0.0);  // reserved

    for (let i = 0; i < n; i++) {
      const hn = Math.min(1, heights[i] / maxVal);
      // Blue (0.40, 0.55, 0.94) → green (0.36, 0.83, 0.60)
      const r = 0.40 + (0.36 - 0.40) * hn;
      const g = 0.55 + (0.83 - 0.55) * hn;
      const b = 0.94 + (0.60 - 0.94) * hn;
      out.push(hn, r, g, b);
    }
    return out;
  }, [heights]);

  // X-axis labels positioned at each bar's center.
  const barW = W / heights.length;
  const xLabels = LABELS.map((lab, i) => (
    <Box
      key={i}
      style={{
        position: 'absolute',
        left: i * barW,
        top: H + 4,
        width: barW,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 11, color: '#7f93b1' }}>{lab}</Text>
    </Box>
  ));

  // Value labels above each bar.
  const valueLabels = heights.map((h, i) => {
    const hn = Math.min(1, h / maxVal);
    // Bar top in pixel space: baseline at H * (0.5 + 0.85/2) = H*0.925,
    // bar top at H * (0.5 + (0.85 - 1.55*hn)/2).
    const topPx = H * (0.5 + (0.85 - 1.55 * hn) / 2);
    return (
      <Box
        key={i}
        style={{
          position: 'absolute',
          left: i * barW,
          top: topPx - 18,
          width: barW,
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 10, color: '#e8eef8', fontWeight: 'bold' }}>{h.toFixed(0)}</Text>
      </Box>
    );
  });

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: '#0b1018',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Box style={{ width: W, height: H + 28, position: 'relative' }}>
        <Effect shader={SHADER} data={data} style={{ width: W, height: H }} />
        {valueLabels}
        {xLabels}
      </Box>
    </Box>
  );
}
