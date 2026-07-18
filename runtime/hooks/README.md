# runtime/hooks — FFI wrappers

These modules are the typed React/TypeScript surface over host capabilities.
They do not implement filesystem, process, network, or persistence policy in
JavaScript; they marshal arguments to the Zig binding and translate completion
events back into hook state or promises.

The shared helpers live in `runtime/ffi.ts`: `hasHost`, `callHost`,
`callHostStrict`, `callHostJson`, and `subscribe`. Public exports are collected
in `runtime/hooks/index.ts`.

## Runtime model

V8 is the default runtime. The authoritative registration and feature-gating
table is `framework/v8_ingredients.zig`; each row points to the binding module
that owns the corresponding host functions. Search that table and the named
binding before changing a hook contract.

QuickJS is maintenance-only legacy. Its old registration notes are historical
and must not be used as implementation guidance for current hooks. See
`docs/v8/qjs.md` when maintaining that runtime specifically.

Common hook families map to these current host owners:

| TypeScript surface | Zig owner |
|---|---|
| `fs.ts`, file hooks | `framework/v8_bindings_fs.zig` |
| `localstore.ts`, `sqlite.ts`, `pg.ts` | local-store, SQLite, and PostgreSQL binding modules |
| `fetch.ts`, `useTheInternet.ts`, browse hooks | `framework/v8_bindings_sdk.zig` and `framework/net/http.zig` |
| `process.ts`, `useProcess.ts` | `framework/v8_bindings_process.zig` and `framework/process/process.zig` |
| `websocket.ts`, `useConnection.ts` | WebSocket/network binding modules and `framework/net/` owners |
| media, audio, voice, and terminal hooks | their source-gated binding modules in `framework/v8_ingredients.zig` |

## Zig 0.16 capability rule

All blocking host work uses capabilities supplied by the application root.
Fixed V8 callbacks recover `HostContext` from their own isolate and immediately
pass `std.Io`, the environment map, or another narrow capability to ordinary
Zig functions. Follow `framework/ZIG_016_API_NOTES.md`; do not add a global I/O
accessor or recreate a deleted Zig 0.15 API behind a project wrapper.

Frame-friendly asynchronous bindings use this ownership pattern:

1. A resource owner receives `std.Io` at construction.
2. Blocking reads, accepts, waits, and worker jobs run in cancelable
   `std.Io.Group` tasks.
3. Completion is published through a bounded queue owned by that resource.
4. The binding's `tickDrain(host)` emits completed events through `__ffiEmit`.
5. Teardown cancels or joins the task group before freeing owner state.

Raw `std.Thread` workers, `O_NONBLOCK` descriptor polling, and hand-rolled
readiness loops are not the general async pattern. A deliberately synchronous
host function may block only when its public contract says it is synchronous.

## Browser-shaped shims are opt-in

`installBrowserShims()` installs the fetch/EventSource, localStorage, WebSocket,
and resize bridges. Carts opt into it explicitly; `runtime/index.tsx` does not
install browser shims automatically because doing so would pull every backing
ingredient into every binary. Individual shims can also be installed from
their modules.

This is still not browser React: a shim is a small compatibility surface over a
registered host capability, not a DOM or browser runtime.

## Adding or changing a hook

1. Define the typed public contract in the relevant hook module.
2. Reuse an existing host function when it already expresses that capability.
3. Otherwise add the narrow Zig binding and register it in the binding module.
4. Add or update the `v8_ingredients.zig` row so source gating discovers the
   host-function prefix.
5. Test TypeScript behavior at the hook layer and Zig ownership/logic at the
   framework layer.

Do not duplicate a host function under a second name merely to make a wrapper
convenient. Keep the TypeScript adapter thin and the Zig boundary deep.
