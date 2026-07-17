//! V8 host bindings for CLI-mode scripts (bundler, dev-push, watcher).
//!
//! Deliberately has NO imports from the rest of framework/ — no engine, no
//! windows, no canvas. This file is safe to link into a standalone V8 host
//! that runs a JS file without any SDL/GPU/UI baggage.
//!
//! Surface is plain __xxx host functions. Scripts consume them directly; we
//! don't try to mimic node's fs/process/child_process shapes.

const std = @import("std");
const host_io = @import("host_io.zig");
// ZIG_016_MIGRATION §6 exemption (door b): this file is part of the hand-rolled
// nonblocking readiness loop and stays on raw posix-shaped syscalls via sysx
// (0.15-faithful wrappers). Do NOT migrate to std.Io.net.
const sysx = @import("net/sysx.zig");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const hotstate = @import("state/hotstate.zig");

extern fn getpid() c_int;
extern fn usleep(usec: c_uint) c_int;

// ── argv storage (set by v8_cli main before eval) ─────────────────────
var g_argv_storage: [][]const u8 = &.{};

/// Called from main before evalScript. argv is the SCRIPT's argv — excludes
/// the cli binary path; argv[0] is the script path, argv[1..] are its args.
pub fn setArgv(args: [][]const u8) void {
    g_argv_storage = args;
}

// ── helpers (copied patterns from v8_bindings_fs, kept local) ──────────

fn currentContext(info: v8.FunctionCallbackInfo) v8.Context {
    return info.getIsolate().getCurrentContext();
}

fn argStringAlloc(alloc: std.mem.Allocator, info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (info.length() <= idx) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const str = info.getArg(idx).toString(ctx) catch return null;
    const len = str.lenUtf8(iso);
    const buf = alloc.alloc(u8, len) catch return null;
    _ = str.writeUtf8(iso, buf);
    return buf;
}

fn argF64(info: v8.FunctionCallbackInfo, idx: u32, default: f64) f64 {
    if (info.length() <= idx) return default;
    const ctx = info.getIsolate().getCurrentContext();
    const n = info.getArg(idx).toF64(ctx) catch return default;
    return n;
}

fn argI32(info: v8.FunctionCallbackInfo, idx: u32, default: i32) i32 {
    return @intFromFloat(argF64(info, idx, @floatFromInt(default)));
}

fn setValue(info: v8.FunctionCallbackInfo, value: anytype) void {
    info.getReturnValue().set(value);
}

fn setUndefined(info: v8.FunctionCallbackInfo) void {
    setValue(info, v8.initUndefined(info.getIsolate()).toValue());
}

fn setNull(info: v8.FunctionCallbackInfo) void {
    setValue(info, v8.initNull(info.getIsolate()).toValue());
}

fn setBool(info: v8.FunctionCallbackInfo, value: bool) void {
    setValue(info, v8.Boolean.init(info.getIsolate(), value));
}

fn setNumber(info: v8.FunctionCallbackInfo, value: anytype) void {
    const num: f64 = switch (@typeInfo(@TypeOf(value))) {
        .float => @floatCast(value),
        .int, .comptime_int => @floatFromInt(value),
        else => @compileError("setNumber only supports ints and floats"),
    };
    setValue(info, v8.Number.init(info.getIsolate(), num));
}

fn setString(info: v8.FunctionCallbackInfo, value: []const u8) void {
    const iso = info.getIsolate();
    setValue(info, v8.String.initUtf8(iso, value));
}

fn appendJsonEscaped(out: *std.ArrayList(u8), alloc: std.mem.Allocator, s: []const u8) !void {
    try out.append(alloc, '"');
    for (s) |ch| {
        switch (ch) {
            '"' => try out.appendSlice(alloc, "\\\""),
            '\\' => try out.appendSlice(alloc, "\\\\"),
            '\n' => try out.appendSlice(alloc, "\\n"),
            '\r' => try out.appendSlice(alloc, "\\r"),
            '\t' => try out.appendSlice(alloc, "\\t"),
            0...8, 11, 12, 14...31 => {
                var hex_buf: [8]u8 = undefined;
                try out.appendSlice(alloc, try std.fmt.bufPrint(&hex_buf, "\\u{x:0>4}", .{ch}));
            },
            else => try out.append(alloc, ch),
        }
    }
    try out.append(alloc, '"');
}

// Parse a JS array-of-strings argument that the script passed as JSON text.
// Scripts pass argv arrays via JSON.stringify because it's simpler than
// marshalling real JS arrays through the bindings layer.
fn parseStringArrayJson(alloc: std.mem.Allocator, json_text: []const u8) ?[][]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, alloc, json_text, .{}) catch return null;
    defer parsed.deinit();
    if (parsed.value != .array) return null;
    const arr = parsed.value.array;
    const out = alloc.alloc([]u8, arr.items.len) catch return null;
    var count: usize = 0;
    for (arr.items) |item| {
        if (item != .string) {
            // Rollback on malformed entry.
            for (out[0..count]) |s| alloc.free(s);
            alloc.free(out);
            return null;
        }
        out[count] = alloc.dupe(u8, item.string) catch {
            for (out[0..count]) |s| alloc.free(s);
            alloc.free(out);
            return null;
        };
        count += 1;
    }
    return out;
}

fn freeStringArray(alloc: std.mem.Allocator, arr: [][]u8) void {
    for (arr) |s| alloc.free(s);
    alloc.free(arr);
}

// ── process / env / argv ───────────────────────────────────────────────

fn argv(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(alloc);
    out.append(alloc, '[') catch {
        setString(info, "[]");
        return;
    };
    var first = true;
    for (g_argv_storage) |arg| {
        if (!first) out.append(alloc, ',') catch break;
        first = false;
        appendJsonEscaped(&out, alloc, arg) catch break;
    }
    out.append(alloc, ']') catch {
        setString(info, "[]");
        return;
    };
    setString(info, out.items);
}

fn envGet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const name = argStringAlloc(alloc, info, 0) orelse {
        setNull(info);
        return;
    };
    defer alloc.free(name);
    const val = sysx.getenv(name) orelse {
        setNull(info);
        return;
    };
    setString(info, val);
}

fn exitProc(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const code = argI32(info, 0, 0);
    std.process.exit(@intCast(code & 0xff));
}

fn cwd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var buf: [std.fs.max_path_bytes]u8 = undefined;
    const n = std.process.currentPath(host_io.io(), &buf) catch {
        setString(info, "");
        return;
    };
    setString(info, buf[0..n]);
}

fn nowMs(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ms = host_io.milliTimestamp();
    setNumber(info, @as(f64, @floatFromInt(ms)));
}

fn sleepMs(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ms = argI32(info, 0, 0);
    if (ms <= 0) {
        setUndefined(info);
        return;
    }
    _ = usleep(@intCast(@as(u32, @intCast(ms)) * 1000));
    setUndefined(info);
}

// ── stdin (raw mode + non-blocking read + fd polling) ─────────────────
//
// Adds the missing piece for interactive TUI/dev-shell carts: read keys
// from the controlling terminal without blocking, and wait on multiple
// fds at once so a TUI can service stdin + unix sockets in the same loop.

var g_termios_saved: ?sysx.termios = null;

/// __setStdinRaw(enable) → bool. Saves the original termios on first
/// enable, restores it on disable. Keeps ISIG so ctrl-c still kills.
fn setStdinRaw(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const enable = argI32(info, 0, 1) != 0;

    if (enable) {
        const current = sysx.tcgetattr(0) catch {
            setBool(info, false);
            return;
        };
        if (g_termios_saved == null) g_termios_saved = current;
        var t = current;
        t.lflag.ICANON = false;
        t.lflag.ECHO = false;
        t.lflag.ECHONL = false;
        t.lflag.IEXTEN = false;
        t.iflag.IXON = false;
        t.iflag.ICRNL = false;
        t.iflag.BRKINT = false;
        t.iflag.INPCK = false;
        t.iflag.ISTRIP = false;
        t.oflag.OPOST = false;
        t.cc[@intFromEnum(sysx.V.MIN)] = 0;
        t.cc[@intFromEnum(sysx.V.TIME)] = 0;
        sysx.tcsetattr(0, .NOW, t) catch {
            setBool(info, false);
            return;
        };
        setBool(info, true);
    } else {
        if (g_termios_saved) |saved| {
            sysx.tcsetattr(0, .NOW, saved) catch {};
        }
        setBool(info, true);
    }
}

/// __readStdin() → string. Always non-blocking: zero-timeout poll first,
/// then read only if data is ready. Works with or without raw mode.
fn readStdin(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var pfd = [_]sysx.pollfd{.{ .fd = 0, .events = sysx.POLL.IN, .revents = 0 }};
    const ready = sysx.poll(&pfd, 0) catch 0;
    if (ready == 0 or (pfd[0].revents & sysx.POLL.IN) == 0) {
        setString(info, "");
        return;
    }
    var buf: [4096]u8 = undefined;
    const n = sysx.read(0, &buf) catch 0;
    setString(info, buf[0..n]);
}

/// __termSize() → JSON [cols, rows]. Reads via TIOCGWINSZ on stdin so it
/// reflects the current terminal size on every call (not just at startup).
/// Returns [0, 0] if stdin isn't a tty.
const TIOCGWINSZ_REQ: c_ulong = 0x5413; // Linux constant
const Winsize = extern struct { ws_row: u16, ws_col: u16, ws_xpixel: u16, ws_ypixel: u16 };
extern fn ioctl(fd: c_int, request: c_ulong, ...) c_int;

fn termSize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var ws: Winsize = .{ .ws_row = 0, .ws_col = 0, .ws_xpixel = 0, .ws_ypixel = 0 };
    const r = ioctl(0, TIOCGWINSZ_REQ, &ws);
    if (r < 0) {
        setString(info, "[0,0]");
        return;
    }
    var buf: [32]u8 = undefined;
    const s = std.fmt.bufPrint(&buf, "[{d},{d}]", .{ ws.ws_col, ws.ws_row }) catch {
        setString(info, "[0,0]");
        return;
    };
    setString(info, s);
}

/// __pollFds(fdsJson, timeoutMs) → JSON array of indices ready to read.
/// fdsJson is a JSON array of fd numbers, e.g. "[0, 5, 7]". Index 0 is
/// stdin if 0 is in the list. Used by the dev-shell event loop to wait
/// on stdin + multiple unix sockets simultaneously.
fn pollFds(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const fds_json = argStringAlloc(alloc, info, 0) orelse {
        setString(info, "[]");
        return;
    };
    defer alloc.free(fds_json);
    const timeout_ms = argI32(info, 1, 0);

    var pfds: [32]sysx.pollfd = undefined;
    var n_fds: usize = 0;
    var i: usize = 0;
    while (i < fds_json.len and n_fds < pfds.len) {
        const c = fds_json[i];
        if (c >= '0' and c <= '9') {
            var v: i32 = 0;
            while (i < fds_json.len and fds_json[i] >= '0' and fds_json[i] <= '9') {
                v = v * 10 + @as(i32, @intCast(fds_json[i] - '0'));
                i += 1;
            }
            pfds[n_fds] = .{ .fd = v, .events = sysx.POLL.IN, .revents = 0 };
            n_fds += 1;
        } else {
            i += 1;
        }
    }

    if (n_fds == 0) {
        setString(info, "[]");
        return;
    }

    _ = sysx.poll(pfds[0..n_fds], timeout_ms) catch {
        setString(info, "[]");
        return;
    };

    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(alloc);
    out.append(alloc, '[') catch {
        setString(info, "[]");
        return;
    };
    var first = true;
    for (pfds[0..n_fds], 0..) |pfd, idx| {
        if ((pfd.revents & sysx.POLL.IN) != 0) {
            if (!first) out.append(alloc, ',') catch break;
            first = false;
            var nbuf: [16]u8 = undefined;
            const s = std.fmt.bufPrint(&nbuf, "{d}", .{idx}) catch break;
            out.appendSlice(alloc, s) catch break;
        }
    }
    out.append(alloc, ']') catch {
        setString(info, "[]");
        return;
    };
    setString(info, out.items);
}

// ── stdout / stderr ────────────────────────────────────────────────────

fn writeStdout(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const s = argStringAlloc(alloc, info, 0) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(s);
    _ = sysx.write(1, s) catch {};
    setUndefined(info);
}

fn writeStderr(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const s = argStringAlloc(alloc, info, 0) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(s);
    _ = sysx.write(2, s) catch {};
    setUndefined(info);
}

// ── filesystem: see framework/v8_bindings_fs.zig ───────────────────────
//
// Filesystem ops live in v8_bindings_fs.zig as __fs_read / __fs_write /
// __fs_exists / __fs_mkdir / __fs_remove / __fs_stat_json /
// __fs_list_json. cli used to shadow them under un-prefixed names
// (__readFile / __writeFile / __exists / __mkdirp / __remove / __stat /
// __readDir) which bypassed the metafile gate. Deleted 2026-05-18.
// Callers in tui/, scripts/, and runtime/hooks now go through the
// __fs_* surface.

// ── child processes ────────────────────────────────────────────────────
//
// Synchronous spawn only — the scripts we care about either wait for an
// esbuild one-shot to finish, or spawn `esbuild --watch` and read its
// stdout line-by-line. Both fit a simple spawnSync + spawn+read model.

/// __spawnSync(cmd, argsJsonArray, stdinContent) → JSON
///   { "code": <exit>, "stdout": "...", "stderr": "..." }
/// stdinContent may be "" for no input.
fn spawnSync(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;

    const cmd = argStringAlloc(alloc, info, 0) orelse {
        setString(info, "{\"code\":-1,\"stdout\":\"\",\"stderr\":\"missing cmd\"}");
        return;
    };
    defer alloc.free(cmd);

    const args_json = argStringAlloc(alloc, info, 1) orelse {
        setString(info, "{\"code\":-1,\"stdout\":\"\",\"stderr\":\"missing args\"}");
        return;
    };
    defer alloc.free(args_json);

    const stdin_in = argStringAlloc(alloc, info, 2) orelse alloc.dupe(u8, "") catch {
        setString(info, "{\"code\":-1,\"stdout\":\"\",\"stderr\":\"oom\"}");
        return;
    };
    defer alloc.free(stdin_in);

    const extra_args = parseStringArrayJson(alloc, args_json) orelse {
        setString(info, "{\"code\":-1,\"stdout\":\"\",\"stderr\":\"bad args json\"}");
        return;
    };
    defer freeStringArray(alloc, extra_args);

    // Build argv: [cmd, ...extra]
    const argv_arr = alloc.alloc([]const u8, 1 + extra_args.len) catch {
        setString(info, "{\"code\":-1,\"stdout\":\"\",\"stderr\":\"oom\"}");
        return;
    };
    defer alloc.free(argv_arr);
    argv_arr[0] = cmd;
    for (extra_args, 0..) |a, i| argv_arr[i + 1] = a;

    const io = host_io.io();
    var child = std.process.spawn(io, .{
        .argv = argv_arr,
        .stdin = if (stdin_in.len > 0) .pipe else .ignore,
        .stdout = .pipe,
        .stderr = .pipe,
    }) catch |e| {
        var buf: [256]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "{{\"code\":-1,\"stdout\":\"\",\"stderr\":\"spawn failed: {s}\"}}", .{@errorName(e)}) catch "{\"code\":-1,\"stdout\":\"\",\"stderr\":\"spawn failed\"}";
        setString(info, msg);
        return;
    };

    if (stdin_in.len > 0) {
        if (child.stdin) |stdin_pipe| {
            stdin_pipe.writeStreamingAll(io, stdin_in) catch {};
            stdin_pipe.close(io);
            child.stdin = null;
        }
    }

    // Drain stdout+stderr then wait — the same MultiReader shape
    // std.process.run uses internally (collectOutput is gone in 0.16).
    var multi_reader_buffer: std.Io.File.MultiReader.Buffer(2) = undefined;
    var multi_reader: std.Io.File.MultiReader = undefined;
    multi_reader.init(alloc, io, multi_reader_buffer.toStreams(), &.{ child.stdout.?, child.stderr.? });
    defer multi_reader.deinit();
    const stdout_reader = multi_reader.reader(0);
    const stderr_reader = multi_reader.reader(1);
    while (multi_reader.fill(64, .none)) |_| {
        if (stdout_reader.buffered().len > 64 * 1024 * 1024) break;
    } else |err| switch (err) {
        error.EndOfStream => {},
        else => {},
    }
    const stdout_items = stdout_reader.buffered();
    const stderr_items = stderr_reader.buffered();

    const term = child.wait(io) catch {
        setString(info, "{\"code\":-1,\"stdout\":\"\",\"stderr\":\"wait failed\"}");
        return;
    };
    const code: i32 = switch (term) {
        .exited => |c| @intCast(c),
        .signal => |sg| -@as(i32, @intCast(@intFromEnum(sg))),
        else => -1,
    };

    // Emit JSON { code, stdout, stderr }
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(alloc);
    var head_buf: [64]u8 = undefined;
    const head = std.fmt.bufPrint(&head_buf, "{{\"code\":{d},\"stdout\":", .{code}) catch {
        setString(info, "{\"code\":-1,\"stdout\":\"\",\"stderr\":\"oom\"}");
        return;
    };
    out.appendSlice(alloc, head) catch {
        setString(info, "{\"code\":-1,\"stdout\":\"\",\"stderr\":\"oom\"}");
        return;
    };
    appendJsonEscaped(&out, alloc, stdout_items) catch {};
    out.appendSlice(alloc, ",\"stderr\":") catch {};
    appendJsonEscaped(&out, alloc, stderr_items) catch {};
    out.append(alloc, '}') catch {};
    setString(info, out.items);
}

// ── long-running child handles (for watch mode) ────────────────────────

const ChildHandle = struct {
    child: std.process.Child,
    // Line-buffered stdout reader state. We read bytes into `scratch` and
    // return whole lines to the script. `residual` holds the trailing
    // partial line between reads.
    residual: std.ArrayList(u8),
    done: bool,
    exit_code: i32,
};

var g_children: std.AutoHashMap(u32, *ChildHandle) = undefined;
var g_children_next_id: u32 = 1;
var g_children_ready: bool = false;

// Flat pid table for signal-handler use. Hash maps and allocators aren't
// async-signal-safe; a fixed-size array is. Lookups from JS (__childKill etc.)
// still use g_children; this table is only read inside the signal handler.
const MAX_TRACKED_PIDS: usize = 64;
var g_pid_table: [MAX_TRACKED_PIDS]sysx.pid_t = [_]sysx.pid_t{0} ** MAX_TRACKED_PIDS;

fn recordPid(pid: sysx.pid_t) void {
    for (&g_pid_table) |*slot| {
        if (slot.* == 0) {
            slot.* = pid;
            return;
        }
    }
    // Table full — 64 live children is already implausible. Fall through; the
    // signal handler just won't know about this one.
}

fn forgetPid(pid: sysx.pid_t) void {
    for (&g_pid_table) |*slot| {
        if (slot.* == pid) {
            slot.* = 0;
            return;
        }
    }
}

/// Restore the terminal to a sane state on any exit path. Only does work
/// if the script actually opted into raw mode (g_termios_saved set) — for
/// non-TUI scripts (cart-bundle, push-bundle) this is a no-op.
///
/// Emits alt-screen-off + cursor-on + SGR-reset so a TUI cart that
/// crashed mid-paint doesn't leave the user's terminal painted into a
/// corner. Both atexit (normal __exit) and the signal handler call this.
fn restoreTty() callconv(.c) void {
    if (g_termios_saved) |saved| {
        sysx.tcsetattr(0, .NOW, saved) catch {};
        // Order matters: disable mouse reporting BEFORE leaving the alt
        // screen so mouse-mode bytes don't end up at the user's shell
        // prompt if the shell happens to repaint immediately after.
        // 1000l = press/release off, 1002l = drag tracking off,
        // 1006l = SGR extended off, 1049l = alt screen off, 25h = cursor
        // on, 0m = SGR reset.
        _ = sysx.write(1, "\x1b[?1000l\x1b[?1002l\x1b[?1006l\x1b[?1049l\x1b[?25h\x1b[0m") catch {};
    }
}

extern fn atexit(func: *const fn () callconv(.c) void) c_int;

fn signalHandler(sig: sysx.SIG) callconv(.c) void {
    // Restore terminal first so the user's shell isn't left in raw mode
    // / alt-screen if a TUI cart got SIGINT'd.
    restoreTty();
    // Kill every tracked child, then re-raise the signal with the default
    // disposition so our own exit status reflects the signal that killed us.
    for (g_pid_table) |pid| {
        if (pid != 0) {
            _ = sysx.kill(pid, sysx.SIG.TERM) catch {};
        }
    }
    const dfl = sysx.Sigaction{
        .handler = .{ .handler = sysx.SIG.DFL },
        .mask = sysx.sigemptyset(),
        .flags = 0,
    };
    sysx.sigaction(sig, &dfl, null);
    _ = sysx.raise(sig) catch {};
}

/// Install SIGINT/SIGTERM/SIGHUP handlers that kill tracked child processes,
/// plus an atexit hook for terminal restore. Call once from main before
/// spawning anything.
pub fn installSignalHandlers() void {
    const act = sysx.Sigaction{
        .handler = .{ .handler = signalHandler },
        .mask = sysx.sigemptyset(),
        .flags = 0,
    };
    sysx.sigaction(sysx.SIG.INT, &act, null);
    sysx.sigaction(sysx.SIG.TERM, &act, null);
    sysx.sigaction(sysx.SIG.HUP, &act, null);
    _ = atexit(restoreTty);
}

fn ensureChildren() void {
    if (g_children_ready) return;
    g_children = std.AutoHashMap(u32, *ChildHandle).init(std.heap.c_allocator);
    g_children_ready = true;
}

/// __spawn(cmd, argsJsonArray) → childId (u32) or -1 on failure.
/// stdout is piped; stderr is inherited (goes to our stderr).
fn spawn(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    ensureChildren();

    const cmd = argStringAlloc(alloc, info, 0) orelse {
        setNumber(info, -1);
        return;
    };
    const args_json = argStringAlloc(alloc, info, 1) orelse {
        alloc.free(cmd);
        setNumber(info, -1);
        return;
    };
    defer alloc.free(args_json);

    const extra_args = parseStringArrayJson(alloc, args_json) orelse {
        alloc.free(cmd);
        setNumber(info, -1);
        return;
    };

    // Child needs argv to outlive the spawn call. We duplicate into a
    // persistent block owned by the handle.
    const arena = std.heap.c_allocator;
    const handle = arena.create(ChildHandle) catch {
        alloc.free(cmd);
        freeStringArray(alloc, extra_args);
        setNumber(info, -1);
        return;
    };
    const argv_arr = arena.alloc([]const u8, 1 + extra_args.len) catch {
        arena.destroy(handle);
        alloc.free(cmd);
        freeStringArray(alloc, extra_args);
        setNumber(info, -1);
        return;
    };
    argv_arr[0] = arena.dupe(u8, cmd) catch {
        arena.free(argv_arr);
        arena.destroy(handle);
        alloc.free(cmd);
        freeStringArray(alloc, extra_args);
        setNumber(info, -1);
        return;
    };
    for (extra_args, 0..) |a, i| {
        argv_arr[i + 1] = arena.dupe(u8, a) catch {
            // partial cleanup acceptable on oom path
            setNumber(info, -1);
            return;
        };
    }
    alloc.free(cmd);
    freeStringArray(alloc, extra_args);

    const spawned = std.process.spawn(host_io.io(), .{
        .argv = argv_arr,
        .stdout = .pipe,
        .stderr = .inherit,
        .stdin = .ignore,
    }) catch {
        arena.destroy(handle);
        setNumber(info, -1);
        return;
    };
    handle.* = .{
        .child = spawned,
        .residual = .empty,
        .done = false,
        .exit_code = 0,
    };

    const id = g_children_next_id;
    g_children_next_id += 1;
    g_children.put(id, handle) catch {
        handle.child.kill(host_io.io());
        arena.destroy(handle);
        setNumber(info, -1);
        return;
    };
    recordPid(handle.child.id orelse 0);
    setNumber(info, id);
}

/// __childReadLine(id, timeoutMs) → string line (without newline), or null on
/// timeout, or empty string when the child has exited and its pipe drained.
/// A 0 timeout polls without blocking.
fn childReadLine(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    ensureChildren();
    const id: u32 = @intCast(argI32(info, 0, -1));
    const timeout_ms = argI32(info, 1, 0);
    const handle = g_children.get(id) orelse {
        setString(info, "");
        return;
    };

    // Fast path: return a line already buffered in residual.
    if (splitLine(handle.residual.items)) |found| {
        emitLineAndConsume(info, handle, found);
        return;
    }

    const fd = blk: {
        const pipe = handle.child.stdout orelse break :blk @as(sysx.fd_t, -1);
        break :blk pipe.handle;
    };
    if (fd < 0) {
        // stdout already closed and nothing buffered
        setString(info, "");
        return;
    }

    var pfd = [_]sysx.pollfd{.{ .fd = fd, .events = sysx.POLL.IN, .revents = 0 }};
    const n = sysx.poll(&pfd, timeout_ms) catch {
        setNull(info);
        return;
    };
    if (n == 0) {
        setNull(info);
        return;
    }

    var buf: [4096]u8 = undefined;
    const got = sysx.read(fd, &buf) catch 0;
    if (got == 0) {
        // EOF: child stdout closed. Return whatever residual is as a final line
        // (if any), else empty.
        if (handle.residual.items.len > 0) {
            const line = std.heap.c_allocator.dupe(u8, handle.residual.items) catch "";
            handle.residual.clearRetainingCapacity();
            setString(info, line);
            std.heap.c_allocator.free(line);
        } else {
            setString(info, "");
        }
        return;
    }

    handle.residual.appendSlice(std.heap.c_allocator, buf[0..got]) catch {
        setNull(info);
        return;
    };
    if (splitLine(handle.residual.items)) |found| {
        emitLineAndConsume(info, handle, found);
        return;
    }
    // Data arrived but no complete line yet — tell caller to poll again.
    setNull(info);
}

fn splitLine(data: []const u8) ?usize {
    for (data, 0..) |ch, i| {
        if (ch == '\n') return i;
    }
    return null;
}

fn emitLineAndConsume(info: v8.FunctionCallbackInfo, handle: *ChildHandle, nl_idx: usize) void {
    const line = std.heap.c_allocator.dupe(u8, handle.residual.items[0..nl_idx]) catch {
        setNull(info);
        return;
    };
    defer std.heap.c_allocator.free(line);
    // Shift residual: drop line + '\n'.
    const remaining = handle.residual.items[nl_idx + 1 ..];
    const moved = std.heap.c_allocator.dupe(u8, remaining) catch "";
    handle.residual.clearRetainingCapacity();
    handle.residual.appendSlice(std.heap.c_allocator, moved) catch {};
    std.heap.c_allocator.free(moved);
    setString(info, line);
}

/// __childKill(id) → bool
fn childKill(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    ensureChildren();
    const id: u32 = @intCast(argI32(info, 0, -1));
    const handle = g_children.get(id) orelse {
        setBool(info, false);
        return;
    };
    forgetPid(handle.child.id orelse 0);
    handle.child.kill(host_io.io());
    handle.residual.deinit(std.heap.c_allocator);
    std.heap.c_allocator.destroy(handle);
    _ = g_children.remove(id);
    setBool(info, true);
}

// ── unix sockets (for push-bundle IPC) ─────────────────────────────────

/// __unixConnect(path) → fd (i32) or -1.
fn unixConnect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const path = argStringAlloc(alloc, info, 0) orelse {
        setNumber(info, -1);
        return;
    };
    defer alloc.free(path);

    // std.net is gone in 0.16; blocking unix connect via sysx (raw fd, the
    // same pattern pty_remote uses — downstream reads/writes are sysx too).
    if (path.len >= 108) {
        setNumber(info, -1);
        return;
    }
    const fd = sysx.socket(sysx.AF.UNIX, sysx.SOCK.STREAM, 0) catch {
        setNumber(info, -1);
        return;
    };
    var addr: sysx.sockaddr.un = .{ .family = sysx.AF.UNIX, .path = undefined };
    @memset(&addr.path, 0);
    @memcpy(addr.path[0..path.len], path);
    sysx.connect(fd, @ptrCast(&addr), @sizeOf(sysx.sockaddr.un)) catch {
        sysx.close(fd);
        setNumber(info, -1);
        return;
    };
    setNumber(info, @as(i32, @intCast(fd)));
}

/// __unixWrite(fd, content) → bytes written or -1.
fn unixWrite(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const fd = argI32(info, 0, -1);
    if (fd < 0) {
        setNumber(info, -1);
        return;
    }
    const alloc = std.heap.page_allocator;
    const content = argStringAlloc(alloc, info, 1) orelse {
        setNumber(info, -1);
        return;
    };
    defer alloc.free(content);
    const n = sysx.write(@intCast(fd), content) catch {
        setNumber(info, -1);
        return;
    };
    setNumber(info, @as(i64, @intCast(n)));
}

/// __unixReadAll(fd, timeoutMs, maxBytes) → string or null on timeout / empty on EOF.
fn unixReadAll(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const fd = argI32(info, 0, -1);
    const timeout_ms = argI32(info, 1, 0);
    const max_bytes_arg = argI32(info, 2, 65536);
    if (fd < 0) {
        setString(info, "");
        return;
    }
    const max_bytes: usize = if (max_bytes_arg <= 0) 65536 else @intCast(max_bytes_arg);

    var pfd = [_]sysx.pollfd{.{ .fd = @intCast(fd), .events = sysx.POLL.IN, .revents = 0 }};
    const n = sysx.poll(&pfd, timeout_ms) catch {
        setNull(info);
        return;
    };
    if (n == 0) {
        setNull(info);
        return;
    }

    const alloc = std.heap.page_allocator;
    const buf = alloc.alloc(u8, max_bytes) catch {
        setNull(info);
        return;
    };
    defer alloc.free(buf);
    const got = sysx.read(@intCast(fd), buf) catch {
        setNull(info);
        return;
    };
    setString(info, buf[0..got]);
}

/// __unixClose(fd) → undefined.
fn unixClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const fd = argI32(info, 0, -1);
    if (fd >= 0) sysx.close(@intCast(fd));
    setUndefined(info);
}

// ── hotstate (cross-reload state survival) ────────────────────────────
//
// Backed by framework/hotstate.zig — a key→JSON-string map living in the
// process. Survives a v8cli reload AND even surviving a full v8cli
// restart (engine writes a snapshot on exit, reads it on next start —
// not yet wired here, but the storage layer is the same one the GPU
// stack uses for useHotState). Used by the TUI engine to flash useHot
// slots before swapping a user bundle.

fn hotGet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const key = argStringAlloc(alloc, info, 0) orelse {
        setNull(info);
        return;
    };
    defer alloc.free(key);
    if (hotstate.get(key)) |v| setString(info, v) else setNull(info);
}

fn hotSet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const key = argStringAlloc(alloc, info, 0) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(key);
    const val = argStringAlloc(alloc, info, 1) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(val);
    hotstate.set(key, val);
    setUndefined(info);
}

fn hotRemove(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const key = argStringAlloc(alloc, info, 0) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(key);
    hotstate.remove(key);
    setUndefined(info);
}

fn hotClear(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    hotstate.clear();
    setUndefined(info);
}

fn hotKeys(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const alloc = std.heap.page_allocator;
    const json = hotstate.keysJson(alloc) catch {
        setString(info, "[]");
        return;
    };
    defer alloc.free(json);
    setString(info, json);
}

// ── registration ───────────────────────────────────────────────────────

/// Install all CLI bindings into the current V8 context as global __xxx fns.
/// Call this after v8_runtime.initVM() and before evalScript.
pub fn registerAll() void {
    v8_runtime.registerHostFn("__argv", argv);
    v8_runtime.registerHostFn("__env", envGet);
    v8_runtime.registerHostFn("__exit", exitProc);
    v8_runtime.registerHostFn("__cwd", cwd);
    v8_runtime.registerHostFn("__nowMs", nowMs);
    v8_runtime.registerHostFn("__sleepMs", sleepMs);

    v8_runtime.registerHostFn("__writeStdout", writeStdout);
    v8_runtime.registerHostFn("__writeStderr", writeStderr);

    v8_runtime.registerHostFn("__setStdinRaw", setStdinRaw);
    v8_runtime.registerHostFn("__readStdin", readStdin);
    v8_runtime.registerHostFn("__pollFds", pollFds);
    v8_runtime.registerHostFn("__termSize", termSize);

    v8_runtime.registerHostFn("__hotGet", hotGet);
    v8_runtime.registerHostFn("__hotSet", hotSet);
    v8_runtime.registerHostFn("__hotRemove", hotRemove);
    v8_runtime.registerHostFn("__hotClear", hotClear);
    v8_runtime.registerHostFn("__hotKeys", hotKeys);

    // fs lives in v8_bindings_fs.zig (__fs_*). Hosts register that
    // module separately. cli no longer shadows it.

    v8_runtime.registerHostFn("__spawnSync", spawnSync);
    v8_runtime.registerHostFn("__spawn", spawn);
    v8_runtime.registerHostFn("__childReadLine", childReadLine);
    v8_runtime.registerHostFn("__childKill", childKill);

    v8_runtime.registerHostFn("__unixConnect", unixConnect);
    v8_runtime.registerHostFn("__unixWrite", unixWrite);
    v8_runtime.registerHostFn("__unixReadAll", unixReadAll);
    v8_runtime.registerHostFn("__unixClose", unixClose);
}
