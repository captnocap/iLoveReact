//! V8 bindings for the observability event bus.
//!
//!   __busEmit(type, source, payloadJson)              → eventId (number)
//!   __busEmitWithImportance(type, source, imp, payloadJson) → eventId
//!   __busEmitChild(type, source, parentId, payloadJson) → eventId
//!   __busRecent(maxCount, minImportance) → JSON array string
//!   __busSessionId() → string
//!
//! The cart-side shim (runtime/eventBus.ts) wraps these. Keep the host fns
//! tolerant: missing args, weird types, and pre-init bus all silently
//! degrade — observability infra must not be the thing that crashes the
//! runtime.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const event_bus = @import("diag/event_bus.zig");

const alloc = std.heap.c_allocator;

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

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toF64(info.getIsolate().getCurrentContext()) catch null;
}

fn argToU32(info: v8.FunctionCallbackInfo, idx: u32) ?u32 {
    const f = argToF64(info, idx) orelse return null;
    if (f < 0) return null;
    return @trunc(f);
}

fn setReturnNumber(info: v8.FunctionCallbackInfo, value: f64) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), value));
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), text));
}

fn hostBusEmit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const event_type = argToStringAlloc(info, 0) orelse return setReturnNumber(info, 0);
    defer alloc.free(event_type);
    const source = argToStringAlloc(info, 1) orelse return setReturnNumber(info, 0);
    defer alloc.free(source);
    const payload = argToStringAlloc(info, 2) orelse {
        const id = event_bus.emit(event_type, source, null, "{}");
        return setReturnNumber(info, @floatFromInt(id));
    };
    defer alloc.free(payload);
    const id = event_bus.emit(event_type, source, null, payload);
    setReturnNumber(info, @floatFromInt(id));
}

fn hostBusEmitWithImportance(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const event_type = argToStringAlloc(info, 0) orelse return setReturnNumber(info, 0);
    defer alloc.free(event_type);
    const source = argToStringAlloc(info, 1) orelse return setReturnNumber(info, 0);
    defer alloc.free(source);
    const imp_f = argToF64(info, 2) orelse return setReturnNumber(info, 0);
    const payload = argToStringAlloc(info, 3) orelse {
        const id = event_bus.emitWithImportance(event_type, source, @floatCast(imp_f), null, "{}");
        return setReturnNumber(info, @floatFromInt(id));
    };
    defer alloc.free(payload);
    const id = event_bus.emitWithImportance(event_type, source, @floatCast(imp_f), null, payload);
    setReturnNumber(info, @floatFromInt(id));
}

fn hostBusEmitChild(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const event_type = argToStringAlloc(info, 0) orelse return setReturnNumber(info, 0);
    defer alloc.free(event_type);
    const source = argToStringAlloc(info, 1) orelse return setReturnNumber(info, 0);
    defer alloc.free(source);
    const parent_f = argToF64(info, 2) orelse return setReturnNumber(info, 0);
    const parent_id: ?u64 = if (parent_f <= 0) null else @trunc(parent_f);
    const payload = argToStringAlloc(info, 3) orelse {
        const id = event_bus.emit(event_type, source, parent_id, "{}");
        return setReturnNumber(info, @floatFromInt(id));
    };
    defer alloc.free(payload);
    const id = event_bus.emit(event_type, source, parent_id, payload);
    setReturnNumber(info, @floatFromInt(id));
}

fn hostBusRecent(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const max_count: usize = argToU32(info, 0) orelse 200;
    const min_imp_f: f32 = blk: {
        if (argToF64(info, 1)) |f| break :blk @floatCast(f);
        break :blk 0.0;
    };
    const json = event_bus.recentJson(alloc, max_count, min_imp_f) catch {
        setReturnString(info, "[]");
        return;
    };
    defer alloc.free(json);
    setReturnString(info, json);
}

fn hostBusSessionId(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnString(info, event_bus.sessionId());
}

fn hostBusDbPath(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnString(info, event_bus.dbPath());
}

pub fn registerEventBus(_: anytype) void {
    v8_runtime.registerHostFn("__busEmit", hostBusEmit);
    v8_runtime.registerHostFn("__busEmitWithImportance", hostBusEmitWithImportance);
    v8_runtime.registerHostFn("__busEmitChild", hostBusEmitChild);
    v8_runtime.registerHostFn("__busRecent", hostBusRecent);
    v8_runtime.registerHostFn("__busSessionId", hostBusSessionId);
    v8_runtime.registerHostFn("__busDbPath", hostBusDbPath);
}
