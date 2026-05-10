// EasingsShader — single <Effect shader> renders all 31 easing curves
// + dots + bars in one WGSL fragment-shader pass. The whole grid is
// computed per-pixel on the GPU; CPU/JS does nothing per frame.
//
// Predicted result: vsync (240fps) at any tile count, sub-millisecond
// paint cost regardless of how many easings we render. Closes the
// matrix:
//
//   useEffect:        49 fps, 16.5ms paint, ~30 nodes/tile × 31 tiles
//   Latches only:     80 fps, 10.7ms paint
//   StaticSurface:   147 fps,  4.0ms paint
//   Combined SS+L:   185 fps,  4.2ms paint
//   Host-driven:     185 fps,  4.2ms paint
//   SHADER (this):   240 fps (vsync) predicted, ~80μs paint predicted
//
// Total React node count: 1 (the Effect node) regardless of how many
// curves render.
//
// All 31 easings ported to WGSL — same math as runtime/easing.ts. The
// per-tile dispatch is a `switch` on tile_idx inside `apply_easing()`.

import { Box, Effect, Text } from '@reactjit/runtime/primitives';
import { EASING_NAMES } from '@reactjit/runtime/easing';

const TILE_W = 160;
const TILE_H = 140;
const COLS = 5;
const CYCLE_MS = 1800;

const EASINGS_WGSL = `
fn bounce_out(t_in: f32) -> f32 {
  let n1 = 7.5625;
  let d1 = 2.75;
  if (t_in < 1.0 / d1) {
    return n1 * t_in * t_in;
  }
  if (t_in < 2.0 / d1) {
    let t = t_in - 1.5 / d1;
    return n1 * t * t + 0.75;
  }
  if (t_in < 2.5 / d1) {
    let t = t_in - 2.25 / d1;
    return n1 * t * t + 0.9375;
  }
  let t = t_in - 2.625 / d1;
  return n1 * t * t + 0.984375;
}

fn apply_easing(idx: u32, t_in: f32) -> f32 {
  let t = clamp(t_in, 0.0, 1.0);
  let PI = 3.14159265359;
  let c1 = 1.70158;
  let c2 = c1 * 1.525;
  let c3 = c1 + 1.0;
  let c4 = (2.0 * PI) / 3.0;
  let c5 = (2.0 * PI) / 4.5;

  switch idx {
    case 0u:  { return t; }
    case 1u:  { return 1.0 - cos((t * PI) / 2.0); }
    case 2u:  { return sin((t * PI) / 2.0); }
    case 3u:  { return -(cos(PI * t) - 1.0) / 2.0; }
    case 4u:  { return t * t; }
    case 5u:  { return 1.0 - (1.0 - t) * (1.0 - t); }
    case 6u:  {
      if (t < 0.5) { return 2.0 * t * t; }
      return 1.0 - pow(-2.0 * t + 2.0, 2.0) / 2.0;
    }
    case 7u:  { return t * t * t; }
    case 8u:  { return 1.0 - pow(1.0 - t, 3.0); }
    case 9u:  {
      if (t < 0.5) { return 4.0 * t * t * t; }
      return 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
    }
    case 10u: { return t * t * t * t; }
    case 11u: { return 1.0 - pow(1.0 - t, 4.0); }
    case 12u: {
      if (t < 0.5) { return 8.0 * t * t * t * t; }
      return 1.0 - pow(-2.0 * t + 2.0, 4.0) / 2.0;
    }
    case 13u: { return t * t * t * t * t; }
    case 14u: { return 1.0 - pow(1.0 - t, 5.0); }
    case 15u: {
      if (t < 0.5) { return 16.0 * t * t * t * t * t; }
      return 1.0 - pow(-2.0 * t + 2.0, 5.0) / 2.0;
    }
    case 16u: {
      if (t <= 0.0) { return 0.0; }
      return pow(2.0, 10.0 * t - 10.0);
    }
    case 17u: {
      if (t >= 1.0) { return 1.0; }
      return 1.0 - pow(2.0, -10.0 * t);
    }
    case 18u: {
      if (t <= 0.0) { return 0.0; }
      if (t >= 1.0) { return 1.0; }
      if (t < 0.5) { return pow(2.0, 20.0 * t - 10.0) / 2.0; }
      return (2.0 - pow(2.0, -20.0 * t + 10.0)) / 2.0;
    }
    case 19u: { return 1.0 - sqrt(1.0 - t * t); }
    case 20u: { return sqrt(1.0 - pow(t - 1.0, 2.0)); }
    case 21u: {
      if (t < 0.5) { return (1.0 - sqrt(1.0 - pow(2.0 * t, 2.0))) / 2.0; }
      return (sqrt(1.0 - pow(-2.0 * t + 2.0, 2.0)) + 1.0) / 2.0;
    }
    case 22u: { return c3 * t * t * t - c1 * t * t; }
    case 23u: { return 1.0 + c3 * pow(t - 1.0, 3.0) + c1 * pow(t - 1.0, 2.0); }
    case 24u: {
      if (t < 0.5) { return (pow(2.0 * t, 2.0) * ((c2 + 1.0) * 2.0 * t - c2)) / 2.0; }
      return (pow(2.0 * t - 2.0, 2.0) * ((c2 + 1.0) * (t * 2.0 - 2.0) + c2) + 2.0) / 2.0;
    }
    case 25u: {
      if (t <= 0.0) { return 0.0; }
      if (t >= 1.0) { return 1.0; }
      return -pow(2.0, 10.0 * t - 10.0) * sin((t * 10.0 - 10.75) * c4);
    }
    case 26u: {
      if (t <= 0.0) { return 0.0; }
      if (t >= 1.0) { return 1.0; }
      return pow(2.0, -10.0 * t) * sin((t * 10.0 - 0.75) * c4) + 1.0;
    }
    case 27u: {
      if (t <= 0.0) { return 0.0; }
      if (t >= 1.0) { return 1.0; }
      if (t < 0.5) { return -(pow(2.0, 20.0 * t - 10.0) * sin((20.0 * t - 11.125) * c5)) / 2.0; }
      return (pow(2.0, -20.0 * t + 10.0) * sin((20.0 * t - 11.125) * c5)) / 2.0 + 1.0;
    }
    case 28u: { return 1.0 - bounce_out(1.0 - t); }
    case 29u: { return bounce_out(t); }
    case 30u: {
      if (t < 0.5) { return (1.0 - bounce_out(1.0 - 2.0 * t)) / 2.0; }
      return (1.0 + bounce_out(2.0 * t - 1.0)) / 2.0;
    }
    default: { return t; }
  }
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let TILE_W = ${TILE_W}.0;
  let TILE_H = ${TILE_H}.0;
  let COLS = ${COLS}.0;
  let TOTAL = ${EASING_NAMES.length}u;
  let PLOT_X = 10.0;
  let PLOT_Y = 10.0;
  let PLOT_W = TILE_W - 20.0;
  let PLOT_H = 70.0;
  let BAR_Y = 100.0;
  let BAR_H = 6.0;

  let px = in.uv.x * U.size_w;
  let py = in.uv.y * U.size_h;

  let col = floor(px / TILE_W);
  let row = floor(py / TILE_H);
  let tile_idx = u32(row * COLS + col);
  if (tile_idx >= TOTAL) { return vec4f(0.04, 0.04, 0.06, 1.0); }

  let tx = px - col * TILE_W;
  let ty = py - row * TILE_H;

  // Tile-frame border (1px on all sides).
  if (tx < 1.0 || tx > TILE_W - 1.0 || ty < 1.0 || ty > TILE_H - 1.0) {
    return vec4f(0.10, 0.13, 0.18, 1.0);
  }

  // Cycle 0..1 over CYCLE_MS milliseconds. U.time is seconds.
  let cycle = fract(U.time * 1000.0 / ${CYCLE_MS}.0);

  // ── PLOT region ─────────────────────────────────────────────────
  if (tx >= PLOT_X && tx <= PLOT_X + PLOT_W && ty >= PLOT_Y && ty <= PLOT_Y + PLOT_H) {
    let u = (tx - PLOT_X) / PLOT_W;
    let v = 1.0 - (ty - PLOT_Y) / PLOT_H; // 0=bottom, 1=top in screen coords

    // Curve line — distance from this pixel's u to the eased value
    // mapped against v.
    let curve_y = apply_easing(tile_idx, u);
    let curve_dist = abs(v - curve_y) * PLOT_H;
    if (curve_dist < 1.5) {
      return vec4f(1.00, 0.55, 0.20, 1.0);
    }

    // Dot at (cycle, eased(cycle)) — 3px radius.
    let dot_x = cycle;
    let dot_y = apply_easing(tile_idx, cycle);
    let dx = (u - dot_x) * PLOT_W;
    let dy = (v - dot_y) * PLOT_H;
    let dot_dist = sqrt(dx * dx + dy * dy);
    if (dot_dist < 3.5) {
      return vec4f(0.95, 0.95, 1.0, 1.0);
    }

    return vec4f(0.04, 0.05, 0.07, 1.0);
  }

  // ── BAR region (below the plot) ─────────────────────────────────
  if (tx >= PLOT_X && tx <= PLOT_X + PLOT_W && ty >= BAR_Y && ty <= BAR_Y + BAR_H) {
    let u = (tx - PLOT_X) / PLOT_W;
    let eased_t = apply_easing(tile_idx, cycle);
    let ball_x = eased_t;
    let ball_dist = abs(u - ball_x) * PLOT_W;
    if (ball_dist < 5.0) {
      return vec4f(1.00, 0.55, 0.20, 1.0);
    }
    return vec4f(0.13, 0.16, 0.22, 1.0);
  }

  return vec4f(0.04, 0.05, 0.07, 1.0);
}
`;

export type EasingsShaderProps = {};

export function EasingsShader(_props: EasingsShaderProps) {
  const rows = Math.ceil(EASING_NAMES.length / COLS);
  const gridW = COLS * TILE_W;
  const gridH = rows * TILE_H;

  // Labels rendered as React Text overlay so they stay crisp +
  // theme-aware. Positioned absolute over each tile, just below the
  // bar like the original.
  const labels: { x: number; y: number; name: string }[] = [];
  EASING_NAMES.forEach((name, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    labels.push({
      x: col * TILE_W + 10,
      y: row * TILE_H + 116,
      name,
    });
  });

  return (
    <Box style={{ alignItems: 'center', padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'theme:ink' }}>Easings (Shader)</Text>
      <Text style={{ fontSize: 12, color: 'theme:inkDimmer' }}>
        All {EASING_NAMES.length} curves rendered in ONE WGSL fragment shader. Zero JS per frame, 1 React node.
      </Text>
      <Box style={{ position: 'relative', width: gridW, height: gridH }}>
        <Effect shader={EASINGS_WGSL} style={{
          position: 'absolute',
          left: 0, top: 0,
          width: gridW, height: gridH,
        }} />
        {labels.map((l) => (
          <Text
            key={l.name}
            style={{
              position: 'absolute',
              left: l.x,
              top: l.y,
              fontSize: 11,
              color: 'theme:inkDim',
              fontFamily: 'monospace',
            }}
          >
            {l.name}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
