// editors/characters/smoothKit.ts — the SMOOTH verb (MESHSMOOTH-0606): the
// user shapes, the machine rounds.
//
// MEASURED, not guessed (the user's own shaped torso, 2026-06-06): the
// faceted "low poly" ridges are ROUGHNESS-bound, not resolution-bound — the
// shaped torso's |cell − neighborhood avg| averaged 0.154 (201 cells over
// 0.3, single-cell spikes to 1.2) while parts that read smooth sit near
// 0.007 on the SAME 48×24 grid. Neighborhood relaxation attacks exactly that
// quantity. (Resolution stays a secondary ceiling: bilinear cell creases
// exist at extreme closeups, and ±1-saturated plateaus can't keep their full
// height while their edges round — see CAPTURE.md.)
//
// ONE TRUTH (the GRABSHAPE law): a smooth is just another edit of the same
// 48×24 signed grid the depth-paint and grab tools write — applied through
// the same setPartGrid/upload path, undoable, session-noted. This module is
// pure math; the surfaces (CharactersRoute, the workbench Stage) own state.
//
// Topology: the unwrap is an equirect of a closed Globe — x (longitude)
// WRAPS, y (pole to pole) CLAMPS. The kernel respects that, so smoothing
// never tears the seam a brush can freely paint across.

import { HED_GRID_H, HED_GRID_W } from '../../game/figure/hed';
import { REGION_TUNING } from './regions';

/** P2: every smoothing behavior number, named and knob-ranged. */
export const SMOOTH_TUNING = Object.freeze({
  /** whole-part action defaults */
  action: { strength: 0.5, iterations: 3 },
  /** one smooth-drag at full drag dose applies this many relax passes */
  drag: { iterations: 2 },
  /** knob specs (GAME_CHROME.Knob) for the surfaces */
  knobs: {
    strength: { min: 0.1, max: 1, step: 0.1, precision: 1 },
    iterations: { min: 1, max: 12, step: 1, precision: 0 },
  },
  /** a smooth-drag's dose: |grid-value drag delta| × this, clamped to 1 */
  dragDoseFactor: 0.9,
});

const W = HED_GRID_W;
const H = HED_GRID_H;

/** 3×3 neighborhood mean at (x, y) — x wraps (longitude), y clamps (poles). */
function neighborhoodMean(g: number[], x: number, y: number): number {
  let sum = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= H) continue;
    const row = yy * W;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      sum += g[row + ((x + dx + W) % W)];
      n += 1;
    }
  }
  return sum / n;
}

const clampCell = (v: number) =>
  Math.max(REGION_TUNING.clamp.min, Math.min(REGION_TUNING.clamp.max, v));

/**
 * Whole-grid relaxation: every cell moves toward its neighborhood mean by
 * `strength` (0..1), `iterations` times. A convex combination — the result
 * stays inside the input's [min, max], so a smooth can soften a silhouette's
 * surface without ever growing it (the P4 bounds law).
 */
export function relaxGrid(grid: number[], strength: number, iterations: number): number[] {
  let cur = grid;
  const s = Math.max(0, Math.min(1, strength));
  const passes = Math.max(1, Math.round(iterations));
  for (let pass = 0; pass < passes; pass++) {
    const next = new Array<number>(cur.length);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        next[i] = clampCell(cur[i] + s * (neighborhoodMean(cur, x, y) - cur[i]));
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * Local relaxation under the stamp ellipse (the SAME falloff² shape
 * stampGrid raises with, so the smooth brush feels like every other brush):
 * per-cell weight = strength × falloff², iterated. Mirror stamps the
 * meridian twin exactly like regions.ts does.
 */
export function relaxStamp(
  grid: number[], cx: number, cy: number, rx: number, ry: number,
  strength: number, iterations: number, mirror = false,
): number[] {
  let cur = grid;
  const s = Math.max(0, Math.min(1, strength));
  const passes = Math.max(1, Math.round(iterations));
  for (let pass = 0; pass < passes; pass++) {
    const next = cur.slice();
    for (let y = 0; y < H; y++) {
      const v = ((y + 0.5) / H - cy) / ry;
      for (let x = 0; x < W; x++) {
        const u = ((x + 0.5) / W - cx) / rx;
        const falloff = 1 - u * u - v * v;
        if (falloff <= 0) continue;
        const i = y * W + x;
        const w = s * falloff * falloff;
        next[i] = clampCell(cur[i] + w * (neighborhoodMean(cur, x, y) - cur[i]));
      }
    }
    cur = next;
  }
  if (mirror && Math.abs(cx - 0.5) > REGION_TUNING.mirrorMinOffset) {
    cur = relaxStamp(cur, 1 - cx, cy, rx, ry, strength, iterations, false);
  }
  return cur;
}

/** The measured facet quantity: mean/max |cell − neighborhood mean|. The
 *  status line shows it before → after, the P4 suite asserts it drops. */
export function gridRoughness(grid: number[]): { mean: number; max: number } {
  let sum = 0;
  let max = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.abs(grid[y * W + x] - neighborhoodMean(grid, x, y));
      sum += r;
      if (r > max) max = r;
    }
  }
  return { mean: sum / (W * H), max };
}
