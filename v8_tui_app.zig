//! v8_tui_app — self-contained TUI cart binary.
//!
//! Same shape as v8_cli.zig (V8 + cli bindings, no SDL/framework/UI), but
//! with the cart bundle baked in via @embedFile instead of read from argv.
//! Result: a single ELF/Mach-O that boots V8, evals the embedded bundle,
//! and runs the cart's TUI render loop on stdin/stdout.
//!
//! Built by `scripts/ship-tui <cart>`:
//!   1. esbuild  → tui/.cache/bundle-<name>.js   (TUI entry + cart aliased in)
//!   2. zig build tui-app -Dapp-name=<name> -Dbundle-path=<absolute path>
//!   3. zig-out/bin/<name> is the shippable binary.
//!
//! Binding surface comes from framework/v8_ingredients.zig — the same
//! INGREDIENTS catalog the GPU shell (v8_app.zig) consumes. What
//! compiles in is controlled per-cart by the metafile gate via -Dhas-X
//! flags. The TUI shell carries one extra registration on top of the
//! catalog: `worker_bindings.register()` (so useAssistant works without
//! the cart also ordering has-sdk; in v8_app worker_bindings rides on
//! v8_bindings_sdk.registerSdk).

const std = @import("std");
const v8rt = @import("framework/v8_runtime.zig");
const v8_runtime = v8rt;
const cli_bindings = @import("framework/v8_bindings_cli.zig");
const build_options = @import("build_options");
const v8 = @import("v8");
const reconciler_bindings = @import("framework/v8_bindings_reconciler.zig");
const ingredients = @import("framework/v8_ingredients.zig");

// host_window — opt-in <Window>/<Notification> support for TUI carts
// that want to paint a real SDL3 surface from inside an otherwise-ANSI
// binary. Gated on build_options.has_window. NOT part of the
// INGREDIENTS catalog because it owns SDL3 lifecycle (init + per-tick
// SDL_PumpEvents) that only matters when this opt-in flips on.
const host_window = if (@hasDecl(build_options, "has_window") and build_options.has_window)
    @import("framework/v8_bindings_host_window.zig")
else
    struct {
        pub fn register() void {}
        pub fn init(_: std.mem.Allocator) !void {}
        pub fn tickDrain() void {}
    };

// Worker bindings — claude_code / codex / kimi / local_ai / openai_compat
// SDK back-ends powering useAssistant. Registered unconditionally so a
// TUI cart can pick any backend; libllama is dlopen'd at runtime, so no
// link-time dep. In v8_app this rides on v8_bindings_sdk.registerSdk —
// the TUI shell calls it directly because TUI carts may not order
// has-sdk yet still want useAssistant.
const worker_bindings = @import("framework/assistant/worker_bindings.zig");

// Default to "bundle.js" (next to source) when bundle-path isn't passed,
// matching v8_app's behavior. Real builds always pass an absolute path.
const BUNDLE_FILE_NAME = if (@hasDecl(build_options, "bundle_path") and build_options.bundle_path.len > 0)
    build_options.bundle_path
else
    "bundle.js";

const BUNDLE_BYTES = @embedFile(BUNDLE_FILE_NAME);

// __tickDrain — pump every binding's per-tick work between timer firings.
// The GPU app calls ingredients.tickDrain inline in its render loop; the
// TUI has no Zig-side render loop, so the JS preamble's __runEventLoop
// calls this. host_window.tickDrain runs alongside because it owns SDL3
// event pumping for <Window> nodes (separate from the ANSI grid). The
// returned number is the vterm-drained signal that tui/v8-preamble.js
// uses to fire __onVtermUpdate without polling latency — propagated from
// ingredients.tickDrain()'s bool return.
fn hostTickDrain(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const drained = ingredients.tickDrain();
    // SDL3 event pump + repaint for any <Window> nodes the cart opened.
    // No-op when has_window is off (the if-comptime resolves to a stub).
    host_window.tickDrain();
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), if (drained) @as(f64, 1) else @as(f64, 0)));
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const alloc = gpa.allocator();

    // process.argv[0] = bundle name (matches scripts/tui's "v8cli bundle"
    // convention so cart code reading process.argv stays compatible).
    // process.argv[1..] = the user's command-line args.
    const raw_argv = try std.process.argsAlloc(alloc);
    defer std.process.argsFree(alloc, raw_argv);

    const script_argv = try alloc.alloc([]const u8, raw_argv.len);
    defer alloc.free(script_argv);
    script_argv[0] = if (@hasDecl(build_options, "app_name")) build_options.app_name else "tui-app";
    for (raw_argv[1..], 1..) |a, i| script_argv[i] = a;

    v8rt.initVM();
    defer v8rt.teardownVM();

    cli_bindings.setArgv(@constCast(script_argv));
    cli_bindings.registerAll();
    cli_bindings.installSignalHandlers();

    // All host-fn binding registration — required (core/eventbus/ifttt/
    // env/window/inspector) plus opt-in (fs/ws/tel/process/net/sdk/pg/
    // embed/whisper/voice/audio/midi/vterm/...). The catalog is shared
    // with v8_app; what actually compiles in is controlled per-cart by
    // the metafile gate via -Dhas-X flags. See
    // framework/v8_ingredients.zig for the contract.
    ingredients.registerAll();

    // __hostFlush — single binding shared with the GPU shell. Default
    // mode is `.sync`: payloads land in host_tree.applyCommandBatch
    // inline. The TUI binary has no Zig-side paint loop to coordinate
    // with, so there's nothing to defer.
    reconciler_bindings.register();

    // Assistant SDK bindings — register directly so useAssistant works
    // for any TUI cart, even ones that don't order has-sdk (in v8_app
    // worker_bindings rides on registerSdk; we can't rely on that path
    // here without adding worker_bindings as its own catalog row).
    worker_bindings.register();

    // Host-window binding — when has-window, arms tickDrain to pump
    // SDL3 events + paint open <Window> surfaces. No-op stub when
    // has-window is false.
    try host_window.init(std.heap.c_allocator);
    host_window.register();

    // __tickDrain — called between timer firings by tui/v8-preamble.js
    // to advance binding-side async work (accept new connections, etc.).
    v8_runtime.registerHostFn("__tickDrain", hostTickDrain);

    // Same minimal console + process shim v8_cli installs. Carts then layer
    // tui/v8-preamble.js on top via the bundle's first line.
    v8rt.evalScript(
        \\globalThis.console = {
        \\  log:   (...args) => __writeStdout(args.map(fmtArg).join(' ') + '\n'),
        \\  info:  (...args) => __writeStdout(args.map(fmtArg).join(' ') + '\n'),
        \\  warn:  (...args) => __writeStderr(args.map(fmtArg).join(' ') + '\n'),
        \\  error: (...args) => __writeStderr(args.map(fmtArg).join(' ') + '\n'),
        \\};
        \\function fmtArg(a) {
        \\  if (typeof a === 'string') return a;
        \\  if (a === null) return 'null';
        \\  if (a === undefined) return 'undefined';
        \\  if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
        \\  return String(a);
        \\}
        \\globalThis.process = {
        \\  get argv() { return JSON.parse(__argv()); },
        \\  env: new Proxy({}, { get: (_, k) => __env(String(k)) }),
        \\  exit: (code) => __exit(code | 0),
        \\  cwd: () => __cwd(),
        \\  platform: 'linux',
        \\};
    );

    const ok = v8rt.evalScriptChecked(BUNDLE_BYTES);
    if (!ok) std.process.exit(1);
}
