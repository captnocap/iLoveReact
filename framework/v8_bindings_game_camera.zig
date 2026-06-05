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
//!   __game_camera_disable_node(nodeId)
//!   __game_camera_set_mode_node(nodeId,"walk"|"orbit"|"aim")
//!   __game_camera_set_orbit_node(nodeId,targetX,targetY,targetZ,yaw,pitch,distance,fov,zoom?)
//!   __game_camera_set_aim_node(nodeId,targetX,targetY,targetZ,yaw,pitch,crouch?,
//!       shoulderShift?,pivotHeight?,crouchDrop?,distance?,lookAhead?,fov?)
//!   __game_camera_set_input_deltas_node(nodeId,yawDelta,pitchDelta)
//!   __game_camera_set_smoothing_node(nodeId,perSecond)
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

fn argToNodeId(info: v8.FunctionCallbackInfo, idx: u32) ?u32 {
    const node_f = argToF64(info, idx) orelse return null;
    return @intFromFloat(@max(0.0, node_f));
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
    const node_id = argToNodeId(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    game_camera.bindNode(node_id);
    game_camera.probeHostBind("__game_camera_bind_node", node_id, true);
    setReturnNull(info);
}

fn hostDisable(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    game_camera.disable();
    setReturnNull(info);
}

fn hostDisableNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    game_camera.disableNode(node_id);
    setReturnNull(info);
}

fn hostBindFirst(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    var it = host_tree.nodesPtr().iterator();
    while (it.next()) |entry| {
        const node = entry.value_ptr.*;
        if (node.scene3d_camera) {
            std.debug.print(
                "[probe-camera-host] __game_camera_bind_first candidate node={d} pos({d:.2},{d:.2},{d:.2}) look({d:.2},{d:.2},{d:.2}) fov={d:.2}\n",
                .{
                    entry.key_ptr.*,
                    node.scene3d_pos_x,
                    node.scene3d_pos_y,
                    node.scene3d_pos_z,
                    node.scene3d_look_x,
                    node.scene3d_look_y,
                    node.scene3d_look_z,
                    node.scene3d_fov,
                },
            );
            game_camera.bindNode(entry.key_ptr.*);
            game_camera.probeHostBind("__game_camera_bind_first", entry.key_ptr.*, true);
            setReturnF64(info, @floatFromInt(entry.key_ptr.*));
            return;
        }
    }
    game_camera.probeHostBind("__game_camera_bind_first", 0, false);
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
    game_camera.probeHostMode("__game_camera_set_mode", mode, info.length(), 0);
    game_camera.setMode(mode);
    setReturnNull(info);
}

fn hostSetModeNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    const raw = argToStringAlloc(info, 1) orelse {
        setReturnNull(info);
        return;
    };
    defer std.heap.c_allocator.free(raw);
    const mode = modeFromString(raw) orelse {
        setReturnNull(info);
        return;
    };
    game_camera.probeHostMode("__game_camera_set_mode_node", mode, info.length(), node_id);
    game_camera.setModeForNode(node_id, mode);
    setReturnNull(info);
}

fn orbitParams(info: v8.FunctionCallbackInfo, offset: u32) game_camera.OrbitParams {
    return .{
        .target = .{
            .x = @floatCast(argToF64(info, offset + 0) orelse 0),
            .y = @floatCast(argToF64(info, offset + 1) orelse 0),
            .z = @floatCast(argToF64(info, offset + 2) orelse 0),
        },
        .yaw = @floatCast(argToF64(info, offset + 3) orelse 45),
        .pitch = @floatCast(argToF64(info, offset + 4) orelse 35),
        .dist = @floatCast(argToF64(info, offset + 5) orelse 15),
        .fov = @floatCast(argToF64(info, offset + 6) orelse 55),
        .zoom = @floatCast(argToF64(info, offset + 7) orelse 1),
    };
}

fn hostSetOrbit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const params = orbitParams(info, 0);
    game_camera.probeHostOrbit("__game_camera_set_orbit", params, info.length(), 0);
    game_camera.setOrbit(params);
    setReturnNull(info);
}

fn hostSetOrbitNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    const params = orbitParams(info, 1);
    game_camera.probeHostOrbit("__game_camera_set_orbit_node", params, info.length(), node_id);
    game_camera.setOrbitForNode(node_id, params);
    setReturnNull(info);
}

fn aimParams(info: v8.FunctionCallbackInfo, offset: u32) game_camera.AimParams {
    return .{
        .target = .{
            .x = @floatCast(argToF64(info, offset + 0) orelse 0),
            .y = @floatCast(argToF64(info, offset + 1) orelse 0),
            .z = @floatCast(argToF64(info, offset + 2) orelse 0),
        },
        .yaw = @floatCast(argToF64(info, offset + 3) orelse 0),
        .pitch = @floatCast(argToF64(info, offset + 4) orelse 0),
        .crouch = @floatCast(argToF64(info, offset + 5) orelse 0),
        .shoulder_shift = @floatCast(argToF64(info, offset + 6) orelse 0.62),
        .pivot_height = @floatCast(argToF64(info, offset + 7) orelse 1.62),
        .crouch_drop = @floatCast(argToF64(info, offset + 8) orelse 0.42),
        .distance = @floatCast(argToF64(info, offset + 9) orelse 2.4),
        .look_ahead = @floatCast(argToF64(info, offset + 10) orelse 12),
        .fov = @floatCast(argToF64(info, offset + 11) orelse 47),
    };
}

fn hostSetAim(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const params = aimParams(info, 0);
    game_camera.probeHostAim("__game_camera_set_aim", params, info.length(), 0);
    game_camera.setAim(params);
    setReturnNull(info);
}

fn hostSetAimNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    const params = aimParams(info, 1);
    game_camera.probeHostAim("__game_camera_set_aim_node", params, info.length(), node_id);
    game_camera.setAimForNode(node_id, params);
    setReturnNull(info);
}

fn hostSetInputDeltas(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const yaw_delta: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const pitch_delta: f32 = @floatCast(argToF64(info, 1) orelse 0);
    game_camera.probeHostDeltas("__game_camera_set_input_deltas", yaw_delta, pitch_delta, info.length(), 0);
    game_camera.applyInputDeltas(yaw_delta, pitch_delta);
    setReturnNull(info);
}

fn hostSetInputDeltasNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    const yaw_delta: f32 = @floatCast(argToF64(info, 1) orelse 0);
    const pitch_delta: f32 = @floatCast(argToF64(info, 2) orelse 0);
    game_camera.probeHostDeltas("__game_camera_set_input_deltas_node", yaw_delta, pitch_delta, info.length(), node_id);
    game_camera.applyInputDeltasForNode(node_id, yaw_delta, pitch_delta);
    setReturnNull(info);
}

fn hostSetSmoothing(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    game_camera.setSmoothing(@floatCast(argToF64(info, 0) orelse game_camera.DEFAULT_SMOOTHING_PER_SECOND));
    setReturnNull(info);
}

fn hostSetSmoothingNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    game_camera.setSmoothingForNode(node_id, @floatCast(argToF64(info, 1) orelse game_camera.DEFAULT_SMOOTHING_PER_SECOND));
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
    v8_runtime.registerHostFn("__game_camera_disable_node", hostDisableNode);
    v8_runtime.registerHostFn("__game_camera_set_mode", hostSetMode);
    v8_runtime.registerHostFn("__game_camera_set_mode_node", hostSetModeNode);
    v8_runtime.registerHostFn("__game_camera_set_orbit", hostSetOrbit);
    v8_runtime.registerHostFn("__game_camera_set_orbit_node", hostSetOrbitNode);
    v8_runtime.registerHostFn("__game_camera_set_aim", hostSetAim);
    v8_runtime.registerHostFn("__game_camera_set_aim_node", hostSetAimNode);
    v8_runtime.registerHostFn("__game_camera_set_input_deltas", hostSetInputDeltas);
    v8_runtime.registerHostFn("__game_camera_set_input_deltas_node", hostSetInputDeltasNode);
    v8_runtime.registerHostFn("__game_camera_set_smoothing", hostSetSmoothing);
    v8_runtime.registerHostFn("__game_camera_set_smoothing_node", hostSetSmoothingNode);
    v8_runtime.registerHostFn("__game_camera_active_node", hostActiveNode);
}
