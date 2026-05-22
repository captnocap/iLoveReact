// icons.ts — bake the cutout into pixel-icon JSON files (64/128/512) that
// pixel_icon_gallery and ShaderPixelIcon can render. Wraps magick's
// resize+quantize+alpha pipeline + the canonical RLE encoding from ./rle,
// so saved icons are drop-in compatible with both pixel_icon_demo and
// sqi.base.
//
// On disk: cart/pixel_icons/<stem>.<size>.json with shape:
//   { size, palette: ["#RRGGBB", …], rows: RleEntry[][] }
// where each row entry is either a bare palette index (single cell) or
// [run_count, palette_index|null] for a run of identical cells. Null =
// fully transparent (the cutout's alpha < 16/255).

import { run } from '@reactjit/runtime/hooks/process';
import { readFile, writeFile, mkdir } from '@reactjit/runtime/hooks/fs';
import { SCRATCH_DIR, encodeMaskPGM } from './magick';
import { encodeMatrix, type EncodedMatrix } from './rle';

export const ICON_SIZES = [64, 128, 512] as const;
export const ICON_QUANTIZE_COLORS = 64;

export type { EncodedMatrix } from './rle';

interface PixelMatrix {
  size: number;
  palette: string[];
  pixels: Array<number | null>;
}

/** Parse ImageMagick `txt:` enumeration into a palette-indexed matrix.
 *  Identical to pixel_icon_demo's parseTxt — kept here so the cutout cart
 *  doesn't have to reach into a sibling cart's internals. */
function parseTxt(txt: string, size: number): PixelMatrix {
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

interface ExportArgs {
  srcPath: string;
  mask: Uint8Array;        // 1=in-selection (kept opaque), 0=keep-image-transparent — same convention as compositeCutout
  srcW: number;
  srcH: number;
  stem: string;
  /** Quantize colors per size. Lower = chunkier icons + better RLE. */
  colors?: number;
  /** Subset of ICON_SIZES to emit; defaults to all three. */
  sizes?: number[];
}

export interface ExportResult {
  written: string[];
  errors: string[];
}

/** One magick pass at one size: produces a quantized, alpha-composited
 *  square matrix at `size × size` and returns the RLE-encoded form
 *  suitable for either pixel_icon JSON or `sqi.base`. The mask pgm path
 *  must already exist (callers write it once and reuse across sizes). */
async function bakeOne(
  srcPath: string, srcW: number, srcH: number,
  maskPgmPath: string, size: number, colors: number,
): Promise<{ matrix: EncodedMatrix | null; error: string | null }> {
  const txtOut = `${SCRATCH_DIR}/icon_${size}.txt`;
  const r = await run('magick', [
    srcPath,
    '(', maskPgmPath, '-resize', `${srcW}x${srcH}!`, ')',
    '-alpha', 'off', '-compose', 'CopyOpacity', '-composite',
    '-resize', `${size}x${size}!`,
    '+dither',
    '-colors', String(colors),
    '-depth', '8',
    `txt:${txtOut}`,
  ]);
  if (r.code !== 0) return { matrix: null, error: `magick exit ${r.code}: ${r.stderr.slice(0, 200)}` };
  const txt = readFile(txtOut);
  if (!txt) return { matrix: null, error: `could not read ${txtOut}` };
  const px = parseTxt(txt, size);
  return { matrix: encodeMatrix(px.size, px.palette, px.pixels), error: null };
}

/** Public: bake the cutout into a single EncodedMatrix at `size`.
 *  saveSqi uses this to embed the base pixel matrix inside the .sqi.json. */
export interface BakeMatrixArgs {
  srcPath: string;
  mask: Uint8Array;
  srcW: number;
  srcH: number;
  size: number;
  colors?: number;
}

export async function bakeMatrix(args: BakeMatrixArgs): Promise<{ matrix: EncodedMatrix | null; error: string | null }> {
  mkdir(SCRATCH_DIR);
  const maskPgmPath = `${SCRATCH_DIR}/sqi_mask.pgm`;
  if (!writeFile(maskPgmPath, encodeMaskPGM(args.mask, args.srcW, args.srcH))) {
    return { matrix: null, error: 'failed to write mask pgm' };
  }
  return bakeOne(args.srcPath, args.srcW, args.srcH, maskPgmPath, args.size, args.colors ?? ICON_QUANTIZE_COLORS);
}

/** One pipeline per size:
 *   magick src \( mask.pgm -resize WxH! \) -alpha off -compose CopyOpacity
 *                -composite -resize <size>×<size>! +dither -colors N -depth 8 txt:out
 *  Composite alpha at SOURCE res first so the cutout edge stays clean,
 *  THEN downsample (otherwise the small resize-before-mask would lose
 *  fine silhouette detail). +dither preserves long RLE runs. */
export async function exportIcons(args: ExportArgs): Promise<ExportResult> {
  const colors = args.colors ?? ICON_QUANTIZE_COLORS;
  const sizes = args.sizes ?? ICON_SIZES.slice();
  const written: string[] = [];
  const errors: string[] = [];

  mkdir(SCRATCH_DIR);
  mkdir('cart/pixel_icons');

  // Write the source-resolution mask once; magick scales it per call.
  const maskPgmPath = `${SCRATCH_DIR}/icon_mask.pgm`;
  if (!writeFile(maskPgmPath, encodeMaskPGM(args.mask, args.srcW, args.srcH))) {
    return { written, errors: ['failed to write icon mask pgm'] };
  }

  for (const size of sizes) {
    const { matrix, error } = await bakeOne(args.srcPath, args.srcW, args.srcH, maskPgmPath, size, colors);
    if (!matrix) {
      errors.push(`size ${size}: ${error}`);
      continue;
    }
    const outPath = `cart/pixel_icons/${args.stem}.${size}.json`;
    if (writeFile(outPath, JSON.stringify(matrix))) {
      written.push(outPath);
    } else {
      errors.push(`size ${size}: write failed at ${outPath}`);
    }
  }

  return { written, errors };
}
