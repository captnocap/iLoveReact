# Contract — Face Table v1

## Resident object-ID publication

Scene3D cannot infer durable Outliner IDs from numeric part rank. On initial adoption,
AppFrame/ModelView publishes one session-scoped table before the resident becomes inspectable:

```ts
type SessionObjectIdPublicationV1 = {
  version: 1
  modelId: string
  sessionToken: string
  expectedGeneration: number
  ranges: Array<{ rank: number; objectId: string }>
}
```

Native validation requires unique nonempty object IDs and exact coverage of resident ranges.
Native owns the accepted copy with the resident mesh; range reorder/binding mutations update
IDs in the same journal transaction and generation, while display-name changes do nothing.
Face table, full diff, and strict ordinary Save refuse `object_ids_unpublished` rather than
inventing rank IDs for a current resident. Panic recovery capture is deliberately outside
that strict gate: it preserves published IDs when valid, otherwise commits a readable
recovery envelope with deterministic persisted `@recovery/<model-id-hash>/<range-ordinal>`
object IDs plus a typed object-ID degradation row. Any other recovered channel is reported
the same way. Cross-plane joins to a different object namespace remain incomparable, but
preview and restore of the artifact itself are byte-exact and keep all provenance visible.
Legacy decoded artifacts may likewise use explicit artifact-rank identity.

## Request

```ts
type FaceTableRequestV1 = {
  version: 1
  modelId: string
  source: 'resident' | 'saved' | 'preview'
  sessionToken?: string
  expectedGeneration?: number
  geometryPath?: string
  revision?: string
  previewToken?: string
  expectedSha256?: string
  sort: {
    column: 'address' | 'area' | 'centroidEdgeClearance' | 'minEdge' | 'maxEdge' |
      'aspect' | 'planarityDeviation' | 'triangleCount'
    direction: 'asc' | 'desc'
  }
  filters: Array<
    | { kind: 'malformed' }
    | { kind: 'degenerate' }
    | { kind: 'non_planar' }
    | { kind: 'concave' }
    | { kind: 'tiny'; maxArea?: number }
    | { kind: 'unnamed' }
    | { kind: 'intersecting' }
    | { kind: 'unreachable' }
    | { kind: 'operation_blocked'; operation: FaceOperation }
  >
  cursor?: string
  limit?: number
}
```

Resident requests require `sessionToken` and `expectedGeneration`. Saved requests require a
package-confined `geometryPath` plus `expectedSha256`; preview requests require both `previewToken` and
`expectedSha256`. The opaque Scene3D token is created from package-confined saved bytes or
an authorized Lore capability and never accepts a filesystem path. Limit defaults to 200;
an explicit value outside 1..500 returns `invalid_request` rather than being clamped.

`{kind:'unnamed'}` has one native meaning: `durableLabels.faceName == null`. It does not
inspect Outliner, material-slot, or other editor-only display names. Those names are joined
after the native page is complete, so letting them affect a native filter would make totals
and cursors dishonest.

## Response

```ts
type FaceTablePageV1 = {
  ok: true
  version: 1
  modelId: string
  source: 'resident' | 'saved' | 'preview'
  sessionToken?: string
  generation?: number
  identityQuality: 'exact' | 'degraded'
  objectNamespaceHash: string
  recoveryDegradations: RecoveryDegradationV1[]
  artifact?: {
    formatVersion: number
    sha256: string
    savedPath?: string       // saved source only; never present for preview
  }
  fingerprint: {
    topologyHash: string
    semanticHash: string
    objectBindingHash: string
    rowCount: number
  }
  query: FaceTableRequestV1['sort'] & { filters: FaceTableRequestV1['filters'] }
  totalRows: number
  matchedRows: number
  totalBuildIssues: number
  matchedBuildIssues: number
  cursor: string | null
  nextCursor: string | null
  audit: { computed: boolean; directions: number; overBudget: boolean }
  tuning: {
    areaDefinition: 'sum_of_lowered_member_triangle_areas'
    aspectDefinition: 'max_edge_over_twice_centroid_edge_clearance'
    tinyAreaDefault: number
    scaleEpsilon: number
    ownerCaptureBudgetUs: number
  }
  rows: AuthoredFaceRowV1[]
  buildIssues: FaceBuildIssueV1[]
}
```

`RecoveryDegradationV1` is the exact shared schema from `LORE_RECOVERY_UI_V1.md`, implemented
once in `runtime/model/recoveryArtifact.ts` and imported by both the face-table and Lore
clients. Resident analysis carries the provenance owned by its adopted document; it returns
`exact` plus an empty list only when no prior recovery degradation exists. Saved and preview
analysis reads persisted provenance from the RJMD semantic JSON and/or verified Lore
capability; disagreement is an invalid artifact, not a reason to erase either warning.

The opaque cursor identity hashes source/model/session+generation or artifact SHA, the
`identityQuality`, `objectNamespaceHash`, typed degradation list, and query. Any change to
that identity returns `stale_cursor`; a cursor can never cross an exact/degraded boundary or
two synthetic object namespaces.

`geometry.area` is the sum of the current lowered member-triangle areas for the authored
face. Perimeter and edge extrema use the ordered logical boundary.
`centroidEdgeClearance` is the canonical predicate's minimum distance from its face centroid
to a boundary edge line; it is not mislabeled as a mathematical polygon inradius.
Clearance/aspect are null when the canonical polygon-frame predicate cannot establish a valid
planar frame.

## Authored row

```ts
type AuthoredFaceRowV1 = {
  address: {
    objectId: string
    group: number
    stability: 'stable' | 'artifact_rank'
    artifactFaceOrdinal?: number
  }
  faceId: number              // generation-scoped, never durable
  triangleIds: number[]       // generation/artifact-scoped expandable children
  part: { rank: number; objectId: string }
  material: number
  semantic: { region: number; instance: number }
  durableLabels: {
    faceName: string | null
    semanticRegionName: string | null
    semanticInstanceName: string | null
  }
  visibility: 'visible' | 'hidden'
  renderClass: 'opaque' | 'glass'
  geometry: {
    cornerCount: number
    triangleCount: number
    area: number
    perimeter: number
    centroidEdgeClearance: number | null
    minEdge: number
    maxEdge: number
    aspect: number | null
    planarityDeviation: number | null
    convexity: 'convex' | 'concave' | 'indeterminate'
    degeneracy: Array<
      'repeated_vertex' | 'nonfinite_position' | 'short_edge' |
      'zero_normal' | 'zero_area_member' | 'too_few_corners'
    >
  }
  boundary: {
    status: 'closed' | 'degraded' | 'malformed' | 'unknown'
    issueCode?: string
  }
  audit: {
    computed: boolean
    intersecting: boolean | null
    intersectingTriangles: number
    unreachable: boolean | null
    unreachableTriangles: number
  }
  operations: Record<FaceOperation, OperationEligibility>
}
```

Display names are joined in one editor helper after the native response:

```ts
type DisplayFaceRow = AuthoredFaceRowV1 & {
  display: {
    faceName: string | null
    objectName: string | null
    materialName: string | null
    semanticName: string | null
  }
}

type DisplayFaceTablePageV1 = Omit<FaceTablePageV1, 'rows'> & {
  rows: DisplayFaceRow[]
}
```

`durableLabels` are the exact label channels persisted in RJMD semantic JSON and therefore
participate in full saved/resident field comparison. The editor-only `display` join adds
Outliner/material presentation that may live outside the RJMD artifact. Neither kind of name
participates in address equality, topology hash, or semantic-role hash.

AppFrame owns one `joinFaceTableDisplayNames` helper over the current semantic table, stable
object-ID metadata, and material slots. Both Blob Explorer and Agent Seat receive the same
`DisplayFaceTablePageV1`; neither performs another join or substitutes array rank.

Any version uses `stability:'stable'` only when its persisted `(objectId,group)` is unique in
that document and `group` is not the anonymous `NO_GROUP` sentinel. A v5 duplicate/anonymous
row, or readable v1–v4 prop without persisted object IDs, uses `stability:'artifact_rank'`
plus required `artifactFaceOrdinal` (`@rank/<rank>` supplies the legacy object ID). The
ordinal disambiguates rows inside one resident generation/decoded artifact but is never a
durable cross-plane join.

## Logical identity and cross-plane correspondence

Logical IDs are authoritative only inside their plane. Resident rows use session-stable
logical IDs; decoded RJMD v5 rows use the dense logical IDs actually stored in the artifact.
The encoder's `dense_to_stable_logical_ids` table is an in-memory `Snapshot` receipt and is
not present in a decoded `Document`, so a decoder must never claim it recovered that map.

Cross-plane diff obtains correspondence in this order:

1. `artifact_identity` when the resident was hydrated from the exact artifact SHA and its
   surviving origin IDs still name that artifact's dense IDs;
2. `encode_receipt` when the current comparison owns the exact resident encoder receipt for
   that encode invocation;
3. `incidence_signature` for older preview artifacts, using a unique remap-independent
   signature built from stable authored-face addresses, winding adjacency, and corner
   incidence on both planes.

An ambiguous/missing signature makes only the affected connectivity/position/corner fields
`incomparable`; it never substitutes array rank, positions, or a guessed dense ID. A cold
reopen of the current artifact uses `artifact_identity`, while normal Save acceptance uses
the exact current `encode_receipt`. It is not cached as durable state, serialized into RJMD,
or reconstructed later.

When either plane has `identityQuality:'degraded'`, stable-address/incidence correspondence is
allowed only if both planes share the exact recovery object-namespace fingerprint or artifact
lineage. Otherwise object/connectivity/position fields are incomparable even though the
synthetic IDs are well-formed persisted strings.

The visible `blockedBy` column is a presentation of every `blocked`, blocked context, and
`not_analyzed` entry in `operations`. It does not maintain a second refusal list.

## Build issue

```ts
type FaceBuildIssueV1 = {
  objectId: string
  sourceGroup: number
  sourceTriangles: number[]
  code:
    | 'duplicate_outgoing_boundary'
    | 'too_few_boundary_edges'
    | 'missing_boundary_continuation'
    | 'boundary_did_not_close'
    | 'mixed_material'
    | 'mixed_semantic'
  detail: string
  degradedToGroups: number[]
}
```

The indexed builder emits this issue while executing its own canonical boundary walk. The
table does not rediscover it later. The `malformed` filter applies to malformed/degraded
authored rows and to `buildIssues`; issue counts remain separate from authored-row counts.

## Operation matrix

```ts
type FaceOperation =
  | 'indexed_build'
  | 'loop_cut'
  | 'face_to_ngon'
  | 'bevel'
  | 'merge'
  | 'extrude'
  | 'solidify'

type OperationEligibility =
  | { status: 'allowed'; metrics?: Record<string, number>; contexts?: OperationContextEligibility[] }
  | { status: 'blocked'; code: string; detail: string; metrics?: Record<string, number>; contexts?: OperationContextEligibility[] }
  | { status: 'not_analyzed'; detail: string }

type OperationContextEligibility = {
  key: string
  status: 'allowed' | 'blocked'
  code?: string
  detail?: string
  metrics?: Record<string, number>
}
```

Parameterized operations enumerate the same discrete context used by their existing UI.
Loop cut reports each direction/seed context. Bevel calls the canonical
`bevelEligibility(targetKind,targetIndex)` for every incident logical edge, vertex, and
boundary target and includes the native maximum-width metric in each context.
An operation-level `allowed` means at least one listed context is allowed, not that every
parameter value succeeds. The visible `blockedBy` column includes blocked context rows.

Phase 1 requires canonical coverage for `indexed_build`, `loop_cut`, and
`face_to_ngon`/the currently instrumented bevel path. Merge, extrude, and solidify must
remain `not_analyzed` until their mutation owners expose structured noncommitting predicates
and agreement tests.

## Error response

```ts
type FaceTableErrorV1 =
  | {
      ok: false
      version: 1
      code:
        | 'no_resident_session'
        | 'object_ids_unpublished'
        | 'wrong_model'
        | 'stale_generation'
        | 'unreadable_saved_document'
        | 'unsupported_format'
        | 'audit_unavailable'
        | 'invalid_request'
        | 'stale_cursor'
        | 'address_not_in_query'
        | 'released_preview'
        | 'module_unavailable'
        | 'internal_error'
      detail: string
      currentGeneration?: number
    }
  | {
      ok: false
      version: 1
      code: 'analysis_pending'
      detail: string
      analysisId: string
      planeIdentityHash: string
      progress: number
      retryAfterMs: number
    }
```

`audit_unavailable` may be returned only when an audit-only filter makes a truthful page
impossible. Without such a filter, rows return with `audit.computed=false` and nullable
cells.

The first request for resident, saved, preview, or interactive diff copies/decodes one
immutable analysis input in its native owner, queues expensive face/audit/operation/diff work
to that owner's bounded worker, and returns `analysis_pending` immediately. Resident owner
copy is capped by the published tuning budget; workers never touch live session memory.
Completion is adopted only if the full plane identity still matches and is emitted through
`v8_bindings_mesh_inspect.tickDrain(host)` as `mesh-analysis-ready`. React subscribes once;
Agent Seat performs bounded out-of-process retries. No JavaScript frame loop polls and
`mesh_audit`/interactive full diff never run on the render thread.

```ts
type MeshAnalysisReadyV1 = {
  version: 1
  analysisId: string
  planeIdentityHash: string
  modelId: string
  source: 'resident' | 'saved' | 'preview' | 'diff'
  sessionToken?: string
  generation?: number
  artifactSha256?: string
  previewToken?: string
  status: 'ready' | 'failed'
  code?: string
  detail?: string
}
```

The pending receipt returns the exact `planeIdentityHash`. AppFrame refreshes only when
analysis ID, hash, model, source, token/generation, and artifact/preview identity match its
current request; model switches, replaced previews, and stale generations ignore the event.

The mesh-inspection binding maps ABI `released_capability` to the public,
domain-specific `released_preview`; `module_unavailable` passes through unchanged. Tests
cover both mappings so neither refusal is flattened to `internal_error`.

## Selection receipt

```ts
type FaceSelectRequestV1 = {
  version: 1
  modelId: string
  plane:
    | { source: 'resident'; sessionToken: string; expectedGeneration: number }
    | { source: 'preview'; previewToken: string; expectedSha256: string }
  target:
    | { kind: 'face'; address: AuthoredFaceRowV1['address'] }
    | { kind: 'build_issue'; objectId: string; sourceGroup: number }
  additive: boolean
  frame: boolean
}

type FaceSelectReceiptV1 = {
  ok: true
  version: 1
  plane:
    | { source: 'resident'; sessionToken: string; generation: number }
    | { source: 'preview'; previewToken: string; sha256: string }
  target: FaceSelectRequestV1['target']
  selectedTriangles: number
}
```

## Off-page address seek

Opaque cursors are forward paging capabilities, not searchable row identities. Viewport
selection uses a native seek so React never walks pages:

```ts
type FaceSeekRequestV1 = {
  version: 1
  modelId: string
  plane:
    | { source: 'resident'; sessionToken: string; expectedGeneration: number }
    | { source: 'preview'; previewToken: string; expectedSha256: string }
  address: AuthoredFaceRowV1['address']
  sort: FaceTableRequestV1['sort']
  filters: FaceTableRequestV1['filters']
  limit: number
}

type FaceSeekReceiptV1 =
  | { ok: true; version: 1; cursor: string | null; rowOffset: number }
  | { ok: false; version: 1; code: 'address_not_in_query' | 'stale_generation' |
      'wrong_model' | 'released_preview'; detail: string; currentGeneration?: number }
```

The seek runs against the same immutable analysis snapshot, sort, filters, and cursor codec
as `FaceTablePageV1`; it cannot return a cursor for a row excluded by the query.

Selection and framing occur in the same native call. A stale or missing row changes no
selection and returns the normal error schema. Preview tokens are process-private
capabilities created from package-confined saved bytes or Lore preview bytes and consumed
only by the read-only Scene3D specimen.
A build-issue target selects the union of its `degradedToGroups` in the same pass that
resolves its stored source-triangle count.

## Guarded field-edit allowlist

Version 1 accepts only numeric authored-face metadata fields:

```ts
type GuardedFaceFieldEditV1 = {
  version: 1
  modelId: string
  leaseToken: string
  operationId: string
  sessionToken: string
  expectedGeneration: number
  expectedResidentFingerprint: FaceTablePageV1['fingerprint']
  expectedResidentSha256: string
  expectedSavedSha256: string
  address: AuthoredFaceRowV1['address']
  field: 'material' | 'semantic_region' | 'semantic_instance'
  value: number
}
```

Positions, logical loops, triangle membership, object membership, group identity, ranges,
names, and raw offsets are read-only in this mode. Their existing verbs remain the only
mutation path. A successful field edit creates one mesh-journal entry and publishes only
after the Lore/package predecessors, candidate decode, package readback, exact
resident/candidate/saved SHA equality, and zero full-plane diff succeed. Any failure rolls
resident and package back under the same native lease.
