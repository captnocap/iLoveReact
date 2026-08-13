//! Thin V8 door for the editor's native Lore snapshot chain.
//!
//! Every operation accepts one JSON request string and returns one JSON response
//! string. The V8 layer does not interpret version-control policy or mesh bytes.
//! `snapshot.zig` owns those decisions; this file only obtains the exact resident
//! model document for the panic-snapshot call and translates the callback ABI.

const std = @import("std");
const v8 = @import("v8");
const v8_runtime = @import("v8_runtime.zig");
const scene3d_runtime = @import("dev_modules/scene3d_runtime.zig");
const scene3d_abi = @import("dev_module_abi");
const snapshot = @import("vcs/snapshot.zig");
const lore = @import("vcs/lore.zig");
const model_restore = @import("vcs/model_restore.zig");
const model_field_edit = @import("vcs/model_field_edit.zig");
const status_monitor = @import("vcs/status_monitor.zig");
const HostContext = @import("host_context.zig");
const fs = @import("fs/fs.zig");
const dirty = @import("state/dirty.zig");

// Package-coordinator-only capability registry. The two host doors below are
// intentionally absent from runtime/vcs/lore.ts's public API and Agent Seat.
var verified_save_receipts = snapshot.VerifiedSaveReceiptRegistry.init(std.heap.c_allocator);
var lore_status_monitor: status_monitor.Monitor = .{};
var lore_retention_executor: snapshot.retention.Executor = .{};
var active_preview_scene_token: ?[]u8 = null;
var active_preview_lore_token: ?[]u8 = null;

const CHECKING_STATUS_JSON =
    "{\"ok\":true,\"version\":1,\"status\":{\"state\":\"checking\",\"library\":{\"available\":false,\"version\":null},\"repository\":{\"ready\":false,\"path\":\"checking\",\"revision\":null},\"service\":{\"healthy\":false,\"healthUrl\":\"http://127.0.0.1:41339/health_check\",\"httpCode\":null,\"unitName\":\"loreserver.service\",\"active\":false,\"enabled\":false,\"journalTail\":[],\"restoreCommands\":[]},\"stores\":{\"snapshotRoot\":\".reactjit-lore-snapshots\",\"localBytes\":0,\"serverBytes\":null},\"retention\":{\"days\":60,\"nowMs\":0,\"lastPruneMs\":null,\"nextPruneMs\":null,\"immediatelyExpired\":0,\"localTombstones\":0,\"remotePendingTombstones\":0,\"logicallyRemovedEntries\":0,\"logicallyRemovedBytes\":0,\"physicallyReclaimedBytes\":0,\"remoteWatermark\":null,\"legacyUnexpiredPending\":0,\"legacyCorruptPending\":0,\"legacyLayoutCutover\":false,\"lastError\":null},\"history\":{\"pushed\":0,\"local\":0,\"unknown\":0},\"probe\":{\"lastCompletedMs\":null,\"lastTransitionMs\":null}}}";
const STATUS_CHANNEL: [:0]const u8 = "lore:status-changed";

fn probeLoreStatus(
    _: ?*anyopaque,
    io: std.Io,
    allocator: std.mem.Allocator,
) !status_monitor.ProbeResult {
    const payload = try snapshot.serverStatusProtocolJson(io, allocator, "{\"version\":1}");
    errdefer allocator.free(payload);
    return .{
        .payload = payload,
        .fingerprint = try status_monitor.transitionFingerprintJson(allocator, payload),
    };
}

fn runLoreRetention(
    _: ?*anyopaque,
    io: std.Io,
    allocator: std.mem.Allocator,
    state_directory: std.Io.Dir,
    now_ms: i64,
) !void {
    return snapshot.runRetentionMaintenance(io, allocator, state_directory, now_ms);
}

fn enqueueLoreRetention(io: std.Io) void {
    _ = lore_retention_executor.enqueue(std.Io.Clock.now(.real, io).toMilliseconds());
}

fn argStringAlloc(info: v8.FunctionCallbackInfo, index: u32, allocator: std.mem.Allocator) ?[]u8 {
    if (index >= info.length()) return null;
    const isolate = info.getIsolate();
    const context = isolate.getCurrentContext();
    const value = info.getArg(index).toString(context) catch return null;
    const len = value.lenUtf8(isolate);
    const bytes = allocator.alloc(u8, len) catch return null;
    _ = value.writeUtf8(isolate, bytes);
    return bytes;
}

fn setReturnString(info: v8.FunctionCallbackInfo, value: []const u8) void {
    info.getReturnValue().set(v8.String.initUtf8(info.getIsolate(), value));
}

fn setProtocolError(info: v8.FunctionCallbackInfo, code: snapshot.LoreErrorCodeV1, detail: []const u8) void {
    const allocator = std.heap.c_allocator;
    const payload = snapshot.loreErrorJsonAlloc(allocator, code, detail) catch {
        setReturnString(info, "{\"ok\":false,\"version\":1,\"code\":\"internal_error\",\"detail\":\"Lore error encoding failed\"}");
        return;
    };
    defer allocator.free(payload);
    setReturnString(info, payload);
}

fn setGenerationError(info: v8.FunctionCallbackInfo, detail: []const u8, generation: u32) void {
    const allocator = std.heap.c_allocator;
    const payload = snapshot.loreErrorWithGenerationJsonAlloc(
        allocator,
        .stale_generation,
        detail,
        generation,
    ) catch {
        setProtocolError(info, .stale_generation, detail);
        return;
    };
    defer allocator.free(payload);
    setReturnString(info, payload);
}

fn setError(info: v8.FunctionCallbackInfo, err: anyerror) void {
    const allocator = std.heap.c_allocator;
    const payload = snapshot.loreErrorForNativeErrorJsonAlloc(allocator, err) catch {
        setProtocolError(info, .internal_error, "Lore operation failed");
        return;
    };
    defer allocator.free(payload);
    setReturnString(info, payload);
}

// Every door below runs synchronously on the V8 frame thread, so none of them
// may block indefinitely behind the process-wide liblore gate or the repository
// mutation lock — a wedged network push or a running retention prune used to
// freeze the whole editor on a Preview/Pin click (req_4346). Browse-class doors
// give up quickly; user-confirmed transactions (save archival, restore) ride
// out more contention before answering busy. Past the budget the caller gets a
// `busy` receipt naming the current gate holder instead of a frozen frame.
const BROWSE_GATE_BUDGET_MS: u32 = 350;
const TRANSACTION_GATE_BUDGET_MS: u32 = 2000;

fn setSceneCaptureStatusError(info: v8.FunctionCallbackInfo, status: scene3d_abi.SceneCallStatusV1) void {
    switch (status.code) {
        .invalid_request => setProtocolError(info, .invalid_request, "Scene3D rejected the recovery capture request"),
        .wrong_model => setProtocolError(info, .wrong_model, "modelId/sessionToken do not identify the visible Scene3D session"),
        .no_resident_session => setProtocolError(info, .no_resident_session, "the requested model has no resident Scene3D session"),
        .stale_generation => setGenerationError(info, "expectedGeneration does not match the resident mesh generation", @intCast(status.current_generation)),
        .module_unavailable => setProtocolError(info, .internal_error, "the active Scene3D module is unavailable"),
        else => setProtocolError(info, .internal_error, "Scene3D recovery capture failed"),
    }
}

fn hostLoreSnapshot(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    // Bounded even for the panic path: during crash handling a wedged gate must
    // produce a failed receipt, not a hang that swallows the crash report.
    lore.beginInteractiveGateBudget(TRANSACTION_GATE_BUDGET_MS);
    defer lore.endInteractiveGateBudget();
    const host = v8_runtime.hostContext(info.getIsolate());
    const allocator = std.heap.c_allocator;
    const request_json = argStringAlloc(info, 0, allocator) orelse {
        setProtocolError(info, .invalid_request, "missing panic snapshot request JSON");
        return;
    };
    defer allocator.free(request_json);

    var request = snapshot.parsePanicSnapshotRequestV1(allocator, request_json) catch {
        setProtocolError(info, .invalid_request, "invalid PanicSnapshotRequestV1");
        return;
    };
    defer request.deinit();
    var captured = scene3d_runtime.captureRecoveryAlloc(
        allocator,
        request.value.modelId,
        request.value.sessionToken,
        request.value.expectedGeneration,
    ) catch |err| {
        setError(info, err);
        return;
    };
    defer captured.deinit(allocator);
    if (captured.status.code != .ok) {
        setSceneCaptureStatusError(info, captured.status);
        return;
    }
    if (captured.meta.degradation_count > captured.meta.degradations.len or
        (captured.status.flags & ~@as(u32, 1)) != 0 or
        ((captured.status.flags & 1) != 0) != (captured.meta.identity_quality == 1))
    {
        setProtocolError(info, .invalid_host_response, "Scene3D recovery metadata is internally inconsistent");
        return;
    }
    var degradation_slots: [7]snapshot.CapturedRecoveryDegradationSlotV1 = undefined;
    for (captured.meta.degradations[0..captured.meta.degradation_count], 0..) |row, index| {
        degradation_slots[index] = .{
            .channel = @intFromEnum(row.channel),
            .action_bits = row.action_bits,
            .reason_bits = row.reason_bits,
            .affected_count = row.affected_count,
        };
    }
    const artifact = snapshot.CapturedRecoveryArtifactV1{
        .bytes = captured.bytes,
        .schema_version = captured.meta.schema_version,
        .rjmd_version = captured.meta.rjmd_version,
        .generation = captured.meta.generation,
        .byte_len = captured.meta.byte_len,
        .triangle_count = captured.meta.triangle_count,
        .authored_face_count = captured.meta.authored_face_count,
        .part_count = captured.meta.part_count,
        .logical_vertex_count = captured.meta.logical_vertex_count,
        .sha256 = captured.meta.sha256,
        .model_id_hash = captured.meta.model_id_hash,
        .session_token_hash = captured.meta.session_token_hash,
        .object_namespace_hash = captured.meta.object_namespace_hash,
        .identity_quality = captured.meta.identity_quality,
        .degradations = degradation_slots[0..captured.meta.degradation_count],
    };
    const response = snapshot.commitCapturedRecoveryJson(host.io, allocator, request_json, &artifact) catch |err| {
        setError(info, err);
        return;
    };
    defer allocator.free(response);
    setReturnString(info, response);
    enqueueLoreRetention(host.io);
}

fn hostLoreVerifiedSaveReceipt(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    lore.beginInteractiveGateBudget(TRANSACTION_GATE_BUDGET_MS);
    defer lore.endInteractiveGateBudget();
    const host = v8_runtime.hostContext(info.getIsolate());
    const allocator = std.heap.c_allocator;
    const request_json = argStringAlloc(info, 0, allocator) orelse {
        setProtocolError(info, .invalid_request, "missing verified-Save receipt request JSON");
        return;
    };
    defer allocator.free(request_json);
    const response = snapshot.issueVerifiedSaveReceiptJson(
        host.io,
        allocator,
        &verified_save_receipts,
        request_json,
    ) catch |err| {
        setError(info, err);
        return;
    };
    defer allocator.free(response);
    setReturnString(info, response);
}

fn hostLoreVerifiedSaveSnapshot(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    lore.beginInteractiveGateBudget(TRANSACTION_GATE_BUDGET_MS);
    defer lore.endInteractiveGateBudget();
    const host = v8_runtime.hostContext(info.getIsolate());
    const allocator = std.heap.c_allocator;
    const request_json = argStringAlloc(info, 0, allocator) orelse {
        setProtocolError(info, .invalid_request, "missing verified normal snapshot request JSON");
        return;
    };
    defer allocator.free(request_json);
    const response = snapshot.normalSnapshotJson(
        host.io,
        allocator,
        &verified_save_receipts,
        request_json,
    ) catch |err| {
        setError(info, err);
        return;
    };
    defer allocator.free(response);
    setReturnString(info, response);
    enqueueLoreRetention(host.io);
}

fn hostLoreHistory(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    lore.beginInteractiveGateBudget(BROWSE_GATE_BUDGET_MS);
    defer lore.endInteractiveGateBudget();
    callRequestJson(info, snapshot.historyProtocolJson);
}

fn hostLorePreview(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    lore.beginInteractiveGateBudget(BROWSE_GATE_BUDGET_MS);
    defer lore.endInteractiveGateBudget();
    callRequestJson(info, snapshot.previewProtocolJson);
}

const ScenePreviewOpenDoorV1 = struct {
    version: u32,
    operation: enum { open },
    capabilityToken: []const u8,
    modelId: []const u8,
    snapshotId: []const u8,
    resolvedRevision: []const u8,
    expectedSha256: []const u8,
    identityQuality: []const u8,
    objectNamespaceHash: []const u8,
    recoveryDegradations: std.json.Value,
};

const ScenePreviewReleaseDoorV1 = struct {
    version: u32,
    operation: enum { release },
    capabilityToken: []const u8,
    previewToken: []const u8,
};

fn previewDoorOperation(allocator: std.mem.Allocator, request_json: []const u8) ?[]const u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, request_json, .{}) catch return null;
    defer parsed.deinit();
    const root = switch (parsed.value) { .object => |value| value, else => return null };
    return switch (root.get("operation") orelse return null) {
        .string => |value| if (std.mem.eql(u8, value, "open")) "open" else if (std.mem.eql(u8, value, "release")) "release" else null,
        else => null,
    };
}

fn releasePreviewCapabilityBestEffort(io: std.Io, token: []const u8) void {
    _ = snapshot.releasePreviewCapability(io, token) catch {};
}

fn releaseScenePreviewBestEffort(allocator: std.mem.Allocator, preview_token: []const u8) void {
    if (preview_token.len == 0) return;
    const request = std.json.Stringify.valueAlloc(allocator, .{
        .version = 1,
        .operation = "release",
        .previewToken = preview_token,
    }, .{}) catch return;
    defer allocator.free(request);
    var response = scene3d_runtime.historicalPreviewReleaseAlloc(allocator, request) catch return;
    response.deinit(allocator);
}

fn hostMeshPreviewSession(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    lore.beginInteractiveGateBudget(BROWSE_GATE_BUDGET_MS);
    defer lore.endInteractiveGateBudget();
    const host = v8_runtime.hostContext(info.getIsolate());
    const allocator = std.heap.c_allocator;
    const request_json = argStringAlloc(info, 0, allocator) orelse {
        setProtocolError(info, .invalid_request, "missing Scene3D preview request JSON");
        return;
    };
    defer allocator.free(request_json);
    const operation = previewDoorOperation(allocator, request_json) orelse {
        setProtocolError(info, .invalid_request, "invalid Scene3D preview operation");
        return;
    };

    if (std.mem.eql(u8, operation, "open")) {
        var parsed = std.json.parseFromSlice(ScenePreviewOpenDoorV1, allocator, request_json, .{}) catch {
            setProtocolError(info, .invalid_request, "invalid Scene3D preview open request");
            return;
        };
        defer parsed.deinit();
        const request = parsed.value;
        if (request.version != 1 or request.capabilityToken.len == 0 or request.modelId.len == 0 or
            request.snapshotId.len == 0 or request.resolvedRevision.len != 64 or
            request.expectedSha256.len != 64 or request.objectNamespaceHash.len != 64 or
            active_preview_scene_token != null or active_preview_lore_token != null)
        {
            setProtocolError(info, .invalid_request, "a historical preview is already active or the request is invalid");
            return;
        }
        var borrowed = snapshot.borrowPreviewCapability(host.io, request.capabilityToken, .{
            .model_id = request.modelId,
            .stable_id = request.snapshotId,
            .revision = request.resolvedRevision,
            .sha256 = request.expectedSha256,
        }) catch |err| {
            setError(info, err);
            return;
        };
        defer borrowed.deinit(host.io);
        const scene_request = std.json.Stringify.valueAlloc(allocator, .{
            .version = 1,
            .operation = "open",
            .modelId = request.modelId,
            .snapshotId = request.snapshotId,
            .resolvedRevision = request.resolvedRevision,
            .expectedSha256 = request.expectedSha256,
            .identityQuality = request.identityQuality,
            .objectNamespaceHash = request.objectNamespaceHash,
            .recoveryDegradations = request.recoveryDegradations,
        }, .{}) catch {
            releasePreviewCapabilityBestEffort(host.io, request.capabilityToken);
            setProtocolError(info, .internal_error, "Scene3D preview request encoding failed");
            return;
        };
        defer allocator.free(scene_request);
        var response = scene3d_runtime.historicalPreviewOpenAlloc(allocator, scene_request, borrowed.bytes()) catch |err| {
            releasePreviewCapabilityBestEffort(host.io, request.capabilityToken);
            setError(info, err);
            return;
        };
        defer response.deinit(allocator);
        if (response.status.code != .ok) {
            releasePreviewCapabilityBestEffort(host.io, request.capabilityToken);
            setReturnString(info, response.json);
            return;
        }
        const SceneReceipt = struct { ok: bool, previewToken: []const u8 };
        var receipt = std.json.parseFromSlice(SceneReceipt, allocator, response.json, .{}) catch {
            releasePreviewCapabilityBestEffort(host.io, request.capabilityToken);
            setProtocolError(info, .invalid_host_response, "Scene3D preview returned an invalid receipt");
            return;
        };
        defer receipt.deinit();
        if (!receipt.value.ok or receipt.value.previewToken.len == 0) {
            releaseScenePreviewBestEffort(allocator, receipt.value.previewToken);
            releasePreviewCapabilityBestEffort(host.io, request.capabilityToken);
            setProtocolError(info, .invalid_host_response, "Scene3D preview returned an invalid receipt");
            return;
        }
        active_preview_scene_token = allocator.dupe(u8, receipt.value.previewToken) catch null;
        active_preview_lore_token = allocator.dupe(u8, request.capabilityToken) catch null;
        if (active_preview_scene_token == null or active_preview_lore_token == null) {
            if (active_preview_scene_token) |token| allocator.free(token);
            if (active_preview_lore_token) |token| allocator.free(token);
            active_preview_scene_token = null;
            active_preview_lore_token = null;
            releaseScenePreviewBestEffort(allocator, receipt.value.previewToken);
            releasePreviewCapabilityBestEffort(host.io, request.capabilityToken);
            setProtocolError(info, .internal_error, "Scene3D preview ownership could not be retained");
            return;
        }
        dirty.markDirty();
        setReturnString(info, response.json);
        return;
    }

    var parsed = std.json.parseFromSlice(ScenePreviewReleaseDoorV1, allocator, request_json, .{}) catch {
        setProtocolError(info, .invalid_request, "invalid Scene3D preview release request");
        return;
    };
    defer parsed.deinit();
    const request = parsed.value;
    if (request.version != 1 or request.previewToken.len == 0 or request.capabilityToken.len == 0 or
        active_preview_scene_token == null or active_preview_lore_token == null or
        !std.mem.eql(u8, active_preview_scene_token.?, request.previewToken) or
        !std.mem.eql(u8, active_preview_lore_token.?, request.capabilityToken))
    {
        setProtocolError(info, .released_capability, "historical preview tokens are not active");
        return;
    }
    const scene_request = std.json.Stringify.valueAlloc(allocator, .{
        .version = 1,
        .operation = "release",
        .previewToken = request.previewToken,
    }, .{}) catch {
        setProtocolError(info, .internal_error, "Scene3D preview release encoding failed");
        return;
    };
    defer allocator.free(scene_request);
    var scene_response = scene3d_runtime.historicalPreviewReleaseAlloc(allocator, scene_request) catch |err| {
        // Lore ownership is still released below by the explicit retry path.
        setError(info, err);
        return;
    };
    defer scene_response.deinit(allocator);
    if (scene_response.status.code != .ok) {
        setReturnString(info, scene_response.json);
        return;
    }
    const lore_release = snapshot.releasePreviewCapability(host.io, request.capabilityToken) catch |err| {
        setError(info, err);
        return;
    };
    allocator.free(active_preview_scene_token.?);
    allocator.free(active_preview_lore_token.?);
    active_preview_scene_token = null;
    active_preview_lore_token = null;
    dirty.markDirty();
    const response = std.json.Stringify.valueAlloc(allocator, .{
        .ok = true,
        .version = 1,
        .sceneReleased = true,
        .capabilityReleased = lore_release.released,
        .capabilityAlreadyReleased = lore_release.already_released,
    }, .{}) catch {
        setProtocolError(info, .internal_error, "preview release receipt encoding failed");
        return;
    };
    defer allocator.free(response);
    setReturnString(info, response);
}

fn hostLoreRestore(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    lore.beginInteractiveGateBudget(TRANSACTION_GATE_BUDGET_MS);
    defer lore.endInteractiveGateBudget();
    callRequestJson(info, snapshot.restoreCandidateProtocolJson);
}

/// The sole public mutation door for historical Restore. Raw Scene3D lease,
/// adoption, rollback, and finalize calls remain process-private ABI entries.
fn hostModelRecoveryTransaction(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    lore.beginInteractiveGateBudget(TRANSACTION_GATE_BUDGET_MS);
    defer lore.endInteractiveGateBudget();
    callRequestJson(info, model_restore.protocolJson);
}

/// Sole public mutation door for guarded authored-face field edits. Candidate
/// bytes, package paths, lease receipts, and rollback capabilities remain
/// native-only inside the coordinator.
fn hostModelFaceFieldEdit(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    lore.beginInteractiveGateBudget(TRANSACTION_GATE_BUDGET_MS);
    defer lore.endInteractiveGateBudget();
    callRequestJson(info, model_field_edit.protocolJson);
}

fn hostLorePin(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    lore.beginInteractiveGateBudget(BROWSE_GATE_BUDGET_MS);
    defer lore.endInteractiveGateBudget();
    callRequestJson(info, snapshot.pinProtocolJson);
}

fn hostLoreServerStatus(info_c: ?*const v8.c.FunctionCallbackInfo) callconv(.c) void {
    const info = v8.FunctionCallbackInfo.initFromV8(info_c);
    lore.beginInteractiveGateBudget(BROWSE_GATE_BUDGET_MS);
    defer lore.endInteractiveGateBudget();
    const allocator = std.heap.c_allocator;
    const request_json = argStringAlloc(info, 0, allocator) orelse {
        setProtocolError(info, .invalid_request, "missing RecoveryStatusRequestV1");
        return;
    };
    defer allocator.free(request_json);
    const Request = struct { version: u32 };
    var request = std.json.parseFromSlice(Request, allocator, request_json, .{}) catch {
        setProtocolError(info, .invalid_request, "invalid RecoveryStatusRequestV1");
        return;
    };
    defer request.deinit();
    if (request.value.version != 1) {
        setProtocolError(info, .invalid_request, "invalid RecoveryStatusRequestV1");
        return;
    }
    const latest = lore_status_monitor.copyLatestAlloc(allocator) orelse {
        setReturnString(info, CHECKING_STATUS_JSON);
        return;
    };
    defer allocator.free(latest);
    setReturnString(info, latest);
}

fn callRequestJson(info: v8.FunctionCallbackInfo, operation: anytype) void {
    const allocator = std.heap.c_allocator;
    const request_json = argStringAlloc(info, 0, allocator) orelse {
        setProtocolError(info, .invalid_request, "missing v1 request JSON");
        return;
    };
    defer allocator.free(request_json);
    callOperation(info, operation, request_json);
}

fn callOperation(info: v8.FunctionCallbackInfo, operation: anytype, request_json: []const u8) void {
    const host = v8_runtime.hostContext(info.getIsolate());
    const allocator = std.heap.c_allocator;
    const response = operation(host.io, allocator, request_json) catch |err| {
        setError(info, err);
        return;
    };
    defer allocator.free(response);
    setReturnString(info, response);
}

pub fn registerLore(host: *HostContext) void {
    _ = lore_status_monitor.start(
        host.io,
        std.heap.c_allocator,
        probeLoreStatus,
        null,
        .fromSeconds(15),
    );
    // Lore registration runs before the app root's ordinary local-store init.
    // Initializing the shared reactjit data root here is idempotent and keeps
    // retention state outside the Lore checkout from the first startup job.
    fs.init(host.io, host.environ, "reactjit") catch {};
    if (fs.dataDir()) |state_directory| {
        lore_retention_executor.start(
            host.io,
            std.heap.c_allocator,
            state_directory,
            runLoreRetention,
            null,
        ) catch {};
        enqueueLoreRetention(host.io);
    } else |_| {}
    v8_runtime.registerHostFn("__lore_snapshot", hostLoreSnapshot);
    v8_runtime.registerHostFn("__lore_verified_save_receipt", hostLoreVerifiedSaveReceipt);
    v8_runtime.registerHostFn("__lore_verified_save_snapshot", hostLoreVerifiedSaveSnapshot);
    v8_runtime.registerHostFn("__lore_history", hostLoreHistory);
    v8_runtime.registerHostFn("__lore_preview", hostLorePreview);
    v8_runtime.registerHostFn("__mesh_preview_session", hostMeshPreviewSession);
    v8_runtime.registerHostFn("__lore_restore", hostLoreRestore);
    v8_runtime.registerHostFn("__model_recovery_transaction", hostModelRecoveryTransaction);
    v8_runtime.registerHostFn("__model_face_field_edit", hostModelFaceFieldEdit);
    v8_runtime.registerHostFn("__lore_pin", hostLorePin);
    v8_runtime.registerHostFn("__lore_server_status", hostLoreServerStatus);
}

/// Adopt one coalesced worker transition and notify JS from the frame thread.
/// The payload is the same strict receipt returned by __lore_server_status.
pub fn tickDrain(host: *HostContext) void {
    const allocator = std.heap.c_allocator;
    const payload = lore_status_monitor.takeTransitionAlloc(allocator) orelse return;
    defer allocator.free(payload);
    const payload_z = allocator.dupeZ(u8, payload) catch return;
    defer allocator.free(payload_z);
    v8_runtime.callGlobal2Str(host, "__ffiEmit", STATUS_CHANNEL, payload_z);
}

pub fn shutdownLore(host: *HostContext) void {
    if (active_preview_scene_token) |scene_token| {
        const request = std.json.Stringify.valueAlloc(std.heap.c_allocator, .{
            .version = 1,
            .operation = "release",
            .previewToken = scene_token,
        }, .{}) catch null;
        if (request) |json| {
            var released = scene3d_runtime.historicalPreviewReleaseAlloc(std.heap.c_allocator, json) catch null;
            if (released) |*value| value.deinit(std.heap.c_allocator);
            std.heap.c_allocator.free(json);
        }
        std.heap.c_allocator.free(scene_token);
        active_preview_scene_token = null;
    }
    if (active_preview_lore_token) |lore_token| {
        _ = snapshot.releasePreviewCapability(host.io, lore_token) catch {};
        std.heap.c_allocator.free(lore_token);
        active_preview_lore_token = null;
    }
    snapshot.clearPreviewCapabilities(host.io);
    lore_retention_executor.stop();
    lore_status_monitor.stop();
}
