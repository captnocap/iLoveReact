// triangle_mask_demo — "paint a pattern onto a shape", and the no-spill law.
//
// THE LESSON (the thing the Studio painter keeps getting wrong):
//   Painting onto a face is ONE composite in the fragment shader:
//
//       final = pattern * mask
//
//   - `pattern` (a grid) is drawn across the WHOLE surface; pure function of uv,
//     blind to any shape.
//   - `mask` is the SHAPE you are painting onto. Here there are SEVERAL triangles
//     sitting together, sharing edges. Each pixel asks "which triangle owns me?".
//
// THE NO-SPILL LAW (what this revision proves):
//   Hover a triangle and the grid CELL under the cursor highlights — but only the
//   part of that cell that lies inside the HOVERED triangle. A cell straddling a
//   shared edge has its other half owned by the neighbour, so that half stays dark.
//   The clip is per-PIXEL: `highlight = inHoveredCell AND (fragTri == hoveredTri)`.
//   Not a bounding-box clamp (what the current painter does, which leaks across
//   slanted shared edges) — the actual geometry decides, pixel by pixel.
//
// This is exactly transferable to 3D: on a real mesh the rasterizer already gives
// you the per-pixel "which face owns me" for free (it only shades covered pixels)
// and the interpolated uv for free. The grid stays the same; the mask becomes the
// hardware.  Verify: ./tools/rjit shot triangle_mask_demo --out /tmp/trimask.png

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect, Text } from '@reactjit/runtime/primitives';

const SIZE = 560;
const CELLS = 12; // grid divisions across the surface (cells straddle shared edges)

// A cluster of triangles that all sit together, in uv space [0,1].
// A square split into 4 by both diagonals (they meet at the center M), plus two
// outer caps sharing an outer edge — so several pairs touch along a shared edge.
const A: [number, number] = [0.18, 0.18];
const B: [number, number] = [0.82, 0.18];
const C: [number, number] = [0.82, 0.82];
const D: [number, number] = [0.18, 0.82];
const M: [number, number] = [0.5, 0.5];
const TRIS: Array<[[number, number], [number, number], [number, number]]> = [
  [A, B, M],            // 0  top    (inside square)
  [B, C, M],            // 1  right
  [C, D, M],            // 2  bottom
  [D, A, M],            // 3  left
  [A, B, [0.5, 0.03]],  // 4  cap above — shares edge A–B with #0
  [B, C, [0.97, 0.5]],  // 5  cap right — shares edge B–C with #1
];

const SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

fn dot2(v: vec2f) -> f32 { return dot(v, v); }

// IQ's signed distance to an arbitrary triangle (any winding). Negative inside.
fn sdTri(p: vec2f, p0: vec2f, p1: vec2f, p2: vec2f) -> f32 {
  let e0 = p1 - p0; let e1 = p2 - p1; let e2 = p0 - p2;
  let v0 = p - p0; let v1 = p - p1; let v2 = p - p2;
  let pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  let pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  let pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  let s = sign(e0.x * e2.y - e0.y * e2.x);
  var d = min(vec2f(dot2(pq0), s * (v0.x * e0.y - v0.y * e0.x)),
              vec2f(dot2(pq1), s * (v1.x * e1.y - v1.y * e1.x)));
  d = min(d, vec2f(dot2(pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return 0.0 - sqrt(d.x) * sign(d.y);
}

// read triangle i's k-th vertex out of the flat data buffer
fn triVert(i: u32, k: u32) -> vec2f {
  let base = 5u + i * 6u + k * 2u;
  return vec2f(ys[base], ys[base + 1u]);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let cells       = ys[0];
  let mouseInside = ys[1];
  let mp          = vec2f(ys[2], ys[3]);   // mouse position, uv space
  let nTris       = u32(ys[4]);
  let p = in.uv;

  // ── PATTERN: a grid across the whole surface (crisp AA via fwidth) ──────────
  let g = in.uv * cells;
  let fw = max(fwidth(g), vec2f(0.0001, 0.0001));
  let f = abs(fract(g) - vec2f(0.5, 0.5));
  let lineDist = (vec2f(0.5, 0.5) - f) / fw;
  let gridLine = 1.0 - smoothstep(0.0, 1.5, min(lineDist.x, lineDist.y));

  // ── MASK: which triangle OWNS this fragment? (argmin signed distance) ───────
  var fragTri = -1;
  var fragD = 1e9;
  for (var i: u32 = 0u; i < nTris; i = i + 1u) {
    let d = sdTri(p, triVert(i, 0u), triVert(i, 1u), triVert(i, 2u));
    if (d < fragD) { fragD = d; fragTri = i32(i); }
  }
  let aaFill = max(fwidth(fragD), 0.001);
  let inAny = 1.0 - smoothstep(0.0 - aaFill, aaFill, fragD); // union coverage, AA at outer edge

  // ── which triangle does the MOUSE sit in? ───────────────────────────────────
  var hovTri = -1;
  if (mouseInside > 0.5) {
    var hd = 1e9;
    for (var i: u32 = 0u; i < nTris; i = i + 1u) {
      let d = sdTri(mp, triVert(i, 0u), triVert(i, 1u), triVert(i, 2u));
      if (d < hd) { hd = d; hovTri = i32(i); }
    }
    if (hd > 0.0) { hovTri = -1; } // mouse outside every triangle
  }

  // ── HOVER HIGHLIGHT, clipped per-pixel to the hovered triangle ──────────────
  // Light a fragment iff it shares the mouse's grid cell AND its owning triangle
  // IS the hovered one. A straddling cell's other half (fragTri != hovTri) stays
  // dark — the spill is impossible by construction, not by a clamp box.
  let fragCell  = floor(in.uv * cells);
  let mouseCell = floor(mp * cells);
  let sameCell  = (fragCell.x == mouseCell.x) && (fragCell.y == mouseCell.y);
  let isHover   = sameCell && (hovTri >= 0) && (fragTri == hovTri);
  let hoverMask = select(0.0, inAny, isHover);

  // per-triangle tint so the separate faces read
  var tint = vec3f(0.10, 0.14, 0.22);
  if (fragTri >= 0) {
    let h = f32(fragTri) * 1.7;
    tint = vec3f(0.11 + 0.05 * sin(h), 0.14 + 0.05 * sin(h + 2.0), 0.20 + 0.06 * sin(h + 4.0));
  }

  let bg       = vec3f(0.05, 0.06, 0.10);
  let gridCol  = vec3f(0.30, 0.95, 0.80);
  let hoverCol = vec3f(1.0, 0.72, 0.18);

  var col = bg;
  col = mix(col, tint, inAny);                 // triangle bodies
  col = mix(col, hoverCol, hoverMask * 0.65);  // hovered cell, clipped to its triangle
  col = mix(col, gridCol, gridLine * inAny);   // grid, masked to the union
  return vec4f(col, 1.0);
}
`;

type Mouse = { inside: boolean; u: number; v: number };

export default function TriangleMaskDemo() {
  const [mouse, setMouse] = useState<Mouse>({ inside: false, u: 0, v: 0 });
  const rectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // A Pressable's onMouseMove only fires while a button is HELD — a free-moving
  // cursor delivers no events (engine.zig gates .move on dragging_left). The host
  // tracks the live cursor at getMouseX/getMouseY, so poll it: convert screen → the
  // surface's uv via the onLayout rect, mark inside when the cursor is over it.
  useEffect(() => {
    const host: any = globalThis as any;
    const id = setInterval(() => {
      const r = rectRef.current;
      if (!r || typeof host.getMouseX !== 'function') return;
      const mx = Number(host.getMouseX()), my = Number(host.getMouseY());
      if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
      const inside = mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height;
      const u = (mx - r.x) / Math.max(1, r.width);
      const v = (my - r.y) / Math.max(1, r.height);
      setMouse((m) => (m.inside === inside && m.u === u && m.v === v ? m : { inside, u, v }));
    }, 33);
    return () => clearInterval(id);
  }, []);

  const data = useMemo(() => {
    const out: number[] = [CELLS, mouse.inside ? 1 : 0, mouse.u, mouse.v, TRIS.length];
    for (const t of TRIS) for (const v of t) out.push(v[0], v[1]);
    return out;
  }, [mouse]);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0d13', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <Text style={{ fontSize: 14, color: '#7f93b1', letterSpacing: 1 }}>
        hover a triangle — the cell highlights, and STOPS at the shared edge
      </Text>
      <Box
        onLayout={(r: any) => { rectRef.current = r; }}
        style={{ width: SIZE, height: SIZE, borderRadius: 10, overflow: 'hidden', position: 'relative' }}
      >
        <Effect shader={SHADER} data={data} style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE }} />
      </Box>
    </Box>
  );
}
