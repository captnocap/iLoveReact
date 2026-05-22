// Pure mask + coordinate helpers — no React, no I/O. Everything here is a
// function you can unit-test in isolation or call from any layer.

/** Filled-circle paint into a row-major Uint8Array. value: 1=erased, 0=keep. */
export function paintCircle(
  mask: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  value: number,
): void {
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

export function hasAnyErased(mask: Uint8Array): boolean {
  for (let i = 0; i < mask.length; i++) if (mask[i]) return true;
  return false;
}

/** Sample the hi-res mask down to a coarse overlay grid. Returns a Set of
 *  cell indices (cy*res + cx) where ANY source pixel is erased. */
export function sampleToCells(
  mask: Uint8Array,
  w: number,
  h: number,
  res: number,
): Set<number> {
  const out = new Set<number>();
  const cellW = w / res;
  const cellH = h / res;
  for (let cy = 0; cy < res; cy++) {
    const y0 = Math.floor(cy * cellH);
    const y1 = Math.min(h, Math.floor((cy + 1) * cellH));
    for (let cx = 0; cx < res; cx++) {
      const x0 = Math.floor(cx * cellW);
      const x1 = Math.min(w, Math.floor((cx + 1) * cellW));
      let hit = false;
      outer: for (let y = y0; y < y1; y++) {
        const rowStart = y * w;
        for (let x = x0; x < x1; x++) {
          if (mask[rowStart + x]) { hit = true; break outer; }
        }
      }
      if (hit) out.add(cy * res + cx);
    }
  }
  return out;
}

/** Coalesce row-runs of "set" cells into rectangles. Used to render the
 *  sampled overlay as a small number of absolute Boxes instead of a per-cell
 *  box explosion. */
export type Run = { x: number; y: number; len: number };
export function rowRuns(cells: Set<number>, res: number): Run[] {
  const out: Run[] = [];
  for (let y = 0; y < res; y++) {
    let x = 0;
    while (x < res) {
      if (!cells.has(y * res + x)) { x++; continue; }
      const start = x;
      while (x < res && cells.has(y * res + x)) x++;
      out.push({ x: start, y, len: x - start });
    }
  }
  return out;
}
