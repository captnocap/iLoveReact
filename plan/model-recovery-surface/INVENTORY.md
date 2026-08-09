# Model Recovery Surface — Phase 1 Inventory

Survey date: 2026-08-08. Line numbers describe the shared working tree at survey time.
The inventory boundary is the active `cart/editor/` model surface, its native Scene3D
session, RJMD persistence, Lore recovery service, and Agent Seat. World, map, paint,
character-rig, and non-editor carts are outside the boundary except where they share an
explicit host/build interface.

Ownership categories used below:

- **native topology** — resident authored faces, operation predicates, audit, selection;
- **native persistence/VCS** — RJMD decode/encode and Lore revisions;
- **bridge/runtime** — V8 doors and declarative TypeScript contracts;
- **editor/control** — stage surfaces, commands, Save coordination, presentation;
- **verification** — focused native, bridge, UI, build, and frame-time proof.

## User-authored requirements

1. The product is an outlier finder over model data, not a byte/hex viewer.
2. Authored faces are the primary table rows; render triangles expand beneath a face.
3. Phase 1 is the headless host + Agent Seat face table before the visual surface.
4. Resident, saved, and derived data are separate planes; disagreement is first-class.
5. Row selection and viewport selection are one bidirectional loop.
6. Operation eligibility must call the operation's canonical predicates. A diagnostic
   copy of a rule is forbidden.
7. Unsupported eligibility checks report `not_analyzed`; absence of a check is never
   presented as permission.
8. Ordinary edits dispatch existing verbs and create one existing journal entry.
9. Guarded field edits decode, validate, back up, encode through
   `meshdoc_format.encode*`, read back, then atomically publish. No byte poke exists.
10. Lore needs visible snapshot, history, pin, preview, restore, and server-detail UI.
11. Recovery history has a hard 60-day age ceiling. Pinning is a browse/bookmark signal
    inside that window and does not create indefinite retention.
12. No generated or imported game 3D model is committed; fixtures are in memory or temp.

## Current data planes

| Plane | Current authority | Current read surface | Current limitation |
|---|---|---|---|
| resident | active native Scene3D/edit session | `look`, selection snapshot, ModelView | no complete authored-face table; session identity can disagree across modules |
| saved | package `mesh/doc.blob` or manifest-declared RJMD v5 artifact | `package info/regions/ranges/triangles/diff` | decoded separately from resident facts; no per-face field diff |
| derived | indexed predicates plus `mesh_audit` | aggregate percept and audit selection | reasons are fragmented, frequently bool/null, and not joined to authored rows |

## Native authored-face ownership

| File | Lines | Scoped symbols / facts | Fragility |
|---|---:|---|---|
| `framework/gpu/indexed_edit_mesh.zig` | 6,033 | `Face` 497–544 owns stable session ID, ordered logical loop, UVs, source triangles, group, part, material, semantic role, tessellation validity, and alive state. `Lowered.face_ids` 557–603 joins render triangles back to authored faces. `Mesh` 605–643 owns the indexed document. | Critical |
| same | | `fromSoupInternal` 896–1076 groups soup. `appendDegradedBucket` 1182–1213 replaces a malformed group with separate triangle faces. `buildFaceFromBucket` 1215–1328 is the canonical boundary reconstruction walk. The degraded rows do not retain the original malformed-group provenance. | Critical |
| same | | `facePolygonFrame` 1373–1444 is the Face→N-gon predicate for corner count, concavity, Newell normal, planarity, edge length, centroid-to-edge-line clearance (currently named `inradius`), and minimum width. `facePolygonLimit` 1446–1449 collapses every failure to null. `seedInfo` begins at 1511. | High |
| same | | `selectedFacesAreCoplanar` 2257–2290; `mergeFaceIdsGated` 2313–2517; `mergeSelected`/`mergeSelectedTrusted` 2525–2564; loop-cut path 2940–3066; bevel limits 3468–3689; polygonize 3951+; lower/adopt mappings 4363–4461 and 4537–4573. | Critical |
| `framework/gpu/mesh_edit.zig` | 6,653 | `selectionSnapshotJson` 2325–2465 emits selected render-triangle rows with group/part/material/region/instance/normal/area. It is selection-only and triangle-granular. `selectFaceByIndex` 2838 and `selectFacesByGroupRange` 2953 provide the existing selection seam. `selectionFrame` 3872 frames the selected geometry. | High |
| same | | Edge incidence reads 3712–3741. `solidifyOffsets` and related types 1591–1770 compute the existing solidify geometry but do not expose per-face refusal reasons. | High |
| `framework/gpu/mesh_audit.zig` | 385 | `Facts` 27–37, per-render-triangle `Marks` 39–47, `Budget` 49–57, and `audit` 248–384. One pass supplies intersecting/unreachable marks and `computed`; `computed:false` means unknown. | High |
| `framework/gpu/model_source.zig` | 556+ | resident groups 132–144, materials 151–179, semantics 191–223/298–310, semantic JSON 260–270, part ranges and rank lookup 363–404. Native rows carry numeric IDs; display names remain package/editor data. | Critical |
| `framework/gpu/3d.zig` | 18,500 | active session and transaction coordinator. `modelDocumentSnapshot` 5472+, `modelRecoverySnapshot` 5478–5539; journal 5852–6921; frame/select 496–506 and 11773–11810; aggregate semantic/audit percept 12140–12285; audit-select rerun 12396–12465; element/selection reads 12648–12692. | Critical hub |

### Facts directly available today

- Authored face ID, ordered logical boundary, exact source-triangle membership, group,
  numeric part/material/semantic IDs, and alive/tessellation state.
- Triangle normals/areas, face-to-render joins, boundary edge incidence, selection frame.
- One-pass render-triangle intersection and reachability marks.
- Partial detailed reasons for indexed build, loop cut, bevel, and Face→N-gon.

### Facts missing today

- Complete authored polygon area, perimeter, min/max edge, accurately named centroid-edge clearance, aspect definition,
  max planarity deviation, convexity, and structured degeneracy breakdown.
- Retained provenance for a group degraded by `fromSoupInternal`.
- A complete authored-face JSON door or typed response.
- Structured, queryable per-face operation eligibility for merge, extrude, and solidify.
- A persistent audit mark cache; current aggregate cache stores counts only.

### Current predicate contradictions

1. Import now degrades malformed groups, while `3d.zig` 650–681 and 4709–4795 still
   contain refusal/masking behavior expecting `MalformedFaceBoundary`; that branch can no
   longer observe the degraded group.
2. `mergeSelected` deliberately passes `require_coplanar=false` (req_4140), while a
   `mesh_edit.zig` test at 1817–1848 still expects a bent merge refusal.
3. Merge does not reset/populate the shared topology-refusal string. Agent Seat can report
   a stale reason left by an earlier bevel/loop/index operation.

These contradictions must be resolved by operation owners before their eligibility cell
can report `allowed` or `blocked`.

## Display-name and ownership joins

Native topology owns numeric facts only. Human-readable rows currently require:

- semantic region/instance names from the semantic table in
  `cart/editor/model/meshSemantics.ts` and Agent Seat's parsed table;
- stable object IDs and Outliner names from package parts metadata and range-object IDs;
- material labels from `ModelTextureSlot` in `cart/editor/data/types.ts` 391–412.

A native table therefore returns stable numeric/address facts and explicit object IDs. A
single editor join adds display labels. Display labels never become diff identity.

## RJMD saved-plane ownership

| File | Lines | Scoped symbols / facts | Fragility |
|---|---:|---|---|
| `framework/gpu/meshdoc_format.zig` | 1,176 | `FaceBlock` 29, `Snapshot` 42, `Document` 80; current encoders 358/376/427/484; `decodeDocument` 541; strict composition 714; recovery composition 845. It is the canonical v1–v5 reader and current-v5 writer. | Critical |
| `cart/editor/data/meshDoc.ts` | 1,139 | TypeScript package document parser, v1–v5 branching, semantic/range postconditions, and package-facing types. It is not an alternate authority for native geometric predicates. | Critical |
| `cart/editor/data/modelPackageStore.ts` | 1,446 | package-path resolution, transactional model artifacts/manifests, and readback coordination. | Critical |

`meshdoc_format.Snapshot` carries the encoder-only transient
`dense_to_stable_logical_ids` remap for the exact save invocation. Decoded
`meshdoc_format.Document` does not contain that reverse map. A saved/resident comparison
must use exact artifact lineage, the current encoder receipt, or an independently unique
incidence signature; reconstructing the transient map from decoded dense IDs would be a
fabricated identity.

The saved-plane analyzer does not exist. Current `package diff` compares triangle count,
authored-face count, and semantic-region count/name membership; it does not emit per-face
field differences or geometry metrics.

## Lore backend inventory

| File | Lines | Scoped symbols / facts | Fragility |
|---|---:|---|---|
| `framework/vcs/lore.zig` | 1,937+ | verified `@cImport` wrapper. Live service calls include `fileInfo` 573, `repositoryStatus` 774, `fileStage` 933, `fileHistory` 1085, `fileWrite` 1153, `revisionCommit` 1281, revision metadata 1410–1460, and `branchPush` 1887. | Critical ABI |
| `framework/vcs/snapshot.zig` | 1,590 | request/metadata schemas 30–207; paths/locks 209–307; resident sanitizing/encoding 338–545; private materialization 567–713; pin/push separation 715–803; snapshot 805–963; history 965–1044; preview 1096–1115; restore 1148–1197; pin 1207–1310; status 1378–1447. | Critical |
| `framework/v8_bindings_lore.zig` | 133 | six thin doors. Snapshot directly imports `gpu/3d.zig` and calls `modelRecoverySnapshot` at 43–71. | Critical boundary |
| `runtime/vcs/lore.ts` | 64 | generic JSON facade for snapshot/history/preview/restore/pin/status. Response values remain `unknown`. | Medium |
| `cart/editor/model/modelLoreSnapshots.ts` | 115 | stable object-ID sorting 39–49; successful-normal-Save archive policy 51–100; package geometry target 102–115. | High |
| `cart/editor/shell/AppFrame.tsx` | 8,946 | Lore imports 136–147; normal archive adapter 1729–1742; character/prop Save calls 1848–1853/1956–1961; Save command 2811–2819; Agent Seat routing 6227–6258. | Critical hub |

### Current Lore response capabilities

- Snapshot returns revision/revision number, timestamp, SHA, byte length, triangle/part/
  logical-vertex counts, metadata result, and push result.
- History pages 100 by default and 500 maximum; committed `event.json` is canonical.
- Preview materializes one current revision privately and returns path plus RJMD summary.
- Pin writes a committed per-model registry.
- Server status includes library version, HTTP health, unit state, journal tail, restore
  commands, repository readiness/path/revision, and local/server store bytes.
- Restore validates and replaces the disk geometry artifact only. It does not snapshot the
  current resident first, reload the open native session, or transact the entire package.
- Lore versions only RJMD geometry/embedded channels, not textures, manifest, RJSK, or every
  package sidecar.
- Current snapshots overwrite one `resident.rjmd` path, so Lore's file-level obliterate API
  cannot expire one historical snapshot independently. The repository wrapper exposes full
  garbage collection and permanent file obliteration, but the snapshot service has no
  retention scheduler or immutable per-snapshot file layout.

### Confirmed modular-development capture defect

- Dev builds put live Scene3D globals in `librjit_scene3d-dev.so`
  (`cli/commands/dev.ts` 329, `build.zig` 778,
  `framework/dev_modules/scene3d_module.zig` 8).
- Core bindings intentionally avoid importing `gpu/3d.zig` in the cold modular host
  (`framework/v8_bindings_core.zig` 25).
- Lore remains registered in the cold ingredient table and
  `v8_bindings_lore.zig` imports another cold copy of `gpu/3d.zig`.
- The visible model can therefore be resident in the Scene3D module while Lore reads an
  empty cold-host copy and returns `no resident model document`.

The existing snapshot tests inject synthetic `meshdoc.Snapshot` values directly into the
service. None boots the modular editor host, loads ModelView, calls `__lore_snapshot`, and
compares preview bytes. That is why they stayed green.

## Current bridge and editor surface

| File | Lines | Scoped symbols / facts | Fragility |
|---|---:|---|---|
| `framework/v8_bindings_core.zig` | 5,436 | existing mesh selection/inspection doors and normal RJMD writer. `__mesh_preview_file` 483+ is GLB/OBJ-only and deliberately does not adopt an edit session. | Critical bridge |
| `cart/editor/agent/seatApi.ts` | 2,594 | action dispatch and read/mutation admission. `lore` delegates at 2568; whole action is classified as read at 2147–2166 even though snapshot/pin mutate recovery storage. No `face-table` action exists. | Critical |
| `cart/editor/stage/ModelView.tsx` | 6,168 | owns visible model host bridge, native edit verbs, selection, orbit framing, and existing model viewport. Direct toolbar/popup host mutations do not all pass through Agent Seat claims. | Critical hub |
| `cart/editor/stage/ModelDocumentSurface.tsx` | 578 | resolves file/RJMD/primitive/composed source, owns cold mount/resident lease, and mounts ModelView. It already distinguishes a declared durable geometry artifact from a never-persisted seed; the former's read/decode failure is a refusal and must remain a no-fallback gate. | Critical |
| `cart/editor/stage/Stage.tsx` | 248 | Section E document-kind routing and StageTabs. No model-data/recovery sub-surface exists. | High |
| `cart/editor/inspector/UvEditor.tsx` | 2,473 | established dense split/editor pattern: viewport-like graphical work area, sortable/list controls, overlays, explicit reviewed mutations, and no DOM dependency. | High/reference |
| `cart/editor/dialogs/ModelImportPreview.tsx` | 118 | isolated `Scene3D.Mesh hostKey` preview pattern using `__mesh_preview_file`; current native preview accepts GLB/OBJ, not RJMD. | Medium/reference |

There is no Lore component, panic button, history browser, pin control, revision preview,
restore confirmation, outage badge, store-detail panel, label/note input, or visible face
table. The only visual Lore trace is ordinary Save's status suffix.

## Current concurrency/session facts

- `activeSessionModelIdRef` is a shell label, not native proof of a populated session.
- Agent Seat claims gate Seat writes and some registered `model.edit` commands.
- Direct ModelView host calls and native gizmo commits do not all consult that claim.
- Face IDs and triangle IDs are generation-scoped. A table row must carry generation and
  every selection/mutation request must reject a stale generation.
- Reads may remain claim-free. The guarded modification tier cannot claim concurrency
  safety until admission reaches the native journal/mutation boundary.
- Current aggregate audit/select paths execute synchronously in the Scene3D owner, and the
  proposed complete face facts plus full audit/diff would exceed a safe owner-frame budget
  on representative meshes if copied directly into a host call. The replacement needs a
  bounded immutable owner-thread capture followed by native worker computation and
  main-thread completion delivery; React polling or a JS slider/frame loop is not an answer.

## Existing verification surfaces

- `framework/testing/unit/mesh_audit.zig` covers intersection/reachability facts and mark
  identity; `zig build test-mesh-audit` is registered at `build.zig` 1876–1898.
- `framework/testing/unit/mesh_edit.zig` covers selection snapshot metadata, topology
  operations, and current refusal behavior.
- `framework/testing/unit/lore_snapshot.zig`,
  `framework/testing/integration/lore_snapshot.zig`, and
  `framework/testing_lore_snapshot_cold.zig` cover service-level synthetic snapshots.
- `cart/editor/model/modelLoreSnapshots.test.ts` covers pure Save coordination only.
- `cart/editor/agent/seatApi.test.ts` checks Lore delegation but not full action contracts.
- There is no modular-host Lore integration target, complete face-table target,
  saved/resident face-diff test, row↔viewport selection test, or recovery UI test.

## Inventory conclusion

The missing native seam is a generation-scoped authored-face analysis service over one
canonical indexed document. It must execute boundary reconstruction/polygon/operation
predicates and audit marks once, then expose the same paged rows to Agent Seat and the
editor. The missing recovery seam is an ABI call into the actual Scene3D module, followed
by visible UI that consumes typed Lore contracts. Neither problem is solved by exposing
raw RJMD bytes.
