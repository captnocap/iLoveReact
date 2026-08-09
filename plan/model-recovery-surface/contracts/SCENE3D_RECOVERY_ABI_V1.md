# Contract — Scene3D Recovery ABI v1

This is the sole process-local boundary between the cold editor host and the replaceable
Scene3D module. It extends the existing `Scene3dApiV1` prefix; no Zig slice, allocator-owned
object, error set, or implementation enum crosses the dynamic-library boundary.

## Version transitions

- Current surveyed ABI is 5.
- Section D appends session/face/preview fields and ships core + module together as ABI 6.
- Section F appends recovery capture and ships both together as ABI 7.
- Section J appends candidate/adopt/rollback fields and ships both together as ABI 8.

`ABI_VERSION` is global to `Scene3dApiV1` and `GameApiV1`, so every transition updates and
rebuilds the cold core, Scene3D module, Game module, both headers, `header.struct_size`, ABI
and dependency hashes, valid/wrong-version fixtures, and the modular integration host in the
same commit. A core or either module with different versions/sizes/hashes refuses activation;
the plan never treats this as a Scene3D-only version bump.

## Existing sink and fixed status

All JSON/byte results use existing `SnapshotSinkV1` synchronously. The callee retains neither
the sink nor input pointers after return.

```zig
const SceneCallCodeV1 = enum(u32) {
    ok = 0,
    invalid_request = 1,
    wrong_model = 2,
    no_resident_session = 3,
    object_ids_unpublished = 4,
    stale_generation = 5,
    released_capability = 6,
    lease_refused = 7,
    module_unavailable = 8,
    internal_error = 9,
    analysis_pending = 10,
};

const SceneCallStatusV1 = extern struct {
    code: SceneCallCodeV1,
    flags: u32,
    current_generation: u64,
    receipt_id: u64,
};
```

`flags & 1` is `recovery_provenance_degraded`; every other bit is zero in v1. Any successful
call whose returned/adopted document carries nonempty recovery provenance sets it. Strict
Save never invents a degradation, but it preserves and reports provenance inherited from a
recovered document. Recovery capture may add or aggregate new rows while returning `ok` and
valid bytes.

Detailed code/detail JSON goes through the sink. `SceneCallStatusV1` is the allocation-free
classification available even when no JSON can be produced. Compile-time tests require its
size/offsets and zero every reserved flag.

The callback boolean reports ABI transport success only: `true` means status and any sink
payload were produced, not that `status.code == ok`. `analysis_pending` therefore returns
`true`, carries the public pending JSON, and is never flattened to invalid request.

## Function shapes

```zig
const SceneJsonCallV1 = *const fn (
    request: [*]const u8,
    request_len: usize,
    sink: *const SnapshotSinkV1,
    status: *SceneCallStatusV1,
) callconv(.c) bool;

const SceneBytesJsonCallV1 = *const fn (
    request: [*]const u8,
    request_len: usize,
    bytes: [*]const u8,
    bytes_len: usize,
    sink: *const SnapshotSinkV1,
    status: *SceneCallStatusV1,
) callconv(.c) bool;

const SceneEncodeCurrentV1 = *const fn (
    model_id: [*]const u8,
    model_id_len: usize,
    session_token: [*]const u8,
    session_token_len: usize,
    expected_generation: u64,
    sink: *const SnapshotSinkV1,
    meta: *RecoverySnapshotMetaV1,
    status: *SceneCallStatusV1,
) callconv(.c) bool;
```

ABI 6 appends these exact `Scene3dApiV1` fields in order:

```text
session_publish_object_ids : SceneJsonCallV1
session_identity           : SceneJsonCallV1
document_encode_current    : SceneEncodeCurrentV1
face_table                 : SceneJsonCallV1
face_diff                  : SceneBytesJsonCallV1
face_select                : SceneJsonCallV1
face_seek                  : SceneJsonCallV1
preview_open               : SceneBytesJsonCallV1
preview_select             : SceneJsonCallV1
preview_release            : SceneJsonCallV1
```

`preview_open` copies/decodes the caller bytes before returning and yields a Scene3D token.
That token is process-private and distinct from the Lore/saved-byte capability. Opening marks
the read-only specimen as the active draw/pick source for the module's existing shaded,
depth-tested `render` dispatch inside the one live ModelView; resident state stays parked and
unchanged. Viewport picking targets the active preview while it is visible. The existing
screen-space overlay draws only preview selection accents/names, never the mesh itself.
Release removes/deactivates the preview and atomically returns draw/pick routing to the parked
resident. Preview never calls resident adopt machinery.

`face_diff` receives package-confined verified saved bytes from the cold binding and executes
the full compact resident/saved comparison inside the live Scene3D module. Positions,
normals, UVs, and logical topology never cross as JSON. Before Section E registers the diff
service, the callback returns typed `invalid_request` with `diff_not_registered`; the pointer
is never null and Section E removes that temporary refusal without another ABI bump.

`document_encode_current` performs the strict ordinary-Save composition in the live module,
streams caller-owned RJMD v5 bytes, and fills the same fixed metadata layout later reused by
recovery capture. It preserves already-persisted recovery provenance but refuses a new
invalid channel instead of sanitizing it. It never writes package disk. `face_diff` retains the encoder's transient
dense→session map inside the module for the duration of comparison; that map does not cross
the ABI or masquerade as decoded artifact data.

## Recovery capture (ABI 7)

```zig
const RecoveryDegradationChannelV1 = enum(u32) {
    none = 0,
    object_ids = 1,
    range_membership = 2,
    face_groups = 3,
    materials = 4,
    semantic_membership = 5,
    semantic_table = 6,
    logical_topology = 7,
};

const RecoveryDegradationSlotV1 = extern struct {
    channel: RecoveryDegradationChannelV1,
    action_bits: u32,
    reason_bits: u64,
    affected_count: u64,
};

const RecoverySnapshotMetaV1 = extern struct {
    schema_version: u32,
    rjmd_version: u32,
    generation: u64,
    byte_len: u64,
    triangle_count: u64,
    authored_face_count: u64,
    part_count: u32,
    logical_vertex_count: u32,
    sha256: [32]u8,
    model_id_hash: [32]u8,
    session_token_hash: [32]u8,
    object_namespace_hash: [32]u8,
    identity_quality: u32,
    degradation_count: u32,
    degradations: [7]RecoveryDegradationSlotV1,
};

const SceneCaptureRecoveryV1 = *const fn (
    model_id: [*]const u8,
    model_id_len: usize,
    session_token: [*]const u8,
    session_token_len: usize,
    expected_generation: u64,
    sink: *const SnapshotSinkV1,
    meta: *RecoverySnapshotMetaV1,
    status: *SceneCallStatusV1,
) callconv(.c) bool;
```

`identity_quality` is `0=exact`, `1=degraded`; no other value is legal in v1.
`action_bits` maps bits 0..3 to `synthesized|repaired|defaulted|dropped`; `reason_bits` maps
bits 0..6 in the exact reason order declared by `LORE_RECOVERY_UI_V1.md`. Each affected
channel occupies exactly one aggregate slot, `degradation_count <= 7`, and every unused slot
is all zero. Unknown bits are invalid. Strict document encode returns the resident document's
existing slots unchanged and refuses whenever current data would require new sanitization.
Recovery capture merges existing and newly required slots. Every call returns exact if and
only if the count is zero; otherwise it returns degraded with status flag bit 0. Compile-time
offset tests and semantic mapping tests require all three signals to agree.

ABI 7 appends `capture_recovery`. It runs under the short native snapshot-read guard and
streams one owned RJMD v5 encoding. It preserves stable range object IDs when valid. The
existing recovery composition/sanitization lane emits one slot for every affected object-ID,
range, group, material, semantic-membership, semantic-table, or logical-topology channel. It
persists the same typed provenance in RJMD v5 semantic JSON and returns it in fixed metadata;
the cold host maps the enums but never invents or suppresses a warning. Missing/inconsistent
object identity uses deterministic `@recovery/<model-id-hash>/<range-ordinal>` IDs (or one
covering range when range membership itself is incoherent). Recovery still returns readable
bytes rather than refusing, but its receipt and every later preview/history/face-table view
show the exact affected channels/actions/reasons/counts. Adding a new sanitizing branch
without an enum slot, semantic-JSON entry, and fallback test is a contract failure. The cold
host neither stamps nor re-encodes bytes. Only no resident, wrong model/token, stale
generation, allocation/encode failure, or module unavailability can refuse panic capture.

## Candidate/adoption (ABI 8)

ABI 8 appends, in order:

```text
lease_acquire   : SceneJsonCallV1
lease_release   : SceneJsonCallV1
field_candidate : SceneJsonCallV1
document_adopt  : SceneBytesJsonCallV1
document_rollback : SceneJsonCallV1
```

`lease_acquire` validates `{actor,operationId,modelId,sessionToken,expectedGeneration}` on
the Scene3D owner thread and returns an opaque receipt bound to all five values.
`lease_release` is idempotent for that receipt. Session teardown releases outstanding
receipts and reports them to leak tests; no restore, guarded field edit, or explorer verb can
reach journal mutation without a current receipt. Ordinary interactive commands use a
single-operation ephemeral receipt, while a gizmo holds one from begin through commit/cancel.

`field_candidate` validates the lease/request, encodes candidate RJMD to the sink without
mutating resident state, and returns candidate SHA. The cold native binding stores those bytes
in an opaque recovery-candidate registry. `document_adopt` receives borrowed registry bytes,
requires the exact native lease, commits one journal entry, and returns a receipt ID through
status + JSON. `document_rollback` accepts that receipt/lease and restores it exactly once.

## Capability-to-package path

`framework/v8_bindings_model_recovery.zig` owns one compact JSON door. It accepts candidate
token, package-confined geometry target, expected predecessor/candidate SHAs, and operation
receipt. Native code borrows registry bytes directly for Scene3D `document_adopt` and for
sibling-temp write/readback; bytes never enter JS/React. It returns compact adopt/package/
rollback receipts. AppFrame remains the coordinator and manifest authority, and invokes the
native rollback door if manifest publication fails.

Candidate, Scene3D preview, and Lore byte-capability tokens each have an idempotent release.
The coordinator attempts all owned releases in a `finally` path on success, refusal,
cancellation, rollback, and document teardown. Allocator/leak tests cover every exit.
