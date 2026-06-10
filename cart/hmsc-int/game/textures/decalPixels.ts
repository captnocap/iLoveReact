// game/textures/decalPixels.ts — the decal's BAKED PIXELS (DECALPIX-0610).
//
// A decal is AUTHORED content (Box/Text/Image), not procedural — it has no
// WGSL recipe to ship, so the compiled game can't re-run it (the loader has
// no React). V29's bake-by-execution answers this: the EDITOR (the only place
// that can render the doc) executes it once into a StaticSurface, reads the
// pixels back (__capture_surface_pixels), and persists them; the headless
// bake ships them in the MATERIALS lump's pixel tail and world_loader uploads
// them as the face texture — decals arrive in `rjit game play` exactly like
// shader materials do.
//
// `docHash` is the staleness key: the DecalPixelBaker re-captures whenever the
// stored doc no longer hashes to what the pixels were baked from (re-edit law:
// the doc stays the editable source; pixels are derived cache, never trusted
// over it).
//
// THE PIXEL BYTES LIVE AS FILES, not in the store value (DECALPIXFILE-0610):
// the shared 'hmsc' localstore caps VALUES at 8KB (storage/localstore.zig
// MAX_VALUE — fixed-width records; the binding's own rule is "keep entries
// small; for blobs use a file path") and a single capture is ~50KB+. The
// silent-write-failure loop this caused is req_0569. The record carries only
// {w, h, docHash, file}; the pixels are a JSON file under
// cart/hmsc-int/data/decal-pixels/ (gitignored, disk-only — the sessions/data
// convention), readable by BOTH the editor host and the headless v8cli bake
// through the plain __fs_read door.
//
// FILE FORMAT (USER ruling req_0572, "if you need a format look here →
// cart/pixel_icons/"): the repo's established rows-of-runs pixel JSON, sized
// rectangular — { width, height, palette: ['#rrggbb'|'#rrggbbaa', ...],
// rows: [[entry, ...], ...] } where an entry is a palette index, null
// (transparent pixel), or [count, index|null] (a run). Same shape
// pixel_icon_gallery decodes; palette-indexed and human-debuggable.
//
// LUMP CODEC (unchanged — the constructor.zig pair): pixel-level PackBits
// over 4-byte RGBA pixels. A control byte n (i8) is followed by pixel data:
// n >= 0 → (n+1) literal pixels follow; n < 0 → the ONE pixel that follows
// repeats (1-n) times. The bake re-encodes file JSON → RGBA → PackBits, so
// the on-disk format and the shipped format evolve independently.
//
// No React; file IO goes through the fs door (headless-safe callHost
// wrappers — absent host fns degrade to null/false, never throw).

import { readFile, writeFile } from '@reactjit/hooks/fs';
import type { DecalDoc } from './decal';

/** Where the baked pixel files live (cwd-relative — both the editor host and
 *  the v8cli bake run from the repo root, the sessions/data convention). */
export const DECAL_PIXELS_DIR = 'cart/hmsc-int/data/decal-pixels';

/** Baked pixels riding a stored decal material record. The record stays tiny
 *  (the localstore 8KB value cap); the pixels are rows-of-runs JSON in `file`.
 *  w/h are the captured texture's dimensions (the StaticSurface may capture
 *  at a DPI multiple of the doc's own canvas). */
export type DecalPixels = {
  w: number;
  h: number;
  /** hash of the DecalDoc these pixels were baked from (staleness key) */
  docHash: string;
  /** cwd-relative path of the rows-of-runs pixel JSON (the pixel_icons format) */
  file: string;
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

// ── the LUMP codec (PackBits — the constructor.zig pair) ─────────────────────

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

// ── the FILE codec (rows-of-runs pixel JSON — the cart/pixel_icons format) ──

/** One row entry: a palette index, null (transparent), or a [count, value]
 *  run — exactly what pixel_icon_gallery's decodeMatrix reads. */
export type DecalPixelRunEntry = number | null | [number, number | null];

export type DecalPixelFile = {
  width: number;
  height: number;
  palette: string[];
  rows: DecalPixelRunEntry[][];
};

function hexByte(v: number): string {
  return v.toString(16).padStart(2, '0');
}

/** RGBA bytes → the rows-of-runs pixel JSON text. Alpha-0 pixels encode as
 *  null (the format's transparent), '#rrggbb' for opaque, '#rrggbbaa' else. */
export function encodeDecalPixelFile(w: number, h: number, rgba: Uint8Array): string {
  const palette: string[] = [];
  const index = new Map<string, number>();
  const rows: DecalPixelRunEntry[][] = [];
  for (let y = 0; y < h; y += 1) {
    const row: DecalPixelRunEntry[] = [];
    let x = 0;
    while (x < w) {
      const at = (y * w + x) * 4;
      const a = rgba[at + 3];
      let value: number | null = null;
      if (a !== 0) {
        const color = a === 255
          ? `#${hexByte(rgba[at])}${hexByte(rgba[at + 1])}${hexByte(rgba[at + 2])}`
          : `#${hexByte(rgba[at])}${hexByte(rgba[at + 1])}${hexByte(rgba[at + 2])}${hexByte(a)}`;
        let slot = index.get(color);
        if (slot === undefined) {
          slot = palette.length;
          palette.push(color);
          index.set(color, slot);
        }
        value = slot;
      }
      // Run length: identical 4-byte pixels ahead on this row.
      let run = 1;
      while (x + run < w) {
        const next = (y * w + x + run) * 4;
        if (
          rgba[next] !== rgba[at] || rgba[next + 1] !== rgba[at + 1] ||
          rgba[next + 2] !== rgba[at + 2] || rgba[next + 3] !== rgba[at + 3]
        ) break;
        run += 1;
      }
      row.push(run >= 2 ? [run, value] : value);
      x += run;
    }
    rows.push(row);
  }
  const doc: DecalPixelFile = { width: w, height: h, palette, rows };
  return JSON.stringify(doc);
}

function parseHexColor(value: string): [number, number, number, number] | null {
  if (typeof value !== 'string' || value[0] !== '#') return null;
  const hex = value.slice(1);
  if (hex.length !== 6 && hex.length !== 8) return null;
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return null;
  if (hex.length === 6) return [(n >>> 16) & 255, (n >>> 8) & 255, n & 255, 255];
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

/** Pixel JSON text → RGBA bytes for the expected w×h, or null on any
 *  malformation (dimension mismatch, bad palette entry, row under/overrun) —
 *  never partial pixels. Transparent entries decode to 0,0,0,0. */
export function decodeDecalPixelFile(text: string, w: number, h: number): Uint8Array | null {
  let doc: DecalPixelFile;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || doc.width !== w || doc.height !== h) return null;
  if (!Array.isArray(doc.palette) || !Array.isArray(doc.rows) || doc.rows.length !== h) return null;
  const palette: Array<[number, number, number, number]> = [];
  for (const entry of doc.palette) {
    const color = parseHexColor(entry);
    if (!color) return null;
    palette.push(color);
  }
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const row = doc.rows[y];
    if (!Array.isArray(row)) return null;
    let x = 0;
    for (const entry of row) {
      let count = 1;
      let value: number | null;
      if (Array.isArray(entry)) {
        if (entry.length !== 2 || !Number.isInteger(entry[0]) || entry[0] < 1) return null;
        count = entry[0];
        value = entry[1];
      } else {
        value = entry;
      }
      if (value !== null && (!Number.isInteger(value) || value < 0 || value >= palette.length)) return null;
      if (x + count > w) return null;
      if (value !== null) {
        const [r, g, b, a] = palette[value];
        for (let k = 0; k < count; k += 1) {
          const at = (y * w + x + k) * 4;
          out[at] = r;
          out[at + 1] = g;
          out[at + 2] = b;
          out[at + 3] = a;
        }
      }
      x += count;
    }
    if (x !== w) return null;
  }
  return out;
}

// ── the stored payload + its file ────────────────────────────────────────────

/** The pixel file for a stored material id ('custom:claudes-closet' →
 *  decal-pixels/custom_claudes-closet.json) — deterministic, so a re-bake
 *  overwrites in place and never accumulates orphans. */
export function decalPixelsFilePath(id: string): string {
  return `${DECAL_PIXELS_DIR}/${id.replace(/[^a-zA-Z0-9-]+/g, '_')}.json`;
}

/** Encode a raw RGBA capture and WRITE it as the id's pixel file, returning
 *  the storable payload — null when the capture is malformed or the fs door
 *  refused the write (callers park the record; nothing half-saved). */
export function storeDecalPixels(id: string, doc: DecalDoc, w: number, h: number, rgba: Uint8Array): DecalPixels | null {
  if (w <= 0 || h <= 0 || w > MAX_PIXEL_DIM || h > MAX_PIXEL_DIM) return null;
  if (rgba.length !== w * h * 4) return null;
  const file = decalPixelsFilePath(id);
  if (!writeFile(file, encodeDecalPixelFile(w, h, rgba))) return null;
  return { w, h, docHash: decalDocHash(doc), file };
}

/** Boundary parse (the materials store rehydrates through this — a corrupt
 *  payload degrades to undefined, never a half-payload). Cheap: validates the
 *  shape only; the file content is checked at load. */
export function validateDecalPixels(raw: any): DecalPixels | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const w = Number(raw.w);
  const h = Number(raw.h);
  if (!Number.isInteger(w) || !Number.isInteger(h)) return undefined;
  if (w <= 0 || h <= 0 || w > MAX_PIXEL_DIM || h > MAX_PIXEL_DIM) return undefined;
  if (typeof raw.docHash !== 'string' || typeof raw.file !== 'string' || raw.file.length === 0) return undefined;
  return { w, h, docHash: raw.docHash, file: raw.file };
}

/** The payload's pixels back as raw RGBA bytes (null = missing/corrupt file). */
export function loadDecalPixelsRgba(pixels: DecalPixels): Uint8Array | null {
  const text = readFile(pixels.file);
  if (!text) return null;
  return decodeDecalPixelFile(text, pixels.w, pixels.h);
}
