//! Process host bindings — V8 FFI bridge for framework/process.zig spawnPiped.
//!
//! Implements the contract documented by runtime/hooks/process.ts:
//!   __proc_spawn(specJson) → pid (0 on failure)
//!   __proc_kill(pid, signalName) → bool
//!   __proc_stdin_write(pid, data) → bool
//!   __proc_stdin_close(pid) → void
//!   __env_get(name) → string|null
//!   __env_set(name, value) → void
//!
//! Spec JSON: {"cmd":"...","args":["..."],"cwd":"...","env":{"K":"V"},"stdin":"pipe|inherit|ignore"}
//!
//! Events (line-buffered, fired each frame from tickDrain):
//!   __ffiEmit('proc:stdout:<pid>', line)
//!   __ffiEmit('proc:stderr:<pid>', line)
//!   __ffiEmit('proc:exit:<pid>', '{"code":N,"signal":null}')

const std = @import("std");
const builtin = @import("builtin");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const HostContext = @import("host_context.zig");
const process = @import("process/process.zig");
const event_bus = @import("diag/event_bus.zig");

const alloc = std.heap.c_allocator;

// ── Registry ───────────────────────────────────────────────────────

const STDOUT_BUF = 65536;
const STDERR_BUF = 65536;

const Entry = struct {
    pid: c_int,
    piped: process.PipedProcess,
    out_buf: [STDOUT_BUF]u8 = undefined,
    out_len: usize = 0,
    err_buf: [STDERR_BUF]u8 = undefined,
    err_len: usize = 0,
    stdout_done: bool,
    stderr_done: bool,
};

var g_entries: std.ArrayList(*Entry) = .empty;

fn findEntry(pid: c_int) ?*Entry {
    for (g_entries.items) |e| {
        if (e.pid == pid) return e;
    }
    return null;
}

fn removeEntry(io: std.Io, pid: c_int) void {
    var i: usize = g_entries.items.len;
    while (i > 0) {
        i -= 1;
        if (g_entries.items[i].pid == pid) {
            const e = g_entries.items[i];
            e.piped.deinit(io);
            alloc.destroy(e);
            _ = g_entries.orderedRemove(i);
            return;
        }
    }
}

// ── Helpers (mirror v8_bindings_httpserver) ────────────────────────

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = alloc.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn argToI32(info: v8.FunctionCallbackInfo, idx: u32) ?i32 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return info.getArg(idx).toI32(ctx) catch null;
}

fn emitEvent(host: *HostContext, channel: []const u8, payload: []const u8) void {
    var chan_buf: std.ArrayList(u8) = .empty;
    defer chan_buf.deinit(alloc);
    chan_buf.appendSlice(alloc, channel) catch return;
    chan_buf.append(alloc, 0) catch return;
    const chan_z = chan_buf.items[0 .. chan_buf.items.len - 1 :0];

    var payload_buf: std.ArrayList(u8) = .empty;
    defer payload_buf.deinit(alloc);
    payload_buf.appendSlice(alloc, payload) catch return;
    payload_buf.append(alloc, 0) catch return;
    const payload_z = payload_buf.items[0 .. payload_buf.items.len - 1 :0];

    v8_runtime.callGlobal2Str(host, "__ffiEmit", chan_z, payload_z);
}

// ── Spec JSON parsing ──────────────────────────────────────────────
//
// Hand-rolled (same shape as v8_bindings_httpserver.parseRoutes). Looks for
// "cmd", "args", "cwd", "stdin" — env is currently dropped (TODO: implement
// nested object parsing if a cart needs per-process env injection).

fn extractStringField(obj: []const u8, key: []const u8) ?[]const u8 {
    var search_buf: [64]u8 = undefined;
    const needle = std.fmt.bufPrint(&search_buf, "\"{s}\"", .{key}) catch return null;
    const k_pos = std.mem.indexOf(u8, obj, needle) orelse return null;
    var p = k_pos + needle.len;
    while (p < obj.len and (obj[p] == ' ' or obj[p] == ':')) p += 1;
    if (p >= obj.len or obj[p] != '"') return null;
    p += 1;
    const start = p;
    while (p < obj.len and obj[p] != '"') {
        if (obj[p] == '\\') p += 1;
        p += 1;
    }
    if (p >= obj.len) return null;
    return obj[start..p];
}

/// Parse the args array into a heap-allocated null-terminated argv slice
/// (caller frees each string + the slice itself).
fn parseArgsArray(json: []const u8) ?[][:0]u8 {
    const k_pos = std.mem.indexOf(u8, json, "\"args\"") orelse return null;
    var p = k_pos + "\"args\"".len;
    while (p < json.len and (json[p] == ' ' or json[p] == ':')) p += 1;
    if (p >= json.len or json[p] != '[') return null;
    p += 1;

    var list: std.ArrayList([:0]u8) = .empty;
    defer list.deinit(alloc);

    while (p < json.len) {
        while (p < json.len and (json[p] == ' ' or json[p] == ',')) p += 1;
        if (p >= json.len) break;
        if (json[p] == ']') break;
        if (json[p] != '"') break;
        p += 1;
        const start = p;
        while (p < json.len and json[p] != '"') {
            if (json[p] == '\\') p += 1;
            p += 1;
        }
        if (p >= json.len) break;
        const s_buf = alloc.allocSentinel(u8, p - start, 0) catch return null;
        @memcpy(s_buf[0 .. p - start], json[start..p]);
        list.append(alloc, s_buf) catch return null;
        p += 1;
    }

    const out = alloc.alloc([:0]u8, list.items.len) catch return null;
    @memcpy(out, list.items);
    return out;
}

// ── Host callbacks ─────────────────────────────────────────────────

fn hostSpawn(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    if (info.length() < 1) return;
    const spec_json = argToStringAlloc(info, 0) orelse return;
    defer alloc.free(spec_json);

    const cmd_slice = extractStringField(spec_json, "cmd") orelse return;
    const cwd_slice = extractStringField(spec_json, "cwd");

    const args = parseArgsArray(spec_json);
    defer if (args) |a| {
        for (a) |s| alloc.free(s);
        alloc.free(a);
    };

    // The previous cap of 32 silently truncated longer commands — magick
    // chains in cart/cutout/backends/flood.ts blow this when the user
    // accumulates ~25+ click masks, and the partial command then fails with
    // confusing "MissingArgument" / "unbalanced parenthesis" errors from
    // magick because trailing args got dropped. 1024 covers any realistic
    // cart and is still well under POSIX ARG_MAX (~131072).
    const MAX_ARGV: usize = 1024;
    var native_argv: [MAX_ARGV + 1][]const u8 = undefined;
    native_argv[0] = cmd_slice;
    var argv_count: usize = 0;
    if (args) |a| {
        for (a) |s| {
            if (argv_count >= MAX_ARGV) break;
            native_argv[argv_count + 1] = s;
            argv_count += 1;
        }
    }

    const stdin_mode = extractStringField(spec_json, "stdin") orelse "pipe";
    const pipe_stdin = std.mem.eql(u8, stdin_mode, "pipe");

    const piped = process.spawnPiped(alloc, host.io, .{
        .argv = native_argv[0 .. argv_count + 1],
        .cwd = if (cwd_slice) |cwd| .{ .path = cwd } else .inherit,
        .environ_map = host.environ,
        .pgid = 0,
        .stdin = if (pipe_stdin) .pipe else if (std.mem.eql(u8, stdin_mode, "ignore")) .ignore else .inherit,
        .stdout = .pipe,
        .stderr = .pipe,
    }) catch {
        var pbuf: [512]u8 = undefined;
        if (std.fmt.bufPrint(&pbuf, "{{\"cmd\":\"{s}\",\"argc\":{d}}}", .{ cmd_slice, argv_count })) |p| {
            _ = event_bus.emit("proc.spawn.failed", "v8_bindings_process", null, p);
        } else |_| {
            _ = event_bus.emit("proc.spawn.failed", "v8_bindings_process", null, "{}");
        }
        const ret = info.getReturnValue();
        ret.set(v8.Integer.initI32(info.getIsolate(), 0));
        return;
    };

    // Successful spawn — auto-importance lands "spawn" at 0.6.
    // We log cmd + pid + argc (not the full argv — could contain
    // sensitive data; if a debugger needs more, the cart can pass it
    // through bus.emit on its own).
    var spawn_buf: [512]u8 = undefined;
    if (std.fmt.bufPrint(&spawn_buf, "{{\"cmd\":\"{s}\",\"pid\":{d},\"argc\":{d}}}", .{ cmd_slice, piped.process.pid, argv_count })) |p| {
        _ = event_bus.emit("proc.spawn", "v8_bindings_process", null, p);
    } else |_| {
        _ = event_bus.emit("proc.spawn", "v8_bindings_process", null, "{}");
    }

    var owned_piped = piped;
    const e = alloc.create(Entry) catch {
        owned_piped.deinit(host.io);
        const ret = info.getReturnValue();
        ret.set(v8.Integer.initI32(info.getIsolate(), 0));
        return;
    };
    e.* = .{
        .pid = owned_piped.process.pid,
        .piped = owned_piped,
        .stdout_done = !owned_piped.hasStdout(),
        .stderr_done = !owned_piped.hasStderr(),
    };
    g_entries.append(alloc, e) catch {
        e.piped.deinit(host.io);
        alloc.destroy(e);
        const ret = info.getReturnValue();
        ret.set(v8.Integer.initI32(info.getIsolate(), 0));
        return;
    };

    const ret = info.getReturnValue();
    ret.set(v8.Integer.initI32(info.getIsolate(), e.pid));
}

fn hostKill(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const pid = argToI32(info, 0) orelse return;
    const sig_name = if (info.length() >= 2) (argToStringAlloc(info, 1) orelse @constCast("SIGTERM")) else @constCast("SIGTERM");
    defer if (info.length() >= 2) alloc.free(sig_name);

    const e = findEntry(pid) orelse {
        const ret = info.getReturnValue();
        ret.set(v8.Boolean.init(info.getIsolate(), false));
        return;
    };
    const sig: process.Signal = if (std.mem.eql(u8, sig_name, "SIGKILL")) .kill_ else .term;
    e.piped.process.sendSignal(sig);
    const ret = info.getReturnValue();
    ret.set(v8.Boolean.init(info.getIsolate(), true));
}

fn hostStdinWrite(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    if (info.length() < 2) return;
    const pid = argToI32(info, 0) orelse return;
    const data = argToStringAlloc(info, 1) orelse return;
    defer alloc.free(data);

    const e = findEntry(pid) orelse {
        const ret = info.getReturnValue();
        ret.set(v8.Boolean.init(info.getIsolate(), false));
        return;
    };
    const ret = info.getReturnValue();
    ret.set(v8.Boolean.init(info.getIsolate(), e.piped.writeStdin(io, data)));
}

fn hostStdinClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    if (info.length() < 1) return;
    const pid = argToI32(info, 0) orelse return;
    const e = findEntry(pid) orelse return;
    e.piped.closeStdin(io);
}

// ── Tick drain ─────────────────────────────────────────────────────

const PipeKind = enum { stdout, stderr };

/// Drain a native file-pump queue into the line buffer. Returns true once the
/// pipe has reached EOF (or failed), after all queued bytes were consumed.
fn drainPipe(host: *HostContext, piped: *process.PipedProcess, kind: PipeKind, buf: []u8, len: *usize, channel: []const u8) bool {
    while (true) {
        if (len.* >= buf.len) {
            // Buffer full with no newline — flush as-is to keep moving.
            emitEvent(host, channel, buf[0..len.*]);
            len.* = 0;
        }
        const result = switch (kind) {
            .stdout => piped.drainStdout(buf[len.*..]),
            .stderr => piped.drainStderr(buf[len.*..]),
        };
        const n = switch (result) {
            .empty => return false,
            .closed, .failed => return true,
            .data => |count| count,
        };
        len.* += n;

        // Emit each complete line.
        while (true) {
            const slice = buf[0..len.*];
            const nl = std.mem.indexOfScalar(u8, slice, '\n') orelse break;
            emitEvent(host, channel, buf[0..nl]);
            const remaining = len.* - (nl + 1);
            if (remaining > 0) std.mem.copyForwards(u8, buf[0..remaining], buf[nl + 1 .. len.*]);
            len.* = remaining;
        }
    }
}

fn formatTermination(buffer: []u8, term: ?process.Term) ?[]const u8 {
    const native_term = term orelse return std.fmt.bufPrint(buffer, "{{\"code\":-1,\"signal\":null}}", .{}) catch null;
    return switch (native_term) {
        .exited => |code| std.fmt.bufPrint(buffer, "{{\"code\":{d},\"signal\":null}}", .{code}) catch null,
        .signal => |signal| std.fmt.bufPrint(buffer, "{{\"code\":-1,\"signal\":\"SIG{s}\"}}", .{@tagName(signal)}) catch null,
        .stopped => |signal| std.fmt.bufPrint(buffer, "{{\"code\":-1,\"signal\":\"SIG{s}\"}}", .{@tagName(signal)}) catch null,
        .unknown => std.fmt.bufPrint(buffer, "{{\"code\":-1,\"signal\":null}}", .{}) catch null,
    };
}

pub fn tickDrain(host: *HostContext) void {
    var i: usize = 0;
    while (i < g_entries.items.len) {
        const e = g_entries.items[i];
        var chan_buf: [64]u8 = undefined;

        if (!e.stdout_done) {
            if (std.fmt.bufPrint(&chan_buf, "proc:stdout:{d}", .{e.pid})) |chan| {
                e.stdout_done = drainPipe(host, &e.piped, .stdout, &e.out_buf, &e.out_len, chan);
            } else |_| {}
        }

        if (!e.stderr_done) {
            if (std.fmt.bufPrint(&chan_buf, "proc:stderr:{d}", .{e.pid})) |chan| {
                e.stderr_done = drainPipe(host, &e.piped, .stderr, &e.err_buf, &e.err_len, chan);
            } else |_| {}
        }

        // The waiter task publishes termination independently of the two file
        // pumps. Do not emit exit until both queues have reached EOF, or the
        // final bytes could be lost behind the exit event.
        if (!e.piped.process.alive() and e.stdout_done and e.stderr_done) {
            // Flush any trailing data without trailing newlines.
            if (e.out_len > 0) {
                if (std.fmt.bufPrint(&chan_buf, "proc:stdout:{d}", .{e.pid})) |chan| {
                    emitEvent(host, chan, e.out_buf[0..e.out_len]);
                } else |_| {}
                e.out_len = 0;
            }
            if (e.err_len > 0) {
                if (std.fmt.bufPrint(&chan_buf, "proc:stderr:{d}", .{e.pid})) |chan| {
                    emitEvent(host, chan, e.err_buf[0..e.err_len]);
                } else |_| {}
                e.err_len = 0;
            }

            var pl: [64]u8 = undefined;
            if (std.fmt.bufPrint(&chan_buf, "proc:exit:{d}", .{e.pid})) |chan| {
                if (formatTermination(&pl, e.piped.process.termination())) |payload| {
                    emitEvent(host, chan, payload);
                }
            } else |_| {}

            removeEntry(host.io, e.pid);
            // Don't increment i; next entry shifted into position.
            continue;
        }
        i += 1;
    }
    tickWatches(host);
}

// ── Per-process memory + cpu watcher ───────────────────────────────
//
// Tracks RSS and cpu ticks of arbitrary pids (need not be spawnPiped
// children — useful for monitoring sibling processes or the engine
// itself). Linux-only: reads /proc/<pid>/status + /proc/<pid>/stat.
// On non-Linux platforms watches are silently no-ops.
//
// Bindings:
//   __proc_watch_add(pid, intervalMs)   register a sample loop
//   __proc_watch_remove(pid)            tear it down
//   __proc_stat(pid) -> JSON | null     one-shot snapshot
//
// Each sample emits up to two channels (only when values change):
//   __ffiEmit('proc:ram:<pid>',
//             '{"pid":N,"id":N,"rss":N,"vsize":N,"memTotal":N,"percent":F}')
//   __ffiEmit('proc:cpu:<pid>',
//             '{"pid":N,"id":N,"utime":N,"stime":N,"delta":N,"intervalMs":N}')
//
// `percent` is rss/memTotal as a fraction in [0,1] — pairs with the
// JS-side derived trigger 'proc:ram:<pid>:>:<frac>' (see runtime/hooks/
// process.ts). Idle/threshold thresholds are computed in JS so this
// binding stays a thin sampler.

const Watch = struct {
    pid: c_int,
    interval_ms: u32,
    accum_ms: u32 = 0,
    last_rss: u64 = 0,
    last_vsize: u64 = 0,
    last_utime: u64 = 0,
    last_stime: u64 = 0,
    initialized: bool = false,
};

var g_watches: std.ArrayList(*Watch) = .empty;
var g_mem_total: u64 = 0;
var g_last_tick_ms: i64 = 0;

fn findWatch(pid: c_int) ?*Watch {
    for (g_watches.items) |w| if (w.pid == pid) return w;
    return null;
}

fn parseFirstU64(line: []const u8) u64 {
    var p: usize = 0;
    while (p < line.len and (line[p] < '0' or line[p] > '9')) p += 1;
    const start = p;
    while (p < line.len and line[p] >= '0' and line[p] <= '9') p += 1;
    if (start == p) return 0;
    return std.fmt.parseInt(u64, line[start..p], 10) catch 0;
}

fn systemMemTotal(io: std.Io) u64 {
    if (g_mem_total > 0) return g_mem_total;
    if (comptime builtin.os.tag != .linux) return 0;
    var file = std.Io.Dir.openFileAbsolute(io, "/proc/meminfo", .{}) catch return 0;
    defer file.close(io);
    var buf: [4096]u8 = undefined;
    const n = file.readStreaming(io, &.{&buf}) catch return 0;
    var line_iter = std.mem.splitScalar(u8, buf[0..n], '\n');
    while (line_iter.next()) |line| {
        if (std.mem.startsWith(u8, line, "MemTotal:")) {
            g_mem_total = parseFirstU64(line) * 1024;
            return g_mem_total;
        }
    }
    return 0;
}

const ProcSample = struct { rss: u64, vsize: u64, utime: u64, stime: u64 };

fn readProcSample(io: std.Io, pid: c_int) ?ProcSample {
    if (comptime builtin.os.tag != .linux) return null;
    if (pid <= 0) return null;
    var path_buf: [64]u8 = undefined;

    // /proc/<pid>/status — VmRSS / VmSize lines, both in kB.
    const status_path = std.fmt.bufPrint(&path_buf, "/proc/{d}/status", .{pid}) catch return null;
    var rss: u64 = 0;
    var vsize: u64 = 0;
    {
        var file = std.Io.Dir.openFileAbsolute(io, status_path, .{}) catch return null;
        defer file.close(io);
        var buf: [8192]u8 = undefined;
        const n = file.readStreaming(io, &.{&buf}) catch return null;
        var line_iter = std.mem.splitScalar(u8, buf[0..n], '\n');
        while (line_iter.next()) |line| {
            if (std.mem.startsWith(u8, line, "VmRSS:")) rss = parseFirstU64(line) * 1024 else if (std.mem.startsWith(u8, line, "VmSize:")) vsize = parseFirstU64(line) * 1024;
        }
    }

    // /proc/<pid>/stat — positional. The `comm` field is parens-wrapped and
    // can contain spaces and ')' chars, so split AFTER the LAST ')'. Then
    // utime is field 11 and stime is field 12 (0-indexed) in what remains.
    const stat_path = std.fmt.bufPrint(&path_buf, "/proc/{d}/stat", .{pid}) catch return null;
    var utime: u64 = 0;
    var stime: u64 = 0;
    {
        var file = std.Io.Dir.openFileAbsolute(io, stat_path, .{}) catch return null;
        defer file.close(io);
        var buf: [4096]u8 = undefined;
        const n = file.readStreaming(io, &.{&buf}) catch return null;
        const slice = buf[0..n];
        const close_paren = std.mem.lastIndexOfScalar(u8, slice, ')') orelse return null;
        var p = close_paren + 1;
        var idx: usize = 0;
        while (p < slice.len) {
            while (p < slice.len and slice[p] == ' ') p += 1;
            if (p >= slice.len) break;
            const start = p;
            while (p < slice.len and slice[p] != ' ' and slice[p] != '\n') p += 1;
            if (idx == 11) utime = std.fmt.parseInt(u64, slice[start..p], 10) catch 0;
            if (idx == 12) {
                stime = std.fmt.parseInt(u64, slice[start..p], 10) catch 0;
                break;
            }
            idx += 1;
        }
    }

    return .{ .rss = rss, .vsize = vsize, .utime = utime, .stime = stime };
}

fn emitRamSample(host: *HostContext, pid: c_int, rss: u64, vsize: u64, total: u64) void {
    var chan_buf: [64]u8 = undefined;
    const chan = std.fmt.bufPrint(&chan_buf, "proc:ram:{d}", .{pid}) catch return;
    var pl_buf: [256]u8 = undefined;
    const percent_thousand: u64 = if (total > 0) (rss * 1000) / total else 0;
    const pl = std.fmt.bufPrint(
        &pl_buf,
        "{{\"pid\":{d},\"id\":{d},\"rss\":{d},\"vsize\":{d},\"memTotal\":{d},\"percent\":{d}.{d:0>3}}}",
        .{ pid, pid, rss, vsize, total, percent_thousand / 1000, percent_thousand % 1000 },
    ) catch return;
    emitEvent(host, chan, pl);
}

fn emitCpuSample(host: *HostContext, pid: c_int, utime: u64, stime: u64, delta: u64, interval_ms: u32) void {
    var chan_buf: [64]u8 = undefined;
    const chan = std.fmt.bufPrint(&chan_buf, "proc:cpu:{d}", .{pid}) catch return;
    var pl_buf: [192]u8 = undefined;
    const pl = std.fmt.bufPrint(
        &pl_buf,
        "{{\"pid\":{d},\"id\":{d},\"utime\":{d},\"stime\":{d},\"delta\":{d},\"intervalMs\":{d}}}",
        .{ pid, pid, utime, stime, delta, interval_ms },
    ) catch return;
    emitEvent(host, chan, pl);
}

fn currentDtMs(io: std.Io) u32 {
    const now = std.Io.Clock.now(.awake, io).toMilliseconds();
    if (g_last_tick_ms == 0) {
        g_last_tick_ms = now;
        return 0;
    }
    const dt = now - g_last_tick_ms;
    g_last_tick_ms = now;
    if (dt <= 0) return 0;
    return @intCast(dt);
}

fn tickWatches(host: *HostContext) void {
    if (g_watches.items.len == 0) {
        g_last_tick_ms = 0; // reset so the first sample after re-arming has dt=0
        return;
    }
    const dt = currentDtMs(host.io);
    if (dt == 0) return;

    var i: usize = 0;
    while (i < g_watches.items.len) : (i += 1) {
        const w = g_watches.items[i];
        w.accum_ms += dt;
        if (w.accum_ms < w.interval_ms) continue;
        w.accum_ms = 0;
        const sample = readProcSample(host.io, w.pid) orelse continue;
        const total = systemMemTotal(host.io);
        if (!w.initialized) {
            w.initialized = true;
            w.last_rss = sample.rss;
            w.last_vsize = sample.vsize;
            w.last_utime = sample.utime;
            w.last_stime = sample.stime;
            emitRamSample(host, w.pid, sample.rss, sample.vsize, total);
            continue;
        }
        // RAM event: fire on noticeable change (>1MB or >0.5% of total).
        const noise: u64 = @max(1024 * 1024, total / 200);
        const drss = if (sample.rss > w.last_rss) sample.rss - w.last_rss else w.last_rss - sample.rss;
        if (drss >= noise) {
            emitRamSample(host, w.pid, sample.rss, sample.vsize, total);
            w.last_rss = sample.rss;
            w.last_vsize = sample.vsize;
        }
        // CPU event: any cpu tick advances the channel — IFTTT idle source
        // computes "no event for N ms" against this stream.
        const dut = if (sample.utime > w.last_utime) sample.utime - w.last_utime else 0;
        const dst = if (sample.stime > w.last_stime) sample.stime - w.last_stime else 0;
        const dcpu = dut + dst;
        if (dcpu > 0) {
            emitCpuSample(host, w.pid, sample.utime, sample.stime, dcpu, w.interval_ms);
            w.last_utime = sample.utime;
            w.last_stime = sample.stime;
        }
    }
}

fn hostProcStat(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    if (info.length() < 1) return;
    const pid = argToI32(info, 0) orelse return;
    const sample = readProcSample(host.io, pid) orelse {
        info.getReturnValue().set(v8.initNull(info.getIsolate()).toValue());
        return;
    };
    var json_buf: [256]u8 = undefined;
    const total = systemMemTotal(host.io);
    const percent_thousand: u64 = if (total > 0) (sample.rss * 1000) / total else 0;
    const json = std.fmt.bufPrint(
        &json_buf,
        "{{\"pid\":{d},\"rss\":{d},\"vsize\":{d},\"utime\":{d},\"stime\":{d},\"memTotal\":{d},\"percent\":{d}.{d:0>3}}}",
        .{ pid, sample.rss, sample.vsize, sample.utime, sample.stime, total, percent_thousand / 1000, percent_thousand % 1000 },
    ) catch return;
    const iso = info.getIsolate();
    const v = v8.String.initUtf8(iso, json);
    info.getReturnValue().set(v);
}

fn hostProcWatchAdd(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) return;
    const pid = argToI32(info, 0) orelse return;
    const interval = argToI32(info, 1) orelse 1000;
    if (pid <= 0) return;
    const interval_clamped: u32 = @intCast(@max(interval, 100));
    if (findWatch(pid)) |w| {
        w.interval_ms = interval_clamped;
        return;
    }
    const w = alloc.create(Watch) catch return;
    w.* = .{ .pid = pid, .interval_ms = interval_clamped };
    g_watches.append(alloc, w) catch {
        alloc.destroy(w);
        return;
    };
}

fn hostProcWatchRemove(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) return;
    const pid = argToI32(info, 0) orelse return;
    var i: usize = g_watches.items.len;
    while (i > 0) {
        i -= 1;
        if (g_watches.items[i].pid == pid) {
            alloc.destroy(g_watches.items[i]);
            _ = g_watches.orderedRemove(i);
            return;
        }
    }
}

// ── Registration ───────────────────────────────────────────────────

pub fn registerProcess(_: anytype) void {
    v8_runtime.registerHostFn("__proc_spawn", hostSpawn);
    v8_runtime.registerHostFn("__proc_kill", hostKill);
    v8_runtime.registerHostFn("__proc_stdin_write", hostStdinWrite);
    v8_runtime.registerHostFn("__proc_stdin_close", hostStdinClose);
    v8_runtime.registerHostFn("__proc_stat", hostProcStat);
    v8_runtime.registerHostFn("__proc_watch_add", hostProcWatchAdd);
    v8_runtime.registerHostFn("__proc_watch_remove", hostProcWatchRemove);
}
