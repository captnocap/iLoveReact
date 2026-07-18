//! LuaJIT worker — off-thread compute via dlopen of libluajit-5.1.
//!
//! Same shape as framework/videos.zig and framework/storage/sqlite.zig:
//! no link-time dep on libluajit, no _real/_stub split. The library is
//! loaded on first use. If libluajit-5.1.so isn't installed, the typed Zig
//! API reports that the worker is unavailable.
//!
//! The V8 binding calls the typed Zig API directly so `std.Io` stays explicit.
//! Lua-facing host callbacks keep the Lua 5.1 C ABI and recover their state's
//! owner from a closure upvalue.
//!
//! Counter mode: atomic counters, zero-copy.
//! Message mode: ring-buffered string queues.

const std = @import("std");

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
const LUA_UPVALUE_1: c_int = LUA_GLOBALSINDEX - 1;

const FnNewState = *const fn () callconv(.c) ?*lua_State;
const FnClose = *const fn (?*lua_State) callconv(.c) void;
const FnOpenLibs = *const fn (?*lua_State) callconv(.c) void;
const FnLoadString = *const fn (?*lua_State, [*:0]const u8) callconv(.c) c_int;
const FnPCall = *const fn (?*lua_State, c_int, c_int, c_int) callconv(.c) c_int;
const FnPushCClosure = *const fn (?*lua_State, lua_CFunction, c_int) callconv(.c) void;
const FnPushInteger = *const fn (?*lua_State, lua_Integer) callconv(.c) void;
const FnPushBoolean = *const fn (?*lua_State, c_int) callconv(.c) void;
const FnPushLString = *const fn (?*lua_State, [*]const u8, usize) callconv(.c) void;
const FnPushLightUserdata = *const fn (?*lua_State, ?*anyopaque) callconv(.c) void;
const FnSetField = *const fn (?*lua_State, c_int, [*:0]const u8) callconv(.c) void;
const FnToLString = *const fn (?*lua_State, c_int, ?*usize) callconv(.c) ?[*]const u8;
const FnToInteger = *const fn (?*lua_State, c_int) callconv(.c) lua_Integer;
const FnToUserdata = *const fn (?*lua_State, c_int) callconv(.c) ?*anyopaque;
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
    push_light_userdata: FnPushLightUserdata,
    set_field: FnSetField,
    to_lstring: FnToLString,
    to_integer: FnToInteger,
    to_userdata: FnToUserdata,
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

fn report(io: std.Io, comptime fmt: []const u8, args: anytype) void {
    var buf: [256]u8 = undefined;
    const line = std.fmt.bufPrint(&buf, fmt, args) catch return;
    std.Io.File.stderr().writeStreamingAll(io, line) catch {};
}

fn loadLib(io: std.Io) ?*const Lib {
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
        report(io, "[luajit-worker] libluajit-5.1 not found ({} names tried) — disabled\n", .{SO_NAMES.len});
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
        .{ "lua_pushlightuserdata", FnPushLightUserdata },
        .{ "lua_setfield", FnSetField },
        .{ "lua_tolstring", FnToLString },
        .{ "lua_tointeger", FnToInteger },
        .{ "lua_touserdata", FnToUserdata },
        .{ "lua_settop", FnSettop },
    };
    inline for (syms) |entry| {
        if (dlsym(h, entry[0]) == null) {
            report(io, "[luajit-worker] missing symbol {s} — disabled\n", .{entry[0]});
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
        .push_light_userdata = @ptrCast(@alignCast(dlsym(h, "lua_pushlightuserdata").?)),
        .set_field = @ptrCast(@alignCast(dlsym(h, "lua_setfield").?)),
        .to_lstring = @ptrCast(@alignCast(dlsym(h, "lua_tolstring").?)),
        .to_integer = @ptrCast(@alignCast(dlsym(h, "lua_tointeger").?)),
        .to_userdata = @ptrCast(@alignCast(dlsym(h, "lua_touserdata").?)),
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
var g_tasks: std.Io.Group = .init;
var g_worker_started = false;

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

/// State reachable by Lua host callbacks. The value lives on `workerMain`'s
/// stack for exactly as long as the Lua state and is captured as light-userdata
/// in every registered C closure.
const LuaStateOwner = struct {
    io: std.Io,
    lib: *const Lib,
    inbox: *std.atomic.Value(i64),
    outbox: *std.atomic.Value(i64),
    running: *std.atomic.Value(bool),
    recv_time_ns: *std.atomic.Value(i64),
    msg_inbox: *MsgQueue,
    msg_outbox: *MsgQueue,
};

fn ownerFromState(L: ?*lua_State) ?*LuaStateOwner {
    const state = L orelse return null;
    // The dynamically loaded function pointer is process code, not a host
    // capability. The capability itself comes only from this state's upvalue.
    const lib = if (g_lib) |*loaded| loaded else return null;
    const opaque_owner = lib.to_userdata(state, LUA_UPVALUE_1) orelse return null;
    return @ptrCast(@alignCast(opaque_owner));
}

fn registerHostCallback(
    lib: *const Lib,
    L: ?*lua_State,
    owner: *LuaStateOwner,
    callback: lua_CFunction,
    name: [*:0]const u8,
) void {
    lib.push_light_userdata(L, @ptrCast(owner));
    lib.push_cclosure(L, callback, 1);
    setGlobal(lib, L, name);
}

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
    const owner = ownerFromState(L) orelse return 0;
    const pending = owner.inbox.load(.acquire);
    const processed = owner.outbox.load(.acquire);
    const lib = owner.lib;
    lib.push_integer(L, @intCast(pending - processed));
    return 1;
}

fn hostAck(L: ?*lua_State) callconv(.c) c_int {
    const owner = ownerFromState(L) orelse return 0;
    const lib = owner.lib;
    const count: i64 = @intCast(lib.to_integer(L, 1));
    _ = owner.outbox.fetchAdd(count, .release);
    const now = std.Io.Clock.now(.awake, owner.io);
    owner.recv_time_ns.store(@as(i64, @truncate(now.toNanoseconds())), .monotonic);
    return 0;
}

fn hostRunning(L: ?*lua_State) callconv(.c) c_int {
    const owner = ownerFromState(L) orelse return 0;
    owner.lib.push_boolean(L, if (owner.running.load(.monotonic)) 1 else 0);
    return 1;
}

fn hostRecvMsg(L: ?*lua_State) callconv(.c) c_int {
    const owner = ownerFromState(L) orelse return 0;
    var slot: MsgSlot = undefined;
    if (owner.msg_inbox.pop(&slot)) {
        owner.lib.push_lstring(L, &slot.data, slot.len);
        return 1;
    }
    return 0;
}

fn hostSendMsg(L: ?*lua_State) callconv(.c) c_int {
    const owner = ownerFromState(L) orelse return 0;
    var len: usize = 0;
    const ptr = owner.lib.to_lstring(L, 1, &len) orelse return 0;
    _ = owner.msg_outbox.push(ptr[0..len]);
    return 0;
}

// ── Worker thread ────────────────────────────────────────────────────

fn workerMain(io: std.Io) std.Io.Cancelable!void {
    const lib = loadLib(io) orelse return;
    const L = lib.new_state() orelse {
        report(io, "[luajit-worker] luaL_newstate returned null\n", .{});
        return;
    };
    defer lib.close(L);
    lib.openlibs(L);

    var owner: LuaStateOwner = .{
        .io = io,
        .lib = lib,
        .inbox = &g_inbox,
        .outbox = &g_outbox,
        .running = &g_running,
        .recv_time_ns = &g_recv_time_ns,
        .msg_inbox = &g_msg_inbox,
        .msg_outbox = &g_msg_outbox,
    };
    registerHostCallback(lib, L, &owner, hostRecv, "host_recv");
    registerHostCallback(lib, L, &owner, hostAck, "host_ack");
    registerHostCallback(lib, L, &owner, hostRunning, "host_running");
    registerHostCallback(lib, L, &owner, hostRecvMsg, "host_recv_msg");
    registerHostCallback(lib, L, &owner, hostSendMsg, "host_send_msg");

    var script_buf: [16384 + 1]u8 = undefined;
    const src: []const u8 = if (g_script_len > 0) g_script[0..g_script_len] else DEFAULT_SCRIPT;
    @memcpy(script_buf[0..src.len], src);
    script_buf[src.len] = 0;
    const script_z: [*:0]const u8 = @ptrCast(script_buf[0..src.len]);

    const rc = doString(lib, L, script_z);
    if (rc != LUA_OK) {
        report(io, "[luajit-worker] script error rc={d}\n", .{rc});
    }
}

// ── Typed Zig API: counter mode ──────────────────────────────────────

pub fn start(io: std.Io) c_long {
    if (g_running.load(.monotonic)) return 0;
    if (loadLib(io) == null) return -1;
    g_running.store(true, .release);
    g_inbox.store(0, .release);
    g_outbox.store(0, .release);
    g_tasks.concurrent(io, workerMain, .{io}) catch {
        report(io, "[luajit-worker] thread spawn failed\n", .{});
        g_running.store(false, .release);
        return -1;
    };
    g_worker_started = true;
    return 1;
}

pub fn stop(io: std.Io) c_long {
    if (!g_running.load(.monotonic)) return 0;
    g_running.store(false, .release);
    if (g_worker_started) _ = g_tasks.await(io) catch {};
    g_worker_started = false;
    return 1;
}

pub fn send(io: std.Io, count: c_long) c_long {
    const n = if (count > 0) count else g_bridge_n.load(.monotonic);
    const total = g_inbox.fetchAdd(n, .release) + n;
    const now = std.Io.Clock.now(.awake, io);
    g_send_time_ns.store(@as(i64, @truncate(now.toNanoseconds())), .monotonic);
    return @intCast(total);
}

pub fn recvCount() c_long {
    return @intCast(g_outbox.load(.acquire));
}

pub fn bridgeN() c_long {
    return @intCast(g_bridge_n.load(.acquire));
}

pub fn setN(n: c_long) c_long {
    g_bridge_n.store(n, .release);
    return n;
}

pub fn elapsedUs() c_long {
    const send_t = g_send_time_ns.load(.acquire);
    const recv_t = g_recv_time_ns.load(.acquire);
    if (recv_t > send_t) return @intCast(@divTrunc(recv_t - send_t, 1000));
    return 0;
}

// ── Typed Zig API: message mode ──────────────────────────────────────

pub fn sendMsg(msg: []const u8) c_long {
    if (g_msg_inbox.push(msg)) return @intCast(msg.len);
    return 0;
}

pub fn recvMsg(buf: []u8) c_long {
    if (buf.len == 0) return -1;
    var slot: MsgSlot = undefined;
    if (g_msg_outbox.pop(&slot)) {
        const copy_len = @min(slot.len, buf.len);
        @memcpy(buf[0..copy_len], slot.data[0..copy_len]);
        return @intCast(copy_len);
    }
    return 0;
}

pub fn eval(code: []const u8) c_long {
    const copy_len = @min(code.len, g_script.len);
    @memcpy(g_script[0..copy_len], code[0..copy_len]);
    g_script_len = copy_len;
    return @intCast(copy_len);
}

// ── Telemetry ────────────────────────────────────────────────────────

var g_last_telemetry_total: i64 = 0;

pub const Telemetry = struct {
    bridge_n: i64,
    processed_per_second: i64,
    processed_total: i64,
    pending: i64,
    latency_us: i64,
};

pub fn takeTelemetry() ?Telemetry {
    if (!g_running.load(.monotonic)) return null;
    const total = g_outbox.load(.acquire);
    const pending = g_inbox.load(.acquire);
    const n = g_bridge_n.load(.acquire);
    const per_sec = total - g_last_telemetry_total;
    g_last_telemetry_total = total;
    return .{
        .bridge_n = n,
        .processed_per_second = per_sec,
        .processed_total = total,
        .pending = pending - total,
        .latency_us = elapsedUs(),
    };
}

/// Returns true if libluajit is loadable on this system.
pub fn available(io: std.Io) bool {
    return loadLib(io) != null;
}

test "Lua callbacks recover their explicit per-state owner" {
    const io = std.testing.io;
    if (!available(io)) return error.SkipZigTest;

    _ = eval("host_ack(7)");
    defer {
        if (g_running.load(.acquire)) _ = stop(io);
        g_script_len = 0;
    }

    try std.testing.expectEqual(@as(c_long, 1), start(io));
    try std.testing.expectEqual(@as(c_long, 1), stop(io));
    try std.testing.expectEqual(@as(c_long, 7), recvCount());
    try std.testing.expect(g_recv_time_ns.load(.acquire) > 0);
}
