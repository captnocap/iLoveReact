//! V8 host bindings for window management.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const engine = @import("engine.zig");
const windows = @import("primitive/windows.zig");

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

fn setValue(info: v8.FunctionCallbackInfo, value: anytype) void {
    info.getReturnValue().set(value);
}

fn setUndefined(info: v8.FunctionCallbackInfo) void {
    setValue(info, v8.initUndefined(info.getIsolate()).toValue());
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

fn windowClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    engine.windowClose();
    setUndefined(info);
}

fn windowMinimize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    engine.windowMinimize();
    setUndefined(info);
}

fn windowMaximize(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    engine.windowMaximize();
    setUndefined(info);
}

fn windowIsMaximized(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setBool(info, engine.windowIsMaximized());
}

fn openWindow(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const alloc = std.heap.page_allocator;
    const title_buf = argStringAlloc(alloc, info, 0) orelse {
        setUndefined(info);
        return;
    };
    defer alloc.free(title_buf);
    if (info.length() < 3) {
        setUndefined(info);
        return;
    }

    const ctx = currentContext(info);
    var w: i32 = 400;
    var h: i32 = 400;
    w = info.getArg(1).toI32(ctx) catch w;
    h = info.getArg(2).toI32(ctx) catch h;

    const width: c_int = @intCast(w);
    const height: c_int = @intCast(h);
    var title_buf_z: [256:0]u8 = undefined;
    const copy_len = @min(title_buf.len, 255);
    @memcpy(title_buf_z[0..copy_len], title_buf[0..copy_len]);
    title_buf_z[copy_len] = 0;
    _ = windows.open(host.io, host.environ, .{
        .title = &title_buf_z,
        .width = width,
        .height = height,
        .kind = .in_process,
    });
    setUndefined(info);
}

pub fn registerWindow(_: anytype) void {
    v8_runtime.registerHostFn("__window_close", windowClose);
    v8_runtime.registerHostFn("__windowClose", windowClose);
    v8_runtime.registerHostFn("__window_minimize", windowMinimize);
    v8_runtime.registerHostFn("__windowMinimize", windowMinimize);
    v8_runtime.registerHostFn("__window_maximize", windowMaximize);
    v8_runtime.registerHostFn("__windowMaximize", windowMaximize);
    v8_runtime.registerHostFn("__window_is_maximized", windowIsMaximized);
    v8_runtime.registerHostFn("__openWindow", openWindow);
}

pub fn tickDrain() void {}
