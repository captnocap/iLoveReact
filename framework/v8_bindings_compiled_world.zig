//! V8 binding for the world_loader embedded primitive.
//!
//! JS calls only on mount/unmount/status. The frame loop is world_loader.zig
//! itself, mounted under a React WorldLoader host node.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const world_loader = @import("../world_loader.zig");
const world_window = @import("gpu/world_window.zig");

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

// ── external iso-orbit camera (LOADERVIEW req_1757) ─────────────────────────
// __compiled_world_set_orbit(nodeId, tx,ty,tz, yawDeg, pitchDeg, distance, fovDeg)
// drives the embedded loader's camera from the editor's IsoStage pose; _clear_orbit
// returns it to the player-trailing game camera.

fn argF32(info: v8.FunctionCallbackInfo, idx: u32, fallback: f32) f32 {
    return if (argToF64(info, idx)) |v| @floatCast(v) else fallback;
}

fn hostSetOrbit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "error:BadNodeId");
        return;
    };
    world_loader.setExternalOrbit(
        node_id,
        argF32(info, 1, 0),
        argF32(info, 2, 0),
        argF32(info, 3, 0),
        argF32(info, 4, 0),
        argF32(info, 5, 0),
        argF32(info, 6, 120),
        argF32(info, 7, 45),
    );
    setReturnString(info, "ok");
}

fn hostClearOrbit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    if (argToNodeId(info, 0)) |node_id| world_loader.clearExternalOrbit(node_id);
    setReturnString(info, "ok");
}

// ── the pop-out window (WORLDWIN-0611) ──────────────────────────────────────
// __compiled_world_window(gameFile, storeDir, width, height) opens the
// second OS window (or reloads its gamefile when already open — the Compile
// button's case); _close and _status do what they say. Same ingredient as
// the embedded loader (the __compiled_world_ grep prefix), so the door costs
// no new build flag.

fn hostWindowOpen(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const game_file = argToStringAlloc(info, 0) orelse {
        setReturnString(info, "error:MissingGameFile");
        return;
    };
    defer std.heap.c_allocator.free(game_file);
    const store_dir = argToStringAlloc(info, 1) orelse {
        setReturnString(info, "error:MissingStoreDir");
        return;
    };
    defer std.heap.c_allocator.free(store_dir);
    const width: u32 = if (argToF64(info, 2)) |w| @intFromFloat(@max(0.0, w)) else 1280;
    const height: u32 = if (argToF64(info, 3)) |h| @intFromFloat(@max(0.0, h)) else 800;

    world_window.open(game_file, store_dir, width, height) catch |e| {
        var buf: [96]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "error:{s}", .{@errorName(e)}) catch "error:open";
        setReturnString(info, msg);
        return;
    };
    const status = world_window.statusAlloc(std.heap.c_allocator) catch {
        setReturnString(info, "ok");
        return;
    };
    defer std.heap.c_allocator.free(status);
    setReturnString(info, status);
}

fn hostWindowClose(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    world_window.close();
    setReturnString(info, "ok");
}

fn hostWindowStatus(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const status = world_window.statusAlloc(std.heap.c_allocator) catch {
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
    v8_runtime.registerHostFn("__compiled_world_set_orbit", hostSetOrbit);
    v8_runtime.registerHostFn("__compiled_world_clear_orbit", hostClearOrbit);
    v8_runtime.registerHostFn("__compiled_world_window", hostWindowOpen);
    v8_runtime.registerHostFn("__compiled_world_window_close", hostWindowClose);
    v8_runtime.registerHostFn("__compiled_world_window_status", hostWindowStatus);
}
