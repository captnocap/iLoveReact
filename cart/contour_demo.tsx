// contour_demo -- 2D scalar field with colormapped fill + analytic isolines.
//
// Field is a sum of N animated gaussian blobs:
//   f(p) = sum_i strength_i * exp(-|p - c_i|^2 / sigma_i^2)
//
// Color: 5-stop viridis-ish gradient mapped from f.
// Isolines: at every level_step, drawn at width K * fwidth(f) to keep them
// 1 pixel wide regardless of how steep the field is.
//
// Storage layout (flat f32):
//   [0] n_blobs
//   [1] level_step       (e.g., 0.1 -> 10 isolines visible per range)
//   [2..3] reserved
//   [4 + i*4 + 0..1]     blob center cx, cy
//   [4 + i*4 + 2]        strength
//   [4 + i*4 + 3]        sigma

import { useEffect, useState } from 'react';
import { Box, Effect } from '@reactjit/runtime/primitives';

const W = 760;
const H = 480;
const N = 6;

type Blob = { cx: number; cy: number; strength: number; sigma: number; phaseX: number; phaseY: number; ampX: number; ampY: number };

const BLOBS: Blob[] = [
  { cx: -0.40, cy: -0.20, strength: 1.0, sigma: 0.40, phaseX: 0.0, phaseY: 0.5, ampX: 0.18, ampY: 0.10 },
  { cx:  0.55, cy:  0.30, strength: 0.8, sigma: 0.32, phaseX: 1.0, phaseY: 1.5, ampX: 0.14, ampY: 0.18 },
  { cx: -0.10, cy:  0.45, strength: 0.7, sigma: 0.28, phaseX: 2.0, phaseY: 0.0, ampX: 0.12, ampY: 0.10 },
  { cx:  0.30, cy: -0.40, strength: 0.6, sigma: 0.30, phaseX: 0.5, phaseY: 2.5, ampX: 0.20, ampY: 0.08 },
  { cx: -0.55, cy:  0.25, strength: 0.5, sigma: 0.26, phaseX: 1.5, phaseY: 1.0, ampX: 0.10, ampY: 0.12 },
  { cx:  0.10, cy:  0.05, strength: 0.6, sigma: 0.24, phaseX: 2.5, phaseY: 2.0, ampX: 0.08, ampY: 0.10 },
];

const SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = u32(ys[0]);
  let level_step = ys[1];

  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;

  var f = 0.0;
  for (var i = 0u; i < n; i = i + 1u) {
    let base = 4u + i * 4u;
    let cx = ys[base + 0u];
    let cy = ys[base + 1u];
    let strength = ys[base + 2u];
    let sigma = ys[base + 3u];
    let dx = p.x - cx;
    let dy = p.y - cy;
    let r2 = dx * dx + dy * dy;
    f = f + strength * exp(-r2 / (sigma * sigma));
  }

  // Five-stop colormap.
  let c0 = vec3f(0.04, 0.06, 0.16);
  let c1 = vec3f(0.18, 0.30, 0.62);
  let c2 = vec3f(0.22, 0.66, 0.74);
  let c3 = vec3f(0.55, 0.85, 0.45);
  let c4 = vec3f(0.96, 0.86, 0.30);
  let c5 = vec3f(0.96, 0.42, 0.30);

  let t = clamp(f, 0.0, 1.0);
  let ts = t * 5.0;
  var bg = c0;
  if (ts < 1.0) { bg = mix(c0, c1, ts); }
  else if (ts < 2.0) { bg = mix(c1, c2, ts - 1.0); }
  else if (ts < 3.0) { bg = mix(c2, c3, ts - 2.0); }
  else if (ts < 4.0) { bg = mix(c3, c4, ts - 3.0); }
  else { bg = mix(c4, c5, ts - 4.0); }

  // Isolines at each integer multiple of level_step.
  // dist_to_level = how far f is from the nearest level (in field units).
  let nearest_level = round(f / level_step) * level_step;
  let dist = abs(f - nearest_level);
  let fw = max(fwidth(f), 1e-5);
  let line_a = 1.0 - smoothstep(fw * 0.4, fw * 1.1, dist);

  // Stronger lines every 5 steps (e.g., 0.5, 1.0).
  let level_idx = round(f / level_step);
  let major = step(0.5, abs(level_idx - 5.0 * round(level_idx / 5.0)) * 0.0 + step(0.5, abs(level_idx - 5.0 * floor(level_idx / 5.0 + 0.5))));

  let line_color = vec3f(0.92, 0.96, 1.0);
  let final_rgb = mix(bg, line_color, line_a * 0.55);

  return vec4f(final_rgb, 1.0);
}
`;

export default function ContourDemo() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 33);
    return () => clearInterval(id);
  }, []);

  const data: number[] = [];
  data.push(N);
  data.push(0.10);   // level_step
  data.push(0); data.push(0);
  for (const b of BLOBS) {
    const cx = b.cx + b.ampX * Math.sin(tick * 0.02 + b.phaseX);
    const cy = b.cy + b.ampY * Math.cos(tick * 0.024 + b.phaseY);
    data.push(cx, cy, b.strength, b.sigma);
  }

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: '#0b1018',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Box style={{ width: W, height: H, borderRadius: 8, overflow: 'hidden' }}>
        <Effect shader={SHADER} data={data} style={{ width: W, height: H }} />
      </Box>
    </Box>
  );
}
