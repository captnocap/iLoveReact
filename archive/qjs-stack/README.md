# archive/qjs-stack/

Smith-era QuickJS runtime + LuaJIT script-block evaluator. Evicted from `framework/` on 2026-05-08 because **no V8 cart actually used these paths**, but they were still being compiled into every cart binary.

## What's in here

| File | Was | Lines |
|------|-----|------:|
| `qjs_app.zig` | repo root | 80K |
| `qjs_runtime.zig` | `framework/` | 181K |
| `qjs_bindings.zig` | `framework/` | 54K |
| `qjs_ipc.zig` | `framework/` | 8.8K |
| `qjs_semantic.zig` | `framework/` | 16K |
| `qjs_value.zig` | `framework/` | 10.7K |
| `qjs_c.zig` | `framework/` | 820B |
| `luajit_runtime.zig` | `framework/` | 82K |
| `luajit_runtime_bridge.zig` | `framework/` | 3K |
| `luajit_runtime_test.zig` | `framework/` | 1.2K |

These speak QuickJS-the-engine and LuaJIT-the-script-evaluator. Both were the runtime layer underneath the `.tsz` Smith compiler era.

## Why moved (not deleted)

V8 carts hit the `js_on_*` handler path in the React reconciler. The `lua_on_*` and QJS-eval branches that these files implement are unreachable from any V8 cart at runtime. But:

- Files in this tree were still being compiled and linked into every V8 cart binary.
- That dragged libluajit-5.1 (~1.5MB) + the QuickJS C sources (cutils.c / dtoa.c / libregexp.c / libunicode.c / quickjs.c / quickjs-libc.c, ~600KB compiled) into every browser/icon_bench/chat-cart bundle.
- Multiple "delete the QJS path" attempts in the past hit pushback because some live state (terminal-dock-resize, frame telemetry counters, prepared-input coords) was housed inside `qjs_runtime.zig` even though it had nothing to do with QJS itself.

The eviction approach: move the files here, let `zig build` enumerate every reference, then for each:

1. **Smith-era dead branch** — delete the call site (e.g. `if (handlers.lua_on_*) ...` in engine.zig).
2. **Mis-housed live state** — give the state a proper home (e.g. terminal-dock-resize → `framework/terminal_dock.zig`).
3. **V8 has a parallel** — swap `qjs_runtime.X` for `v8_runtime.X`.

## Active framework files that referenced the moved modules

(at time of eviction, before fixups — for grep traceability)

- `framework/core.zig` — re-exported as part of public FFI surface
- `framework/lib.zig` — same
- `framework/v8_bindings_core.zig` — read prepared mouse/scroll state
- `framework/v8_bindings_fs.zig` — terminal-dock-resize state
- `framework/v8_bindings_telemetry.zig` — frame timing counters
- `framework/dev_ipc.zig` — telemetry counters
- `framework/applescript.zig` — registered QJS host fns
- `framework/pty_client.zig` — registered QJS host fns
- `framework/audio_real.zig` — registered QJS host fns (only when `has-audio`)
- `framework/cartridge.zig` — `evalScript` of bundle bytes
- `framework/windows.zig` — JS event eval bridge
- `framework/input.zig` — already gated on `HAS_QUICKJS`, falls back to `v8_runtime`
- `framework/engine.zig` — luajit_runtime initVM/tick + lua_on_* handler eval branches

## Build pipeline removed

`build.zig`'s QuickJS C source compilation:
```zig
root_mod.addCSourceFiles(.{
    .root = b.path("love2d/quickjs"),
    .files = &.{ "cutils.c", "dtoa.c", "libregexp.c", "libunicode.c", "quickjs.c", "quickjs-libc.c" },
    .flags = &.{ "-O2", "-D_GNU_SOURCE", "-DQUICKJS_NG_BUILD" },
});
```
…removed once nothing reaches into QuickJS C any more. The C sources in `love2d/quickjs/` stay where they are (the whole `love2d/` tree is frozen reference) but they no longer get compiled into cart binaries.

## How to revive

If a future cart needs QuickJS or the Smith-era Lua evaluator: copy what's needed back into `framework/` (or better, into a properly-named subsystem dir), don't touch this archive in place. The whole point is that this directory is a frozen snapshot, not a live dependency.
