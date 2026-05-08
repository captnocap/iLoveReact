//! LuaJIT Worker — off-thread compute via zluajit
//!
//! Provides a background LuaJIT VM for compute-only workloads.
//! Workers NEVER touch rendering, layout, state, or the node tree.
//!
//! Two modes:
//!   1. Counter mode (lua_worker_send/recv_count) — atomic counters, zero-copy,
//!      matches the old C shim. Worker processes N items per batch.
//!   2. Message mode (lua_worker_send_msg/recv_msg) — string messages for real data.
//!
//! Counter mode uses atomics (no mutex). Message mode uses a small ring buffer.

const std = @import("std");
const log = @import("log.zig");
const zluajit = @import("zluajit");

// ── Atomic counter bridge (zero-copy, for stress tests) ─────────────

var g_inbox = std.atomic.Value(i64).init(0);
var g_outbox = std.atomic.Value(i64).init(0);
var g_bridge_n = std.atomic.Value(i64).init(10);
var g_running = std.atomic.Value(bool).init(false);
var g_send_time_ns = std.atomic.Value(i64).init(0);
var g_recv_time_ns = std.atomic.Value(i64).init(0);
var g_thread: ?std.Thread = null;

// ── Message queue (for real string data, separate from counter mode) ─

const MAX_MSG_LEN = 512;
const MSG_QUEUE_SIZE = 1024;

const MsgSlot = struct {
    data: [MAX_MSG_LEN]u8 = undefined,
    len: usize = 0,
};

const MsgQueue = struct {
    buf: [MSG_QUEUE_SIZE]MsgSlot = undefined,
    head: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),
    tail: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),

    fn push(self: *MsgQueue, data: []const u8) bool {
        const tail = self.tail.load(.acquire);
        const next = (tail + 1) % MSG_QUEUE_SIZE;
        if (next == self.head.load(.acquire)) return false; // full
        const copy_len = @min(data.len, MAX_MSG_LEN);
        @memcpy(self.buf[tail].data[0..copy_len], data[0..copy_len]);
        self.buf[tail].len = copy_len;
        self.tail.store(next, .release);
        return true;
    }

    fn pop(self: *MsgQueue, out: *MsgSlot) bool {
        const head = self.head.load(.acquire);
        if (head == self.tail.load(.acquire)) return false; // empty
        out.* = self.buf[head];
        self.head.store((head + 1) % MSG_QUEUE_SIZE, .release);
        return true;
    }
};

var g_msg_inbox: MsgQueue = .{};
var g_msg_outbox: MsgQueue = .{};

// ── Lua script storage ──────────────────────────────────────────────

var g_script: [16384]u8 = undefined;
var g_script_len: usize = 0;

// Default worker script: process counter messages in batches
const DEFAULT_SCRIPT =
    \\while host_running() do
    \\  local avail = host_recv()
    \\  if avail > 0 then
    \\    for i = 1, avail do
    \\      local sum = 0
    \\      for j = 1, 100 do
    \\        sum = sum + j * j
    \\      end
    \\    end
    \\    host_ack(avail)
    \\  end
    \\end
;

// ── Host functions (registered into LuaJIT VM via zluajit) ──────────

// Counter mode: returns number of pending messages (not strings)
fn hostRecv(state: zluajit.State) c_int {
    const pending = g_inbox.load(.acquire);
    const processed = g_outbox.load(.acquire);
    const available = pending - processed;
    state.pushInteger(@intCast(available));
    return 1;
}

// Counter mode: acknowledge N processed messages
fn hostAck(_: zluajit.State) c_int {
    // Arg is on the Lua stack but we get it via checkInteger
    // Actually we need to read from the state
    return 0;
}

// We need a version that takes the state to read the argument
fn hostAckWithState(state: zluajit.State) c_int {
    const count = state.checkInteger(1);
    _ = g_outbox.fetchAdd(count, .release);
    g_recv_time_ns.store(@as(i64, @truncate(std.time.nanoTimestamp())), .monotonic);
    return 0;
}

fn hostRunning(state: zluajit.State) c_int {
    state.pushBool(g_running.load(.monotonic));
    return 1;
}

// Message mode: poll inbox for a string message
fn hostRecvMsg(state: zluajit.State) c_int {
    var slot: MsgSlot = undefined;
    if (g_msg_inbox.pop(&slot)) {
        state.pushString(slot.data[0..slot.len]);
        return 1;
    }
    return 0; // nil
}

// Message mode: send a string result
fn hostSendMsg(state: zluajit.State) c_int {
    if (state.toString(1)) |s| {
        _ = g_msg_outbox.push(s);
    }
    return 0;
}

// ── Worker thread ───────────────────────────────────────────────────

fn workerMain() void {
    const state = zluajit.State.init(.{}) catch {
        std.log.err("[luajit-worker] Failed to create Lua state", .{});
        return;
    };
    defer state.deinit();
    state.openLibs();

    // Register host functions — counter mode
    state.pushZFunction(hostRecv);
    state.setGlobal("host_recv");
    state.pushZFunction(hostAckWithState);
    state.setGlobal("host_ack");
    state.pushZFunction(hostRunning);
    state.setGlobal("host_running");

    // Register host functions — message mode
    state.pushZFunction(hostRecvMsg);
    state.setGlobal("host_recv_msg");
    state.pushZFunction(hostSendMsg);
    state.setGlobal("host_send_msg");

    // Run the script
    const script = if (g_script_len > 0)
        g_script[0..g_script_len]
    else
        @as([]const u8, DEFAULT_SCRIPT);

    state.doString(script, null) catch |err| {
        std.log.err("[luajit-worker] Lua error: {}", .{err});
    };
}

// ── C exports: counter mode (matches old C shim API) ────────────────

export fn lua_worker_start() callconv(.c) c_long {
    if (g_running.load(.monotonic)) return 0;
    g_running.store(true, .release);
    g_inbox.store(0, .release);
    g_outbox.store(0, .release);

    g_thread = std.Thread.spawn(.{}, workerMain, .{}) catch {
        std.log.err("[luajit-worker] Failed to spawn thread", .{});
        g_running.store(false, .release);
        return -1;
    };
    return 1;
}

export fn lua_worker_stop() callconv(.c) c_long {
    if (!g_running.load(.monotonic)) return 0;
    g_running.store(false, .release);
    if (g_thread) |t| {
        t.join();
        g_thread = null;
    }
    return 1;
}

export fn lua_worker_send(count: c_long) callconv(.c) c_long {
    const n = if (count > 0) count else g_bridge_n.load(.monotonic);
    const total = g_inbox.fetchAdd(n, .release) + n;
    g_send_time_ns.store(@as(i64, @truncate(std.time.nanoTimestamp())), .monotonic);
    return @intCast(total);
}

export fn lua_worker_recv_count() callconv(.c) c_long {
    return @intCast(g_outbox.load(.acquire));
}

export fn lua_worker_bridge_n() callconv(.c) c_long {
    return @intCast(g_bridge_n.load(.acquire));
}

export fn lua_worker_set_n(n: c_long) callconv(.c) c_long {
    g_bridge_n.store(n, .release);
    return n;
}

export fn lua_worker_elapsed_us() callconv(.c) c_long {
    const send_t = g_send_time_ns.load(.acquire);
    const recv_t = g_recv_time_ns.load(.acquire);
    if (recv_t > send_t) return @intCast(@divTrunc(recv_t - send_t, 1000));
    return 0;
}

// ── C exports: message mode ─────────────────────────────────────────

export fn lua_worker_send_msg(msg: [*c]const u8, len: c_long) callconv(.c) c_long {
    if (msg == null) return -1;
    const msg_len: usize = if (len > 0) @intCast(len) else std.mem.len(msg);
    const s: []const u8 = @as([*]const u8, @ptrCast(msg))[0..msg_len];
    if (g_msg_inbox.push(s)) {
        return @intCast(msg_len);
    }
    return 0;
}

export fn lua_worker_recv_msg(buf: [*c]u8, buf_len: c_long) callconv(.c) c_long {
    if (buf == null or buf_len <= 0) return -1;
    var slot: MsgSlot = undefined;
    if (g_msg_outbox.pop(&slot)) {
        const copy_len = @min(slot.len, @as(usize, @intCast(buf_len)));
        @memcpy(buf[0..copy_len], slot.data[0..copy_len]);
        return @intCast(copy_len);
    }
    return 0;
}

// ── Telemetry (called by engine 1Hz loop) ───────────────────────────

var g_last_telemetry_total: i64 = 0;

/// Log Lua worker stats. Called from engine.zig telemetry section.
pub fn logTelemetry() void {
    if (!g_running.load(.monotonic)) return;
    const total = g_outbox.load(.acquire);
    const pending = g_inbox.load(.acquire);
    const n = g_bridge_n.load(.acquire);
    const per_sec = total - g_last_telemetry_total;
    g_last_telemetry_total = total;
    const latency = lua_worker_elapsed_us();
    log.print("[lua-worker] N={d} | processed: {d}/s | total: {d} | pending: {d} | latency: {d}us\n", .{
        n, per_sec, total, pending - total, latency,
    });
}

export fn lua_worker_eval(code: [*c]const u8, len: c_long) callconv(.c) c_long {
    if (code == null) return -1;
    const code_len: usize = if (len > 0) @intCast(len) else std.mem.len(code);
    const copy_len = @min(code_len, g_script.len);
    @memcpy(g_script[0..copy_len], @as([*]const u8, @ptrCast(code))[0..copy_len]);
    g_script_len = copy_len;
    return @intCast(copy_len);
}
