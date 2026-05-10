// radar_demo -- radar/spider chart. N axes radiating from center, each with
// a value in [0..1]. Filled translucent polygon, crisp colored outline,
// concentric grid polygons, axis spokes. All shader.
//
// Per fragment:
//   - find which angular wedge (i0, i1) you sit in
//   - compute the data polygon's edge segment between vertex i0 and i1
//   - inside test: ray-edge intersection at this fragment's polar angle
//   - SDF for grid rings (concentric polygons at fixed v) + axis spokes
//
// Storage layout (flat f32):
//   [0] n_axes
//   [1] max_r           (outer ring radius in p-space)
//   [2..3] reserved
//   [4..6] fill_rgb     (data polygon color)
//   [7] reserved
//   [8 + i] axis value (0..1)

import { useEffect, useState } from 'react';
import { Box, Effect, Text } from '@reactjit/runtime/primitives';

const SIZE = 540;
const N = 7;
const LABELS = ['Speed', 'Power', 'Range', 'Stealth', 'Cost', 'Reliability', 'Comfort'];
const TARGETS = [0.85, 0.70, 0.55, 0.92, 0.40, 0.75, 0.62];

const SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

fn sd_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = u32(ys[0]);
  let max_r = ys[1];
  let cr = ys[4];
  let cg = ys[5];
  let cb = ys[6];

  let TAU = 6.28318530718;
  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;
  let d = length(p);
  if (d > max_r + 0.08) { return vec4f(0.0, 0.0, 0.0, 0.0); }

  let theta = atan2(p.y, p.x);
  // Shift so axis 0 sits at 12 o'clock (-pi/2), going clockwise.
  var t = (theta + TAU * 0.25) / TAU;
  t = t - floor(t);
  let pos_f = t * f32(n);
  let i0 = u32(floor(pos_f));
  let i1 = (i0 + 1u) % n;

  let theta0 = -TAU * 0.25 + TAU * f32(i0) / f32(n);
  let theta1 = -TAU * 0.25 + TAU * f32(i1) / f32(n);
  let v0 = ys[8u + i0] * max_r;
  let v1 = ys[8u + i1] * max_r;
  let A = vec2f(cos(theta0) * v0, sin(theta0) * v0);
  let B = vec2f(cos(theta1) * v1, sin(theta1) * v1);

  // Data polygon edge SDF + inside test.
  let edge_d = sd_segment(p, A, B);
  let dir = vec2f(cos(theta), sin(theta));
  let denom = dir.x * (B.y - A.y) - dir.y * (B.x - A.x);
  let r_edge = (A.x * (B.y - A.y) - A.y * (B.x - A.x)) / denom;
  let inside = step(d, r_edge);

  // Concentric grid polygons at v = 0.25, 0.50, 0.75, 1.00 (same vertices).
  var grid_a = 0.0;
  for (var k = 1u; k <= 4u; k = k + 1u) {
    let rk = f32(k) * 0.25 * max_r;
    let Ag = vec2f(cos(theta0) * rk, sin(theta0) * rk);
    let Bg = vec2f(cos(theta1) * rk, sin(theta1) * rk);
    let dg = sd_segment(p, Ag, Bg);
    let aa_g = max(fwidth(dg) * 0.5, 0.0005);
    let band = 1.0 - smoothstep(0.0014, 0.0014 + aa_g, dg);
    grid_a = max(grid_a, band);
  }

  // Axis spokes: thin lines from center to outer ring vertex.
  var axis_a = 0.0;
  for (var k = 0u; k < n; k = k + 1u) {
    let theta_k = -TAU * 0.25 + TAU * f32(k) / f32(n);
    let outer = vec2f(cos(theta_k) * max_r, sin(theta_k) * max_r);
    let da = sd_segment(p, vec2f(0.0, 0.0), outer);
    let aa_a = max(fwidth(da) * 0.5, 0.0005);
    let band = 1.0 - smoothstep(0.0012, 0.0012 + aa_a, da);
    axis_a = max(axis_a, band);
  }

  // Composite: grid (under), spokes, fill (translucent), outline (top).
  // Premultiplied alpha throughout.
  let grid_color = vec3f(0.20, 0.26, 0.36);
  var rgb = grid_color * grid_a;
  var alpha = grid_a;

  let spoke_color = vec3f(0.26, 0.32, 0.44);
  rgb = spoke_color * axis_a + rgb * (1.0 - axis_a);
  alpha = axis_a + alpha * (1.0 - axis_a);

  let fill_color = vec3f(cr, cg, cb);
  let fill_a = inside * 0.32;
  rgb = fill_color * fill_a + rgb * (1.0 - fill_a);
  alpha = fill_a + alpha * (1.0 - fill_a);

  let aa_e = max(fwidth(edge_d) * 0.5, 0.0005);
  let outline_a = 1.0 - smoothstep(0.0028, 0.0028 + aa_e, edge_d);
  let outline_color = fill_color * 1.35;
  rgb = outline_color * outline_a + rgb * (1.0 - outline_a);
  alpha = outline_a + alpha * (1.0 - outline_a);

  if (alpha <= 0.001) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  return vec4f(rgb, alpha);
}
`;

export default function RadarDemo() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 33);
    return () => clearInterval(id);
  }, []);

  const data: number[] = [];
  data.push(N);
  data.push(0.82);            // max_r
  data.push(0); data.push(0);
  data.push(0.36); data.push(0.83); data.push(0.60); data.push(0);  // fill rgb
  for (let i = 0; i < N; i++) {
    data.push(TARGETS[i] * (0.9 + 0.1 * Math.sin(tick * 0.05 + i * 1.4)));
  }

  // Axis labels around the chart, positioned in normalized [-1,1] space.
  const labels = LABELS.map((lab, i) => {
    const ang = -Math.PI / 2 + (Math.PI * 2 * i) / N;
    const r = 0.94;
    const lx = SIZE * 0.5 + Math.cos(ang) * r * SIZE * 0.5;
    const ly = SIZE * 0.5 + Math.sin(ang) * r * SIZE * 0.5;
    return (
      <Box
        key={i}
        style={{
          position: 'absolute',
          left: lx - 50, top: ly - 8,
          width: 100,
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 12, color: '#cdd9ec', fontWeight: 'bold' }}>{lab}</Text>
      </Box>
    );
  });

  return (
    <Box style={{
      flexGrow: 1, width: '100%', height: '100%',
      backgroundColor: '#0b1018',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Box style={{ width: SIZE + 120, height: SIZE + 60, position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
        <Box style={{ width: SIZE, height: SIZE, position: 'relative' }}>
          <Effect shader={SHADER} data={data} style={{ width: SIZE, height: SIZE }} />
        </Box>
        <Box style={{ position: 'absolute', left: 60, top: 30, width: SIZE, height: SIZE }}>
          {labels}
        </Box>
      </Box>
    </Box>
  );
}
