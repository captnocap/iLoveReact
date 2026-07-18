# Zig 0.16 API and capability rules

Read this before changing standard-library calls under `framework/`. Zig 0.16
postdates current model training, so the checked-in compiler is authoritative:
`tools/zig/zig` and its `lib/std/` tree.

## The rule: capabilities enter at roots and remain explicit

Blocking work, clocks, sleep, randomness, processes, files, and networking use
an injected `std.Io`. Environment reads use an injected
`*const std.process.Environ.Map`. Allocating owners receive an allocator.

- Binary roots take `std.process.Init` and build `framework/host_context.zig`.
- Ordinary Zig functions accept `io`, `environ`, an allocator, or `*HostContext`
  explicitly. Prefer `io` as the first parameter, matching the standard library.
- Long-lived resource objects may store the capabilities supplied to their
  constructor. They must not discover or manufacture them later.
- V8's fixed C callback ABI recovers `HostContext` from the isolate embedder
  slot. This is a foreign-callback boundary, not permission for ordinary code to
  consult a global.
- Standalone tests use `std.testing.io` and an explicit test environment map.

Forbidden:

- `std.Io.Threaded.global_single_threaded`
- a project-wide `io()` accessor or 0.15-shaped compatibility facade
- inline copies of such a facade in standalone test roots
- copied old-standard-library networking or syscall modules
- storing `Io` in an unrelated global merely to avoid changing signatures

The former `host_io.zig`, `net/netx.zig`, and `net/sysx.zig` compatibility
layers were deleted. Do not recreate them.

## Common 0.16 shapes

- Clock: `std.Io.Clock.now(.awake, io)` for monotonic work and `.real` for
  wall-clock timestamps. For elapsed time, retain a
  `std.Io.Clock.Timestamp.now(io, .awake)` and call `untilNow(io)` or
  `durationTo`; Zig 0.16 has no `std.time.Timer` replacement object.
- Sleep: `std.Io.sleep(io, duration, .awake)`.
- Synchronization and tasks: `std.Io.Mutex`, `std.Io.Condition`,
  `std.Io.Event`, `std.Io.Queue(T)`, and `std.Io.Group`. A frame-facing API
  must not poll raw nonblocking descriptors; put the blocking operation in a
  cancelable group task and drain a bounded queue from the frame.
- Environment and argv: use `init.environ_map` and
  `std.process.Args.Iterator.init(init.minimal.args)` at the root, then pass
  the resulting data down.
- Filesystem: `std.Io.Dir` / `std.Io.File`; operations take `io` first.
  Examples: `dir.openFile(io, path, opts)`, `file.close(io)`,
  `file.writeStreamingAll(io, bytes)`, and
  `file.readPositionalAll(io, buffer, 0)`.
- Streams: use `std.Io.Reader` / `std.Io.Writer`. For allocated formatting,
  use `std.Io.Writer.Allocating` and read `.written()`.
- Collections: `std.ArrayList` and the `std.array_hash_map` types (including
  `std.json.ObjectMap`) are unmanaged: initialize with `.empty` and pass the
  allocator to mutating/deinit methods. `std.HashMap`, `std.AutoHashMap`, and
  `std.StringHashMap` remain managed wrappers initialized with `.init(allocator)`.
- Processes: `std.process.spawn(io, options)`, then `child.wait(io)` or
  `child.kill(io)`. Drain piped stdout/stderr concurrently so children cannot
  deadlock on a full pipe.
- Networking: use `std.Io.net`. `framework/net/transport.zig` demonstrates the
  repository pattern: native blocking streams/listeners owned by `std.Io.Group`
  pumps, with bounded queues for frame-friendly drains.
- Randomness: `io.random(buffer)`; key-generation APIs receive `io`.

`std.fs.path` helpers and `std.fs.max_path_bytes` are namespace-only helpers;
they do not perform I/O and do not need a capability.

## Narrow platform boundaries

A direct libc/POSIX call is allowed only where the Zig 0.16 standard library
does not model the operation or a foreign ABI fixes the function signature,
for example signal handlers, terminal attribute configuration, or a C library
callback. Keep the boundary local, document why it exists, and route all
surrounding file/network/process work through `std.Io`. A platform boundary is
not an excuse to copy an old std module or rebuild a readiness loop.

## Gates

- `./verify-zig016-editor.sh` — editor feature closure, binaries, and tests
- `./verify-zig016-tests.sh` — test suite
- `./verify-zig016-bins.sh` — binary closure
- `./verify-zig016-lane0.sh` — foundational subset

Lazy analysis can hide bad callsites. A grep audit is useful, but the applicable
feature closure must compile before a migration is considered complete.
