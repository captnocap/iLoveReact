// editor/library/modelThumb.ts — the model-preview pipeline, ported from the old
// app (hmsc-int/railThumbGrid): frame an orbit camera on a model's own bounds so
// every model reads like a product shot — a phone booth and a bus both fill the
// tile instead of one being a speck. The thumbnail itself is a static <Scene3D>
// (ModelThumbnail.tsx); this module is the pure mesh + framing math it consumes.
import { cookedMeshBlobData, cookedMeshRefForAsset, storedModelMeshData } from '../data/hmscAssetCatalog';
import type { ModelPackage } from '../data/types';

// Cooked/studio meshes are interleaved [px,py,pz, nx,ny,nz, u,v] — 8 floats/vertex.
const STRIDE = 8;

// Product-shot framing (the railThumbGrid constants): a snug 3/4 orbit at a
// narrow FOV, pulled back ~18% past the exact fit so nothing crops.
const THUMB_FOV = 30;
const THUMB_YAW = 35 * (Math.PI / 180);
const THUMB_PITCH = 24 * (Math.PI / 180);
const THUMB_MARGIN = 1.18;

export type ThumbMesh = { key: string; vertices: Float32Array; count: number };
export type ThumbView = {
  geometry: { id: string; defaults: Record<string, never>; generate: () => { positions: Float32Array; count: number; bounds: { radius: number } } };
  cam: { pos: [number, number, number]; target: [number, number, number]; fov: number };
};

/** Resolve a model to its resident triangle data, or null when only a file path
 *  / no geometry is available (the caller falls back to the colour swatch). */
export function resolveModelMesh(model: ModelPackage): ThumbMesh | null {
  const cookedRef = model.viewerMeshRef
    ?? (model.sourceKind === 'cooked-asset' ? cookedMeshRefForAsset(cookedAssetId(model)) : null);
  if (cookedRef) {
    const vertices = cookedMeshBlobData(cookedRef);
    if (vertices && vertices.length >= STRIDE) return { key: cookedRef, vertices, count: Math.floor(vertices.length / STRIDE) };
  }
  if (model.sourceKind === 'studio-model') {
    const storedId = model.id.startsWith('studio:') ? model.id.slice('studio:'.length) : model.id;
    const vertices = storedModelMeshData(storedId);
    if (vertices && vertices.length >= STRIDE) return { key: `studio:${storedId}`, vertices, count: Math.floor(vertices.length / STRIDE) };
  }
  return null;
}

/** Build the Scene3D-ready view (a one-mesh geometry def + an auto-framed
 *  camera) for a resolved mesh. Cheap; memoize by model id at the call site. */
export function buildThumbView(mesh: ThumbMesh): ThumbView {
  const b = meshBounds(mesh.vertices);
  return {
    geometry: {
      id: `model-thumb:${mesh.key}`,
      defaults: {},
      generate: () => ({ positions: mesh.vertices, count: mesh.count, bounds: { radius: b.radius } }),
    },
    cam: thumbCamera(b),
  };
}

type Bounds = { cx: number; cy: number; cz: number; w: number; h: number; d: number; radius: number };

/** AABB + framing radius from interleaved vertices. */
function meshBounds(v: Float32Array): Bounds {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < v.length; i += STRIDE) {
    const x = v[i]!, y = v[i + 1]!, z = v[i + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return { cx: 0, cy: 0, cz: 0, w: 1, h: 1, d: 1, radius: 0.87 };
  const w = maxX - minX, h = maxY - minY, d = maxZ - minZ;
  const ew = Math.max(0.3, w), eh = Math.max(0.3, h), ed = Math.max(0.3, d);
  return {
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2,
    w, h, d,
    radius: 0.5 * Math.sqrt(ew * ew + eh * eh + ed * ed),
  };
}

/** Back an orbit camera off the bounds so the model fits the FOV — the whole
 *  reason every model reads at a usable size regardless of its real scale. */
function thumbCamera(b: Bounds): ThumbView['cam'] {
  const dist = (b.radius / Math.tan((THUMB_FOV / 2) * (Math.PI / 180))) * THUMB_MARGIN;
  return {
    pos: [
      b.cx + dist * Math.cos(THUMB_PITCH) * Math.sin(THUMB_YAW),
      b.cy + dist * Math.sin(THUMB_PITCH),
      b.cz + dist * Math.cos(THUMB_PITCH) * Math.cos(THUMB_YAW),
    ],
    target: [b.cx, b.cy, b.cz],
    fov: THUMB_FOV,
  };
}

function cookedAssetId(model: ModelPackage): string {
  return model.id.startsWith('cooked:') ? model.id.slice('cooked:'.length) : model.id;
}
