// editor/data/meshDoc.ts — the model DOCUMENT blob inside a Model Package (req_2753).
//
// The disease this cures: a studio-authored model's edits live in the HOST resident
// mesh; parts are metadata + a group range. Save used to write only mesh/base.blob
// (bare verts, no reader) and a manifest that still claimed the primitive SEED — so a
// doc switch rebuilt the seed (edits gone from view) and a restart re-armed the
// primitive generator (cube, no outliner). The meshdoc is the durable, READABLE form:
//
//   mesh/doc.blob    RJMD v1 — verts + authored face groups + per-part group ranges,
//                    written by the host door __model_meshdoc_write (the format's twin
//                    lives in framework/v8_bindings_core.zig hostModelMeshdocWrite).
//   mesh/parts.json  rank-ordered part METADATA (name/color/visible/kind), matching
//                    doc.blob's ranges ascending — names are cart truth, geometry is
//                    host truth, the rank ties them together.
//
// Legacy packages (pre-meshdoc saves, e.g. sign_p) carry only mesh/base.blob: readable
// as ONE part with identity face groups — the edits recover, the part split doesn't.
//
// Every function here takes the package's resolved on-disk home (`dir`) — resolution
// stays in modelPackageStore (this module must not import it: the store's
// writeModelArtifacts calls down into this writer).
import { exists, readFile, readFileBase64, writeFile } from '../../../runtime/hooks/fs';
import { base64ToBytes } from '../../../runtime/workspace';

const host = globalThis as any;

export type PackageMeshDoc = {
  /** interleaved source verts, stride 8 (pos3/normal3/uv2) */
  vertices: Float32Array;
  /** one authored-group id per triangle, or null (plain soup — identity granularity) */
  faceGroups: Uint32Array | null;
  /** per-part [lo,hi) authored-group ranges, ascending lo; always ≥1 entry */
  ranges: { lo: number; hi: number }[];
};

/** Part metadata row, rank-ordered to match PackageMeshDoc.ranges. */
export type MeshDocPartMeta = { name: string; color: string; visible: boolean; kind?: string };

const RJMD_MAGIC = 0x444d4a52; // 'RJMD' little-endian
const DOC_BLOB = 'mesh/doc.blob';
const LEGACY_BLOB = 'mesh/base.blob';
const PARTS_META = 'mesh/parts.json';

// Package reads happen per render pass (the doc surface resolves its viewer source on
// every render) — cache by dir, invalidated by this module's own writers.
const docCache = new Map<string, PackageMeshDoc | null>();
const metaCache = new Map<string, MeshDocPartMeta[] | null>();

export function invalidateMeshDoc(dir: string): void {
  docCache.delete(dir);
  metaCache.delete(dir);
}

/** Write the resident host model into the package as its meshdoc (host door). True only
 *  when doc.blob landed; parts metadata rides along best-effort. */
export function writeMeshDoc(dir: string, parts?: MeshDocPartMeta[]): boolean {
  const ok = host.__model_meshdoc_write?.(`${dir}/${DOC_BLOB}`) === 1;
  if (ok && parts && parts.length > 0) {
    writeFile(`${dir}/${PARTS_META}`, JSON.stringify({ version: 1, parts }, null, 2));
  }
  invalidateMeshDoc(dir);
  return ok;
}

/** The package's saved model document, or null (never saved with a meshdoc AND no
 *  legacy blob). Prefers doc.blob; falls back to legacy base.blob as one part. */
export function readMeshDoc(dir: string): PackageMeshDoc | null {
  if (docCache.has(dir)) return docCache.get(dir)!;
  const doc = parseDocBlob(dir) ?? parseLegacyBlob(dir);
  docCache.set(dir, doc);
  return doc;
}

/** The saved part metadata rows (rank-ordered), or null when parts.json is absent. */
export function readMeshDocParts(dir: string): MeshDocPartMeta[] | null {
  if (metaCache.has(dir)) return metaCache.get(dir)!;
  let parts: MeshDocPartMeta[] | null = null;
  const text = readFile(`${dir}/${PARTS_META}`);
  if (text) {
    try {
      const o = JSON.parse(text);
      if (o?.version === 1 && Array.isArray(o.parts)) {
        parts = (o.parts as MeshDocPartMeta[]).filter((p) => typeof p?.name === 'string');
      }
    } catch { /* unreadable metadata — geometry still loads, names fall back */ }
  }
  metaCache.set(dir, parts);
  return parts;
}

function parseDocBlob(dir: string): PackageMeshDoc | null {
  const path = `${dir}/${DOC_BLOB}`;
  if (!exists(path)) return null;
  const b64 = readFileBase64(path);
  if (!b64) return null;
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(b64); } catch { return null; }
  if (bytes.length < 24) return null;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const head = new Uint32Array(buf, 0, 6);
  const [magic, version, vertCount, faceCount, hasGroups, rangeCount] = [head[0]!, head[1]!, head[2]!, head[3]!, head[4]!, head[5]!];
  if (magic !== RJMD_MAGIC || version !== 1 || vertCount === 0) return null;
  const need = 24 + vertCount * 8 * 4 + (hasGroups ? faceCount * 4 : 0) + rangeCount * 8;
  if (bytes.length < need) return null;
  let at = 24;
  const vertices = new Float32Array(buf, at, vertCount * 8);
  at += vertCount * 8 * 4;
  let faceGroups: Uint32Array | null = null;
  if (hasGroups) {
    faceGroups = new Uint32Array(buf, at, faceCount);
    at += faceCount * 4;
  }
  const ranges: { lo: number; hi: number }[] = [];
  if (rangeCount > 0) {
    const pairs = new Uint32Array(buf, at, rangeCount * 2);
    for (let i = 0; i < rangeCount; i += 1) ranges.push({ lo: pairs[i * 2]!, hi: pairs[i * 2 + 1]! });
  }
  if (ranges.length === 0) ranges.push({ lo: 0, hi: groupSpanEnd(faceGroups, faceCount) });
  return { vertices, faceGroups, ranges };
}

// Pre-meshdoc packages (bare verts, req_2533's writer): one recovered part covering
// everything, identity face groups (each triangle its own selectable face).
function parseLegacyBlob(dir: string): PackageMeshDoc | null {
  const path = `${dir}/${LEGACY_BLOB}`;
  if (!exists(path)) return null;
  const b64 = readFileBase64(path);
  if (!b64) return null;
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(b64); } catch { return null; }
  const vertCount = Math.floor(bytes.length / 32);
  if (vertCount < 3) return null;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + vertCount * 32);
  const vertices = new Float32Array(buf, 0, vertCount * 8);
  const faceCount = Math.floor(vertCount / 3);
  const faceGroups = new Uint32Array(faceCount);
  for (let i = 0; i < faceCount; i += 1) faceGroups[i] = i;
  return { vertices, faceGroups, ranges: [{ lo: 0, hi: faceCount }] };
}

// The [lo,hi) span end when no ranges were stored: past the highest group id, or the
// face count for identity/absent grouping.
function groupSpanEnd(groups: Uint32Array | null, faceCount: number): number {
  if (!groups || groups.length === 0) return faceCount;
  let max = 0;
  for (let i = 0; i < groups.length; i += 1) { if (groups[i]! > max) max = groups[i]!; }
  return max + 1;
}

/** Rank-order live outliner rows into meshdoc part metadata (ascending lo — the same
 *  order the host reports ranges in). */
export function partsMetaFromRows(rows: readonly { name: string; color: string; visible: boolean; kind?: string; lo?: number }[]): MeshDocPartMeta[] {
  return rows
    .slice()
    .sort((a, b) => (a.lo ?? Number.MAX_SAFE_INTEGER) - (b.lo ?? Number.MAX_SAFE_INTEGER))
    .map((p) => ({ name: p.name, color: p.color, visible: p.visible, kind: p.kind }));
}
