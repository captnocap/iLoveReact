//! V8 bindings for the Zig-side IFTTT registry + timer wheel.
//!
//!   __ifttt_wire_alloc()             → wireId (u32, 0 on failure)
//!   __ifttt_wire_free(wireId)
//!   __ifttt_wire_bump(wireId, nowMs) — call from JS when a JS-driven
//!                                       trigger fires, so the registry's
//!                                       fired/lastAt counters stay live
//!                                       even for triggers Zig doesn't own.
//!   __ifttt_wire_count(wireId)        → number
//!   __ifttt_wire_last_at(wireId)      → number (ms epoch from JS)
//!   __ifttt_timer_register(everyMs, once, wireId) → timerId
//!   __ifttt_timer_cancel(timerId)
//!
//! Timer fires call back into JS via __ifttt_dispatch_timer(wireId) — the
//! cart-side dispatcher (runtime/hooks/useIFTTT.ts) maps wireId to the
//! actionRef and runs the action callback.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const ifttt = @import("ifttt_zig.zig");

fn argF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toF64(info.getIsolate().getCurrentContext()) catch null;
}

fn argU32(info: v8.FunctionCallbackInfo, idx: u32) ?u32 {
    const f = argF64(info, idx) orelse return null;
    if (f < 0) return null;
    return @intFromFloat(f);
}

fn setRetU32(info: v8.FunctionCallbackInfo, v: u32) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), @floatFromInt(v)));
}

fn setRetF64(info: v8.FunctionCallbackInfo, v: f64) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), v));
}

fn hostWireAlloc(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setRetU32(info, ifttt.wireAlloc());
}

fn hostWireFree(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argU32(info, 0) orelse return;
    ifttt.wireFree(id);
}

fn hostWireBump(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argU32(info, 0) orelse return;
    const now_ms = argF64(info, 1) orelse 0;
    ifttt.wireBump(id, now_ms);
}

fn hostWireCount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argU32(info, 0) orelse return setRetU32(info, 0);
    setRetU32(info, ifttt.wireCount(id));
}

fn hostWireLastAt(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argU32(info, 0) orelse return setRetF64(info, 0);
    setRetF64(info, ifttt.wireLastAt(id));
}

fn hostTimerRegister(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const every_ms = argU32(info, 0) orelse return setRetU32(info, 0);
    const once_n = argU32(info, 1) orelse 0;
    const wire_id = argU32(info, 2) orelse return setRetU32(info, 0);
    setRetU32(info, ifttt.timerRegister(every_ms, once_n != 0, wire_id));
}

fn hostTimerCancel(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argU32(info, 0) orelse return;
    ifttt.timerCancel(id);
}

pub fn registerIFTTT(_: anytype) void {
    v8_runtime.registerHostFn("__ifttt_wire_alloc", hostWireAlloc);
    v8_runtime.registerHostFn("__ifttt_wire_free", hostWireFree);
    v8_runtime.registerHostFn("__ifttt_wire_bump", hostWireBump);
    v8_runtime.registerHostFn("__ifttt_wire_count", hostWireCount);
    v8_runtime.registerHostFn("__ifttt_wire_last_at", hostWireLastAt);
    v8_runtime.registerHostFn("__ifttt_timer_register", hostTimerRegister);
    v8_runtime.registerHostFn("__ifttt_timer_cancel", hostTimerCancel);
}
