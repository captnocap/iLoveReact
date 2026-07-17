//! LuaJIT worker — off-thread compute via dlopen of libluajit-5.1.
//!
//! Same shape as framework/videos.zig and framework/storage/sqlite.zig:
//! no link-time dep on libluajit, no _real/_stub split. The library is
//! loaded on first call to lua_worker_start. If libluajit-5.1.so isn't
//! installed, every export returns 0 and the worker thread never starts.
//!
//! C exports preserved verbatim (the V8 bindings reach them through the
//! linker by mangled name): lua_worker_start/stop/send/recv_count/
//! bridge_n/set_n/elapsed_us/send_msg/recv_msg/eval.
//!
//! Counter mode: atomic counters, zero-copy.
//! Message mode: ring-buffered string queues.

const std = @import("std");
const host_io = @import("../host_io.zig");
const log = @import("../diag/log.zig");

extern fn dlopen(filename: ?[*:0]const u8, flags: c_int) ?*anyopaque;
extern fn dlsym(handle: *anyopaque, symbol: [*:0]const u8) ?*anyopaque;

const RTLD_LAZY: c_int = 0x00001;
const RTLD_GLOBAL: c_int = 0x00100;

// ── Lua C API (LuaJIT 2.1 = Lua 5.1 ABI) ─────────────────────────────

const lua_State = opaque {};
const lua_Integer = isize;
const lua_CFunction = *const fn (?*lua_State) callconv(.c) c_int;

const LUA_OK: c_int = 0;
const LUA_MULTRET: c_int = -1;
const LUA_GLOBALSINDEX: c_int = -10002;

const FnNewState = *const fn () callconv(.c) ?*lua_State;
const FnClose = *const fn (?*lua_State) callconv(.c) void;
const FnOpenLibs = *const fn (?*lua_State) callconv(.c) void;
const FnLoadString = *const fn (?*lua_State, [*:0]const u8) callconv(.c) c_int;
const FnPCall = *const fn (?*lua_State, c_int, c_int, c_int) callconv(.c) c_int;
const FnPushCClosure = *const fn (?*lua_State, lua_CFunction, c_int) callconv(.c) void;
const FnPushInteger = *const fn (?*lua_State, lua_Integer) callconv(.c) void;
const FnPushBoolean = *const fn (?*lua_State, c_int) callconv(.c) void;
const FnPushLString = *const fn (?*lua_State, [*]const u8, usize) callconv(.c) void;
const FnSetField = *const fn (?*lua_State, c_int, [*:0]const u8) callconv(.c) void;
const FnToLString = *const fn (?*lua_State, c_int, ?*usize) callconv(.c) ?[*]const u8;
const FnToInteger = *const fn (?*lua_State, c_int) callconv(.c) lua_Integer;
const FnSettop = *const fn (?*lua_State, c_int) callconv(.c) void;

const Lib = struct {
    new_state: FnNewState,
    close: FnClose,
    openlibs: FnOpenLibs,
    loadstring: FnLoadString,
    pcall: FnPCall,
    push_cclosure: FnPushCClosure,
    push_integer: FnPushInteger,
    push_boolean: FnPushBoolean,
    push_lstring: FnPushLString,
    set_field: FnSetField,
    to_lstring: FnToLString,
    to_integer: FnToInteger,
    settop: FnSettop,
};

const SO_NAMES = [_][*:0]const u8{
    "libluajit-5.1.so.2",
    "libluajit-5.1.so",
    "libluajit.so.2",
    "libluajit.so",
    "libluajit-5.1.dylib",
};

var g_lib: ?Lib = null;
var g_tried: bool = false;

fn loadLib() ?*const Lib {
    if (g_lib) |*l| return l;
    if (g_tried) return null;
    g_tried = true;

    var handle: ?*anyopaque = null;
    for (SO_NAMES) |name| {
        // RTLD_GLOBAL so that any C functions we register see luajit's globals.
        handle = dlopen(name, RTLD_LAZY | RTLD_GLOBAL);
        if (handle != null) break;
    }
    if (handle == null) {
        std.debug.print("[luajit-worker] libluajit-5.1 not found ({} names tried) — disabled\n", .{SO_NAMES.len});
        return null;
    }
    const h = handle.?;

    const syms = .{
        .{ "luaL_newstate", FnNewState },
        .{ "lua_close", FnClose },
        .{ "luaL_openlibs", FnOpenLibs },
        .{ "luaL_loadstring", FnLoadString },
        .{ "lua_pcall", FnPCall },
        .{ "lua_pushcclosure", FnPushCClosure },
        .{ "lua_pushinteger", FnPushInteger },
        .{ "lua_pushboolean", FnPushBoolean },
        .{ "lua_pushlstring", FnPushLString },
        .{ "lua_setfield", FnSetField },
        .{ "lua_tolstring", FnToLString },
        .{ "lua_tointeger", FnToInteger },
        .{ "lua_settop", FnSettop },
    };
    inline for (syms) |entry| {
        if (dlsym(h, entry[0]) == null) {
            std.debug.print("[luajit-worker] missing symbol {s} — disabled\n", .{entry[0]});
            return null;
        }
    }

    g_lib = .{
        .new_state = @ptrCast(@alignCast(dlsym(h, "luaL_newstate").?)),
        .close = @ptrCast(@alignCast(dlsym(h, "lua_close").?)),
        .openlibs = @ptrCast(@alignCast(dlsym(h, "luaL_openlibs").?)),
        .loadstring = @ptrCast(@alignCast(dlsym(h, "luaL_loadstring").?)),
        .pcall = @ptrCast(@alignCast(dlsym(h, "lua_pcall").?)),
        .push_cclosure = @ptrCast(@alignCast(dlsym(h, "lua_pushcclosure").?)),
        .push_integer = @ptrCast(@alignCast(dlsym(h, "lua_pushinteger").?)),
        .push_boolean = @ptrCast(@alignCast(dlsym(h, "lua_pushboolean").?)),
        .push_lstring = @ptrCast(@alignCast(dlsym(h, "lua_pushlstring").?)),
        .set_field = @ptrCast(@alignCast(dlsym(h, "lua_setfield").?)),
        .to_lstring = @ptrCast(@alignCast(dlsym(h, "lua_tolstring").?)),
        .to_integer = @ptrCast(@alignCast(dlsym(h, "lua_tointeger").?)),
        .settop = @ptrCast(@alignCast(dlsym(h, "lua_settop").?)),
    };
    return &g_lib.?;
}

// luaL_dostring(L, s) ≡ luaL_loadstring(L, s) || lua_pcall(L, 0, MULTRET, 0)
fn doString(lib: *const Lib, L: ?*lua_State, code_z: [*:0]const u8) c_int {
    const rc = lib.loadstring(L, code_z);
    if (rc != LUA_OK) return rc;
    return lib.pcall(L, 0, LUA_MULTRET, 0);
}

fn setGlobal(lib: *const Lib, L: ?*lua_State, name: [*:0]const u8) void {
    lib.set_field(L, LUA_GLOBALSINDEX, name);
}

// ── Atomic counter bridge (zero-copy) ────────────────────────────────

var g_inbox = std.atomic.Value(i64).init(0);
var g_outbox = std.atomic.Value(i64).init(0);
var g_bridge_n = std.atomic.Value(i64).init(10);
var g_running = std.atomic.Value(bool).init(false);
var g_send_time_ns = std.atomic.Value(i64).init(0);
var g_recv_time_ns = std.atomic.Value(i64).init(0);
var g_thread: ?std.Thread = null;

// ── Message queues (string ring buffers) ─────────────────────────────

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
        if (next == self.head.load(.acquire)) return false;
        const copy_len = @min(data.len, MAX_MSG_LEN);
        @memcpy(self.buf[tail].data[0..copy_len], data[0..copy_len]);
        self.buf[tail].len = copy_len;
        self.tail.store(next, .release);
        return true;
    }

    fn pop(self: *MsgQueue, out: *MsgSlot) bool {
        const head = self.head.load(.acquire);
        if (head == self.tail.load(.acquire)) return false;
        out.* = self.buf[head];
        self.head.store((head + 1) % MSG_QUEUE_SIZE, .release);
        return true;
    }
};

var g_msg_inbox: MsgQueue = .{};
var g_msg_outbox: MsgQueue = .{};

// ── Lua script storage ───────────────────────────────────────────────

var g_script: [16384]u8 = undefined;
var g_script_len: usize = 0;

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

// ── Lua-callable host functions ──────────────────────────────────────

fn hostRecv(L: ?*lua_State) callconv(.c) c_int {
    const lib = loadLib() orelse return 0;
    const pending = g_inbox.load(.acquire);
    const processed = g_outbox.load(.acquire);
    lib.push_integer(L, @intCast(pending - processed));
    return 1;
}

fn hostAck(L: ?*lua_State) callconv(.c) c_int {
    const lib = loadLib() orelse return 0;
    const count: i64 = @intCast(lib.to_integer(L, 1));
    _ = g_outbox.fetchAdd(count, .release);
    g_recv_time_ns.store(@as(i64, @truncate(host_io.nanoTimestamp())), .monotonic);
    return 0;
}

fn hostRunning(L: ?*lua_State) callconv(.c) c_int {
    const lib = loadLib() orelse return 0;
    lib.push_boolean(L, if (g_running.load(.monotonic)) 1 else 0);
    return 1;
}

fn hostRecvMsg(L: ?*lua_State) callconv(.c) c_int {
    const lib = loadLib() orelse return 0;
    var slot: MsgSlot = undefined;
    if (g_msg_inbox.pop(&slot)) {
        lib.push_lstring(L, &slot.data, slot.len);
        return 1;
    }
    return 0;
}

fn hostSendMsg(L: ?*lua_State) callconv(.c) c_int {
    const lib = loadLib() orelse return 0;
    var len: usize = 0;
    const ptr = lib.to_lstring(L, 1, &len) orelse return 0;
    _ = g_msg_outbox.push(ptr[0..len]);
    return 0;
}

// ── Worker thread ────────────────────────────────────────────────────

fn workerMain() void {
    const lib = loadLib() orelse return;
    const L = lib.new_state() orelse {
        std.debug.print("[luajit-worker] luaL_newstate returned null\n", .{});
        return;
    };
    defer lib.close(L);
    lib.openlibs(L);

    lib.push_cclosure(L, hostRecv, 0);
    setGlobal(lib, L, "host_recv");
    lib.push_cclosure(L, hostAck, 0);
    setGlobal(lib, L, "host_ack");
    lib.push_cclosure(L, hostRunning, 0);
    setGlobal(lib, L, "host_running");
    lib.push_cclosure(L, hostRecvMsg, 0);
    setGlobal(lib, L, "host_recv_msg");
    lib.push_cclosure(L, hostSendMsg, 0);
    setGlobal(lib, L, "host_send_msg");

    var script_buf: [16384 + 1]u8 = undefined;
    const src: []const u8 = if (g_script_len > 0) g_script[0..g_script_len] else DEFAULT_SCRIPT;
    @memcpy(script_buf[0..src.len], src);
    script_buf[src.len] = 0;
    const script_z: [*:0]const u8 = @ptrCast(script_buf[0..src.len]);

    const rc = doString(lib, L, script_z);
    if (rc != LUA_OK) {
        std.debug.print("[luajit-worker] script error rc={d}\n", .{rc});
    }
}

// ── C exports: counter mode ──────────────────────────────────────────

export fn lua_worker_start() callconv(.c) c_long {
    if (g_running.load(.monotonic)) return 0;
    if (loadLib() == null) return -1;
    g_running.store(true, .release);
    g_inbox.store(0, .release);
    g_outbox.store(0, .release);
    g_thread = std.Thread.spawn(.{}, workerMain, .{}) catch {
        std.debug.print("[luajit-worker] thread spawn failed\n", .{});
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
    g_send_time_ns.store(@as(i64, @truncate(host_io.nanoTimestamp())), .monotonic);
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

// ── C exports: message mode ──────────────────────────────────────────

export fn lua_worker_send_msg(msg: [*c]const u8, len: c_long) callconv(.c) c_long {
    if (msg == null) return -1;
    const msg_len: usize = if (len > 0) @intCast(len) else std.mem.len(msg);
    const s: []const u8 = @as([*]const u8, @ptrCast(msg))[0..msg_len];
    if (g_msg_inbox.push(s)) return @intCast(msg_len);
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

export fn lua_worker_eval(code: [*c]const u8, len: c_long) callconv(.c) c_long {
    if (code == null) return -1;
    const code_len: usize = if (len > 0) @intCast(len) else std.mem.len(code);
    const copy_len = @min(code_len, g_script.len);
    @memcpy(g_script[0..copy_len], @as([*]const u8, @ptrCast(code))[0..copy_len]);
    g_script_len = copy_len;
    return @intCast(copy_len);
}

// ── Telemetry ────────────────────────────────────────────────────────

var g_last_telemetry_total: i64 = 0;

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

/// Returns true if libluajit is loadable on this system.
pub fn available() bool {
    return loadLib() != null;
}
