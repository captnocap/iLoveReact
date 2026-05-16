//! V8 host bindings for inspector/layout introspection.

const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const canvas = @import("primitive/canvas.zig");
const svg_path = @import("gpu/svg/path.zig");

fn currentContext(info: v8.FunctionCallbackInfo) v8.Context {
    return info.getIsolate().getCurrentContext();
}

fn setValue(info: v8.FunctionCallbackInfo, value: anytype) void {
    info.getReturnValue().set(value);
}

fn setUndefined(info: v8.FunctionCallbackInfo) void {
    setValue(info, v8.initUndefined(info.getIsolate()).toValue());
}

fn setNumber(info: v8.FunctionCallbackInfo, value: anytype) void {
    const num: f64 = switch (@typeInfo(@TypeOf(value))) {
        .float => @floatCast(value),
        .int, .comptime_int => @floatFromInt(value),
        else => @compileError("setNumber only supports ints and floats"),
    };
    setValue(info, v8.Number.init(info.getIsolate(), num));
}

fn getActiveNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (canvas.getActiveNode()) |idx| {
        setNumber(info, @as(i64, idx));
    } else {
        setNumber(info, -1);
    }
}

fn getSelectedNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (canvas.getSelectedNode()) |idx| {
        setNumber(info, @as(i64, idx));
    } else {
        setNumber(info, -1);
    }
}

fn setFlowEnabled(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 1) {
        setUndefined(info);
        return;
    }
    const mode_raw = info.getArg(0).toI32(currentContext(info)) catch 2;
    svg_path.setFlowMode(@intCast(@max(0, @min(2, mode_raw))));
    setUndefined(info);
}

fn setNodeDim(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) {
        setUndefined(info);
        return;
    }
    const ctx = currentContext(info);
    const idx = info.getArg(0).toI32(ctx) catch 0;
    const opacity = info.getArg(1).toF64(ctx) catch 1.0;
    canvas.setNodeDim(@intCast(@max(0, idx)), @floatCast(opacity));
    setUndefined(info);
}

fn resetNodeDim(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    canvas.resetNodeDim();
    setUndefined(info);
}

fn setPathFlow(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (info.length() < 2) {
        setUndefined(info);
        return;
    }
    const ctx = currentContext(info);
    const idx = info.getArg(0).toI32(ctx) catch 0;
    const enabled = info.getArg(1).toI32(ctx) catch 1;
    canvas.setFlowOverride(@intCast(@max(0, idx)), enabled != 0);
    setUndefined(info);
}

fn resetPathFlow(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    canvas.resetFlowOverride();
    setUndefined(info);
}

pub fn registerInspector(_: anytype) void {
    v8_runtime.registerHostFn("getActiveNode", getActiveNode);
    v8_runtime.registerHostFn("getSelectedNode", getSelectedNode);
    v8_runtime.registerHostFn("setFlowEnabled", setFlowEnabled);
    v8_runtime.registerHostFn("setNodeDim", setNodeDim);
    v8_runtime.registerHostFn("resetNodeDim", resetNodeDim);
    v8_runtime.registerHostFn("setPathFlow", setPathFlow);
    v8_runtime.registerHostFn("resetPathFlow", resetPathFlow);
}

pub fn tickDrain() void {}
