// heightfield.ts — the heightfield DATA model, built for scale.
//
// A chunk's terrain is a flat Float32Array of cell heights (meters), edited in
// place. This is the whole point of the rebuild: the brush mutates the buffer in
// O(brush) and the renderer uploads it as ONE Effect storage buffer, so a stroke
// costs one GPU upload no matter how big the grid is. There are NO per-cell React
// nodes and NO per-cell state — the thing that would melt at real chunk sizes.
//
// Dimensions are data, so the same code runs the 8-tile demo patch and a full
// 120-tile chunk; placing chunks next to chunks is just more fields side by side.

import { footprintDistance, type BrushShape } from './brush';

// Shared layout (1 tile = 1m). The dot grid samples at shared tile corners, so a
// W-tile span has W*DOTS_PER_TILE+1 columns.
export const TILE_UNITS = 24;       // canvas units per 1m tile (display scale)
export const DOTS_PER_TILE = 2;     // height samples per tile per axis
export const DOT_M = 1 / DOTS_PER_TILE; // meters between samples
// |Z| clamp (metres) — the tallest a hill can rise / deepest a pit can sink. This is
// the SINGLE knob for terrain height range: the brush z stepper (Z_MIN/Z_MAX), the
// stamp clamp, the 2D colormap span (VIS_REF), and the saved-state clamp all derive
// from it. 64 m ≈ 32× a ~2 m player — real hills/small mountains in a 120 m chunk,
// not the old 12 m (~6×, barely a mound). Pure constant; raise/lower freely (the
// heightfield collider + host-gen mesh handle any height).
export const HEIGHT_LIMIT = 64;
// |Z| that saturates the 2D colormap. Span the FULL paint range so 6–12 m read as
// distinct colours instead of all-max-warm (the colormap is a multi-stop elevation
// ramp now — see heightField.wgsl.ts — so low ground still gets its own colour).
export const VIS_REF = HEIGHT_LIMIT;

export interface HeightField {
  cols: number;      // sample columns (x)
  rows: number;      // sample rows (y)
  tilesX: number;    // tiles spanned (x)
  tilesY: number;    // tiles spanned (y)
  z: Float32Array;   // cols*rows heights, row-major
}

export function makeHeightField(tilesX: number, tilesY: number): HeightField {
  const cols = tilesX * DOTS_PER_TILE + 1;
  const rows = tilesY * DOTS_PER_TILE + 1;
  return { cols, rows, tilesX, tilesY, z: new Float32Array(cols * rows) };
}

export function clearField(f: HeightField): void {
  f.z.fill(0);
}

// A height brush has TWO independent dials:
//   PROFILE — the cross-section across the footprint (how height falls from centre
//     to rim). t = distance/radius (0 centre … 1 rim):
//       cone — peak·(1−t): linear slope, fans out to nothing at the rim.
//       flat — peak everywhere: vertical-walled plateau/mesa, edge is a cliff.
//       dome — peak·√(1−t²): hemispherical cap, rounded on top.
//   SHAPE — the FOOTPRINT outline (which cells the brush covers), set by the distance
//     metric used for `t`:
//       circle  — Euclidean  (√(dx²+dy²)).
//       square  — Chebyshev  (max(|dx|,|dy|)).
//       diamond — Manhattan  (|dx|+|dy|).
//   So flat+square = a square plateau, cone+diamond = a diamond pyramid, etc.
export type BrushProfile = 'cone' | 'flat' | 'dome';
export type { BrushShape };

export interface StampOpts {
  centerZ: number;      // peak height at the brush center (signed)
  radiusM: number;      // brush radius in metres (where the footprint reaches its edge)
  shape: BrushShape;    // footprint outline
  profile: BrushProfile; // cross-section across the footprint
  erase?: boolean;      // pull cells in range to 0 instead of stamping
}

// Profile value at normalized distance t (0..1) for a unit peak.
function brushProfile(profile: BrushProfile, t: number): number {
  switch (profile) {
    case 'flat': return 1;
    case 'dome': return Math.sqrt(Math.max(0, 1 - t * t));
    case 'cone':
    default: return 1 - t;
  }
}

// Stamp a brush centered on cell (cix,ciy): each cell inside the footprint is RAISED
// TOWARD the profile (peak |centerZ| at the center, falling to the rim), not summed.
// "Raise toward" = signed max, so the brush sculpts a cap at centerZ instead of piling
// up — overlapping stamps form the UNION (a smooth ridge), and the painted height
// equals the intensity you set. Summing made every drag saturate to the clamp (a flat
// max-height mesa); a ceiling can't. Erase zeros the cells in the footprint.
// O(radius^2), independent of total grid size.
export function stampBrush(f: HeightField, cix: number, ciy: number, opts: StampOpts): void {
  const radiusM = Math.max(DOT_M, opts.radiusM);
  const rd = Math.max(1, Math.ceil(radiusM / DOT_M));
  const sign = opts.centerZ >= 0 ? 1 : -1;
  const peak = Math.abs(opts.centerZ);
  for (let dy = -rd; dy <= rd; dy++) {
    const jy = ciy + dy;
    if (jy < 0 || jy >= f.rows) continue;
    for (let dx = -rd; dx <= rd; dx++) {
      const jx = cix + dx;
      if (jx < 0 || jx >= f.cols) continue;
      const dm = footprintDistance(opts.shape, dx, dy) * DOT_M;
      if (dm > radiusM) continue;
      const idx = jy * f.cols + jx;
      if (opts.erase) { f.z[idx] = 0; continue; }
      const mag = peak * brushProfile(opts.profile, dm / radiusM);
      if (mag <= 0) continue;
      // Raise toward the signed target: take whichever value is farther from 0 in the
      // brush's direction, so re-stamping or overlapping never climbs past centerZ.
      const target = sign * Math.min(mag, HEIGHT_LIMIT);
      f.z[idx] = sign > 0 ? Math.max(f.z[idx], target) : Math.min(f.z[idx], target);
    }
  }
}

export interface RampStampOpts {
  minZ: number;
  maxZ: number;
  wideM: number;
  longM: number;
  angleDeg: number;
}

function clampHeight(z: number): number {
  return Math.max(-HEIGHT_LIMIT, Math.min(HEIGHT_LIMIT, z));
}

// Stamp a sloped rectangular plane centered on sample (cix,ciy). Fractional centers
// are intentional: ramp drags are graph-space lines, and rounding the center per
// chunk makes shallow/diagonal ramps wobble against the sample lattice. The ramp is SET,
// not raised-toward: every covered sample becomes the lerped height from min→max
// along the slope axis, constant across width.
export function stampRamp(f: HeightField, cix: number, ciy: number, opts: RampStampOpts): void {
  const wideM = Math.max(DOT_M, opts.wideM);
  const longM = Math.max(DOT_M, opts.longM);
  const hw = wideM / 2;
  const hl = longM / 2;
  const theta = opts.angleDeg * Math.PI / 180;
  const sx = Math.sin(theta), sy = Math.cos(theta);
  const px = Math.cos(theta), py = -Math.sin(theta);
  const rd = Math.ceil(Math.hypot(hw, hl) / DOT_M) + 1;
  const z0 = clampHeight(opts.minZ);
  const z1 = clampHeight(opts.maxZ);
  const minX = Math.max(0, Math.floor(cix - rd));
  const maxX = Math.min(f.cols - 1, Math.ceil(cix + rd));
  const minY = Math.max(0, Math.floor(ciy - rd));
  const maxY = Math.min(f.rows - 1, Math.ceil(ciy + rd));

  for (let jy = minY; jy <= maxY; jy++) {
    for (let jx = minX; jx <= maxX; jx++) {
      const mx = (jx - cix) * DOT_M, my = (jy - ciy) * DOT_M;
      const along = mx * sx + my * sy;
      const across = mx * px + my * py;
      if (Math.abs(along) > hl || Math.abs(across) > hw) continue;
      const t = longM <= 0 ? 0 : (along + hl) / longM;
      f.z[jy * f.cols + jx] = clampHeight(z0 + (z1 - z0) * Math.max(0, Math.min(1, t)));
    }
  }
}

// Encode for the Effect storage buffer: header [cols, rows, visRef, tilesX,
// tilesY] then the row-major heights. Matches HEIGHT_FIELD_WGSL's D[] layout.
export function encodeField(f: HeightField): Float32Array {
  const out = new Float32Array(5 + f.z.length);
  out[0] = f.cols;
  out[1] = f.rows;
  out[2] = VIS_REF;
  out[3] = f.tilesX;
  out[4] = f.tilesY;
  out.set(f.z, 5);
  return out;
}
