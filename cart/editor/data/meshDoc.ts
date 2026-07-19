// editor/data/meshDoc.ts — the model DOCUMENT blob inside a Model Package (req_2753).
//
// The disease this cures: a studio-authored model's edits live in the HOST resident
// mesh; parts are metadata + a group range. Save used to write only mesh/base.blob
// (bare verts, no reader) and a manifest that still claimed the primitive SEED — so a
// doc switch rebuilt the seed (edits gone from view) and a restart re-armed the
// primitive generator (cube, no outliner). The meshdoc is the durable, READABLE form:
//
//   mesh/doc.blob    RJMD v2 — verts + authored face groups + per-part group ranges
//                    + the trailing glass vertex boundary (v1 remains readable),
//                    written by the host door __model_meshdoc_write (the format's twin
//                    lives in framework/v8_bindings_core.zig hostModelMeshdocWrite).
//   mesh/parts.json  rank-ordered part METADATA (name/color/visible/kind/group), matching
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
  /** First vertex in the stable trailing glass run; absent on legacy RJMD v1. */
  glassFirstVertex?: number | null;
};

/** Part metadata row, rank-ordered to match PackageMeshDoc.ranges. */
export type MeshDocPartMeta = { name: string; color: string; visible: boolean; kind?: string; groupId?: string; groupName?: string };

const RJMD_MAGIC = 0x444d4a52; // 'RJMD' little-endian
const DOC_BLOB = 'mesh/doc.blob';
const LEGACY_BLOB = 'mesh/base.blob';
const PARTS_META = 'mesh/parts.json';

// Package reads happen per render pass (the doc surface resolves its viewer source on
// every render) — cache by dir, invalidated by this module's own writers.
const docCache = new Map<string, PackageMeshDoc | null>();
const metaCache = new Map<string, MeshDocPartMeta[] | null>();

export function meshDocPartRangesComplete(partCount: number, hostRangeCount: number): boolean {
  return partCount < 2 || hostRangeCount >= partCount;
}

/** Return a complete, host-safe range mirror or null. This is deliberately strict:
 * save recovery may restore known live ranges, but it must never invent boundaries. */
export function meshDocPartRangesFromRows(rows: readonly { lo?: number; hi?: number }[]): { lo: number; hi: number }[] | null {
  const ranges: { lo: number; hi: number }[] = [];
  for (const row of rows) {
    if (!Number.isInteger(row.lo) || !Number.isInteger(row.hi) || row.lo! < 0 || row.hi! <= row.lo!) return null;
    ranges.push({ lo: row.lo!, hi: row.hi! });
  }
  ranges.sort((a, b) => a.lo - b.lo);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i]!.lo < ranges[i - 1]!.hi) return null;
  }
  return ranges;
}

export function invalidateMeshDoc(dir: string): void {
  docCache.delete(dir);
  metaCache.delete(dir);
}

/** Write the resident host model into the package as its meshdoc (host door). True only
 *  when doc.blob landed; parts metadata rides along best-effort. */
export function writeMeshDoc(dir: string, parts?: MeshDocPartMeta[], recoveryRanges?: { lo: number; hi: number }[]): boolean {
  // Save gate (req_3049/req_3226): writing fewer host ranges than outliner parts
  // destroys the only durable part-boundary table. Never replace a recoverable old
  // document with that degraded state. Geometry can still be saved once the host is
  // re-seeded; until then the caller gets a loud failure and the old blob stays intact.
  if (parts && parts.length >= 2) {
    const hostRangeCount = (): number => {
      try {
        const o = JSON.parse(host.__mesh_part_ranges?.() ?? 'null');
        return o?.ok && Array.isArray(o.ranges) ? o.ranges.length : 0;
      } catch { return 0; }
    };
    let hostRanges = hostRangeCount();
    // A topology op used to clear the host mirror while the outliner retained its
    // complete host-stamped ranges. Restore only that validated live truth; otherwise
    // the refusal below preserves the previous document for explicit recovery.
    if (!meshDocPartRangesComplete(parts.length, hostRanges) && recoveryRanges?.length === parts.length) {
      const pairs = new Uint32Array(recoveryRanges.length * 2);
      recoveryRanges.forEach((range, index) => {
        pairs[index * 2] = range.lo;
        pairs[index * 2 + 1] = range.hi;
      });
      host.__mesh_set_part_ranges?.(pairs);
      hostRanges = hostRangeCount();
    }
    if (!meshDocPartRangesComplete(parts.length, hostRanges)) {
      console.error(`[meshdoc] REFUSING SAVE for ${dir}: host has ${hostRanges} part range(s) while the outliner declares ${parts.length} (${parts.map((p) => p.name).join(', ')}) — preserving the previous document instead of persisting merged parts (req_3049/req_3226)`);
      return false;
    }
  }
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
  return parseMeshDocBytes(bytes);
}

/** Pure RJMD decoder used by disk reads and the version-compatibility tests. */
export function parseMeshDocBytes(bytes: Uint8Array): PackageMeshDoc | null {
  if (bytes.length < 24) return null;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const head = new Uint32Array(buf, 0, 6);
  const [magic, version, vertCount, faceCount, hasGroups, rangeCount] = [head[0]!, head[1]!, head[2]!, head[3]!, head[4]!, head[5]!];
  if (magic !== RJMD_MAGIC || (version !== 1 && version !== 2) || vertCount === 0) return null;
  const headerBytes = version >= 2 ? 28 : 24;
  if (bytes.length < headerBytes) return null;
  const glassFirstVertex = version >= 2 ? new Uint32Array(buf, 24, 1)[0]! : null;
  if (glassFirstVertex !== null && (glassFirstVertex > vertCount || glassFirstVertex % 3 !== 0)) return null;
  const need = headerBytes + vertCount * 8 * 4 + (hasGroups ? faceCount * 4 : 0) + rangeCount * 8;
  if (bytes.length < need) return null;
  let at = headerBytes;
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
  return { vertices, faceGroups, ranges, glassFirstVertex };
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
export function partsMetaFromRows(rows: readonly { name: string; color: string; visible: boolean; kind?: string; groupId?: string; groupName?: string; lo?: number }[]): MeshDocPartMeta[] {
  return rows
    .slice()
    .sort((a, b) => (a.lo ?? Number.MAX_SAFE_INTEGER) - (b.lo ?? Number.MAX_SAFE_INTEGER))
    .map((p) => ({ name: p.name, color: p.color, visible: p.visible, kind: p.kind, groupId: p.groupId, groupName: p.groupName }));
}

/** Per-range bounds centers, rank-ordered to match `doc.ranges` — the MEASURED
 *  part centers the character rig compiler stamps rest transforms from
 *  (req_2777: measured at export, never a stored table). A range with no
 *  triangles yields null (its bone keeps identity). */
export function meshDocRangeCenters(doc: PackageMeshDoc): ([number, number, number] | null)[] {
  const triCount = Math.floor(doc.vertices.length / 24);
  const box = doc.ranges.map(() => ({ n: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
  for (let tri = 0; tri < triCount; tri += 1) {
    const group = doc.faceGroups ? doc.faceGroups[tri]! : tri;
    const rank = doc.ranges.findIndex((r) => group >= r.lo && group < r.hi);
    if (rank < 0) continue;
    const b = box[rank]!;
    for (let corner = 0; corner < 3; corner += 1) {
      const at = (tri * 3 + corner) * 8;
      for (let axis = 0; axis < 3; axis += 1) {
        const v = doc.vertices[at + axis]!;
        if (v < b.min[axis]!) b.min[axis] = v;
        if (v > b.max[axis]!) b.max[axis] = v;
      }
    }
    b.n += 1;
  }
  return box.map((b) => (b.n === 0 ? null : [
    (b.min[0]! + b.max[0]!) / 2,
    (b.min[1]! + b.max[1]!) / 2,
    (b.min[2]! + b.max[2]!) / 2,
  ]));
}

/** Extract one package part as standalone appendable geometry. Face-group ids
 * are normalized to a compact zero-based span so the receiving model can assign
 * its own durable range without inheriting ids from the source package. */
export function meshDocRangeGeometry(
  doc: PackageMeshDoc,
  rangeIndex: number,
): { vertices: Float32Array; faceGroups: Uint32Array } {
  const range = doc.ranges[rangeIndex];
  if (!range) return { vertices: new Float32Array(0), faceGroups: new Uint32Array(0) };
  const vertices: number[] = [];
  const faceGroups: number[] = [];
  const normalized = new Map<number, number>();
  const triCount = Math.floor(doc.vertices.length / 24);
  for (let tri = 0; tri < triCount; tri += 1) {
    const sourceGroup = doc.faceGroups?.[tri] ?? tri;
    if (sourceGroup < range.lo || sourceGroup >= range.hi) continue;
    let targetGroup = normalized.get(sourceGroup);
    if (targetGroup === undefined) {
      targetGroup = normalized.size;
      normalized.set(sourceGroup, targetGroup);
    }
    const start = tri * 24;
    for (let i = 0; i < 24; i += 1) vertices.push(doc.vertices[start + i]!);
    faceGroups.push(targetGroup);
  }
  return { vertices: new Float32Array(vertices), faceGroups: new Uint32Array(faceGroups) };
}
