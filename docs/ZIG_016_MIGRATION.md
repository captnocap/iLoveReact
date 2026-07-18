# Zig 0.15.2 → 0.16.0 migration record

Status: **landed and corrected** on 2026-07-18.

This document records the architectural result. The original migration plan is
superseded: its proposed global `host_io` facade and copied 0.15 networking
layer violated Zig 0.16's capability model and created a repository dialect
that looked like 0.15 while claiming to be 0.16.

## Final architecture

Every binary root receives `std.process.Init` and constructs a
`framework/host_context.zig` containing:

- `std.Io`
- the general-purpose allocator and arena
- `std.process.Environ.Map`
- process arguments

The root passes that context into the engine/runtime. Subsystems receive the
smallest capability set they need in function signatures, normally `io` first,
or retain capabilities in a resource owner created at that boundary.

V8 callbacks are the one common fixed-signature boundary. The root installs its
`HostContext` in the isolate embedder slot; a C callback recovers it from that
specific isolate and immediately passes capabilities to ordinary Zig code.

There is no process-wide project accessor and no second `Io` instance.

## Blocking work and frame-friendly APIs

Zig 0.16's file, process, and network calls are allowed to block because the
`std.Io` implementation owns scheduling and cancellation. The framework keeps
its nonblocking frame contract by changing ownership, not by recreating old
syscalls:

1. A resource receives `io` at construction.
2. Blocking accept/read/wait work runs in a cancelable `std.Io.Group` task.
3. The task publishes into a bounded `std.Io.Queue` or bounded owner queue.
4. The frame drains already-completed data without blocking.
5. Teardown cancels or signals the group, waits for ownership to return, and
   then closes resources.

`framework/net/transport.zig`, the process owner, async exec owner, pose and
Whisper workers, render surfaces, and serial input use this shape.

## Removed compatibility debt

The correction deleted:

- `framework/host_io.zig`
- `framework/net/netx.zig`
- `framework/net/sysx.zig`

Networking now uses `std.Io.net`. Files, clocks, sleep, environment, processes,
randomness, mutexes, and queues use their native 0.16 APIs with explicit
capabilities. Standalone tests use `std.testing.io` rather than a hidden
process-wide runtime.

No replacement compatibility facade is permitted. See
`framework/ZIG_016_API_NOTES.md` for the enforceable rules and current API
shapes.

## Legitimate platform boundaries

Some operations are outside the standard library's modeled surface or are
entered through a foreign ABI. Examples include async-signal-safe crash writes,
termios configuration, SDL/C callbacks, and selecting a specific signal for a
child already owned by a native wait task. These sites are narrow and locally
documented. They do not own general filesystem/network/process policy and must
not grow into copied compatibility modules.

## Verification

The authoritative compiler is `tools/zig/zig`. Completion requires all of:

```bash
./verify-zig016-editor.sh
./verify-zig016-tests.sh
./verify-zig016-bins.sh
./verify-zig016-lane0.sh
```

The editor gate intentionally enables the real development-host feature
closure. This matters because Zig's lazy analysis can leave a stale function
body invisible in a smaller build.

Useful debt audits:

```bash
rg 'host_io|global_single_threaded|netx\.zig|sysx\.zig' framework
rg 'std\.posix\.getenv|std\.crypto\.random' framework
```

Both should be empty except for prose that explicitly bans the patterns.
