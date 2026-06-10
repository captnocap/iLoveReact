// game/textures/decalPixels.ts — the decal's BAKED PIXELS (DECALPIX-0610).
//
// A decal is AUTHORED content (Box/Text/Image), not procedural — it has no
// WGSL recipe to ship, so the compiled game can't re-run it (the loader has
// no React). V29's bake-by-execution answers this: the EDITOR (the only place
// that can render the doc) executes it once into a StaticSurface, reads the
// pixels back (__surface_readback), and the payload rides the stored material
// record. The headless bake ships it in the MATERIALS lump's pixel tail and
// world_loader uploads it as the face texture — decals arrive in `rjit game
// play` exactly like shader materials do.
//
// `docHash` is the staleness key: the DecalPixelBaker re-captures whenever the
// stored doc no longer hashes to what the pixels were baked from (re-edit law:
// the doc stays the editable source; pixels are derived cache, never trusted
// over it).
//
// Codec: pixel-level PackBits over 4-byte RGBA pixels. A control byte n
// (i8) is followed by pixel data: n >= 0 → (n+1) literal pixels follow;
// n < 0 → the ONE pixel that follows repeats (1-n) times. Flat regions (most
// of a decal) collapse 128 pixels into 5 bytes; worst case (no runs) costs
// 1 byte per 128 raw pixels (~0.8%). Same scheme both sides — TS here,
// constructor.zig decodes at world construct.
//
// Data only — no React, no host calls (the materials store embeds these
// payloads; the capture half is DecalPixelBaker.tsx).

import { bytesToBase64, base64ToBytes } from '@reactjit/workspace';
import type { DecalDoc } from './decal';

/** Baked pixels riding a stored decal material record. `data` is base64 of
 *  the pixel-RLE stream; w/h are the captured texture's dimensions (the
 *  StaticSurface may capture at a DPI multiple of the doc's own canvas). */
export type DecalPixels = {
  w: number;
  h: number;
  /** hash of the DecalDoc these pixels were baked from (staleness key) */
  docHash: string;
  /** base64( pixel-PackBits( RGBA bytes ) ) */
  data: string;
};

const MAX_PIXEL_DIM = 4096;

/** FNV-1a over the doc's canonical JSON — the bake-staleness key. Stable as
 *  long as the doc is unchanged (JSON.stringify of the validated doc is
 *  deterministic: validateDecalDoc rebuilds records field-by-field). */
export function decalDocHash(doc: DecalDoc): string {
  const text = JSON.stringify(doc);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** RGBA bytes → pixel-PackBits stream. `rgba.length` must be w*h*4. */
export function encodePixelRle(rgba: Uint8Array): Uint8Array {
  if (rgba.length % 4 !== 0) throw new Error('pixel rle: byte length not a multiple of 4');
  const count = rgba.length / 4;
  const px = (i: number) =>
    (rgba[i * 4] << 24) | (rgba[i * 4 + 1] << 16) | (rgba[i * 4 + 2] << 8) | rgba[i * 4 + 3];
  const out: number[] = [];
  let i = 0;
  while (i < count) {
    // Measure the run at i.
    let run = 1;
    while (i + run < count && run < 128 && px(i + run) === px(i)) run += 1;
    if (run >= 2) {
      out.push(256 - run); // i8 (1 - run) as unsigned byte
      out.push(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]);
      i += run;
      continue;
    }
    // Literal stretch: until the next run of >= 2 (or 128 pixels).
    let lit = 1;
    while (i + lit < count && lit < 128) {
      if (i + lit + 1 < count && px(i + lit) === px(i + lit + 1)) break;
      lit += 1;
    }
    out.push(lit - 1);
    for (let k = 0; k < lit; k += 1) {
      out.push(rgba[(i + k) * 4], rgba[(i + k) * 4 + 1], rgba[(i + k) * 4 + 2], rgba[(i + k) * 4 + 3]);
    }
    i += lit;
  }
  return Uint8Array.from(out);
}

/** pixel-PackBits stream → RGBA bytes (exactly `pixelCount` pixels), or null
 *  on a malformed stream (truncated control/pixel data or count mismatch). */
export function decodePixelRle(rle: Uint8Array, pixelCount: number): Uint8Array | null {
  const out = new Uint8Array(pixelCount * 4);
  let at = 0;
  let emitted = 0;
  while (emitted < pixelCount) {
    if (at >= rle.length) return null;
    const control = rle[at];
    at += 1;
    if (control >= 128) {
      // repeat: next pixel appears (257 - control) times — control = 256 - run
      const run = 256 - control;
      if (at + 4 > rle.length || emitted + run > pixelCount) return null;
      for (let k = 0; k < run; k += 1) {
        out[(emitted + k) * 4] = rle[at];
        out[(emitted + k) * 4 + 1] = rle[at + 1];
        out[(emitted + k) * 4 + 2] = rle[at + 2];
        out[(emitted + k) * 4 + 3] = rle[at + 3];
      }
      at += 4;
      emitted += run;
    } else {
      const lit = control + 1;
      if (at + lit * 4 > rle.length || emitted + lit > pixelCount) return null;
      out.set(rle.subarray(at, at + lit * 4), emitted * 4);
      at += lit * 4;
      emitted += lit;
    }
  }
  return at === rle.length ? out : null;
}

/** Build the storable payload from a raw RGBA capture. */
export function packDecalPixels(doc: DecalDoc, w: number, h: number, rgba: Uint8Array): DecalPixels | null {
  if (w <= 0 || h <= 0 || w > MAX_PIXEL_DIM || h > MAX_PIXEL_DIM) return null;
  if (rgba.length !== w * h * 4) return null;
  return { w, h, docHash: decalDocHash(doc), data: bytesToBase64(encodePixelRle(rgba)) };
}

/** Boundary parse (the materials store rehydrates through this — a corrupt
 *  payload degrades to undefined, never a half-payload). Cheap: validates the
 *  shape only; the RLE stream is checked at decode. */
export function validateDecalPixels(raw: any): DecalPixels | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const w = Number(raw.w);
  const h = Number(raw.h);
  if (!Number.isInteger(w) || !Number.isInteger(h)) return undefined;
  if (w <= 0 || h <= 0 || w > MAX_PIXEL_DIM || h > MAX_PIXEL_DIM) return undefined;
  if (typeof raw.docHash !== 'string' || typeof raw.data !== 'string' || raw.data.length === 0) return undefined;
  return { w, h, docHash: raw.docHash, data: raw.data };
}

/** Decode a stored payload back to raw RGBA bytes (null = corrupt). */
export function decalPixelsRgba(pixels: DecalPixels): Uint8Array | null {
  try {
    return decodePixelRle(base64ToBytes(pixels.data), pixels.w * pixels.h);
  } catch {
    return null;
  }
}

/** The RLE stream itself (what the MATERIALS lump ships — the loader decodes). */
export function decalPixelsRle(pixels: DecalPixels): Uint8Array | null {
  try {
    return base64ToBytes(pixels.data);
  } catch {
    return null;
  }
}
