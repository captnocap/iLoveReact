// pyramid_demo -- population pyramid. Per row, two bars extend left and
// right from a central axis. Same rounded-rect SDF + 1-pixel AA as bar_demo,
// but the per-row geometry is two bars instead of one.
//
// Storage layout (flat f32):
//   [0] n_rows
//   [1] row_gap          (vertical gap between rows in normalized units)
//   [2] center_gap       (gap on each side of the central axis)
//   [3] max_w            (max bar half-width in p.x units)
//   [4 + i*4 + 0]        left value (0..1 of max_w)
//   [4 + i*4 + 1]        right value (0..1 of max_w)
//   [4 + i*4 + 2..3]     reserved

import { useEffect, useRef, useState } from 'react';
import { Box, Effect, Text } from '@reactjit/runtime/primitives';

const W = 760;
const H = 520;
const ROWS = 11;

const BRACKETS = ['80+', '70-79', '60-69', '50-59', '40-49', '30-39', '20-29', '15-19', '10-14', '5-9', '0-4'];
const LEFT_TARGETS  = [0.10, 0.18, 0.30, 0.45, 0.58, 0.72, 0.78, 0.62, 0.66, 0.70, 0.72];
const RIGHT_TARGETS = [0.14, 0.22, 0.34, 0.48, 0.60, 0.74, 0.80, 0.64, 0.68, 0.72, 0.74];

const SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

fn sd_round_box(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = u32(ys[0]);
  let row_gap = ys[1];
  let center_gap = ys[2];
  let max_w = ys[3];

  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;

  let row_h = 2.0 / f32(n);
  let idx_f = (p.y + 1.0) / row_h;
  if (idx_f < 0.0 || idx_f >= f32(n)) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let i = u32(floor(idx_f));

  let row_cy = -1.0 + (f32(i) + 0.5) * row_h;
  let base = 4u + i * 4u;
  let left_v = ys[base + 0u];
  let right_v = ys[base + 1u];

  let bar_hh = (row_h - row_gap) * 0.5;
  let corner = 0.012;

  // Left bar: from -center_gap leftward by left_v*max_w.
  let left_outer = -center_gap - left_v * max_w;
  let left_inner = -center_gap;
  let left_cx = (left_outer + left_inner) * 0.5;
  let left_hw = abs(left_inner - left_outer) * 0.5;
  let q_l = vec2f(p.x - left_cx, p.y - row_cy);
  let d_l = sd_round_box(q_l, vec2f(left_hw, bar_hh), corner);
  let aa_l = max(fwidth(d_l) * 0.5, 0.0003);
  let cov_l = 1.0 - smoothstep(-aa_l, aa_l, d_l);

  // Right bar: from +center_gap rightward by right_v*max_w.
  let right_inner = center_gap;
  let right_outer = center_gap + right_v * max_w;
  let right_cx = (right_inner + right_outer) * 0.5;
  let right_hw = abs(right_outer - right_inner) * 0.5;
  let q_r = vec2f(p.x - right_cx, p.y - row_cy);
  let d_r = sd_round_box(q_r, vec2f(right_hw, bar_hh), corner);
  let aa_r = max(fwidth(d_r) * 0.5, 0.0003);
  let cov_r = 1.0 - smoothstep(-aa_r, aa_r, d_r);

  let left_color = vec3f(0.40, 0.78, 0.94);
  let right_color = vec3f(0.94, 0.45, 0.71);

  var rgb = left_color * cov_l + right_color * cov_r;
  var alpha = max(cov_l, cov_r);
  if (alpha <= 0.001) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  return vec4f(rgb, alpha);
}
`;

export default function PyramidDemo() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 33);
    return () => clearInterval(id);
  }, []);

  const data: number[] = [];
  data.push(ROWS);
  data.push(0.025);    // row_gap
  data.push(0.06);     // center_gap (room for bracket labels)
  data.push(0.78);     // max_w
  for (let i = 0; i < ROWS; i++) {
    const breathe = 0.92 + 0.08 * Math.sin(tick * 0.04 + i * 0.7);
    data.push(LEFT_TARGETS[i] * breathe);
    data.push(RIGHT_TARGETS[i] * breathe);
    data.push(0); data.push(0);
  }

  // Center bracket labels.
  const rowH = H / ROWS;
  const labels = BRACKETS.map((b, i) => (
    <Box
      key={i}
      style={{
        position: 'absolute',
        left: W * 0.5 - 30,
        top: rowH * i,
        width: 60,
        height: rowH,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: 10, color: '#7f93b1' }}>{b}</Text>
    </Box>
  ));

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: '#0b1018',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Box style={{ flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <Box style={{ flexDirection: 'row', gap: 28 }}>
          <Text style={{ fontSize: 12, color: '#5db8e8', fontWeight: 'bold' }}>MALE</Text>
          <Text style={{ fontSize: 12, color: '#7f93b1' }}>Age</Text>
          <Text style={{ fontSize: 12, color: '#e36ba1', fontWeight: 'bold' }}>FEMALE</Text>
        </Box>
        <Box style={{ width: W, height: H, position: 'relative' }}>
          <Effect shader={SHADER} data={data} style={{ width: W, height: H }} />
          {labels}
        </Box>
      </Box>
    </Box>
  );
}
