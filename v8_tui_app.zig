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
//! The bundle path is wired via build_options.bundle_path; @embedFile takes
//! it as a comptime literal. Mirrors v8_app.zig's BUNDLE_FILE_NAME pattern.

const std = @import("std");
const v8rt = @import("framework/v8_runtime.zig");
const cli_bindings = @import("framework/v8_bindings_cli.zig");
const build_options = @import("build_options");

const HAS_TERMINAL = @hasDecl(build_options, "has_terminal") and build_options.has_terminal;
const vterm_bindings = if (HAS_TERMINAL) @import("framework/v8_bindings_vterm.zig") else struct {
    pub fn registerAll() void {}
};

// Worker bindings — claude_code / codex / kimi / local_ai / openai_compat
// SDK back-ends powering useAssistant. Pulled in unconditionally so a
// cart can pick any backend; libcurl is the only extra link cost
// (libllama is dlopen'd at runtime, no link-time dep).
const worker_bindings = @import("framework/worker_bindings.zig");

// Default to "bundle.js" (next to source) when bundle-path isn't passed,
// matching v8_app's behavior. Real builds always pass an absolute path.
const BUNDLE_FILE_NAME = if (@hasDecl(build_options, "bundle_path") and build_options.bundle_path.len > 0)
    build_options.bundle_path
else
    "bundle.js";

const BUNDLE_BYTES = @embedFile(BUNDLE_FILE_NAME);

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
    // Assistant SDK bindings — powers runtime/hooks/useAssistant for the
    // five supported backends.
    worker_bindings.register();

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
