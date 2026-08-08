# Reuse map

## Reuse unchanged

- `gpu/3d.zig:modelDocumentSnapshot` for strict native resident state, with
  `modelRecoverySnapshot` for the panic path's channel-preserving fallback.
- `gpu/meshdoc_format.zig:encodeCurrentSnapshotAlloc` and `decodeDocument` for
  current RJMD serialization and validation.
- Existing atomic-write helpers where they do not import ordinary Save gates.
- `vcs/lore.zig` `@cImport`, globals, identity, and callback conventions.
- An explicit capture timestamp committed in canonical `event.json`; Lore 0.8.6
  does not expose a usable revision timestamp in its history result.
- `lore_file_write` into a private per-user runtime directory for non-mutating
  historical materialization; Lore 0.8.6's dump event is not a byte stream.
- Existing source-driven native ingredient detection in `build.zig`.
- `tools/lore-hook-health` structure for the Gitea prompt hook.
- Existing watcher temporary-index / atomic-update-ref strategy.

## Extend once

- Add exact typed collectors/wrappers to `vcs/lore.zig` for file stage/write,
  revision commit/history, and metadata.
- Add one `SnapshotService`; both panic and normal policy call it.
- Add one `v8_bindings_lore.zig`; no duplicate TS-side history client.
- Add one feature flag and library-link block for Lore.

## Explicitly reject

- Copying the on-disk model blob as a panic snapshot.
- Calling normal Save from the panic path.
- Reimplementing Lore's object store in TS/JSON.
- Preview by checkout, restore, or resident-session mutation.
- Treating HTTP health as edit-trail integrity.
- Treating a rerooted branch as retention while reflogs or unreachable server
  objects still preserve history older than 60 days.
- Keeping a second Gitea repository copy of the known corrupt 18 GB bare repo.
- Hand-mirrored Lore C structs.
