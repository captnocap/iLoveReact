//! Game/world call boundary: static in release, dispatch-based in modular dev.

const std = @import("std");
const wgpu = @import("wgpu");
const build_options = @import("build_options");
const abi = @import("dev_module_abi");
const Node = @import("../layout.zig").Node;
const scene3d_runtime = @import("scene3d_runtime.zig");
const rig_pose = @import("../skeleton/rig_pose.zig");
pub const pose_stream = @import("../skeleton/pose_stream.zig");

const modular_core = build_options.dev_native_modules and !build_options.dev_game_module;
const world = if (!modular_core) @import("../world_loader.zig") else struct {};
const camera = if (!modular_core) @import("../game/camera.zig") else struct {};

var active_api: ?*const abi.GameApiV1 = null;

const CAPTURE_TARGET_WORLD = "capture-target://blank";
var capture_target_wire: abi.CaptureTargetRigV1 = .{};
var capture_bone_ids: [abi.CAPTURE_TARGET_MAX_BONES][]const u8 = undefined;
var capture_bones: [abi.CAPTURE_TARGET_MAX_BONES]rig_pose.Bone = undefined;

pub const MountedCharacterRigView = struct {
    bone_ids: []const []const u8,
    bones: []const rig_pose.Bone,
};

pub fn install(dispatch: *const abi.GameApiV1) void {
    if (!modular_core) return;
    active_api = dispatch;
}

pub fn clear() void {
    if (!modular_core) return;
    active_api = null;
}

pub fn installed() ?*const abi.GameApiV1 {
    return active_api;
}

pub const PaintPhase = enum(u32) { down = 0, move = 1, up = 2 };
pub const Vec3 = struct { x: f32 = 0, y: f32 = 0, z: f32 = 0 };
pub const Solved = struct { pos: Vec3, target: Vec3, fov: f32 };

/// Classify the source in the cold executable and carry only this scalar over
/// the module ABI. In particular, `error.FileNotFound` never crosses a shared
/// library boundary where its numeric identity can name a different error.
pub fn gameSourceStatus(io: std.Io, path: []const u8) abi.GameSourceStatus {
    return abi.classifyGameSource(io, path);
}

fn cachedGameSourceStatus(io: std.Io, node: *Node, path: []const u8) abi.GameSourceStatus {
    switch (node.world_loader_source_status) {
        .present => return .present,
        .missing => return .missing,
        .inaccessible => return .inaccessible,
        .unknown => {},
    }
    const status = gameSourceStatus(io, path);
    node.world_loader_source_status = switch (status) {
        .present => .present,
        .missing => .missing,
        .inaccessible => .inaccessible,
    };
    return status;
}

pub fn renderEmbedded(io: std.Io, environ: *const std.process.Environ.Map, _: std.mem.Allocator, node: *Node, x: f32, y: f32, width: f32, height: f32, opacity: f32) bool {
    if (!modular_core) return world.renderEmbedded(io, environ, std.heap.c_allocator, node, x, y, width, height, opacity);
    const dispatch = active_api orelse return false;
    const game_file = node.world_loader_game_file orelse "zig-out/game/hmsc.gamefile";
    return dispatch.render_world(&io, environ, node, x, y, width, height, opacity, cachedGameSourceStatus(io, node, game_file));
}

pub fn mount(io: std.Io, environ: *const std.process.Environ.Map, _: std.mem.Allocator, node_id: u32, game_file: []const u8, store_dir: []const u8) !void {
    if (!modular_core) return world.mount(io, environ, std.heap.c_allocator, node_id, game_file, store_dir);
    const dispatch = active_api orelse return error.GameModuleUnavailable;
    if (dispatch.mount_world(&io, environ, node_id, game_file.ptr, game_file.len, store_dir.ptr, store_dir.len, gameSourceStatus(io, game_file)) != .ok)
        return error.GameMountFailed;
}

pub fn unmount(io: std.Io, node_id: u32) void {
    if (!modular_core) return world.unmount(io, node_id);
    if (active_api) |dispatch| dispatch.unmount_world(&io, node_id);
}

pub fn statusAlloc(allocator: std.mem.Allocator, node_id: u32) ![]u8 {
    if (!modular_core) return world.statusAlloc(allocator, node_id);
    const dispatch = active_api orelse return error.GameModuleUnavailable;
    var dummy: u8 = 0;
    const len = dispatch.status_world(node_id, @ptrCast(&dummy), 0);
    const out = try allocator.alloc(u8, len);
    errdefer allocator.free(out);
    if (dispatch.status_world(node_id, out.ptr, out.len) != len) return error.GameStatusChanged;
    return out;
}

fn constraintFromWire(wire: abi.CaptureTargetBoneV1) !rig_pose.Constraint {
    return switch (wire.constraint_kind) {
        .unconstrained => .unconstrained,
        .fixed => .fixed,
        .hinge_x => .{ .hinge_x = .{
            .min = wire.constraint_values[0],
            .max = wire.constraint_values[1],
        } },
        .ball => .{ .ball = .{
            .swing_x = .{ .min = wire.constraint_values[0], .max = wire.constraint_values[1] },
            .swing_z = .{ .min = wire.constraint_values[2], .max = wire.constraint_values[3] },
            .twist_y = .{ .min = wire.constraint_values[4], .max = wire.constraint_values[5] },
        } },
    };
}

/// Route capture through the same replaceable Game image that renders the
/// WorldLoader (USER ASK req_4254). The old direct import created a second,
/// invisible mounted-world registry in modular development builds.
pub fn loadMountedPlayerCharacterTarget(
    io: std.Io,
    environ: *const std.process.Environ.Map,
    node_id: u32,
    owner_id: []const u8,
    geometry_path: []const u8,
    skin_path: []const u8,
    skeleton_json: []const u8,
) !MountedCharacterRigView {
    if (!modular_core) {
        try world.ensureBlankMounted(
            io,
            environ,
            std.heap.c_allocator,
            node_id,
            CAPTURE_TARGET_WORLD,
        );
        const view = try world.loadMountedPlayerCharacterTarget(
            io,
            node_id,
            owner_id,
            geometry_path,
            skin_path,
            skeleton_json,
        );
        return .{ .bone_ids = view.bone_ids, .bones = view.bones };
    }

    const dispatch = active_api orelse return error.GameModuleUnavailable;
    if (dispatch.capture_load_target(
        &io,
        environ,
        node_id,
        owner_id.ptr,
        owner_id.len,
        geometry_path.ptr,
        geometry_path.len,
        skin_path.ptr,
        skin_path.len,
        skeleton_json.ptr,
        skeleton_json.len,
        &capture_target_wire,
    ) != .ok) return error.GameCaptureTargetLoadFailed;

    const bone_count: usize = @intCast(capture_target_wire.bone_count);
    if (bone_count == 0 or bone_count > abi.CAPTURE_TARGET_MAX_BONES) {
        return error.GameCaptureTargetRigInvalid;
    }
    for (0..bone_count) |index| {
        const id_len: usize = @intCast(capture_target_wire.bone_ids[index].len);
        if (id_len == 0 or id_len > abi.CAPTURE_TARGET_BONE_ID_BYTES) {
            return error.GameCaptureTargetRigInvalid;
        }
        const wire = capture_target_wire.bones[index];
        if (wire.parent_index < -1 or wire.parent_index >= @as(i32, @intCast(index))) {
            return error.GameCaptureTargetRigInvalid;
        }
        capture_bone_ids[index] = capture_target_wire.bone_ids[index].bytes[0..id_len];
        capture_bones[index] = .{
            .parent_index = if (wire.parent_index < 0) null else @intCast(wire.parent_index),
            .bind_translation = wire.bind_translation,
            .bind_rotation = wire.bind_rotation,
            .constraint = try constraintFromWire(wire),
        };
    }
    return .{
        .bone_ids = capture_bone_ids[0..bone_count],
        .bones = capture_bones[0..bone_count],
    };
}

pub fn activateMountedPlayerCharacterTarget(node_id: u32, owner_id: []const u8) !void {
    if (!modular_core) return world.activateMountedPlayerCharacterTarget(node_id, owner_id);
    const dispatch = active_api orelse return error.GameModuleUnavailable;
    if (dispatch.capture_activate_target(node_id, owner_id.ptr, owner_id.len) != .ok) {
        return error.GameCaptureTargetActivationFailed;
    }
}

pub fn publishMountedPlayerCharacterPose(
    node_id: u32,
    owner_id: []const u8,
    frame: pose_stream.Frame,
) !u64 {
    if (!modular_core) return world.publishMountedPlayerCharacterPose(node_id, owner_id, frame);
    const dispatch = active_api orelse return error.GameModuleUnavailable;
    var pose = abi.CapturePoseV1{
        .bone_count = frame.bone_count,
        .frame_id = frame.frame_id,
        .root_translation = frame.root_translation,
    };
    @memcpy(
        pose.local_quaternions[0..frame.bone_count],
        frame.local_quaternions[0..frame.bone_count],
    );
    if (dispatch.capture_publish_pose(node_id, owner_id.ptr, owner_id.len, &pose) != .ok) {
        return error.GameCaptureTargetPoseFailed;
    }
    return frame.frame_id;
}

pub fn clearMountedPlayerCharacterPose(node_id: u32, owner_id: []const u8) void {
    if (!modular_core) return world.clearMountedPlayerCharacterPose(node_id, owner_id);
    const dispatch = active_api orelse return;
    _ = dispatch.capture_clear_pose(node_id, owner_id.ptr, owner_id.len);
}

pub fn setMountedPlayerCharacterCaptureDrive(node_id: u32, owner_id: []const u8, enabled: bool) !void {
    if (!modular_core) return world.setMountedPlayerCharacterCaptureDrive(node_id, owner_id, enabled);
    const dispatch = active_api orelse return error.GameModuleUnavailable;
    if (dispatch.capture_set_drive(node_id, owner_id.ptr, owner_id.len, enabled) != .ok) {
        return error.GameCaptureTargetDriveFailed;
    }
}

pub fn closeMountedPlayerCharacterTarget(node_id: u32, owner_id: []const u8) void {
    if (!modular_core) return world.closeMountedPlayerCharacterTarget(node_id, owner_id);
    const dispatch = active_api orelse return;
    _ = dispatch.capture_close_target(node_id, owner_id.ptr, owner_id.len);
}

pub fn paintArmed(node_id: u32) bool {
    if (!modular_core) return world.paintArmed(node_id);
    return if (active_api) |dispatch| dispatch.paint_armed(node_id) else false;
}

pub fn anyPaintArmed() bool {
    if (!modular_core) return world.anyPaintArmed();
    return if (active_api) |dispatch| dispatch.any_paint_armed() else false;
}

pub fn anyWallToolArmed() bool {
    if (!modular_core) return world.anyWallToolArmed();
    return if (active_api) |dispatch| dispatch.any_wall_tool_armed() else false;
}

pub fn paintPointer(io: std.Io, node_id: u32, phase: PaintPhase, x: f32, y: f32) void {
    if (!modular_core) return world.paintPointer(io, node_id, @enumFromInt(@intFromEnum(phase)), x, y);
    if (active_api) |dispatch| dispatch.paint_pointer(&io, node_id, @intFromEnum(phase), x, y);
}

pub fn mouseLook(node_id: u32, dx: f32, dy: f32) void {
    if (!modular_core) return world.mouseLook(node_id, dx, dy);
    if (active_api) |dispatch| dispatch.mouse_look(node_id, dx, dy);
}

pub fn authoringCameraDrag(node_id: u32, dx: f32, dy: f32, pan: bool) bool {
    if (!modular_core) return world.authoringCameraDrag(node_id, dx, dy, pan);
    return if (active_api) |dispatch| dispatch.authoring_camera_drag(node_id, dx, dy, pan) else false;
}

pub fn authoringCameraDolly(node_id: u32, wheel_delta: f32) bool {
    if (!modular_core) return world.authoringCameraDolly(node_id, wheel_delta);
    return if (active_api) |dispatch| dispatch.authoring_camera_dolly(node_id, wheel_delta) else false;
}

pub fn setAiming(node_id: u32, aiming: bool) void {
    if (!modular_core) return world.setAiming(node_id, aiming);
    if (active_api) |dispatch| dispatch.set_aiming(node_id, aiming);
}

pub fn isExternalCamera(node_id: u32) bool {
    if (!modular_core) return world.isExternalCamera(node_id);
    return if (active_api) |dispatch| dispatch.external_camera(node_id) else false;
}

pub fn renderDetachedView(io: std.Io, environ: *const std.process.Environ.Map, node_id: u32, target: *scene3d_runtime.DetachedTarget, width: f32, height: f32) ?*wgpu.TextureView {
    if (!modular_core) return world.renderDetachedView(io, environ, node_id, target, width, height);
    const dispatch = active_api orelse return null;
    const raw = dispatch.render_detached_world(&io, environ, &target.handle, @ptrFromInt(node_id), width, height) orelse return null;
    return @ptrCast(@alignCast(raw));
}

pub fn drawHudForWindow(node_id: u32, width: f32, height: f32) void {
    if (!modular_core) return world.drawHudForWindow(node_id, width, height);
    if (active_api) |dispatch| dispatch.draw_world_hud(node_id, width, height);
}

pub fn bindNode(node_id: u32) void {
    if (!modular_core) return camera.bindNode(node_id);
    if (active_api) |dispatch| dispatch.camera_bind_node(node_id);
}

pub fn unbindNode(node_id: u32) void {
    if (!modular_core) return camera.unbindNode(node_id);
    if (active_api) |dispatch| dispatch.camera_unbind_node(node_id);
}

pub fn activeNodeId() u32 {
    if (!modular_core) return camera.activeNodeId();
    return 0;
}

pub fn stepNode(node_id: u32, now_ms: u32) ?Solved {
    if (!modular_core) {
        const solved = camera.stepNode(node_id, now_ms) orelse return null;
        return .{
            .pos = .{ .x = solved.pos.x, .y = solved.pos.y, .z = solved.pos.z },
            .target = .{ .x = solved.target.x, .y = solved.target.y, .z = solved.target.z },
            .fov = solved.fov,
        };
    }
    var values: [7]f32 = undefined;
    if (!(active_api orelse return null).camera_step_node(node_id, now_ms, &values, values.len)) return null;
    return .{
        .pos = .{ .x = values[0], .y = values[1], .z = values[2] },
        .target = .{ .x = values[3], .y = values[4], .z = values[5] },
        .fov = values[6],
    };
}

pub fn stepActive(now_ms: u32) ?Solved {
    return stepNode(activeNodeId(), now_ms);
}

pub fn writeNode(node: anytype, solved: Solved) void {
    node.scene3d_camera = true;
    node.scene3d_pos_x = solved.pos.x;
    node.scene3d_pos_y = solved.pos.y;
    node.scene3d_pos_z = solved.pos.z;
    node.scene3d_look_x = solved.target.x;
    node.scene3d_look_y = solved.target.y;
    node.scene3d_look_z = solved.target.z;
    node.scene3d_fov = solved.fov;
}
