//! Replaceable Scene3D development library.

const std = @import("std");
const wgpu = @import("wgpu");
const abi = @import("dev_module_abi");
const Node = @import("../layout.zig").Node;
const HostContext = @import("../host_context.zig");
const scene3d = @import("../gpu/3d.zig");
const bindings = @import("../v8_bindings_scene3d.zig");
const gpu_api = @import("gpu_api.zig");
const v8_runtime_api = @import("v8_runtime_api.zig");
const dirty_api = @import("dirty_api.zig");
const host_tree_api = @import("host_tree_api.zig");

const SNAPSHOT_SCHEMA_VERSION: u32 = 1;

fn prepare(core: *const abi.CoreApiV1) callconv(.c) abi.ModuleStatus {
    if (core.abi_version != abi.ABI_VERSION or
        core.struct_size != @sizeOf(abi.CoreApiV1) or
        core.node_size != @sizeOf(Node)) return .rejected;
    gpu_api.installCore(core);
    v8_runtime_api.installCore(core);
    dirty_api.installCore(core);
    host_tree_api.installCore(core);
    return .ok;
}

fn registerBindings(host_raw: ?*anyopaque) callconv(.c) void {
    const host: *HostContext = @ptrCast(@alignCast(host_raw orelse return));
    bindings.register(host);
}

fn quiesce(_: u32) callconv(.c) abi.ModuleStatus {
    // An open model session contains authoritative unsaved topology, semantic,
    // journal, paint, and orbit state. Until its versioned codec lands, keep
    // the user's data safe by taking the automatic exact-child restart path.
    if (scene3d.meshEditActiveCount() != 0) return .restart_required;
    return .ok;
}

fn snapshot(sink: *const abi.SnapshotSinkV1) callconv(.c) abi.ModuleStatus {
    const envelope = abi.SnapshotEnvelopeV1{
        .module_kind = .scene3d,
        .schema_version = SNAPSHOT_SCHEMA_VERSION,
        .payload_len = 0,
        .checksum = 0,
    };
    return if (sink.append(std.mem.asBytes(&envelope))) .ok else .rejected;
}

fn restore(bytes_ptr: [*]const u8, bytes_len: usize) callconv(.c) abi.ModuleStatus {
    if (bytes_len != @sizeOf(abi.SnapshotEnvelopeV1)) return .restart_required;
    const envelope: *align(1) const abi.SnapshotEnvelopeV1 = @ptrCast(bytes_ptr);
    if (envelope.envelope_version != abi.SNAPSHOT_ENVELOPE_VERSION or
        envelope.module_kind != .scene3d or
        envelope.schema_version != SNAPSHOT_SCHEMA_VERSION or
        envelope.payload_len != 0 or
        envelope.checksum != 0) return .restart_required;
    return .ok;
}

fn activate() callconv(.c) abi.ModuleStatus {
    return .ok;
}

fn deactivate() callconv(.c) void {}

fn release() callconv(.c) void {
    scene3d.deinit();
    host_tree_api.clearCore();
    dirty_api.clearCore();
    v8_runtime_api.clearCore();
    gpu_api.clearCore();
}

fn frameIo(raw: ?*const anyopaque) ?std.Io {
    const borrowed = if (raw) |ptr| @as(*const std.Io, @ptrCast(@alignCast(ptr))).* else return null;
    return v8_runtime_api.moduleIo(borrowed);
}

fn processEnviron(raw: ?*const anyopaque) ?*const std.process.Environ.Map {
    return if (raw) |ptr| @ptrCast(@alignCast(ptr)) else null;
}

fn render(io_raw: ?*const anyopaque, environ_raw: ?*const anyopaque, node_raw: ?*anyopaque, x: f32, y: f32, width: f32, height: f32, opacity: f32) callconv(.c) bool {
    const io = frameIo(io_raw) orelse return false;
    const environ = processEnviron(environ_raw) orelse return false;
    const node: *Node = @ptrCast(@alignCast(node_raw orelse return false));
    return scene3d.render(io, environ, node, x, y, width, height, opacity);
}

fn renderDetached(io_raw: ?*const anyopaque, environ_raw: ?*const anyopaque, target_handle: *u64, node_raw: ?*anyopaque, width: f32, height: f32) callconv(.c) ?*anyopaque {
    const io = frameIo(io_raw) orelse return null;
    const environ = processEnviron(environ_raw) orelse return null;
    const node: *Node = @ptrCast(@alignCast(node_raw orelse return null));
    const target: *scene3d.DetachedTarget = if (target_handle.* == 0) blk: {
        const created = std.heap.c_allocator.create(scene3d.DetachedTarget) catch return null;
        created.* = .{};
        target_handle.* = @intFromPtr(created);
        break :blk created;
    } else @ptrFromInt(target_handle.*);
    return scene3d.renderDetached(io, environ, target, node, width, height);
}

fn releaseDetached(target_handle: *u64) callconv(.c) void {
    if (target_handle.* == 0) return;
    const target: *scene3d.DetachedTarget = @ptrFromInt(target_handle.*);
    target.deinit();
    std.heap.c_allocator.destroy(target);
    target_handle.* = 0;
}

fn update(dt_seconds: f32) callconv(.c) void {
    scene3d.update(dt_seconds);
}

fn flushPending(io_raw: ?*const anyopaque, environ_raw: ?*const anyopaque) callconv(.c) void {
    const io = frameIo(io_raw) orelse return;
    const environ = processEnviron(environ_raw) orelse return;
    scene3d.flushPending(io, environ);
}

fn frameCleanup() callconv(.c) void {
    scene3d.frameCleanup();
}
fn resetForReload() callconv(.c) void {
    scene3d.resetForReload();
}
fn deinitScene() callconv(.c) void {
    scene3d.deinit();
}
fn textureBindGroupLayout() callconv(.c) ?*anyopaque {
    return scene3d.getTexBindGroupLayout();
}
fn diffuseSampler() callconv(.c) ?*anyopaque {
    return scene3d.getDiffuseSampler();
}
fn uvSamplingUniform(finite_atlas: bool) callconv(.c) ?*anyopaque {
    return scene3d.getUvSamplingUniform(finite_atlas);
}
fn meshEditCapturing() callconv(.c) bool {
    return scene3d.meshEditCapturing();
}
fn meshEditFocusTool() callconv(.c) bool {
    return scene3d.meshEditFocusTool();
}
fn meshEditMode() callconv(.c) u8 {
    return scene3d.meshEditModeRaw();
}
fn orbitDrag(dx: f32, dy: f32) callconv(.c) void {
    scene3d.orbitDrag(dx, dy);
}
fn orbitPan(dx: f32, dy: f32) callconv(.c) void {
    scene3d.orbitPan(dx, dy);
}
fn orbitZoom(delta: f32) callconv(.c) void {
    scene3d.orbitZoom(delta);
}
fn focusAt(x: f32, y: f32) callconv(.c) bool {
    return scene3d.focusAt(x, y);
}
fn meshPick(x: f32, y: f32, additive: bool) callconv(.c) i32 {
    return scene3d.meshEditPick(x, y, additive);
}
fn meshOutOfScopePartAt(x: f32, y: f32) callconv(.c) i32 {
    return scene3d.meshEditOutOfScopePartAt(x, y);
}
fn meshBox(x0: f32, y0: f32, x1: f32, y1: f32, additive: bool) callconv(.c) i32 {
    return scene3d.meshEditBox(x0, y0, x1, y1, additive);
}
fn meshSelectAll() callconv(.c) i32 {
    return scene3d.meshEditSelectAll();
}
fn meshSnapshot() callconv(.c) void {
    scene3d.meshEditSnapshot();
}
fn meshRevert() callconv(.c) void {
    scene3d.meshEditRevert();
}
fn meshGizmoHit(x: f32, y: f32) callconv(.c) i32 {
    return scene3d.meshGizmoHit(x, y);
}
fn meshGizmoBegin() callconv(.c) void {
    scene3d.meshGizmoBegin();
}
fn meshGizmoGrabAt(x: f32, y: f32, code: i32) callconv(.c) void {
    scene3d.meshGizmoGrabAt(x, y, code);
}
fn meshGizmoDrag(axis: i32, dx: f32, dy: f32, fine: bool, freeform: bool, vertex_snap: bool) callconv(.c) bool {
    return scene3d.meshGizmoDrag(axis, dx, dy, fine, freeform, vertex_snap);
}
fn meshGizmoFinish() callconv(.c) bool {
    return scene3d.meshGizmoFinish();
}
fn backdropGizmoHit(x: f32, y: f32) callconv(.c) i32 {
    return scene3d.bdGizmoHit(x, y);
}
fn backdropGizmoBegin(code: i32) callconv(.c) void {
    scene3d.bdGizmoBegin(code);
}
fn backdropGizmoDrag(dx: f32, dy: f32, fine: bool, freeform: bool) callconv(.c) bool {
    return scene3d.bdGizmoDrag(dx, dy, fine, freeform);
}
fn backdropGizmoFinish() callconv(.c) void {
    scene3d.bdGizmoFinish();
}
fn loopCutActive() callconv(.c) bool {
    return scene3d.meshLcActive();
}
fn loopCutHandleHit(x: f32, y: f32) callconv(.c) bool {
    return scene3d.meshLcHandleHit(x, y);
}
fn loopCutHandleDrag(dx: f32, dy: f32, snap: bool) callconv(.c) bool {
    return scene3d.meshLcHandleDrag(dx, dy, snap);
}
fn compassHit(x: f32, y: f32) callconv(.c) i32 {
    return scene3d.meshCompassHit(x, y);
}
fn compassSnap(code: i32) callconv(.c) bool {
    return scene3d.meshCompassSnap(code);
}
fn drawEditorOverlay(x: f32, y: f32) callconv(.c) void {
    scene3d.drawEditorOverlay(x, y);
}
fn meshSetMarquee(x0: f32, y0: f32, x1: f32, y1: f32) callconv(.c) void {
    scene3d.meshSetMarquee(x0, y0, x1, y1);
}
fn meshClearMarquee() callconv(.c) void {
    scene3d.meshClearMarquee();
}
fn characterRigActive() callconv(.c) bool {
    return scene3d.characterRigActive();
}
fn characterRigGizmoHit(x: f32, y: f32) callconv(.c) i32 {
    return scene3d.characterRigGizmoHit(x, y);
}
fn characterRigGizmoBegin(code: i32) callconv(.c) bool {
    return scene3d.characterRigGizmoBegin(code);
}
fn characterRigGizmoDrag(dx: f32, dy: f32, fine: bool) callconv(.c) bool {
    return scene3d.characterRigGizmoDrag(dx, dy, fine);
}
fn characterRigGizmoEnd() callconv(.c) abi.CharacterRigCommitV1 {
    const commit = scene3d.characterRigGizmoEnd() orelse return .{ .valid = false, .bone_index = 0, .pos = @splat(0), .rot = @splat(0), .scale = @splat(0) };
    return .{ .valid = true, .bone_index = commit.bone_index, .pos = commit.pos, .rot = commit.rot, .scale = commit.scale };
}

fn telemetryStats(out: *abi.Scene3dTelemetryV1) callconv(.c) void {
    const s = scene3d.telemetryStats();
    out.* = .{
        .scene_count = s.scene_count,
        .mesh_children = s.mesh_children,
        .meshes_collected = s.meshes_collected,
        .meshes_dropped = s.meshes_dropped,
        .instances = s.instances,
        .staged_dynamic = s.staged_dynamic,
        .draw_calls = s.draw_calls,
        .triangles = s.triangles,
        .draw_us = s.draw_us,
    };
}
fn memoryStats(out: *abi.Scene3dMemoryV1) callconv(.c) void {
    const gpu3d = scene3d.gpuMemoryStats();
    const instances = scene3d.staticInstanceMemoryStats();
    out.* = .{
        .retained_geometry_bytes = scene3d.retainedGeometryBytes(),
        .host_stash_bytes = scene3d.hostStashBytes(),
        .core_buffer_capacity_bytes = gpu3d.core_buffer_capacity_bytes,
        .render_target_bytes = gpu3d.render_target_bytes,
        .diffuse_texture_bytes = gpu3d.diffuse_texture_bytes,
        .static_standard_used_bytes = instances.standard_used_bytes,
        .static_standard_capacity_bytes = instances.standard_capacity_bytes,
        .static_slim_used_bytes = instances.slim_used_bytes,
        .static_slim_capacity_bytes = instances.slim_capacity_bytes,
    };
}

var module_api = abi.Scene3dApiV1{
    .header = .{
        .struct_size = @sizeOf(abi.Scene3dApiV1),
        .module_kind = .scene3d,
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
    .render = render,
    .render_detached = renderDetached,
    .release_detached = releaseDetached,
    .update = update,
    .flush_pending = flushPending,
    .frame_cleanup = frameCleanup,
    .reset_for_reload = resetForReload,
    .deinit_scene = deinitScene,
    .texture_bind_group_layout = textureBindGroupLayout,
    .diffuse_sampler = diffuseSampler,
    .uv_sampling_uniform = uvSamplingUniform,
    .mesh_edit_capturing = meshEditCapturing,
    .mesh_edit_focus_tool = meshEditFocusTool,
    .mesh_edit_mode = meshEditMode,
    .orbit_drag = orbitDrag,
    .orbit_pan = orbitPan,
    .orbit_zoom = orbitZoom,
    .focus_at = focusAt,
    .mesh_pick = meshPick,
    .mesh_out_of_scope_part_at = meshOutOfScopePartAt,
    .mesh_box = meshBox,
    .mesh_select_all = meshSelectAll,
    .mesh_snapshot = meshSnapshot,
    .mesh_revert = meshRevert,
    .mesh_gizmo_hit = meshGizmoHit,
    .mesh_gizmo_begin = meshGizmoBegin,
    .mesh_gizmo_grab_at = meshGizmoGrabAt,
    .mesh_gizmo_drag = meshGizmoDrag,
    .mesh_gizmo_finish = meshGizmoFinish,
    .backdrop_gizmo_hit = backdropGizmoHit,
    .backdrop_gizmo_begin = backdropGizmoBegin,
    .backdrop_gizmo_drag = backdropGizmoDrag,
    .backdrop_gizmo_finish = backdropGizmoFinish,
    .loop_cut_active = loopCutActive,
    .loop_cut_handle_hit = loopCutHandleHit,
    .loop_cut_handle_drag = loopCutHandleDrag,
    .compass_hit = compassHit,
    .compass_snap = compassSnap,
    .draw_editor_overlay = drawEditorOverlay,
    .mesh_set_marquee = meshSetMarquee,
    .mesh_clear_marquee = meshClearMarquee,
    .character_rig_active = characterRigActive,
    .character_rig_gizmo_hit = characterRigGizmoHit,
    .character_rig_gizmo_begin = characterRigGizmoBegin,
    .character_rig_gizmo_drag = characterRigGizmoDrag,
    .character_rig_gizmo_end = characterRigGizmoEnd,
    .telemetry_stats = telemetryStats,
    .memory_stats = memoryStats,
};

pub fn descriptor() *const abi.ModuleHeaderV1 {
    return &module_api.header;
}
