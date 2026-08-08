// editor/data/meshDoc.ts — the model DOCUMENT blob inside a Model Package (req_2753).
//
// The disease this cures: a studio-authored model's edits live in the HOST resident
// mesh; parts are metadata + a group range. Save used to write only mesh/base.blob
// (bare verts, no reader) and a manifest that still claimed the primitive SEED — so a
// doc switch rebuilt the seed (edits gone from view) and a restart re-armed the
// primitive generator (cube, no outliner). The meshdoc is the durable, READABLE form:
//
//   mesh/doc.blob    RJMD v5 — verts + authored face groups + stable per-face texture
//                    roles + semantic region/instance membership, its name table, and
//                    stable range/object IDs + welded logical-corner ids + trailing glass
//                    boundary (v1-v4 readable for non-character props),
//                    written by the host door __model_meshdoc_write (the format's twin
//                    lives in framework/v8_bindings_core.zig hostModelMeshdocWrite).
//   mesh/parts.json  v2 range-ranked METADATA with stable object ids. Rank locates the
//                    geometry range only; object identity survives rename/reorder/hide.
//   mesh/retopo-guide.blob  versioned teaching bands + the frozen original triangle
//                    soup used for cold-restart ghost comparison. It is authored
//                    package data but deliberately not part of runtime mesh geometry.
//
// Legacy packages (pre-meshdoc saves, e.g. sign_p) carry only mesh/base.blob: readable
// as ONE part with identity face groups — the edits recover, the part split doesn't.
//
// Every function here takes the package's resolved on-disk home (`dir`) — resolution
// stays in modelPackageStore (this module must not import it: the store's
// writeModelArtifacts calls down into this writer).
import { exists, readFile, readFileBase64, remove, writeFileBase64Atomic, writeFileBytesAtomic } from '../../../runtime/hooks/fs';
import { base64ToBytes, bytesText, textBytes } from '../../../runtime/workspace';
import {
  parseMeshSemanticTable,
  type MeshEdgeRegion,
  type MeshRangeObject,
  type MeshSemanticRegion,
  type MeshSemanticTable,
} from '../model/meshSemantics';

export type { MeshEdgeRegion, MeshRangeObject, MeshSemanticRegion, MeshSemanticTable } from '../model/meshSemantics';

const host = globalThis as any;

export type PackageMeshDoc = {
  /** Wire version when decoded from RJMD; absent for legacy bare-vertex blobs. */
  formatVersion?: 1 | 2 | 3 | 4 | 5;
  /** interleaved source verts, stride 8 (pos3/normal3/uv2) */
  vertices: Float32Array;
  /** one authored-group id per triangle, or null (plain soup — identity granularity) */
  faceGroups: Uint32Array | null;
  /** one texture-slot index per triangle; 0xffffffff keeps the painted atlas */
  faceMaterials?: Uint32Array | null;
  /** Durable semantic region and repeated-instance id per triangle (RJMD v4). */
  semanticRegions?: Uint32Array | null;
  semanticInstances?: Uint32Array | null;
  /** Versioned dictionary that turns numeric membership into names and provenance. */
  semanticTable?: MeshSemanticTable | null;
  /** Stable object ID for each persisted range in range order (RJMD v5 only). */
  rangeObjectIds?: string[] | null;
  /** RJMD v5 explicit welded topology. Legacy prop documents carry no table. */
  hasLogicalVertices?: boolean;
  logicalVertexCount?: number;
  renderCornerLogicalIds?: Uint32Array | null;
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

export type ResidentSemanticSaveState = {
  faces: number;
  unnamed: number;
  table: MeshSemanticTable;
};

/** Deep save postcondition: the blob must contain the same named-face count and
 * dictionary the resident editor reported. A successful geometry write is not a
 * successful model save when it silently drops rigging semantics. */
export function meshDocSemanticsMatch(
  resident: ResidentSemanticSaveState,
  doc: Pick<PackageMeshDoc, 'semanticRegions' | 'semanticInstances' | 'semanticTable'> | null,
): boolean {
  const namedFaces = Math.max(0, resident.faces - resident.unnamed);
  if (namedFaces === 0 && resident.table.regions.length === 0) {
    return !doc?.semanticRegions || Array.from(doc.semanticRegions).every((id) => id === 0xffffffff);
  }
  if (!doc?.semanticRegions || !doc.semanticInstances || !doc.semanticTable) return false;
  if (doc.semanticRegions.length !== resident.faces || doc.semanticInstances.length !== resident.faces) return false;
  if (Array.from(doc.semanticRegions).filter((id) => id !== 0xffffffff).length !== namedFaces) return false;
  const durable = new Map(doc.semanticTable.regions.map((region) => [region.id, region]));
  if (durable.size !== resident.table.regions.length) return false;
  return resident.table.regions.every((region) => {
    const saved = durable.get(region.id);
    return !!saved && saved.name === region.name && (saved.role ?? '') === (region.role ?? '') &&
      (saved.parent ?? null) === (region.parent ?? null);
  });
}

export function meshDocRangeObjectIdsMatch(
  doc: Pick<PackageMeshDoc, 'ranges' | 'rangeObjectIds'> | null,
  parts: readonly Pick<MeshDocPartMeta, 'objectId'>[],
): boolean {
  if (!doc?.rangeObjectIds || doc.rangeObjectIds.length !== doc.ranges.length || parts.length !== doc.ranges.length) return false;
  const expected = parts.map((part) => part.objectId);
  return expected.every((objectId, index) => typeof objectId === 'string' && objectId.length > 0 && doc.rangeObjectIds![index] === objectId) &&
    new Set(doc.rangeObjectIds).size === doc.rangeObjectIds.length;
}

/** True when saving would replace a named durable document with an anonymous mesh.
 *
 * This guard was written against a mesh that SILENTLY lost its names (a hydration or
 * mount drop), where saving cements the loss. Deliberately removing the last region
 * reaches the same zero by an entirely different road, and refusing that left the
 * user unable to save at all (req_3898) — the model could be emptied but never
 * committed. So emptying the table now needs the same one-shot capability a
 * destructive part-count change needs: minted by a real Remove action in the NAMES
 * pane, never by hydration or autosave. */
export function meshDocWouldEraseSemantics(
  resident: ResidentSemanticSaveState,
  prior: Pick<PackageMeshDoc, 'semanticRegions'> | null,
  explicitlyAuthorized = false,
): boolean {
  if (explicitlyAuthorized) return false;
  const residentNamedFaces = Math.max(0, resident.faces - resident.unnamed);
  const priorNamedFaces = Array.from(prior?.semanticRegions ?? []).filter((id) => id !== 0xffffffff).length;
  return residentNamedFaces === 0 && priorNamedFaces > 0;
}

/** Part metadata row, rank-ordered to match PackageMeshDoc.ranges. */
export type MeshDocPartMeta = {
  /** Stable outliner object identity (parts.json v2); independent of name and rank. */
  objectId?: string;
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
const characterArtifactCache = new Map<string, PackageMeshDoc | null>();

export function meshDocPartRangesComplete(partCount: number, hostRangeCount: number): boolean {
  return partCount > 0 && hostRangeCount === partCount;
}

/** The part-count authority used by the destructive-save guard. A real range
 * table belongs to doc.blob and wins over its fallible metadata sidecar;
 * rangeless legacy documents have only the sidecar to describe their parts. */
export function meshDocDurablePartCount(storedRangeCount: number | undefined, savedPartCount: number): number {
  return (storedRangeCount ?? 0) >= 1 ? storedRangeCount! : savedPartCount;
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
  //
  // The BOUNDARY truth is doc.blob's own range table (req_3405): the two-file
  // transaction can tear — an authorized merge landed doc.blob's collapsed
  // ranges but the app died before parts.json followed — and taking
  // max(docRanges, sidecarRows) let the STALE SIDECAR hold the document
  // hostage forever (the authorization ref does not survive a restart).
  // When the doc carries a real range table, matching ITS count destroys no
  // boundary — the save REPAIRS the sidecar. A rangeless legacy doc still
  // falls back to the sidecar's count as its only durable authority, so a
  // collapsed parts.json can never overwrite 15 saved names (the reverse tear).
  const durablePartCount = meshDocDurablePartCount(storedRangeCount, savedPartCount);
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

// A durable document that EXISTS but will not decode is NOT the same thing as "this
// package has no document". Every save guard below asks this module what was on disk
// before; answering "nothing was there" for a blob we merely failed to parse is what
// let one bad read overwrite a finished model — the quad pairing became identity
// groups, the name table went to zero, and meshDocWouldEraseSemantics saw an empty
// prior and waved the save through (req_3740). Track the third state explicitly.
const unreadableDocs = new Set<string>();

/** True when `dir` has a doc.blob on disk that could not be decoded. Callers must
 *  REFUSE to write rather than treat it as an absent document. */
export function meshDocIsUnreadable(dir: string): boolean {
  readMeshDoc(dir);
  return unreadableDocs.has(dir);
}

export function invalidateMeshDoc(dir: string): void {
  docCache.delete(dir);
  metaCache.delete(dir);
  unreadableDocs.delete(dir);
  for (const path of characterArtifactCache.keys()) {
    if (path.startsWith(`${dir}/`)) characterArtifactCache.delete(path);
  }
}

/** Cold-open one manifest-declared immutable character geometry artifact. Character
 * packages never fall back to mesh/doc.blob: an absent, malformed, or non-v5 target
 * remains visibly unreadable/unbound instead of entering the prop compatibility path. */
export function readCharacterMeshDoc(dir: string, geometryPath: string | undefined): PackageMeshDoc | null {
  if (!/^mesh\/character-[0-9a-f]{64}\.rjmd$/i.test(geometryPath ?? '')) return null;
  const path = `${dir}/${geometryPath}`;
  if (characterArtifactCache.has(path)) return characterArtifactCache.get(path)!;
  let doc: PackageMeshDoc | null = null;
  if (exists(path)) {
    const base64 = readFileBase64(path);
    if (base64) {
      try { doc = parseMeshDocBytes(base64ToBytes(base64)); }
      catch { doc = null; }
    }
  }
  if (doc?.formatVersion !== 5 || doc.hasLogicalVertices !== true || !doc.renderCornerLogicalIds ||
      !doc.rangeObjectIds || doc.rangeObjectIds.length !== doc.ranges.length) doc = null;
  characterArtifactCache.set(path, doc);
  return doc;
}

/** Transactionally write the resident host model and its exact Outliner/range table.
 * The staged host blob is validated before either durable file is replaced. */
export function writeMeshDoc(
  dir: string,
  parts: MeshDocPartMeta[],
  recoveryRanges?: { lo: number; hi: number }[],
  options: { allowPartShrink?: boolean; allowSemanticClear?: boolean } = {},
): boolean {
  // The editable document is a two-file transaction. No metadata-less caller is
  // admitted here; paint-only persistence must leave doc.blob + parts.json alone.
  if (parts.length === 0) {
    console.error(`[meshdoc] REFUSING SAVE for ${dir}: an editable mesh document needs at least one named part`);
    return false;
  }
  const objectIds = parts.map((part) => part.objectId).filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (objectIds.length > 0 && (objectIds.length !== parts.length || new Set(objectIds).size !== objectIds.length)) {
    console.error(`[meshdoc] REFUSING SAVE for ${dir}: parts.json v2 requires one unique stable objectId per part`);
    return false;
  }
  const priorDoc = readMeshDoc(dir);
  // Every gate below asks priorDoc what the durable model already had. A doc.blob that
  // exists but would not decode reads as `null` here, which those gates cannot tell
  // apart from "brand new package" — so they would all pass and the write would land on
  // top of a real model nobody could read (req_3740). An undecodable document is the one
  // case where the only safe move is to touch nothing.
  if (meshDocIsUnreadable(dir)) {
    console.error(`[meshdoc] REFUSING SAVE for ${dir}: ${DOC_BLOB} exists but could not be decoded, so the durable model's parts, quad grouping and name table are unknown. Saving now would overwrite it with whatever the host currently holds. Fix or move the blob first.`);
    return false;
  }
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
    const docPath = `${dir}/${DOC_BLOB}`;
    const priorBlob = readFileBase64(docPath);
    let residentSemantics: ResidentSemanticSaveState | null = null;
    try {
      const raw = host.__mesh_semantic_state?.();
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
      if (Number.isInteger(parsed?.faces) && Number.isInteger(parsed?.unnamed) && parsed?.table?.version === 1 && Array.isArray(parsed.table.regions)) {
        residentSemantics = parsed as ResidentSemanticSaveState;
      }
    } catch { /* old host: the native write result remains the compatibility boundary */ }
    if (residentSemantics && meshDocWouldEraseSemantics(residentSemantics, priorDoc, options.allowSemanticClear === true)) {
      console.error(`[meshdoc] REFUSING SAVE for ${dir}: resident mesh is anonymous but the durable document still has named faces, and no explicit Remove authorized clearing them`);
      return false;
    }
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
    if (host.__model_meshdoc_write?.(docPath, parts.length, JSON.stringify(objectIds)) !== 1) return false;
    invalidateMeshDoc(dir);
    const writtenDoc = parseDocBlob(dir);
    const semanticsDropped = residentSemantics && !meshDocSemanticsMatch(residentSemantics, writtenDoc);
    const rangeObjectsDropped = writtenDoc?.formatVersion === 5 && !meshDocRangeObjectIdsMatch(writtenDoc, parts);
    if (semanticsDropped || rangeObjectsDropped) {
      // A mixed-version dev session can run a new TS bundle against an older native
      // writer. Restore the exact prior blob instead of accepting geometry-only or
      // range-identity-less success.
      const restored = priorBlob !== null
        ? writeFileBase64Atomic(docPath, priorBlob)
        : remove(docPath);
      invalidateMeshDoc(dir);
      const dropped = [semanticsDropped ? 'resident semantic names' : '', rangeObjectsDropped ? 'stable range object ids' : ''].filter(Boolean).join(' and ');
      console.error(`[meshdoc] REFUSING SAVE for ${dir}: native writer dropped ${dropped}${restored ? '; prior document restored' : '; prior document recovery failed'}`);
      return false;
    }
  }

  // doc.blob commits first. If the second atomic write fails, the old metadata remains
  // paired by rank as far as it goes; geometry can never collapse to a one-range file.
  const metadataVersion = objectIds.length === parts.length ? 2 : 1;
  const metadata = textBytes(JSON.stringify({ version: metadataVersion, parts }, null, 2));
  const ok = writeFileBytesAtomic(`${dir}/${PARTS_META}`, metadata);
  invalidateMeshDoc(dir);
  return ok;
}

/** The package's saved model document, or null (never saved with a meshdoc AND no
 *  legacy blob, OR a doc.blob that exists but will not decode — see
 *  meshDocIsUnreadable, which separates those two very different nulls).
 *
 *  The legacy base.blob path is reachable ONLY when doc.blob is absent. base.blob is
 *  rewritten on every save and carries no authored structure, so reading it as a
 *  substitute for a present-but-unparseable document hands back identity face groups
 *  (every triangle its own authored face) and no semantics — and the caller then
 *  persists that over the real document. Never fall back onto a document that exists. */
export function readMeshDoc(dir: string): PackageMeshDoc | null {
  if (docCache.has(dir)) return docCache.get(dir)!;
  const docExists = exists(`${dir}/${DOC_BLOB}`);
  const doc = parseDocBlob(dir) ?? (docExists ? null : parseLegacyBlob(dir));
  if (docExists && !doc) {
    unreadableDocs.add(dir);
    console.error(`[meshdoc] ${dir}/${DOC_BLOB} EXISTS but failed to decode — NOT rebuilding it from ${LEGACY_BLOB}. That fallback would return identity face groups (every quad split into loose triangles) and an empty name table, and the next Save would make it durable. Saves for this package are refused until the document reads.`);
  } else {
    unreadableDocs.delete(dir);
  }
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
      if ((o?.version === 1 || o?.version === 2) && Array.isArray(o.parts)) {
        const rows = o.parts as MeshDocPartMeta[];
        if (rows.every((p) => typeof p?.name === 'string')) {
          if (o.version === 1) {
            parts = rows;
          } else {
            const ids = rows.map((p) => p.objectId);
            if (ids.every((id): id is string => typeof id === 'string' && id.length > 0) && new Set(ids).size === ids.length) parts = rows;
          }
        }
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
  if (magic !== RJMD_MAGIC || (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5) || vertCount === 0) return null;
  const headerBytes = version >= 5 ? 48 : version >= 4 ? 40 : version >= 3 ? 32 : version >= 2 ? 28 : 24;
  if (bytes.length < headerBytes) return null;
  const glassFirstVertex = version >= 2 ? new Uint32Array(buf, 24, 1)[0]! : null;
  const hasMaterials = version >= 3 ? new Uint32Array(buf, 28, 1)[0]! : 0;
  const hasSemantics = version >= 4 ? new Uint32Array(buf, 32, 1)[0]! : 0;
  const semanticJsonBytes = version >= 4 ? new Uint32Array(buf, 36, 1)[0]! : 0;
  const hasLogicalVertices = version >= 5 ? new Uint32Array(buf, 40, 1)[0]! : 0;
  const logicalVertexCount = version >= 5 ? new Uint32Array(buf, 44, 1)[0]! : 0;
  if (hasMaterials !== 0 && hasMaterials !== 1) return null;
  if (hasGroups !== 0 && hasGroups !== 1) return null;
  if (hasSemantics !== 0 && hasSemantics !== 1) return null;
  if (hasLogicalVertices !== 0 && hasLogicalVertices !== 1) return null;
  if (hasSemantics === 0 && semanticJsonBytes !== 0) return null;
  if ((hasLogicalVertices === 0 && logicalVertexCount !== 0) ||
    (hasLogicalVertices === 1 && (logicalVertexCount === 0 || logicalVertexCount > vertCount))) return null;
  if (faceCount !== Math.floor(vertCount / 3)) return null;
  if (glassFirstVertex !== null && (glassFirstVertex > vertCount || glassFirstVertex % 3 !== 0)) return null;
  const need = headerBytes + vertCount * 8 * 4 + (hasGroups ? faceCount * 4 : 0) + (hasMaterials ? faceCount * 4 : 0) + (hasSemantics ? faceCount * 8 : 0) + rangeCount * 8 + (hasLogicalVertices ? vertCount * 4 : 0) + semanticJsonBytes;
  if (bytes.length < need) return null;
  let at = headerBytes;
  const vertices = new Float32Array(buf, at, vertCount * 8);
  at += vertCount * 8 * 4;
  let faceGroups: Uint32Array | null = null;
  if (hasGroups) {
    faceGroups = new Uint32Array(buf, at, faceCount);
    at += faceCount * 4;
  }
  let faceMaterials: Uint32Array | null = null;
  if (hasMaterials) {
    faceMaterials = new Uint32Array(buf, at, faceCount);
    at += faceCount * 4;
  }
  let semanticRegions: Uint32Array | null = null;
  let semanticInstances: Uint32Array | null = null;
  if (hasSemantics) {
    semanticRegions = new Uint32Array(buf, at, faceCount);
    at += faceCount * 4;
    semanticInstances = new Uint32Array(buf, at, faceCount);
    at += faceCount * 4;
  }
  const ranges: { lo: number; hi: number }[] = [];
  if (rangeCount > 0) {
    const pairs = new Uint32Array(buf, at, rangeCount * 2);
    for (let i = 0; i < rangeCount; i += 1) ranges.push({ lo: pairs[i * 2]!, hi: pairs[i * 2 + 1]! });
    at += rangeCount * 8;
  }
  let renderCornerLogicalIds: Uint32Array | null = null;
  if (hasLogicalVertices) {
    renderCornerLogicalIds = new Uint32Array(buf, at, vertCount);
    at += vertCount * 4;
    if (!meshDocLogicalTopologyValid(vertices, renderCornerLogicalIds, logicalVertexCount)) return null;
  }
  let semanticTable: MeshSemanticTable | null = null;
  let rangeObjectIds: string[] | null = null;
  if (hasSemantics) {
    if (semanticJsonBytes === 0) return null;
    try {
      const parsed = JSON.parse(bytesText(bytes.subarray(at, at + semanticJsonBytes)));
      const table = parseMeshSemanticTable(parsed);
      if (!table) return null;
      const regions = table.regions;
      const ids = new Set(regions.map((region) => region.id));
      for (const region of semanticRegions ?? []) if (region !== 0xffffffff && !ids.has(region)) return null;
      if (table.edgeRegions?.some((region: MeshEdgeRegion) =>
        !hasLogicalVertices || region.vertices.some((vertex) => vertex >= logicalVertexCount))) return null;
      let rangeObjects: MeshRangeObject[] | undefined;
      if (version === 5 && table.rangeObjects !== undefined) {
        if (table.rangeObjects.length !== ranges.length) return null;
        rangeObjects = table.rangeObjects.map((row, index) => {
          const range = ranges[index];
          if (row.lo !== range?.lo || row.hi !== range?.hi) return null;
          return row;
        }).filter((row: MeshRangeObject | null): row is MeshRangeObject => row !== null);
        if (rangeObjects.length !== ranges.length || new Set(rangeObjects.map((row) => row.objectId)).size !== rangeObjects.length) return null;
        rangeObjectIds = rangeObjects.map((row) => row.objectId);
      }
      semanticTable = { ...table, ...(rangeObjects ? { rangeObjects } : {}) };
    } catch { return null; }
  }
  if (ranges.length === 0) ranges.push({ lo: 0, hi: groupSpanEnd(faceGroups, faceCount) });
  return {
    formatVersion: version,
    vertices,
    faceGroups,
    faceMaterials,
    semanticRegions,
    semanticInstances,
    semanticTable,
    rangeObjectIds,
    hasLogicalVertices: hasLogicalVertices === 1,
    logicalVertexCount,
    renderCornerLogicalIds,
    ranges,
    glassFirstVertex,
    storedRangeCount: rangeCount,
  };
}

/** RJMD v5 topology invariant shared by the decoder and focused format tests. */
export function meshDocLogicalTopologyValid(
  vertices: Float32Array,
  renderCornerLogicalIds: Uint32Array,
  logicalVertexCount: number,
): boolean {
  const renderCornerCount = Math.floor(vertices.length / 8);
  if (!Number.isInteger(logicalVertexCount) || logicalVertexCount <= 0 || logicalVertexCount > renderCornerCount ||
    renderCornerLogicalIds.length !== renderCornerCount) return false;
  const seen = new Uint8Array(logicalVertexCount);
  const first = new Float64Array(logicalVertexCount * 3);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < renderCornerCount; corner += 1) {
    const id = renderCornerLogicalIds[corner]!;
    if (id >= logicalVertexCount) return false;
    const at = corner * 8;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = vertices[at + axis]!;
      if (!Number.isFinite(value)) return false;
      min[axis] = Math.min(min[axis]!, value);
      max[axis] = Math.max(max[axis]!, value);
    }
  }
  const diagonal = Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
  const tolerance = 1e-6 * Math.max(1, diagonal);
  const toleranceSquared = tolerance * tolerance;
  for (let corner = 0; corner < renderCornerCount; corner += 1) {
    const id = renderCornerLogicalIds[corner]!;
    const at = corner * 8, firstAt = id * 3;
    if (!seen[id]) {
      seen[id] = 1;
      first[firstAt] = vertices[at]!;
      first[firstAt + 1] = vertices[at + 1]!;
      first[firstAt + 2] = vertices[at + 2]!;
      continue;
    }
    const dx = vertices[at]! - first[firstAt]!;
    const dy = vertices[at + 1]! - first[firstAt + 1]!;
    const dz = vertices[at + 2]! - first[firstAt + 2]!;
    if (dx * dx + dy * dy + dz * dz > toleranceSquared) return false;
  }
  return seen.every((value) => value === 1);
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
  return { vertices, faceGroups, faceMaterials: null, ranges: [{ lo: 0, hi: faceCount }] };
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
export function inferMeshDocPartRanges(doc: Pick<PackageMeshDoc, 'vertices' | 'faceGroups' | 'renderCornerLogicalIds'>, partCount: number): { lo: number; hi: number }[] | null {
  const runs = meshDocConnectivityRuns(doc);
  return runs.length === partCount ? runs : null;
}

/** Exact contiguous authored-group runs split by triangle edge-connectivity.
 *  Unlike inferMeshDocPartRanges, this returns the evidence even when a single
 *  semantic part has multiple shells (a five-finger part is the motivating
 *  case). Character staging can then regroup those runs against exported bone
 *  centers without inventing mesh boundaries. */
export function meshDocConnectivityRuns(doc: Pick<PackageMeshDoc, 'vertices' | 'faceGroups' | 'renderCornerLogicalIds'>): { lo: number; hi: number }[] {
  const groups = doc.faceGroups;
  const triangleCount = Math.floor(doc.vertices.length / 24);
  if (!groups || groups.length !== triangleCount || triangleCount === 0) return [];

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
    const logicalId = doc.renderCornerLogicalIds?.[triangle * 3 + corner];
    if (logicalId !== undefined) return `logical:${logicalId}`;
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
  return runs;
}

/** Rank-order live outliner rows into meshdoc part metadata (ascending lo — the same
 *  order the host reports ranges in). */
export function partsMetaFromRows(rows: readonly { id?: string; objectId?: string; name: string; color: string; visible: boolean; kind?: string; groupId?: string; groupName?: string; groupPath?: { id: string; name: string }[]; outlinerOrder?: number; lo?: number }[]): MeshDocPartMeta[] {
  return rows
    .slice()
    .sort((a, b) => (a.lo ?? Number.MAX_SAFE_INTEGER) - (b.lo ?? Number.MAX_SAFE_INTEGER))
    .map((p, rangeRank) => ({
      objectId: p.objectId ?? p.id,
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

/** Pair rank-ordered saved visibility with the host's rank-ordered range table.
 * The caller loads the complete geometry first, then applies only these hide ops. */
export function meshDocHiddenRanges(
  ranges: readonly { lo: number; hi: number }[],
  rankedRows: readonly { visible: boolean }[],
): { lo: number; hi: number }[] {
  return ranges.filter((_, rank) => rankedRows[rank]?.visible === false);
}

/** Extract one package part as standalone appendable geometry. Face-group ids
 * are normalized to a compact zero-based span so the receiving model can assign
 * its own durable range without inheriting ids from the source package. */
export function meshDocRangeGeometry(
  doc: PackageMeshDoc,
  rangeIndex: number,
): { positions: Float32Array; faceGroups: Uint32Array } {
  const range = doc.ranges[rangeIndex];
  if (!range) return { positions: new Float32Array(0), faceGroups: new Uint32Array(0) };
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
  return { positions: new Float32Array(vertices), faceGroups: new Uint32Array(faceGroups) };
}

/** pos3 / normal3 / uv2 — the interleaved source-vertex stride every RJMD carries.
 *  Named because readers outside this module compute counts from it (req_4052); the
 *  bare 8s above predate the constant and are left where they read as local math. */
export const MESHDOC_VERTEX_STRIDE = 8;

/** World bounds of a saved document, as min x,y,z then max x,y,z — the same order the
 *  Agent Seat percept's region bboxes use, so saved and resident extents compare
 *  directly instead of through an agent's own transcription. */
export function meshDocBounds(
  doc: Pick<PackageMeshDoc, 'vertices'>,
): [number, number, number, number, number, number] | null {
  const count = Math.floor(doc.vertices.length / MESHDOC_VERTEX_STRIDE);
  if (count === 0) return null;
  const bounds: [number, number, number, number, number, number] = [
    Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity,
  ];
  for (let vertex = 0; vertex < count; vertex += 1) {
    const at = vertex * MESHDOC_VERTEX_STRIDE;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = doc.vertices[at + axis]!;
      if (!Number.isFinite(value)) return null;
      if (value < bounds[axis]!) bounds[axis] = value;
      if (value > bounds[axis + 3]!) bounds[axis + 3] = value;
    }
  }
  return bounds;
}
