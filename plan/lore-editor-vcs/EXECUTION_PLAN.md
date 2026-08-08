# Execution plan

## 1. Establish a durable edit-trail server

1. Stop the existing Gitea user service after recording its active config and
   repository paths.
2. Install/copy the Gitea binary into the per-user tool path.
3. Create `~/.local/share/gitea` config/data/log/repository directories without
   copying the corrupt bare repository.
4. Preserve compatible instance identity/database/auth configuration while
   redirecting every mutable path to the durable tree.
5. Replace the user service with `Restart=always`, `RestartSec=3`,
   `StartLimitIntervalSec=0`, and `WantedBy=default.target`; enable and start it.
6. Prove linger, active/enabled state, HTTP health, and paths reported by the
   running process.

Exit gate: service survives stop/start and all mutable paths resolve beneath
`~/.local/share/gitea`.

## 2. Repair and publish the edit trail

1. Inspect `.git/index.lock` ownership before any repair.
2. Repair only the invalid edit-trail reflog record while preserving the live
   branch ref and reachable objects.
3. Create/recreate an empty Gitea `siah/reactjit-edit-trail` repository; do not
   import the corrupt server history or any history older than two months.
4. Add the `edittrail` remote to the working repository.
5. Push local `refs/heads/edit-trail` to remote `main`.
6. Fetch the remote ref and fresh-clone it to a temporary directory.
7. Run connectivity/object verification and assert that cloned and local
   edit-trail head IDs and root-tree IDs are byte-for-byte equal.
8. Confirm the watcher records and publishes a controlled probe commit.
9. Configure the local and server repositories to expire edit-trail reflogs at
   60 days, then prune unreachable objects and prove an older synthetic object
   is no longer retained by either store.

Exit gate: push, fetch, fresh clone, fsck, tree identity, and actual 60-day
retention/pruning all pass.

## 3. Add the Gitea outage percept

1. Add executable `tools/gitea-hook-health` with a two-second timeout, silent
   healthy result, diagnostic unhealthy result, and unconditional exit 0.
2. Wire it after Lore in SessionStart and UserPromptSubmit.
3. Stop the service and prove exact diagnostic output/exit status.
4. Start the service and prove zero output/exit status.

Exit gate: both paths pass and service is left healthy.

## 4. Complete exact Lore adapters

1. Read each required type and event from vendored `lore.h`.
2. Extend `vcs/lore.zig` with copied-result collectors for stage, write, commit,
   history, metadata get/set, and repository/file resolution.
3. Add focused Zig tests around callback copying, result/error propagation, and
   metadata encoding.

Exit gate: wrappers compile against the vendored header and exercise a real
local Lore repository without leaked callback-owned memory.

## 5. Build the resident SnapshotService

1. Resolve the currently open model/package target in native state.
2. Compose and encode the resident RJMD snapshot.
3. Implement direct recovery-artifact write, Lore stage, commit, and canonical
   browse event as one result-bearing operation.
4. Implement history, preview, pin, explicit validated restore, and server
   status/store sizing.
5. Keep normal Save and panic policy separate while sharing the encode/commit
   core.
6. Add focused Zig tests for byte identity, metadata, preview non-mutation,
   restore validation, and failure truthfulness.

Exit gate: a deliberately unsaved resident fixture snapshots and previews byte
identically without invoking normal Save.

## 6. Expose and link the deep host surface

1. Add `v8_bindings_lore.zig` with six `__lore_*` doors and strict JSON output.
2. Register it as an optional V8 ingredient.
3. Add source-driven build detection, include/library paths, link, runtime
   lookup/copy behavior, and deterministic fetch script.
4. Add declarative TS host types only; do not build the version browser UI.
5. Invoke normal snapshot only after ordinary Save succeeds.

Exit gate: non-Lore cart remains unlinked; consuming editor builds and calls all
doors in ReleaseFast.

## 7. Prove the real recovery loop

1. Use Agent Seat to open a disposable/in-memory-generated model fixture.
2. Make an unsaved resident edit and record resident counts/hash.
3. Invoke panic snapshot.
4. Query history and verify label/count/time/pin facts.
5. Preview the revision and assert exact byte length and SHA-256 equality with
   the resident encode.
6. Toggle pin and reread it.
7. Cold-reopen without binding or resaving and verify the revision remains
   browsable.
8. Run focused Zig/TS suites and a ReleaseFast editor build.

Exit gate: evidence includes revision id, equal byte/hash proof, metadata reread,
fresh-process browse, and passing build/tests.

## 8. Close the backend leg

1. Audit for any disk-copy panic path, checkout-based preview, hand-mirrored C
   ABI, or server-health-only durability claim.
2. Commit each logical unit with req_4104/req_4105/req_4106 references.
3. Move the three requests to review with commit SHAs and proof.
4. Hand off only the UI/version-browser design work.

Exit gate: backend is complete and the remaining scope is presentation only.
