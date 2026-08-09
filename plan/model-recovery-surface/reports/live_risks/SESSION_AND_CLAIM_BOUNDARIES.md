# Live risk — session authority and mutation claims

Surveyed 2026-08-08.

## Confirmed session split

Modular dev hosts place the visible Scene3D state in `librjit_scene3d-dev.so`, while the
current Lore binding directly imports a cold `gpu/3d.zig` copy. This produced the observed
`no resident model document` response for a visibly open model. The Recovery Snapshot UI is
blocked until capture crosses the Scene3D module ABI with expected token/generation.

## Confirmed claim gap

Agent Seat claims gate Seat requests and selected registered commands. Direct ModelView
host calls and native gizmo commits do not all pass through claim admission. A claim is not
currently a complete lock on model mutation.

## Plan consequence

- Face-table reads remain claim-free and generation-stamped.
- Row selection validates generation but is not represented as topology safety.
- Snapshot, pin, and prune use the serialized recovery-repository lock and do not require a
  mesh-journal lease. Restore and guarded field edits require the native model-write lease.
- Agent Seat modification-tier release is blocked until the native journal/mutation boundary
  accepts and enforces the authorized lease token.
- The broader migration of every pre-existing native toolbar/gizmo mutation is recorded as a
  prerequisite or separate closure item; no plan text may claim it already works.
