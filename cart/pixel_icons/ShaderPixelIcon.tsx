// ShaderPixelIcon — render a PixelMatrix as a single GPU quad via <Effect>.
//
// Replaces the box-per-cell <PixelIcon> for any case where the cells don't
// need to be individually styleable / hit-targeted. Wins:
//   - 1 draw call per icon instead of N² (where N = matrix size)
//   - No layout cost — one quad fills the icon's box
//   - Renders at any scale without the rect-shader AA-on-1px-cells dimming
//   - Animation = swap the pixels portion of the data array; no React
//     reconciliation, no relayout, no per-cell paint
//
// Data layout (all f32 in the storage buffer):
//   [0]                       size            (e.g. 64.0)
//   [1]                       palette_count   (e.g. 64.0)
//   [2 .. 2+pc*3]             palette RGB triples, normalized 0..1
//   [2+pc*3 .. +size²]        per-cell palette index, or -1 for null
//
// The shader walks uv → cell (cx, cy) → pixel index → palette lookup → color.
// uv.y is inverted (framebuffer y=0 → uv.y=1, per v8_app.zig:2251), so we
// use (1 - uv.y) to get top-down row order matching the matrix layout.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Effect } from '@reactjit/runtime/primitives';
import type { PixelMatrix } from './PixelIcon';

const SHADER = `
@group(0) @binding(1) var<storage, read> data: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let size = data[0];
  let pal_count = u32(data[1]);
  let isize = u32(size);
  // uv.y=0 is at the top of the rendered quad (matches matrix row 0), so
  // sample directly — no inversion. The Effect prelude comment about
  // "framebuffer y=0 → uv.y=1" describes how the fullscreen-triangle
  // vertex shader writes texture rows; the sampling we do here uses the
  // resulting uv that arrives at the fragment shader, which is top-down.
  let cx_f = floor(in.uv.x * size);
  let cy_f = floor(in.uv.y * size);
  // Clamp to in-range (the 3-vertex over-draw triangle can extend uv slightly
  // past [0,1] at the edges; without the clamp we sample out-of-bounds and
  // hit garbage palette indices on the rightmost/bottommost row).
  let cx = u32(clamp(cx_f, 0.0, size - 1.0));
  let cy = u32(clamp(cy_f, 0.0, size - 1.0));
  let pixel_idx = cy * isize + cx;
  let p_offset = 2u + pal_count * 3u;
  let raw = data[p_offset + pixel_idx];
  if (raw < 0.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let pal_idx = u32(raw);
  let base = 2u + pal_idx * 3u;
  let r = data[base];
  let g = data[base + 1u];
  let b = data[base + 2u];
  // Framework blend uses premultiplied alpha; for opaque cells α=1 this is a
  // no-op.
  return vec4f(r, g, b, 1.0);
}
`;

function paletteToFloats(palette: string[]): number[] {
  const out = new Array<number>(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    const hex = palette[i];
    out[i * 3 + 0] = parseInt(hex.slice(1, 3), 16) / 255;
    out[i * 3 + 1] = parseInt(hex.slice(3, 5), 16) / 255;
    out[i * 3 + 2] = parseInt(hex.slice(5, 7), 16) / 255;
  }
  return out;
}

function packMatrix(m: PixelMatrix): number[] {
  const palFloats = paletteToFloats(m.palette);
  const out = new Array<number>(2 + palFloats.length + m.pixels.length);
  out[0] = m.size;
  out[1] = m.palette.length;
  for (let i = 0; i < palFloats.length; i++) out[2 + i] = palFloats[i];
  const off = 2 + palFloats.length;
  for (let i = 0; i < m.pixels.length; i++) {
    const p = m.pixels[i];
    out[off + i] = p == null ? -1 : p;
  }
  return out;
}

export function ShaderPixelIcon({ data, pixelSize }: { data: PixelMatrix; pixelSize: number }) {
  const packed = useMemo(() => packMatrix(data), [data]);
  const dim = data.size * pixelSize;
  return <Effect shader={SHADER} data={packed} style={{ width: dim, height: dim }} />;
}

// ShaderAnimIcon — same shader, but cycles `frames` under a stable palette.
// The header (size + palette_count + palette) is packed once via useMemo;
// only the per-frame pixel slice gets rewritten each tick. Animation playback
// is "memcpy size² f32s into the storage buffer" — no React reconciliation.

export type AnimIconLike = {
  size: number;
  palette: string[];
  fps: number;
  frames: Array<{ pixels: Array<number | null> }>;
};

export function ShaderAnimIcon({ data, pixelSize }: { data: AnimIconLike; pixelSize: number }) {
  const [idx, setIdx] = useState(0);
  // Pause when document not visible to avoid burning cycles on hidden tabs.
  const idxRef = useRef(idx); idxRef.current = idx;
  useEffect(() => {
    if (data.frames.length <= 1) return;
    const h = setInterval(() => {
      setIdx((i) => (i + 1) % data.frames.length);
    }, Math.max(33, Math.floor(1000 / data.fps)));
    return () => clearInterval(h);
  }, [data]);

  const header = useMemo(() => {
    const palFloats = paletteToFloats(data.palette);
    const h = new Array<number>(2 + palFloats.length);
    h[0] = data.size;
    h[1] = data.palette.length;
    for (let i = 0; i < palFloats.length; i++) h[2 + i] = palFloats[i];
    return h;
  }, [data]);

  const packed = useMemo(() => {
    const frame = data.frames[idx] ?? data.frames[0];
    const out = new Array<number>(header.length + frame.pixels.length);
    for (let i = 0; i < header.length; i++) out[i] = header[i];
    const off = header.length;
    for (let i = 0; i < frame.pixels.length; i++) {
      const p = frame.pixels[i];
      out[off + i] = p == null ? -1 : p;
    }
    return out;
  }, [header, idx, data.frames]);

  const dim = data.size * pixelSize;
  return <Effect shader={SHADER} data={packed} style={{ width: dim, height: dim }} />;
}
