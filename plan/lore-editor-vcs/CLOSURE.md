# Backend closure

## Delivered

- One native `SnapshotService` captures current RJMD v5 bytes from the resident
  model session. The panic path never invokes ordinary Save and never copies an
  on-disk model blob.
- Normal Save records a Lore revision only after its existing transactional
  package write and read-back validation succeed. Snapshot failure cannot undo
  a valid Save, and Save refusal does not disable the independent panic path.
- Six revisioned host doors expose snapshot, history, preview, restore, pin,
  and server status. History uses committed event records; pins use a committed
  registry; preview materializes privately without checkout or resident-session
  mutation.
- `liblore.so` is an optional source-detected native dependency with a pinned
  fetch/verification script and shipped runtime copy.
- Gitea, its health percept, the repaired edit-trail watcher, and a daily
  retention timer are active and boot-enabled. Only eligible source enters the
  trail; game models, Lore state, userdata, and ignored paths do not.

## Exact recovery proof

The ReleaseFast V8 smoke application installed a one-triangle, one-part mesh
directly into the native resident session and called the real host surface.
No model package Save or disk-source load participated.

- model: `v8-live-proof-1786206872478`
- revision: `ef92b274ff95d3031e2c4c00ab12f029643efb380898df8bd032aa7ccb8c8ae1`
- resident/preview SHA-256:
  `b5195e5ee4df9202e039a3f3f0cb199b9917073db5f3ab413ff859236a158f94`
- encoded bytes: `156`
- history facts: one triangle, one part, pinned
- Lore server status: healthy

A separate-process cold test passes an exclusive `0600` token containing the
exact revision and SHA from capture into a new browse process. Browse requires
that exact history entry, previews that exact revision, and byte-compares it to
the expected current-format fixture; an older same-label entry cannot satisfy
the proof.

## Edit-trail retention proof

- local, remote-tracking, Gitea branch, and Gitea `HEAD` all resolve to
  parentless root `7f834645db7a6fe1b117887c4ff38a6d0a46cada`;
- all four managed reflogs contain one entry and ordinary refs/reflogs were not
  changed;
- a fresh Gitea clone passes connectivity and contains zero ignored/model/Lore/
  userdata paths;
- disposable local and bare-server tests prove exact reflog expiry and physical
  old-object pruning while unrelated backup reflogs/objects survive;
- production rotation begins at 60 days, with a deliberate two-day safe-GC
  debt, for an effective physical maximum of roughly 62–63 days.

The prior epoch is currently unreachable and is deliberately held only for the
two-day race-safety grace. Its scheduled earliest collection time is
2026-08-10T09:33:45-07:00. This is not reported as already physically deleted.

## Automated gates

- `test-lore-snapshot`
- `test-lore-snapshot-live`
- `test-lore-snapshot-cold`
- real six-door ReleaseFast V8 resident proof
- Agent Seat contract suite: 77 passing
- model Lore Save-coordination suite: 8 passing
- `./tools/rjit codegen-bindings --check`
- `scripts/fetch-lore.sh`
- `SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor`
- edit-trail watcher/retention unit tests, local+server fsck, fresh clone, health
  hook, and service/timer state checks

## Deliberate boundary

This recovery system prevents resident work from being lost when the ordinary
Save pipeline refuses. It does not claim to diagnose or repair every original
Save-refusal bug. The version-browser and server-detail UI remain the next,
separately designed presentation leg.
