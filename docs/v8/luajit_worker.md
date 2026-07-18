# LuaJIT worker pipeline

The active worker lives at `framework/process/luajit_worker.zig`. It is a
compute-only LuaJIT VM scheduled through the host's injected Zig 0.16
`std.Io`. It is not the browser Worker API and it must not touch V8 handles,
React state, rendering, layout, or the node tree.

## Capability and task ownership

The application root creates `std.process.Init`. V8 stores its `HostContext`
in the isolate embedder slot, and each `__lua_*` callback recovers that context
from its own isolate. Operations that need I/O call the worker's typed Zig API:

```zig
luajit_worker.available(host.io)
luajit_worker.start(host.io)
luajit_worker.send(host.io, count)
luajit_worker.stop(host.io)
```

There is no process-global I/O handle, context-free `lua_worker_*` C export,
raw `std.Thread`, or compatibility shim. `start` submits `workerMain(io)` to an
`std.Io.Group`; `stop` clears the running flag and awaits that group before
teardown.

Lua's fixed C callback ABI cannot carry a Zig parameter directly. The worker
therefore creates a stack-lifetime `LuaStateOwner` for each Lua state. It holds
the injected `std.Io`, the loaded Lua function table, and pointers to the
bridge state. Every host callback is installed as a Lua 5.1 closure with that
owner as a light-userdata upvalue. The callback recovers its owner from the
incoming `lua_State`; it never consults ambient process state.

```text
std.process.Init
    -> HostContext in V8 isolate
    -> __lua_start callback
    -> luajit_worker.start(host.io)
    -> std.Io.Group.concurrent(workerMain, io)
    -> LuaStateOwner captured by Lua closures
```

## JS host surface

`framework/v8_bindings_lua.zig` exposes:

- `__lua_available()` — whether a LuaJIT shared library can be loaded.
- `__lua_start()` / `__lua_stop()` — start or join the worker task.
- `__lua_eval(code)` — install the script used by the next start.
- `__lua_send(count)` / `__lua_recv_count()` — counter-mode work and results.
- `__lua_set_n(n)` / `__lua_elapsed_us()` — counter tuning and measured latency.
- `__lua_send_msg(text)` / `__lua_recv_msg()` — copied message queues.

The binding calls Zig functions directly. It does not use `extern` declarations
or depend on linker-retained worker symbols.

## Data paths

Counter mode uses atomics:

```text
main/V8 -> inbox total -> Lua host_recv()
Lua host_ack(n) -> outbox total -> main/V8
```

The default script performs a small compute loop for each pending unit, then
acknowledges the batch. `send(io, count)` timestamps the submission with the
injected monotonic clock; `host_ack` timestamps completion through the
per-state owner's `io`.

Message mode uses two fixed single-producer/single-consumer rings:

```text
main/V8 -> message inbox -> host_recv_msg()
host_send_msg(text) -> message outbox -> main/V8
```

Each message is capped at 512 bytes and each ring contains 1024 slots. A full
ring rejects the push. The installed script buffer is capped at 16 KiB and is
read when the worker starts; changing it does not mutate an already-running
Lua state.

## Lifecycle rules

- Call `start(io)` only through an owner that can later call `stop(io)` with
  the same host capability.
- Custom scripts must return when `host_running()` becomes false. A Lua call
  that never returns is inherently non-cancelable; `stop` cannot complete
  until the script cooperates.
- The Lua state and `LuaStateOwner` live entirely inside `workerMain` and are
  destroyed only after the task finishes.
- Bridge state crosses tasks only through atomics or copied fixed-size slots.
- Engine telemetry calls `takeTelemetry()` and owns formatting/output; the
  worker does not reach into the engine logger.

## Loading and verification

LuaJIT is loaded lazily with the platform dynamic-loader API. Absence is a
normal condition: `available` returns false and `start` returns `-1`.

The focused test exercises the real shared library, executes a Lua callback,
stops and awaits the `std.Io.Group`, and verifies that the callback updated the
bridge through its captured owner:

```sh
tools/zig/zig test framework/process/luajit_worker.zig -lc -ldl
```

Relevant source:

- `framework/process/luajit_worker.zig` — worker, owner, queues, typed API.
- `framework/v8_bindings_lua.zig` — V8 callback boundary.
- `framework/engine.zig` — telemetry consumer.
