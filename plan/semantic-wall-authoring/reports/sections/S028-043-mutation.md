# Section C — Native Wall Mutation

## Atomic mutation and allocator gate — step 42

- Timestamp: `2026-08-14T16:10:02-07:00`
- Command: `tools/zig/zig build test-building-architecture -Doptimize=ReleaseFast --summary all`
- Exit: `0`
- Summary: `3/3` build steps succeeded; `73/73` tests passed.
- Runtime: `14ms`; reported maximum resident set: `6M` for the test runner.
- Compile state: cached; `10ms` compile-step check.
- Allocator result: zero leaks, double frees, or invalid frees. Every mutation source,
  result, receipt, patch, decoded record, opening-slot result, and topology candidate in
  the focused suite is owned through `std.testing.allocator`; any outstanding ownership
  would fail the Zig test runner.

Passing mutation families:

- exact whole-`u` wall drawing, endpoint reuse, and explicit magnets;
- exact X/T/multi-edge splitting with deterministic child lineage;
- opening and anchor redistribution across splits;
- measured opening slot enumeration plus insert, move, configure, and delete;
- edge dimensions, profile, typed style, and independent side finishes;
- edge/vertex deletion with incident-child and orphan cleanup;
- semantic anchor attach and detach;
- exact-before-byte patch application and automatic inverse construction;
- forward/inverse round trips for draw, split, opening, edit, deletion, attach, and detach;
- public-facade candidate validation and atomic topology rejection.

No test-side arena masks mutation ownership. The only `ArenaAllocator` in the focused
file belongs to the original contract smoke test at line 11 and is itself backed by
`std.testing.allocator`; all mutation tests use `std.testing.allocator` directly.

## Receipt and patch ownership audit — step 43

`MutationResult.deinit` is the single public recursive release boundary. Its receipt
branch owns and releases the following complete tree:

| Owned allocation | Immediate owner | Recursive release |
|---|---|---|
| command ID and before/after hash bytes | `MutationReceipt` | `MutationReceipt.deinit` |
| created IDs | `RecordRef[]` | each `RecordRef.deinit`, then the slice |
| updated IDs and before/after canonical bytes | `RecordDelta[]` | each `RecordDelta.deinit`, then the slice |
| removed IDs and canonical bytes | `RecordSnapshot[]` | each `RecordSnapshot.deinit`, then the slice |
| predecessor IDs, child IDs, and start columns | `EdgeChildRemap[]` | each `EdgeChildRemap.deinit`, then the slice |
| opening/anchor child, predecessor, and successor IDs | `SurfaceChildRemap[]` | each `SurfaceChildRemap.deinit`, then each slice |
| predecessor/successor signature byte lists | `FaceLineage[]` | each `FaceLineage.deinit`, then the slice |
| forward/inverse operation records and canonical bytes | `ArchitecturePatch` | each `PatchOperation.deinit`, then the operation slice |
| affected bounds and dirty-target arrays | `MutationReceipt` | direct slice release |

The rejection branch owns its command ID, subject-ID list, and detail bytes and frees
them through `MutationRejection.deinit`. Canonical patch decoding produces one
`CanonicalRecord`; its tagged `deinit` recursively releases vertices, edges and nested
openings, located-opening edge IDs, or anchors until ownership is transferred into an
owned candidate. Candidate sources recursively release all record arrays through
`ArchitectureSource.deinit`. `OpeningSlots.deinit` owns the query result array.

Every builder has `errdefer` cleanup for its initialized prefix and transfers ownership
only after candidate validation and receipt construction succeed. Patch application
never borrows persisted record payloads: it checks the current canonical bytes, decodes
an owned replacement through the format owner, and either transfers it into the
candidate or releases it on error. The 73-case `std.testing.allocator` gate exercises
the successful transaction/deinit paths and all typed rejection paths present in the
focused matrix.
