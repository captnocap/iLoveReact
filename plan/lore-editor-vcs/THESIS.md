# Thesis

## Target shape

One native `SnapshotService` sits between the resident mesh session and Lore.
It has two policy entry points over one byte-producing core:

1. **Panic snapshot** captures the native resident model immediately, writes a
   recoverable current-format artifact without consulting the ordinary Save
   guards, then records it as a Lore revision with browse metadata.
2. **Normal save snapshot** runs only after the editor's normal transactional
   Save succeeds, records the same current-format artifact, and may synchronize
   with the server.

The service is exposed through a small `__lore_*` host surface.  History reads
canonical committed event records, pins live in a committed registry, and
preview privately materializes bytes at a revision without a checkout. Restore
is an explicit package-artifact operation; reloading an open native session is
left to the future browser UI. Server status includes both process reachability
and durable store size.

The edit-trail has an independent durable Gitea home.  Its server process can
restart forever, prompt hooks make outages visible, and a verified remote clone
proves that the branch is actually off-machine-process rather than merely in a
local reflog.

## Done standard

- Gitea uses the durable per-user store, runs at boot, restarts indefinitely,
  and the hook is silent healthy / diagnostic unhealthy while always exiting 0.
- Local `edit-trail` pushes to Gitea, fetches back, and fresh-clones with a valid
object graph.

The edit trail is intentionally short-horizon. Local and server reflogs expire
at 60 days and unreachable objects are pruned, so the high-frequency trail does
not become another permanent backup. This policy does not apply to manual or
pinned Lore model snapshots.
- A live native model can be panic-snapshotted even when ordinary Save policy is
  not involved.
- History returns the committed timestamp, triangle count, part count,
  label/note, and pin state without trusting mutable index metadata.
- Preview returns revision bytes without changing the open model; restore is
  explicit; pin updates are durable.
- A successful normal Save creates its Lore revision through the same service.
- Carts that do not consume a `__lore_` function do not link liblore.
- Focused Zig tests and a ReleaseFast editor build pass.
- Real round-trip proof establishes byte identity between resident encode and
  Lore preview after snapshot.
