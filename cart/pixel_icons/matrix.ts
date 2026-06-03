// Image → PixelMatrix via ImageMagick's `txt:` enumeration format. Shared by
// pixel_icon_demo (icon quantizing) and carve_lab (mask-grid carving) — one
// parser, two consumers. Pure parsing here; the magick subprocess invocations
// stay with each cart (their flags differ: exact-stretch vs pad-to-square).

import type { PixelMatrix } from './PixelIcon';

// Parse ImageMagick's `txt:` enumeration format into a palette-indexed matrix.
// Each line:  `X,Y: (R,G,B,A)  #RRGGBBAA  srgba(...)`
// Pixels with alpha < 16 become `null` (transparent — outside the cutout).
export function parseTxt(txt: string, size: number): PixelMatrix {
  const pixels: Array<number | null> = new Array(size * size).fill(null);
  const palette: string[] = [];
  const colorToIdx = new Map<string, number>();
  const re = /^(\d+),(\d+):\s*\((\d+),(\d+),(\d+)(?:,(\d+))?\)\s+#([0-9A-Fa-f]{6,8})/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt)) !== null) {
    const x = +m[1], y = +m[2];
    if (x >= size || y >= size) continue;
    const hex = m[7].toUpperCase();
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
    const i = y * size + x;
    if (alpha < 16) { pixels[i] = null; continue; }
    const rgb = '#' + hex.slice(0, 6);
    let pi = colorToIdx.get(rgb);
    if (pi === undefined) {
      pi = palette.length;
      palette.push(rgb);
      colorToIdx.set(rgb, pi);
    }
    pixels[i] = pi;
  }
  return { size, palette, pixels };
}
