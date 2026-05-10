// pie_demo — solid pie chart, same shader trick as donut.
//
// Inner radius collapses to 0 → solid disk. Slice labels live in TSX,
// positioned absolutely at each slice's angular midpoint at 60% of radius.
// Labels are a layout problem, not a paint problem — let React handle them.
//
// Storage layout (flat f32):
//   [0] n_segments
//   [1] inner_radius   (0 for pie)
//   [2] outer_radius   (0..1)
//   [3] gap_radians
//   [4] rotation
//   [5+i*5 ..]         per slice: start_ang, end_ang, r, g, b

import { useEffect, useMemo, useState } from 'react';
import { Box, Effect, Text } from '@reactjit/runtime/primitives';

const SIZE = 480;

const PALETTE: [number, number, number][] = [
  [0.40, 0.78, 0.94],
  [0.36, 0.83, 0.60],
  [0.96, 0.62, 0.27],
  [0.94, 0.45, 0.71],
  [0.55, 0.51, 0.96],
];

const LABELS = ['Engineering', 'Design', 'Sales', 'Ops', 'Marketing'];
const TARGETS = [38, 18, 22, 12, 16];

const SHADER = `
const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;

@group(0) @binding(1) var<storage, read> ys: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = u32(ys[0]);
  let r_in = ys[1];
  let r_out = ys[2];
  let gap = ys[3];
  let rot = ys[4];

  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;
  let d = length(p);

  // Disk SDF: inside iff d < r_out.
  let aa_r = max(fwidth(d), 0.0005);
  let disk_a = 1.0 - smoothstep(r_out - aa_r, r_out + aa_r, d);
  // Hole (for pies r_in=0 this is just 1.0 everywhere).
  let hole_a = smoothstep(r_in - aa_r, r_in + aa_r, d);
  let ring_a = disk_a * hole_a;
  if (ring_a <= 0.001) { return vec4f(0.0, 0.0, 0.0, 0.0); }

  let theta = atan2(p.y, p.x) - rot;

  var color = vec3f(0.0);
  var seg_a = 0.0;
  for (var i: u32 = 0u; i < n; i = i + 1u) {
    let base = 5u + i * 5u;
    let s_ang = ys[base + 0u];
    let e_ang = ys[base + 1u];
    let cr = ys[base + 2u];
    let cg = ys[base + 3u];
    let cb = ys[base + 4u];

    let mid_a = (s_ang + e_ang) * 0.5;
    let half_a = (e_ang - s_ang) * 0.5 - gap * 0.5;
    var dtheta = theta - mid_a;
    dtheta = dtheta - TAU * floor((dtheta + PI) / TAU);
    let ang_sd = abs(dtheta) - half_a;

    let aa_a = max(fwidth(theta), 0.001);
    let m = 1.0 - smoothstep(-aa_a, aa_a, ang_sd);
    if (m > seg_a) {
      seg_a = m;
      color = vec3f(cr, cg, cb);
    }
  }

  let alpha = ring_a * seg_a;
  if (alpha <= 0.001) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  return vec4f(color * alpha, alpha);
}
`;

export default function PieDemo() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 33);
    return () => clearInterval(id);
  }, []);

  const weights = useMemo(() => {
    return TARGETS.map((t, i) => t * (0.82 + 0.18 * (0.5 + 0.5 * Math.sin(tick * 0.035 + i * 1.1))));
  }, [tick]);
  const total = weights.reduce((a, b) => a + b, 0);

  // Cumulative angles for the shader buffer AND for label placement.
  const slices = useMemo(() => {
    const arr: { start: number; end: number; mid: number; pct: number; color: [number, number, number] }[] = [];
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
      const start = (acc / total) * Math.PI * 2;
      acc += weights[i];
      const end = (acc / total) * Math.PI * 2;
      arr.push({ start, end, mid: (start + end) * 0.5, pct: weights[i] / total, color: PALETTE[i % PALETTE.length] });
    }
    return arr;
  }, [weights, total]);

  const data = useMemo(() => {
    const out: number[] = [];
    out.push(slices.length);
    out.push(0.0);                // inner_radius (solid pie)
    out.push(0.94);               // outer_radius
    out.push(0.012);              // gap (~0.7°)
    out.push(-Math.PI / 2);       // 12 o'clock start
    for (const s of slices) {
      out.push(s.start, s.end, s.color[0], s.color[1], s.color[2]);
    }
    return out;
  }, [slices]);

  // Label radius: 60% of disk radius, in normalized [-1,1] then scaled to SIZE.
  // The shader rotates by -π/2 (12 o'clock) and θ = atan2(y,x); same convention here.
  const ROT = -Math.PI / 2;
  const LABEL_R = 0.62 * 0.94 * (SIZE * 0.5);
  const labels = slices.map((s, i) => {
    if (s.pct < 0.04) return null;  // tiny slice, skip label
    const ang = s.mid + ROT;
    const x = Math.cos(ang) * LABEL_R;
    const y = Math.sin(ang) * LABEL_R;
    return (
      <Box
        key={i}
        style={{
          position: 'absolute',
          left: SIZE * 0.5 + x - 40,
          top: SIZE * 0.5 + y - 14,
          width: 80,
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 14, color: '#0b1018', fontWeight: 'bold' }}>
          {(s.pct * 100).toFixed(0)}%
        </Text>
        <Text style={{ fontSize: 10, color: '#0b1018' }}>{LABELS[i]}</Text>
      </Box>
    );
  });

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: '#0b1018',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Box style={{ width: SIZE, height: SIZE, position: 'relative' }}>
        <Effect shader={SHADER} data={data} style={{ width: SIZE, height: SIZE }} />
        {labels}
      </Box>
    </Box>
  );
}
