// editors/paint/strokes.ts — pure stroke math: no React, no host calls, no
// GPU. Everything here runs identically under tools/v8cli and in the live
// surface; the surface's only job is to apply the dabs this module emits to
// a paintable texture.
//
// Behavior reference: cart/cutout/mask.ts + the stroke half of
// cart/cutout/state.ts, plus the two character-route capabilities the shared
// painter absorbed: mirror symmetry and min-step vector capture
// (editors/characters/paintKit.ts — the route swaps to these on adoption).

import { PAINT_TUNING } from './tuning';

export type GraySource = { pixels: Uint8Array; w: number; h: number };

// ── CPU raster ops (mask bytes are row-major Uint8Array) ─────────────────────

/** Filled circle. `value` is whatever the mask means (1 = erased, a sculpt
 *  byte, …) — the painter never assumes binary. */
export function paintCircle(
  mask: Uint8Array, w: number, h: number,
  cx: number, cy: number, r: number, value: number,
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

/** Snap a point to the strongest nearby Sobel gradient above `threshold`.
 *  Returns the input point when nothing within `radius` beats it. */
export function snapToStrongGradient(
  gray: Uint8Array, w: number, h: number,
  x: number, y: number, radius: number, threshold: number,
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

/** Edge-aware circle: writes only pixels whose gradient is BELOW threshold,
 *  so refine strokes expand/shrink regions without punching through strong
 *  visible edges. */
export function paintCircleEdgeAware(
  mask: Uint8Array, w: number, h: number, gray: Uint8Array,
  cx: number, cy: number, r: number, value: number, gradientThreshold: number,
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

/** Scanline polygon fill (the lasso commit). */
export function fillPolygon(
  mask: Uint8Array, w: number, h: number,
  verts: { x: number; y: number }[], value: number,
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

export function hasAnyPainted(mask: Uint8Array): boolean {
  for (let i = 0; i < mask.length; i++) if (mask[i]) return true;
  return false;
}

/** Downsample a hi-res mask to a coarse cell set (cy*res + cx indices where
 *  ANY covered source pixel is set). `rowsRes` (optional, defaults square)
 *  lets a non-square canvas bake to aspect-true cells — RESBAKE-0606: a 2:1
 *  unwrap at square res made every painted texel twice as tall as wide. */
export function sampleToCells(mask: Uint8Array, w: number, h: number, res: number, rowsRes = res): Set<number> {
  const out = new Set<number>();
  const cellW = w / res;
  const cellH = h / rowsRes;
  for (let cy = 0; cy < rowsRes; cy++) {
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

/** Coalesce row-runs of set cells into rectangles (cheap overlay render). */
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

/** 3×3 box blur — evens out lumpy hand strokes (the soften op). Dims are a
 *  parameter; the character route's 192×96 paint texture and any other
 *  target use the same code. */
export function soften3x3(src: Uint8Array, w: number, h: number): Uint8Array {
  const R = PAINT_TUNING.softenRadius;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const yy = y + dy, xx = x + dx;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          sum += src[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = Math.round(sum / n);
    }
  }
  return out;
}

// ── The stroke engine (pointer samples → gap-free dab lists) ─────────────────

export type Dab = { x: number; y: number; radius: number };

export type StrokeEngineOpts = {
  /** base brush size (the size-rail value) */
  brushPx: number;
  /** mirror dabs across the vertical line x = axisX (paintKit symmetry);
   *  mirrored dabs closer than mirrorMinSeparationPx are skipped */
  mirrorAxisX?: number | null;
  /** snap dab centers to the strongest nearby Sobel gradient (brush/refine
   *  with a gray source); omit for blind painting */
  snap?: GraySource | null;
  /** dab spacing fraction override (default PAINT_TUNING.spacingFrac) */
  spacingFrac?: number;
};

// ── The brush-size slider's track mapping ────────────────────────────────────
// t∈[0,1] ↔ px on a LOG curve, so the low end of the track is fine-grained
// (a linear track wastes most of its travel on 256–512px). Ends come from
// the brushSizes ladder; the ladder itself stays the [/] step-key and
// detent-tick source.

function brushTrackEnds(): { lo: number; hi: number } {
  const sizes = PAINT_TUNING.brushSizes;
  return { lo: Math.max(1, sizes[0]), hi: Math.max(2, sizes[sizes.length - 1]) };
}

/** slider track position → integer brush px (log-eased, clamped) */
export function brushTrackToPx(t: number): number {
  const { lo, hi } = brushTrackEnds();
  const c = Math.max(0, Math.min(1, t));
  return Math.round(lo * Math.pow(hi / lo, c));
}

/** brush px → slider track position (the inverse, clamped) */
export function brushPxToTrack(px: number): number {
  const { lo, hi } = brushTrackEnds();
  const p = Math.max(lo, Math.min(hi, px));
  return Math.log(p / lo) / Math.log(hi / lo);
}

/** Pointer pressure → dab radius (cutout's curve). */
export function pressureRadius(brushPx: number, pressure?: number): number {
  const { base, gain, fallback } = PAINT_TUNING.pressure;
  const p = typeof pressure === 'number' && Number.isFinite(pressure) && pressure > 0
    ? Math.max(0, Math.min(1, pressure)) : fallback;
  return Math.max(1, brushPx * (base + p * gain));
}

function snapPoint(snap: GraySource, x: number, y: number, radius: number): { x: number; y: number } {
  const { radiusFrac, radiusMin, radiusMax, threshold } = PAINT_TUNING.edgeSnap;
  const snapRadius = Math.max(radiusMin, Math.min(radiusMax, radius * radiusFrac));
  return snapToStrongGradient(snap.pixels, snap.w, snap.h, x, y, snapRadius, threshold);
}

function emitDab(out: Dab[], opts: StrokeEngineOpts, x: number, y: number, pressure?: number): void {
  const radius = pressureRadius(opts.brushPx, pressure);
  const pt = opts.snap ? snapPoint(opts.snap, x, y, radius) : { x, y };
  out.push({ x: pt.x, y: pt.y, radius });
  const axis = opts.mirrorAxisX;
  if (typeof axis === 'number') {
    const mx = axis * 2 - pt.x;
    if (Math.abs(mx - pt.x) > PAINT_TUNING.mirrorMinSeparationPx) {
      out.push({ x: mx, y: pt.y, radius });
    }
  }
}

export type StrokeEngine = {
  /** start a stroke (resets the interpolation anchor) */
  begin: () => void;
  /** feed one pointer sample; returns the dabs to apply (interpolated along
   *  the segment from the previous sample so fast strokes leave no gaps,
   *  pressure lerped, mirror/snap applied per dab) */
  move: (x: number, y: number, pressure?: number) => Dab[];
  /** end the stroke */
  end: () => void;
  drawing: () => boolean;
};

/** The painter's input core: pointer samples in target-pixel space →
 *  gap-free dab lists. Spacing = max(1, radius * spacingFrac), positions and
 *  pressure lerped between samples — the cutout stroke feel, with paintKit's
 *  mirror folded in so one engine serves every editor that paints. */
export function createStrokeEngine(opts: StrokeEngineOpts): StrokeEngine {
  let last: { x: number; y: number; pressure: number } | null = null;
  let active = false;
  const spacingFrac = opts.spacingFrac ?? PAINT_TUNING.spacingFrac;
  return {
    begin: () => { active = true; last = null; },
    end: () => { active = false; last = null; },
    drawing: () => active,
    move: (x: number, y: number, pressure = PAINT_TUNING.pressure.fallback): Dab[] => {
      if (!active) return [];
      const out: Dab[] = [];
      if (!last) {
        emitDab(out, opts, x, y, pressure);
        last = { x, y, pressure };
        return out;
      }
      const radius = pressureRadius(opts.brushPx, pressure);
      const spacing = Math.max(1, radius * spacingFrac);
      const dx = x - last.x;
      const dy = y - last.y;
      const dist = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.floor(dist / spacing));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        emitDab(out, opts, last.x + dx * t, last.y + dy * t, last.pressure + (pressure - last.pressure) * t);
      }
      last = { x, y, pressure };
      return out;
    },
  };
}

// ── Vector capture (stroke → thinned point list) ─────────────────────────────

export type VectorStroke = {
  /** add a point; returns true when it was kept (≥ minStep from the last) */
  add: (x: number, y: number) => boolean;
  points: () => { x: number; y: number }[];
  reset: () => void;
};

/** Min-step point thinning for strokes captured as vectors (the character
 *  route's face-paint layers). Units are whatever the caller paints in. */
export function createVectorStroke(minStep: number): VectorStroke {
  let pts: { x: number; y: number }[] = [];
  return {
    add: (x: number, y: number): boolean => {
      const prev = pts[pts.length - 1];
      if (prev) {
        const dx = x - prev.x;
        const dy = y - prev.y;
        if (Math.sqrt(dx * dx + dy * dy) < minStep) return false;
      }
      pts.push({ x, y });
      return true;
    },
    points: () => pts,
    reset: () => { pts = []; },
  };
}

// ── Lasso geometry ────────────────────────────────────────────────────────────

/** Should this click auto-close the lasso? (near the first vertex, with at
 *  least minVerts placed). Canvas dims drive the close radius. */
export function lassoShouldClose(
  points: { x: number; y: number }[], x: number, y: number, w: number, h: number,
): boolean {
  const { closeRadiusMin, closeRadiusFrac, minVerts } = PAINT_TUNING.lasso;
  if (points.length < minVerts) return false;
  const first = points[0];
  const dx = x - first.x, dy = y - first.y;
  const closeRadius = Math.max(closeRadiusMin, Math.min(w, h) * closeRadiusFrac);
  return dx * dx + dy * dy <= closeRadius * closeRadius;
}

/** Is this click a lasso-closing double-click? (within the window + dist of
 *  the previous click). */
export function lassoIsDoubleClick(
  prev: { x: number; y: number; at: number } | null, x: number, y: number, at: number,
): boolean {
  const { doubleClickMs, doubleClickDistSq } = PAINT_TUNING.lasso;
  return !!prev
    && at - prev.at <= doubleClickMs
    && (x - prev.x) * (x - prev.x) + (y - prev.y) * (y - prev.y) <= doubleClickDistSq;
}
