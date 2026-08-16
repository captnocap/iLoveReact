//! Replaceable Game/world development library.

const std = @import("std");
const abi = @import("dev_module_abi");
const Node = @import("../layout.zig").Node;
const HostContext = @import("../host_context.zig");
const world = @import("../world_loader.zig");
const camera = @import("../game/camera.zig");
const ingredients = @import("../v8_ingredients.zig");
const gpu_api = @import("gpu_api.zig");
const material_api = @import("material_api.zig");
const v8_runtime_api = @import("v8_runtime_api.zig");
const dirty_api = @import("dirty_api.zig");
const host_tree_api = @import("host_tree_api.zig");
const world_window_api = @import("world_window_api.zig");
const scene3d_runtime = @import("scene3d_runtime.zig");

const SNAPSHOT_SCHEMA_VERSION: u32 = 1;
const CAPTURE_TARGET_WORLD = "capture-target://blank";

fn prepare(core: *const abi.CoreApiV1) callconv(.c) abi.ModuleStatus {
    if (core.abi_version != abi.ABI_VERSION or
        core.struct_size != @sizeOf(abi.CoreApiV1) or
        core.node_size != @sizeOf(Node)) return .rejected;
    const scene_api: *const abi.Scene3dApiV1 = @ptrCast(@alignCast(core.scene3d_api orelse return .rejected));
    scene3d_runtime.install(scene_api);
    gpu_api.installCore(core);
    material_api.installCore(core);
    v8_runtime_api.installCore(core);
    dirty_api.installCore(core);
    host_tree_api.installCore(core);
    world_window_api.installCore(core);
    return .ok;
}

fn registerBindings(host_raw: ?*anyopaque) callconv(.c) void {
    const host: *HostContext = @ptrCast(@alignCast(host_raw orelse return));
    ingredients.registerGame(host);
}

fn quiesce(_: u32) callconv(.c) abi.ModuleStatus {
    // Mounted worlds and the authoring engines contain live revisions. The
    // supervisor replays the exact bundle/module manifest after restart until
    // their versioned snapshot codec is complete.
    return .restart_required;
}

fn snapshot(sink: *const abi.SnapshotSinkV1) callconv(.c) abi.ModuleStatus {
    const envelope = abi.SnapshotEnvelopeV1{
        .module_kind = .game,
        .schema_version = SNAPSHOT_SCHEMA_VERSION,
        .payload_len = 0,
        .checksum = 0,
    };
    return if (sink.append(std.mem.asBytes(&envelope))) .ok else .rejected;
}

fn restore(bytes: [*]const u8, len: usize) callconv(.c) abi.ModuleStatus {
    if (len == 0) return .ok;
    if (len != @sizeOf(abi.SnapshotEnvelopeV1)) return .restart_required;
    const envelope: *align(1) const abi.SnapshotEnvelopeV1 = @ptrCast(bytes);
    return if (envelope.module_kind == .game and envelope.schema_version == SNAPSHOT_SCHEMA_VERSION) .ok else .restart_required;
}

fn activate() callconv(.c) abi.ModuleStatus {
    return .ok;
}
fn deactivate() callconv(.c) void {}
fn release() callconv(.c) void {
    world_window_api.clearCore();
    host_tree_api.clearCore();
    dirty_api.clearCore();
    v8_runtime_api.clearCore();
    material_api.clearCore();
    gpu_api.clearCore();
    scene3d_runtime.clear();
}

fn frameIo(raw: ?*const anyopaque) ?std.Io {
    const borrowed = if (raw) |ptr| @as(*const std.Io, @ptrCast(@alignCast(ptr))).* else return null;
    return v8_runtime_api.moduleIo(borrowed);
}

fn processEnviron(raw: ?*const anyopaque) ?*const std.process.Environ.Map {
    return if (raw) |ptr| @ptrCast(@alignCast(ptr)) else null;
}

fn renderWorld(io_raw: ?*const anyopaque, environ_raw: ?*const anyopaque, node_raw: ?*anyopaque, x: f32, y: f32, width: f32, height: f32, opacity: f32, source_status: abi.GameSourceStatus) callconv(.c) bool {
    const io = frameIo(io_raw) orelse return false;
    const environ = processEnviron(environ_raw) orelse return false;
    const node: *Node = @ptrCast(@alignCast(node_raw orelse return false));
    const game_file = node.world_loader_game_file orelse "zig-out/game/hmsc.gamefile";
    if (node.world_loader_preview_stage) {
        world.ensurePreviewStageMounted(io, environ, std.heap.c_allocator, node.id, game_file) catch return false;
    } else if (source_status == .missing) {
        world.ensureBlankMounted(io, environ, std.heap.c_allocator, node.id, game_file) catch return false;
    }
    return world.renderEmbedded(io, environ, std.heap.c_allocator, node, x, y, width, height, opacity);
}

fn mountWorld(io_raw: ?*const anyopaque, environ_raw: ?*const anyopaque, node_id: u32, game_file: [*]const u8, game_file_len: usize, store_dir: [*]const u8, store_dir_len: usize, source_status: abi.GameSourceStatus) callconv(.c) abi.ModuleStatus {
    const io = frameIo(io_raw) orelse return .rejected;
    const environ = processEnviron(environ_raw) orelse return .rejected;
    const path = game_file[0..game_file_len];
    if (source_status == .missing) {
        world.mountBlank(io, environ, std.heap.c_allocator, node_id, path) catch return .rejected;
    } else {
        world.mount(io, environ, std.heap.c_allocator, node_id, path, store_dir[0..store_dir_len]) catch return .rejected;
    }
    return .ok;
}

fn unmountWorld(io_raw: ?*const anyopaque, node_id: u32) callconv(.c) void {
    const io = frameIo(io_raw) orelse return;
    world.unmount(io, node_id);
}

fn statusWorld(node_id: u32, out: [*]u8, out_len: usize) callconv(.c) usize {
    const status = world.statusAlloc(std.heap.c_allocator, node_id) catch return 0;
    defer std.heap.c_allocator.free(status);
    const count = @min(out_len, status.len);
    @memcpy(out[0..count], status[0..count]);
    return status.len;
}

fn captureConstraintToWire(constraint: world.rig_pose.Constraint) struct {
    kind: abi.CaptureConstraintKindV1,
    values: [6]f32,
} {
    var values: [6]f32 = @splat(0);
    const kind: abi.CaptureConstraintKindV1 = switch (constraint) {
        .unconstrained => .unconstrained,
        .fixed => .fixed,
        .hinge_x => |range| blk: {
            values[0] = range.min;
            values[1] = range.max;
            break :blk .hinge_x;
        },
        .ball => |ball| blk: {
            values = .{
                ball.swing_x.min,
                ball.swing_x.max,
                ball.swing_z.min,
                ball.swing_z.max,
                ball.twist_y.min,
                ball.twist_y.max,
            };
            break :blk .ball;
        },
    };
    return .{ .kind = kind, .values = values };
}

fn captureLoadTarget(
    io_raw: ?*const anyopaque,
    environ_raw: ?*const anyopaque,
    node_id: u32,
    owner_ptr: [*]const u8,
    owner_len: usize,
    geometry_path_ptr: [*]const u8,
    geometry_path_len: usize,
    skin_path_ptr: [*]const u8,
    skin_path_len: usize,
    skeleton_json_ptr: [*]const u8,
    skeleton_json_len: usize,
    out: *abi.CaptureTargetRigV1,
) callconv(.c) abi.ModuleStatus {
    const io = frameIo(io_raw) orelse return .rejected;
    const environ = processEnviron(environ_raw) orelse return .rejected;
    const owner = owner_ptr[0..owner_len];
    world.ensureBlankMounted(
        io,
        environ,
        std.heap.c_allocator,
        node_id,
        CAPTURE_TARGET_WORLD,
    ) catch return .rejected;
    const view = world.loadMountedPlayerCharacterTarget(
        io,
        node_id,
        owner,
        geometry_path_ptr[0..geometry_path_len],
        skin_path_ptr[0..skin_path_len],
        skeleton_json_ptr[0..skeleton_json_len],
    ) catch return .rejected;
    if (view.bones.len == 0 or
        view.bones.len > abi.CAPTURE_TARGET_MAX_BONES or
        view.bone_ids.len != view.bones.len)
    {
        world.closeMountedPlayerCharacterTarget(node_id, owner);
        return .rejected;
    }

    out.* = .{};
    out.bone_count = @intCast(view.bones.len);
    for (view.bone_ids, view.bones, 0..) |bone_id, bone, index| {
        if (bone_id.len == 0 or bone_id.len > abi.CAPTURE_TARGET_BONE_ID_BYTES) {
            world.closeMountedPlayerCharacterTarget(node_id, owner);
            out.* = .{};
            return .rejected;
        }
        out.bone_ids[index].len = @intCast(bone_id.len);
        @memcpy(out.bone_ids[index].bytes[0..bone_id.len], bone_id);
        const constraint = captureConstraintToWire(bone.constraint);
        out.bones[index] = .{
            .parent_index = if (bone.parent_index) |parent| @intCast(parent) else -1,
            .constraint_kind = constraint.kind,
            .bind_translation = bone.bind_translation,
            .bind_rotation = bone.bind_rotation,
            .constraint_values = constraint.values,
        };
    }
    return .ok;
}

fn captureActivateTarget(node_id: u32, owner_ptr: [*]const u8, owner_len: usize) callconv(.c) abi.ModuleStatus {
    world.activateMountedPlayerCharacterTarget(node_id, owner_ptr[0..owner_len]) catch return .rejected;
    return .ok;
}

fn capturePublishPose(
    node_id: u32,
    owner_ptr: [*]const u8,
    owner_len: usize,
    pose: *const abi.CapturePoseV1,
) callconv(.c) abi.ModuleStatus {
    if (pose.bone_count == 0 or pose.bone_count > abi.CAPTURE_TARGET_MAX_BONES) return .rejected;
    var frame = world.pose_stream.Frame{
        .bone_count = @intCast(pose.bone_count),
        .frame_id = pose.frame_id,
        .root_translation = pose.root_translation,
    };
    @memcpy(
        frame.local_quaternions[0..pose.bone_count],
        pose.local_quaternions[0..pose.bone_count],
    );
    _ = world.publishMountedPlayerCharacterPose(
        node_id,
        owner_ptr[0..owner_len],
        frame,
    ) catch return .rejected;
    return .ok;
}

fn captureClearPose(node_id: u32, owner_ptr: [*]const u8, owner_len: usize) callconv(.c) abi.ModuleStatus {
    world.clearMountedPlayerCharacterPose(node_id, owner_ptr[0..owner_len]);
    return .ok;
}

fn captureSetDrive(node_id: u32, owner_ptr: [*]const u8, owner_len: usize, enabled: bool) callconv(.c) abi.ModuleStatus {
    world.setMountedPlayerCharacterCaptureDrive(node_id, owner_ptr[0..owner_len], enabled) catch return .rejected;
    return .ok;
}

fn captureCloseTarget(node_id: u32, owner_ptr: [*]const u8, owner_len: usize) callconv(.c) abi.ModuleStatus {
    world.closeMountedPlayerCharacterTarget(node_id, owner_ptr[0..owner_len]);
    return .ok;
}

fn paintArmed(node_id: u32) callconv(.c) bool {
    return world.paintArmed(node_id);
}
fn anyPaintArmed() callconv(.c) bool {
    return world.anyPaintArmed();
}
fn anyWallToolArmed() callconv(.c) bool {
    return world.anyWallToolArmed();
}
fn paintPointer(io_raw: ?*const anyopaque, node_id: u32, phase: u32, x: f32, y: f32) callconv(.c) void {
    const io = frameIo(io_raw) orelse return;
    if (phase > @intFromEnum(world.PaintPhase.up)) return;
    world.paintPointer(io, node_id, @enumFromInt(phase), x, y);
}
fn mouseLook(node_id: u32, dx: f32, dy: f32) callconv(.c) void {
    world.mouseLook(node_id, dx, dy);
}
fn authoringCameraDrag(node_id: u32, dx: f32, dy: f32, pan: bool) callconv(.c) bool {
    return world.authoringCameraDrag(node_id, dx, dy, pan);
}
fn authoringCameraDolly(node_id: u32, wheel_delta: f32) callconv(.c) bool {
    return world.authoringCameraDolly(node_id, wheel_delta);
}
fn setAiming(node_id: u32, aiming: bool) callconv(.c) void {
    world.setAiming(node_id, aiming);
}
fn externalCamera(node_id: u32) callconv(.c) bool {
    return world.isExternalCamera(node_id);
}

fn renderDetachedWorld(io_raw: ?*const anyopaque, environ_raw: ?*const anyopaque, target_handle: *u64, node_raw: ?*anyopaque, width: f32, height: f32) callconv(.c) ?*anyopaque {
    const io = frameIo(io_raw) orelse return null;
    const environ = processEnviron(environ_raw) orelse return null;
    const node_id: u32 = @intCast(@intFromPtr(node_raw orelse return null));
    var target = scene3d_runtime.DetachedTarget{ .handle = target_handle.* };
    const view = world.renderDetachedView(io, environ, node_id, &target, width, height);
    target_handle.* = target.handle;
    return view;
}

fn drawWorldHud(node_id: u32, width: f32, height: f32) callconv(.c) void {
    world.drawHudForWindow(node_id, width, height);
}
fn cameraBindNode(node_id: u32) callconv(.c) void {
    camera.bindNode(node_id);
}
fn cameraUnbindNode(node_id: u32) callconv(.c) void {
    camera.unbindNode(node_id);
}
fn cameraStepNode(node_id: u32, now_ms: u32, out: [*]f32, out_len: usize) callconv(.c) bool {
    if (out_len < 7) return false;
    const solved = camera.stepNode(node_id, now_ms) orelse return false;
    out[0] = solved.pos.x;
    out[1] = solved.pos.y;
    out[2] = solved.pos.z;
    out[3] = solved.target.x;
    out[4] = solved.target.y;
    out[5] = solved.target.z;
    out[6] = solved.fov;
    return true;
}
fn cameraWriteNode(_: ?*anyopaque, _: [*]const f32, _: usize) callconv(.c) void {}

var module_api = abi.GameApiV1{
    .header = .{
        .struct_size = @sizeOf(abi.GameApiV1),
        .module_kind = .game,
        .build_hash = abi.zeroHash(),
        .abi_hash = abi.zeroHash(),
        .dependency_hash = abi.zeroHash(),
    },
    .lifecycle = .{
        .prepare = prepare,
        .register_bindings = registerBindings,
        .quiesce = quiesce,
        .snapshot = snapshot,
        .restore = restore,
        .activate = activate,
        .deactivate = deactivate,
        .release = release,
    },
    .render_world = renderWorld,
    .mount_world = mountWorld,
    .unmount_world = unmountWorld,
    .status_world = statusWorld,
    .capture_load_target = captureLoadTarget,
    .capture_activate_target = captureActivateTarget,
    .capture_publish_pose = capturePublishPose,
    .capture_clear_pose = captureClearPose,
    .capture_set_drive = captureSetDrive,
    .capture_close_target = captureCloseTarget,
    .paint_armed = paintArmed,
    .any_paint_armed = anyPaintArmed,
    .any_wall_tool_armed = anyWallToolArmed,
    .paint_pointer = paintPointer,
    .mouse_look = mouseLook,
    .authoring_camera_drag = authoringCameraDrag,
    .authoring_camera_dolly = authoringCameraDolly,
    .set_aiming = setAiming,
    .external_camera = externalCamera,
    .render_detached_world = renderDetachedWorld,
    .draw_world_hud = drawWorldHud,
    .camera_bind_node = cameraBindNode,
    .camera_unbind_node = cameraUnbindNode,
    .camera_step_node = cameraStepNode,
    .camera_write_node = cameraWriteNode,
};

pub fn descriptor() *const abi.ModuleHeaderV1 {
    return &module_api.header;
}
