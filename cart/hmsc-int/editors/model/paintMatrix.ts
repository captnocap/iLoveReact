// editors/model/paintMatrix.ts — palette-indexed run-length codec for the mesh
// painter's texture (req_1783). REGENERATED from the proven pixel_icon on-disk
// format (docs/game/_archive/pixel_icon_demo.md): {size, palette:["#RRGGBB"],
// rows: RunEntry[][]} where each row entry is a bare value (a palette index, or
// null = transparent) for one cell, or a [count, value] run.
//
// Why this exists: the painter persisted a FULL 1024² PNG per stroke (~100s KB–
// 2 MB), accumulating to a 695 MB model store of dead history. But the mesh
// painter only ever uses "kind 0, hardness 1 → crisp flat paint"
// (meshPaintTexture.ts:148) and the mesh samples nearest (req_1321), so the
// texture is essentially FLAT N-COLOUR. That collapses to a few KB of palette-
// indexed RLE — text, diffable, git-carryable — and is the SAME shape the
// compile bake already understands for icons.
//
// The only wrinkle is the ~1px feathered rim each crisp stroke leaves (the brush
// shader's edge_coverage). We binarize alpha at `alphaCut` and snap each opaque
// texel to an exact palette entry, so a rim texel becomes a hard palette colour.
// Visually invisible under nearest sampling; keeps the palette tight.

export type PaletteIndex = number | null; // null = transparent texel
export type RunEntry = PaletteIndex | [number, PaletteIndex];

/** Flat in-memory form: indices into `palette`, row-major, length size². */
export type PixelMatrix = { size: number; palette: string[]; pixels: PaletteIndex[] };

/** On-disk/event form: run-length rows. The compact, diffable payload. */
export type EncodedMatrix = { size: number; palette: string[]; rows: RunEntry[][] };

const HEX = '0123456789abcdef';
function byteHex(n: number): string {
  const b = n < 0 ? 0 : n > 255 ? 255 : n | 0;
  return HEX[(b >> 4) & 0xf] + HEX[b & 0xf];
}

/** RGBA readback → palette-indexed matrix. Opaque texels (alpha ≥ alphaCut) map
 *  to a `#rrggbb` palette entry (interned on first sight); anything more
 *  transparent is null. Lossless for flat paint; binarizes the thin AA rim. */
export function rgbaToMatrix(rgba: Uint8Array | Uint8ClampedArray, size: number, alphaCut = 128): PixelMatrix {
  const palette: string[] = [];
  const index = new Map<string, number>();
  const pixels: PaletteIndex[] = new Array(size * size);
  for (let i = 0, p = 0; i < size * size; i += 1, p += 4) {
    if (rgba[p + 3] < alphaCut) { pixels[i] = null; continue; }
    const hex = '#' + byteHex(rgba[p]) + byteHex(rgba[p + 1]) + byteHex(rgba[p + 2]);
    let idx = index.get(hex);
    if (idx === undefined) { idx = palette.length; palette.push(hex); index.set(hex, idx); }
    pixels[i] = idx;
  }
  return { size, palette, pixels };
}

/** Matrix → RGBA bytes (alpha 255 for indexed, 0 for null). Round-trips
 *  rgbaToMatrix up to the alpha binarization. */
export function matrixToRgba(m: PixelMatrix): Uint8Array {
  const out = new Uint8Array(m.size * m.size * 4);
  for (let i = 0, p = 0; i < m.pixels.length; i += 1, p += 4) {
    const v = m.pixels[i];
    if (v == null) continue; // already 0,0,0,0
    const hex = m.palette[v] ?? '#000000';
    out[p] = parseInt(hex.slice(1, 3), 16);
    out[p + 1] = parseInt(hex.slice(3, 5), 16);
    out[p + 2] = parseInt(hex.slice(5, 7), 16);
    out[p + 3] = 255;
  }
  return out;
}

/** PixelMatrix → run-length EncodedMatrix. One array per row; equal adjacent
 *  cells collapse to a [count, value] run, a single cell stays a bare value. */
export function encodeMatrix(m: PixelMatrix): EncodedMatrix {
  const rows: RunEntry[][] = [];
  for (let y = 0; y < m.size; y += 1) {
    const row: RunEntry[] = [];
    let run = 1;
    let val = m.pixels[y * m.size];
    for (let x = 1; x < m.size; x += 1) {
      const cur = m.pixels[y * m.size + x];
      if (cur === val) { run += 1; continue; }
      row.push(run === 1 ? val : [run, val]);
      val = cur; run = 1;
    }
    row.push(run === 1 ? val : [run, val]);
    rows.push(row);
  }
  return { size: m.size, palette: m.palette, rows };
}

/** EncodedMatrix → flat PixelMatrix (expand the runs). */
export function decodeMatrix(e: EncodedMatrix): PixelMatrix {
  const pixels: PaletteIndex[] = new Array(e.size * e.size);
  for (let y = 0; y < e.size; y += 1) {
    let x = 0;
    for (const entry of e.rows[y] ?? []) {
      if (Array.isArray(entry)) {
        const [count, value] = entry;
        for (let k = 0; k < count; k += 1) pixels[y * e.size + x++] = value;
      } else {
        pixels[y * e.size + x++] = entry;
      }
    }
    while (x < e.size) pixels[y * e.size + x++] = null; // tolerate a short row
  }
  return { size: e.size, palette: e.palette, pixels };
}

/** RGBA readback → compact EncodedMatrix in one call (the persist path). */
export function rgbaToEncoded(rgba: Uint8Array | Uint8ClampedArray, size: number, alphaCut = 128): EncodedMatrix {
  return encodeMatrix(rgbaToMatrix(rgba, size, alphaCut));
}

/** EncodedMatrix → RGBA bytes in one call (the restore path). */
export function encodedToRgba(e: EncodedMatrix): Uint8Array {
  return matrixToRgba(decodeMatrix(e));
}
