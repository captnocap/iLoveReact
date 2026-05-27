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

export function sobelMagnitudeSq(gray: Uint8Array, w: number, h: number, x: number, y: number): number {
  if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return 0;
  const row = y * w;
  const a = gray[row - w + x - 1];
  const b = gray[row - w + x];
  const c = gray[row - w + x + 1];
  const d = gray[row + x - 1];
  const f = gray[row + x + 1];
  const g = gray[row + w + x - 1];
  const hh = gray[row + w + x];
  const i = gray[row + w + x + 1];
  const gx = -a + c - 2 * d + 2 * f - g + i;
  const gy = -a - 2 * b - c + g + 2 * hh + i;
  return gx * gx + gy * gy;
}

export function snapToStrongGradient(
  gray: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  radius: number,
  threshold: number,
): { x: number; y: number } {
  const cx = Math.max(1, Math.min(w - 2, Math.round(x)));
  const cy = Math.max(1, Math.min(h - 2, Math.round(y)));
  const r = Math.max(1, Math.round(radius));
  const thresholdSq = threshold * threshold;
  let bestX = cx;
  let bestY = cy;
  let best = thresholdSq;
  for (let yy = Math.max(1, cy - r); yy <= Math.min(h - 2, cy + r); yy++) {
    for (let xx = Math.max(1, cx - r); xx <= Math.min(w - 2, cx + r); xx++) {
      const dx = xx - x;
      const dy = yy - y;
      if (dx * dx + dy * dy > r * r) continue;
      const g = sobelMagnitudeSq(gray, w, h, xx, yy);
      if (g > best) {
        best = g;
        bestX = xx;
        bestY = yy;
      }
    }
  }
  return { x: bestX, y: bestY };
}

/** Edge-aware brush paint. Sobel gradients are computed from a grayscale
 *  source image; writes are allowed only in flatter areas below threshold.
 *  This gives the usual refine-brush behavior: expand/shrink broad regions
 *  without punching through strong visible image edges. */
export function paintCircleEdgeAware(
  mask: Uint8Array,
  w: number,
  h: number,
  gray: Uint8Array,
  cx: number,
  cy: number,
  r: number,
  value: number,
  gradientThreshold: number,
): void {
  const r2 = r * r;
  const thresholdSq = gradientThreshold * gradientThreshold;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const rowStart = y * w;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy > r2) continue;
      if (sobelMagnitudeSq(gray, w, h, x, y) >= thresholdSq) continue;
      mask[rowStart + x] = value;
    }
  }
}

export function fillPolygon(
  mask: Uint8Array,
  w: number,
  h: number,
  verts: { x: number; y: number }[],
  value: number,
): void {
  const n = verts.length;
  if (n < 3) return;
  let yMin = h;
  let yMax = 0;
  for (const v of verts) {
    yMin = Math.min(yMin, Math.floor(v.y));
    yMax = Math.max(yMax, Math.ceil(v.y));
  }
  yMin = Math.max(0, yMin);
  yMax = Math.min(h - 1, yMax);
  for (let y = yMin; y <= yMax; y++) {
    const intersections: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const yi = verts[i].y;
      const yj = verts[j].y;
      if ((yi <= y && yj > y) || (yj <= y && yi > y)) {
        const t = (y - yi) / (yj - yi);
        intersections.push(verts[i].x + t * (verts[j].x - verts[i].x));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let k = 0; k + 1 < intersections.length; k += 2) {
      const x0 = Math.max(0, Math.floor(intersections[k]));
      const x1 = Math.min(w - 1, Math.ceil(intersections[k + 1]));
      const rowStart = y * w;
      for (let x = x0; x <= x1; x++) mask[rowStart + x] = value;
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
