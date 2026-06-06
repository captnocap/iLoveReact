// shell/colorRange.ts — the color-RANGE grid generator (SKINRANGE-0606).
//
// A `color` field with a `range` renders a full continuum, not a handful of
// hardcoded swatches: `stops` define the lerp path across the columns (for
// skin: the melanin curve pale → deep) and `warmth` fans each row warmer /
// cooler around it — every cell a real pickable value, any tone reachable.
// Pure (no React) so the P4 suite pins the grid.

export type ColorRange = {
  /** the gradient path, lerped across the columns (≥2 stops) */
  stops: string[];
  /** grid shape; defaults sized for the 290px panel */
  cols?: number;
  rows?: number;
  /** per-row warmth fan: the middle row is the pure curve; rows above shift
   *  warm (+r −b), rows below shift cool (−r +b), this many channel steps */
  warmth?: number;
};

type RGB = [number, number, number];

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hexToRgb(hex: string): RGB {
  const s = hex.replace('#', '');
  const v = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex([r, g, b]: RGB): string {
  const c = (x: number) => clampByte(x).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function lerpStops(stops: string[], t: number): RGB {
  if (stops.length === 1) return hexToRgb(stops[0]);
  const span = stops.length - 1;
  const pos = Math.max(0, Math.min(1, t)) * span;
  const i = Math.min(span - 1, Math.floor(pos));
  const f = pos - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** The grid: rows × cols of hex cells. Row 0 is the warmest fan, the middle
 *  row the pure stop curve, the last the coolest. */
export function colorRangeCells(range: ColorRange): string[][] {
  const cols = Math.max(2, range.cols ?? 14);
  const rows = Math.max(1, range.rows ?? 5);
  const warmth = range.warmth ?? 0;
  const mid = (rows - 1) / 2;
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const fan = rows === 1 ? 0 : ((mid - r) / mid) * warmth; // + = warm, − = cool
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      const [rr, gg, bb] = lerpStops(range.stops, cols === 1 ? 0 : c / (cols - 1));
      row.push(rgbToHex([rr + fan, gg, bb - fan]));
    }
    out.push(row);
  }
  return out;
}
