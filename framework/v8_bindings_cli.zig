//! V8 host bindings for CLI-mode scripts (bundler, dev-push, watcher).
//!
//! Deliberately has NO imports from the rest of framework/ — no engine, no
//! windows, no canvas. This file is safe to link into a standalone V8 host
//! that runs a JS file without any SDL/GPU/UI baggage.
//!
//! Surface is plain __xxx host functions. Scripts consume them directly; we
//! don't try to mimic node's fs/process/child_process shapes.

const std = @import("std");
const posix = std.posix;
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const HostContext = @import("host_context.zig");
const hotstate = @import("state/hotstate.zig");
const transport = @import("net/transport.zig");

extern fn getpid() c_int;
extern fn write(fd: c_int, buf: [*]const u8, count: usize) isize;

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
    return @trunc(argF64(info, idx, default));
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
    const host = v8_runtime.hostContext(info.getIsolate());
    const alloc = std.heap.page_allocator;
    const name = argStringAlloc(alloc, info, 0) orelse {
        setNull(info);
        return;
    };
    defer alloc.free(name);
    const val = host.environ.get(name) orelse {
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

fn terminalExitProc(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const code = argI32(info, 0, 0);
    terminalHost(info).deinit();
    std.process.exit(@intCast(code & 0xff));
}

fn cwd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    var buf: [std.fs.max_path_bytes]u8 = undefined;
    const n = std.process.currentPath(io, &buf) catch {
        setString(info, "");
        return;
    };
    setString(info, buf[0..n]);
}

fn nowMs(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const ms = @divFloor(std.Io.Clock.now(.real, io).toNanoseconds(), std.time.ns_per_ms);
    setNumber(info, @as(f64, @floatFromInt(ms)));
}

fn sleepMs(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const ms = argI32(info, 0, 0);
    if (ms <= 0) {
        setUndefined(info);
        return;
    }
    std.Io.sleep(io, .fromMilliseconds(ms), .awake) catch {};
    setUndefined(info);
}

// ── stdin (raw mode + owner-managed async read) ────────────────────────

const STDIN_QUEUE_CAPACITY = 64 * 1024;
const STDIN_READ_CAPACITY = 4096;

const StdinPump = struct {
    io: std.Io,
    tasks: std.Io.Group,
    bytes: std.Io.Queue(u8),
    byte_storage: [STDIN_QUEUE_CAPACITY]u8,
    started: bool,

    fn init(self: *StdinPump, io: std.Io) !void {
        self.* = .{
            .io = io,
            .tasks = .init,
            .bytes = undefined,
            .byte_storage = undefined,
            .started = false,
        };
        self.bytes = .init(&self.byte_storage);
        try self.tasks.concurrent(io, readLoop, .{self});
        self.started = true;
    }

    fn readLoop(self: *StdinPump) std.Io.Cancelable!void {
        defer self.bytes.close(self.io);
        const stdin = std.Io.File.stdin();
        var buffer: [STDIN_READ_CAPACITY]u8 = undefined;

        while (true) {
            const n = stdin.readStreaming(self.io, &.{buffer[0..]}) catch |err| switch (err) {
                error.Canceled => return error.Canceled,
                error.EndOfStream => return,
                else => return,
            };
            if (n == 0) continue;
            self.bytes.putAll(self.io, buffer[0..n]) catch |err| switch (err) {
                error.Canceled => return error.Canceled,
                error.Closed => return,
            };
        }
    }

    fn drain(self: *StdinPump, out: []u8) usize {
        return self.bytes.getUncancelable(self.io, out, 0) catch 0;
    }

    fn deinit(self: *StdinPump) void {
        if (!self.started) return;
        self.started = false;
        self.tasks.cancel(self.io);
        self.bytes.close(self.io);
    }
};

/// Root-owned process context for hosts that install the terminal bindings.
/// Keeping `host` as a real field lets fixed V8 callbacks recover this owner
/// from the HostContext stored in the isolate without a module-global pointer.
pub const TerminalHost = struct {
    host: HostContext,
    stdin: StdinPump,

    pub fn init(self: *TerminalHost, host: HostContext) !void {
        self.host = host;
        try self.stdin.init(host.io);
    }

    pub fn deinit(self: *TerminalHost) void {
        self.stdin.deinit();
        restoreTty();
    }
};

fn terminalHost(info: v8.FunctionCallbackInfo) *TerminalHost {
    const host = v8_runtime.hostContext(info.getIsolate());
    return @fieldParentPtr("host", host);
}

var g_termios_saved: ?posix.termios = null;

/// __setStdinRaw(enable) → bool. Saves the original termios on first
/// enable, restores it on disable. Keeps ISIG so ctrl-c still kills.
fn setStdinRaw(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const enable = argI32(info, 0, 1) != 0;

    if (enable) {
        const current = posix.tcgetattr(0) catch {
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
        // The root-owned stdin task blocks in std.Io, so one byte should wake
        // it. The JS-facing read remains non-blocking because it only drains
        // the bounded queue.
        t.cc[@intFromEnum(posix.V.MIN)] = 1;
        t.cc[@intFromEnum(posix.V.TIME)] = 0;
        posix.tcsetattr(0, .NOW, t) catch {
            setBool(info, false);
            return;
        };
        setBool(info, true);
    } else {
        if (g_termios_saved) |saved| {
            posix.tcsetattr(0, .NOW, saved) catch {};
        }
        setBool(info, true);
    }
}

/// __readStdin() → string. Always non-blocking: the root-owned std.Io task
/// performs the blocking read and this callback only drains queued bytes.
fn readStdin(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var buf: [4096]u8 = undefined;
    const n = terminalHost(info).stdin.drain(&buf);
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

// ── stdout / stderr ────────────────────────────────────────────────────

fn writeStdout(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const alloc = std.heap.page_allocator;
    const s = argStringAlloc(alloc, info, 0) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(s);
    std.Io.File.stdout().writeStreamingAll(io, s) catch {};
    setUndefined(info);
}

fn writeStderr(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const alloc = std.heap.page_allocator;
    const s = argStringAlloc(alloc, info, 0) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(s);
    std.Io.File.stderr().writeStreamingAll(io, s) catch {};
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

    const io = v8_runtime.hostContext(info.getIsolate()).io;
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
    multi_buffer: std.Io.File.MultiReader.Buffer(1),
    multi_reader: std.Io.File.MultiReader,
};

var g_children: std.AutoHashMap(u32, *ChildHandle) = undefined;
var g_children_next_id: u32 = 1;
var g_children_ready: bool = false;

// Flat pid table for signal-handler use. Hash maps and allocators aren't
// async-signal-safe; a fixed-size array is. Lookups from JS (__childKill etc.)
// still use g_children; this table is only read inside the signal handler.
const MAX_TRACKED_PIDS: usize = 64;
var g_pid_table: [MAX_TRACKED_PIDS]posix.pid_t = [_]posix.pid_t{0} ** MAX_TRACKED_PIDS;

fn recordPid(pid: posix.pid_t) void {
    for (&g_pid_table) |*slot| {
        if (slot.* == 0) {
            slot.* = pid;
            return;
        }
    }
    // Table full — 64 live children is already implausible. Fall through; the
    // signal handler just won't know about this one.
}

fn forgetPid(pid: posix.pid_t) void {
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
        posix.tcsetattr(0, .NOW, saved) catch {};
        // Order matters: disable mouse reporting BEFORE leaving the alt
        // screen so mouse-mode bytes don't end up at the user's shell
        // prompt if the shell happens to repaint immediately after.
        // 1000l = press/release off, 1002l = drag tracking off,
        // 1006l = SGR extended off, 1049l = alt screen off, 25h = cursor
        // on, 0m = SGR reset.
        const reset = "\x1b[?1000l\x1b[?1002l\x1b[?1006l\x1b[?1049l\x1b[?25h\x1b[0m";
        _ = write(1, reset.ptr, reset.len);
    }
}

extern fn atexit(func: *const fn () callconv(.c) void) c_int;

fn signalHandler(sig: posix.SIG) callconv(.c) void {
    // Restore terminal first so the user's shell isn't left in raw mode
    // / alt-screen if a TUI cart got SIGINT'd.
    restoreTty();
    // Kill every tracked child, then re-raise the signal with the default
    // disposition so our own exit status reflects the signal that killed us.
    for (g_pid_table) |pid| {
        if (pid != 0) {
            posix.kill(pid, posix.SIG.TERM) catch {};
        }
    }
    const dfl = posix.Sigaction{
        .handler = .{ .handler = posix.SIG.DFL },
        .mask = posix.sigemptyset(),
        .flags = 0,
    };
    posix.sigaction(sig, &dfl, null);
    posix.raise(sig) catch {};
}

/// Install SIGINT/SIGTERM/SIGHUP handlers that kill tracked child processes,
/// plus an atexit hook for terminal restore. Call once from main before
/// spawning anything.
pub fn installSignalHandlers() void {
    const act = posix.Sigaction{
        .handler = .{ .handler = signalHandler },
        .mask = posix.sigemptyset(),
        .flags = 0,
    };
    posix.sigaction(posix.SIG.INT, &act, null);
    posix.sigaction(posix.SIG.TERM, &act, null);
    posix.sigaction(posix.SIG.HUP, &act, null);
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
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const alloc = std.heap.page_allocator;
    ensureChildren();

    const cmd = argStringAlloc(alloc, info, 0) orelse {
        setNumber(info, -1);
        return;
    };
    defer alloc.free(cmd);
    const args_json = argStringAlloc(alloc, info, 1) orelse {
        setNumber(info, -1);
        return;
    };
    defer alloc.free(args_json);

    const extra_args = parseStringArrayJson(alloc, args_json) orelse {
        setNumber(info, -1);
        return;
    };
    defer freeStringArray(alloc, extra_args);

    const argv_arr = alloc.alloc([]const u8, 1 + extra_args.len) catch {
        setNumber(info, -1);
        return;
    };
    defer alloc.free(argv_arr);
    argv_arr[0] = cmd;
    for (extra_args, 0..) |a, i| argv_arr[i + 1] = a;

    var spawned = std.process.spawn(io, .{
        .argv = argv_arr,
        .stdout = .pipe,
        .stderr = .inherit,
        .stdin = .ignore,
    }) catch {
        setNumber(info, -1);
        return;
    };
    const arena = std.heap.c_allocator;
    const handle = arena.create(ChildHandle) catch {
        spawned.kill(io);
        setNumber(info, -1);
        return;
    };
    handle.child = spawned;
    handle.multi_reader.init(arena, io, handle.multi_buffer.toStreams(), &.{spawned.stdout.?});

    const id = g_children_next_id;
    g_children_next_id += 1;
    g_children.put(id, handle) catch {
        handle.multi_reader.deinit();
        handle.child.kill(io);
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
    _ = v8_runtime.hostContext(info.getIsolate()).io;
    ensureChildren();
    const id: u32 = @intCast(argI32(info, 0, -1));
    const timeout_ms = argI32(info, 1, 0);
    const handle = g_children.get(id) orelse {
        setString(info, "");
        return;
    };

    const reader = handle.multi_reader.reader(0);
    if (splitLine(reader.buffered())) |found| {
        emitLineAndConsume(info, reader, found);
        return;
    }

    const timeout: std.Io.Timeout = .{ .duration = .{
        .raw = .fromMilliseconds(@max(timeout_ms, 0)),
        .clock = .awake,
    } };
    handle.multi_reader.fill(1, timeout) catch |err| switch (err) {
        error.Timeout => {
            setNull(info);
            return;
        },
        error.EndOfStream => {
            const tail = reader.buffered();
            if (tail.len == 0) {
                setString(info, "");
            } else {
                setString(info, tail);
                reader.toss(tail.len);
            }
            return;
        },
        else => {
            setNull(info);
            return;
        },
    };

    if (splitLine(reader.buffered())) |found| {
        emitLineAndConsume(info, reader, found);
    } else {
        // Partial lines stay in the reader until a later fill completes them.
        setNull(info);
    }
}

fn splitLine(data: []const u8) ?usize {
    for (data, 0..) |ch, i| {
        if (ch == '\n') return i;
    }
    return null;
}

fn emitLineAndConsume(info: v8.FunctionCallbackInfo, reader: *std.Io.Reader, nl_idx: usize) void {
    setString(info, reader.buffered()[0..nl_idx]);
    reader.toss(nl_idx + 1);
}

/// __childKill(id) → bool
fn childKill(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    ensureChildren();
    const id: u32 = @intCast(argI32(info, 0, -1));
    const handle = g_children.get(id) orelse {
        setBool(info, false);
        return;
    };
    forgetPid(handle.child.id orelse 0);
    _ = g_children.remove(id);
    handle.multi_reader.deinit();
    handle.child.kill(io);
    std.heap.c_allocator.destroy(handle);
    setBool(info, true);
}

// ── unix sockets (for push-bundle IPC) ─────────────────────────────────

const UnixHandle = struct {
    pump: transport.StreamPump,
};

var g_unix_handles: std.AutoHashMap(u32, *UnixHandle) = undefined;
var g_unix_next_id: u32 = 1;
var g_unix_ready = false;

fn ensureUnixHandles() void {
    if (g_unix_ready) return;
    g_unix_handles = .init(std.heap.c_allocator);
    g_unix_ready = true;
}

/// __unixConnect(path) → opaque stream handle or -1.
fn unixConnect(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    const alloc = std.heap.page_allocator;
    const path = argStringAlloc(alloc, info, 0) orelse {
        setNumber(info, -1);
        return;
    };
    defer alloc.free(path);

    const address = std.Io.net.UnixAddress.init(path) catch {
        setNumber(info, -1);
        return;
    };
    const stream = address.connect(io) catch {
        setNumber(info, -1);
        return;
    };
    const handle = std.heap.c_allocator.create(UnixHandle) catch {
        stream.close(io);
        setNumber(info, -1);
        return;
    };
    handle.* = .{ .pump = transport.StreamPump.init(std.heap.c_allocator, io, stream) catch {
        stream.close(io);
        std.heap.c_allocator.destroy(handle);
        setNumber(info, -1);
        return;
    } };

    ensureUnixHandles();
    const id = g_unix_next_id;
    g_unix_next_id +%= 1;
    if (g_unix_next_id == 0) g_unix_next_id = 1;
    g_unix_handles.put(id, handle) catch {
        handle.pump.deinit();
        std.heap.c_allocator.destroy(handle);
        setNumber(info, -1);
        return;
    };
    setNumber(info, id);
}

/// __unixWrite(handle, content) → bytes written or -1.
fn unixWrite(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    ensureUnixHandles();
    const id = argI32(info, 0, -1);
    if (id < 0) {
        setNumber(info, -1);
        return;
    }
    const handle = g_unix_handles.get(@intCast(id)) orelse {
        setNumber(info, -1);
        return;
    };
    const alloc = std.heap.page_allocator;
    const content = argStringAlloc(alloc, info, 1) orelse {
        setNumber(info, -1);
        return;
    };
    defer alloc.free(content);
    handle.pump.send(content) catch {
        setNumber(info, -1);
        return;
    };
    setNumber(info, content.len);
}

/// __unixReadAll(handle, timeoutMs, maxBytes) → string or null on timeout / empty on EOF.
fn unixReadAll(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    ensureUnixHandles();
    const id = argI32(info, 0, -1);
    const timeout_ms = argI32(info, 1, 0);
    const max_bytes_arg = argI32(info, 2, 65536);
    if (id < 0) {
        setString(info, "");
        return;
    }
    const handle = g_unix_handles.get(@intCast(id)) orelse {
        setString(info, "");
        return;
    };
    const max_bytes: usize = if (max_bytes_arg <= 0) 65536 else @intCast(max_bytes_arg);

    const alloc = std.heap.page_allocator;
    const buf = alloc.alloc(u8, max_bytes) catch {
        setNull(info);
        return;
    };
    defer alloc.free(buf);
    const timeout: std.Io.Timeout = .{ .duration = .{
        .raw = .fromMilliseconds(@max(timeout_ms, 0)),
        .clock = .awake,
    } };
    const result = handle.pump.drainWait(buf, timeout) catch {
        setNull(info);
        return;
    };
    switch (result) {
        .data => |n| setString(info, buf[0..n]),
        .closed => setString(info, ""),
        .empty, .failed => setNull(info),
    }
}

/// __unixClose(handle) → undefined.
fn unixClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    ensureUnixHandles();
    const id = argI32(info, 0, -1);
    if (id >= 0) {
        if (g_unix_handles.fetchRemove(@intCast(id))) |entry| {
            entry.value.pump.deinit();
            std.heap.c_allocator.destroy(entry.value);
        }
    }
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

/// Install terminal-only bindings after `registerAll`. The application root
/// must store the HostContext passed to V8 inside a live `TerminalHost` and
/// call `TerminalHost.deinit` before releasing it.
pub fn registerTerminal() void {
    // Override generic process exit so the stdin task is canceled and joined
    // even though std.process.exit does not unwind Zig defers.
    v8_runtime.registerHostFn("__exit", terminalExitProc);
    v8_runtime.registerHostFn("__setStdinRaw", setStdinRaw);
    v8_runtime.registerHostFn("__readStdin", readStdin);
    v8_runtime.registerHostFn("__termSize", termSize);
}
