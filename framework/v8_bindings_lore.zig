//! Thin V8 door for the editor's native Lore snapshot chain.
//!
//! Every operation accepts one JSON request string and returns one JSON response
//! string. The V8 layer does not interpret version-control policy or mesh bytes.
//! `snapshot.zig` owns those decisions; this file only obtains the exact resident
//! model document for the panic-snapshot call and translates the callback ABI.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const scene3d = @import("gpu/3d.zig");
const model_source = @import("gpu/model_source.zig");
const snapshot = @import("vcs/snapshot.zig");

const missing_request_json = "{\"ok\":false,\"error\":\"missing request JSON\"}";
const missing_resident_json = "{\"ok\":false,\"error\":\"no resident model document\"}";

fn argStringAlloc(info: v8.FunctionCallbackInfo, index: u32, allocator: std.mem.Allocator) ?[]u8 {
    if (index >= info.length()) return null;
    const isolate = info.getIsolate();
    const context = isolate.getCurrentContext();
    const value = info.getArg(index).toString(context) catch return null;
    const len = value.lenUtf8(isolate);
    const bytes = allocator.alloc(u8, len) catch return null;
    _ = value.writeUtf8(isolate, bytes);
    return bytes;
}

fn setReturnString(info: v8.FunctionCallbackInfo, value: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), value));
}

fn setError(info: v8.FunctionCallbackInfo, err: anyerror) void {
    var buf: [256]u8 = undefined;
    const payload = std.fmt.bufPrint(
        &buf,
        "{{\"ok\":false,\"error\":\"{s}\"}}",
        .{@errorName(err)},
    ) catch "{\"ok\":false,\"error\":\"Lore operation failed\"}";
    setReturnString(info, payload);
}

fn hostLoreSnapshot(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const host = v8_runtime.hostContext(info.getIsolate());
    const allocator = std.heap.c_allocator;
    const request_json = argStringAlloc(info, 0, allocator) orelse {
        setReturnString(info, missing_request_json);
        return;
    };
    defer allocator.free(request_json);

    var document = scene3d.modelRecoverySnapshot(allocator) orelse {
        setReturnString(info, missing_resident_json);
        return;
    };
    defer document.deinit(allocator);

    const response = snapshot.snapshotJson(
        host.io,
        allocator,
        &document,
        model_source.partRanges(),
        request_json,
    ) catch |err| {
        setError(info, err);
        return;
    };
    defer allocator.free(response);
    setReturnString(info, response);
}

fn hostLoreHistory(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    callRequestJson(info, snapshot.historyJson);
}

fn hostLorePreview(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    callRequestJson(info, snapshot.previewJson);
}

fn hostLoreRestore(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    callRequestJson(info, snapshot.restoreJson);
}

fn hostLorePin(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    callRequestJson(info, snapshot.pinJson);
}

fn hostLoreServerStatus(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    callOptionalRequestJson(info, snapshot.serverStatusJson);
}

fn callRequestJson(info: v8.FunctionCallbackInfo, operation: anytype) void {
    const allocator = std.heap.c_allocator;
    const request_json = argStringAlloc(info, 0, allocator) orelse {
        setReturnString(info, missing_request_json);
        return;
    };
    defer allocator.free(request_json);
    callOperation(info, operation, request_json);
}

fn callOptionalRequestJson(info: v8.FunctionCallbackInfo, operation: anytype) void {
    const allocator = std.heap.c_allocator;
    const owned_request = argStringAlloc(info, 0, allocator);
    defer if (owned_request) |request| allocator.free(request);
    callOperation(info, operation, owned_request orelse "{}");
}

fn callOperation(info: v8.FunctionCallbackInfo, operation: anytype, request_json: []const u8) void {
    const host = v8_runtime.hostContext(info.getIsolate());
    const allocator = std.heap.c_allocator;
    const response = operation(host.io, allocator, request_json) catch |err| {
        setError(info, err);
        return;
    };
    defer allocator.free(response);
    setReturnString(info, response);
}

pub fn registerLore(_: anytype) void {
    v8_runtime.registerHostFn("__lore_snapshot", hostLoreSnapshot);
    v8_runtime.registerHostFn("__lore_history", hostLoreHistory);
    v8_runtime.registerHostFn("__lore_preview", hostLorePreview);
    v8_runtime.registerHostFn("__lore_restore", hostLoreRestore);
    v8_runtime.registerHostFn("__lore_pin", hostLorePin);
    v8_runtime.registerHostFn("__lore_server_status", hostLoreServerStatus);
}
