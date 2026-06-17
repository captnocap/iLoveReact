// paint_texture_demo — painting WITH a material shader, at a real WORLD SCALE.
// Closes the texture-painting arc: triangle_mask's `pattern x mask` where the pattern
// is a material (brick/grass — the game catalog shape) AND the texture tiles at a
// chosen physical size instead of being stretched to fit.
//
//   final = material( surfaceUv * tilesAcross ) * paintMask(cell)
//
// tilesAcross = surfaceSize(m) / tileSize(m). The texture is sampled in continuous
// surface space (it spreads across the grid, masked to painted cells — never per-cell),
// and its DENSITY is a world scale, not a default:
//
//   STRETCHED (wrong):  tilesAcross = 1            — one 512 tile smeared over the whole
//                       surface; a huge bridge gets one giant brick. The bad default.
//   PER-CELL  (wrong):  tilesAcross = cells        — one tile crammed per paint cell.
//   WORLD-SCALED (right): tilesAcross = size/tile  — a brick is always ~brick-sized; a
//                       bigger surface just gets MORE bricks, not bigger ones.
//
// Toggle Surface 4 m -> 16 m at a fixed tile size and the bricks stay the same size,
// you just get more of them — that is "don't stretch one texture across a huge surface."
// (And yes — a big bridge is best authored in PARTS; each part is one manageable surface
// carrying its own world-scaled material. Scale per part, compose the parts.)
//
// Verify: ./tools/rjit shot paint_texture_demo --out /tmp/ptex.png   (drag to paint live)

import { useRef, useState } from 'react';
import { Box, Effect, Pressable, Text } from '@reactjit/runtime/primitives';

const SIZE = 540;
const CELLS = 12;                 // paint grid divisions across the surface
const MASK_BASE = 5;              // ys[] index where the per-cell mask begins

const SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;

fn brick(p: vec2f) -> vec3f {
  let uv = p * vec2f(1.0, 1.6);                   // a brick is ~1.6x wider than tall
  let row = floor(uv.y);
  let off = 0.5 * (row - 2.0 * floor(row * 0.5));
  let f = fract(vec2f(uv.x + off, uv.y));
  let m = step(0.06, f.x) * step(0.10, f.y);
  let shade = 0.85 + 0.15 * fract(sin(dot(floor(vec2f(uv.x + off, uv.y)), vec2f(12.9, 78.2))) * 43758.5);
  return mix(vec3f(0.80, 0.78, 0.73), vec3f(0.62, 0.26, 0.22) * shade, m);
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn grass(p: vec2f) -> vec3f {
  let uv = p * 2.4;
  let n = hash(floor(uv * 4.0));
  let streak = 0.5 + 0.5 * sin(uv.x * 25.0 + hash(vec2f(floor(uv.x * 4.0), 1.0)) * 6.2831);
  let g = 0.38 + 0.30 * n + 0.12 * streak;
  return vec3f(0.10 * g, g, 0.14 * g);
}
fn material(id: f32, p: vec2f) -> vec3f {
  if (id < 0.5) { return brick(p); }
  return grass(p);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let cells       = ys[0];
  let tilesAcross = ys[1];   // world density: how many tiles span the surface
  let matId       = ys[2];

  let cell = floor(in.uv * cells);
  let idx  = u32(${MASK_BASE}.0 + cell.y * cells + cell.x);
  let painted = ys[idx];

  let g = in.uv * cells;
  let fw = max(fwidth(g), vec2f(0.0001, 0.0001));
  let ff = abs(fract(g) - vec2f(0.5, 0.5));
  let gridLine = 1.0 - smoothstep(0.0, 1.5, min((0.5 - ff.x) / fw.x, (0.5 - ff.y) / fw.y));

  let bg = vec3f(0.07, 0.08, 0.12);
  // sample the material in continuous surface uv, scaled by the world tile density.
  let mat = material(matId, in.uv * tilesAcross);

  var col = mix(bg, mat, painted);
  col = mix(col, vec3f(0.30, 0.42, 0.52), gridLine * 0.45);
  return vec4f(col, 1.0);
}
`;

function Chip(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onMouseDown={props.onPress} style={{ paddingLeft: 11, paddingRight: 11, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: props.active ? '#27324b' : '#161b26', borderWidth: 1, borderColor: props.active ? '#5fe0bf' : '#2a3140' }}>
      <Text style={{ fontSize: 12, color: props.active ? '#dfe9f5' : '#8aa0bd' }}>{props.label}</Text>
    </Pressable>
  );
}

// world-scaled tile-size options (metres per tile) + the two wrong extremes.
type ScaleMode = { label: string; tilesAcross: (surfaceM: number) => number };
const SCALES: ScaleMode[] = [
  { label: 'Stretched', tilesAcross: () => 1 },              // one tile over the whole surface (bad default)
  { label: '2 m/tile', tilesAcross: (s) => s / 2 },
  { label: '1 m/tile', tilesAcross: (s) => s / 1 },
  { label: '0.5 m/tile', tilesAcross: (s) => s / 0.5 },
  { label: 'Per-cell', tilesAcross: () => CELLS },           // one tile per paint cell (bad)
];

export default function PaintTextureDemo() {
  const [painted, setPainted] = useState<Record<string, true>>({});
  const [mat, setMat] = useState(0);       // 0 brick, 1 grass
  const [scaleIdx, setScaleIdx] = useState(2); // default 1 m/tile — a real world size, NOT stretched
  const [surfaceM, setSurfaceM] = useState(8); // surface side length in metres (segment vs big bridge)
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

  const tilesAcross = SCALES[scaleIdx].tilesAcross(surfaceM);
  const data: number[] = [CELLS, tilesAcross, mat, 0, 0];
  for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) data[MASK_BASE + cy * CELLS + cx] = painted[`${cx}:${cy}`] ? 1 : 0;

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0d13', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
      <Text style={{ fontSize: 14, color: '#7f93b1', letterSpacing: 1 }}>
        texture tiles at a WORLD scale — a bigger surface gets more tiles, not bigger ones
      </Text>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Chip label="Brick" active={mat === 0} onPress={() => setMat(0)} />
        <Chip label="Grass" active={mat === 1} onPress={() => setMat(1)} />
        <Box style={{ width: 1, height: 22, backgroundColor: '#2a3140', marginLeft: 3, marginRight: 3 }} />
        {SCALES.map((s, i) => <Chip key={s.label} label={s.label} active={scaleIdx === i} onPress={() => setScaleIdx(i)} />)}
      </Box>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Text style={{ fontSize: 12, color: '#6f819c' }}>Surface:</Text>
        <Chip label="4 m (segment)" active={surfaceM === 4} onPress={() => setSurfaceM(4)} />
        <Chip label="8 m" active={surfaceM === 8} onPress={() => setSurfaceM(8)} />
        <Chip label="16 m (big bridge)" active={surfaceM === 16} onPress={() => setSurfaceM(16)} />
        <Text style={{ fontSize: 12, color: '#5fe0bf', marginLeft: 6 }}>→ {tilesAcross % 1 === 0 ? tilesAcross : tilesAcross.toFixed(1)} tiles across</Text>
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
