// editor/library/modelThumb.ts — frame an orbit camera on a model's own bounds so
// every model reads like a product shot — a phone booth and a bus both fill the
// tile instead of one being a speck. The thumbnail itself is a static <Scene3D>
// (ModelThumbnail.tsx); this module is the pure mesh + framing math it consumes.
import { packageMeshDoc } from '../data/assetCatalog';
import type { ModelPackage } from '../data/types';

// Package meshes are interleaved [px,py,pz, nx,ny,nz, u,v] — 8 floats/vertex.
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
  // The package's saved meshdoc first (req_2753) — the tile shows the model as EDITED,
  // not its primitive seed / colour swatch. The key carries a cheap content fingerprint:
  // the thumb geometry interns by id (never evicted), so a re-save must mint a new key.
  const doc = packageMeshDoc(model);
  if (doc && doc.vertices.length >= STRIDE) {
    const v = doc.vertices;
    const stamp = `${v.length}:${Math.round((v[0] ?? 0) * 1e3)}:${Math.round((v[v.length - STRIDE] ?? 0) * 1e3)}`;
    return { key: `pkgdoc:${model.id}:${stamp}`, vertices: v, count: Math.floor(v.length / STRIDE) };
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

// ── multi-part product shots (the build palette, req_2651) ─────────────────
// A CATALOG build piece isn't one stored mesh — pieceShapes decomposes it into
// coloured boxes/ramps (jambs, a glass pane, a door leaf, roof slopes). A part
// is one triangulated colour group; the view frames the SAME product-shot orbit
// camera on the UNION of every part's bounds so the whole piece reads as one
// shot, exactly like a single-mesh model does.
export type ThumbPart = { key: string; vertices: Float32Array; count: number; color: string; opacity?: number };
export type PartsThumbView = {
  meshes: { geometry: ThumbView['geometry']; color: string; opacity?: number }[];
  cam: ThumbView['cam'];
};

export function buildPartsThumbView(parts: readonly ThumbPart[]): PartsThumbView | null {
  if (parts.length === 0) return null;
  const b = scanBounds(parts.map((p) => p.vertices));
  return {
    meshes: parts.map((p) => ({
      geometry: {
        id: `piece-thumb:${p.key}`,
        defaults: {},
        generate: () => ({ positions: p.vertices, count: p.count, bounds: { radius: b.radius } }),
      },
      color: p.color,
      opacity: p.opacity,
    })),
    cam: thumbCamera(b),
  };
}

type Bounds = { cx: number; cy: number; cz: number; w: number; h: number; d: number; radius: number };

/** AABB + framing radius from interleaved vertices. */
function meshBounds(v: Float32Array): Bounds {
  return scanBounds([v]);
}

/** AABB + framing radius across MULTIPLE interleaved vertex arrays (the union). */
function scanBounds(arrays: readonly Float32Array[]): Bounds {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of arrays) {
    for (let i = 0; i + 2 < v.length; i += STRIDE) {
      const x = v[i]!, y = v[i + 1]!, z = v[i + 2]!;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
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
