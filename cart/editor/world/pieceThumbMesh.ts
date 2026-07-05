// world/pieceThumbMesh.ts — CATALOG build pieces triangulated for the build
// palette's product-shot thumbnails (req_2651, req_2621 gap Y).
//
// The palette used to show a flat colour chip per piece — useless once walls
// and floors number in the hundreds. Authored (model:) pieces already have real
// vertices to photograph; a catalog piece's truth is its pieceShapes
// DECOMPOSITION (the same boxes/ramps the live overlay draws: window jamb/sill/
// header + glass pane, door leaf, roof slopes). This module triangulates that
// decomposition into interleaved [px,py,pz, nx,ny,nz, u,v] meshes — grouped by
// colour, since a Scene3D.Mesh carries ONE material — so modelThumb's
// buildPartsThumbView can frame the identical product-shot camera on it.
//
// Winding is CCW-from-outside (the 3d.zig mesh pipeline culls back faces,
// front_face = .ccw). UVs stay 0 — thumbs sample the 1×1 white default and the
// shader collapses to lit flat colour.
import { catalogRowFor, rowHex } from './buildCatalog';
import { pieceVisualShapes, type VisualBox, type VisualRamp } from './pieceShapes';
import type { PlacedPiece } from './pieces';

export type PieceThumbPart = { key: string; vertices: Float32Array; count: number; color: string; opacity?: number };

const DEG = Math.PI / 180;

/** Triangulated colour-grouped thumbnail parts for a catalog piece, posed at
 *  the origin with yaw 0 (the product shot supplies the 3/4 view). Empty for
 *  ids outside the catalog (authored pieces photograph their own mesh). */
export function catalogPieceThumbParts(pieceId: string): PieceThumbPart[] {
  const row = catalogRowFor(pieceId);
  if (!row) return [];
  const pose: PlacedPiece = { id: 'thumb', pieceId, x: 0, y: 0, z: 0, yawDegrees: 0 };
  const shapes = pieceVisualShapes(pose, rowHex(row));
  // One part per (colour, opacity) — the base material, the glass pane, the
  // door leaf each become their own mesh under the shared framing camera.
  const groups = new Map<string, { color: string; opacity?: number; floats: number[] }>();
  for (const shape of shapes) {
    const color = shape.kind === 'box' ? shape.box.color : shape.ramp.color;
    const opacity = shape.kind === 'box' ? shape.box.opacity : shape.ramp.opacity;
    const groupKey = `${color}~${opacity ?? 1}`;
    let group = groups.get(groupKey);
    if (!group) { group = { color, opacity, floats: [] }; groups.set(groupKey, group); }
    if (shape.kind === 'box') emitBox(group.floats, shape.box);
    else emitWedge(group.floats, shape.ramp);
  }
  const opaqueOf = (g: { opacity?: number }) => g.opacity ?? 1;
  return [...groups.values()]
    // Opaque parts first so the transparent pane sorts over the wall behind it.
    .sort((a, b) => opaqueOf(b) - opaqueOf(a))
    .map((g, i) => ({
      key: `${pieceId}~${i}`,
      vertices: new Float32Array(g.floats),
      count: g.floats.length / 8,
      color: g.color,
      opacity: g.opacity,
    }));
}

// ── triangle emitters ───────────────────────────────────────────────────────

/** Rotate a local (x, z) pair by yawDegrees — the pieceShapes localOffset frame
 *  (local +v turns toward world +x at yaw 90), applied to positions AND normals. */
function yawRotate(x: number, z: number, yawDegrees: number): { x: number; z: number } {
  if (yawDegrees === 0) return { x, z };
  const cos = Math.cos(yawDegrees * DEG);
  const sin = Math.sin(yawDegrees * DEG);
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}

type Vec3 = [number, number, number];

/** One vertex: position rotated about (originX, originZ) by yaw, then emitted
 *  with the yaw-rotated normal. 8 floats, UV 0. */
function vert(out: number[], p: Vec3, n: Vec3, originX: number, originZ: number, yawDegrees: number): void {
  const rp = yawRotate(p[0] - originX, p[2] - originZ, yawDegrees);
  const rn = yawRotate(n[0], n[2], yawDegrees);
  out.push(originX + rp.x, p[1], originZ + rp.z, rn.x, n[1], rn.z, 0, 0);
}

function tri(out: number[], a: Vec3, b: Vec3, c: Vec3, n: Vec3, ox: number, oz: number, yaw: number): void {
  vert(out, a, n, ox, oz, yaw);
  vert(out, b, n, ox, oz, yaw);
  vert(out, c, n, ox, oz, yaw);
}

/** Quad (a,b,c,d) given CCW viewed from the normal side → two triangles. */
function quad(out: number[], a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, ox: number, oz: number, yaw: number): void {
  tri(out, a, b, c, n, ox, oz, yaw);
  tri(out, a, c, d, n, ox, oz, yaw);
}

/** A face of an axis-aligned box: centre + two half-extent tangents chosen so
 *  u × v = n, giving CCW winding from outside for corners c−u−v, c+u−v, c+u+v, c−u+v. */
function face(out: number[], c: Vec3, u: Vec3, v: Vec3, n: Vec3, ox: number, oz: number, yaw: number): void {
  const p = (su: number, sv: number): Vec3 => [c[0] + su * u[0] + sv * v[0], c[1] + su * u[1] + sv * v[1], c[2] + su * u[2] + sv * v[2]];
  quad(out, p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), n, ox, oz, yaw);
}

/** VisualBox → 12 triangles (6 faces), rotated about its own centre by its yaw. */
function emitBox(out: number[], b: VisualBox): void {
  const hx = b.sx / 2, hy = b.sy / 2, hz = b.sz / 2;
  const c: Vec3 = [b.cx, b.cy, b.cz];
  const yaw = b.yawDegrees;
  face(out, [c[0] + hx, c[1], c[2]], [0, hy, 0], [0, 0, hz], [1, 0, 0], b.cx, b.cz, yaw);   // +x
  face(out, [c[0] - hx, c[1], c[2]], [0, 0, hz], [0, hy, 0], [-1, 0, 0], b.cx, b.cz, yaw);  // -x
  face(out, [c[0], c[1] + hy, c[2]], [0, 0, hz], [hx, 0, 0], [0, 1, 0], b.cx, b.cz, yaw);   // +y
  face(out, [c[0], c[1] - hy, c[2]], [hx, 0, 0], [0, 0, hz], [0, -1, 0], b.cx, b.cz, yaw);  // -y
  face(out, [c[0], c[1], c[2] + hz], [hx, 0, 0], [0, hy, 0], [0, 0, 1], b.cx, b.cz, yaw);   // +z
  face(out, [c[0], c[1], c[2] - hz], [0, hy, 0], [hx, 0, 0], [0, 0, -1], b.cx, b.cz, yaw);  // -z
}

/** VisualRamp → a solid wedge rising toward local +z (matches the gable pair in
 *  pieceShapes: slopeB flips 180° so both slopes meet at the ridge). x/z is the
 *  footprint centre, y the base. */
function emitWedge(out: number[], r: VisualRamp): void {
  const hw = r.width / 2, hd = r.depth / 2;
  const h = Math.max(r.height, r.slabThickness);
  const y0 = r.y, y1 = r.y + h;
  const ox = r.x, oz = r.z, yaw = r.yawDegrees;
  const A: Vec3 = [ox - hw, y0, oz - hd]; // low front left
  const B: Vec3 = [ox + hw, y0, oz - hd]; // low front right
  const C: Vec3 = [ox + hw, y0, oz + hd]; // low back right
  const D: Vec3 = [ox - hw, y0, oz + hd]; // low back left
  const E: Vec3 = [ox + hw, y1, oz + hd]; // top back right
  const F: Vec3 = [ox - hw, y1, oz + hd]; // top back left
  const slopeLen = Math.hypot(r.depth, h);
  const nSlope: Vec3 = [0, r.depth / slopeLen, -h / slopeLen];
  quad(out, A, F, E, B, nSlope, ox, oz, yaw);            // slope (front-bottom → back-top)
  quad(out, C, E, F, D, [0, 0, 1], ox, oz, yaw);         // back wall
  quad(out, A, B, C, D, [0, -1, 0], ox, oz, yaw);        // bottom
  tri(out, B, E, C, [1, 0, 0], ox, oz, yaw);             // right side
  tri(out, A, D, F, [-1, 0, 0], ox, oz, yaw);            // left side
}
