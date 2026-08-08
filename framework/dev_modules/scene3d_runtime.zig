//! Scene3D call boundary.
//!
//! Release builds resolve these calls directly so shipping remains one static
//! binary. The modular dev core owns only an atomic dispatch pointer installed
//! by the reload controller; it never imports `gpu/3d.zig`.

const std = @import("std");
const wgpu = @import("wgpu");
const build_options = @import("build_options");
const abi = @import("dev_module_abi");
const Node = @import("../layout.zig").Node;

const modular_core = build_options.dev_native_modules and !build_options.dev_scene3d_module;
const implementation = if (!modular_core) @import("../gpu/3d.zig") else struct {};

var active_api: ?*const abi.Scene3dApiV1 = null;

pub fn install(dispatch: *const abi.Scene3dApiV1) void {
    if (!modular_core) return;
    active_api = dispatch;
}

pub fn clear() void {
    if (!modular_core) return;
    active_api = null;
}

pub fn installed() ?*const abi.Scene3dApiV1 {
    return active_api;
}

fn api() ?*const abi.Scene3dApiV1 {
    return active_api;
}

pub const SKIN_POOL: usize = if (modular_core) 8 else implementation.SKIN_POOL;

pub const DetachedTarget = if (modular_core) struct {
    handle: u64 = 0,

    pub fn deinit(self: *@This()) void {
        if (api()) |dispatch| dispatch.release_detached(&self.handle);
        self.handle = 0;
    }
} else implementation.DetachedTarget;

pub const CharacterRigGizmoCommit = struct {
    bone_index: u32,
    pos: [3]f32,
    rot: [4]f32,
    scale: [3]f32,
};

pub fn render(io: std.Io, environ: *const std.process.Environ.Map, node: *Node, x: f32, y: f32, w: f32, h: f32, opacity: f32) bool {
    if (!modular_core) return implementation.render(io, environ, node, x, y, w, h, opacity);
    const dispatch = api() orelse return false;
    return dispatch.render(&io, environ, node, x, y, w, h, opacity);
}

pub fn renderDetached(io: std.Io, environ: *const std.process.Environ.Map, target: *DetachedTarget, node: *Node, w: f32, h: f32) ?*wgpu.TextureView {
    if (!modular_core) return implementation.renderDetached(io, environ, target, node, w, h);
    const dispatch = api() orelse return null;
    return @ptrCast(@alignCast(dispatch.render_detached(&io, environ, &target.handle, node, w, h) orelse return null));
}

pub fn update(dt_seconds: f32) void {
    if (!modular_core) return implementation.update(dt_seconds);
    if (api()) |dispatch| dispatch.update(dt_seconds);
}

pub fn flushPending(io: std.Io, environ: *const std.process.Environ.Map) void {
    if (!modular_core) return implementation.flushPending(io, environ);
    if (api()) |dispatch| dispatch.flush_pending(&io, environ);
}

/// Per-frame draw counters. The modular core keeps NO scene3d globals, so
/// reading `gpu/3d.zig` directly from the core would return a permanently-zero
/// dead copy (the status bar's TRI/DC read 0 for exactly that reason). Every
/// core-side consumer goes through here.
pub fn telemetryStats() abi.Scene3dTelemetryV1 {
    if (!modular_core) {
        const s = implementation.telemetryStats();
        return .{
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
    var out = abi.Scene3dTelemetryV1{};
    const dispatch = api() orelse return out;
    dispatch.telemetry_stats(&out);
    return out;
}

/// Scene3D's memory-popover rows — same dead-copy hazard as `telemetryStats`.
pub fn memoryStats() abi.Scene3dMemoryV1 {
    if (!modular_core) {
        const gpu3d = implementation.gpuMemoryStats();
        const instances = implementation.staticInstanceMemoryStats();
        return .{
            .retained_geometry_bytes = implementation.retainedGeometryBytes(),
            .host_stash_bytes = implementation.hostStashBytes(),
            .core_buffer_capacity_bytes = gpu3d.core_buffer_capacity_bytes,
            .render_target_bytes = gpu3d.render_target_bytes,
            .diffuse_texture_bytes = gpu3d.diffuse_texture_bytes,
            .static_standard_used_bytes = instances.standard_used_bytes,
            .static_standard_capacity_bytes = instances.standard_capacity_bytes,
            .static_slim_used_bytes = instances.slim_used_bytes,
            .static_slim_capacity_bytes = instances.slim_capacity_bytes,
        };
    }
    var out = abi.Scene3dMemoryV1{};
    const dispatch = api() orelse return out;
    dispatch.memory_stats(&out);
    return out;
}

pub fn frameCleanup() void {
    if (!modular_core) return implementation.frameCleanup();
    if (api()) |dispatch| dispatch.frame_cleanup();
}

pub fn resetForReload() void {
    if (!modular_core) return implementation.resetForReload();
    if (api()) |dispatch| dispatch.reset_for_reload();
}

pub fn deinit() void {
    if (!modular_core) return implementation.deinit();
    if (api()) |dispatch| dispatch.deinit_scene();
}

pub fn getTexBindGroupLayout() ?*wgpu.BindGroupLayout {
    if (!modular_core) return implementation.getTexBindGroupLayout();
    const raw = (api() orelse return null).texture_bind_group_layout() orelse return null;
    return @ptrCast(@alignCast(raw));
}

pub fn getDiffuseSampler() ?*wgpu.Sampler {
    if (!modular_core) return implementation.getDiffuseSampler();
    const raw = (api() orelse return null).diffuse_sampler() orelse return null;
    return @ptrCast(@alignCast(raw));
}

pub fn getUvSamplingUniform(finite_atlas: bool) ?*wgpu.Buffer {
    if (!modular_core) return implementation.getUvSamplingUniform(finite_atlas);
    const raw = (api() orelse return null).uv_sampling_uniform(finite_atlas) orelse return null;
    return @ptrCast(@alignCast(raw));
}

pub fn meshEditCapturing() bool {
    if (!modular_core) return implementation.meshEditCapturing();
    return if (api()) |dispatch| dispatch.mesh_edit_capturing() else false;
}

pub fn meshEditFocusTool() bool {
    if (!modular_core) return implementation.meshEditFocusTool();
    return if (api()) |dispatch| dispatch.mesh_edit_focus_tool() else false;
}

pub fn meshEditModeRaw() u8 {
    if (!modular_core) return implementation.meshEditModeRaw();
    return if (api()) |dispatch| dispatch.mesh_edit_mode() else 0;
}

pub fn orbitDrag(dx: f32, dy: f32) void {
    if (!modular_core) return implementation.orbitDrag(dx, dy);
    if (api()) |dispatch| dispatch.orbit_drag(dx, dy);
}

pub fn orbitPan(dx: f32, dy: f32) void {
    if (!modular_core) return implementation.orbitPan(dx, dy);
    if (api()) |dispatch| dispatch.orbit_pan(dx, dy);
}

pub fn orbitZoom(delta: f32) void {
    if (!modular_core) return implementation.orbitZoom(delta);
    if (api()) |dispatch| dispatch.orbit_zoom(delta);
}

pub fn focusAt(x: f32, y: f32) bool {
    if (!modular_core) return implementation.focusAt(x, y);
    return if (api()) |dispatch| dispatch.focus_at(x, y) else false;
}

pub fn meshEditPick(x: f32, y: f32, additive: bool) i32 {
    if (!modular_core) return implementation.meshEditPick(x, y, additive);
    return if (api()) |dispatch| dispatch.mesh_pick(x, y, additive) else -1;
}

pub fn meshEditOutOfScopePartAt(x: f32, y: f32) i32 {
    if (!modular_core) return implementation.meshEditOutOfScopePartAt(x, y);
    return if (api()) |dispatch| dispatch.mesh_out_of_scope_part_at(x, y) else -1;
}

pub fn meshEditBox(x0: f32, y0: f32, x1: f32, y1: f32, additive: bool) i32 {
    if (!modular_core) return implementation.meshEditBox(x0, y0, x1, y1, additive);
    return if (api()) |dispatch| dispatch.mesh_box(x0, y0, x1, y1, additive) else -1;
}

pub fn meshEditSelectAll() i32 {
    if (!modular_core) return implementation.meshEditSelectAll();
    return if (api()) |dispatch| dispatch.mesh_select_all() else -1;
}

pub fn meshEditSnapshot() void {
    if (!modular_core) return implementation.meshEditSnapshot();
    if (api()) |dispatch| dispatch.mesh_snapshot();
}

pub fn meshEditRevert() void {
    if (!modular_core) return implementation.meshEditRevert();
    if (api()) |dispatch| dispatch.mesh_revert();
}

pub fn meshGizmoHit(x: f32, y: f32) i32 {
    if (!modular_core) return implementation.meshGizmoHit(x, y);
    return if (api()) |dispatch| dispatch.mesh_gizmo_hit(x, y) else -1;
}

pub fn meshGizmoBegin() void {
    if (!modular_core) return implementation.meshGizmoBegin();
    if (api()) |dispatch| dispatch.mesh_gizmo_begin();
}

pub fn meshGizmoGrabAt(x: f32, y: f32, code: i32) void {
    if (!modular_core) return implementation.meshGizmoGrabAt(x, y, code);
    if (api()) |dispatch| dispatch.mesh_gizmo_grab_at(x, y, code);
}

pub fn meshGizmoDrag(axis: i32, dx: f32, dy: f32, fine: bool, freeform: bool, vertex_snap: bool) bool {
    if (!modular_core) return implementation.meshGizmoDrag(axis, dx, dy, fine, freeform, vertex_snap);
    return if (api()) |dispatch| dispatch.mesh_gizmo_drag(axis, dx, dy, fine, freeform, vertex_snap) else false;
}

pub fn meshGizmoFinish() bool {
    if (!modular_core) return implementation.meshGizmoFinish();
    return if (api()) |dispatch| dispatch.mesh_gizmo_finish() else false;
}

pub fn bdGizmoHit(x: f32, y: f32) i32 {
    if (!modular_core) return implementation.bdGizmoHit(x, y);
    return if (api()) |dispatch| dispatch.backdrop_gizmo_hit(x, y) else -1;
}

pub fn bdGizmoBegin(code: i32) void {
    if (!modular_core) return implementation.bdGizmoBegin(code);
    if (api()) |dispatch| dispatch.backdrop_gizmo_begin(code);
}

pub fn bdGizmoDrag(dx: f32, dy: f32, fine: bool, freeform: bool) bool {
    if (!modular_core) return implementation.bdGizmoDrag(dx, dy, fine, freeform);
    return if (api()) |dispatch| dispatch.backdrop_gizmo_drag(dx, dy, fine, freeform) else false;
}

pub fn bdGizmoFinish() void {
    if (!modular_core) return implementation.bdGizmoFinish();
    if (api()) |dispatch| dispatch.backdrop_gizmo_finish();
}

pub fn meshLcActive() bool {
    if (!modular_core) return implementation.meshLcActive();
    return if (api()) |dispatch| dispatch.loop_cut_active() else false;
}

pub fn meshLcHandleHit(x: f32, y: f32) bool {
    if (!modular_core) return implementation.meshLcHandleHit(x, y);
    return if (api()) |dispatch| dispatch.loop_cut_handle_hit(x, y) else false;
}

pub fn meshLcHandleDrag(dx: f32, dy: f32, snap: bool) bool {
    if (!modular_core) return implementation.meshLcHandleDrag(dx, dy, snap);
    return if (api()) |dispatch| dispatch.loop_cut_handle_drag(dx, dy, snap) else false;
}

pub fn meshCompassHit(x: f32, y: f32) i32 {
    if (!modular_core) return implementation.meshCompassHit(x, y);
    return if (api()) |dispatch| dispatch.compass_hit(x, y) else -1;
}

pub fn meshCompassSnap(code: i32) bool {
    if (!modular_core) return implementation.meshCompassSnap(code);
    return if (api()) |dispatch| dispatch.compass_snap(code) else false;
}

pub fn drawEditorOverlay(x: f32, y: f32) void {
    if (!modular_core) return implementation.drawEditorOverlay(x, y);
    if (api()) |dispatch| dispatch.draw_editor_overlay(x, y);
}

pub fn meshSetMarquee(x0: f32, y0: f32, x1: f32, y1: f32) void {
    if (!modular_core) return implementation.meshSetMarquee(x0, y0, x1, y1);
    if (api()) |dispatch| dispatch.mesh_set_marquee(x0, y0, x1, y1);
}

pub fn meshClearMarquee() void {
    if (!modular_core) return implementation.meshClearMarquee();
    if (api()) |dispatch| dispatch.mesh_clear_marquee();
}

pub fn characterRigActive() bool {
    if (!modular_core) return implementation.characterRigActive();
    return if (api()) |dispatch| dispatch.character_rig_active() else false;
}

pub fn characterRigGizmoHit(x: f32, y: f32) i32 {
    if (!modular_core) return implementation.characterRigGizmoHit(x, y);
    return if (api()) |dispatch| dispatch.character_rig_gizmo_hit(x, y) else -1;
}

pub fn characterRigGizmoBegin(code: i32) bool {
    if (!modular_core) return implementation.characterRigGizmoBegin(code);
    return if (api()) |dispatch| dispatch.character_rig_gizmo_begin(code) else false;
}

pub fn characterRigGizmoDrag(dx: f32, dy: f32, fine: bool) bool {
    if (!modular_core) return implementation.characterRigGizmoDrag(dx, dy, fine);
    return if (api()) |dispatch| dispatch.character_rig_gizmo_drag(dx, dy, fine) else false;
}

pub fn characterRigGizmoEnd() ?CharacterRigGizmoCommit {
    if (!modular_core) {
        const result = implementation.characterRigGizmoEnd() orelse return null;
        return .{ .bone_index = result.bone_index, .pos = result.pos, .rot = result.rot, .scale = result.scale };
    }
    const result = if (api()) |dispatch| dispatch.character_rig_gizmo_end() else return null;
    if (!result.valid) return null;
    return .{ .bone_index = result.bone_index, .pos = result.pos, .rot = result.rot, .scale = result.scale };
}
