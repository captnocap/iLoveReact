// paint_texture_demo — painting WITH a shader/texture, the right way. The closing
// piece: this is triangle_mask_demo's `pattern x mask` with the pattern being a real
// material shader (brick / grass / ... the game-editor texture catalog) instead of a
// flat colour.
//
// THE GOTCHA (req after req_1258): you do NOT want the texture to repeat per cell.
// A brick wall painted over 6 cells must be ONE continuous wall flowing across them,
// not 6 tiny independent brick tiles. The whole difference is which UV the shader
// samples:
//
//   CONTINUOUS (right):  colour = material( uv )            — uv is SURFACE space, so
//                        the texture spreads across the entire grid; the paint mask
//                        only chooses WHERE it shows. Adjacent painted cells continue
//                        the same wall.
//   PER-CELL (wrong):    colour = material( fract(uv*cells) ) — every cell samples the
//                        full 0..1 tile, so the texture repeats once per cell. Ugly.
//
// In both cases:  final = material(...) * paintMask(cell).  The mask is the painted
// cells; the material is the pattern. Toggle the mode button to see why continuous is
// the only correct one. The same applies on the 3D model: the mesh samples the material
// in its FACE-surface uv (continuous), masked by the paint layer — never per-cell.
//
// Verify: ./tools/rjit shot paint_texture_demo --out /tmp/ptex.png   (drag to paint live)

import { useRef, useState } from 'react';
import { Box, Effect, Pressable, Text } from '@reactjit/runtime/primitives';

const SIZE = 560;
const CELLS = 12;                 // paint grid divisions across the surface
const MASK_BASE = 5;              // ys[] index where the per-cell mask begins

// One Effect over the whole surface. The mask (which cells are painted) rides in the
// data buffer; the shader samples the chosen material either in continuous surface uv
// or per-cell, and shows it only where the cell is painted.
const SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

// ── materials (each maps a [0,1]^2 coord -> colour; the game catalog shaders look
//    exactly like this — a function of a tile-local uv). ──
fn brick(p: vec2f) -> vec3f {
  let uv = p * vec2f(7.0, 11.0);          // bricks across the surface
  let row = floor(uv.y);
  let off = 0.5 * (row - 2.0 * floor(row * 0.5)); // half-offset on odd rows
  let f = fract(vec2f(uv.x + off, uv.y));
  let m = step(0.06, f.x) * step(0.10, f.y);      // 1 = brick face, 0 = mortar
  let shade = 0.85 + 0.15 * fract(sin(dot(floor(vec2f(uv.x + off, uv.y)), vec2f(12.9, 78.2))) * 43758.5);
  return mix(vec3f(0.80, 0.78, 0.73), vec3f(0.62, 0.26, 0.22) * shade, m);
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn grass(p: vec2f) -> vec3f {
  let uv = p * 26.0;
  let n = hash(floor(uv));
  let streak = 0.5 + 0.5 * sin(uv.x * 6.2831 + hash(vec2f(floor(uv.x), 1.0)) * 6.2831);
  let g = 0.38 + 0.30 * n + 0.12 * streak;
  return vec3f(0.10 * g, g, 0.14 * g);
}
fn material(id: f32, p: vec2f) -> vec3f {
  if (id < 0.5) { return brick(p); }
  return grass(p);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let cells = ys[0];
  let mode  = ys[1];   // 0 = continuous (surface uv), 1 = per-cell (repeats)
  let matId = ys[2];

  let cell = floor(in.uv * cells);
  let idx  = u32(${MASK_BASE}.0 + cell.y * cells + cell.x);
  let painted = ys[idx];

  // grid lines so the cells are visible (faint)
  let g = in.uv * cells;
  let fw = max(fwidth(g), vec2f(0.0001, 0.0001));
  let ff = abs(fract(g) - vec2f(0.5, 0.5));
  let gridLine = 1.0 - smoothstep(0.0, 1.5, min((0.5 - ff.x) / fw.x, (0.5 - ff.y) / fw.y));

  let bg = vec3f(0.07, 0.08, 0.12);
  // CONTINUOUS samples the material in surface uv (texture spans the whole grid);
  // PER-CELL samples fract(uv*cells) so each cell repeats the full tile.
  let sampleUv = select(in.uv, fract(in.uv * cells), mode > 0.5);
  let mat = material(matId, sampleUv);

  // final = material * paintMask, over the background.
  var col = mix(bg, mat, painted);
  col = mix(col, vec3f(0.30, 0.42, 0.52), gridLine * 0.5); // grid on top, subtle
  return vec4f(col, 1.0);
}
`;

function Chip(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onMouseDown={props.onPress} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: props.active ? '#27324b' : '#161b26', borderWidth: 1, borderColor: props.active ? '#5fe0bf' : '#2a3140' }}>
      <Text style={{ fontSize: 12, color: props.active ? '#dfe9f5' : '#8aa0bd' }}>{props.label}</Text>
    </Pressable>
  );
}

export default function PaintTextureDemo() {
  const [painted, setPainted] = useState<Record<string, true>>({});
  const [mode, setMode] = useState<'continuous' | 'percell'>('continuous');
  const [mat, setMat] = useState(0); // 0 brick, 1 grass
  const drawingRef = useRef(false);
  const rectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const paintAt = (screenX: number, screenY: number) => {
    const r = rectRef.current;
    if (!r) return;
    const cx = Math.floor(((screenX - r.x) / Math.max(1, r.width)) * CELLS);
    const cy = Math.floor(((screenY - r.y) / Math.max(1, r.height)) * CELLS);
    if (cx < 0 || cx >= CELLS || cy < 0 || cy >= CELLS) return;
    const key = `${cx}:${cy}`;
    setPainted((p) => (p[key] ? p : { ...p, [key]: true }));
  };

  // pack header + the per-cell mask (row-major) into the data buffer.
  const data: number[] = [CELLS, mode === 'percell' ? 1 : 0, mat, 0, 0];
  for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) data[MASK_BASE + cy * CELLS + cx] = painted[`${cx}:${cy}`] ? 1 : 0;

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0d13', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <Text style={{ fontSize: 14, color: '#7f93b1', letterSpacing: 1 }}>
        drag to paint — the texture spreads across the whole grid, shown only where painted
      </Text>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Chip label="Brick" active={mat === 0} onPress={() => setMat(0)} />
        <Chip label="Grass" active={mat === 1} onPress={() => setMat(1)} />
        <Box style={{ width: 1, height: 22, backgroundColor: '#2a3140', marginLeft: 4, marginRight: 4 }} />
        <Chip label="Continuous (right)" active={mode === 'continuous'} onPress={() => setMode('continuous')} />
        <Chip label="Per-cell (repeats)" active={mode === 'percell'} onPress={() => setMode('percell')} />
        <Box style={{ width: 1, height: 22, backgroundColor: '#2a3140', marginLeft: 4, marginRight: 4 }} />
        <Chip label="Clear" active={false} onPress={() => setPainted({})} />
      </Box>
      <Box onLayout={(r: any) => { rectRef.current = r; }} style={{ width: SIZE, height: SIZE, position: 'relative', borderRadius: 10, overflow: 'hidden' }}>
        <Effect shader={SHADER} data={data} style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE }} />
        <Pressable
          style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, backgroundColor: '#00000000' }}
          onMouseDown={(e: any) => { drawingRef.current = true; paintAt(e.x, e.y); }}
          onMouseMove={(e: any) => { if (drawingRef.current) paintAt(e.x, e.y); }}
          onMouseUp={() => { drawingRef.current = false; }}
          onMouseLeave={() => { drawingRef.current = false; }}
        />
      </Box>
    </Box>
  );
}
