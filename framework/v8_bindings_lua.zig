//! Lua host bindings — V8 FFI bridge for framework/process/luajit_worker.zig.
//!
//! The LuaJIT off-thread worker is compiled into every cart and exposed to
//! cart JS as the `__lua_*` family. These callbacks recover the root-owned
//! `HostContext` from V8 and call the worker's typed Zig API directly.
//!
//! Host fns:
//!   __lua_available()                   1 if libluajit-5.1 is loadable
//!   __lua_start()                       1 = started, 0 = already running, -1 = no luajit
//!   __lua_stop()                        1 = stopped, 0 = was idle
//!   __lua_eval(code)                    bytes copied into the worker script slot
//!   __lua_send_msg(msg)                 bytes pushed onto the worker's inbox
//!   __lua_recv_msg()                    string popped from outbox, or "" on empty
//!   __lua_elapsed_us()                  last send→ack roundtrip in microseconds
//!   __lua_send(count)                   counter-mode: enqueue N units
//!   __lua_recv_count()                  counter-mode: total acked
//!   __lua_set_n(n)                      counter-mode: set bridge_n
//!
//! libluajit is dlopen'd lazily inside luajit_worker — there is no link-time
//! dependency. Every host fn here returns a safe zero/empty if luajit isn't
//! installed, so this binding is cheap to register universally.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");

const alloc = std.heap.c_allocator;

const luajit_worker = @import("process/luajit_worker.zig");

// ── helpers (same pattern as v8_bindings_process) ────────────────────

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

fn setReturnNumber(info: v8.FunctionCallbackInfo, value: f64) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.Number.init(iso, value));
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.String.initUtf8(iso, text));
}

// ── host fns ─────────────────────────────────────────────────────────

fn hostAvailable(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (luajit_worker.available(v8_runtime.hostContext(info.getIsolate()).io)) 1 else 0);
}

fn hostStart(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    setReturnNumber(info, @floatFromInt(luajit_worker.start(io)));
}

fn hostStop(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    setReturnNumber(info, @floatFromInt(luajit_worker.stop(io)));
}

fn hostEval(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        setReturnNumber(info, 0);
        return;
    }
    const code = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, 0);
        return;
    };
    defer alloc.free(code);
    const n = luajit_worker.eval(code);
    setReturnNumber(info, @floatFromInt(n));
}

fn hostSendMsg(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        setReturnNumber(info, -1);
        return;
    }
    const msg = argToStringAlloc(info, 0) orelse {
        setReturnNumber(info, -1);
        return;
    };
    defer alloc.free(msg);
    const n = luajit_worker.sendMsg(msg);
    setReturnNumber(info, @floatFromInt(n));
}

// recv_msg returns the popped string (or "" if the outbox is empty).
// Cap at 1KB which matches MAX_MSG_LEN×2 — recvMsg always reads at most
// one slot, and slots are MAX_MSG_LEN=512 in luajit_worker.zig.
fn hostRecvMsg(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var buf: [1024]u8 = undefined;
    const n = luajit_worker.recvMsg(&buf);
    if (n <= 0) {
        setReturnString(info, "");
        return;
    }
    setReturnString(info, buf[0..@intCast(n)]);
}

fn hostElapsedUs(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatFromInt(luajit_worker.elapsedUs()));
}

fn hostSend(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const count: c_long = if (info.length() >= 1)
        @intCast(argToI32(info, 0) orelse 0)
    else
        0;
    const io = v8_runtime.hostContext(info.getIsolate()).io;
    setReturnNumber(info, @floatFromInt(luajit_worker.send(io, count)));
}

fn hostRecvCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, @floatFromInt(luajit_worker.recvCount()));
}

fn hostSetN(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const n: c_long = if (info.length() >= 1)
        @intCast(argToI32(info, 0) orelse 10)
    else
        10;
    setReturnNumber(info, @floatFromInt(luajit_worker.setN(n)));
}

// ── Registration ─────────────────────────────────────────────────────

pub fn registerLua(_: anytype) void {
    v8_runtime.registerHostFn("__lua_available", hostAvailable);
    v8_runtime.registerHostFn("__lua_start", hostStart);
    v8_runtime.registerHostFn("__lua_stop", hostStop);
    v8_runtime.registerHostFn("__lua_eval", hostEval);
    v8_runtime.registerHostFn("__lua_send_msg", hostSendMsg);
    v8_runtime.registerHostFn("__lua_recv_msg", hostRecvMsg);
    v8_runtime.registerHostFn("__lua_elapsed_us", hostElapsedUs);
    v8_runtime.registerHostFn("__lua_send", hostSend);
    v8_runtime.registerHostFn("__lua_recv_count", hostRecvCount);
    v8_runtime.registerHostFn("__lua_set_n", hostSetN);
}
