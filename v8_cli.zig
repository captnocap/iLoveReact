//! v8cli — a minimal V8 host that runs a JS file.
//!
//! Usage:  v8cli <script.js> [script-args...]
//!
//! Exposes `__*` host functions (see framework/v8_bindings_cli.zig) for fs,
//! process, child-process, and unix-socket ops. Scripts consume them directly;
//! no node-shaped API mimicry.
//!
//! This is the runtime that replaces `node scripts/X.mjs` invocations. No npm,
//! no node, no bun — just V8 and Zig.

const std = @import("std");
const v8rt = @import("framework/v8_runtime.zig");
const host_io = @import("framework/host_io.zig");
const sysx = @import("framework/net/sysx.zig");
const cli_bindings = @import("framework/v8_bindings_cli.zig");
const fs_bindings = @import("framework/v8_bindings_fs.zig");
const sqlite_bindings = @import("framework/v8_bindings_sqlite.zig");
const localstore_bindings = @import("framework/v8_bindings_localstore.zig");

pub fn main(init: std.process.Init) !void {
    host_io.args = init.minimal.args;
    var gpa = std.heap.DebugAllocator(.{}){};
    defer _ = gpa.deinit();
    const alloc = gpa.allocator();

    const raw_argv = try host_io.argsAlloc(alloc);
    defer host_io.argsFree(alloc, raw_argv);

    if (raw_argv.len < 2) {
        const msg = "usage: v8cli <script.js> [args...]\n";
        _ = sysx.write(2, msg) catch {};
        std.process.exit(2);
    }

    const script_path = raw_argv[1];

    // Script argv = [script_path, ...rest]. Matches node's convention
    // (process.argv[0] = runtime, [1] = script, [2..] = args); we drop [0]
    // entirely since scripts don't need the cli binary path.
    const script_argv = alloc.alloc([]const u8, raw_argv.len - 1) catch {
        _ = sysx.write(2, "v8cli: oom\n") catch {};
        std.process.exit(1);
    };
    defer alloc.free(script_argv);
    for (raw_argv[1..], 0..) |a, i| script_argv[i] = a;

    // Read the script. No module/import resolution; scripts must be
    // self-contained. (The three scripts we're porting are ~100 lines each
    // and don't import anything internal.)
    const source = std.Io.Dir.cwd().readFileAlloc(host_io.io(), script_path, alloc, .limited(32 * 1024 * 1024)) catch |e| {
        var buf: [512]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "v8cli: cannot read {s}: {s}\n", .{ script_path, @errorName(e) }) catch "v8cli: read error\n";
        _ = sysx.write(2, msg) catch {};
        std.process.exit(1);
    };
    defer alloc.free(source);

    // Boot V8 + install bindings, then eval the script.
    v8rt.initVM();
    defer v8rt.teardownVM();

    cli_bindings.setArgv(@constCast(script_argv));
    cli_bindings.registerAll();
    // Build scripts always need fs. cli no longer shadows __fs_* with
    // un-prefixed names, so register fs explicitly here.
    fs_bindings.registerFs({});
    // __sql_* rides along like fs: storage/sqlite.zig dlopens libsqlite3 at
    // first use, so registration is free when the library is absent. The P4
    // suites (rjit game verify) run under v8cli and the V20 data store is
    // sqlite-backed (STOREDB-0606) — the tests need the same surface the
    // cart host has.
    sqlite_bindings.registerSqlite({});
    // __localstore* over the SAME localstore.db the editor host writes — lets a
    // headless script (the rjit game bake compile pipeline) read editor state
    // like custom Materialized materials. Best-effort: empty store if unopenable.
    localstore_bindings.initStore();
    localstore_bindings.registerLocalstore({});
    // SIGINT/SIGTERM/SIGHUP → kill tracked children before exiting. Prevents
    // Ctrl-C on scripts/dev from orphaning the esbuild watch child.
    cli_bindings.installSignalHandlers();

    // Install a minimal `console` shim so scripts can use console.log/error.
    // The underlying writes go to __writeStdout / __writeStderr.
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

    const ok = v8rt.evalScriptChecked(source);
    if (!ok) std.process.exit(1);
}
