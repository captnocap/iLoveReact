// One read boundary for the paint-layout conflict picker (req_3897).
//
// The stale marker deliberately gates the ordinary paint readers, so this module
// reads the package evidence directly: the saved document, the last base-paint
// era, every named paint variant, and the marker that explains the refusal. The
// UI receives compact facts rather than learning package paths or JSON shapes.
import { readFile, stat } from '../../../runtime/hooks/fs';
import { meshDocDurablePartCount, readMeshDoc, readMeshDocParts } from '../data/meshDoc';
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
    parts: number | null;
  } | null;
  semantics: {
    namedFaces: number;
    regions: { name: string; faces: number }[];
  };
  basePaint: PaintEraFact | null;
  variants: PaintEraFact[];
  marker: PaintLayoutStaleMarker | null;
};

export type PaintLayoutLiveFacts = {
  triangles: number;
  authoredFaces: number | null;
  generation: number | null;
  unsaved: boolean;
  parts: number | null;
  namedFaces: number;
  semanticNames: string[];
};

export type PaintLayoutKeepLiveOptions = {
  /** Keep LIVE is an explicit state choice. When the picker disclosed that the
   * resident semantic table is empty while disk still has names, this capability
   * lets that exact choice pass the semantic-erasure save guard (req_3900). */
  allowSemanticClear?: boolean;
  /** The picker disclosed that Keep LIVE replaces a document with more durable
   * parts than the resident Outliner. This is that one-shot permission. */
  allowPartShrink?: boolean;
};

export type ModelRevisionConflictReason =
  | { kind: 'paint-layout' }
  | { kind: 'part-count'; liveParts: number; diskParts: number };

/** Preflight the exact destructive part-count edge guarded by writeMeshDoc. */
export function modelRevisionPartConflict(
  liveParts: number,
  diskParts: number | null,
  alreadyAuthorized: boolean,
): ModelRevisionConflictReason | null {
  return diskParts !== null && liveParts > 0 && liveParts < diskParts && !alreadyAuthorized
    ? { kind: 'part-count', liveParts, diskParts }
    : null;
}

/** Hot-session acknowledgement scope. The value is a concrete disk revision,
 * not a boolean: an external/cold disk change therefore demands a new choice,
 * while saves descended from an acknowledged checkpoint can roll it forward. */
export function paintLayoutConflictAckHotKey(documentId: string): string {
  return `editor:paint-layout-conflict-ack:v1:${documentId}`;
}

export function paintLayoutConflictRevision(disk: PaintLayoutDiskFacts | null): string {
  return disk?.marker?.docStamp ?? disk?.doc?.stamp ?? 'stale-without-readable-stamp';
}

export function paintLayoutConflictRevisionIsAcknowledged(
  acknowledgedRevision: string | null,
  disk: PaintLayoutDiskFacts | null,
): boolean {
  return acknowledgedRevision !== null && acknowledgedRevision === paintLayoutConflictRevision(disk);
}

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
  const savedPartCount = readMeshDocParts(packageDir)?.length ?? 0;
  const triangleCount = mesh && mesh.vertices.length % (MESH_VERTEX_FLOATS * TRIANGLE_VERTICES) === 0
    ? mesh.vertices.length / (MESH_VERTEX_FLOATS * TRIANGLE_VERTICES)
    : null;
  const authoredFaceCount = mesh
    ? (mesh.faceGroups ? new Set(mesh.faceGroups).size : triangleCount)
    : null;
  const semanticFaceCounts = new Map<number, number>();
  for (const id of mesh?.semanticRegions ?? []) {
    if (id !== 0xffffffff) semanticFaceCounts.set(id, (semanticFaceCounts.get(id) ?? 0) + 1);
  }
  const semanticRegions = (mesh?.semanticTable?.regions ?? [])
    .map((region) => ({ name: region.name, faces: semanticFaceCounts.get(region.id) ?? 0 }))
    .filter((region) => region.faces > 0);
  return {
    packageDir,
    doc: blob
      ? {
        bytes: blob.size,
        modifiedMs: blob.mtimeMs,
        stamp: `${blob.size}:${blob.mtimeMs}`,
        triangles: triangleCount,
        authoredFaces: authoredFaceCount,
        parts: mesh ? meshDocDurablePartCount(mesh.storedRangeCount, savedPartCount) : null,
      }
      : null,
    semantics: {
      namedFaces: semanticRegions.reduce((total, region) => total + region.faces, 0),
      regions: semanticRegions,
    },
    // These are intentionally direct reads. readModelBasePaint is gated while the
    // stale marker exists, but the picker exists to show that preserved evidence.
    basePaint: parsePaintEra(readFile(`${packageDir}/atlases/base.paint.json`), null, 'Base painting'),
    variants: listPaintVariants(pkg).map(variantFact),
    marker: readStaleMarker(readFile(`${packageDir}/${PAINT_LAYOUT_STALE_FILE}`)),
  };
}

/** True only for the protected destructive edge: live has no named faces while
 * disk still does. The picker can disclose this fact before its Keep LIVE verb
 * mints the one-shot save authorization; ordinary saves remain guarded. */
export function paintLayoutKeepLiveClearsSemantics(
  live: Pick<PaintLayoutLiveFacts, 'namedFaces'>,
  disk: PaintLayoutDiskFacts | null,
): boolean {
  return live.namedFaces === 0 && (disk?.semantics?.namedFaces ?? 0) > 0;
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

/** One plain sentence for the exact guarded difference the picker resolves. */
export function modelRevisionMismatchSentence(
  liveTriangles: number,
  disk: PaintLayoutDiskFacts | null,
  requestedVariantId: string | null,
  reason: ModelRevisionConflictReason,
): string {
  if (reason.kind === 'part-count') {
    const removed = reason.diskParts - reason.liveParts;
    return `The live model has ${reason.liveParts} part${reason.liveParts === 1 ? '' : 's'}; the saved model has ${reason.diskParts}. Keep LIVE removes ${removed} saved part${removed === 1 ? '' : 's'}.`;
  }
  return paintLayoutMismatchSentence(liveTriangles, disk, requestedVariantId);
}

/** Convert only the differences disclosed by the modal into write capabilities. */
export function modelRevisionKeepLiveOptions(
  live: Pick<PaintLayoutLiveFacts, 'namedFaces'>,
  disk: PaintLayoutDiskFacts | null,
  reason: ModelRevisionConflictReason,
): PaintLayoutKeepLiveOptions {
  return {
    allowSemanticClear: paintLayoutKeepLiveClearsSemantics(live, disk),
    allowPartShrink: reason.kind === 'part-count',
  };
}

export function formatConflictBytes(bytes: number): string {
  return `${Math.max(0, Math.round(bytes)).toLocaleString()} bytes`;
}

export function formatConflictTime(modifiedMs: number): string {
  const date = new Date(modifiedMs);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'unknown time';
}
