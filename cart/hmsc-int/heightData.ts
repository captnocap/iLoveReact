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

// Shared layout (1 tile = 1m). The dot grid samples at shared tile corners, so a
// W-tile span has W*DOTS_PER_TILE+1 columns.
export const TILE_UNITS = 24;       // canvas units per 1m tile (display scale)
export const DOTS_PER_TILE = 2;     // height samples per tile per axis
export const DOT_M = 1 / DOTS_PER_TILE; // meters between samples
export const VIS_REF = 6;           // |Z| that saturates the colormap
export const HEIGHT_LIMIT = 12;     // |Z| clamp (meters), headroom to stack

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
export type BrushShape = 'circle' | 'square' | 'diamond';

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

// Distance from the brush centre under the footprint's metric, in metres. Cells with
// distance <= radius are inside the footprint; that distance also drives the profile.
function footprintDistance(shape: BrushShape, dx: number, dy: number): number {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  switch (shape) {
    case 'square': return Math.max(ax, ay) * DOT_M;
    case 'diamond': return (ax + ay) * DOT_M;
    case 'circle':
    default: return Math.hypot(dx, dy) * DOT_M;
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
      const dm = footprintDistance(opts.shape, dx, dy);
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
