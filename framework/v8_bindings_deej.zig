//! V8 host bindings for framework/deej.zig (serial fader boards).

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const deej = @import("deej.zig");

fn infoCtx(info: v8.FunctionCallbackInfo) v8.Context {
    return info.getIsolate().getCurrentContext();
}

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = infoCtx(info);
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = std.heap.c_allocator.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    return info.getArg(idx).toF64(infoCtx(info)) catch return null;
}

fn setReturnString(info: v8.FunctionCallbackInfo, text: []const u8) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.String.initUtf8(iso, text));
}

fn setReturnNumber(info: v8.FunctionCallbackInfo, value: f64) void {
    const iso = info.getIsolate();
    info.getReturnValue().set(v8.Number.init(iso, value));
}

// ── deej host functions (framework/deej.zig) ───────────────

fn hostDeejStart(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const port = argToStringAlloc(info, 0);
    defer if (port) |p| std.heap.c_allocator.free(p);
    const baud: u32 = if (argToF64(info, 1)) |b| @intFromFloat(@max(0, b)) else 0;
    const port_slice: ?[]const u8 = if (port) |p| (if (p.len > 0) p else null) else null;
    setReturnNumber(info, if (deej.start(host.io, host.environ, host.gpa, port_slice, baud)) 1 else 0);
}

fn hostDeejStop(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    _ = v8.FunctionCallbackInfo.initFromV8(info_c);
    deej.stop();
}

fn hostDeejIsAvailable(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnNumber(info, if (deej.isStarted()) 1 else 0);
}

fn hostDeejPoll(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    setReturnNumber(info, @floatFromInt(deej.poll(host.io, host.environ)));
}

fn hostDeejStateJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var buf: [2048]u8 = undefined;
    setReturnString(info, deej.stateJson(&buf));
}

fn hostDeejNextEventJson(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ev = deej.nextEvent() orelse {
        setReturnString(info, "");
        return;
    };
    var buf: [128]u8 = undefined;
    setReturnString(info, deej.eventJson(ev, &buf));
}

pub fn registerDeej(_: anytype) void {
    v8_runtime.registerHostFn("__deej_start", hostDeejStart);
    v8_runtime.registerHostFn("__deej_stop", hostDeejStop);
    v8_runtime.registerHostFn("__deej_is_available", hostDeejIsAvailable);
    v8_runtime.registerHostFn("__deej_poll", hostDeejPoll);
    v8_runtime.registerHostFn("__deej_state_json", hostDeejStateJson);
    v8_runtime.registerHostFn("__deej_next_event_json", hostDeejNextEventJson);
}
