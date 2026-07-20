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
import { exists, readFile, readFileBase64, writeFileBytesAtomic } from '../../../runtime/hooks/fs';
import { base64ToBytes, textBytes } from '../../../runtime/workspace';

const host = globalThis as any;

export type PackageMeshDoc = {
  /** interleaved source verts, stride 8 (pos3/normal3/uv2) */
  vertices: Float32Array;
  /** one authored-group id per triangle, or null (plain soup — identity granularity) */
  faceGroups: Uint32Array | null;
  /** per-part [lo,hi) authored-group ranges, ascending lo; always ≥1 entry */
  ranges: { lo: number; hi: number }[];
  /** Number physically stored in RJMD. Zero means `ranges` is only the decoder's
   *  one-part fallback unless `recoveredPartRanges` is true. */
  storedRangeCount?: number;
  /** Missing durable ranges were recovered exactly from contiguous connectivity
   *  runs and the parts.json row count. */
  recoveredPartRanges?: boolean;
  /** First vertex in the stable trailing glass run; absent on legacy RJMD v1. */
  glassFirstVertex?: number | null;
};

/** Part metadata row, rank-ordered to match PackageMeshDoc.ranges. */
export type MeshDocPartMeta = {
  name: string;
  color: string;
  visible: boolean;
  kind?: string;
  groupId?: string;
  groupName?: string;
  groupPath?: { id: string; name: string }[];
  outlinerOrder?: number;
};

const RJMD_MAGIC = 0x444d4a52; // 'RJMD' little-endian
const DOC_BLOB = 'mesh/doc.blob';
const LEGACY_BLOB = 'mesh/base.blob';
const PARTS_META = 'mesh/parts.json';

// Package reads happen per render pass (the doc surface resolves its viewer source on
// every render) — cache by dir, invalidated by this module's own writers.
const docCache = new Map<string, PackageMeshDoc | null>();
const metaCache = new Map<string, MeshDocPartMeta[] | null>();

export function meshDocPartRangesComplete(partCount: number, hostRangeCount: number): boolean {
  return partCount > 0 && hostRangeCount === partCount;
}

export function meshDocPartMetadataCanShrink(
  storedRangeCount: number | undefined,
  savedPartCount: number,
  livePartCount: number,
  explicitlyAuthorized = false,
): boolean {
  // Counts may grow freely. Shrinking is destructive and therefore requires the
  // explicit capability minted by a real Delete/Merge/Undo action in AppFrame.
  // Hydration, paint saves, and autosave never possess that capability.
  const durablePartCount = Math.max(storedRangeCount ?? 0, savedPartCount);
  return livePartCount >= durablePartCount || explicitlyAuthorized;
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

/** Transactionally write the resident host model and its exact Outliner/range table.
 * The staged host blob is validated before either durable file is replaced. */
export function writeMeshDoc(
  dir: string,
  parts: MeshDocPartMeta[],
  recoveryRanges?: { lo: number; hi: number }[],
  options: { allowPartShrink?: boolean } = {},
): boolean {
  // The editable document is a two-file transaction. No metadata-less caller is
  // admitted here; paint-only persistence must leave doc.blob + parts.json alone.
  if (parts.length === 0) {
    console.error(`[meshdoc] REFUSING SAVE for ${dir}: an editable mesh document needs at least one named part`);
    return false;
  }
  const priorDoc = readMeshDoc(dir);
  const priorPartCount = readMeshDocParts(dir)?.length ?? 0;
  if (!meshDocPartMetadataCanShrink(priorDoc?.storedRangeCount, priorPartCount, parts.length, options.allowPartShrink === true)) {
    console.error(`[meshdoc] REFUSING SAVE for ${dir}: durable document has ${Math.max(priorDoc?.storedRangeCount ?? 0, priorPartCount)} part(s), but the live outliner has ${parts.length} and no explicit Delete/Merge authorization`);
    return false;
  }
  // Save gate (req_3049/req_3226): writing fewer host ranges than outliner parts
  // destroys the only durable part-boundary table. Never replace a recoverable old
  // document with that degraded state. Geometry can still be saved once the host is
  // re-seeded; until then the caller gets a loud failure and the old blob stays intact.
  {
    const hostPartRanges = (): { lo: number; hi: number }[] => {
      try {
        const o = JSON.parse(host.__mesh_part_ranges?.() ?? 'null');
        if (!o?.ok || !Array.isArray(o.ranges)) return [];
        const ranges = o.ranges.map((pair: unknown) => {
          if (!Array.isArray(pair) || pair.length !== 2) return null;
          const [lo, hi] = pair;
          return typeof lo === 'number' && typeof hi === 'number' &&
            Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && hi > lo ? { lo, hi } : null;
        });
        if (ranges.some((range: unknown) => range === null)) return [];
        const valid = ranges as { lo: number; hi: number }[];
        for (let index = 1; index < valid.length; index += 1) {
          if (valid[index]!.lo < valid[index - 1]!.hi) return [];
        }
        return valid;
      } catch { return []; }
    };
    let hostRanges = hostPartRanges();
    // A topology op used to clear the host mirror while the outliner retained its
    // complete host-stamped ranges. Restore only that validated live truth; otherwise
    // the refusal below preserves the previous document for explicit recovery.
    if (hostRanges.length !== parts.length && recoveryRanges?.length === parts.length) {
      const pairs = new Uint32Array(recoveryRanges.length * 2);
      recoveryRanges.forEach((range, index) => {
        pairs[index * 2] = range.lo;
        pairs[index * 2 + 1] = range.hi;
      });
      host.__mesh_set_part_ranges?.(pairs);
      hostRanges = hostPartRanges();
    }
    if (hostRanges.length !== parts.length) {
      console.error(`[meshdoc] REFUSING SAVE for ${dir}: host has ${hostRanges.length} part range(s) while the outliner declares ${parts.length} (${parts.map((p) => p.name).join(', ')}) — preserving the previous document instead of persisting merged parts (req_3049/req_3226/req_3234)`);
      return false;
    }

    // The expected count crosses as a scalar only. The host re-validates it at the
    // write boundary and atomically renames a complete fsynced RJMD over doc.blob;
    // resident geometry never crosses the JS bridge.
    if (host.__model_meshdoc_write?.(`${dir}/${DOC_BLOB}`, parts.length) !== 1) return false;
  }

  // doc.blob commits first. If the second atomic write fails, the old metadata remains
  // paired by rank as far as it goes; geometry can never collapse to a one-range file.
  const metadata = textBytes(JSON.stringify({ version: 1, parts }, null, 2));
  const ok = writeFileBytesAtomic(`${dir}/${PARTS_META}`, metadata);
  invalidateMeshDoc(dir);
  return ok;
}

/** The package's saved model document, or null (never saved with a meshdoc AND no
 *  legacy blob). Prefers doc.blob; falls back to legacy base.blob as one part. */
export function readMeshDoc(dir: string): PackageMeshDoc | null {
  if (docCache.has(dir)) return docCache.get(dir)!;
  const doc = parseDocBlob(dir) ?? parseLegacyBlob(dir);
  if (doc?.storedRangeCount === 0) {
    const partCount = readMeshDocParts(dir)?.length ?? 0;
    const recovered = inferMeshDocPartRanges(doc, partCount);
    if (recovered) {
      doc.ranges = recovered;
      doc.recoveredPartRanges = true;
      console.warn(`[meshdoc] recovered ${recovered.length} missing part ranges for ${dir} from exact contiguous connectivity runs; the next Save will persist them`);
    }
  }
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
  return { vertices, faceGroups, ranges, glassFirstVertex, storedRangeCount: rangeCount };
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

/** Recover a missing range table only when the saved authored-group sequence splits
 * into exactly the number of contiguous edge-connectivity runs declared by parts.json.
 * This recovers documents whose range header was cleared while refusing ambiguous
 * multi-shell parts (run count mismatch). No spatial tolerance or primitive guessing. */
export function inferMeshDocPartRanges(doc: Pick<PackageMeshDoc, 'vertices' | 'faceGroups'>, partCount: number): { lo: number; hi: number }[] | null {
  const groups = doc.faceGroups;
  const triangleCount = Math.floor(doc.vertices.length / 24);
  if (!groups || groups.length !== triangleCount || triangleCount === 0 || partCount < 2) return null;

  const parent = new Int32Array(triangleCount);
  for (let i = 0; i < triangleCount; i += 1) parent[i] = i;
  const root = (input: number): number => {
    let current = input;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]!]!;
      current = parent[current]!;
    }
    return current;
  };
  const union = (a: number, b: number) => {
    const ar = root(a), br = root(b);
    if (ar !== br) parent[br] = ar;
  };
  const vertexKey = (triangle: number, corner: number): string => {
    const at = (triangle * 3 + corner) * 8;
    const x = doc.vertices[at] || 0, y = doc.vertices[at + 1] || 0, z = doc.vertices[at + 2] || 0;
    return `${x},${y},${z}`;
  };
  const groupFirst = new Map<number, number>();
  const edgeFirst = new Map<string, number>();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const group = groups[triangle]!;
    const sameGroup = groupFirst.get(group);
    if (sameGroup == null) groupFirst.set(group, triangle);
    else union(triangle, sameGroup);
    const vertices = [vertexKey(triangle, 0), vertexKey(triangle, 1), vertexKey(triangle, 2)];
    for (let corner = 0; corner < 3; corner += 1) {
      const a = vertices[corner]!, b = vertices[(corner + 1) % 3]!;
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      const adjacent = edgeFirst.get(edge);
      if (adjacent == null) edgeFirst.set(edge, triangle);
      else union(triangle, adjacent);
    }
  }

  const usedGroups = [...groupFirst.keys()].sort((a, b) => a - b);
  if (usedGroups.length === 0) return null;
  const runs: { lo: number; hi: number }[] = [];
  let lo = usedGroups[0]!;
  let previous = lo;
  let previousRoot = root(groupFirst.get(lo)!);
  for (const group of usedGroups.slice(1)) {
    const currentRoot = root(groupFirst.get(group)!);
    if (group !== previous + 1 || currentRoot !== previousRoot) {
      runs.push({ lo, hi: previous + 1 });
      lo = group;
    }
    previous = group;
    previousRoot = currentRoot;
  }
  runs.push({ lo, hi: previous + 1 });
  return runs.length === partCount ? runs : null;
}

/** Rank-order live outliner rows into meshdoc part metadata (ascending lo — the same
 *  order the host reports ranges in). */
export function partsMetaFromRows(rows: readonly { name: string; color: string; visible: boolean; kind?: string; groupId?: string; groupName?: string; groupPath?: { id: string; name: string }[]; outlinerOrder?: number; lo?: number }[]): MeshDocPartMeta[] {
  return rows
    .slice()
    .sort((a, b) => (a.lo ?? Number.MAX_SAFE_INTEGER) - (b.lo ?? Number.MAX_SAFE_INTEGER))
    .map((p, rangeRank) => ({
      name: p.name,
      color: p.color,
      visible: p.visible,
      kind: p.kind,
      groupId: p.groupId,
      groupName: p.groupName,
      groupPath: p.groupPath,
      outlinerOrder: p.outlinerOrder ?? rangeRank,
    }));
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
