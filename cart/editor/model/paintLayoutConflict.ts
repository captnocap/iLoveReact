// One read boundary for the paint-layout conflict picker (req_3897).
//
// The stale marker deliberately gates the ordinary paint readers, so this module
// reads the package evidence directly: the saved document, the last base-paint
// era, every named paint variant, and the marker that explains the refusal. The
// UI receives compact facts rather than learning package paths or JSON shapes.
import { readFile, stat } from '../../../runtime/hooks/fs';
import { readMeshDoc } from '../data/meshDoc';
import {
  PAINT_LAYOUT_STALE_FILE,
  resolvePackageDir,
} from '../data/modelPackageStore';
import { listPaintVariants, type PaintTarget, type PaintVariant } from '../data/paintVariants';

const MESH_VERTEX_FLOATS = 8;
const TRIANGLE_VERTICES = 3;
const UV_FLOATS_PER_TRIANGLE = 6;

export type PaintEraFact = {
  id: string | null;
  name: string;
  triangles: number | null;
};

export type PaintLayoutStaleMarker = {
  reason: string;
  docStamp: string;
};

export type PaintLayoutDiskFacts = {
  packageDir: string;
  doc: {
    bytes: number;
    modifiedMs: number;
    stamp: string;
    triangles: number | null;
    authoredFaces: number | null;
  } | null;
  basePaint: PaintEraFact | null;
  variants: PaintEraFact[];
  marker: PaintLayoutStaleMarker | null;
};

export type PaintLayoutLiveFacts = {
  triangles: number;
  authoredFaces: number | null;
  generation: number | null;
  unsaved: boolean;
};

export function paintEraTriangleCount(cornerUv: unknown): number | null {
  if (!Array.isArray(cornerUv) || cornerUv.length === 0 || cornerUv.length % UV_FLOATS_PER_TRIANGLE !== 0) return null;
  return cornerUv.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? cornerUv.length / UV_FLOATS_PER_TRIANGLE
    : null;
}

function parsePaintEra(text: string | null, id: string | null, name: string): PaintEraFact | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as { cornerUv?: unknown };
    return { id, name, triangles: paintEraTriangleCount(value.cornerUv) };
  } catch {
    return null;
  }
}

function variantFact(variant: PaintVariant): PaintEraFact {
  return {
    id: variant.id,
    name: variant.name,
    triangles: paintEraTriangleCount(variant.cornerUv),
  };
}

function readStaleMarker(text: string | null): PaintLayoutStaleMarker | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as { reason?: unknown; docStamp?: unknown };
    if (typeof value.reason !== 'string' || typeof value.docStamp !== 'string') return null;
    return { reason: value.reason, docStamp: value.docStamp };
  } catch {
    return null;
  }
}

export function readPaintLayoutDiskFacts(pkg: PaintTarget): PaintLayoutDiskFacts | null {
  const packageDir = resolvePackageDir(pkg.kind, pkg.id);
  if (!packageDir) return null;
  const blob = stat(`${packageDir}/mesh/doc.blob`);
  const mesh = readMeshDoc(packageDir);
  const triangleCount = mesh && mesh.vertices.length % (MESH_VERTEX_FLOATS * TRIANGLE_VERTICES) === 0
    ? mesh.vertices.length / (MESH_VERTEX_FLOATS * TRIANGLE_VERTICES)
    : null;
  const authoredFaceCount = mesh
    ? (mesh.faceGroups ? new Set(mesh.faceGroups).size : triangleCount)
    : null;
  return {
    packageDir,
    doc: blob
      ? {
        bytes: blob.size,
        modifiedMs: blob.mtimeMs,
        stamp: `${blob.size}:${blob.mtimeMs}`,
        triangles: triangleCount,
        authoredFaces: authoredFaceCount,
      }
      : null,
    // These are intentionally direct reads. readModelBasePaint is gated while the
    // stale marker exists, but the picker exists to show that preserved evidence.
    basePaint: parsePaintEra(readFile(`${packageDir}/atlases/base.paint.json`), null, 'Base painting'),
    variants: listPaintVariants(pkg).map(variantFact),
    marker: readStaleMarker(readFile(`${packageDir}/${PAINT_LAYOUT_STALE_FILE}`)),
  };
}

export function paintLayoutMismatchSentence(
  liveTriangles: number,
  disk: PaintLayoutDiskFacts | null,
  requestedVariantId: string | null = null,
): string {
  const requested = requestedVariantId
    ? disk?.variants.find((variant) => variant.id === requestedVariantId) ?? null
    : null;
  const era = requested
    ?? [...(disk?.variants ?? [])].reverse().find((variant) => variant.triangles !== null)
    ?? disk?.basePaint
    ?? null;
  if (era?.triangles != null && era.triangles !== liveTriangles) {
    return `${era.name} fits a ${era.triangles}-triangle shape; the live mesh is ${liveTriangles} triangles.`;
  }
  if (era?.triangles === liveTriangles) {
    return `${era.name} belongs to an older face layout; both shapes report ${liveTriangles} triangles, but their paint mapping differs.`;
  }
  return 'Saved paint belongs to an older face layout than the live mesh.';
}

export function formatConflictBytes(bytes: number): string {
  return `${Math.max(0, Math.round(bytes)).toLocaleString()} bytes`;
}

export function formatConflictTime(modifiedMs: number): string {
  const date = new Date(modifiedMs);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'unknown time';
}
