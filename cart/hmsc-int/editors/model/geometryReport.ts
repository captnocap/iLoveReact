// editors/model/geometryReport.ts — the dashboard's geometry census (req_1874).
//
// One function, reportAssetGeometry(), walks the two AUTHORED content stores —
// cooked assets (cookedAssetStream) and Studio models (modelStream) — and sums the
// triangles / vertices / edges across everything the user has built. This is the
// "glad you opened it" headline number on the new / dashboard (see
// DASHBOARD_PLAYBOOK.md, Thread 1).
//
// FREEZE LAW (req_1872): this only walks in-memory stream state and reads typed-
// array lengths + face loops — no tessellation, no GPU upload, no paint-blob
// decode. Cheap enough to run synchronously, but the dashboard still calls it off
// the first paint (an effect) so even a huge library can never stall the window.
//
// Two geometry encodings, one census:
//   • Cooked MeshBlob — a flat triangle SOUP, 8 floats/vertex (pos3 + normal3 +
//     uv2). So vertices = floats / 8, triangles = vertices / 3, and — a soup
//     shares no verts between triangles — edges = triangles * 3.
//   • Studio EditMesh — shared verts[] + n-gon faces[]. vertices = verts.length;
//     an L-gon face fans to (L - 2) triangles; edges are the DISTINCT undirected
//     vertex pairs across every face loop (meshEdges already derives them).

import { editorChannel } from '../store';
import { cookedAssetStream, installedAssets, meshBlobFor } from './cookedAssetStream';
import { modelStream, libraryModels } from './modelStream';
import { meshEdges, type EditMesh } from './editMesh';

/** Triangles / vertices / edges summed over a set of meshes, with the mesh count. */
export type GeometryTotals = {
  /** how many meshes were summed (cooked assets / model parts). */
  meshes: number;
  vertices: number;
  triangles: number;
  edges: number;
};

/** The full census the dashboard reads. `total` = cooked + studio. */
export type GeometryReport = {
  /** cooked assets, summed PER ASSET — a shared mesh is counted once per asset
   *  that references it (the "across all your assets" feel the dashboard wants). */
  cooked: GeometryTotals;
  /** Studio library models, summed per PART. */
  studio: GeometryTotals;
  /** cooked + studio — the headline grand total. */
  total: GeometryTotals;
  /** roster sizes (assets / models), independent of geometry. */
  cookedAssetCount: number;
  studioModelCount: number;
  /** distinct cooked mesh blobs (content-addressed) — the honest "how much UNIQUE
   *  geometry was modeled", vs. the instanced per-asset `cooked` totals above. */
  uniqueCookedMeshes: number;
};

const ZERO: GeometryTotals = { meshes: 0, vertices: 0, triangles: 0, edges: 0 };

function add(a: GeometryTotals, b: GeometryTotals): GeometryTotals {
  return {
    meshes: a.meshes + b.meshes,
    vertices: a.vertices + b.vertices,
    triangles: a.triangles + b.triangles,
    edges: a.edges + b.edges,
  };
}

/** Census of one cooked MeshBlob (a triangle soup of 8-float vertices). */
export function meshBlobTotals(verts: Float32Array): GeometryTotals {
  const vertices = Math.floor(verts.length / 8);
  const triangles = Math.floor(vertices / 3);
  return { meshes: 1, vertices, triangles, edges: triangles * 3 };
}

/** Census of one Studio part's editable mesh (shared verts + n-gon faces). */
export function editMeshTotals(mesh: EditMesh): GeometryTotals {
  let triangles = 0;
  for (const f of mesh.faces) if (f.loop.length >= 3) triangles += f.loop.length - 2;
  return { meshes: 1, vertices: mesh.verts.length, triangles, edges: meshEdges(mesh).length };
}

/**
 * Sum triangles / vertices / edges across every cooked asset and Studio model.
 * Pure read over the two content stores — safe headless (a missing __fs_* host
 * just yields zeros for that store instead of throwing).
 */
export function reportAssetGeometry(): GeometryReport {
  let cooked = ZERO;
  let studio = ZERO;
  let cookedAssetCount = 0;
  let studioModelCount = 0;
  const uniqueMeshes = new Set<string>();

  try {
    const cs = editorChannel(cookedAssetStream).state();
    const assets = installedAssets(cs);
    cookedAssetCount = assets.length;
    for (const asset of assets) {
      uniqueMeshes.add(asset.meshRef);
      const verts = meshBlobFor(cs, asset.meshRef);
      if (verts) cooked = add(cooked, meshBlobTotals(verts));
    }
  } catch { /* no __fs_* host (headless) — report the other store */ }

  try {
    const ms = editorChannel(modelStream).state();
    const models = libraryModels(ms);
    studioModelCount = models.length;
    for (const model of models) {
      for (const id of model.order) {
        const part = model.parts[id];
        if (part?.mesh) studio = add(studio, editMeshTotals(part.mesh));
      }
    }
  } catch { /* headless */ }

  return {
    cooked,
    studio,
    total: add(cooked, studio),
    cookedAssetCount,
    studioModelCount,
    uniqueCookedMeshes: uniqueMeshes.size,
  };
}
