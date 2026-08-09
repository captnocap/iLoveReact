# Contract — Three-plane comparison v1

## Plane identity

```ts
type PlaneIdentity =
  | { source: 'resident'; modelId: string; sessionToken: string; generation: number;
      identityQuality: 'exact' | 'degraded'; objectNamespaceHash: string;
      recoveryDegradations: RecoveryDegradationV1[] }
  | { source: 'saved'; modelId: string; path: string; sha256: string; formatVersion: number;
      identityQuality: 'exact' | 'degraded'; objectNamespaceHash: string;
      recoveryDegradations: RecoveryDegradationV1[] }
  | { source: 'preview'; modelId: string; revision: string; previewToken: string;
      sha256: string; formatVersion: number; identityQuality: 'exact' | 'degraded';
      objectNamespaceHash: string; recoveryDegradations: RecoveryDegradationV1[] }
```

The degradation schema is shared with the face-table and Lore contracts. Exact requires an
empty list. Diff preserves both lists even when correspondence is impossible, so a sanitized
channel cannot disappear behind an `incomparable` summary.

Derived diagnostics belong to one of those concrete topology planes. They are never a third
copy of mesh geometry.

## Face join

Pairing is deterministic and two-stage:

1. Pair `(objectId, authoredGroup)` only when both addresses declare `stability:'stable'`.
2. Among unmatched stable rows, pair a connectivity fingerprint only when that fingerprint
   is unique on both sides. This produces `presence:'relocated'`, retains both addresses,
   and reports `object_membership`.

Ambiguous fingerprint matches remain separate resident-only/saved-only rows. Artifact-rank
addresses emit `incomparable` with the missing durable-object-ID reason.

```ts
type FaceDiffRequestV1 = {
  version: 1
  source: 'diff'
  modelId: string
  sessionToken: string
  expectedGeneration: number
  geometryPath: string
  expectedSavedSha256: string
  sort: FaceTableRequestV1['sort']
  filters: FaceTableRequestV1['filters']
  cursor?: string
  limit?: number
}
```

`__mesh_face_table` accepts `FaceTableRequestV1 | FaceDiffRequestV1`; the response version
and `source` discriminator select `FaceTablePageV1` or `FaceDiffPageV1`. The diff request
never infers the saved artifact from an original import path.

```ts
type FaceDiffRowV1 = {
  address: AuthoredFaceRowV1['address']
  residentAddress?: AuthoredFaceRowV1['address']
  savedAddress?: AuthoredFaceRowV1['address']
  presence: 'both' | 'relocated' | 'resident_only' | 'saved_only' | 'incomparable'
  changedFields: Array<
    | 'connectivity'
    | 'object_membership'
    | 'positions'
    | 'normals'
    | 'uvs'
    | 'material'
    | 'semantic_region'
    | 'semantic_instance'
    | 'face_name'
    | 'semantic_region_name'
    | 'semantic_instance_name'
    | 'build_issue_provenance'
    | 'visibility'
    | 'render_class'
    | 'triangle_membership'
    | 'derived_metrics'
  >
  incomparableFields: Array<
    | 'connectivity'
    | 'positions'
    | 'normals'
    | 'uvs'
    | 'triangle_membership'
  >
  deltas?: {
    maxPositionDelta?: number
    normalMismatchCorners?: number
    uvMismatchCorners?: number
  }
  resident?: AuthoredFaceRowV1
  saved?: AuthoredFaceRowV1
  reason?: string
}
```

Connectivity fingerprint is the ordered logical-vertex cycle canonicalized for cyclic
rotation while retaining winding after the logical-correspondence resolver from
`FACE_TABLE_V1` has produced a unique mapping. Its remap-independent candidate signature is
built from stable authored-face addresses, winding adjacency, and corner incidence; it
excludes the candidate face's own object membership so a unique relocation can be
recognized. Topology hashes still include object membership according to their canonical
contract. Triangle array rank, position, and a decoded artifact's unavailable encoder remap
are never join keys. Ambiguity is listed in `incomparableFields` rather than reported clean.

## Document summary

```ts
type FaceDiffPageV1 = {
  ok: true
  version: 1
  resident: PlaneIdentity
  saved: PlaneIdentity
  fingerprints: {
    topologyEqual: boolean
    semanticEqual: boolean
    objectBindingsEqual: boolean
    buildIssueProvenanceEqual: boolean
  }
  correspondence: {
    kind: 'artifact_identity' | 'encode_receipt' | 'incidence_signature' | 'incomparable'
    comparableLogicalVertices: number
    incomparableLogicalVertices: number
    reason?: string
  }
  query: FaceDiffRequestV1['sort'] & { filters: FaceDiffRequestV1['filters'] }
  totalRows: number
  matchedRows: number
  counts: {
    unchanged: number
    changed: number
    relocated: number
    residentOnly: number
    savedOnly: number
    incomparable: number
  }
  rows: FaceDiffRowV1[]
  cursor: string | null
  nextCursor: string | null
}
```

`counts` describes the complete unfiltered diff snapshot; `matchedRows` describes rows after
filters and before paging. For sort/filter purposes, `displayRow = resident ?? saved`.
`both` and `relocated` therefore use resident facts, saved-only uses saved facts, and
resident-only uses resident facts. A filter matches `displayRow` only; changed-field and
presence filters, when added by a future contract version, must be separate kinds. Null sort
values follow the face-table rule (after finite ascending, before finite descending), and
`presence,address` are the final deterministic tie-breakers. Cursor identity includes both
plane identities, correspondence kind, query, and generation/artifact SHAs.

## Selection

- `both`/`relocated`/`resident_only`: row selects `residentAddress` or the primary address.
- `saved_only`: row selects isolated saved-preview address.
- `incomparable`: row changes no selection and displays its reason.

## Save acceptance

A Save, restore, or guarded field transaction cannot report full recovery success when the
post-write saved plane differs from the resident plane in connectivity, positions, normals,
UVs, material, semantic identity, durable face/semantic labels, unresolved build-issue
provenance, visibility, render class, or object membership. All transactions require the
exact bytes written by the resident encoder to hash equal to package readback; restore/field
edit additionally require resident SHA = target candidate SHA = saved SHA. Editor-only
Outliner/material display labels outside RJMD are disclosed as outside this artifact diff.
Position deltas use the explicit cross-plane correspondence above; normal/UV deltas use
uniquely paired render-corner membership. A required field with no unique correspondence is
listed as incomparable and prevents a clean Save/restore/field-edit receipt. The diff returns
counts/maxima, not geometry arrays.

Exact equality of the owned encoder/candidate/readback SHA is byte identity and therefore a
constant-time proof that every persisted full-diff field is equal; transactions record that
proof without rerunning interactive analysis. When bytes differ, the transaction fails and
rolls back first, then may schedule worker diff for diagnosis. Interactive resident/saved/
preview diff always uses the pending/worker contract in `FACE_TABLE_V1`.
