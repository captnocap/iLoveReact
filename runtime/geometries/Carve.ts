// Carve — a 3D piece carved from a flat mask grid (the cutout-inflate / "Teddy"
// technique: Igarashi '99, also how paper-doll game characters are made).
//
// Input is a cols×rows occupancy mask (image alpha, a SAM cutout, or a
// hand-painted grid). The silhouette becomes the piece's outline; thickness
// swells with chamfer distance from the silhouette edge:
//
//   inflate = 0   → flat extruded slab (cookie-cutter), depth thick, hard sides
//   inflate = 1   → fully rounded: thickness 0 at the edge, sqrt profile to
//                   `depth` at the innermost point (a puffy cushion), no sides
//   in between    → rounded slab
//
// UVs on the front (-Z) and back faces map the full 0..1 texture across the
// grid — drop the source image in via `textureKey` and the photo paints itself
// onto the carved piece. `u` is flipped so the image reads UNMIRRORED from the
// front (same convention as Head.ts; -Z is the way figures face). Side walls
// pin their UV to the silhouette cell so they extrude that pixel's color.
//
// Mesh cost ≈ 2 quads per solid cell + boundary walls: a 48×48 mask is ~10–25k
// vertices. Use 32–64 grids for game pieces; this is a carved prop register,
// not a sculpting subdivision surface.
import { mesh, normalize, type GeometryData, type Vec2, type Vec3 } from './_util';

export type CarveParams = {
  /** Row-major cols×rows occupancy: >0.5 = solid, else carved away. Row 0 is the TOP. */
  mask: number[];
  cols: number;
  rows: number;
  /** World size of the full grid (the mask's bounding rectangle), centered on origin. */
  width: number;
  height: number;
  /** Max thickness (z extent) at the piece's innermost point. */
  depth: number;
  /** 0 = flat slab … 1 = fully rounded to a knife edge at the silhouette. */
  inflate: number;
};

export const CARVE_DEFAULTS: CarveParams = {
  mask: [1], cols: 1, rows: 1,
  width: 1, height: 1, depth: 0.25, inflate: 0.6,
};

export function generate(p: CarveParams): GeometryData {
  const { cols, rows, width, height, depth, inflate } = p;
  const g = mesh();
  const cellW = width / cols;
  const cellH = height / rows;
  const INF = 1e9;

  const solid = (cx: number, cy: number): boolean =>
    cx >= 0 && cy >= 0 && cx < cols && cy < rows && p.mask[cy * cols + cx] > 0.5;

  // ── chamfer distance transform over cells (units: cells from the edge) ────
  // Empty and out-of-bounds count as distance 0, so a shape touching the grid
  // border tapers there too (keeps the mesh closed at any inflate).
  const dist = new Float64Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) dist[i] = p.mask[i] > 0.5 ? INF : 0;
  const dAt = (cx: number, cy: number): number =>
    cx < 0 || cy < 0 || cx >= cols || cy >= rows ? 0 : dist[cy * cols + cx];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const i = cy * cols + cx;
      if (dist[i] === 0) continue;
      dist[i] = Math.min(dist[i], dAt(cx - 1, cy) + 1, dAt(cx, cy - 1) + 1, dAt(cx - 1, cy - 1) + 1.4, dAt(cx + 1, cy - 1) + 1.4);
    }
  }
  for (let cy = rows - 1; cy >= 0; cy--) {
    for (let cx = cols - 1; cx >= 0; cx--) {
      const i = cy * cols + cx;
      dist[i] = Math.min(dist[i], dAt(cx + 1, cy) + 1, dAt(cx, cy + 1) + 1, dAt(cx + 1, cy + 1) + 1.4, dAt(cx - 1, cy + 1) + 1.4);
    }
  }
  let dmax = 1;
  for (let i = 0; i < cols * rows; i++) {
    if (dist[i] < INF && dist[i] > dmax) dmax = dist[i];
  }

  // ── per-corner half-thickness (corner grid is (cols+1)×(rows+1)) ──────────
  // A corner's inward distance is the min over its ≤4 touching cells, so
  // silhouette corners sit at d=0 → thickness (1-inflate)·depth/2 there.
  const cw = cols + 1;
  const half = new Float64Array(cw * (rows + 1));
  for (let cy = 0; cy <= rows; cy++) {
    for (let cx = 0; cx <= cols; cx++) {
      const d = Math.min(dAt(cx - 1, cy - 1), dAt(cx, cy - 1), dAt(cx - 1, cy), dAt(cx, cy));
      const rounded = Math.sqrt(Math.min(d, dmax) / dmax);
      half[cy * cw + cx] = 0.5 * depth * ((1 - inflate) + inflate * rounded);
    }
  }
  const hAt = (cx: number, cy: number): number => half[cy * cw + cx];

  // ── per-corner smooth normals for the inflated surfaces ───────────────────
  // h is a heightfield; front surface z=-h has outward normal ∝ (-∂h/∂x, -∂h/∂y, -1),
  // back z=+h the same with +1. Central differences, one-sided at grid edges.
  const lateral = (cx: number, cy: number): [number, number] => {
    const x0 = Math.max(0, cx - 1), x1 = Math.min(cols, cx + 1);
    const y0 = Math.max(0, cy - 1), y1 = Math.min(rows, cy + 1);
    const dhdx = (hAt(x1, cy) - hAt(x0, cy)) / ((x1 - x0) * cellW);
    // +cy runs DOWN in world y, so the world-space partial flips sign
    const dhdy = (hAt(cx, y1) - hAt(cx, y0)) / ((y1 - y0) * -cellH);
    return [-dhdx, -dhdy];
  };
  const frontN = (cx: number, cy: number): Vec3 => {
    const [lx, ly] = lateral(cx, cy);
    return normalize(lx, ly, -1);
  };
  const backN = (cx: number, cy: number): Vec3 => {
    const [lx, ly] = lateral(cx, cy);
    return normalize(lx, ly, 1);
  };

  // ── world / uv mapping ─────────────────────────────────────────────────────
  const X = (cx: number): number => -width / 2 + cx * cellW;
  const Y = (cy: number): number => height / 2 - cy * cellH;
  const U = (cx: number): number => 1 - cx / cols; // flipped: unmirrored from the front
  const V = (cy: number): number => cy / rows;
  const uv = (cx: number, cy: number): Vec2 => [U(cx), V(cy)];

  const EPS = 1e-5;

  // ── emit ───────────────────────────────────────────────────────────────────
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!solid(cx, cy)) continue;
      const x0 = X(cx), x1 = X(cx + 1);
      const yt = Y(cy), yb = Y(cy + 1);
      const h00 = hAt(cx, cy), h10 = hAt(cx + 1, cy);
      const h01 = hAt(cx, cy + 1), h11 = hAt(cx + 1, cy + 1);

      // front (-Z): corner order matches Box's back face — CCW from outside
      g.tri(
        [x1, yb, -h11], frontN(cx + 1, cy + 1), uv(cx + 1, cy + 1),
        [x0, yb, -h01], frontN(cx, cy + 1), uv(cx, cy + 1),
        [x0, yt, -h00], frontN(cx, cy), uv(cx, cy),
      );
      g.tri(
        [x1, yb, -h11], frontN(cx + 1, cy + 1), uv(cx + 1, cy + 1),
        [x0, yt, -h00], frontN(cx, cy), uv(cx, cy),
        [x1, yt, -h10], frontN(cx + 1, cy), uv(cx + 1, cy),
      );
      // back (+Z): corner order matches Box's front face; same UVs (coin-style)
      g.tri(
        [x0, yb, h01], backN(cx, cy + 1), uv(cx, cy + 1),
        [x1, yb, h11], backN(cx + 1, cy + 1), uv(cx + 1, cy + 1),
        [x1, yt, h10], backN(cx + 1, cy), uv(cx + 1, cy),
      );
      g.tri(
        [x0, yb, h01], backN(cx, cy + 1), uv(cx, cy + 1),
        [x1, yt, h10], backN(cx + 1, cy), uv(cx + 1, cy),
        [x0, yt, h00], backN(cx, cy), uv(cx, cy),
      );

      // boundary side walls — flat axis-aligned normals (the carved-edge look),
      // UV pinned to this cell so the wall extrudes the silhouette pixel color.
      const pin: Vec2 = [1 - (cx + 0.5) / cols, (cy + 0.5) / rows];
      if (!solid(cx + 1, cy) && h10 + h11 > EPS) {
        g.face([x1, yb, h11], [x1, yb, -h11], [x1, yt, -h10], [x1, yt, h10], [1, 0, 0], pin);
      }
      if (!solid(cx - 1, cy) && h00 + h01 > EPS) {
        g.face([x0, yb, -h01], [x0, yb, h01], [x0, yt, h00], [x0, yt, -h00], [-1, 0, 0], pin);
      }
      if (!solid(cx, cy - 1) && h00 + h10 > EPS) {
        g.face([x0, yt, h00], [x1, yt, h10], [x1, yt, -h10], [x0, yt, -h00], [0, 1, 0], pin);
      }
      if (!solid(cx, cy + 1) && h01 + h11 > EPS) {
        g.face([x0, yb, -h01], [x1, yb, -h11], [x1, yb, h11], [x0, yb, h01], [0, -1, 0], pin);
      }
    }
  }

  return g.build();
}
