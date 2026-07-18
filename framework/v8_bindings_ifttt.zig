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
const ifttt = @import("ifttt/ifttt.zig");
const hotstate = @import("state/hotstate.zig");

const STATE_KEY_PREFIX = "ifttt:";

fn argF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toF64(info.getIsolate().getCurrentContext()) catch null;
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

fn setRetNull(info: v8.FunctionCallbackInfo) void {
    info.getReturnValue().set(v8.initNull(info.getIsolate()).toValue());
}

fn setRetUndefined(info: v8.FunctionCallbackInfo) void {
    info.getReturnValue().set(v8.initUndefined(info.getIsolate()).toValue());
}

fn setRetString(info: v8.FunctionCallbackInfo, value: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), value));
}

fn prefixedKey(alloc: std.mem.Allocator, raw: []const u8) ?[]u8 {
    const out = alloc.alloc(u8, STATE_KEY_PREFIX.len + raw.len) catch return null;
    @memcpy(out[0..STATE_KEY_PREFIX.len], STATE_KEY_PREFIX);
    @memcpy(out[STATE_KEY_PREFIX.len..], raw);
    return out;
}

fn argU32(info: v8.FunctionCallbackInfo, idx: u32) ?u32 {
    const f = argF64(info, idx) orelse return null;
    if (f < 0) return null;
    return @trunc(f);
}

fn setRetU32(info: v8.FunctionCallbackInfo, v: u32) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), v));
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

fn hostKeyRegister(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const sym = argU32(info, 0) orelse return setRetU32(info, 0);
    const want_ctrl = (argU32(info, 1) orelse 0) != 0;
    const want_shift = (argU32(info, 2) orelse 0) != 0;
    const want_alt = (argU32(info, 3) orelse 0) != 0;
    const want_meta = (argU32(info, 4) orelse 0) != 0;
    const is_keyup = (argU32(info, 5) orelse 0) != 0;
    const wire = argU32(info, 6) orelse return setRetU32(info, 0);
    setRetU32(info, ifttt.keyRegister(sym, want_ctrl, want_shift, want_alt, want_meta, is_keyup, wire));
}

fn hostKeyUnregister(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const id = argU32(info, 0) orelse return;
    ifttt.keyUnregister(id);
}

fn hostLastKey(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setRetF64(info, @floatFromInt(ifttt.lastDispatchedKey()));
}

// State store — values JSON-encoded by JS, persisted in framework/hotstate.zig
// (the same store useHotState uses, behind an `ifttt:` key prefix). Survives
// JS hot reloads: the Zig store outlives the V8 isolate teardown so reseeding
// the JS-side watcher map after reload reads the live last-known values.
fn hostStateGet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const a = std.heap.page_allocator;
    const raw = argStringAlloc(a, info, 0) orelse return setRetNull(info);
    defer a.free(raw);
    const k = prefixedKey(a, raw) orelse return setRetNull(info);
    defer a.free(k);
    if (hotstate.get(k)) |v| setRetString(info, v) else setRetNull(info);
}

fn hostStateSet(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const a = std.heap.page_allocator;
    const raw = argStringAlloc(a, info, 0) orelse return setRetUndefined(info);
    defer a.free(raw);
    const json = argStringAlloc(a, info, 1) orelse return setRetUndefined(info);
    defer a.free(json);
    const k = prefixedKey(a, raw) orelse return setRetUndefined(info);
    defer a.free(k);
    hotstate.set(k, json);
    setRetUndefined(info);
}

pub fn registerIFTTT(_: anytype) void {
    v8_runtime.registerHostFn("__ifttt_wire_alloc", hostWireAlloc);
    v8_runtime.registerHostFn("__ifttt_wire_free", hostWireFree);
    v8_runtime.registerHostFn("__ifttt_wire_bump", hostWireBump);
    v8_runtime.registerHostFn("__ifttt_wire_count", hostWireCount);
    v8_runtime.registerHostFn("__ifttt_wire_last_at", hostWireLastAt);
    v8_runtime.registerHostFn("__ifttt_timer_register", hostTimerRegister);
    v8_runtime.registerHostFn("__ifttt_timer_cancel", hostTimerCancel);
    v8_runtime.registerHostFn("__ifttt_key_register", hostKeyRegister);
    v8_runtime.registerHostFn("__ifttt_key_unregister", hostKeyUnregister);
    v8_runtime.registerHostFn("__ifttt_last_key", hostLastKey);
    v8_runtime.registerHostFn("__ifttt_state_get", hostStateGet);
    v8_runtime.registerHostFn("__ifttt_state_set", hostStateSet);
}
