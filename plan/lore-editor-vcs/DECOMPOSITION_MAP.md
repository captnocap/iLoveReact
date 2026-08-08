# Decomposition map

| Unit | Owns | Must not own | Fragility |
|---|---|---|---|
| Gitea service/store | process lifetime, persistent config/data | editor model history | high: existing corrupt repo |
| edit-trail watcher | eligible local snapshot commit + remote push | ignored/model/Lore/userdata payloads | high: one refused ignored path previously stopped every snapshot |
| edit-trail retention | exact managed-ref epoch rotation, grace debt, low-priority GC | ordinary refs/reflogs or Lore snapshots | high: hidden unreachable objects can defeat a nominal age limit |
| `vcs/lore.zig` | exact C ABI adapters and event collectors | mesh/session policy | high: callback-owned strings |
| `vcs/snapshot.zig` | resident encode, commit metadata, history, preview, restore, pin | React presentation | very high: user recovery boundary |
| `v8_bindings_lore.zig` | argument validation and compact JSON doors | revision algorithms | medium |
| V8 ingredient/build wiring | optional registration/link/copy/rpath | feature behavior | high: shared dirty files |
| editor Save coordinator | invoking normal snapshot after successful Save | encoding or Lore calls | medium |
| fetch script | deterministic liblore acquisition/integrity | runtime installation | medium |
| focused tests | ABI-independent service invariants and bridge contract | fake disk-copy success | high |

## High-fragility boundaries

- Lore strings are library-owned inside callbacks and must be copied before the
  callback returns.
- Synchronous Lore calls may use stack collectors; async twins may not.
- A revision id is not accepted until commit/history rereads it.
- Gitea `/api/healthz` does not prove Git object health.
- Resident snapshot ownership ends only after every derived encode/metadata
  value has been copied.
- A panic snapshot returning success without byte/hash reread proof is a bug.
- Edit-trail retention is not proven until managed reflogs expire and a
  disposable local+bare-server test physically prunes old objects while
  preserving unrelated recovery history.
