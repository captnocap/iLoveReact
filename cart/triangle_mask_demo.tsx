// triangle_mask_demo — the SMALLEST honest demo of "paint a pattern onto a shape".
//
// THE LESSON (this is the thing the Studio painter keeps getting wrong):
//   Painting onto a 3D face is NOT "fill a CPU array of texels and dodge the
//   neighbours". It is ONE composite in the fragment shader:
//
//       final = pattern * mask
//
//   - `pattern`  is drawn across the WHOLE surface (here: a grid). It does not
//     know or care what shape it lands on. It is pure function of uv.
//   - `mask`     is an analytic SDF of the shape you are painting onto (here: a
//     triangle). `inside = 1` within the shape, `0` outside, AA'd at the edge.
//   - You multiply them. The grid then appears ON the triangle and NOWHERE else.
//
// That is the whole idea. The grid is "only shown on the triangle" because we
// gate every grid pixel by `inside`. Swap the triangle SDF for a face's UV hull
// and you have correct, bleed-free painting on a 3D mesh face — no per-texel
// bookkeeping, pixel-perfect at any zoom, ~30 lines of WGSL.
//
// Verify:  ./tools/rjit shot triangle_mask_demo --out /tmp/trimask.png

import { useEffect, useState } from 'react';
import { Box, Effect, Text } from '@reactjit/runtime/primitives';

const SIZE = 560;

const SHADER = `
// rotate a 2D point by angle a (radians)
fn rot(p: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * p.x - s * p.y, s * p.x + c * p.y);
}

// IQ's exact equilateral-triangle SDF. Negative INSIDE, positive outside,
// |value| = distance to the edge. r ~= the triangle's reach from center.
fn sdTriangle(p_in: vec2f, r: f32) -> f32 {
  let k = sqrt(3.0);
  var p = p_in;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) {
    p = vec2f(p.x - k * p.y, 0.0 - k * p.x - p.y) / 2.0;
  }
  p.x = p.x - clamp(p.x, 0.0 - 2.0 * r, 0.0);
  return 0.0 - length(p) * sign(p.y);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  // unit-square-centered coords, y up (so the triangle points up).
  var p = (in.uv - vec2f(0.5, 0.5)) * 2.0;
  p.y = 0.0 - p.y;

  // ── 1. the PATTERN: a grid drawn across the entire surface ──────────────
  // It is blind to the shape — just a function of uv. fwidth keeps the lines
  // a crisp ~1px at any zoom (analytic AA, no stair-stepping).
  let cells = 10.0;
  let g = in.uv * cells;
  let fw = max(fwidth(g), vec2f(0.0001, 0.0001));
  let f = abs(fract(g) - vec2f(0.5, 0.5));
  let lineDist = (vec2f(0.5, 0.5) - f) / fw;          // pixels-to-nearest gridline, per axis
  let gridLine = 1.0 - smoothstep(0.0, 1.5, min(lineDist.x, lineDist.y));

  // ── 2. the MASK: an analytic triangle (slowly rotating to prove it's live) ─
  let pr = rot(p, U.time * 0.3);
  let d = sdTriangle(pr, 0.72);
  let aa = max(fwidth(d), 0.001);
  let inside = 1.0 - smoothstep(0.0 - aa, aa, d);     // 1 inside the triangle, 0 outside

  // ── 3. COMPOSE: pattern * mask. The grid is gated by inside, so it shows
  //       on the triangle and nowhere else. THIS multiply is the entire trick. ─
  let bg      = vec3f(0.05, 0.06, 0.10);
  let triFill = vec3f(0.10, 0.14, 0.22);             // faint fill so the shape reads
  let gridCol = vec3f(0.30, 0.95, 0.80);

  var col = bg;
  col = mix(col, triFill, inside);                    // the triangle body
  col = mix(col, gridCol, gridLine * inside);         // <── the grid, masked to the triangle
  return vec4f(col, 1.0);
}
`;

export default function TriangleMaskDemo() {
  // The Effect samples U.time every frame; this re-render just keeps the
  // surface ticking (the host advances U.time on its own).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 33);
    return () => clearInterval(id);
  }, []);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0d13', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 18 }}>
      <Text style={{ fontSize: 14, color: '#7f93b1', letterSpacing: 1 }}>
        grid (pattern)  ×  triangle (mask)  =  grid only on the triangle
      </Text>
      <Box style={{ width: SIZE, height: SIZE, borderRadius: 10, overflow: 'hidden' }}>
        <Effect shader={SHADER} style={{ width: SIZE, height: SIZE }} />
      </Box>
    </Box>
  );
}
