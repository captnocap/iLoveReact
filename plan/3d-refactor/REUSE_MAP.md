# Phase 5 — Reuse: canonical shapes (pinned APIs)

The dedupe converges on the file's OWN modern idiom (meshSolidifySelection :10593 is
the exemplar), not on new abstractions. Only three new helpers exist; everything else
reuses helpers already in the file.

## Canonical allocation idioms (Phase B target state)

```zig
// (1) op-temporary — freed on every path today:
const mask = jalloc.alloc(bool, n) catch { topoRefuse("out of memory …"); return null; };
defer jalloc.free(mask);

// (2) escaping capture — stored into session/global state on success:
var committed = false;
const base_colors = collectCurrentFaceColors(jalloc) orelse return null;
defer if (!committed) jalloc.free(base_colors);
// … on the success path, immediately after the store:
committed = true;
```
Rules: NEVER ArenaAllocator here (would be a third idiom). NEVER convert a
free-in-session (lcFree/bevel teardown) to a defer. `errdefer` does not fire on plain
`return null` — the committed-flag is the only correct form for (2).

## New helpers (W5; all PRIVATE `fn` — pub surface stays frozen)

```zig
const EditableMesh = struct { verts: []const f32, tri_count: u32 };
/// Refuses (topoRefuse + null) when no editable mesh is resident or it has no
/// triangles. Pure read of g_edit_verts/g_edit_count.
fn requireEditableMesh() ?EditableMesh

const ScopedSelection = struct { mask: []bool, selected: u32 }; // mask len == tri_count
/// Allocates from `a`, fills via mesh_edit.buildDeleteMask, intersects with
/// mesh_edit.faceInScopePub per face (selection sets can outlive a scope change —
/// carry that comment), refuses on empty selection or empty in-scope intersection.
/// Mask oversize rule from req_4114 (max(tri_count, model_paint.faceCount())) moves
/// INTO the helper with its comment.
fn requireScopedSelectionMask(a: std.mem.Allocator, tri_count: u32) ?ScopedSelection
```

## Signature changes (both private; every caller is rewritten in the same wave)

```zig
fn collectCurrentFaceColors(a: std.mem.Allocator) ?[]u8   // was: implicit c_allocator
fn capturePartOfFaces(a: std.mem.Allocator) ?[]u32        // was: implicit c_allocator
```
Callers pass `jalloc` (it IS c_allocator — behavior identical). `captureFaceGroups`
:5866 gets the same parameter for symmetry IF its callers are all inside converted
waves; otherwise left alone (report which).

## Existing helpers ops must call instead of inlining

`captureFaceGroups` :5866 · `capturePartOfFaces` :3898 · `collectCurrentFaceColors`
:1467 · `cloneIndexedEditMeshOrImport` :714 · `topoRefuse` :693 /
`topoRefuseIndexedError` :702 · `journalSnapshotCurrent`/`ForNewAction` /
`journalCommit` / `journalDiscard` (NEVER wrapped, NEVER reordered).

## New helpers from the clone waves (W2–W4, private unless noted)

`math/geo.zig: pub fn distancePointToSegmentSq` · `instanceFromNode` ·
`instanceFromRow` · `createDiffuseTextureBinding` · `buildFormulaPipeline` ·
`findOrClaimRegionSlot` · `installRegionData` · `initStorageBindPool` ·
`installExtrusionResultMetadata` · `installRetopoBandPlan` ·
`projectVisibleTriangle` · `gizmoArmHitDistanceSq`.
Placement: immediately above their first caller (chapter locality for Phase C);
each carries a one-line doc comment naming what it replaced.

## Comment-carry law (applies to every wave; from the req_3830 closing ruling)

Comments are part of the behavioral contract. When code moves into a helper, its
rationale comments (req_ ids, historical failures, forbidden alternatives, ownership
notes) move WITH it. A prologue collapsed to a helper call keeps any op-specific
rationale comment at the call site. Never delete a comment because the code became
"obvious". Net comment-line loss per wave ≈ 0 outside W1's deleted functions.

Gate: canonical_shapes_identified: **true**
