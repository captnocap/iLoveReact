// world/vertexSnap.ts — vertex snapping for placed pieces (req_3378).
//
// Hold V while gizmo-dragging or Move-dragging a prop and its geometry snaps
// vertex-to-vertex onto nearby placed pieces: the dragged mesh's vertex nearest
// the CURSOR is the snap source (the Blender/Source convention — you point at
// the corner you mean), the nearest placed-piece vertex within the snap radius
// is the target, and the piece translates so the two coincide exactly.
//
// Pure math, no host doors: snap sets are the same authored vertices the picker
// and renderer already share (authoredMeshData), welded to unique positions and
// cached per pieceId; catalog (box) pieces snap by their 8 semantic corners.

import { authoredPieceFor } from './authoredRegistry';
import { authoredMeshData, authoredMeshRevision } from './authoredMesh';
import { pieceLook, pieceScaleOf, type PlacedPiece } from './pieces';

export type SnapVec = { x: number; y: number; z: number };
export type VertexSnapHit = {
  /** the dragged piece's snapping vertex, world space (marker anchor) */
  source: SnapVec;
  /** the placed vertex it locks onto, world space (marker target) */
  target: SnapVec;
  /** target − source: add to the dragged piece's transform to close the gap */
  dx: number;
  dy: number;
  dz: number;
};

/** How close (world metres) a target vertex must be to the source to lock. */
export const VERTEX_SNAP_RADIUS_M = 0.35;
// Welding quantum: coincident soup corners collapse to one snap vertex.
const WELD_QUANTUM = 1000; // 1mm
// A pathological soup cannot flood the per-tick search.
const MAX_SNAP_VERTICES = 4096;

// pieceId → local-frame xyz triples, valid for one authoredMesh revision.
let cacheRevision = -1;
const snapSetCache = new Map<string, Float32Array | null>();

/** The piece's local-frame snap vertices: welded authored mesh positions, or a
 *  catalog box's 8 corners. Null when neither geometry source resolves. */
export function snapVerticesFor(pieceId: string): Float32Array | null {
  if (cacheRevision !== authoredMeshRevision()) {
    snapSetCache.clear();
    cacheRevision = authoredMeshRevision();
  }
  const hit = snapSetCache.get(pieceId);
  if (hit !== undefined) return hit;
  let out: Float32Array | null = null;
  const authored = authoredPieceFor(pieceId);
  const data = authored ? authoredMeshData(authored.modelId, authored.pkgId) : null;
  if (data && data.length >= 8) {
    const seen = new Set<number>();
    const verts: number[] = [];
    for (let i = 0; i + 2 < data.length && verts.length / 3 < MAX_SNAP_VERTICES; i += 8) {
      const x = data[i]!;
      const y = data[i + 1]!;
      const z = data[i + 2]!;
      // One numeric weld key (21 bits/axis of 1mm cells) — no string churn.
      const key = (Math.round(x * WELD_QUANTUM) & 0x1fffff) * 4398046511104
        + (Math.round(y * WELD_QUANTUM) & 0x1fffff) * 2097152
        + (Math.round(z * WELD_QUANTUM) & 0x1fffff);
      if (seen.has(key)) continue;
      seen.add(key);
      verts.push(x, y, z);
    }
    out = verts.length >= 3 ? new Float32Array(verts) : null;
  } else {
    const look = pieceLook(pieceId);
    if (look) {
      const hw = look.w / 2;
      const hd = look.d / 2;
      out = new Float32Array([
        -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
        -hw, look.h, -hd, hw, look.h, -hd, hw, look.h, hd, -hw, look.h, hd,
      ]);
    }
  }
  snapSetCache.set(pieceId, out);
  return out;
}

/** The piece's snap vertices in WORLD space — the renderer's local→world frame
 *  (yaw about +Y, uniform scale about the anchor, then translate). */
export function worldSnapVertices(piece: PlacedPiece): Float32Array | null {
  const local = snapVerticesFor(piece.pieceId);
  if (!local) return null;
  const s = pieceScaleOf(piece);
  const a = (piece.yawDegrees * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const out = new Float32Array(local.length);
  for (let i = 0; i + 2 < local.length; i += 3) {
    const lx = local[i]! * s;
    const ly = local[i + 1]! * s;
    const lz = local[i + 2]! * s;
    out[i] = piece.x + lx * ca + lz * sa;
    out[i + 1] = piece.y + ly;
    out[i + 2] = piece.z - lx * sa + lz * ca;
  }
  return out;
}

function raySquaredDistance(vx: number, vy: number, vz: number, ray: { origin: SnapVec; dir: SnapVec }): number {
  const ox = vx - ray.origin.x;
  const oy = vy - ray.origin.y;
  const oz = vz - ray.origin.z;
  const dirSq = ray.dir.x * ray.dir.x + ray.dir.y * ray.dir.y + ray.dir.z * ray.dir.z;
  if (dirSq <= 0) return ox * ox + oy * oy + oz * oz;
  const t = Math.max(0, (ox * ray.dir.x + oy * ray.dir.y + oz * ray.dir.z) / dirSq);
  const px = ox - ray.dir.x * t;
  const py = oy - ray.dir.y * t;
  const pz = oz - ray.dir.z * t;
  return px * px + py * py + pz * pz;
}

/** The best vertex-to-vertex lock for a dragged piece at its CURRENT candidate
 *  transform: source = the dragged vertex nearest the cursor ray (anchor-nearest
 *  without one), target = the closest other-piece vertex within `radiusM`.
 *  Null = nothing in range; the drag stays free. */
export function findVertexSnap(
  dragged: PlacedPiece,
  ray: { origin: SnapVec; dir: SnapVec } | null,
  pieces: readonly PlacedPiece[],
  radiusM = VERTEX_SNAP_RADIUS_M,
): VertexSnapHit | null {
  const sourceVerts = worldSnapVertices(dragged);
  if (!sourceVerts || sourceVerts.length < 3) return null;
  let si = 0;
  let bestSource = Infinity;
  for (let i = 0; i + 2 < sourceVerts.length; i += 3) {
    const d = ray
      ? raySquaredDistance(sourceVerts[i]!, sourceVerts[i + 1]!, sourceVerts[i + 2]!, ray)
      : (sourceVerts[i]! - dragged.x) ** 2 + (sourceVerts[i + 1]! - dragged.y) ** 2 + (sourceVerts[i + 2]! - dragged.z) ** 2;
    if (d < bestSource) {
      bestSource = d;
      si = i;
    }
  }
  const sx = sourceVerts[si]!;
  const sy = sourceVerts[si + 1]!;
  const sz = sourceVerts[si + 2]!;
  let best: VertexSnapHit | null = null;
  let bestSq = radiusM * radiusM;
  for (const piece of pieces) {
    if (piece.id === dragged.id) continue;
    // Broadphase: the anchor must sit within the piece's own reach + radius.
    const look = pieceLook(piece.pieceId);
    const reach = (look ? Math.max(look.w, look.h, look.d) : 4) * pieceScaleOf(piece) + radiusM;
    const ax = piece.x - sx;
    const ay = piece.y - sy;
    const az = piece.z - sz;
    if (ax * ax + ay * ay + az * az > reach * reach) continue;
    const verts = worldSnapVertices(piece);
    if (!verts) continue;
    for (let i = 0; i + 2 < verts.length; i += 3) {
      const dx = verts[i]! - sx;
      const dy = verts[i + 1]! - sy;
      const dz = verts[i + 2]! - sz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestSq) {
        bestSq = d;
        best = {
          source: { x: sx, y: sy, z: sz },
          target: { x: verts[i]!, y: verts[i + 1]!, z: verts[i + 2]! },
          dx,
          dy,
          dz,
        };
      }
    }
  }
  return best;
}
