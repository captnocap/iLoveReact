//! Game camera host bindings — thin V8 registrar over framework/game/camera.zig.
//!
//! V23 surface: JS is transport/parameters only; host owns per-frame solve,
//! smoothing, interpolation, and writes the bound Scene3D.Camera node fields.
//!
//!   __game_camera_bind_node(nodeId)
//!   __game_camera_bind_first() -> bound node id, 0 when none exists
//!   __game_camera_disable()
//!   __game_camera_set_mode("walk"|"orbit"|"aim"|"freefly")
//!   __game_camera_set_orbit(targetX,targetY,targetZ,yaw,pitch,distance,fov,zoom?)
//!   __game_camera_set_aim(targetX,targetY,targetZ,yaw,pitch,crouch?,
//!       shoulderShift?,pivotHeight?,crouchDrop?,distance?,lookAhead?,fov?)
//!   __game_camera_set_freefly(posX,posY,posZ,yaw,pitch,fov)
//!   __game_camera_set_move_axes(forward,strafe,lift,speed)
//!   __game_camera_set_input_deltas(yawDelta,pitchDelta)
//!   __game_camera_set_smoothing(perSecond)
//!   __game_camera_active_node() -> node id, 0 when disabled
//!   __game_camera_disable_node(nodeId)
//!   __game_camera_set_mode_node(nodeId,"walk"|"orbit"|"aim"|"freefly")
//!   __game_camera_set_orbit_node(nodeId,targetX,targetY,targetZ,yaw,pitch,distance,fov,zoom?)
//!   __game_camera_set_aim_node(nodeId,targetX,targetY,targetZ,yaw,pitch,crouch?,
//!       shoulderShift?,pivotHeight?,crouchDrop?,distance?,lookAhead?,fov?)
//!   __game_camera_set_freefly_node(nodeId,posX,posY,posZ,yaw,pitch,fov)
//!   __game_camera_set_move_axes_node(nodeId,forward,strafe,lift,speed)
//!   __game_camera_get_freefly_node(nodeId) -> JSON snapshot
//!   __game_camera_set_distance_constraint_node(nodeId,targetDistance,minDistance,smoothingPerSecond)
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
    return @trunc(@max(0.0, node_f));
}

fn setReturnNull(info: v8.FunctionCallbackInfo) void {
    info.getReturnValue().set(info.getIsolate().initNull());
}

fn setReturnF64(info: v8.FunctionCallbackInfo, value: f64) void {
    info.getReturnValue().set(v8.Number.init(info.getIsolate(), value));
}

fn setReturnString(info: v8.FunctionCallbackInfo, value: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), value));
}

fn setObjectNumber(ctx: v8.Context, obj: v8.Object, key: []const u8, value: anytype) void {
    const iso = ctx.getIsolate();
    const k = iso.initStringUtf8(key);
    const n_value: f64 = switch (@typeInfo(@TypeOf(value))) {
        .int, .comptime_int => @floatFromInt(value),
        .float, .comptime_float => @floatCast(value),
        else => 0,
    };
    const n = iso.initNumber(n_value);
    _ = obj.setValue(ctx, k.toValue(), n.toValue());
}

fn setObjectString(ctx: v8.Context, obj: v8.Object, key: []const u8, value: []const u8) void {
    const iso = ctx.getIsolate();
    const k = iso.initStringUtf8(key);
    const s = iso.initStringUtf8(value);
    _ = obj.setValue(ctx, k.toValue(), s.toValue());
}

fn modeName(mode: game_camera.Mode) []const u8 {
    return switch (mode) {
        .orbit => "orbit",
        .aim => "aim",
        .freefly => "freefly",
    };
}

fn modeFromString(s: []const u8) ?game_camera.Mode {
    if (std.mem.eql(u8, s, "walk") or std.mem.eql(u8, s, "orbit")) return .orbit;
    if (std.mem.eql(u8, s, "aim") or std.mem.eql(u8, s, "ads")) return .aim;
    if (std.mem.eql(u8, s, "freefly") or std.mem.eql(u8, s, "freeFly")) return .freefly;
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
            game_camera.bindNode(entry.key_ptr.*);
            game_camera.probeHostBind("__game_camera_bind_first", entry.key_ptr.*, true);
            setReturnF64(info, entry.key_ptr.*);
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

fn freeFlyParams(info: v8.FunctionCallbackInfo, offset: u32) game_camera.FreeFlyParams {
    return .{
        .position = .{
            .x = @floatCast(argToF64(info, offset + 0) orelse 0),
            .y = @floatCast(argToF64(info, offset + 1) orelse 5),
            .z = @floatCast(argToF64(info, offset + 2) orelse 14),
        },
        .yaw = @floatCast(argToF64(info, offset + 3) orelse 180),
        .pitch = @floatCast(argToF64(info, offset + 4) orelse -12),
        .fov = @floatCast(argToF64(info, offset + 5) orelse 60),
    };
}

fn moveAxes(info: v8.FunctionCallbackInfo, offset: u32) game_camera.MoveAxes {
    return .{
        .forward = @floatCast(argToF64(info, offset + 0) orelse 0),
        .strafe = @floatCast(argToF64(info, offset + 1) orelse 0),
        .lift = @floatCast(argToF64(info, offset + 2) orelse 0),
        .speed = @floatCast(argToF64(info, offset + 3) orelse 0),
    };
}

fn hostSetFreeFly(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    game_camera.setFreeFly(freeFlyParams(info, 0));
    setReturnNull(info);
}

fn hostSetFreeFlyNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    game_camera.setFreeFlyForNode(node_id, freeFlyParams(info, 1));
    setReturnNull(info);
}

fn hostSetMoveAxes(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    game_camera.setMoveAxes(moveAxes(info, 0));
    setReturnNull(info);
}

fn hostSetMoveAxesNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    game_camera.setMoveAxesForNode(node_id, moveAxes(info, 1));
    setReturnNull(info);
}

fn hostSetDistanceConstraint(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const target_distance: f32 = @floatCast(argToF64(info, 0) orelse 0);
    const min_distance: f32 = @floatCast(argToF64(info, 1) orelse 1);
    const smoothing: f32 = @floatCast(argToF64(info, 2) orelse 24);
    game_camera.setDistanceConstraint(target_distance, min_distance, smoothing);
    setReturnNull(info);
}

fn hostSetDistanceConstraintNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnNull(info);
        return;
    };
    const target_distance: f32 = @floatCast(argToF64(info, 1) orelse 0);
    const min_distance: f32 = @floatCast(argToF64(info, 2) orelse 1);
    const smoothing: f32 = @floatCast(argToF64(info, 3) orelse 24);
    game_camera.setDistanceConstraintForNode(node_id, target_distance, min_distance, smoothing);
    setReturnNull(info);
}

fn hostGetFreeFlyNode(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const node_id = argToNodeId(info, 0) orelse {
        setReturnString(info, "");
        return;
    };
    const params = game_camera.freeFlyForNode(node_id) orelse {
        setReturnString(info, "");
        return;
    };
    var buf: [192]u8 = undefined;
    const json = std.fmt.bufPrint(
        &buf,
        "{{\"pos\":[{d:.6},{d:.6},{d:.6}],\"yaw\":{d:.6},\"pitch\":{d:.6},\"fov\":{d:.6}}}",
        .{ params.position.x, params.position.y, params.position.z, params.yaw, params.pitch, params.fov },
    ) catch "";
    setReturnString(info, json);
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
    setReturnF64(info, game_camera.activeNodeId());
}

fn hostProbeSnapshot(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const snap = game_camera.probeSnapshot();
    if (!snap.has_sample) {
        setReturnNull(info);
        return;
    }
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const obj = iso.initObject();
    setObjectNumber(ctx, obj, "node_id", snap.node_id);
    setObjectNumber(ctx, obj, "active_node_id", snap.active_node_id);
    setObjectNumber(ctx, obj, "frames", snap.frames);
    setObjectNumber(ctx, obj, "avg_dt_ms", snap.avg_dt_ms);
    setObjectNumber(ctx, obj, "last_dt_ms", snap.last_dt_ms);
    setObjectNumber(ctx, obj, "params", snap.params);
    setObjectNumber(ctx, obj, "modes", snap.modes);
    setObjectNumber(ctx, obj, "deltas", snap.deltas);
    setObjectNumber(ctx, obj, "last_param_age_ms", snap.last_param_age_ms);
    setObjectNumber(ctx, obj, "max_solved_step", snap.max_solved_step);
    setObjectNumber(ctx, obj, "max_pos_lag", snap.max_pos_lag);
    setObjectNumber(ctx, obj, "max_target_lag", snap.max_target_lag);
    setObjectString(ctx, obj, "mode", modeName(snap.mode));
    setObjectNumber(ctx, obj, "desired_pos_x", snap.desired.pos.x);
    setObjectNumber(ctx, obj, "desired_pos_y", snap.desired.pos.y);
    setObjectNumber(ctx, obj, "desired_pos_z", snap.desired.pos.z);
    setObjectNumber(ctx, obj, "desired_target_x", snap.desired.target.x);
    setObjectNumber(ctx, obj, "desired_target_y", snap.desired.target.y);
    setObjectNumber(ctx, obj, "desired_target_z", snap.desired.target.z);
    setObjectNumber(ctx, obj, "desired_fov", snap.desired.fov);
    setObjectNumber(ctx, obj, "solved_pos_x", snap.solved.pos.x);
    setObjectNumber(ctx, obj, "solved_pos_y", snap.solved.pos.y);
    setObjectNumber(ctx, obj, "solved_pos_z", snap.solved.pos.z);
    setObjectNumber(ctx, obj, "solved_target_x", snap.solved.target.x);
    setObjectNumber(ctx, obj, "solved_target_y", snap.solved.target.y);
    setObjectNumber(ctx, obj, "solved_target_z", snap.solved.target.z);
    setObjectNumber(ctx, obj, "solved_fov", snap.solved.fov);
    setObjectNumber(ctx, obj, "slot_target_x", snap.slot_orbit.target.x);
    setObjectNumber(ctx, obj, "slot_target_y", snap.slot_orbit.target.y);
    setObjectNumber(ctx, obj, "slot_target_z", snap.slot_orbit.target.z);
    setObjectNumber(ctx, obj, "slot_yaw", snap.slot_orbit.yaw);
    setObjectNumber(ctx, obj, "slot_pitch", snap.slot_orbit.pitch);
    setObjectNumber(ctx, obj, "slot_dist", snap.slot_orbit.dist);
    setObjectNumber(ctx, obj, "slot_fov", snap.slot_orbit.fov);
    setObjectNumber(ctx, obj, "freefly_pos_x", snap.slot_freefly.position.x);
    setObjectNumber(ctx, obj, "freefly_pos_y", snap.slot_freefly.position.y);
    setObjectNumber(ctx, obj, "freefly_pos_z", snap.slot_freefly.position.z);
    setObjectNumber(ctx, obj, "freefly_yaw", snap.slot_freefly.yaw);
    setObjectNumber(ctx, obj, "freefly_pitch", snap.slot_freefly.pitch);
    setObjectNumber(ctx, obj, "freefly_fov", snap.slot_freefly.fov);
    setObjectNumber(ctx, obj, "move_forward", snap.move_axes.forward);
    setObjectNumber(ctx, obj, "move_strafe", snap.move_axes.strafe);
    setObjectNumber(ctx, obj, "move_lift", snap.move_axes.lift);
    setObjectNumber(ctx, obj, "move_speed", snap.move_axes.speed);
    info.getReturnValue().set(obj.toValue());
}

fn hostCameraRay(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    const ray = game_camera.activeCameraRay();
    if (!ray.has) {
        setReturnNull(info);
        return;
    }
    const iso = info.getIsolate();
    const ctx = iso.getCurrentContext();
    const obj = iso.initObject();
    setObjectNumber(ctx, obj, "ox", ray.pos.x);
    setObjectNumber(ctx, obj, "oy", ray.pos.y);
    setObjectNumber(ctx, obj, "oz", ray.pos.z);
    setObjectNumber(ctx, obj, "dx", ray.dir.x);
    setObjectNumber(ctx, obj, "dy", ray.dir.y);
    setObjectNumber(ctx, obj, "dz", ray.dir.z);
    info.getReturnValue().set(obj.toValue());
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
    v8_runtime.registerHostFn("__game_camera_set_freefly", hostSetFreeFly);
    v8_runtime.registerHostFn("__game_camera_set_freefly_node", hostSetFreeFlyNode);
    v8_runtime.registerHostFn("__game_camera_set_move_axes", hostSetMoveAxes);
    v8_runtime.registerHostFn("__game_camera_set_move_axes_node", hostSetMoveAxesNode);
    v8_runtime.registerHostFn("__game_camera_set_distance_constraint", hostSetDistanceConstraint);
    v8_runtime.registerHostFn("__game_camera_set_distance_constraint_node", hostSetDistanceConstraintNode);
    v8_runtime.registerHostFn("__game_camera_get_freefly_node", hostGetFreeFlyNode);
    v8_runtime.registerHostFn("__game_camera_set_input_deltas", hostSetInputDeltas);
    v8_runtime.registerHostFn("__game_camera_set_input_deltas_node", hostSetInputDeltasNode);
    v8_runtime.registerHostFn("__game_camera_set_smoothing", hostSetSmoothing);
    v8_runtime.registerHostFn("__game_camera_set_smoothing_node", hostSetSmoothingNode);
    v8_runtime.registerHostFn("__game_camera_active_node", hostActiveNode);
    v8_runtime.registerHostFn("__game_camera_probe", hostProbeSnapshot);
    v8_runtime.registerHostFn("__game_camera_ray", hostCameraRay);
}
