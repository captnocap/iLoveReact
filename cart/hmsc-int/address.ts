// Spreadsheet-style world addressing — the "fully addressable master" the design
// calls for. Internally everything is integer cell coords (x = column, z = row);
// this is a DISPLAY/PARSE skin over them, exactly like a spreadsheet shows "DP119"
// for column 119, row 119. Columns are bijective base-26 letters (A, B, … Z, AA,
// AB, …), rows are the plain integer.
//
// The mapping is anchored by the design's own example: chunk 000 spans top-left
// A0 to bottom-right DP119 for a 120-wide chunk, and "DP" = 4*26 + 16 = 120, so
// column index 119 → "DP" via bijective base-26 on (index + 1). 1 tile = 1 m.

export const CHUNK_SPAN_CELLS = 120;

const A = 'A'.charCodeAt(0);

// Column index (0-based) → letters. Bijective base-26 of (index + 1): 0→A, 25→Z,
// 26→AA, 119→DP. Negative columns get a '-' prefix on the magnitude so the world
// west of origin still has a readable address.
export function columnLabel(colIndex: number): string {
  const sign = colIndex < 0 ? '-' : '';
  let n = Math.abs(colIndex) + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(A + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return sign + out;
}

// Letters → column index (0-based). Inverse of columnLabel; returns null on a
// malformed label so a go-to box can reject bad input instead of jumping to NaN.
export function columnIndex(label: string): number | null {
  const m = /^(-?)([A-Za-z]+)$/.exec(label.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  let n = 0;
  for (const ch of m[2].toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - A + 1);
  }
  return sign * (n - 1);
}

// A cell's full address, e.g. "DP119". Column letters + row integer.
export function cellAddress(x: number, z: number): string {
  return `${columnLabel(x)}${z}`;
}

// Parse "DP119" → { x, z }, or null if malformed. Accepts an optional '-' on the
// row for the world north of origin.
export function parseAddress(text: string): { x: number; z: number } | null {
  const m = /^(-?[A-Za-z]+)(-?\d+)$/.exec(text.trim());
  if (!m) return null;
  const x = columnIndex(m[1]);
  if (x == null) return null;
  const z = Number(m[2]);
  if (!Number.isFinite(z)) return null;
  return { x, z };
}

// Which 120×120 chunk a cell falls in, as a chunk address like "chunk B,A"
// (column-major chunk grid). floor handles negatives so west/north chunks read
// correctly. The chunk's own min-corner cell is (cx*span, cz*span).
export function chunkOfCell(x: number, z: number): { cx: number; cz: number; label: string; minX: number; minZ: number } {
  const cx = Math.floor(x / CHUNK_SPAN_CELLS);
  const cz = Math.floor(z / CHUNK_SPAN_CELLS);
  return {
    cx,
    cz,
    label: `${columnLabel(cx)}${cz}`,
    minX: cx * CHUNK_SPAN_CELLS,
    minZ: cz * CHUNK_SPAN_CELLS,
  };
}
