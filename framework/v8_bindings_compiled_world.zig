//! V8 binding for the world_loader embedded primitive.
//!
//! JS calls only on mount/unmount/status. The frame loop is world_loader.zig
//! itself, mounted under a React WorldLoader host node.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const world_loader = @import("../world_loader.zig");

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return info.getArg(idx).toF64(ctx) catch null;
}

fn argToNodeId(info: v8.FunctionCallbackInfo, idx: u32) ?u32 {
    const node_f = argToF64(info, idx) orelse return null;
    return @intFromFloat(@max(0.0, node_f));
}

fn argToStringAlloc(info: v8.FunctionCallbackInfo, idx: u32) ?[]u8 {
    if (idx >= info.length()) return null;
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const s = info.getArg(idx).toString(ctx) catch return null;
    const n = s.lenUtf8(iso);
    const buf = std.heap.c_allocator.alloc(u8, n) catch return null;
    _ = s.writeUtf8(iso, buf);
    return buf;
}

fn setReturnString(info: v8.FunctionCallbackInfo, value: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), value));
}

fn hostMount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const game_file = argToStringAlloc(info, 1) orelse {
        setReturnString(info, "error:MissingGameFile");
        return;
    };
    defer std.heap.c_allocator.free(game_file);
    const store_dir = argToStringAlloc(info, 2) orelse {
        setReturnString(info, "error:MissingStoreDir");
        return;
    };
    defer std.heap.c_allocator.free(store_dir);

    world_loader.mount(std.heap.c_allocator, node_id, game_file, store_dir) catch |e| {
        var buf: [96]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "error:{s}", .{@errorName(e)}) catch "error:mount";
        setReturnString(info, msg);
        return;
    };

    const status = world_loader.statusAlloc(std.heap.c_allocator, node_id) catch {
        setReturnString(info, "ok");
        return;
    };
    defer std.heap.c_allocator.free(status);
    setReturnString(info, status);
}

fn hostUnmount(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (argToNodeId(info, 0)) |node_id| world_loader.unmount(node_id);
    setReturnString(info, "ok");
}

fn hostStatus(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    const status = world_loader.statusAlloc(std.heap.c_allocator, node_id) catch {
        setReturnString(info, "error:status");
        return;
    };
    defer std.heap.c_allocator.free(status);
    setReturnString(info, status);
}

pub fn registerCompiledWorld(_: anytype) void {
    v8_runtime.registerHostFn("__compiled_world_mount", hostMount);
    v8_runtime.registerHostFn("__compiled_world_unmount", hostUnmount);
    v8_runtime.registerHostFn("__compiled_world_status", hostStatus);
}
