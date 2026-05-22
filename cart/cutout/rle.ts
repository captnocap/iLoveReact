// rle.ts — one row-RLE codec for the whole cutout cart.
//
// Replaces the parallel encoders that used to live in sqi.ts (the
// EncodedRunEntry / encodeRleRow / encodeMatrix / encodeMaskRows family)
// and session.ts (the SessionMask `number[][]` flat-pairs format). Every
// persisted grid in the cart — SQI base pixel matrix, SQI per-layer mask,
// session full-resolution brush mask, pixel-icon JSON — now round-trips
// through this module.
//
// Wire shape:
//   row entry  : `number | null | [count, number | null]`
//                 bare value = single cell, `null` = transparent / out,
//                 [count, v] = run of `count` cells of value `v`.
//   row        : array of entries (one per spatially-collapsed run)
//   rectangle  : `{ w, h, rows: RleRows }`
//   square     : `{ size, rows, palette? }` — palette grids only
//
// Decoder is lenient: short rows pad with null, extra entries past `width`
// are dropped. A reader can therefore consume a file written by a slightly
// older or wider version of the cart without parser drama.

export type RleEntry = number | null | [number, number | null];
export type RleRows = RleEntry[][];

/** Non-square (or arbitrary-rectangle) grid. Used by the session brush
 *  mask which is sized to the SOURCE image. */
export interface RleGrid {
  w: number;
  h: number;
  rows: RleRows;
}

/** Square palette-indexed grid. Compatible with the historical
 *  pixel_icon JSON shape so files written by saveIcons() slot straight
 *  into sqi.base. */
export interface EncodedMatrix {
  size: number;
  palette: string[];
  rows: RleRows;
}

// ── Row codec ─────────────────────────────────────────────────────────

export function encodeRleRow(values: Array<number | null>): RleEntry[] {
  const out: RleEntry[] = [];
  const n = values.length;
  let x = 0;
  while (x < n) {
    const v = values[x];
    let run = 1;
    while (x + run < n && values[x + run] === v) run++;
    out.push(run === 1 ? v : [run, v]);
    x += run;
  }
  return out;
}

export function decodeRleRow(row: RleEntry[], width: number): Array<number | null> {
  const out: Array<number | null> = new Array(width).fill(null);
  let x = 0;
  for (const e of row) {
    if (Array.isArray(e)) {
      const run = e[0] | 0;
      const v = e[1];
      for (let i = 0; i < run && x < width; i++) out[x++] = v;
    } else {
      if (x < width) out[x++] = e;
    }
  }
  return out;
}

// ── Rectangle codec ───────────────────────────────────────────────────

export function encodeGrid(values: Array<number | null>, w: number, h: number): RleGrid {
  const rows: RleRows = [];
  for (let y = 0; y < h; y++) {
    const row: Array<number | null> = new Array(w);
    for (let x = 0; x < w; x++) row[x] = values[y * w + x];
    rows.push(encodeRleRow(row));
  }
  return { w, h, rows };
}

export function decodeGrid(grid: RleGrid): Array<number | null> {
  const out: Array<number | null> = new Array(grid.w * grid.h).fill(null);
  const rowCount = Math.min(grid.h, grid.rows.length);
  for (let y = 0; y < rowCount; y++) {
    const flat = decodeRleRow(grid.rows[y], grid.w);
    for (let x = 0; x < grid.w; x++) out[y * grid.w + x] = flat[x];
  }
  return out;
}

// ── Binary mask convenience (Uint8Array ↔ RleGrid) ────────────────────
// The cart's working mask is a Uint8Array of 0/1 at source resolution.
// `null` is never produced here — out-of-mask cells are explicit `0`
// values — so a decoder gets back a tight Uint8Array.

export function encodeBinaryMask(mask: Uint8Array, w: number, h: number): RleGrid {
  const rows: RleRows = [];
  for (let y = 0; y < h; y++) {
    const row: Array<number | null> = new Array(w);
    for (let x = 0; x < w; x++) row[x] = mask[y * w + x] === 0 ? 0 : 1;
    rows.push(encodeRleRow(row));
  }
  return { w, h, rows };
}

export function decodeBinaryMask(grid: RleGrid): Uint8Array {
  const out = new Uint8Array(grid.w * grid.h);
  const rowCount = Math.min(grid.h, grid.rows.length);
  for (let y = 0; y < rowCount; y++) {
    const flat = decodeRleRow(grid.rows[y], grid.w);
    for (let x = 0; x < grid.w; x++) {
      const v = flat[x];
      out[y * grid.w + x] = v == null ? 0 : (v as number);
    }
  }
  return out;
}

// ── Cell-set codec (Set<number> at single resolution) ─────────────────
// Used for SQI layer masks at the document's overlayRes. Convention:
// bare `0` = "this cell is in the layer", `null` = "this cell is not".

export function encodeCellSet(cells: Set<number>, size: number): RleRows {
  const rows: RleRows = [];
  for (let y = 0; y < size; y++) {
    const row: Array<number | null> = new Array(size);
    for (let x = 0; x < size; x++) row[x] = cells.has(y * size + x) ? 0 : null;
    rows.push(encodeRleRow(row));
  }
  return rows;
}

export function decodeCellSet(rows: RleRows, size: number): Set<number> {
  const out = new Set<number>();
  const rowCount = Math.min(size, rows.length);
  for (let y = 0; y < rowCount; y++) {
    const flat = decodeRleRow(rows[y], size);
    for (let x = 0; x < size; x++) if (flat[x] != null) out.add(y * size + x);
  }
  return out;
}

// ── Square palette grid (sqi.base / pixel_icon) ───────────────────────

export function encodeMatrix(
  size: number,
  palette: string[],
  pixels: Array<number | null>,
): EncodedMatrix {
  const grid = encodeGrid(pixels, size, size);
  return { size, palette, rows: grid.rows };
}

export function decodeMatrix(m: EncodedMatrix): Array<number | null> {
  return decodeGrid({ w: m.size, h: m.size, rows: m.rows });
}
