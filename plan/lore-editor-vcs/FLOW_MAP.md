# Flow map

## Panic snapshot

`__lore_snapshot(modelId, label)`
→ resolve the currently open native model session and package-relative target
→ compose an owned `meshdoc_format.Snapshot`
→ encode current RJMD bytes from that resident state
→ unconditionally persist the recovery artifact with direct native I/O
→ Lore file stage
→ Lore revision commit
→ commit canonical `event.json` browse facts beside the resident RJMD
→ optionally mirror those facts into Lore revision metadata as an index hint
→ return revision id + encoded-byte/hash facts.

No TS Save coordinator, model blob guard, disk-source fallback, or ordinary
meshdoc Save refusal appears on this path.

## Normal save

Editor Save coordinator
→ existing transactional mesh/package Save completes
→ `__lore_snapshot(... kind:normal ...)`
→ snapshot service captures the still-resident session
→ Lore commit + metadata
→ ordinary Save reports both package and revision outcome distinctly.

Snapshot failure must not roll back an already-valid ordinary Save.  Ordinary
Save failure must not prevent the user from invoking panic snapshot.

## Browse and recover

`__lore_history(modelId)`
→ Lore revision history + canonical committed `event.json`
→ committed pin-registry lookup
→ compact JSON rows (no blob decode).

`__lore_preview(modelId, revision)`
→ `lore_file_write` at revision into a private `0700` per-user runtime directory
→ decode and summarize the materialized bytes for inspection
→ no checkout, no open-session mutation.

`__lore_restore(modelId, revision)`
→ privately materialize the selected revision
→ validate it is a decodable current model artifact
→ atomically replace package blob
→ return restored revision facts.

Reloading an already-open native model is deliberately outside the restore door;
the future browser UI owns that explicit coordination rather than hiding it in
the storage service.

`__lore_pin(modelId, revision, bool)`
→ update and commit the per-model pin registry
→ return reread pin state.

## Server status

`__lore_server_status()`
→ native reachability/version
→ loreserver HTTP health
→ unit state where available
→ durable store byte count
→ compact status JSON.

## Edit-trail durability

working tree changes
→ watcher creates immutable local `edit-trail` commits via temporary index
→ force-push branch to `edittrail` remote
→ Gitea durable bare repository
→ verified fetch/fresh clone
→ expire local and server reflogs beyond 60 days
→ prune unreachable edit-trail objects beyond that horizon.

The 60-day policy applies only to this high-frequency edit trail.  Manual and
pinned Lore model snapshots are an independent recovery channel and are not
aged out by edit-trail maintenance.

Prompt submission/session start
→ short Gitea health request
→ silence on HTTP 200
→ actionable unit/journal/restore context on failure
→ always exit 0.
