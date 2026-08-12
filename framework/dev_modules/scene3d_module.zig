//! Replaceable Scene3D development library.

const std = @import("std");
const wgpu = @import("wgpu");
const abi = @import("dev_module_abi");
const Node = @import("../layout.zig").Node;
const HostContext = @import("../host_context.zig");
const scene3d = @import("../gpu/3d.zig");
const meshdoc_format = @import("../gpu/meshdoc_format.zig");
const bindings = @import("../v8_bindings_scene3d.zig");
const gpu_api = @import("gpu_api.zig");
const v8_runtime_api = @import("v8_runtime_api.zig");
const dirty_api = @import("dirty_api.zig");
const host_tree_api = @import("host_tree_api.zig");

const SNAPSHOT_SCHEMA_VERSION: u32 = 1;
var owner_io: ?std.Io = null;

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
    owner_io = io;
    const environ = processEnviron(environ_raw) orelse return false;
    const node: *Node = @ptrCast(@alignCast(node_raw orelse return false));
    return scene3d.render(io, environ, node, x, y, width, height, opacity);
}

fn renderDetached(io_raw: ?*const anyopaque, environ_raw: ?*const anyopaque, target_handle: *u64, node_raw: ?*anyopaque, width: f32, height: f32) callconv(.c) ?*anyopaque {
    const io = frameIo(io_raw) orelse return null;
    owner_io = io;
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
fn meshPathPick(x: f32, y: f32, additive: bool) callconv(.c) i32 {
    return scene3d.meshEditPathPick(x, y, additive);
}
fn meshSelectionCount() callconv(.c) u32 {
    return scene3d.meshEditSelectionCount();
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

fn sceneStatusFromJson(payload: []const u8) abi.SceneCallCodeV1 {
    if (std.mem.indexOf(u8, payload, "\"ok\":true") != null) return .ok;
    const mappings = [_]struct { text: []const u8, code: abi.SceneCallCodeV1 }{
        .{ .text = "\"code\":\"invalid_request\"", .code = .invalid_request },
        .{ .text = "\"code\":\"wrong_model\"", .code = .wrong_model },
        .{ .text = "\"code\":\"no_resident_session\"", .code = .no_resident_session },
        .{ .text = "\"code\":\"object_ids_unpublished\"", .code = .object_ids_unpublished },
        .{ .text = "\"code\":\"stale_generation\"", .code = .stale_generation },
        .{ .text = "\"code\":\"released_capability\"", .code = .released_capability },
        .{ .text = "\"code\":\"lease_refused\"", .code = .lease_refused },
        .{ .text = "\"code\":\"authorization_failed\"", .code = .lease_refused },
        .{ .text = "\"code\":\"module_unavailable\"", .code = .module_unavailable },
        .{ .text = "\"code\":\"analysis_pending\"", .code = .analysis_pending },
    };
    for (mappings) |mapping| if (std.mem.indexOf(u8, payload, mapping.text) != null) return mapping.code;
    return .internal_error;
}

fn finishSceneJson(sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1, payload: []const u8) bool {
    status.* = .{
        .code = sceneStatusFromJson(payload),
        .flags = @intFromBool(std.mem.indexOf(u8, payload, "\"identityQuality\":\"degraded\"") != null),
        .current_generation = scene3d.meshEditGeneration(),
        .receipt_id = 0,
    };
    return sink.append(payload);
}

fn failSceneJson(sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1, detail: []const u8) bool {
    status.* = .{ .code = .internal_error, .current_generation = scene3d.meshEditGeneration() };
    const payload = std.json.Stringify.valueAlloc(std.heap.c_allocator, .{
        .ok = false,
        .version = 1,
        .code = "internal_error",
        .detail = detail,
    }, .{}) catch return true;
    defer std.heap.c_allocator.free(payload);
    return sink.append(payload);
}

fn sessionPublishObjectIds(request: [*]const u8, request_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const payload = scene3d.meshPublishObjectIdsJsonAlloc(std.heap.c_allocator, request[0..request_len]) catch
        return failSceneJson(sink, status, "object-id publication failed");
    defer std.heap.c_allocator.free(payload);
    return finishSceneJson(sink, status, payload);
}

fn sessionIdentity(request: [*]const u8, request_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const payload = scene3d.meshSessionIdentityJsonAlloc(std.heap.c_allocator, request[0..request_len]) catch
        return failSceneJson(sink, status, "session identity failed");
    defer std.heap.c_allocator.free(payload);
    return finishSceneJson(sink, status, payload);
}

fn faceTable(request: [*]const u8, request_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const io = owner_io orelse {
        status.* = .{ .code = .module_unavailable };
        return sink.append("{\"ok\":false,\"version\":1,\"code\":\"module_unavailable\",\"detail\":\"Scene3D owner has not rendered yet\"}");
    };
    const payload = scene3d.meshFaceTableJsonAlloc(io, std.heap.c_allocator, request[0..request_len]) catch
        return failSceneJson(sink, status, "face table failed");
    defer std.heap.c_allocator.free(payload);
    return finishSceneJson(sink, status, payload);
}

fn faceAnalysisReady(_: [*]const u8, _: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const io = owner_io orelse {
        status.* = .{
            .code = .analysis_pending,
            .current_generation = scene3d.meshEditGeneration(),
        };
        return true;
    };
    const maybe_payload = scene3d.meshFaceAnalysisReadyJsonAlloc(io, std.heap.c_allocator) catch {
        status.* = .{
            .code = .internal_error,
            .current_generation = scene3d.meshEditGeneration(),
        };
        return true;
    };
    const payload = maybe_payload orelse {
        status.* = .{
            .code = .analysis_pending,
            .current_generation = scene3d.meshEditGeneration(),
        };
        return true;
    };
    defer std.heap.c_allocator.free(payload);
    return finishSceneJson(sink, status, payload);
}

fn faceSelect(request: [*]const u8, request_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const io = owner_io orelse {
        status.* = .{ .code = .module_unavailable };
        return sink.append("{\"ok\":false,\"version\":1,\"code\":\"module_unavailable\",\"detail\":\"Scene3D owner has not rendered yet\"}");
    };
    const payload = scene3d.meshFaceSelectJsonAlloc(io, std.heap.c_allocator, request[0..request_len]) catch
        return failSceneJson(sink, status, "face selection failed");
    defer std.heap.c_allocator.free(payload);
    return finishSceneJson(sink, status, payload);
}

fn faceSeek(request: [*]const u8, request_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const io = owner_io orelse {
        status.* = .{ .code = .module_unavailable };
        return sink.append("{\"ok\":false,\"version\":1,\"code\":\"module_unavailable\",\"detail\":\"Scene3D owner has not rendered yet\"}");
    };
    const payload = scene3d.meshFaceSeekJsonAlloc(io, std.heap.c_allocator, request[0..request_len]) catch
        return failSceneJson(sink, status, "face seek failed");
    defer std.heap.c_allocator.free(payload);
    return finishSceneJson(sink, status, payload);
}

fn previewOpen(request: [*]const u8, request_len: usize, bytes: [*]const u8, bytes_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const payload = scene3d.historicalPreviewOpenJsonAlloc(
        std.heap.c_allocator,
        request[0..request_len],
        bytes[0..bytes_len],
    ) catch return failSceneJson(sink, status, "historical preview open failed");
    defer std.heap.c_allocator.free(payload);
    const transported = finishSceneJson(sink, status, payload);
    if (!transported and status.code == .ok) {
        const Receipt = struct { previewToken: []const u8 };
        var receipt = std.json.parseFromSlice(Receipt, std.heap.c_allocator, payload, .{}) catch return false;
        defer receipt.deinit();
        const release_request = std.json.Stringify.valueAlloc(std.heap.c_allocator, .{
            .version = 1,
            .operation = "release",
            .previewToken = receipt.value.previewToken,
        }, .{}) catch return false;
        defer std.heap.c_allocator.free(release_request);
        const release_payload = scene3d.historicalPreviewReleaseJsonAlloc(std.heap.c_allocator, release_request) catch return false;
        std.heap.c_allocator.free(release_payload);
    }
    return transported;
}

fn previewSelect(request: [*]const u8, request_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    return faceSelect(request, request_len, sink, status);
}

fn previewRelease(request: [*]const u8, request_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const payload = scene3d.historicalPreviewReleaseJsonAlloc(std.heap.c_allocator, request[0..request_len]) catch
        return failSceneJson(sink, status, "historical preview release failed");
    defer std.heap.c_allocator.free(payload);
    return finishSceneJson(sink, status, payload);
}

fn receiptIdFromJson(payload: []const u8, field_name: []const u8) u64 {
    var parsed = std.json.parseFromSlice(std.json.Value, std.heap.c_allocator, payload, .{}) catch return 0;
    defer parsed.deinit();
    const object = switch (parsed.value) {
        .object => |value| value,
        else => return 0,
    };
    const value = object.get(field_name) orelse return 0;
    return switch (value) {
        .integer => |number| if (number > 0) @intCast(number) else 0,
        else => 0,
    };
}

fn leaseAcquire(request: [*]const u8, request_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const payload = scene3d.modelWriteLeaseAcquireJsonAlloc(std.heap.c_allocator, request[0..request_len]) catch
        return failSceneJson(sink, status, "model-write lease acquire failed");
    defer std.heap.c_allocator.free(payload);
    const transported = finishSceneJson(sink, status, payload);
    if (status.code == .ok) status.receipt_id = receiptIdFromJson(payload, "receiptId");
    return transported;
}

fn leaseRelease(request: [*]const u8, request_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const payload = scene3d.modelWriteLeaseReleaseJsonAlloc(std.heap.c_allocator, request[0..request_len]) catch
        return failSceneJson(sink, status, "model-write lease release failed");
    defer std.heap.c_allocator.free(payload);
    return finishSceneJson(sink, status, payload);
}

fn documentAdopt(request: [*]const u8, request_len: usize, bytes: [*]const u8, bytes_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const payload = scene3d.modelDocumentAdoptBytesJsonAlloc(
        std.heap.c_allocator,
        request[0..request_len],
        bytes[0..bytes_len],
    ) catch return failSceneJson(sink, status, "document adoption failed");
    defer std.heap.c_allocator.free(payload);
    const transported = finishSceneJson(sink, status, payload);
    if (status.code == .ok) status.receipt_id = receiptIdFromJson(payload, "adoptionReceiptId");
    return transported;
}

fn documentRollback(request: [*]const u8, request_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const payload = scene3d.modelDocumentRollbackJsonAlloc(std.heap.c_allocator, request[0..request_len]) catch
        return failSceneJson(sink, status, "document rollback failed");
    defer std.heap.c_allocator.free(payload);
    const transported = finishSceneJson(sink, status, payload);
    if (status.code == .ok) status.receipt_id = receiptIdFromJson(payload, "adoptionReceiptId");
    return transported;
}

fn fieldCandidate(request: [*]const u8, request_len: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    const payload = scene3d.modelFieldCandidateJsonAlloc(
        std.heap.c_allocator,
        request[0..request_len],
    ) catch return failSceneJson(sink, status, "guarded field candidate failed");
    defer std.heap.c_allocator.free(payload);
    return finishSceneJson(sink, status, payload);
}

fn documentFinalize(
    lease_receipt_id: u64,
    adoption_receipt_id: u64,
    target_sha256_ptr: [*]const u8,
    target_sha256_len: usize,
    receipt: *abi.SceneAdoptionFinalizeReceiptV1,
    status: *abi.SceneCallStatusV1,
) callconv(.c) bool {
    receipt.* = .{};
    status.* = .{ .code = .invalid_request, .current_generation = scene3d.meshEditGeneration() };
    if (lease_receipt_id == 0 or adoption_receipt_id == 0 or target_sha256_len != 64) return true;
    const target_text = target_sha256_ptr[0..target_sha256_len];
    for (target_text) |byte| {
        if (!std.ascii.isDigit(byte) and !(byte >= 'a' and byte <= 'f')) return true;
    }
    var target_sha256: [64]u8 = undefined;
    @memcpy(&target_sha256, target_text);
    const finalized = scene3d.modelDocumentFinalize(
        lease_receipt_id,
        adoption_receipt_id,
        target_sha256,
    ) catch |err| {
        status.code = switch (err) {
            error.WrongTarget => .invalid_request,
            error.NoActiveReceipt, error.WrongReceipt, error.WrongLease, error.NoActiveLease => .lease_refused,
            else => .internal_error,
        };
        return true;
    };
    receipt.* = .{
        .finalized = @intFromBool(finalized.finalized),
        .already_finalized = @intFromBool(finalized.already_finalized),
        .released = @intFromBool(finalized.released),
        .already_released = @intFromBool(finalized.already_released),
    };
    status.* = .{
        .code = .ok,
        .current_generation = scene3d.meshEditGeneration(),
        .receipt_id = adoption_receipt_id,
    };
    return true;
}

fn unregisteredJsonCall(_: [*]const u8, _: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    status.* = .{ .code = .invalid_request };
    return sink.append("{\"ok\":false,\"version\":1,\"code\":\"invalid_request\",\"detail\":\"field_candidate_not_registered\"}");
}

fn unregisteredBytesCall(_: [*]const u8, _: usize, _: [*]const u8, _: usize, sink: *const abi.SnapshotSinkV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    status.* = .{ .code = .invalid_request };
    return sink.append("{\"ok\":false,\"version\":1,\"code\":\"invalid_request\",\"detail\":\"diff_not_registered\"}");
}

fn validateEncodeIdentity(
    model_id: []const u8,
    session_token: []const u8,
    expected_generation: u64,
    status: *abi.SceneCallStatusV1,
) bool {
    const current_generation = scene3d.meshEditGeneration();
    status.* = .{ .code = .internal_error, .current_generation = current_generation };
    if (!scene3d.modelSessionResident()) {
        status.code = .no_resident_session;
        return false;
    }
    const parsed_token = std.fmt.parseInt(u32, session_token, 10) catch {
        status.code = .wrong_model;
        return false;
    };
    if (parsed_token != scene3d.modelSessionActiveToken() or scene3d.modelDocumentTokenForId(model_id) != parsed_token) {
        status.code = .wrong_model;
        return false;
    }
    if (expected_generation != current_generation) {
        status.code = .stale_generation;
        return false;
    }
    return true;
}

fn hashIdentity(meta: *abi.RecoverySnapshotMetaV1, model_id: []const u8, session_token: []const u8) void {
    std.crypto.hash.sha2.Sha256.hash(model_id, &meta.model_id_hash, .{});
    std.crypto.hash.sha2.Sha256.hash(session_token, &meta.session_token_hash, .{});
}

fn finishEncodeRefusal(sink: *const abi.SnapshotSinkV1, status: *const abi.SceneCallStatusV1) bool {
    return sink.append(switch (status.code) {
        .wrong_model => "{\"ok\":false,\"version\":1,\"code\":\"wrong_model\",\"detail\":\"modelId/sessionToken do not identify the resident Scene3D session\"}",
        .no_resident_session => "{\"ok\":false,\"version\":1,\"code\":\"no_resident_session\",\"detail\":\"the requested model has no resident Scene3D session\"}",
        .object_ids_unpublished => "{\"ok\":false,\"version\":1,\"code\":\"object_ids_unpublished\",\"detail\":\"stable object IDs have not been published for the resident document\"}",
        .stale_generation => "{\"ok\":false,\"version\":1,\"code\":\"stale_generation\",\"detail\":\"expectedGeneration does not match the resident mesh generation\"}",
        .module_unavailable => "{\"ok\":false,\"version\":1,\"code\":\"module_unavailable\",\"detail\":\"Scene3D module is unavailable\"}",
        else => "{\"ok\":false,\"version\":1,\"code\":\"internal_error\",\"detail\":\"Scene3D document encoding failed\"}",
    });
}

fn documentEncodeCurrent(model_id_ptr: [*]const u8, model_id_len: usize, session_ptr: [*]const u8, session_len: usize, expected_generation: u64, sink: *const abi.SnapshotSinkV1, meta: *abi.RecoverySnapshotMetaV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    meta.* = .{};
    const model_id = model_id_ptr[0..model_id_len];
    const session_token = session_ptr[0..session_len];
    if (!validateEncodeIdentity(model_id, session_token, expected_generation, status))
        return finishEncodeRefusal(sink, status);
    const bytes = scene3d.modelEncodeCurrentDocumentAlloc(std.heap.c_allocator, model_id) catch |err| {
        status.code = switch (err) {
            error.NoResidentDocument => .no_resident_session,
            error.ObjectIdsUnpublished => .object_ids_unpublished,
            error.WrongModel => .wrong_model,
            else => .internal_error,
        };
        return finishEncodeRefusal(sink, status);
    };
    defer std.heap.c_allocator.free(bytes);
    var document = meshdoc_format.decodeDocument(std.heap.c_allocator, bytes) catch {
        status.code = .internal_error;
        return finishEncodeRefusal(sink, status);
    };
    defer document.deinit(std.heap.c_allocator);
    meta.* = .{
        .rjmd_version = document.version,
        .generation = expected_generation,
        .byte_len = bytes.len,
        .triangle_count = document.verts.len / 24,
        .authored_face_count = meshdoc_format.authoredFaceCount(document.verts.len / 24, document.groups),
        .part_count = @intCast(document.ranges.len / 2),
        .logical_vertex_count = document.logical_vertex_count,
    };
    std.crypto.hash.sha2.Sha256.hash(bytes, &meta.sha256, .{});
    hashIdentity(meta, model_id, session_token);
    const empty_ids = [_][]const u8{};
    const object_ids: []const []const u8 = if (document.range_object_ids) |ids| ids else &empty_ids;
    meta.object_namespace_hash = meshdoc_format.objectNamespaceDigest(model_id, object_ids, document.ranges);
    status.* = .{ .code = .ok, .current_generation = expected_generation };
    return sink.append(bytes);
}

fn captureRecovery(model_id_ptr: [*]const u8, model_id_len: usize, session_ptr: [*]const u8, session_len: usize, expected_generation: u64, sink: *const abi.SnapshotSinkV1, meta: *abi.RecoverySnapshotMetaV1, status: *abi.SceneCallStatusV1) callconv(.c) bool {
    meta.* = .{};
    const model_id = model_id_ptr[0..model_id_len];
    const session_token = session_ptr[0..session_len];
    if (!validateEncodeIdentity(model_id, session_token, expected_generation, status))
        return finishEncodeRefusal(sink, status);
    var artifact = scene3d.captureRecoveryArtifactAlloc(std.heap.c_allocator, model_id) catch {
        status.code = .internal_error;
        return finishEncodeRefusal(sink, status);
    };
    defer artifact.deinit(std.heap.c_allocator);
    if (artifact.generation != expected_generation or scene3d.meshEditGeneration() != expected_generation) {
        status.* = .{ .code = .stale_generation, .current_generation = scene3d.meshEditGeneration() };
        return finishEncodeRefusal(sink, status);
    }
    meta.* = .{
        .rjmd_version = artifact.rjmd_version,
        .generation = artifact.generation,
        .byte_len = artifact.bytes.len,
        .triangle_count = artifact.triangle_count,
        .authored_face_count = artifact.authored_face_count,
        .part_count = artifact.part_count,
        .logical_vertex_count = artifact.logical_vertex_count,
        .sha256 = artifact.sha256,
        .object_namespace_hash = artifact.object_namespace_hash,
        .identity_quality = artifact.identity_quality,
        .degradation_count = artifact.degradation_count,
    };
    hashIdentity(meta, model_id, session_token);
    for (artifact.degradations[0..artifact.degradation_count], 0..) |row, index| {
        meta.degradations[index] = .{
            .channel = @enumFromInt(@intFromEnum(row.channel) + 1),
            .action_bits = row.action_bits,
            .reason_bits = row.reason_bits,
            .affected_count = row.affected_count,
        };
    }
    status.* = .{
        .code = .ok,
        .flags = @intFromBool(artifact.identity_quality == 1),
        .current_generation = artifact.generation,
    };
    return sink.append(artifact.bytes);
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
    .session_publish_object_ids = sessionPublishObjectIds,
    .session_identity = sessionIdentity,
    .document_encode_current = documentEncodeCurrent,
    .face_table = faceTable,
    .face_analysis_ready = faceAnalysisReady,
    .face_diff = unregisteredBytesCall,
    .face_select = faceSelect,
    .face_seek = faceSeek,
    .preview_open = previewOpen,
    .preview_select = previewSelect,
    .preview_release = previewRelease,
    .capture_recovery = captureRecovery,
    .lease_acquire = leaseAcquire,
    .lease_release = leaseRelease,
    .field_candidate = fieldCandidate,
    .document_adopt = documentAdopt,
    .document_rollback = documentRollback,
    .document_finalize = documentFinalize,
    .mesh_path_pick = meshPathPick,
    .mesh_selection_count = meshSelectionCount,
};

pub fn descriptor() *const abi.ModuleHeaderV1 {
    return &module_api.header;
}
