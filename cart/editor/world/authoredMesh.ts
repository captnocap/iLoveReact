// world/authoredMesh.ts — the geometry source for an authored build piece
// (req_2593/2598). A model is JUST a mesh; there is ONE resolver for its
// vertices (modelPackageMeshData), which handles every storage form — EditMesh
// parts, a content-addressed mesh blob, or a primitive — exactly as the viewer
// does. No "special" representation. This module just adds a small cache + the
// package lookup so the resident builder can resolve by (modelId, pkgId).
import { modelPackageMeshData } from '../data/hmscAssetCatalog';
import { modelPackageById } from '../data/content';

const CACHE = new Map<string, Float32Array>();

/** Stash a model's resolved vertices under its bare id (call at export). */
export function cacheAuthoredMesh(modelId: string, vertices: Float32Array): void {
  if (vertices.length >= 8) CACHE.set(modelId, vertices);
}

/** The vertices for an authored piece's model: the export-time capture, else the
 *  ONE package resolver (blob / parts / primitive) via the piece's package id.
 *  Null only when the geometry is host-only (a file-backed model). */
export function authoredMeshData(modelId: string, pkgId?: string): Float32Array | null {
  const cached = CACHE.get(modelId);
  if (cached && cached.length >= 8) return cached;
  const pkg = pkgId ? modelPackageById(pkgId) : null;
  const verts = pkg ? modelPackageMeshData(pkg) : null;
  if (verts && verts.length >= 8) { CACHE.set(modelId, verts); return verts; }
  return null;
}

export type MeshBounds = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };

const BOUNDS_CACHE = new Map<string, MeshBounds>();

/** The mesh-space AABB of an authored piece's model — the box its placements
 *  hit-test and outline with. Cached alongside the vertices. */
export function authoredMeshBounds(modelId: string, pkgId?: string): MeshBounds | null {
  const hit = BOUNDS_CACHE.get(modelId);
  if (hit) return hit;
  const v = authoredMeshData(modelId, pkgId);
  if (!v) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < v.length; i += 8) {
    const x = v[i]!, y = v[i + 1]!, z = v[i + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return null;
  const bounds = { minX, minY, minZ, maxX, maxY, maxZ };
  BOUNDS_CACHE.set(modelId, bounds);
  return bounds;
}
