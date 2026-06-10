// editors/cutout/sources.ts — source-image ingestion for the cutout painter
// route. The shared painter takes `dims`, `srcPath` and `gray` as DATA (the
// capture's explicit hand-off: "how sources load is the hosting editor's
// concern") — THIS is the hosting editor's loader: ImageMagick subprocess
// for native dimensions and the grayscale bytes that power edge snapping.
// Pure async functions, no React, no UI.
//
// Behavior reference: cart/cutout/magick.ts identify/loadGrayImage (read,
// never imported).

import { execAsync, run } from '@reactjit/runtime/hooks/process';
import { mkdir, readFile } from '@reactjit/runtime/hooks/fs';
import type { Dims, GraySource } from '../paint';

const SCRATCH_DIR = '/tmp/_reactjit_cutout_route';

/** IMGOPEN-0606: the native file picker — the ORIGINAL cutout app's zenity
 *  ingest restored (cart/cutout/state.ts:1232 is the reference; no host
 *  dialog door exists today, so the shell picker remains the honest path).
 *  Resolves to the chosen path, or null on cancel. */
export async function pickImageFile(title = 'Pick an image'): Promise<string | null> {
  const r = await execAsync(
    `zenity --file-selection --title='${title}' ` +
    "--file-filter='Images | *.png *.jpg *.jpeg *.webp *.gif *.bmp *.tif *.tiff' " +
    "--file-filter='All files | *'",
  );
  const path = (r.stdout || '').trim();
  return path || null;
}

// (the path cleaner lives in workbench/paint/store.ts cleanImagePath —
// INSIDE openImage, so picker/drop share it, and the headless P4 suite can
// pin it without pulling this module's host doors)

/** Native pixel dimensions of an image file (null = unreadable/not an image). */
export async function identifyImage(path: string): Promise<Dims | null> {
  const r = await run('magick', ['identify', '-format', '%w %h', path]);
  if (r.code !== 0) return null;
  const [w, h] = r.stdout.trim().split(/\s+/).map(Number);
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  return { w, h };
}

/** The host fs returns file content as a JS string; raw gray bytes ride one
 *  char per byte — recover them via charCodeAt (the proven host idiom). */
function bytesFromHostString(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** Decode a source image to one-byte-per-pixel grayscale at `dims` — the
 *  painter's edge-snap/refine input. Null on any failure (the painter just
 *  paints without snapping). */
export async function loadGraySource(path: string, dims: Dims): Promise<GraySource | null> {
  mkdir(SCRATCH_DIR);
  const outPath = `${SCRATCH_DIR}/gray_${Date.now().toString(36)}_${Math.floor(Math.random() * 0xffff).toString(36)}.u8`;
  const r = await run('magick', [
    path,
    '-auto-orient',
    '-resize', `${dims.w}x${dims.h}!`,
    '-colorspace', 'Gray',
    '-depth', '8',
    `gray:${outPath}`,
  ]);
  if (r.code !== 0) return null;
  const raw = readFile(outPath);
  if (!raw) return null;
  const pixels = bytesFromHostString(raw);
  if (pixels.length < dims.w * dims.h) return null;
  return { w: dims.w, h: dims.h, pixels: pixels.subarray(0, dims.w * dims.h) };
}
