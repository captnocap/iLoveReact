// editor/textures/pixelTexture.ts — palette-indexed pixel textures.
//
// An imported image can live as a PIXEL TEXTURE: a palette + indexed cells,
// quantized by the host (__imageops_quantize, median-cut, no dithering — the
// same "store the program, not the raster" principle as paint). The payload
// renders through ONE tiny WGSL shader whose data[] carries the whole texture
// (the pixel_icon gallery pattern: pack a struct into a flat f32 array), so a
// pixel texture IS a shader recipe — Effect previews, the paint-material bake,
// and stroke-program replay all consume it through the existing contract with
// zero new host machinery. The palette rides as data, which is what makes the
// texture recolorable at all.
//
// data[] layout (PIXEL_TEXTURE_SHADER):
//   D[0]=w  D[1]=h  D[2]=k
//   k > 0 (palette mode): D[3 .. 3+k*3) palette RGB 0..1, then w*h cell
//     indices (one float each; -1 = transparent).
//   k = 0 (raw mode, exact images): D[3 ..) w*h*3 RGB floats.
import type { Rgb } from '../data/types';

export const PIXEL_TRANSPARENT = 255;

export const PIXEL_TEXTURE_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let w = i32(D[0] + 0.5);
  let h = i32(D[1] + 0.5);
  let k = i32(D[2] + 0.5);
  if (w < 1 || h < 1) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let uv = fract(in.uv);
  let x = clamp(i32(uv.x * f32(w)), 0, w - 1);
  let y = clamp(i32(uv.y * f32(h)), 0, h - 1);
  let cell = y * w + x;
  if (k > 0) {
    let idx = i32(D[u32(3 + k * 3 + cell)] + 0.5);
    if (idx < 0 || idx >= k) { return vec4f(0.0, 0.0, 0.0, 0.0); }
    let p = u32(3 + idx * 3);
    return vec4f(D[p], D[p + 1u], D[p + 2u], 1.0);
  }
  let p = u32(3 + cell * 3);
  return vec4f(D[p], D[p + 1u], D[p + 2u], 1.0);
}
`;

export type QuantizeProbe = {
  width: number;
  height: number;
  colors: number;
  /** Mean squared RGB error over opaque pixels (0..~195075). ~sqrt/channel:
   *  600 ≈ imperceptible on game textures, 2500+ ≈ visible banding. */
  mse: number;
  palette: Rgb[]; // 0..1
  indices: Uint8Array; // w*h, 255 = transparent
};

/** Parse __imageops_quantize's binary layout:
 *  [w u32][h u32][k u32][mse f32][palette k*3][indices w*h]. */
export function parseQuantizeProbe(bytes: Uint8Array | null): QuantizeProbe | null {
  if (!bytes || bytes.length < 16) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = dv.getUint32(0, true);
  const height = dv.getUint32(4, true);
  const colors = dv.getUint32(8, true);
  const mse = dv.getFloat32(12, true);
  const count = width * height;
  if (bytes.length < 16 + colors * 3 + count) return null;
  const palette: Rgb[] = [];
  for (let i = 0; i < colors; i++) {
    palette.push([bytes[16 + i * 3]! / 255, bytes[16 + i * 3 + 1]! / 255, bytes[16 + i * 3 + 2]! / 255]);
  }
  const indices = bytes.slice(16 + colors * 3, 16 + colors * 3 + count);
  return { width, height, colors, mse, palette, indices };
}

/** Pack a palette-mode pixel texture into shader data[]. */
export function packPixelTexture(probe: { width: number; height: number; palette: Rgb[]; indices: Uint8Array }): number[] {
  const data: number[] = [probe.width, probe.height, probe.palette.length];
  for (const c of probe.palette) data.push(c[0], c[1], c[2]);
  for (let i = 0; i < probe.indices.length; i++) {
    const idx = probe.indices[i]!;
    data.push(idx === PIXEL_TRANSPARENT ? -1 : idx);
  }
  return data;
}

/** Pack raw RGBA (tight rows) into raw-mode shader data[] — the exact-image
 *  paint path. Caller caps size (128 longest side keeps the buffer sane). */
export function packExactTexture(rgba: Uint8Array, width: number, height: number): number[] {
  const data: number[] = [width, height, 0];
  for (let i = 0; i < width * height; i++) {
    data.push(rgba[i * 4]! / 255, rgba[i * 4 + 1]! / 255, rgba[i * 4 + 2]! / 255);
  }
  return data;
}

/** Rotate packed shader data[] by quarter turns clockwise (sticker stamps,
 *  req_3025) — the grid is re-laid at pack level so PIXEL_TEXTURE_SHADER needs
 *  no rotation uniform and rotated stamps stay on the one shader contract.
 *  Handles both palette mode (1 float/cell) and raw mode (3 floats/cell). */
export function rotatePackedTexture(data: number[], quarterTurns: number): number[] {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return data;
  const w = Math.round(data[0]!);
  const h = Math.round(data[1]!);
  const k = Math.round(data[2]!);
  const stride = k > 0 ? 1 : 3;
  const head = 3 + (k > 0 ? k * 3 : 0);
  const cells = data.slice(head);
  if (cells.length < w * h * stride) return data; // malformed pack — leave untouched
  const dw = turns % 2 === 0 ? w : h;
  const dh = turns % 2 === 0 ? h : w;
  const out = data.slice(0, head);
  out[0] = dw;
  out[1] = dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      // Source cell that lands at dst (x, y) after `turns` clockwise turns.
      let sx: number, sy: number;
      if (turns === 1) { sx = y; sy = h - 1 - x; }
      else if (turns === 2) { sx = w - 1 - x; sy = h - 1 - y; }
      else { sx = w - 1 - y; sy = x; }
      const s = (sy * w + sx) * stride;
      for (let c = 0; c < stride; c++) out.push(cells[s + c]!);
    }
  }
  return out;
}

// ── The on-disk RLE rows format (the pixel_icon lineage) ─────────────────────
// rows: one array per row; entries are a bare index (one cell), null (one
// transparent cell), or [count, index|null] runs. Flat art collapses to a
// handful of runs — the whole reason quantization beats raw storage here.

export type RleEntry = number | null | [number, number | null];

export function encodeRows(indices: Uint8Array, width: number, height: number): RleEntry[][] {
  const rows: RleEntry[][] = [];
  for (let y = 0; y < height; y++) {
    const row: RleEntry[] = [];
    let x = 0;
    while (x < width) {
      const v = indices[y * width + x]!;
      let run = 1;
      while (x + run < width && indices[y * width + x + run] === v) run++;
      const value = v === PIXEL_TRANSPARENT ? null : v;
      row.push(run === 1 ? value : [run, value]);
      x += run;
    }
    rows.push(row);
  }
  return rows;
}

export function decodeRows(rows: RleEntry[][], width: number, height: number): Uint8Array {
  const indices = new Uint8Array(width * height).fill(PIXEL_TRANSPARENT);
  for (let y = 0; y < Math.min(height, rows.length); y++) {
    let x = 0;
    for (const entry of rows[y]!) {
      const [count, value] = Array.isArray(entry) ? entry : [1, entry];
      for (let i = 0; i < count && x < width; i++, x++) {
        indices[y * width + x] = value === null ? PIXEL_TRANSPARENT : value;
      }
    }
  }
  return indices;
}
