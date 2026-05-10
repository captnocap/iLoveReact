// donut_demo — pure-shader donut chart. One quad, all math in the fragment.
//
// Target: a donut graph that does not look like shit at any zoom or DPI.
//
// Technique: zero tessellation. The ring is an analytic SDF
//   ring_sd = abs(d - mid_r) - half_w     (d = distance from center)
// AA'd via smoothstep(±fwidth(d)). Segments are angular bands AA'd the same
// way on θ. Storage buffer carries header + per-segment {start, end, rgb}.
//
// Why this beats every other approach we've tried:
//   - Tessellation: stair-steps on circle edges. The choppy thing.
//   - CPU raster (Blend2D): looks like ass on HiDPI, slow on big canvases.
//   - Vello.zig: stalled on wgpu v24 vs v27.
//   - Pathfinder: Rust + GL, no wgpu, integration cost is real.
// Analytic SDF in a fragment shader: pixel-perfect at any zoom, ~80 lines.
//
// Storage layout (flat f32):
//   [0] n_segments
//   [1] inner_radius   (0..1, fraction of half-size)
//   [2] outer_radius   (0..1)
//   [3] gap_radians    (angular gap between segments)
//   [4] rotation       (radians; -π/2 = start at 12 o'clock)
//   [5+i*5 .. ]        per segment: start_ang, end_ang, r, g, b

import { useEffect, useMemo, useState } from 'react';
import { Box, Effect, Text } from '@reactjit/runtime/primitives';

const SIZE = 460;

// Soft, distinct, dark-friendly palette. Tuned by eye, not stolen.
const PALETTE: [number, number, number][] = [
  [0.40, 0.78, 0.94],  // sky
  [0.36, 0.83, 0.60],  // emerald
  [0.96, 0.62, 0.27],  // amber
  [0.94, 0.45, 0.71],  // pink
  [0.55, 0.51, 0.96],  // indigo
  [0.96, 0.80, 0.20],  // gold
];

const LABELS = ['Rent', 'Food', 'Travel', 'Save', 'Misc', 'Fun'];
const TARGETS = [42, 23, 17, 30, 12, 21];

// p = uv*2-1 → unit-square-centered. Square surface assumed.
//
// Ring band SDF: signed distance from the ring (negative inside band).
// Segment band: angular wrapped distance from segment midpoint, with the
// gap subtracted from half_a so the gap renders as fully-empty space.
//
// Both edges AA'd via fwidth on their respective domains (d for the ring,
// θ for the angle). Near the inner edge fwidth(θ) ≈ 1/d so AA stays
// sub-pixel even close to the hole.
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

  let mid_r = (r_in + r_out) * 0.5;
  let half_w = (r_out - r_in) * 0.5;
  let ring_sd = abs(d - mid_r) - half_w;
  let aa_r = max(fwidth(d), 0.0005);
  let ring_a = 1.0 - smoothstep(-aa_r, aa_r, ring_sd);
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

export default function DonutDemo() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 33);
    return () => clearInterval(id);
  }, []);

  // Each weight breathes on its own phase so the donut subtly redistributes.
  const weights = useMemo(() => {
    return TARGETS.map((t, i) => t * (0.78 + 0.22 * (0.5 + 0.5 * Math.sin(tick * 0.04 + i * 1.3))));
  }, [tick]);
  const total = weights.reduce((a, b) => a + b, 0);

  // Pack header + segments into a single flat f32 array.
  const data = useMemo(() => {
    const out: number[] = [];
    out.push(weights.length);
    out.push(0.42);              // inner_radius
    out.push(0.94);              // outer_radius
    out.push(0.018);             // gap (radians, ~1°)
    out.push(-Math.PI / 2);      // rotate: start at 12 o'clock

    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
      const start = (acc / total) * Math.PI * 2;
      acc += weights[i];
      const end = (acc / total) * Math.PI * 2;
      const c = PALETTE[i % PALETTE.length];
      out.push(start, end, c[0], c[1], c[2]);
    }
    return out;
  }, [weights, total]);

  // Legend: tiny color swatch + label + value. Updates with the breathing.
  const legend = weights.map((w, i) => {
    const c = PALETTE[i % PALETTE.length];
    const hex = `rgb(${(c[0] * 255) | 0}, ${(c[1] * 255) | 0}, ${(c[2] * 255) | 0})`;
    return (
      <Box key={i} style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingTop: 4, paddingBottom: 4,
      }}>
        <Box style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: hex }} />
        <Text style={{ fontSize: 12, color: '#e8eef8', width: 70 }}>{LABELS[i]}</Text>
        <Text style={{ fontSize: 12, color: '#7f93b1' }}>{((w / total) * 100).toFixed(1)}%</Text>
      </Box>
    );
  });

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: '#0b1018',
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 48,
    }}>
      <Box style={{ width: SIZE, height: SIZE, position: 'relative' }}>
        <Effect shader={SHADER} data={data} style={{ width: SIZE, height: SIZE }} />
        <Box style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 11, color: '#7f93b1', letterSpacing: 2 }}>TOTAL</Text>
          <Text style={{ fontSize: 56, color: '#e8eef8', fontWeight: 'bold' }}>{total.toFixed(0)}</Text>
          <Text style={{ fontSize: 11, color: '#7f93b1' }}>units</Text>
        </Box>
      </Box>

      <Box style={{ flexDirection: 'column', gap: 0 }}>
        <Text style={{ fontSize: 14, color: '#e8eef8', fontWeight: 'bold', paddingBottom: 8 }}>
          Allocation
        </Text>
        {legend}
      </Box>
    </Box>
  );
}
