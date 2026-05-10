// venn_demo — three-circle Venn diagram, pure shader.
//
// Each circle: analytic SDF, translucent fill, crisp white-ish outline.
// Overlap regions emerge naturally from compositing translucent fills —
// no per-region color table needed. The math IS the picture.
//
// Storage layout (flat f32):
//   [0] n_circles            (max 3 here)
//   [1] outline_width        (in normalized half-screen units)
//   [2..3] reserved
//   [4 + i*4 ..]             per circle: cx, cy, r, _pad
//   [4 + n*4 + i*4 ..]       per circle fill: r, g, b, alpha
//
// Layout assumes a square surface; uv is mapped to [-1, 1] both axes.

import { useEffect, useMemo, useState } from 'react';
import { Box, Effect, Text } from '@reactjit/runtime/primitives';

const SIZE = 520;

// Three sets, three colors. Saturation tuned so triple-overlap goes white-ish
// without saturating to mud. Alpha kept low (~0.55) so two-way overlap is
// readable as a distinct color band.
//
// Coordinate convention: shader's `p = (uv - 0.5) * 2` gives screen-y
// (positive y = DOWN). So the "top" circle has cy < 0. Label offsets use
// the same convention.
const CIRCLES: { cx: number; cy: number; r: number; color: [number, number, number]; alpha: number; label: string; labelOffset: [number, number] }[] = [
  { cx:  0.00, cy: -0.30, r: 0.46, color: [0.40, 0.78, 0.94], alpha: 0.55, label: 'Designers', labelOffset: [ 0.00, -0.86] },
  { cx: -0.30, cy:  0.18, r: 0.46, color: [0.94, 0.45, 0.71], alpha: 0.55, label: 'Engineers', labelOffset: [-0.86,  0.18] },
  { cx:  0.30, cy:  0.18, r: 0.46, color: [0.36, 0.83, 0.60], alpha: 0.55, label: 'PMs',       labelOffset: [ 0.86,  0.18] },
];

const SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = u32(ys[0]);
  let outline_w = ys[1];

  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;

  var rgb = vec3f(0.0);
  var alpha = 0.0;
  var outline_a = 0.0;

  for (var i: u32 = 0u; i < n; i = i + 1u) {
    let cb = 4u + i * 4u;
    let cx = ys[cb + 0u];
    let cy = ys[cb + 1u];
    let r = ys[cb + 2u];

    let kb = 4u + n * 4u + i * 4u;
    let kr = ys[kb + 0u];
    let kg = ys[kb + 1u];
    let kb_ = ys[kb + 2u];
    let ka = ys[kb + 3u];

    let d = length(p - vec2f(cx, cy)) - r;
    let aa = max(fwidth(d), 0.001);

    // Translucent fill: classic over-composite.
    //   out_rgb = src_rgb*src_a + dst_rgb*(1-src_a)
    //   out_a   = src_a + dst_a*(1-src_a)
    let cov = 1.0 - smoothstep(-aa, aa, d);
    let src_a = cov * ka;
    rgb = vec3f(kr, kg, kb_) * src_a + rgb * (1.0 - src_a);
    alpha = src_a + alpha * (1.0 - src_a);

    // Crisp outline at d ≈ 0: thin band around the circle boundary.
    let on_edge = (1.0 - smoothstep(outline_w - aa, outline_w + aa, abs(d)));
    outline_a = max(outline_a, on_edge);
  }

  // Outline composites on top in near-white.
  let outline_rgb = vec3f(0.92, 0.95, 1.0);
  let final_rgb = outline_rgb * outline_a + rgb * (1.0 - outline_a);
  let final_a = max(alpha, outline_a);
  if (final_a <= 0.001) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  return vec4f(final_rgb * final_a, final_a);
}
`;

export default function VennDemo() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 33);
    return () => clearInterval(id);
  }, []);

  // Circles drift slightly so the overlap regions move and you can watch the
  // AA hold up under motion (worst case for any rasterizer).
  const drift = useMemo(() => {
    return CIRCLES.map((c, i) => {
      const dx = 0.04 * Math.sin(tick * 0.025 + i * 2.1);
      const dy = 0.04 * Math.cos(tick * 0.022 + i * 1.7);
      return { ...c, cx: c.cx + dx, cy: c.cy + dy };
    });
  }, [tick]);

  const data = useMemo(() => {
    const n = drift.length;
    const out: number[] = [];
    out.push(n);
    out.push(0.005);             // outline width (half-screen units, ~1.3px @ 520)
    out.push(0.0);
    out.push(0.0);
    for (const c of drift) {
      out.push(c.cx, c.cy, c.r, 0.0);
    }
    for (const c of drift) {
      out.push(c.color[0], c.color[1], c.color[2], c.alpha);
    }
    return out;
  }, [drift]);

  // Labels: positioned in normalized [-1,1] space, scaled to SIZE pixels.
  // Both shader p.y and labelOffset.y use screen-y (positive = down).
  const labels = drift.map((c, i) => {
    const ox = c.labelOffset[0];
    const oy = c.labelOffset[1];
    const px = SIZE * 0.5 + ox * SIZE * 0.5;
    const py = SIZE * 0.5 + oy * SIZE * 0.5;
    const hex = `rgb(${(c.color[0] * 255) | 0}, ${(c.color[1] * 255) | 0}, ${(c.color[2] * 255) | 0})`;
    return (
      <Box
        key={i}
        style={{
          position: 'absolute',
          left: px - 60, top: py - 12,
          width: 120,
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 13, color: hex, fontWeight: 'bold' }}>{c.label}</Text>
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
