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
//! Optional V8 bindings (httpsrv, wssrv, process, net, sdk) are gated by
//! the same `-Dhas-*` flags ship/ship-tui derive from the cart's bundle
//! metafile. Same source-driven feature gates as the GPU app.

const std = @import("std");
const v8rt = @import("framework/v8_runtime.zig");
const v8_runtime = v8rt;
const cli_bindings = @import("framework/v8_bindings_cli.zig");
const build_options = @import("build_options");
const v8 = @import("v8");

const HAS_TERMINAL = @hasDecl(build_options, "has_terminal") and build_options.has_terminal;
const HAS_HTTPSRV = @hasDecl(build_options, "has_httpsrv") and build_options.has_httpsrv;
const HAS_WSSRV = @hasDecl(build_options, "has_wssrv") and build_options.has_wssrv;
const HAS_PROCESS = @hasDecl(build_options, "has_process") and build_options.has_process;
const HAS_NET = @hasDecl(build_options, "has_net") and build_options.has_net;
const HAS_SDK = @hasDecl(build_options, "has_sdk") and build_options.has_sdk;
const HAS_FS = @hasDecl(build_options, "has_fs") and build_options.has_fs;
const HAS_WINDOW = @hasDecl(build_options, "has_window") and build_options.has_window;

const host_window = if (HAS_WINDOW) @import("framework/v8_bindings_host_window.zig") else struct {
    pub fn register() void {}
    pub fn init(_: std.mem.Allocator) !void {}
    pub fn tickDrain() void {}
};

const vterm_bindings = if (HAS_TERMINAL) @import("framework/v8_bindings_vterm.zig") else struct {
    pub fn registerAll() void {}
    pub fn tickDrain() bool { return false; }
};
const httpsrv_bindings = if (HAS_HTTPSRV) @import("framework/v8_bindings_httpserver.zig") else struct {
    pub fn registerHttpServer(_: anytype) void {}
    pub fn tickDrain() void {}
};
const wssrv_bindings = if (HAS_WSSRV) @import("framework/v8_bindings_wsserver.zig") else struct {
    pub fn registerWsServer(_: anytype) void {}
    pub fn tickDrain() void {}
};
const process_bindings = if (HAS_PROCESS) @import("framework/v8_bindings_process.zig") else struct {
    pub fn registerProcess(_: anytype) void {}
    pub fn tickDrain() void {}
};
const net_bindings = if (HAS_NET) @import("framework/v8_bindings_net.zig") else struct {
    pub fn registerNet(_: anytype) void {}
    pub fn tickDrain() void {}
};
const sdk_bindings = if (HAS_SDK) @import("framework/v8_bindings_sdk.zig") else struct {
    pub fn registerSdk(_: anytype) void {}
    pub fn tickDrain() void {}
};
const fs_bindings = if (HAS_FS) @import("framework/v8_bindings_fs.zig") else struct {
    pub fn registerFs(_: anytype) void {}
};

// Worker bindings — claude_code / codex / kimi / local_ai / openai_compat
// SDK back-ends powering useAssistant. Pulled in unconditionally so a
// cart can pick any backend; libcurl is the only extra link cost
// (libllama is dlopen'd at runtime, no link-time dep).
const worker_bindings = @import("framework/assistant/worker_bindings.zig");

// Default to "bundle.js" (next to source) when bundle-path isn't passed,
// matching v8_app's behavior. Real builds always pass an absolute path.
const BUNDLE_FILE_NAME = if (@hasDecl(build_options, "bundle_path") and build_options.bundle_path.len > 0)
    build_options.bundle_path
else
    "bundle.js";

const BUNDLE_BYTES = @embedFile(BUNDLE_FILE_NAME);

// __tickDrain — pump every binding's per-tick work (accept new HTTP
// connections, deliver completed SDK requests, etc.). The GPU app
// calls each binding's tickDrain inline in its render loop; the TUI
// has no render loop on the Zig side, so the JS preamble's
// __runEventLoop calls this between timer firings.
fn hostTickDrain(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const vterm_drained = vterm_bindings.tickDrain();
    httpsrv_bindings.tickDrain();
    wssrv_bindings.tickDrain();
    process_bindings.tickDrain();
    net_bindings.tickDrain();
    sdk_bindings.tickDrain();
    // SDL3 event pump + repaint for any <Window> nodes the cart opened.
    // No-op when HAS_WINDOW is off (the if-comptime resolves to a stub).
    host_window.tickDrain();
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), if (vterm_drained) @as(f64, 1) else @as(f64, 0)));
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
    // Optional vterm bindings — only present when -Dhas-terminal=true.
    // No-op stub otherwise.
    vterm_bindings.registerAll();
    // Optional networking bindings — gated by `-Dhas-*` flags ship-tui
    // derives from the cart's bundle metafile.
    httpsrv_bindings.registerHttpServer({});
    wssrv_bindings.registerWsServer({});
    process_bindings.registerProcess({});
    net_bindings.registerNet({});
    sdk_bindings.registerSdk({});
    fs_bindings.registerFs({});
    // Assistant SDK bindings — powers runtime/hooks/useAssistant for the
    // five supported backends.
    worker_bindings.register();

    // Host-window binding — when HAS_WINDOW, registers __hostFlush so the
    // React reconciler stream flows into host_tree, and arms tickDrain to
    // pump SDL3 events + paint open <Window> surfaces. No-op stub when
    // HAS_WINDOW is false.
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
