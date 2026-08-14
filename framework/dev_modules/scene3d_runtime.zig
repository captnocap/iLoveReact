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
const meshdoc_format = @import("../gpu/meshdoc_format.zig");

const modular_core = build_options.dev_native_modules and !build_options.dev_scene3d_module;
const implementation = if (!modular_core) @import("../gpu/scene3d/root.zig") else struct {};

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

pub const RecoveryCallResult = struct {
    json: []u8,
    status: abi.SceneCallStatusV1,

    pub fn deinit(self: *RecoveryCallResult, allocator: std.mem.Allocator) void {
        allocator.free(self.json);
        self.* = undefined;
    }
};

pub const RecoveryCaptureResult = struct {
    bytes: []u8,
    meta: abi.RecoverySnapshotMetaV1,
    status: abi.SceneCallStatusV1,

    pub fn deinit(self: *RecoveryCaptureResult, allocator: std.mem.Allocator) void {
        allocator.free(self.bytes);
        self.* = undefined;
    }
};

const RecoverySink = struct {
    allocator: std.mem.Allocator,
    bytes: std.ArrayList(u8) = .empty,

    fn write(raw: ?*anyopaque, ptr: [*]const u8, len: usize) callconv(.c) bool {
        const self: *RecoverySink = @ptrCast(@alignCast(raw orelse return false));
        self.bytes.appendSlice(self.allocator, ptr[0..len]) catch return false;
        return true;
    }
};

fn statusFromDirectJson(json: []const u8) abi.SceneCallStatusV1 {
    var status = abi.SceneCallStatusV1{ .code = .internal_error };
    if (std.mem.indexOf(u8, json, "\"ok\":true") != null) status.code = .ok else if (std.mem.indexOf(u8, json, "\"code\":\"released_capability\"") != null) status.code = .released_capability else if (std.mem.indexOf(u8, json, "\"code\":\"wrong_model\"") != null) status.code = .wrong_model else if (std.mem.indexOf(u8, json, "\"code\":\"no_resident_session\"") != null) status.code = .no_resident_session else if (std.mem.indexOf(u8, json, "\"code\":\"object_ids_unpublished\"") != null) status.code = .object_ids_unpublished else if (std.mem.indexOf(u8, json, "\"code\":\"stale_generation\"") != null) status.code = .stale_generation else if (std.mem.indexOf(u8, json, "\"code\":\"hash_mismatch\"") != null) status.code = .invalid_request else if (std.mem.indexOf(u8, json, "\"code\":\"lease_refused\"") != null or std.mem.indexOf(u8, json, "\"code\":\"authorization_failed\"") != null) status.code = .lease_refused else if (std.mem.indexOf(u8, json, "\"code\":\"invalid_request\"") != null) status.code = .invalid_request;
    status.flags = @intFromBool(std.mem.indexOf(u8, json, "\"identityQuality\":\"degraded\"") != null);
    return status;
}

fn invokeJsonAlloc(
    allocator: std.mem.Allocator,
    request_json: []const u8,
    callback: abi.SceneJsonCallV1,
) !RecoveryCallResult {
    var collector = RecoverySink{ .allocator = allocator };
    errdefer collector.bytes.deinit(allocator);
    const sink = abi.SnapshotSinkV1{ .context = &collector, .write = RecoverySink.write };
    var status = abi.SceneCallStatusV1{};
    if (!callback(request_json.ptr, request_json.len, &sink, &status)) return error.Scene3dTransportFailed;
    return .{ .json = try collector.bytes.toOwnedSlice(allocator), .status = status };
}

fn invokeBytesJsonAlloc(
    allocator: std.mem.Allocator,
    request_json: []const u8,
    bytes: []const u8,
    callback: abi.SceneBytesJsonCallV1,
) !RecoveryCallResult {
    var collector = RecoverySink{ .allocator = allocator };
    errdefer collector.bytes.deinit(allocator);
    const sink = abi.SnapshotSinkV1{ .context = &collector, .write = RecoverySink.write };
    var status = abi.SceneCallStatusV1{};
    if (!callback(request_json.ptr, request_json.len, bytes.ptr, bytes.len, &sink, &status)) return error.Scene3dTransportFailed;
    return .{ .json = try collector.bytes.toOwnedSlice(allocator), .status = status };
}

fn invokeEncodeAlloc(
    allocator: std.mem.Allocator,
    model_id: []const u8,
    session_token: []const u8,
    expected_generation: u64,
    callback: abi.SceneEncodeCurrentV1,
) !RecoveryCaptureResult {
    var collector = RecoverySink{ .allocator = allocator };
    errdefer collector.bytes.deinit(allocator);
    const sink = abi.SnapshotSinkV1{ .context = &collector, .write = RecoverySink.write };
    var meta = abi.RecoverySnapshotMetaV1{};
    var status = abi.SceneCallStatusV1{};
    if (!callback(
        model_id.ptr,
        model_id.len,
        session_token.ptr,
        session_token.len,
        expected_generation,
        &sink,
        &meta,
        &status,
    )) return error.Scene3dTransportFailed;
    if (status.code != .ok) {
        collector.bytes.deinit(allocator);
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = meta, .status = status };
    }
    return .{ .bytes = try collector.bytes.toOwnedSlice(allocator), .meta = meta, .status = status };
}

fn hashCaptureIdentity(
    meta: *abi.RecoverySnapshotMetaV1,
    model_id: []const u8,
    session_token: []const u8,
) void {
    std.crypto.hash.sha2.Sha256.hash(model_id, &meta.model_id_hash, .{});
    std.crypto.hash.sha2.Sha256.hash(session_token, &meta.session_token_hash, .{});
}

/// Drain one completed asynchronous face analysis from the Scene3D owner.
/// The replaceable module owns the workers and their result queues, so the
/// modular core must cross this ABI door instead of reading a cold duplicate
/// of `gpu/3d.zig`. `analysis_pending` is the only successful no-event state;
/// transport and module failures remain errors.
pub fn meshFaceAnalysisReadyJsonAlloc(
    io: std.Io,
    allocator: std.mem.Allocator,
) !?[]u8 {
    if (!modular_core) return implementation.meshFaceAnalysisReadyJsonAlloc(io, allocator);

    const dispatch = api() orelse return error.Scene3dModuleUnavailable;
    var response = try invokeJsonAlloc(allocator, "{}", dispatch.face_analysis_ready);
    switch (response.status.code) {
        .analysis_pending => {
            response.deinit(allocator);
            return null;
        },
        .ok => {
            if (response.json.len == 0) {
                response.deinit(allocator);
                return error.InvalidFaceAnalysisCompletion;
            }
            return response.json;
        },
        else => {
            response.deinit(allocator);
            return error.FaceAnalysisDrainFailed;
        },
    }
}

/// Capture the live Scene3D owner's in-memory document. In modular dev builds
/// this always crosses the active module ABI; it never imports the cold core's
/// dead `gpu/3d.zig` state and it never reads package disk.
pub fn captureRecoveryAlloc(
    allocator: std.mem.Allocator,
    model_id: []const u8,
    session_token: []const u8,
    expected_generation: u64,
) !RecoveryCaptureResult {
    if (modular_core) {
        const dispatch = api() orelse return error.Scene3dModuleUnavailable;
        return invokeEncodeAlloc(
            allocator,
            model_id,
            session_token,
            expected_generation,
            dispatch.capture_recovery,
        );
    }

    var status = abi.SceneCallStatusV1{
        .code = .internal_error,
        .current_generation = implementation.meshEditGeneration(),
    };
    if (!implementation.modelSessionResident()) {
        status.code = .no_resident_session;
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = .{}, .status = status };
    }
    const parsed_token = std.fmt.parseInt(u32, session_token, 10) catch {
        status.code = .wrong_model;
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = .{}, .status = status };
    };
    if (parsed_token != implementation.modelSessionActiveToken() or
        parsed_token != implementation.modelDocumentTokenForId(model_id))
    {
        status.code = .wrong_model;
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = .{}, .status = status };
    }
    if (expected_generation != implementation.meshEditGeneration()) {
        status.code = .stale_generation;
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = .{}, .status = status };
    }

    var artifact = implementation.captureRecoveryArtifactAlloc(allocator, model_id) catch |err| {
        status.code = if (err == error.NoResidentDocument) .no_resident_session else .internal_error;
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = .{}, .status = status };
    };
    errdefer artifact.deinit(allocator);
    if (artifact.generation != expected_generation or implementation.meshEditGeneration() != expected_generation) {
        artifact.deinit(allocator);
        status = .{ .code = .stale_generation, .current_generation = implementation.meshEditGeneration() };
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = .{}, .status = status };
    }
    var meta = abi.RecoverySnapshotMetaV1{
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
    hashCaptureIdentity(&meta, model_id, session_token);
    for (artifact.degradations[0..artifact.degradation_count], 0..) |row, index| {
        meta.degradations[index] = .{
            .channel = @enumFromInt(@intFromEnum(row.channel) + 1),
            .action_bits = row.action_bits,
            .reason_bits = row.reason_bits,
            .affected_count = row.affected_count,
        };
    }
    status = .{
        .code = .ok,
        .flags = @intFromBool(artifact.identity_quality == 1),
        .current_generation = artifact.generation,
    };
    const bytes = artifact.bytes;
    return .{ .bytes = bytes, .meta = meta, .status = status };
}

/// Strict current-v5 encoder used by transactional restore. Unlike panic
/// capture it never sanitizes missing channels.
pub fn encodeCurrentAlloc(
    allocator: std.mem.Allocator,
    model_id: []const u8,
    session_token: []const u8,
    expected_generation: u64,
) !RecoveryCaptureResult {
    if (modular_core) {
        const dispatch = api() orelse return error.Scene3dModuleUnavailable;
        return invokeEncodeAlloc(
            allocator,
            model_id,
            session_token,
            expected_generation,
            dispatch.document_encode_current,
        );
    }
    var status = abi.SceneCallStatusV1{
        .code = .internal_error,
        .current_generation = implementation.meshEditGeneration(),
    };
    const parsed_token = std.fmt.parseInt(u32, session_token, 10) catch {
        status.code = .wrong_model;
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = .{}, .status = status };
    };
    if (!implementation.modelSessionResident()) {
        status.code = .no_resident_session;
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = .{}, .status = status };
    }
    if (parsed_token != implementation.modelSessionActiveToken() or
        parsed_token != implementation.modelDocumentTokenForId(model_id))
    {
        status.code = .wrong_model;
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = .{}, .status = status };
    }
    if (expected_generation != implementation.meshEditGeneration()) {
        status.code = .stale_generation;
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = .{}, .status = status };
    }
    const bytes = implementation.modelEncodeCurrentDocumentAlloc(allocator, model_id) catch {
        status.code = .internal_error;
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = .{}, .status = status };
    };
    var document = meshdoc_format.decodeDocument(allocator, bytes) catch {
        allocator.free(bytes);
        status.code = .internal_error;
        return .{ .bytes = try allocator.alloc(u8, 0), .meta = .{}, .status = status };
    };
    defer document.deinit(allocator);
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    status = .{ .code = .ok, .current_generation = implementation.meshEditGeneration() };
    var meta = abi.RecoverySnapshotMetaV1{
        .rjmd_version = document.version,
        .generation = implementation.meshEditGeneration(),
        .byte_len = bytes.len,
        .triangle_count = document.verts.len / 24,
        .authored_face_count = meshdoc_format.authoredFaceCount(document.verts.len / 24, document.groups),
        .part_count = @intCast(document.ranges.len / 2),
        .logical_vertex_count = document.logical_vertex_count,
        .sha256 = digest,
    };
    hashCaptureIdentity(&meta, model_id, session_token);
    const empty_ids = [_][]const u8{};
    const object_ids: []const []const u8 = if (document.range_object_ids) |ids| ids else &empty_ids;
    meta.object_namespace_hash = meshdoc_format.objectNamespaceDigest(model_id, object_ids, document.ranges);
    return .{
        .bytes = bytes,
        .meta = meta,
        .status = status,
    };
}

pub fn historicalPreviewOpenAlloc(
    allocator: std.mem.Allocator,
    request_json: []const u8,
    bytes: []const u8,
) !RecoveryCallResult {
    if (!modular_core) {
        const json = try implementation.historicalPreviewOpenJsonAlloc(allocator, request_json, bytes);
        return .{ .json = json, .status = statusFromDirectJson(json) };
    }
    const dispatch = api() orelse return error.Scene3dModuleUnavailable;
    return invokeBytesJsonAlloc(allocator, request_json, bytes, dispatch.preview_open);
}

pub fn historicalPreviewSelectAlloc(
    io: std.Io,
    allocator: std.mem.Allocator,
    request_json: []const u8,
) !RecoveryCallResult {
    if (!modular_core) {
        const json = try implementation.meshFaceSelectJsonAlloc(io, allocator, request_json);
        return .{ .json = json, .status = statusFromDirectJson(json) };
    }
    const dispatch = api() orelse return error.Scene3dModuleUnavailable;
    return invokeJsonAlloc(allocator, request_json, dispatch.preview_select);
}

pub fn historicalPreviewReleaseAlloc(
    allocator: std.mem.Allocator,
    request_json: []const u8,
) !RecoveryCallResult {
    if (!modular_core) {
        const json = try implementation.historicalPreviewReleaseJsonAlloc(allocator, request_json);
        return .{ .json = json, .status = statusFromDirectJson(json) };
    }
    const dispatch = api() orelse return error.Scene3dModuleUnavailable;
    return invokeJsonAlloc(allocator, request_json, dispatch.preview_release);
}

pub fn modelWriteLeaseAcquireAlloc(
    allocator: std.mem.Allocator,
    request_json: []const u8,
) !RecoveryCallResult {
    if (!modular_core) {
        const json = try implementation.modelWriteLeaseAcquireJsonAlloc(allocator, request_json);
        return .{ .json = json, .status = statusFromDirectJson(json) };
    }
    const dispatch = api() orelse return error.Scene3dModuleUnavailable;
    return invokeJsonAlloc(allocator, request_json, dispatch.lease_acquire);
}

pub fn modelWriteLeaseReleaseAlloc(
    allocator: std.mem.Allocator,
    request_json: []const u8,
) !RecoveryCallResult {
    if (!modular_core) {
        const json = try implementation.modelWriteLeaseReleaseJsonAlloc(allocator, request_json);
        return .{ .json = json, .status = statusFromDirectJson(json) };
    }
    const dispatch = api() orelse return error.Scene3dModuleUnavailable;
    return invokeJsonAlloc(allocator, request_json, dispatch.lease_release);
}

pub fn modelFieldCandidateAlloc(
    allocator: std.mem.Allocator,
    request_json: []const u8,
) !RecoveryCallResult {
    if (!modular_core) {
        const json = try implementation.modelFieldCandidateJsonAlloc(allocator, request_json);
        return .{ .json = json, .status = statusFromDirectJson(json) };
    }
    const dispatch = api() orelse return error.Scene3dModuleUnavailable;
    return invokeJsonAlloc(allocator, request_json, dispatch.field_candidate);
}

pub fn modelDocumentAdoptAlloc(
    allocator: std.mem.Allocator,
    request_json: []const u8,
    bytes: []const u8,
) !RecoveryCallResult {
    if (!modular_core) {
        const json = try implementation.modelDocumentAdoptBytesJsonAlloc(allocator, request_json, bytes);
        return .{ .json = json, .status = statusFromDirectJson(json) };
    }
    const dispatch = api() orelse return error.Scene3dModuleUnavailable;
    return invokeBytesJsonAlloc(allocator, request_json, bytes, dispatch.document_adopt);
}

pub fn modelDocumentRollbackAlloc(
    allocator: std.mem.Allocator,
    request_json: []const u8,
) !RecoveryCallResult {
    if (!modular_core) {
        const json = try implementation.modelDocumentRollbackJsonAlloc(allocator, request_json);
        return .{ .json = json, .status = statusFromDirectJson(json) };
    }
    const dispatch = api() orelse return error.Scene3dModuleUnavailable;
    return invokeJsonAlloc(allocator, request_json, dispatch.document_rollback);
}

/// Allocation-free, fixed-layout adoption commit.  Unlike the JSON recovery
/// calls this cannot lose a success because a response collector failed to
/// grow: the module writes directly into the caller-owned receipt.
pub fn modelDocumentFinalize(
    lease_receipt_id: u64,
    adoption_receipt_id: u64,
    target_sha256: [64]u8,
) !abi.SceneAdoptionFinalizeReceiptV1 {
    if (!modular_core) {
        const finalized = try implementation.modelDocumentFinalize(
            lease_receipt_id,
            adoption_receipt_id,
            target_sha256,
        );
        return .{
            .finalized = @intFromBool(finalized.finalized),
            .already_finalized = @intFromBool(finalized.already_finalized),
            .released = @intFromBool(finalized.released),
            .already_released = @intFromBool(finalized.already_released),
        };
    }
    const dispatch = api() orelse return error.Scene3dModuleUnavailable;
    var receipt = abi.SceneAdoptionFinalizeReceiptV1{};
    var status = abi.SceneCallStatusV1{};
    if (!dispatch.document_finalize(
        lease_receipt_id,
        adoption_receipt_id,
        &target_sha256,
        target_sha256.len,
        &receipt,
        &status,
    )) return error.Scene3dTransportFailed;
    if (status.code != .ok) return switch (status.code) {
        .lease_refused => error.ModelWriteLeaseRefused,
        .module_unavailable => error.Scene3dModuleUnavailable,
        .invalid_request => error.InvalidFinalizeReceipt,
        else => error.Scene3dTransactionFailed,
    };
    if (receipt.schema_version != 1 or receipt.finalized > 1 or
        receipt.already_finalized > 1 or receipt.released > 1 or
        receipt.already_released > 1 or
        (receipt.finalized + receipt.already_finalized != 1) or
        (receipt.released + receipt.already_released != 1))
    {
        return error.InvalidFinalizeReceipt;
    }
    return receipt;
}

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

pub fn orbitNavigationEnabled() bool {
    if (!modular_core) return implementation.orbitNavigationEnabled();
    return if (api()) |dispatch| dispatch.orbit_navigation_enabled() else false;
}

pub fn orbitNavigationSet(enabled: bool) bool {
    if (!modular_core) return implementation.orbitNavigationSet(enabled);
    return if (api()) |dispatch| dispatch.orbit_navigation_set(enabled) else false;
}

pub fn orbitNavigationKey(sym: i32, down: bool, shift: bool, ctrl: bool) bool {
    if (!modular_core) return implementation.orbitNavigationKey(sym, down, shift, ctrl);
    return if (api()) |dispatch| dispatch.orbit_navigation_key(sym, down, shift, ctrl) else false;
}

pub fn focusAt(x: f32, y: f32) bool {
    if (!modular_core) return implementation.focusAt(x, y);
    return if (api()) |dispatch| dispatch.focus_at(x, y) else false;
}

pub fn meshEditPick(x: f32, y: f32, additive: bool) i32 {
    if (!modular_core) return implementation.meshEditPick(x, y, additive);
    return if (api()) |dispatch| dispatch.mesh_pick(x, y, additive) else -1;
}

/// Ctrl+click edge-path pick (req_4271): loop → ring → single-edge cycling.
pub fn meshEditPathPick(x: f32, y: f32, additive: bool) i32 {
    if (!modular_core) return implementation.meshEditPathPick(x, y, additive);
    return if (api()) |dispatch| dispatch.mesh_path_pick(x, y, additive) else -1;
}

/// Live selection count — the engine's ctrl+right-click (extrude-to) gate.
pub fn meshEditSelectionCount() u32 {
    if (!modular_core) return implementation.meshEditSelectionCount();
    return if (api()) |dispatch| dispatch.mesh_selection_count() else 0;
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
