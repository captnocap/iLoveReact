// runtime/paint/stroke.ts — the universal stroke core: pointer samples in
// target-pixel space → gap-free dab lists, plus the size-track mapping, the
// pressure curve, and the shift-constraint geometry. Pure math: no React, no
// host, no GPU — runs identically under tools/v8cli and live.
//
// Promoted from hmsc-int/editors/paint/strokes.ts (createStrokeEngine + the
// brush-track log mapping) and decoupled from PAINT_TUNING: the few constants
// it needs are an inline, overridable config so any cart gets the proven
// cutout feel without importing the game's tunables registry.

export interface StrokeTuning {
  /** brush diameters the size rail detents to; [ and ] step through these. */
  sizeLadder: number[];
  /** dab spacing along a stroke, as a fraction of the dab radius. */
  spacingFrac: number;
  /** pointer pressure → dab radius: r = size/2 * (base + p*gain), floor 1. */
  pressure: { base: number; gain: number; fallback: number };
  /** mirrored dabs closer than this to the original are skipped. */
  mirrorMinSeparationPx: number;
  /** Shape-tool outline segmentation. */
  outline: { ellipseMinSegments: number; ellipseSegmentScale: number };
}

export const STROKE_TUNING: StrokeTuning = {
  sizeLadder: [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512],
  spacingFrac: 0.32,
  pressure: { base: 0.35, gain: 1.3, fallback: 0.5 },
  mirrorMinSeparationPx: 2,
  outline: { ellipseMinSegments: 16, ellipseSegmentScale: 0.5 },
};

// ── Size-track mapping ───────────────────────────────────────────────────────
// t∈[0,1] ↔ px on a LOG curve so the low end of the slider is fine-grained (a
// linear track wastes most travel on 256–512px). Ends come from the ladder;
// the ladder is also the [/] step source.

function trackEnds(t: StrokeTuning): { lo: number; hi: number } {
  const s = t.sizeLadder;
  return { lo: Math.max(1, s[0]), hi: Math.max(2, s[s.length - 1]) };
}

/** slider position 0..1 → integer brush px (log-eased, clamped). */
export function sizeTrackToPx(track: number, t: StrokeTuning = STROKE_TUNING): number {
  const { lo, hi } = trackEnds(t);
  const c = Math.max(0, Math.min(1, track));
  return Math.round(lo * Math.pow(hi / lo, c));
}

/** brush px → slider position 0..1 (the inverse, clamped). */
export function sizePxToTrack(px: number, t: StrokeTuning = STROKE_TUNING): number {
  const { lo, hi } = trackEnds(t);
  const p = Math.max(lo, Math.min(hi, px));
  return Math.log(p / lo) / Math.log(hi / lo);
}

/** Step a px size up/down the detent ladder ([ and ] keys). dir = ±1. */
export function stepSizeLadder(px: number, dir: number, t: StrokeTuning = STROKE_TUNING): number {
  const ladder = t.sizeLadder;
  if (dir < 0) {
    let next = ladder[0];
    for (const s of ladder) { if (s < px) next = s; else break; }
    return next;
  }
  for (const s of ladder) { if (s > px) return s; }
  return ladder[ladder.length - 1];
}

/** Pointer pressure → dab radius from a brush diameter. */
export function pressureRadius(sizePx: number, pressure?: number, t: StrokeTuning = STROKE_TUNING): number {
  const { base, gain, fallback } = t.pressure;
  const p = typeof pressure === 'number' && Number.isFinite(pressure) && pressure > 0
    ? Math.max(0, Math.min(1, pressure)) : fallback;
  return Math.max(1, (sizePx / 2) * (base + p * gain));
}

// ── Shift constraints ────────────────────────────────────────────────────────

/** Constrain a point to a straight line from an anchor. When `axisLock`, snap
 *  to the nearest of horizontal / vertical / 45°; otherwise free angle. This
 *  is the "hold shift for straight-line shit" the kit guarantees everywhere. */
export function constrainLine(
  ax: number, ay: number, x: number, y: number, axisLock = true,
): { x: number; y: number } {
  const dx = x - ax;
  const dy = y - ay;
  if (!axisLock) return { x, y };
  const ang = Math.atan2(dy, dx);
  const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: ax + Math.cos(snapped) * len, y: ay + Math.sin(snapped) * len };
}

/** Constrain a drag rect to a square (shift while dragging rect/ellipse),
 *  growing from the anchor toward the pointer's quadrant. */
export function constrainSquare(
  ax: number, ay: number, x: number, y: number,
): { x: number; y: number } {
  const dx = x - ax;
  const dy = y - ay;
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: ax + Math.sign(dx || 1) * s, y: ay + Math.sign(dy || 1) * s };
}

// ── The stroke engine (pointer samples → gap-free dab lists) ─────────────────

export type Dab = { x: number; y: number; radius: number; pressure: number };

export interface StrokeEngineOpts {
  /** base brush diameter (the size-rail value). */
  sizePx: number;
  /** mirror dabs across the vertical line x = mirrorAxisX. */
  mirrorAxisX?: number | null;
  /** spacing fraction override (default tuning.spacingFrac). */
  spacingFrac?: number;
  tuning?: StrokeTuning;
}

export interface StrokeEngine {
  begin: () => void;
  /** feed one pointer sample; returns interpolated dabs since the last sample
   *  (gap-free at any speed, pressure lerped, mirror applied). */
  move: (x: number, y: number, pressure?: number) => Dab[];
  end: () => void;
  drawing: () => boolean;
}

export function createStrokeEngine(opts: StrokeEngineOpts): StrokeEngine {
  const t = opts.tuning ?? STROKE_TUNING;
  const spacingFrac = opts.spacingFrac ?? t.spacingFrac;
  let last: { x: number; y: number; pressure: number } | null = null;
  let active = false;

  const emit = (out: Dab[], x: number, y: number, pressure: number) => {
    const radius = pressureRadius(opts.sizePx, pressure, t);
    out.push({ x, y, radius, pressure });
    const axis = opts.mirrorAxisX;
    if (typeof axis === 'number') {
      const mx = axis * 2 - x;
      if (Math.abs(mx - x) > t.mirrorMinSeparationPx) out.push({ x: mx, y, radius, pressure });
    }
  };

  return {
    begin: () => { active = true; last = null; },
    end: () => { active = false; last = null; },
    drawing: () => active,
    move: (x, y, pressure = t.pressure.fallback): Dab[] => {
      if (!active) return [];
      const out: Dab[] = [];
      if (!last) {
        emit(out, x, y, pressure);
        last = { x, y, pressure };
        return out;
      }
      const radius = pressureRadius(opts.sizePx, pressure, t);
      const spacing = Math.max(1, radius * spacingFrac);
      const dx = x - last.x;
      const dy = y - last.y;
      const steps = Math.max(1, Math.floor(Math.hypot(dx, dy) / spacing));
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        emit(out, last.x + dx * f, last.y + dy * f, last.pressure + (pressure - last.pressure) * f);
      }
      last = { x, y, pressure };
      return out;
    },
  };
}

/** Even dab spacing along an arbitrary segment (line tool / rect & ellipse
 *  outlines) — used when the path is known up front rather than streamed. */
export function dabsAlongSegment(
  ax: number, ay: number, bx: number, by: number, sizePx: number,
  spacingFrac = STROKE_TUNING.spacingFrac, tuning: StrokeTuning = STROKE_TUNING,
): Dab[] {
  const radius = pressureRadius(sizePx, tuning.pressure.fallback, tuning);
  const spacing = Math.max(1, radius * spacingFrac);
  const dx = bx - ax;
  const dy = by - ay;
  const steps = Math.max(1, Math.round(Math.hypot(dx, dy) / spacing));
  const out: Dab[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    out.push({ x: ax + dx * f, y: ay + dy * f, radius, pressure: tuning.pressure.fallback });
  }
  return out;
}

export type RecordedStrokeTool = 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse';

/** Replay a committed pointer path through the same interpolation used live.
 *  This is the durable paint-program boundary: carts store paths + recipes,
 *  never private dab math or raster pixels. */
export function dabsForStrokePath(
  tool: RecordedStrokeTool,
  points: readonly number[],
  sizePx: number,
  spacingFrac = STROKE_TUNING.spacingFrac,
): Dab[] {
  if (points.length < 2) return [];
  const ax = points[0]!, ay = points[1]!;
  const bx = points[points.length - 2]!, by = points[points.length - 1]!;
  if (tool === 'line') return dabsAlongSegment(ax, ay, bx, by, sizePx, spacingFrac);
  if (tool === 'rect') {
    return [
      ...dabsAlongSegment(ax, ay, bx, ay, sizePx, spacingFrac),
      ...dabsAlongSegment(bx, ay, bx, by, sizePx, spacingFrac),
      ...dabsAlongSegment(bx, by, ax, by, sizePx, spacingFrac),
      ...dabsAlongSegment(ax, by, ax, ay, sizePx, spacingFrac),
    ];
  }
  if (tool === 'ellipse') {
    const cx = (ax + bx) / 2, cy = (ay + by) / 2;
    const rx = Math.abs(bx - ax) / 2, ry = Math.abs(by - ay) / 2;
    const steps = Math.max(STROKE_TUNING.outline.ellipseMinSegments, Math.round((rx + ry) * STROKE_TUNING.outline.ellipseSegmentScale));
    const out: Dab[] = [];
    let px = cx + rx, py = cy;
    for (let i = 1; i <= steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      const nx = cx + Math.cos(angle) * rx;
      const ny = cy + Math.sin(angle) * ry;
      out.push(...dabsAlongSegment(px, py, nx, ny, sizePx, spacingFrac));
      px = nx; py = ny;
    }
    return out;
  }
  const engine = createStrokeEngine({ sizePx, spacingFrac });
  const out: Dab[] = [];
  engine.begin();
  for (let i = 0; i + 1 < points.length; i += 2) out.push(...engine.move(points[i]!, points[i + 1]!));
  engine.end();
  return out;
}
