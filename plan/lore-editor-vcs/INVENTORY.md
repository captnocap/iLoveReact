# Lore editor VCS inventory

## User-visible failure being removed

The editor's ordinary Save path can refuse a resident model because its durable
package metadata and the native mesh session disagree.  The resident mesh is
still the user's best copy in that moment.  A safety snapshot must therefore
encode the live native session directly and persist that exact byte stream; it
must not copy `mesh/doc.blob` or call the validating Save door.

## Existing canonical pieces

- `framework/gpu/3d.zig` owns the resident model session and exposes
  `modelDocumentSnapshot` / `paintedDocumentSnapshot`.
- `framework/gpu/meshdoc_format.zig` owns RJMD encoding and decoding.
  `encodeCurrentSnapshotAlloc` writes current RJMD v5; the Snapshot owns all
  arrays needed for a self-contained encode.
- `framework/v8_bindings_core.zig:hostModelMeshdocWrite` is the normal atomic
  Save implementation.  Its range and ownership checks are deliberately not a
  dependency of the panic path.
- `framework/vcs/lore.zig` is the verified `@cImport` binding for liblore 0.8.6.
  It already owns globals, identity, callback collection, and library health.
- `deps/lore/include/lore.h` is the only ABI authority.  No Lore structure may
  be mirrored by hand.
- Lore already runs persistently from `~/.local/share/loreserver`, under a
  boot-enabled user service and a prompt health hook.

## Gitea/edit-trail state found during survey

- Gitea 1.25.5 is already installed and answers HTTP health on port 29418.
- Its binary/config/data currently live below Homebrew rather than the intended
  durable per-user layout.
- `gitea.service` is enabled, but uses `Restart=on-failure`, `RestartSec=5`, and
  has no unlimited start policy.
- The existing `siah/reactjit-edit-trail` bare repository is corrupt: Gitea
  reports a zero-length object and `fatal: bad object main`.
- The active `fs-trail-watcher.py` maintains local `refs/heads/edit-trail` but
  the working repository has no `edittrail` remote, so background pushes have
  silently gone nowhere.
- The local edit-trail ref is live.  Its reflog contains one invalid historical
  entry; dangling objects are otherwise expected.
- The user explicitly declined preservation of the corrupt server's older
  history.  The replacement is seeded from the valid current branch and keeps
  no more than roughly two months; existing independent backups own anything
  older.
- User linger is enabled.  HTTP health alone is not an adequate durability
  proof; the gate is push + fetch + clean fresh clone.

## Gitea/edit-trail resolved state

- Gitea now uses the durable per-user store and an always-restarting,
  boot-enabled user service.
- The watcher uses a private index, removes tracked-now-ignored entries without
  touching live files, stages only eligible tracked/untracked paths, and pushes
  every new edit-trail tip to Gitea.
- Local and server tips are the same sanitized parentless root
  `7f834645db7a6fe1b117887c4ff38a6d0a46cada`; a fresh clone contains no
  ignored model, Lore, or userdata paths.
- Only the four managed edit-trail reflogs participate in rotation. Ordinary
  refs and reflogs remain unchanged.
- Rotation begins a new epoch at 60 days. A two-day race-safety grace precedes
  physical object pruning, bounding stored edit-trail history to roughly
  62–63 days instead of retaining it indefinitely.
- The 60-day policy is scoped to the high-frequency Gitea trail. Lore's manual
  and pinned model snapshots are independent and are not aged out with it.

## Build and host integration

- `framework/v8_ingredients.zig` and `framework/v8_app.zig` already have
  unrelated in-flight edits; Lore wiring must be surgical.
- `build.zig` is source-driven for optional native capabilities.  Lore should
  link only when a `__lore_` door is consumed.
- The shared library is locally present at `deps/lore/lib/liblore.so` but is
  ignored.  A deterministic fetch script is needed for a fresh clone.
- React is only the declarative consumer.  Revision creation, metadata,
  preview, restore, pinning, and status live in Zig.

## Constraints

- No game 3D model is committed.
- The 18 GB corrupt Gitea repository is not copied into the replacement store.
- No `git add -A`; explicit staging only in the shared dirty tree.
- A panic snapshot is independent from normal Save validation.
- Preview must never checkout or mutate the resident model.
- Restore is explicit and must not masquerade as preview.
- UI design is out of scope for this leg.
- Automated success is not enough: the final gate compares a real resident
  encoding with the bytes recovered from the Lore revision.
