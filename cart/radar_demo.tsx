// radar_demo -- radar/spider chart, hybrid render.
//
// Architectural lesson learned: drawing N polygon segments as ONE composite
// SDF in a fragment shader has a fundamental AA problem -- fwidth evaluates
// a function with derivative kinks at every segment boundary, and those
// spikes cause visible bleeding (the "broken circle" outside the heptagon).
// You can move the bug around with clamps and per-segment loops, but you
// can't fully eliminate it because it's inherent to how min() / wedge logic
// evaluate in a single SDF.
//
// Right answer: per-segment analytic capsules. The framework already has
// this -- Graph.Polyline (framework/gpu/capsules.zig) renders each segment
// as its own capsule with its own clean per-segment AA. Proven clean in
// chart_bench's POLYLINE mode.
//
// Hybrid split:
//   - Shader (Effect):   translucent fill of the data polygon (dynamic)
//   - Graph + Polyline:  4 grid heptagons + 7 axis spokes + data outline
//   - TSX:               labels
//
// Shader storage layout (flat f32):
//   [0] n_axes
//   [1] max_r
//   [2..7] reserved
//   [8 + i] axis value (0..1)

import { useEffect, useState } from 'react';
import { Box, Effect, Graph, Text } from '@reactjit/runtime/primitives';

const SIZE = 540;
const N = 7;
const LABELS = ['Speed', 'Power', 'Range', 'Stealth', 'Cost', 'Reliability', 'Comfort'];
const TARGETS = [0.85, 0.70, 0.55, 0.92, 0.40, 0.75, 0.62];

const MAX_R = 0.82;
const FILL_RGB: [number, number, number] = [0.36, 0.83, 0.60];

// Shader: ONLY the translucent fill of the data polygon. No grid, no spokes,
// no outline -- those are drawn cleanly via Graph.Polyline on top.
const SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = u32(ys[0]);
  let max_r = ys[1];

  let TAU = 6.28318530718;
  let p = (in.uv - vec2f(0.5, 0.5)) * 2.0;
  let d = length(p);
  if (d > max_r + 0.01) { return vec4f(0.0, 0.0, 0.0, 0.0); }

  let theta = atan2(p.y, p.x);
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

  // Inside test: ray from origin at angle theta intersects segment AB at radius r_edge.
  let dir = vec2f(cos(theta), sin(theta));
  let denom = dir.x * (B.y - A.y) - dir.y * (B.x - A.x);
  let r_edge = (A.x * (B.y - A.y) - A.y * (B.x - A.x)) / denom;
  let inside = step(d, r_edge);

  let alpha = inside * 0.32;
  if (alpha <= 0.001) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let fill = vec3f(${FILL_RGB[0]}, ${FILL_RGB[1]}, ${FILL_RGB[2]});
  return vec4f(fill * alpha, alpha);
}
`;

const CX = SIZE / 2;
const CY = SIZE / 2;
const R = SIZE / 2;

// Polygon vertices at radii v[i] (each in [0..1] * MAX_R).
// Returns a closed polyline: first vertex appended at end.
function ringPoints(values: number[]): number[] {
  const out: number[] = [];
  const n = values.length;
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const ang = -Math.PI / 2 + (Math.PI * 2 * k) / n;
    const v = values[k] * MAX_R;
    out.push(CX + Math.cos(ang) * v * R);
    out.push(CY + Math.sin(ang) * v * R);
  }
  return out;
}

// Concentric heptagon at constant radius v * MAX_R.
function gridRingPoints(v: number): number[] {
  return ringPoints(new Array(N).fill(v));
}

// Axis spoke: 2 points (center, outer vertex).
function spokePoints(i: number): number[] {
  const ang = -Math.PI / 2 + (Math.PI * 2 * i) / N;
  return [
    CX, CY,
    CX + Math.cos(ang) * MAX_R * R,
    CY + Math.sin(ang) * MAX_R * R,
  ];
}

const GRID_COLOR = '#3a4660';
const SPOKE_COLOR = '#2c364c';
const OUTLINE_COLOR = '#5cd49a';

export default function RadarDemo() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 33);
    return () => clearInterval(id);
  }, []);

  // Live values for the data polygon.
  const values = TARGETS.map((t, i) => t * (0.9 + 0.1 * Math.sin(tick * 0.05 + i * 1.4)));

  // Shader buffer for the fill.
  const data: number[] = [];
  data.push(N);
  data.push(MAX_R);
  data.push(0); data.push(0); data.push(0); data.push(0); data.push(0); data.push(0);
  for (const v of values) data.push(v);

  const dataPolyline = ringPoints(values);

  const labels = LABELS.map((lab, i) => {
    const ang = -Math.PI / 2 + (Math.PI * 2 * i) / N;
    const r = 0.94;
    const lx = CX + Math.cos(ang) * r * R;
    const ly = CY + Math.sin(ang) * r * R;
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
          {/* Layer 1: shader fill (translucent green data polygon) */}
          <Effect shader={SHADER} data={data} style={{ width: SIZE, height: SIZE }} />

          {/* Layer 2: web (grid heptagons + spokes) via Graph.Polyline.
              Per-segment capsule AA -- no fwidth coupling, no broken circle. */}
          <Box style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE }}>
            <Graph style={{ width: SIZE, height: SIZE }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
              {/* Spokes (drawn first, under rings) */}
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <Graph.Polyline key={`sp${i}`} points={spokePoints(i)} stroke={SPOKE_COLOR} strokeWidth={1.25} />
              ))}
              {/* 4 grid heptagons */}
              <Graph.Polyline points={gridRingPoints(0.25)} stroke={GRID_COLOR} strokeWidth={1.5} />
              <Graph.Polyline points={gridRingPoints(0.50)} stroke={GRID_COLOR} strokeWidth={1.5} />
              <Graph.Polyline points={gridRingPoints(0.75)} stroke={GRID_COLOR} strokeWidth={1.5} />
              <Graph.Polyline points={gridRingPoints(1.00)} stroke={GRID_COLOR} strokeWidth={1.5} />
              {/* Data polygon outline (on top of fill, under labels) */}
              <Graph.Polyline points={dataPolyline} stroke={OUTLINE_COLOR} strokeWidth={2.25} />
            </Graph>
          </Box>
        </Box>

        {/* Layer 3: labels */}
        <Box style={{ position: 'absolute', left: 60, top: 30, width: SIZE, height: SIZE }}>
          {labels}
        </Box>
      </Box>
    </Box>
  );
}
