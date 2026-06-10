// roadGrade.ts — GRADE MODE, the first elevation slice (ROADGRADE-0610).
//
// The unified painter rule (project_road_grammar): a stroke at terrain level
// GRADES the ground — the road's earthworks. The pass writes the painted
// heightfield under each stroke's band so the road sits on a smooth bed:
//
//   • LONGITUDINAL profile — the centerline samples the CURRENT terrain at
//     1-tile steps, then a moving-average window (~12 tiles) irons out bumps:
//     the road climbs the hill, it just stops riding every pothole.
//   • ZERO crossfall — across the band every sample takes the centerline's
//     profile height (a flat bed curb to curb, like the stamp).
//   • FEATHER — beyond the stamped half-width the bed blends back into the
//     untouched terrain over ~3 tiles (smoothstep), so cuts and fills read
//     as shoulders instead of cliffs.
//
// Pure CPU over the editor's HeightField buffers (DOTS_PER_TILE samples); the
// caller (PaintCanvas restampRoads) owns dirty-marking and the region sync.
// Idempotent in practice: once graded, resampling the profile reads the bed
// itself. Deleting a road leaves its earthworks (real roads do too); Ctrl+Z
// restores the pre-stamp heights through the map snapshot like any edit.
// P4: roadGrade.test.ts.

import { clampProfile, filletPoints, ROAD_FILLET_TILES, roadWidthTiles, type RoadPoint, type RoadStroke } from './roadData';
import { DOTS_PER_TILE, type HeightField } from './heightData';

export const GRADE_TUNING = {
  /** longitudinal profile sample spacing (tiles) */
  sampleStepTiles: 1,
  /** moving-average window over the profile (tiles, total span) */
  smoothWindowTiles: 12,
  /** blend band beyond the stamped half-width (tiles) */
  featherTiles: 3,
} as const;

export type GradeProfile = {
  /** the filleted centerline (the geometry the stamp + ribbon share) */
  pts: RoadPoint[];
  /** cumulative arc length per vertex (tiles ≡ meters) */
  cum: number[];
  /** smoothed target height per sample (sampleStepTiles apart along cum) */
  h: number[];
  halfWidthTiles: number;
};

/** Sample + smooth one stroke's longitudinal terrain profile. `readHeight`
 *  answers in WORLD meters (cross-chunk); null samples hold the last seen
 *  height (an off-map stretch keeps the road level instead of diving to 0). */
export function strokeGradeProfile(
  stroke: RoadStroke,
  readHeight: (x: number, z: number) => number | null,
): GradeProfile | null {
  if (stroke.points.length < 2) return null;
  const pts = filletPoints(stroke.points, ROAD_FILLET_TILES);
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(pts[i]!.gx - pts[i - 1]!.gx, pts[i]!.gz - pts[i - 1]!.gz));
  }
  const total = cum[cum.length - 1]!;
  if (total <= 0) return null;
  const step = GRADE_TUNING.sampleStepTiles;
  const n = Math.max(2, Math.ceil(total / step) + 1);
  const raw = new Array<number>(n);
  let seg = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(total, i * step);
    while (seg + 1 < cum.length - 1 && cum[seg + 1]! < s) seg++;
    const span = cum[seg + 1]! - cum[seg]!;
    const t = span > 0 ? (s - cum[seg]!) / span : 0;
    const x = pts[seg]!.gx + (pts[seg + 1]!.gx - pts[seg]!.gx) * t;
    const z = pts[seg]!.gz + (pts[seg + 1]!.gz - pts[seg]!.gz) * t;
    const v = readHeight(x, z);
    if (v !== null) last = v;
    raw[i] = last;
  }
  // moving average — the window in samples, centred
  const half = Math.max(1, Math.round(GRADE_TUNING.smoothWindowTiles / step / 2));
  const h = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) {
      sum += raw[k]!;
      count++;
    }
    h[i] = sum / count;
  }
  return { pts, cum, h, halfWidthTiles: roadWidthTiles(clampProfile(stroke.profile)) / 2 };
}

function profileHeightAt(p: GradeProfile, s: number): number {
  const step = GRADE_TUNING.sampleStepTiles;
  const i = Math.max(0, Math.min(p.h.length - 1, s / step));
  const lo = Math.floor(i);
  const hi = Math.min(p.h.length - 1, lo + 1);
  return p.h[lo]! + (p.h[hi]! - p.h[lo]!) * (i - lo);
}

const smoothstep = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/**
 * Write one chunk's height samples toward the graded bed. Sample (jx, jz)
 * sits at world (chunkCx·chunkTiles + jx/DOTS_PER_TILE, …). Returns true when
 * any sample moved (the caller's dirty signal).
 */
export function gradeHeightField(opts: {
  profiles: readonly GradeProfile[];
  field: HeightField;
  chunkCx: number;
  chunkCz: number;
  chunkTiles: number;
}): boolean {
  const { field } = opts;
  const originX = opts.chunkCx * opts.chunkTiles;
  const originZ = opts.chunkCz * opts.chunkTiles;
  const feather = GRADE_TUNING.featherTiles;
  let changed = false;
  for (const p of opts.profiles) {
    const reach = p.halfWidthTiles + feather;
    // chunk-local sample bbox of the whole stroke, clipped
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const pt of p.pts) {
      minX = Math.min(minX, pt.gx); maxX = Math.max(maxX, pt.gx);
      minZ = Math.min(minZ, pt.gz); maxZ = Math.max(maxZ, pt.gz);
    }
    const jx0 = Math.max(0, Math.floor((minX - reach - originX) * DOTS_PER_TILE));
    const jx1 = Math.min(field.cols - 1, Math.ceil((maxX + reach - originX) * DOTS_PER_TILE));
    const jz0 = Math.max(0, Math.floor((minZ - reach - originZ) * DOTS_PER_TILE));
    const jz1 = Math.min(field.rows - 1, Math.ceil((maxZ + reach - originZ) * DOTS_PER_TILE));
    if (jx0 > jx1 || jz0 > jz1) continue;
    for (let jz = jz0; jz <= jz1; jz++) {
      const wz = originZ + jz / DOTS_PER_TILE;
      for (let jx = jx0; jx <= jx1; jx++) {
        const wx = originX + jx / DOTS_PER_TILE;
        // nearest point on the filleted centerline
        let bestD = Infinity;
        let bestS = 0;
        for (let i = 0; i + 1 < p.pts.length; i++) {
          const a = p.pts[i]!, b = p.pts[i + 1]!;
          const abx = b.gx - a.gx, abz = b.gz - a.gz;
          const len2 = abx * abx + abz * abz;
          const t = len2 ? Math.max(0, Math.min(1, ((wx - a.gx) * abx + (wz - a.gz) * abz) / len2)) : 0;
          const dx = wx - (a.gx + abx * t);
          const dz = wz - (a.gz + abz * t);
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            bestS = p.cum[i]! + Math.sqrt(len2) * t;
          }
        }
        const d = Math.sqrt(bestD);
        if (d > reach) continue;
        // 1 inside the bed, smooth-fading to 0 across the feather
        const w = d <= p.halfWidthTiles ? 1 : 1 - smoothstep((d - p.halfWidthTiles) / feather);
        if (w <= 0) continue;
        const idx = jz * field.cols + jx;
        const target = profileHeightAt(p, bestS);
        const next = field.z[idx]! * (1 - w) + target * w;
        if (Math.abs(next - field.z[idx]!) > 1e-5) {
          field.z[idx] = next;
          changed = true;
        }
      }
    }
  }
  return changed;
}
