// Subprocess seam — all magick interactions live here. Pure functions
// returning Promises; no React state, no UI.

import { run } from '@reactjit/runtime/hooks/process';
import { writeFile, mkdir } from '@reactjit/runtime/hooks/fs';

export const SCRATCH_DIR = '/tmp/_reactjit_cutout';

export interface Dims { w: number; h: number }

/** Query native pixel dimensions of an image file. */
export async function identify(path: string): Promise<Dims | null> {
  const r = await run('magick', ['identify', '-format', '%w %h', path]);
  if (r.code !== 0) return null;
  const parts = r.stdout.trim().split(/\s+/).map(Number);
  const w = parts[0], h = parts[1];
  if (!w || !h) return null;
  return { w, h };
}

/** Encode a Uint8Array as a P5 binary PGM with maxval=1. magick reads bytes
 *  0/1 as 0/full-white. Inverts because the mask convention here is
 *  1=erased→transparent (dark in alpha), 0=keep→opaque (bright). */
export function encodeMaskPGM(mask: Uint8Array, w: number, h: number): string {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  let body = '';
  const CHUNK = 32768;
  for (let i = 0; i < inv.length; i += CHUNK) {
    body += String.fromCharCode.apply(null, inv.subarray(i, i + CHUNK) as any);
  }
  // P5 (binary) with trailing newline — magick 7 is strict, requires it.
  return `P5\n${w} ${h}\n1\n${body}\n`;
}

/** Composite source + mask → PNG cutout. The mask must already match the
 *  source dimensions; we don't resize, just apply alpha and a sub-pixel
 *  AA blur. */
export async function compositeCutout(args: {
  srcPath: string;
  mask: Uint8Array;
  w: number;
  h: number;
  outPath: string;
  featherPx?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const { srcPath, mask, w, h, outPath, featherPx = 0.5 } = args;
  mkdir(SCRATCH_DIR);
  const maskPath = `${SCRATCH_DIR}/cutout_mask.pgm`;
  if (!writeFile(maskPath, encodeMaskPGM(mask, w, h))) {
    return { ok: false, error: 'failed to write mask pgm' };
  }
  const r = await run('magick', [
    srcPath,
    '(', maskPath, '-blur', `0x${featherPx.toFixed(2)}`, ')',
    '-alpha', 'off', '-compose', 'CopyOpacity', '-composite',
    outPath,
  ]);
  if (r.code !== 0) return { ok: false, error: r.stderr.slice(0, 300) };
  return { ok: true };
}
