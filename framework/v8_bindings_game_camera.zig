//! Game camera host bindings — thin V8 registrar over framework/game/camera.zig.
//!
//! V23 surface: JS is transport/parameters only; host owns per-frame solve,
//! smoothing, interpolation, and writes the bound Scene3D.Camera node fields.
//!
//!   __game_camera_bind_node(nodeId)
//!   __game_camera_bind_first() -> bound node id, 0 when none exists
//!   __game_camera_disable()
//!   __game_camera_set_mode("walk"|"orbit"|"aim")
//!   __game_camera_set_orbit(targetX,targetY,targetZ,yaw,pitch,distance,fov,zoom?)
//!   __game_camera_set_aim(targetX,targetY,targetZ,yaw,pitch,crouch?,
//!       shoulderShift?,pivotHeight?,crouchDrop?,distance?,lookAhead?,fov?)
//!   __game_camera_set_input_deltas(yawDelta,pitchDelta)
//!   __game_camera_set_smoothing(perSecond)
//!   __game_camera_active_node() -> node id, 0 when disabled
//!
//! Gated ingredient (V18/V23): registered only when the metafile gate flips
//! -Dhas-game-camera. A cart that never opts into host camera pays zero host fns.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const game_camera = @import("game/camera.zig");
const host_tree = @import("host_tree.zig");

fn argToF64(info: v8.FunctionCallbackInfo, idx: u32) ?f64 {
    if (idx >= info.length()) return null;
    const ctx = info.getIsolate().getCurrentContext();
    return info.getArg(idx).toF64(ctx) catch null;
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

fn setReturnNull(info: v8.FunctionCallbackInfo) void {
    info.getReturnValue().set(info.getIsolate().initNull());
}

fn setReturnF64(info: v8.FunctionCallbackInfo, value: f64) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), value));
}

fn modeFromString(s: []const u8) ?game_camera.Mode {
    if (std.mem.eql(u8, s, "walk") or std.mem.eql(u8, s, "orbit")) return .orbit;
    if (std.mem.eql(u8, s, "aim") or std.mem.eql(u8, s, "ads")) return .aim;
    return null;
}

fn hostBindNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_f = argToF64(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    game_camera.bindNode(@intFromFloat(@max(0.0, node_f)));
    setReturnNull(info);
}

fn hostDisable(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    game_camera.disable();
    setReturnNull(info);
}

fn hostBindFirst(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var it = host_tree.nodesPtr().iterator();
    while (it.next()) |entry| {
        const node = entry.value_ptr.*;
        if (node.scene3d_camera) {
            game_camera.bindNode(entry.key_ptr.*);
            setReturnF64(info, @floatFromInt(entry.key_ptr.*));
            return;
        }
    }
    setReturnF64(info, 0);
}

fn hostSetMode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const raw = argToStringAlloc(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    defer std.heap.c_allocator.free(raw);
    const mode = modeFromString(raw) orelse {
        setReturnNull(info);
        return;
    };
    game_camera.setMode(mode);
    setReturnNull(info);
}

fn hostSetOrbit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    game_camera.setOrbit(.{
        .target = .{
            .x = @floatCast(argToF64(info, 0) orelse 0),
            .y = @floatCast(argToF64(info, 1) orelse 0),
            .z = @floatCast(argToF64(info, 2) orelse 0),
        },
        .yaw = @floatCast(argToF64(info, 3) orelse 45),
        .pitch = @floatCast(argToF64(info, 4) orelse 35),
        .dist = @floatCast(argToF64(info, 5) orelse 15),
        .fov = @floatCast(argToF64(info, 6) orelse 55),
        .zoom = @floatCast(argToF64(info, 7) orelse 1),
    });
    setReturnNull(info);
}

fn hostSetAim(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    game_camera.setAim(.{
        .target = .{
            .x = @floatCast(argToF64(info, 0) orelse 0),
            .y = @floatCast(argToF64(info, 1) orelse 0),
            .z = @floatCast(argToF64(info, 2) orelse 0),
        },
        .yaw = @floatCast(argToF64(info, 3) orelse 0),
        .pitch = @floatCast(argToF64(info, 4) orelse 0),
        .crouch = @floatCast(argToF64(info, 5) orelse 0),
        .shoulder_shift = @floatCast(argToF64(info, 6) orelse 0.62),
        .pivot_height = @floatCast(argToF64(info, 7) orelse 1.62),
        .crouch_drop = @floatCast(argToF64(info, 8) orelse 0.42),
        .distance = @floatCast(argToF64(info, 9) orelse 2.4),
        .look_ahead = @floatCast(argToF64(info, 10) orelse 12),
        .fov = @floatCast(argToF64(info, 11) orelse 47),
    });
    setReturnNull(info);
}

fn hostSetInputDeltas(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    game_camera.applyInputDeltas(
        @floatCast(argToF64(info, 0) orelse 0),
        @floatCast(argToF64(info, 1) orelse 0),
    );
    setReturnNull(info);
}

fn hostSetSmoothing(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    game_camera.setSmoothing(@floatCast(argToF64(info, 0) orelse game_camera.DEFAULT_SMOOTHING_PER_SECOND));
    setReturnNull(info);
}

fn hostActiveNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    setReturnF64(info, @floatFromInt(game_camera.activeNodeId()));
}

pub fn registerGameCamera(_: anytype) void {
    v8_runtime.registerHostFn("__game_camera_bind_node", hostBindNode);
    v8_runtime.registerHostFn("__game_camera_bind_first", hostBindFirst);
    v8_runtime.registerHostFn("__game_camera_disable", hostDisable);
    v8_runtime.registerHostFn("__game_camera_set_mode", hostSetMode);
    v8_runtime.registerHostFn("__game_camera_set_orbit", hostSetOrbit);
    v8_runtime.registerHostFn("__game_camera_set_aim", hostSetAim);
    v8_runtime.registerHostFn("__game_camera_set_input_deltas", hostSetInputDeltas);
    v8_runtime.registerHostFn("__game_camera_set_smoothing", hostSetSmoothing);
    v8_runtime.registerHostFn("__game_camera_active_node", hostActiveNode);
}
