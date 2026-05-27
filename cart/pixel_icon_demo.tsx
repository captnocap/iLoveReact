// pixel_icon_demo — drop an image, see it as a pixel-matrix icon, save if you
// like it.
//
//   1. drop any image file onto the window
//   2. it auto-converts to 64/128/512 color matrices (via `magick`)
//   3. preview shows live; click Save and it writes the three JSON files to
//      cart/pixel_icons/<stem>.<size>.json
//
// Save destination is relative to the binary's cwd, so launch from the repo
// root (`./scripts/dev pixel_icon_demo` or `./zig-out/bin/pixel_icon_demo`
// invoked from the repo).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Canvas, Col, Row, Image, Pressable, Text } from '@reactjit/runtime/primitives';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { run, execAsync } from '@reactjit/runtime/hooks/process';
import { readFile, writeFile, mkdir } from '@reactjit/runtime/hooks/fs';
import { callHost } from '@reactjit/runtime/ffi';
import { PixelIcon, MaskOverlay, PaintOverlay, type PixelMatrix } from './pixel_icons/PixelIcon';

// Bridge to framework/v8_bindings_telemetry.zig:canvasScreenToGraphCb —
// converts a screen-space pixel (mouse coord) into the active <Canvas>'s
// world-space, accounting for current pan/zoom. The cart provides the
// viewport center (computed from the Canvas's onLayout rect) since the
// host doesn't track per-Canvas screen position.
function canvasScreenToGraph(sx: number, sy: number, vpcx: number, vpcy: number): { gx: number; gy: number } | null {
  return callHost<{ gx: number; gy: number } | null>('__canvas_screen_to_graph', null, sx, sy, vpcx, vpcy);
}

const BG = '#0b1018';
const INK = '#e8eef8';
const DIM = '#7f93b1';
const ACCENT = '#3da9ff';
const GOOD = '#34d399';
const WARN = '#ff9f43';

const SIZES = [64, 128, 512] as const;
const PREVIEW_SIZE = 64;
const PREVIEW_PX = 6;

const SCRATCH_DIR = '/tmp/_reactjit_pixel';

type Matrices = Partial<Record<typeof SIZES[number], PixelMatrix>>;

function basenameStem(path: string): string {
  const slash = path.lastIndexOf('/');
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9_-]+/g, '_');
}

// Parse ImageMagick's `txt:` enumeration format into a palette-indexed matrix.
// Each line:  `X,Y: (R,G,B,A)  #RRGGBBAA  srgba(...)`
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

async function imageToMatrix(srcPath: string, size: number, colors: number): Promise<PixelMatrix> {
  mkdir(SCRATCH_DIR);
  const out = `${SCRATCH_DIR}/p_${size}.txt`;
  // `+dither -colors N` snaps every pixel to one of N representative colors
  // without dithering. Dithering would scatter near-duplicate colors back into
  // the image which kills RLE — for icons we'd rather have visible banding and
  // long flat runs than smooth gradients made of 14k unique cells.
  const r = await run('magick', [
    srcPath,
    '-resize', `${size}x${size}!`,
    '+dither',
    '-colors', String(colors),
    '-depth', '8',
    `txt:${out}`,
  ]);
  if (r.code !== 0) throw new Error(`magick ${size} failed (code ${r.code}): ${r.stderr.slice(0, 200)}`);
  const txt = readFile(out);
  if (!txt) throw new Error(`could not read ${out}`);
  return parseTxt(txt, size);
}

// ─ Animation pipeline ─────────────────────────────────────────────────
// Video / GIF → ffmpeg dumps frames at target fps and size → magick builds
// one shared palette across all frames (concat horizontally, quantize once)
// → each frame is remapped to that palette via `-remap`. Result is a series
// of frames that share palette indices, so animation playback is just
// swapping the `pixels` array under a stable palette/size.

type AnimMatrix = {
  size: number;
  palette: string[];
  fps: number;
  frames: Array<{ pixels: Array<number | null> }>;
};

type AnimMatrices = Partial<Record<typeof SIZES[number], AnimMatrix>>;

const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|gif|m4v|ogv)$/i;
function isVideoPath(p: string): boolean { return VIDEO_EXT_RE.test(p); }

async function videoToAnim(
  srcPath: string,
  size: number,
  colors: number,
  fps: number,
  onProgress?: (msg: string) => void,
): Promise<AnimMatrix> {
  // One scratch dir per size+stem so multiple ingestions don't trample each other.
  const scratch = `${SCRATCH_DIR}/anim_${size}`;
  mkdir(SCRATCH_DIR);
  mkdir(scratch);
  // Clear stale frames from a prior run.
  await run('sh', ['-c', `rm -f ${scratch}/frame_*.png ${scratch}/p_*.txt ${scratch}/palette.png`]);

  onProgress?.(`extracting frames @ ${fps}fps…`);
  const ff = await run('ffmpeg', [
    '-y', '-i', srcPath,
    '-vf', `fps=${fps},scale=${size}:${size}:flags=lanczos`,
    `${scratch}/frame_%04d.png`,
  ]);
  if (ff.code !== 0) throw new Error(`ffmpeg failed (code ${ff.code}): ${ff.stderr.slice(0, 300)}`);

  // List extracted frames.
  const lsR = await run('sh', ['-c', `ls ${scratch}/frame_*.png 2>/dev/null | sort`]);
  const frameFiles = lsR.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (frameFiles.length === 0) throw new Error('ffmpeg extracted no frames');

  // Sample down to a manageable number of frames for palette construction.
  // A flat `+append` of every frame can blow ImageMagick's width policy
  // (default 16KP) for any video longer than ~20s. 60 evenly-spaced frames
  // tiled into a roughly-square grid stays well under the limit at every
  // size and is more than enough for median-cut to find the representative
  // colors across the whole animation.
  const MAX_PALETTE_FRAMES = 60;
  const stride = Math.max(1, Math.ceil(frameFiles.length / MAX_PALETTE_FRAMES));
  const sampled: string[] = [];
  for (let i = 0; i < frameFiles.length; i += stride) sampled.push(frameFiles[i]);
  const tileCols = Math.max(1, Math.ceil(Math.sqrt(sampled.length)));

  onProgress?.(`building shared palette from ${sampled.length}/${frameFiles.length} sampled frames…`);
  const paletteR = await run('sh', ['-c',
    `magick montage ${sampled.join(' ')} -tile ${tileCols}x -geometry +0+0 -background black miff:- ` +
    `| magick - +dither -colors ${colors} ${scratch}/palette.png`,
  ]);
  if (paletteR.code !== 0) throw new Error(`palette build failed: ${paletteR.stderr.slice(0, 200)}`);

  const framesOut: Array<{ pixels: Array<number | null> }> = [];
  let palette: string[] = [];
  for (let i = 0; i < frameFiles.length; i++) {
    onProgress?.(`mapping frame ${i + 1}/${frameFiles.length} @ ${size}²…`);
    const f = frameFiles[i];
    const txtPath = `${scratch}/p_${i.toString().padStart(4, '0')}.txt`;
    const r = await run('magick', [
      f, '+dither', '-remap', `${scratch}/palette.png`, '-depth', '8', `txt:${txtPath}`,
    ]);
    if (r.code !== 0) throw new Error(`magick frame ${i} failed: ${r.stderr.slice(0, 200)}`);
    const txt = readFile(txtPath);
    if (!txt) throw new Error(`could not read ${txtPath}`);
    const m = parseTxt(txt, size);
    framesOut.push({ pixels: m.pixels });
    // The first frame establishes the canonical palette ordering. Subsequent
    // frames map to the same palette via -remap, so their palette extraction
    // should match — but the magick txt header lists colors in the order they
    // first appear in the image, which may differ. Reindex frames N>0 against
    // the canonical palette to keep indices consistent across frames.
    if (i === 0) {
      palette = m.palette;
    } else if (m.palette.length > 0) {
      // Build a remap from this frame's palette to the canonical palette.
      const remap = new Map<number, number>();
      for (let j = 0; j < m.palette.length; j++) {
        const canon = palette.indexOf(m.palette[j]);
        if (canon >= 0) remap.set(j, canon);
        else { remap.set(j, palette.length); palette.push(m.palette[j]); }
      }
      const reidx: Array<number | null> = new Array(m.pixels.length);
      for (let k = 0; k < m.pixels.length; k++) {
        const v = m.pixels[k];
        reidx[k] = v == null ? null : (remap.get(v) ?? 0);
      }
      framesOut[i] = { pixels: reidx };
    }
  }

  return { size, palette, fps, frames: framesOut };
}

// Mask resolution. Edits happen at 64-grid; on save they get scaled to each
// matrix size (every masked 64-cell becomes a 2×2 block at 128, 8×8 at 512).
const MASK_RES = 64;

function applyMaskToMatrix(m: PixelMatrix, mask: Set<number>): PixelMatrix {
  if (mask.size === 0) return m;
  const scale = m.size / MASK_RES;
  const pixels = m.pixels.slice();
  for (const idx of mask) {
    const cx = idx % MASK_RES;
    const cy = Math.floor(idx / MASK_RES);
    const x0 = Math.floor(cx * scale);
    const y0 = Math.floor(cy * scale);
    const x1 = Math.floor((cx + 1) * scale);
    const y1 = Math.floor((cy + 1) * scale);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        pixels[y * m.size + x] = null;
      }
    }
  }
  return { size: m.size, palette: m.palette, pixels };
}

// Apply a paint map (cellIdx → hex color) to the matrix. Extends the
// palette with any new colors not already present, then writes the scaled-
// up cell ranges. Returns a NEW matrix; never mutates the input.
function applyPaintToMatrix(m: PixelMatrix, paint: Map<number, string>): PixelMatrix {
  if (paint.size === 0) return m;
  const scale = m.size / MASK_RES;
  const palette = m.palette.slice();
  const colorToIdx = new Map<string, number>();
  for (let i = 0; i < palette.length; i++) colorToIdx.set(palette[i], i);
  const pixels = m.pixels.slice();
  for (const [cellIdx, hex] of paint) {
    let pi = colorToIdx.get(hex);
    if (pi === undefined) {
      pi = palette.length;
      palette.push(hex);
      colorToIdx.set(hex, pi);
    }
    const cx = cellIdx % MASK_RES;
    const cy = Math.floor(cellIdx / MASK_RES);
    const x0 = Math.floor(cx * scale);
    const y0 = Math.floor(cy * scale);
    const x1 = Math.floor((cx + 1) * scale);
    const y1 = Math.floor((cy + 1) * scale);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        pixels[y * m.size + x] = pi;
      }
    }
  }
  return { size: m.size, palette, pixels };
}

// ─ Full-fidelity PNG export ───────────────────────────────────────────
// The mask is at 64-grid; the SOURCE image is at native resolution. Export
// path: write the 64-grid mask + paint as ASCII PGM/PPM files, hand them to
// magick to upscale nearest-neighbor to source dims, feather slightly to
// soften the stairstep, and composite as alpha + paint over the original.
// The interior of the cutout is full source-resolution; only the silhouette
// is constrained to 64-grid (with sub-pixel feather).
//
// ASCII formats (P2 PGM, P3 PPM) are used because the runtime's writeFile
// is UTF-8 only — no binary writes. At 64×64 the text payload is tiny
// (~16KB for the mask) so the format inefficiency doesn't matter.

function maskToPGM(mask: Set<number>): string {
  // 0 = transparent (erased), 255 = opaque (keep)
  const lines: string[] = ['P2', `${MASK_RES} ${MASK_RES}`, '255'];
  for (let y = 0; y < MASK_RES; y++) {
    const row: string[] = [];
    for (let x = 0; x < MASK_RES; x++) {
      row.push(mask.has(y * MASK_RES + x) ? '0' : '255');
    }
    lines.push(row.join(' '));
  }
  // Trailing newline is required — magick 7 rejects the file without it
  // (error/pnm.c/ReadPNMImage/1591 "unable to read image data").
  return lines.join('\n') + '\n';
}

function paintToPPMs(paint: Map<number, string>): { rgb: string; alpha: string } {
  // RGB carries the painted color per cell; alpha is binary (255 where
  // painted, 0 elsewhere). magick combines them into a colored layer that
  // composites over the source.
  const rgbLines: string[] = ['P3', `${MASK_RES} ${MASK_RES}`, '255'];
  const alphaLines: string[] = ['P2', `${MASK_RES} ${MASK_RES}`, '255'];
  for (let y = 0; y < MASK_RES; y++) {
    const rgbRow: string[] = [];
    const alphaRow: string[] = [];
    for (let x = 0; x < MASK_RES; x++) {
      const idx = y * MASK_RES + x;
      const hex = paint.get(idx);
      if (hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        rgbRow.push(`${r} ${g} ${b}`);
        alphaRow.push('255');
      } else {
        rgbRow.push('0 0 0');
        alphaRow.push('0');
      }
    }
    rgbLines.push(rgbRow.join('  '));
    alphaLines.push(alphaRow.join(' '));
  }
  return { rgb: rgbLines.join('\n') + '\n', alpha: alphaLines.join('\n') + '\n' };
}

const DEFAULT_PAINT_COLOR = '#ffffff';
const PRESET_PAINT_COLORS = [
  '#ffffff', '#000000', '#ff4040', '#ff9f43', '#ffdd55',
  '#34d399', '#3da9ff', '#a060ff', '#ff70cc', '#806040',
];

type Rect = { x: number; y: number; width: number; height: number };

// ─ Disk encoding ──────────────────────────────────────────────────────
// On disk the matrix is { size, palette, rows } where each row is an array
// of left-to-right runs. A bare number/null is one cell; an array
// `[count, value]` is a run of `count` cells with that value. Long flat
// regions (Pepe's face, the null block after a crop) collapse to single
// runs; singleton-heavy photos pay only a bare-number-per-cell cost, so
// the format is never significantly larger than the flat representation.
//
// In-memory we always keep the flat form (matches PixelIcon's reader).

type EncodedRunEntry = number | null | [number, number | null];
type EncodedMatrix = { size: number; palette: string[]; rows: EncodedRunEntry[][] };

function encodeMatrix(m: PixelMatrix): EncodedMatrix {
  const { size, palette, pixels } = m;
  const rows: EncodedRunEntry[][] = [];
  for (let y = 0; y < size; y++) {
    const row: EncodedRunEntry[] = [];
    let x = 0;
    while (x < size) {
      const v = pixels[y * size + x];
      let run = 1;
      while (x + run < size && pixels[y * size + x + run] === v) run++;
      row.push(run === 1 ? v : [run, v]);
      x += run;
    }
    rows.push(row);
  }
  return { size, palette, rows };
}

// Decode for future round-trips (load a saved icon back into a PixelMatrix).
// Not used by the demo today but the Python script emits the same shape, so
// any tool that reads these files can use this loader.
function decodeMatrix(obj: EncodedMatrix): PixelMatrix {
  const { size, palette, rows } = obj;
  const pixels: Array<number | null> = new Array(size * size);
  for (let y = 0; y < size; y++) {
    let x = 0;
    for (const entry of rows[y]) {
      if (Array.isArray(entry)) {
        const [count, v] = entry;
        for (let i = 0; i < count; i++) pixels[y * size + x++] = v;
      } else {
        pixels[y * size + x++] = entry;
      }
    }
  }
  return { size, palette, pixels };
}
// keep `decodeMatrix` referenced so esbuild keeps it in the bundle for
// future tooling. Tree-shaking is sideEffects-aware.
void decodeMatrix;

// ─ Wand helpers ───────────────────────────────────────────────────────
// The pixel-grid IS the selection structure: flood-fill at 64-resolution
// from a clicked cell, gather every connected cell whose palette entry is
// within `tol` (RGB euclidean) of the seed color. Pre-filtering the palette
// to "valid" indices first means the BFS body is a single Set.has() per
// neighbor — no per-pixel hex parsing.

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function paletteIndexesWithinTolerance(palette: string[], seedHex: string, tol: number): Set<number> {
  const [sr, sg, sb] = hexToRgb(seedHex);
  const tol2 = tol * tol;
  const out = new Set<number>();
  for (let i = 0; i < palette.length; i++) {
    const [r, g, b] = hexToRgb(palette[i]);
    const dr = r - sr, dg = g - sg, db = b - sb;
    if (dr * dr + dg * dg + db * db <= tol2) out.add(i);
  }
  return out;
}

function floodFillColor(m: PixelMatrix, seedX: number, seedY: number, tol: number): Set<number> {
  const size = m.size;
  const seedIdx = seedY * size + seedX;
  const seedColorIdx = m.pixels[seedIdx];
  if (seedColorIdx == null) return new Set();

  const validPalette = paletteIndexesWithinTolerance(m.palette, m.palette[seedColorIdx], tol);
  // Neighbor-step tolerance is stricter than the seed tolerance — a candidate
  // has to be both close to the seed AND close to the cell we expand from.
  // Without this the BFS leaks across AA-blended boundaries (Pepe's mouth →
  // face bleed-through). tol/3 with a floor of 6 keeps flat regions selectable
  // while killing the bridging chains that cross sharp edges.
  const stepTol = Math.max(6, Math.floor(tol / 3));
  const stepTol2 = stepTol * stepTol;
  const paletteRgb: Array<[number, number, number]> = m.palette.map(hexToRgb);

  const out = new Set<number>();
  const visited = new Uint8Array(size * size);
  const queue: number[] = [seedIdx];
  visited[seedIdx] = 1;

  while (queue.length) {
    const idx = queue.pop()!;
    const ci = m.pixels[idx];
    if (ci == null || !validPalette.has(ci)) continue;
    out.add(idx);
    const curRgb = paletteRgb[ci];
    const x = idx % size;
    const y = (idx - x) / size;

    const tryNeighbor = (ni: number) => {
      if (visited[ni]) return;
      visited[ni] = 1;
      const nci = m.pixels[ni];
      if (nci == null || !validPalette.has(nci)) return;
      const nrgb = paletteRgb[nci];
      const dr = curRgb[0] - nrgb[0], dg = curRgb[1] - nrgb[1], db = curRgb[2] - nrgb[2];
      if (dr * dr + dg * dg + db * db > stepTol2) return;
      queue.push(ni);
    };

    if (x > 0) tryNeighbor(idx - 1);
    if (x < size - 1) tryNeighbor(idx + 1);
    if (y > 0) tryNeighbor(idx - size);
    if (y < size - 1) tryNeighbor(idx + size);
  }
  return out;
}

// ─ Hi-res mask (source-resolution) ────────────────────────────────────
// The 64-grid mask is great for fast region selection but locks the cutout
// silhouette to ~60px chunks at 4K. The hi-res mask lives at the source's
// native resolution; a "fine" brush mode writes circular stamps directly
// into it at single-pixel precision, and Save PNG uses it for the alpha
// channel. The two masks are independent — the 64-grid one drives the
// pixel-icon JSON path, the hi-res one drives the PNG cutout path.

/** Fill a filled circle in a flat row-major Uint8Array mask. value: 1=erased, 0=keep. */
function paintHiResCircle(mask: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, value: number): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const rowStart = y * w;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) mask[rowStart + x] = value;
    }
  }
}

/** Encode hi-res mask as P5 binary PGM with maxval=1 (bytes 0/1 are single-byte
 *  UTF-8 so writeFile passes them through unchanged). Inverts the convention
 *  for magick: 0=erased→0 (dark/transparent), 1=keep→1 (bright/opaque). */
function hiResMaskToBinaryPGM(mask: Uint8Array, w: number, h: number): string {
  // Build the byte array (inverted), then convert to string in 32KB chunks
  // — String.fromCharCode.apply blows the call stack on huge inputs.
  const inverted = new Uint8Array(w * h);
  for (let i = 0; i < inverted.length; i++) inverted[i] = mask[i] ? 0 : 1;
  const header = `P5\n${w} ${h}\n1\n`;
  const CHUNK = 32768;
  let body = '';
  for (let i = 0; i < inverted.length; i += CHUNK) {
    body += String.fromCharCode.apply(null, inverted.subarray(i, i + CHUNK) as any);
  }
  return header + body;
}

/** Quick scan — does the hi-res mask contain any erased pixels? */
function hiResMaskHasAny(mask: Uint8Array): boolean {
  for (let i = 0; i < mask.length; i++) if (mask[i]) return true;
  return false;
}

function floodFillMask(mask: Set<number>, seedX: number, seedY: number, size: number): Set<number> {
  const seedIdx = seedY * size + seedX;
  if (!mask.has(seedIdx)) return new Set();
  const out = new Set<number>();
  const queue = [seedIdx];
  out.add(seedIdx);
  while (queue.length) {
    const idx = queue.pop()!;
    const x = idx % size;
    const y = (idx - x) / size;
    const ns = [
      x > 0 ? idx - 1 : -1,
      x < size - 1 ? idx + 1 : -1,
      y > 0 ? idx - size : -1,
      y < size - 1 ? idx + size : -1,
    ];
    for (const ni of ns) {
      if (ni < 0 || out.has(ni) || !mask.has(ni)) continue;
      out.add(ni);
      queue.push(ni);
    }
  }
  return out;
}

export default function PixelIconDemo() {
  const [srcPath, setSrcPath] = useState<string | null>(null);
  const [stem, setStem] = useState<string>('icon');
  const [matrices, setMatrices] = useState<Matrices>({});
  const [status, setStatus] = useState<string>('drop an image anywhere on this window');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // `mask` is the live in-progress erase set for the CURRENT frame. The
  // committed snapshot + undo stack for every frame live in `frames`, keyed
  // by frame index. This split keeps drag-paint smooth (only `mask` updates
  // on mousemove) while letting each frame carry its own mask history.
  const [mask, setMask] = useState<Set<number>>(() => new Set());
  // Live paint map for the current frame: cellIdx → hex color. Updated on
  // every mousemove in paint mode; promoted to frames[frameIdx].paint on
  // mouseup via commitMask.
  const [paint, setPaint] = useState<Map<number, string>>(() => new Map());
  const [paintColor, setPaintColor] = useState<string>(DEFAULT_PAINT_COLOR);
  const [brushR, setBrushR] = useState<number>(0);
  const [mode, setMode] = useState<'erase' | 'restore' | 'paint'>('erase');
  const [tool, setTool] = useState<'brush' | 'wand'>('brush');
  const [tolerance, setTolerance] = useState<number>(32);
  const [colorCount, setColorCount] = useState<number>(64);
  const [previewRect, setPreviewRect] = useState<Rect | null>(null);
  const [animMatrices, setAnimMatrices] = useState<AnimMatrices>({});
  const [frameIdx, setFrameIdx] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(true);
  const [animFps, setAnimFps] = useState<number>(12);
  const [previewZoom, setPreviewZoom] = useState<number>(1);

  // Hi-res mask state — independent of the 64-grid mask. Lives at native
  // source resolution (`srcDims`); a fine brush paints circular stamps
  // directly into it; Save PNG uses it for pixel-exact alpha. Stored in a
  // ref because the array can be 20MB+ at 4K — re-creating it on every
  // mousemove would thrash GC. `hiResVersion` bumps on commit so dependent
  // memos/effects can invalidate.
  const [srcDims, setSrcDims] = useState<{ w: number; h: number } | null>(null);
  const hiResMaskRef = useRef<Uint8Array | null>(null);
  const [hiResVersion, setHiResVersion] = useState(0);
  // Fine-brush radius in SOURCE pixels (not cells). With a 4000-wide source
  // and brushPx=8, you're erasing a 16-pixel circle. The 64-grid brush is
  // unaffected — this is a separate mode toggled by `fineBrush`.
  const [brushPx, setBrushPx] = useState<number>(32);
  const [fineBrush, setFineBrush] = useState<boolean>(false);
  // Canvas viewport rect — needed by canvasScreenToGraph to convert screen
  // pointer coords into the Canvas's world (source-pixel) space.
  const [canvasRect, setCanvasRect] = useState<Rect | null>(null);
  // How densely to sample the hi-res mask for the overlay. 128 cells across
  // gives 16k logical cells max; row-coalesce keeps node count manageable.
  const HIRES_OVERLAY_RES = 128;

  // Per-frame state for the static-image manual-animation path. Each slot
  // holds the committed mask + paint map + a combined undo stack and its
  // pointer. History entries snapshot both mask AND paint atomically, so
  // one undo reverses an entire stroke regardless of mode.
  type HistEntry = { mask: Set<number>; paint: Map<number, string> };
  type FrameSlot = { mask: Set<number>; paint: Map<number, string>; history: HistEntry[]; histIdx: number };
  const emptySlot = (): FrameSlot => ({
    mask: new Set(),
    paint: new Map(),
    history: [{ mask: new Set(), paint: new Map() }],
    histIdx: 0,
  });
  const [frames, setFrames] = useState<FrameSlot[]>(() => [emptySlot()]);

  const drawingRef = useRef(false);
  const tokenRef = useRef(0);
  // Track which frame's mask we've already pushed into `mask`, so the
  // playback loop / frame-switch effect doesn't overwrite an in-flight paint.
  const lastLoadedFrameRef = useRef(0);

  const isAnim = !!animMatrices[64];
  const isManualAnim = !isAnim && frames.length > 1;
  const isAnyAnim = isAnim || isManualAnim;
  const videoFrameCount = animMatrices[64]?.frames.length ?? 0;
  const totalFrames = isAnim ? videoFrameCount : frames.length;
  const effectiveFps = isAnim ? (animMatrices[64]?.fps ?? animFps) : animFps;

  const slot = frames[frameIdx] ?? emptySlot();
  const committedMask = slot.mask;
  const committedPaint = slot.paint;
  const canUndo = slot.histIdx > 0;
  const canRedo = slot.histIdx < slot.history.length - 1;

  const sameMask = (a: Set<number>, b: Set<number>): boolean => {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  };

  const samePaint = (a: Map<number, string>, b: Map<number, string>): boolean => {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
  };

  // Commit live `mask` AND `paint` into the current frame's slot, push a
  // unified snapshot onto its undo stack.
  const commitMask = () => {
    const wasDrawing = drawingRef.current;
    drawingRef.current = false;
    // Bump hi-res version on stroke end so the status line + any future
    // hi-res-aware overlay can refresh.
    if (wasDrawing && fineBrush) setHiResVersion((v) => v + 1);
    setFrames((prev) => {
      const cur = prev[frameIdx] ?? emptySlot();
      if (sameMask(cur.mask, mask) && samePaint(cur.paint, paint)) return prev;
      const trimmed = cur.history.slice(0, cur.histIdx + 1);
      trimmed.push({ mask: new Set(mask), paint: new Map(paint) });
      while (trimmed.length > 50) trimmed.shift();
      const next = prev.slice();
      next[frameIdx] = {
        mask: new Set(mask),
        paint: new Map(paint),
        history: trimmed,
        histIdx: trimmed.length - 1,
      };
      return next;
    });
  };

  const undo = () => {
    if (!canUndo) return;
    const target = slot.history[slot.histIdx - 1];
    setFrames((prev) => {
      const next = prev.slice();
      const cur = next[frameIdx];
      next[frameIdx] = {
        ...cur,
        mask: new Set(target.mask),
        paint: new Map(target.paint),
        histIdx: cur.histIdx - 1,
      };
      return next;
    });
    setMask(new Set(target.mask));
    setPaint(new Map(target.paint));
    lastLoadedFrameRef.current = frameIdx;
  };

  const redo = () => {
    if (!canRedo) return;
    const target = slot.history[slot.histIdx + 1];
    setFrames((prev) => {
      const next = prev.slice();
      const cur = next[frameIdx];
      next[frameIdx] = {
        ...cur,
        mask: new Set(target.mask),
        paint: new Map(target.paint),
        histIdx: cur.histIdx + 1,
      };
      return next;
    });
    setMask(new Set(target.mask));
    setPaint(new Map(target.paint));
    lastLoadedFrameRef.current = frameIdx;
  };

  // Clear wipes both mask and paint on the current frame. Pushed as a single
  // history entry so undo restores everything in one step.
  const clearMask = () => {
    setMask(new Set());
    setPaint(new Map());
    setFrames((prev) => {
      const cur = prev[frameIdx] ?? emptySlot();
      if (cur.mask.size === 0 && cur.paint.size === 0) return prev;
      const trimmed = cur.history.slice(0, cur.histIdx + 1);
      trimmed.push({ mask: new Set(), paint: new Map() });
      while (trimmed.length > 50) trimmed.shift();
      const next = prev.slice();
      next[frameIdx] = { mask: new Set(), paint: new Map(), history: trimmed, histIdx: trimmed.length - 1 };
      return next;
    });
  };

  // Manual-frame management. Each operation persists any uncommitted live
  // edits into the current slot first.
  const addFrame = () => {
    setFrames((prev) => {
      const seedMask = new Set(mask);
      const seedPaint = new Map(paint);
      const newSlot: FrameSlot = {
        mask: new Set(seedMask),
        paint: new Map(seedPaint),
        history: [{ mask: new Set(seedMask), paint: new Map(seedPaint) }],
        histIdx: 0,
      };
      const next = prev.slice();
      const cur = next[frameIdx];
      if (cur && (!sameMask(cur.mask, mask) || !samePaint(cur.paint, paint))) {
        next[frameIdx] = { ...cur, mask: new Set(mask), paint: new Map(paint) };
      }
      next.splice(frameIdx + 1, 0, newSlot);
      return next;
    });
    setFrameIdx(frameIdx + 1);
    lastLoadedFrameRef.current = frameIdx + 1;
  };

  const removeFrame = () => {
    if (frames.length <= 1) return;
    const newIdx = Math.max(0, frameIdx >= frames.length - 1 ? frames.length - 2 : frameIdx);
    setFrames((prev) => {
      const next = prev.slice();
      next.splice(frameIdx, 1);
      return next;
    });
    setFrameIdx(newIdx);
    lastLoadedFrameRef.current = newIdx;
    // Read from the closure-captured pre-splice frames; newIdx in the post-
    // splice array maps to (newIdx >= frameIdx ? newIdx + 1 : newIdx) here.
    const sourceIdx = newIdx === frameIdx ? newIdx + 1 : newIdx;
    const src = frames[sourceIdx] ?? emptySlot();
    setMask(new Set(src.mask));
    setPaint(new Map(src.paint));
  };

  const goToFrame = (newIdx: number) => {
    if (newIdx < 0 || newIdx >= frames.length || newIdx === frameIdx) return;
    setFrames((prev) => {
      const cur = prev[frameIdx];
      if (!cur || (sameMask(cur.mask, mask) && samePaint(cur.paint, paint))) return prev;
      const next = prev.slice();
      next[frameIdx] = { ...cur, mask: new Set(mask), paint: new Map(paint) };
      return next;
    });
    setFrameIdx(newIdx);
    // Effect below loads new frame's mask + paint into the live state.
  };

  const resetForIngest = (path: string) => {
    setSrcPath(path);
    setStem(basenameStem(path));
    setMatrices({});
    setAnimMatrices({});
    setFrameIdx(0);
    setSaved(null);
    setMask(new Set());
    setPaint(new Map());
    setFrames([emptySlot()]);
    lastLoadedFrameRef.current = 0;
    // Hi-res mask state — discard previous allocation, query new dims on
    // ingest, then allocate a fresh zeroed Uint8Array sized to the source.
    setSrcDims(null);
    hiResMaskRef.current = null;
    setHiResVersion(0);
  };

  /** Query magick for native source dims, then allocate the hi-res mask. */
  const loadSrcDims = async (path: string, token: number) => {
    const r = await run('magick', ['identify', '-format', '%w %h', path]);
    if (tokenRef.current !== token || r.code !== 0) return;
    const parts = r.stdout.trim().split(/\s+/).map(Number);
    const w = parts[0], h = parts[1];
    if (!w || !h) return;
    setSrcDims({ w, h });
    hiResMaskRef.current = new Uint8Array(w * h);
    setHiResVersion((v) => v + 1);
  };

  const ingest = async (path: string, colors: number) => {
    const myToken = ++tokenRef.current;
    resetForIngest(path);
    setBusy(true);
    void loadSrcDims(path, myToken);
    try {
      for (const size of SIZES) {
        setStatus(`converting ${size}×${size} @ ${colors} colors…`);
        const m = await imageToMatrix(path, size, colors);
        if (tokenRef.current !== myToken) return;
        setMatrices((prev) => ({ ...prev, [size]: m }));
      }
      setStatus('ready — preview below. click Save to write JSON.');
    } catch (e: any) {
      setStatus(`error: ${e?.message ?? String(e)}`);
    } finally {
      if (tokenRef.current === myToken) setBusy(false);
    }
  };

  const ingestVideo = async (path: string, colors: number, fps: number) => {
    const myToken = ++tokenRef.current;
    resetForIngest(path);
    setBusy(true);
    try {
      for (const size of SIZES) {
        const anim = await videoToAnim(
          path, size, colors, fps,
          (msg) => setStatus(`[${size}²] ${msg}`),
        );
        if (tokenRef.current !== myToken) return;
        setAnimMatrices((prev) => ({ ...prev, [size]: anim }));
        // Seed `matrices` with frame 0 so existing render paths just work.
        const seed: PixelMatrix = { size, palette: anim.palette, pixels: anim.frames[0].pixels };
        setMatrices((prev) => ({ ...prev, [size]: seed }));
      }
      setStatus(`ready — ${animMatricesRef.current[64]?.frames.length ?? '?'} frames. click Save.`);
    } catch (e: any) {
      setStatus(`error: ${e?.message ?? String(e)}`);
    } finally {
      if (tokenRef.current === myToken) setBusy(false);
    }
  };

  const animMatricesRef = useRef(animMatrices);
  animMatricesRef.current = animMatrices;

  useFileDrop((path) => {
    if (isVideoPath(path)) void ingestVideo(path, colorCount, animFps);
    else void ingest(path, colorCount);
  });

  // Re-quantize the current source without re-picking it.
  const requantize = (colors: number) => {
    setColorCount(colors);
    if (!srcPath) return;
    if (isVideoPath(srcPath)) void ingestVideo(srcPath, colors, animFps);
    else void ingest(srcPath, colors);
  };

  const onPick = async () => {
    setStatus('opening file picker…');
    const r = await execAsync(
      "zenity --file-selection --title='Pick an image' " +
      "--file-filter='Images | *.png *.jpg *.jpeg *.webp *.gif *.bmp *.tif *.tiff' " +
      "--file-filter='All files | *'"
    );
    const path = (r.stdout || '').trim();
    if (!path) { setStatus(`no file selected (exit ${r.code})`); return; }
    void ingest(path, colorCount);
  };

  const onPickVideo = async () => {
    setStatus('opening video picker…');
    const r = await execAsync(
      "zenity --file-selection --title='Pick a video or GIF' " +
      "--file-filter='Video | *.mp4 *.mov *.webm *.mkv *.avi *.gif *.m4v *.ogv' " +
      "--file-filter='All files | *'"
    );
    const path = (r.stdout || '').trim();
    if (!path) { setStatus(`no file selected (exit ${r.code})`); return; }
    void ingestVideo(path, colorCount, animFps);
  };

  // Animation playback (works for both video-anim and manual-frame modes).
  useEffect(() => {
    if (!isAnyAnim || !playing || totalFrames <= 1) return;
    const handle = setInterval(() => {
      setFrameIdx((i) => (i + 1) % totalFrames);
    }, Math.max(33, Math.floor(1000 / effectiveFps)));
    return () => clearInterval(handle);
  }, [isAnyAnim, playing, totalFrames, effectiveFps]);

  // Video-anim path: every time the active frame changes, refresh `matrices`
  // with that frame's pixels under the shared palette. Existing single-frame
  // render code is unchanged — it just sees a fresh PixelMatrix each tick.
  useEffect(() => {
    if (!isAnim) return;
    const nextMatrices: Matrices = {};
    for (const size of SIZES) {
      const am = animMatrices[size];
      if (!am || !am.frames[frameIdx]) continue;
      nextMatrices[size] = { size, palette: am.palette, pixels: am.frames[frameIdx].pixels };
    }
    setMatrices(nextMatrices);
  }, [isAnim, frameIdx, animMatrices]);

  // Manual-anim path: when the active frame changes, load that frame's
  // committed mask into the live `mask` so paint/wand/overlay see it. The
  // ref guard prevents this from clobbering an in-flight stroke on the same
  // frame; we only reload when frameIdx actually transitioned.
  useEffect(() => {
    if (isAnim) return;
    if (frameIdx === lastLoadedFrameRef.current) return;
    if (frameIdx < 0 || frameIdx >= frames.length) return;
    lastLoadedFrameRef.current = frameIdx;
    setMask(new Set(frames[frameIdx].mask));
    setPaint(new Map(frames[frameIdx].paint));
  }, [frameIdx, frames, isAnim]);

  const onSave = () => {
    mkdir('cart/pixel_icons');
    const written: string[] = [];
    if (isAnim) {
      // Animation save: one JSON per size, with shared palette and a frames
      // array. The mask (if any) is applied to every frame at save-time so
      // the crop persists across the whole loop.
      for (const size of SIZES) {
        const anim = animMatrices[size];
        if (!anim) continue;
        const scale = size / MASK_RES;
        const maskedFrames = anim.frames.map((fr) => {
          if (mask.size === 0) return { rows: encodeMatrix({ size, palette: anim.palette, pixels: fr.pixels }).rows };
          const px = fr.pixels.slice();
          for (const idx of mask) {
            const cx = idx % MASK_RES;
            const cy = Math.floor(idx / MASK_RES);
            const x0 = Math.floor(cx * scale);
            const y0 = Math.floor(cy * scale);
            const x1 = Math.floor((cx + 1) * scale);
            const y1 = Math.floor((cy + 1) * scale);
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px[y * size + x] = null;
          }
          return { rows: encodeMatrix({ size, palette: anim.palette, pixels: px }).rows };
        });
        const path = `cart/pixel_icons/${stem}.${size}.anim.json`;
        const payload = { size, palette: anim.palette, fps: anim.fps, frames: maskedFrames };
        if (writeFile(path, JSON.stringify(payload))) written.push(path);
      }
    } else if (frames.length > 1) {
      // Manual-frame animation: same source, per-frame mask + paint. Persist
      // in-flight edits into the current slot snapshot before reading frames.
      if (!matrices[64] || !matrices[128] || !matrices[512]) return;
      const persistedMasks: Set<number>[] = frames.map((f, i) =>
        i === frameIdx && !sameMask(f.mask, mask) ? new Set(mask) : f.mask,
      );
      const persistedPaints: Map<number, string>[] = frames.map((f, i) =>
        i === frameIdx && !samePaint(f.paint, paint) ? new Map(paint) : f.paint,
      );
      for (const size of SIZES) {
        const base = matrices[size]!;
        const framesOut = persistedMasks.map((fm, i) => {
          let m = base;
          const fp = persistedPaints[i];
          if (fp.size > 0) m = applyPaintToMatrix(m, fp);
          if (fm.size > 0) m = applyMaskToMatrix(m, fm);
          return { rows: encodeMatrix(m).rows };
        });
        const path = `cart/pixel_icons/${stem}.${size}.anim.json`;
        // Use the first frame's palette as canonical — applyPaintToMatrix
        // may have extended it. Other frames' palettes are compatible
        // because they all start from the same base and only append, but we
        // need to find the largest one to be safe.
        let canonicalPalette = base.palette;
        for (const fp of persistedPaints) {
          if (fp.size === 0) continue;
          const tmp = applyPaintToMatrix(base, fp);
          if (tmp.palette.length > canonicalPalette.length) canonicalPalette = tmp.palette;
        }
        const payload = { size, palette: canonicalPalette, fps: animFps, frames: framesOut };
        if (writeFile(path, JSON.stringify(payload))) written.push(path);
      }
    } else {
      if (!matrices[64] || !matrices[128] || !matrices[512]) return;
      for (const size of SIZES) {
        let m = matrices[size]!;
        if (paint.size > 0) m = applyPaintToMatrix(m, paint);
        if (mask.size > 0) m = applyMaskToMatrix(m, mask);
        const path = `cart/pixel_icons/${stem}.${size}.json`;
        if (writeFile(path, JSON.stringify(encodeMatrix(m)))) written.push(path);
      }
    }
    setSaved(written.join('\n'));
    setStatus(`saved ${written.length} file${written.length === 1 ? '' : 's'}`);
  };

  const onSavePNG = async () => {
    if (!srcPath) { setStatus('no source image to cut out'); return; }
    if (mask.size === 0 && paint.size === 0) {
      setStatus('nothing to cut — erase or paint something first'); return;
    }
    setBusy(true);
    setStatus('querying source dimensions…');
    try {
      const idR = await run('magick', ['identify', '-format', '%w %h', srcPath]);
      if (idR.code !== 0) { setStatus(`identify failed (exit ${idR.code})`); return; }
      const parts = idR.stdout.trim().split(/\s+/).map(Number);
      const w = parts[0], h = parts[1];
      if (!w || !h) { setStatus(`bad dims from identify: ${idR.stdout}`); return; }

      mkdir(SCRATCH_DIR);
      mkdir('cart/pixel_icons');

      // Decide which mask to use. Hi-res mask is at native source dims;
      // when it has any erased pixels we use it instead of the 64-grid
      // upscaled one, getting pixel-exact silhouettes. The 64-grid mask
      // still acts as a starting point: bake it into the hi-res mask
      // before write so coarse erases stack onto fine ones.
      const useHiRes = !!(hiResMaskRef.current && srcDims && (mask.size > 0 || hiResMaskHasAny(hiResMaskRef.current)));
      const maskPgmPath = `${SCRATCH_DIR}/cutout_mask.pgm`;
      let maskResize: string;
      let featherRadius: string;
      if (useHiRes && srcDims && hiResMaskRef.current) {
        // Merge 64-grid coarse erases into the hi-res mask so the export
        // reflects both. Hi-res mask is at srcDims, so 64-grid → srcDims
        // mapping is a simple scale.
        const composite = new Uint8Array(hiResMaskRef.current);
        if (mask.size > 0) {
          const scaleX = srcDims.w / MASK_RES;
          const scaleY = srcDims.h / MASK_RES;
          for (const idx of mask) {
            const cx = idx % MASK_RES;
            const cy = Math.floor(idx / MASK_RES);
            const x0 = Math.floor(cx * scaleX);
            const y0 = Math.floor(cy * scaleY);
            const x1 = Math.floor((cx + 1) * scaleX);
            const y1 = Math.floor((cy + 1) * scaleY);
            for (let y = y0; y < y1; y++) {
              const rowStart = y * srcDims.w;
              for (let x = x0; x < x1; x++) composite[rowStart + x] = 1;
            }
          }
        }
        if (!writeFile(maskPgmPath, hiResMaskToBinaryPGM(composite, srcDims.w, srcDims.h))) {
          setStatus('failed to write hi-res mask pgm'); return;
        }
        // Mask is already at native dims — no upscale needed, and very
        // light feather (0.5px) just to kill jaggies on diagonal edges.
        maskResize = `${srcDims.w}x${srcDims.h}!`;
        featherRadius = '0.5';
      } else {
        if (!writeFile(maskPgmPath, maskToPGM(mask))) {
          setStatus('failed to write mask pgm'); return;
        }
        maskResize = `${w}x${h}!`;
        // Heavier feather on 64-grid upscale — has to soften the stairstep.
        featherRadius = Math.max(0.5, Math.max(w, h) * 0.0005).toFixed(2);
      }

      const outPath = `cart/pixel_icons/${stem}.cutout.png`;
      const resize = `${w}x${h}!`;

      // Pass argv directly to magick — no shell, no escape gymnastics.
      // `(` and `)` are normal magick argv tokens for layer grouping.
      const args: string[] = [srcPath];
      if (paint.size > 0) {
        // Paint layer: upscale RGB + alpha PPMs to source dims (nearest-
        // neighbor so painted cells stay crisp blocks), composite over the
        // source, then apply the cutout mask.
        const { rgb, alpha } = paintToPPMs(paint);
        const paintRgbPath = `${SCRATCH_DIR}/cutout_paint_rgb.ppm`;
        const paintAlphaPath = `${SCRATCH_DIR}/cutout_paint_alpha.pgm`;
        if (!writeFile(paintRgbPath, rgb)) { setStatus('failed to write paint rgb'); return; }
        if (!writeFile(paintAlphaPath, alpha)) { setStatus('failed to write paint alpha'); return; }
        args.push(
          '(', paintRgbPath, paintAlphaPath,
            '-compose', 'CopyOpacity', '-composite',
            '-filter', 'point', '-resize', resize, ')',
          '-compose', 'Over', '-composite',
        );
      }
      args.push(
        '(', maskPgmPath, '-filter', 'point', '-resize', maskResize, '-blur', `0x${featherRadius}`, ')',
        '-alpha', 'off', '-compose', 'CopyOpacity', '-composite',
        outPath,
      );

      setStatus(`compositing ${w}×${h} cutout…`);
      const r = await run('magick', args);
      if (r.code !== 0) {
        setStatus(`composite failed (${r.code}): ${r.stderr.slice(0, 300)}`);
        return;
      }
      setSaved(outPath);
      setStatus(`saved PNG cutout → ${outPath} (${w}×${h})`);
    } catch (e: any) {
      setStatus(`png export error: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const screenToCell = (globalX: number, globalY: number): { cx: number; cy: number } | null => {
    const rect = previewRect;
    if (!rect || rect.width <= 0) return null;
    const cell = rect.width / MASK_RES;
    const cx = Math.floor((globalX - rect.x) / cell);
    const cy = Math.floor((globalY - rect.y) / cell);
    return { cx, cy };
  };

  /** Sub-cell-precise variant — returns fractional cell coords for hi-res
   *  brushing where the user is targeting a region smaller than one cell. */
  const screenToCellF = (globalX: number, globalY: number): { cx: number; cy: number } | null => {
    const rect = previewRect;
    if (!rect || rect.width <= 0) return null;
    const cell = rect.width / MASK_RES;
    return { cx: (globalX - rect.x) / cell, cy: (globalY - rect.y) / cell };
  };

  /** Convert a screen pointer to canvas world coords (= source pixel coords,
   *  since the Canvas.Node is sized gw=srcW, gh=srcH centered on srcW/2,srcH/2). */
  const screenToWorld = (sx: number, sy: number): { x: number; y: number } | null => {
    const rect = canvasRect;
    if (!rect || rect.width <= 0) return null;
    const vpcx = rect.x + rect.width / 2;
    const vpcy = rect.y + rect.height / 2;
    const w = canvasScreenToGraph(sx, sy, vpcx, vpcy);
    if (!w) return null;
    // gx/gy from screenToGraph are CENTERED at (0,0). The image's Canvas.Node
    // is centered at (srcW/2, srcH/2), so a node-local pixel at (px, py)
    // corresponds to world (px - srcW/2, py - srcH/2). Reverse that:
    if (!srcDims) return null;
    return { x: w.gx + srcDims.w / 2, y: w.gy + srcDims.h / 2 };
  };

  /** Paint into hi-res mask at source-pixel coords (used by the Canvas-based
   *  editor — no preview cell math involved). */
  const paintAtWorld = (worldX: number, worldY: number) => {
    if (!srcDims || !hiResMaskRef.current) return;
    if (mode === 'paint') return; // paint is a 64-grid feature
    const value = mode === 'erase' ? 1 : 0;
    paintHiResCircle(hiResMaskRef.current, srcDims.w, srcDims.h, worldX, worldY, brushPx, value);
  };

  const paintAt = (globalX: number, globalY: number) => {
    // Fine-brush path operates EXCLUSIVELY on the hi-res mask — bypasses
    // the 64-grid Set/paint maps entirely. Sub-cell positioning + circular
    // stamp at `brushPx` source pixels. Paint mode falls through to the
    // legacy 64-grid path (paint is a pixel-icon feature, not a cutout
    // feature). Restore mode reverses the hi-res erase.
    if (fineBrush && srcDims && hiResMaskRef.current && mode !== 'paint') {
      const hf = screenToCellF(globalX, globalY);
      if (!hf) return;
      const sx = hf.cx * (srcDims.w / MASK_RES);
      const sy = hf.cy * (srcDims.h / MASK_RES);
      const value = mode === 'erase' ? 1 : 0;
      paintHiResCircle(hiResMaskRef.current, srcDims.w, srcDims.h, sx, sy, brushPx, value);
      // Don't bump hiResVersion on every mousemove — the existing 64-grid
      // overlay is what's rendered, and version bumps would force the
      // PixelIcon subtree to reconcile. commitMask handles the version
      // bump once the stroke ends.
      return;
    }

    const hit = screenToCell(globalX, globalY);
    if (!hit) return;
    const { cx, cy } = hit;
    if (cx < -brushR || cy < -brushR || cx >= MASK_RES + brushR || cy >= MASK_RES + brushR) return;

    // For each affected cell, the three modes do different things:
    //   erase   → add to mask (clears paint on that cell, mask wins visually)
    //   restore → remove from mask AND paint (un-do anything on this cell)
    //   paint   → add to paint with current color, remove from mask
    let nextMask: Set<number> = mask;
    let nextPaint: Map<number, string> = paint;
    let maskChanged = false;
    let paintChanged = false;
    const ensureMask = () => { if (!maskChanged) { nextMask = new Set(mask); maskChanged = true; } };
    const ensurePaint = () => { if (!paintChanged) { nextPaint = new Map(paint); paintChanged = true; } };

    for (let dy = -brushR; dy <= brushR; dy++) {
      for (let dx = -brushR; dx <= brushR; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= MASK_RES || y < 0 || y >= MASK_RES) continue;
        const idx = y * MASK_RES + x;
        if (mode === 'erase') {
          if (!nextMask.has(idx)) { ensureMask(); nextMask.add(idx); }
          if (nextPaint.has(idx)) { ensurePaint(); nextPaint.delete(idx); }
        } else if (mode === 'restore') {
          if (nextMask.has(idx)) { ensureMask(); nextMask.delete(idx); }
          if (nextPaint.has(idx)) { ensurePaint(); nextPaint.delete(idx); }
        } else {
          // paint
          if (nextPaint.get(idx) !== paintColor) { ensurePaint(); nextPaint.set(idx, paintColor); }
          if (nextMask.has(idx)) { ensureMask(); nextMask.delete(idx); }
        }
      }
    }
    if (maskChanged) setMask(nextMask);
    if (paintChanged) setPaint(nextPaint);
  };

  const wandAt = (globalX: number, globalY: number) => {
    const hit = screenToCell(globalX, globalY);
    if (!hit) return;
    const { cx, cy } = hit;
    if (cx < 0 || cx >= MASK_RES || cy < 0 || cy >= MASK_RES) return;
    const m = matrices[MASK_RES as 64];
    if (!m) return;
    const region = mode === 'erase' || mode === 'paint'
      ? floodFillColor(m, cx, cy, tolerance)
      : floodFillMask(mask, cx, cy, MASK_RES);
    if (region.size === 0) return;

    const nextMask = new Set(mask);
    const nextPaint = new Map(paint);
    if (mode === 'erase') {
      for (const i of region) { nextMask.add(i); nextPaint.delete(i); }
    } else if (mode === 'restore') {
      for (const i of region) { nextMask.delete(i); nextPaint.delete(i); }
    } else {
      for (const i of region) { nextPaint.set(i, paintColor); nextMask.delete(i); }
    }
    setMask(nextMask);
    setPaint(nextPaint);
    // Wand has no drag stroke — commit immediately so thumbnails + undo see it.
    setFrames((prev) => {
      const cur = prev[frameIdx] ?? emptySlot();
      if (sameMask(cur.mask, nextMask) && samePaint(cur.paint, nextPaint)) return prev;
      const trimmed = cur.history.slice(0, cur.histIdx + 1);
      trimmed.push({ mask: new Set(nextMask), paint: new Map(nextPaint) });
      while (trimmed.length > 50) trimmed.shift();
      const next = prev.slice();
      next[frameIdx] = {
        mask: new Set(nextMask),
        paint: new Map(nextPaint),
        history: trimmed,
        histIdx: trimmed.length - 1,
      };
      return next;
    });
  };

  // IMPORTANT: do NOT recompute a masked matrix here on every keystroke. That
  // would hand PixelIcon a fresh `data` reference on every mouse-move and
  // re-render 4096 cells per event (×3 for the tiny variants) — a hard
  // thread-lock. PixelIcon is React.memo'd; we keep its `data` pinned to the
  // raw matrix and overlay erased cells via <MaskOverlay>, which costs
  // O(mask.size) per stroke instead of O(size²).
  const preview = matrices[PREVIEW_SIZE];
  const rawTiny = matrices[64];
  // Thumbnails use the COMMITTED mask only, applied directly into the data,
  // so they remain stable refs through a drag (no per-mousemove invalidation)
  // and snap to truth on stroke commit. This avoids relying on an absolute
  // overlay for the thumbnails, which we saw fail to render at certain
  // pixelSize values.
  // Thumbnails apply the committed paint THEN committed mask so the
  // matrix's final pixels reflect both layers; mask wins because it nulls
  // cells that paint had already colored.
  const tinyData = useMemo(() => {
    if (!rawTiny) return rawTiny;
    let m = rawTiny;
    if (committedPaint.size > 0) m = applyPaintToMatrix(m, committedPaint);
    if (committedMask.size > 0) m = applyMaskToMatrix(m, committedMask);
    return m;
  }, [rawTiny, committedMask, committedPaint]);

  // Sample the hi-res mask down to HIRES_OVERLAY_RES × HIRES_OVERLAY_RES
  // for the Canvas overlay. A cell is "erased" if any source pixel in its
  // footprint is erased — coarse but cheap, and the actual cut at export
  // uses the un-sampled hi-res mask. Bumps with hiResVersion only (live
  // brush strokes update the underlying mask without invalidating the
  // overlay; the user sees the change on stroke commit).
  const hiResOverlayCells = useMemo<Set<number>>(() => {
    const out = new Set<number>();
    const m = hiResMaskRef.current;
    if (!m || !srcDims) return out;
    const cellW = srcDims.w / HIRES_OVERLAY_RES;
    const cellH = srcDims.h / HIRES_OVERLAY_RES;
    for (let cy = 0; cy < HIRES_OVERLAY_RES; cy++) {
      const y0 = Math.floor(cy * cellH);
      const y1 = Math.min(srcDims.h, Math.floor((cy + 1) * cellH));
      for (let cx = 0; cx < HIRES_OVERLAY_RES; cx++) {
        const x0 = Math.floor(cx * cellW);
        const x1 = Math.min(srcDims.w, Math.floor((cx + 1) * cellW));
        let hit = false;
        outer: for (let y = y0; y < y1; y++) {
          const rowStart = y * srcDims.w;
          for (let x = x0; x < x1; x++) {
            if (m[rowStart + x]) { hit = true; break outer; }
          }
        }
        if (hit) out.add(cy * HIRES_OVERLAY_RES + cx);
      }
    }
    return out;
  }, [hiResVersion, srcDims]);

  const previewBg = '#11182a';

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: BG, padding: 24, gap: 16 }}>
      <Col style={{ gap: 4 }}>
        <Text style={{ color: INK, fontSize: 22, fontWeight: '700' }}>
          Image → pixel-icon
        </Text>
        <Text style={{ color: DIM, fontSize: 13 }}>
          Pick or drop an image. It converts to 64 / 128 / 512 color matrices.
          Click Save to write <Text style={{ color: ACCENT }}>cart/pixel_icons/&lt;stem&gt;.&lt;size&gt;.json</Text>.
        </Text>
      </Col>

      <Row style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Pressable onPress={onPick}>
          <Box style={{
            paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6,
            backgroundColor: ACCENT,
          }}>
            <Text style={{ color: '#0b1018', fontSize: 14, fontWeight: '700' }}>
              Pick image…
            </Text>
          </Box>
        </Pressable>
        <Pressable onPress={onPickVideo}>
          <Box style={{
            paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6,
            backgroundColor: '#1a2332', borderWidth: 1, borderColor: ACCENT,
          }}>
            <Text style={{ color: ACCENT, fontSize: 14, fontWeight: '700' }}>
              Pick video / GIF…
            </Text>
          </Box>
        </Pressable>
        <Text style={{ color: DIM, fontSize: 12 }}>or drop on window</Text>
        <Box style={{ width: 12 }} />
        <Text style={{ color: DIM, fontSize: 12 }}>colors</Text>
        {[16, 32, 64, 128, 256].map((n) => (
          <Pressable key={n} onPress={() => requantize(n)}>
            <Box style={{
              paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4,
              backgroundColor: colorCount === n ? ACCENT : '#1a2332',
            }}>
              <Text style={{ color: colorCount === n ? '#0b1018' : INK, fontSize: 12, fontWeight: '600' }}>
                {n}
              </Text>
            </Box>
          </Pressable>
        ))}
        <Box style={{ width: 12 }} />
        <Text style={{ color: DIM, fontSize: 12 }}>fps</Text>
        {[6, 12, 24, 30].map((n) => (
          <Pressable key={n} onPress={() => setAnimFps(n)}>
            <Box style={{
              paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4,
              backgroundColor: animFps === n ? ACCENT : '#1a2332',
            }}>
              <Text style={{ color: animFps === n ? '#0b1018' : INK, fontSize: 12, fontWeight: '600' }}>
                {n}
              </Text>
            </Box>
          </Pressable>
        ))}
      </Row>

      <Box style={{
        padding: 12, borderRadius: 8,
        backgroundColor: '#11182a',
        borderWidth: 1, borderColor: busy ? WARN : srcPath ? GOOD : '#2a3450',
      }}>
        <Text style={{ color: busy ? WARN : srcPath ? GOOD : DIM, fontSize: 13 }}>
          {status}
        </Text>
        {srcPath ? (
          <Text style={{ color: DIM, fontSize: 11, marginTop: 4 }}>{srcPath}</Text>
        ) : null}
      </Box>

      {srcPath ? (
        <Row style={{ alignItems: 'flex-start', gap: 24 }}>
          <Col style={{ gap: 6 }}>
            <Text style={{ color: DIM, fontSize: 12 }}>source</Text>
            <Image src={srcPath} style={{ width: 240, height: 240, borderRadius: 8 }} />
          </Col>

          <Col style={{ gap: 6 }}>
            <Text style={{ color: DIM, fontSize: 12 }}>
              {PREVIEW_SIZE}×{PREVIEW_SIZE} preview · {PREVIEW_PX * previewZoom}px cell · {tool === 'wand'
                ? (mode === 'erase' ? 'click a color to flood-erase it'
                   : mode === 'restore' ? 'click an erased region to restore it'
                   : 'click a color region to flood-paint with the picked color')
                : (mode === 'erase' ? 'click/drag to erase'
                   : mode === 'restore' ? 'click/drag to restore'
                   : 'click/drag to paint with the picked color')}
            </Text>
            <Box style={{ padding: 8, backgroundColor: previewBg, borderRadius: 8 }}>
              <Box
                style={{
                  position: 'relative',
                  width: PREVIEW_SIZE * PREVIEW_PX * previewZoom,
                  height: PREVIEW_SIZE * PREVIEW_PX * previewZoom,
                }}
                onLayout={(r: any) => setPreviewRect(r)}
                onMouseDown={(p: any) => {
                  if (tool === 'wand') { wandAt(p.x, p.y); return; }
                  drawingRef.current = true;
                  paintAt(p.x, p.y);
                }}
                onMouseMove={(p: any) => { if (drawingRef.current && tool === 'brush') paintAt(p.x, p.y); }}
                onMouseUp={commitMask}
                onMouseLeave={commitMask}
              >
                {preview ? <PixelIcon data={preview} pixelSize={PREVIEW_PX * previewZoom} /> : null}
                {preview ? <PaintOverlay paint={paint} dataSize={preview.size} pixelSize={PREVIEW_PX * previewZoom} /> : null}
                {preview ? <MaskOverlay mask={mask} dataSize={preview.size} pixelSize={PREVIEW_PX * previewZoom} bg={previewBg} /> : null}
              </Box>
            </Box>
            {/* Frame nav row. Shown for video anim (no add/remove) and for
                manual multi-frame mode, plus always shows + frame so static
                images can be promoted to manual animations on demand. */}
            {isAnyAnim || !isAnim ? (
              <Row style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {totalFrames > 1 ? (
                  <Pressable onPress={() => setPlaying((p) => !p)}>
                    <Box style={{
                      paddingHorizontal: 12, paddingVertical: 4, borderRadius: 4,
                      backgroundColor: playing ? GOOD : ACCENT,
                    }}>
                      <Text style={{ color: '#0b1018', fontSize: 12, fontWeight: '700' }}>
                        {playing ? 'pause' : 'play'}
                      </Text>
                    </Box>
                  </Pressable>
                ) : null}
                {totalFrames > 1 ? (
                  <Pressable onPress={() => {
                    setPlaying(false);
                    const target = (frameIdx - 1 + totalFrames) % totalFrames;
                    if (isAnim) setFrameIdx(target); else goToFrame(target);
                  }}>
                    <Box style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: '#1a2332' }}>
                      <Text style={{ color: INK, fontSize: 12 }}>◀</Text>
                    </Box>
                  </Pressable>
                ) : null}
                {totalFrames > 1 ? (
                  <Pressable onPress={() => {
                    setPlaying(false);
                    const target = (frameIdx + 1) % totalFrames;
                    if (isAnim) setFrameIdx(target); else goToFrame(target);
                  }}>
                    <Box style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: '#1a2332' }}>
                      <Text style={{ color: INK, fontSize: 12 }}>▶</Text>
                    </Box>
                  </Pressable>
                ) : null}
                {!isAnim ? (
                  <>
                    <Pressable onPress={addFrame}>
                      <Box style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: ACCENT }}>
                        <Text style={{ color: '#0b1018', fontSize: 12, fontWeight: '700' }}>+ frame</Text>
                      </Box>
                    </Pressable>
                    {frames.length > 1 ? (
                      <Pressable onPress={removeFrame}>
                        <Box style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: '#1a2332' }}>
                          <Text style={{ color: INK, fontSize: 12 }}>− frame</Text>
                        </Box>
                      </Pressable>
                    ) : null}
                  </>
                ) : null}
                {totalFrames > 1 ? (
                  <Text style={{ color: DIM, fontSize: 11 }}>
                    frame {frameIdx + 1}/{totalFrames} · {effectiveFps}fps
                  </Text>
                ) : (
                  <Text style={{ color: DIM, fontSize: 11 }}>
                    1 frame — click + frame to start animating
                  </Text>
                )}
              </Row>
            ) : null}
            <Row style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <Text style={{ color: DIM, fontSize: 11 }}>tool</Text>
              {(['brush', 'wand'] as const).map((t) => (
                <Pressable key={t} onPress={() => setTool(t)}>
                  <Box style={{
                    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4,
                    backgroundColor: tool === t ? ACCENT : '#1a2332',
                  }}>
                    <Text style={{ color: tool === t ? '#0b1018' : INK, fontSize: 11, fontWeight: '600' }}>
                      {t}
                    </Text>
                  </Box>
                </Pressable>
              ))}
              <Box style={{ width: 8 }} />
              {tool === 'brush' ? (
                <>
                  <Pressable onPress={() => setFineBrush((f) => !f)}>
                    <Box style={{
                      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4,
                      backgroundColor: fineBrush ? GOOD : '#1a2332',
                      borderWidth: 1,
                      borderColor: fineBrush ? GOOD : '#2a3450',
                    }}>
                      <Text style={{ color: fineBrush ? '#0b1018' : INK, fontSize: 11, fontWeight: '600' }}>
                        {fineBrush ? 'fine ✓' : 'fine'}
                      </Text>
                    </Box>
                  </Pressable>
                  {fineBrush ? (
                    <>
                      <Text style={{ color: DIM, fontSize: 11 }}>px</Text>
                      {[2, 8, 32, 128, 512].map((px) => (
                        <Pressable key={px} onPress={() => setBrushPx(px)}>
                          <Box style={{
                            paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4,
                            backgroundColor: brushPx === px ? ACCENT : '#1a2332',
                          }}>
                            <Text style={{ color: brushPx === px ? '#0b1018' : INK, fontSize: 11 }}>{px}</Text>
                          </Box>
                        </Pressable>
                      ))}
                    </>
                  ) : (
                    <>
                      <Text style={{ color: DIM, fontSize: 11 }}>brush</Text>
                      {[
                        { r: 0, label: '1' },
                        { r: 1, label: '3' },
                        { r: 2, label: '5' },
                        { r: 4, label: '9' },
                      ].map(({ r, label }) => (
                        <Pressable key={r} onPress={() => setBrushR(r)}>
                          <Box style={{
                            paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4,
                            backgroundColor: brushR === r ? ACCENT : '#1a2332',
                          }}>
                            <Text style={{ color: brushR === r ? '#0b1018' : INK, fontSize: 11 }}>{label}</Text>
                          </Box>
                        </Pressable>
                      ))}
                    </>
                  )}
                </>
              ) : (
                <>
                  <Text style={{ color: DIM, fontSize: 11 }}>tol</Text>
                  {[8, 16, 32, 48, 64, 96].map((t) => (
                    <Pressable key={t} onPress={() => setTolerance(t)}>
                      <Box style={{
                        paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4,
                        backgroundColor: tolerance === t ? ACCENT : '#1a2332',
                      }}>
                        <Text style={{ color: tolerance === t ? '#0b1018' : INK, fontSize: 11 }}>{t}</Text>
                      </Box>
                    </Pressable>
                  ))}
                </>
              )}
              <Box style={{ width: 8 }} />
              {(['erase', 'restore', 'paint'] as const).map((mm) => (
                <Pressable key={mm} onPress={() => setMode(mm)}>
                  <Box style={{
                    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4,
                    backgroundColor: mode === mm
                      ? (mm === 'erase' ? WARN : mm === 'restore' ? GOOD : ACCENT)
                      : '#1a2332',
                  }}>
                    <Text style={{
                      color: mode === mm ? '#0b1018' : INK,
                      fontSize: 11, fontWeight: '600',
                    }}>{mm}</Text>
                  </Box>
                </Pressable>
              ))}
              {mode === 'paint' ? (
                <>
                  <Box style={{ width: 4 }} />
                  {PRESET_PAINT_COLORS.map((c) => (
                    <Pressable key={c} onPress={() => setPaintColor(c)}>
                      <Box style={{
                        width: 22, height: 22, borderRadius: 4,
                        backgroundColor: c,
                        borderWidth: paintColor === c ? 2 : 1,
                        borderColor: paintColor === c ? ACCENT : '#2a3450',
                      }} />
                    </Pressable>
                  ))}
                  {/* Sample some colors from the current image palette so you
                      can paint with hues already in the image. */}
                  {(matrices[64]?.palette ?? []).slice(0, 8).map((c, i) => (
                    <Pressable key={`p${i}`} onPress={() => setPaintColor(c)}>
                      <Box style={{
                        width: 22, height: 22, borderRadius: 4,
                        backgroundColor: c,
                        borderWidth: paintColor === c ? 2 : 1,
                        borderColor: paintColor === c ? ACCENT : '#2a3450',
                      }} />
                    </Pressable>
                  ))}
                </>
              ) : null}
              <Pressable onPress={undo}>
                <Box style={{
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4,
                  backgroundColor: canUndo ? '#1a2332' : '#11182a',
                  opacity: canUndo ? 1 : 0.4,
                }}>
                  <Text style={{ color: INK, fontSize: 11, fontWeight: '600' }}>↶ undo</Text>
                </Box>
              </Pressable>
              <Pressable onPress={redo}>
                <Box style={{
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4,
                  backgroundColor: canRedo ? '#1a2332' : '#11182a',
                  opacity: canRedo ? 1 : 0.4,
                }}>
                  <Text style={{ color: INK, fontSize: 11, fontWeight: '600' }}>↷ redo</Text>
                </Box>
              </Pressable>
              <Pressable onPress={clearMask}>
                <Box style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: '#1a2332' }}>
                  <Text style={{ color: INK, fontSize: 11 }}>clear mask</Text>
                </Box>
              </Pressable>
              <Box style={{ width: 8 }} />
              <Text style={{ color: DIM, fontSize: 11 }}>zoom</Text>
              {[1, 2, 3].map((z) => (
                <Pressable key={z} onPress={() => setPreviewZoom(z)}>
                  <Box style={{
                    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4,
                    backgroundColor: previewZoom === z ? ACCENT : '#1a2332',
                  }}>
                    <Text style={{ color: previewZoom === z ? '#0b1018' : INK, fontSize: 11, fontWeight: '600' }}>
                      {z}×
                    </Text>
                  </Box>
                </Pressable>
              ))}
              <Text style={{ color: DIM, fontSize: 11 }}>
                {mask.size} erased · {paint.size} painted · h{slot.histIdx}/{slot.history.length - 1}
              </Text>
              <Box style={{ width: 12 }} />
              <Pressable onPress={onSave}>
                <Box style={{
                  paddingHorizontal: 14, paddingVertical: 6, borderRadius: 4,
                  backgroundColor: matrices[512] ? ACCENT : '#1a2332',
                  opacity: matrices[512] ? 1 : 0.5,
                }}>
                  <Text style={{ color: matrices[512] ? '#0b1018' : DIM, fontSize: 12, fontWeight: '700' }}>
                    Save → {stem}.json
                  </Text>
                </Box>
              </Pressable>
              <Pressable onPress={onSavePNG}>
                <Box style={{
                  paddingHorizontal: 14, paddingVertical: 6, borderRadius: 4,
                  // hiResVersion is intentionally referenced to make the
                  // button re-render after a fine-brush stroke commits, so
                  // an empty mask edit doesn't leave the button stuck dim.
                  backgroundColor: srcPath && (mask.size > 0 || paint.size > 0 || hiResVersion > 0) ? GOOD : '#1a2332',
                  opacity: srcPath && (mask.size > 0 || paint.size > 0 || hiResVersion > 0) ? 1 : 0.5,
                }}>
                  <Text style={{
                    color: srcPath && (mask.size > 0 || paint.size > 0 || hiResVersion > 0) ? '#0b1018' : DIM,
                    fontSize: 12, fontWeight: '700',
                  }}>
                    Save PNG cutout{srcDims ? ` (${srcDims.w}×${srcDims.h})` : ''}
                  </Text>
                </Box>
              </Pressable>
            </Row>
          </Col>

          <Col style={{ gap: 6 }}>
            <Text style={{ color: DIM, fontSize: 12 }}>icon sizes</Text>
            <Row style={{ gap: 12, alignItems: 'flex-end' }}>
              {[1, 2, 3].map((px) => (
                <Col key={px} style={{ gap: 4, alignItems: 'center' }}>
                  <Box style={{ padding: 4, backgroundColor: previewBg, borderRadius: 6 }}>
                    {tinyData ? <PixelIcon data={tinyData} pixelSize={px} /> : null}
                  </Box>
                  <Text style={{ color: DIM, fontSize: 10 }}>64@{px}</Text>
                </Col>
              ))}
            </Row>
          </Col>
        </Row>
      ) : null}

      {srcPath ? (
        <Row style={{ gap: 12, alignItems: 'center' }}>
          <Text style={{ color: DIM, fontSize: 13 }}>save as:</Text>
          <Text style={{ color: INK, fontSize: 14, fontWeight: '600' }}>
            cart/pixel_icons/{stem}.{'{'}64,128,512{'}'}.json
          </Text>
          <Pressable onPress={onSave}>
            <Box style={{
              paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6,
              backgroundColor: matrices[512] ? ACCENT : '#1a2332',
              opacity: matrices[512] ? 1 : 0.5,
            }}>
              <Text style={{ color: matrices[512] ? '#0b1018' : DIM, fontSize: 13, fontWeight: '600' }}>
                Save
              </Text>
            </Box>
          </Pressable>
        </Row>
      ) : null}

      {saved ? (
        <Box style={{ padding: 10, backgroundColor: '#11241a', borderRadius: 6 }}>
          <Text style={{ color: GOOD, fontSize: 12, fontWeight: '600' }}>saved</Text>
          {saved.split('\n').map((p, i) => (
            <Text key={i} style={{ color: GOOD, fontSize: 11 }}>{p}</Text>
          ))}
        </Box>
      ) : null}
    </Col>
  );
}
