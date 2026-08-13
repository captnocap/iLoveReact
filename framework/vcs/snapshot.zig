//! Native-resident model recovery snapshots backed by Lore.
//!
//! This module never asks the editor Save pipeline for model bytes. The V8
//! boundary hands it an immutable native mesh snapshot, which is encoded as
//! current RJMD v5 and written to a private Lore spool. Package geometry is
//! untouched during capture; only an explicit, validated restore may replace it.

const std = @import("std");
const meshdoc_format = @import("../gpu/meshdoc_format.zig");
const mesh_edge_semantics = @import("../gpu/mesh_edge_semantics.zig");
const model_package_geometry = @import("../gpu/mesh_face_table_package.zig");
const fs = @import("../fs/fs.zig");
const lore = @import("lore.zig");
pub const owned_byte_capability = @import("owned_byte_capability.zig");
pub const retention = @import("lore_retention.zig");

const REPOSITORY_PATH = "cart/editor";
const SNAPSHOT_ROOT = ".lore-snapshots";
const MUTATION_LOCK_TARGET = "cart/editor/.lore-snapshots/repository-transaction";
const PUSH_LOCK_TARGET = "cart/editor/.lore-snapshots/network-push";
pub const MODEL_PACKAGE_ROOT = "cart/editor/data/models";
const METADATA_KEY = "rjit.snapshot.v2";
const LEGACY_METADATA_KEY = "rjit.snapshot.v1";
const MAX_HISTORY: u32 = 500;
const DEFAULT_HISTORY: u32 = 100;
const DEFAULT_SERVER_STORE = "/home/siah/.local/share/loreserver/store";
const HEALTH_URL = "http://127.0.0.1:41339/health_check";
pub const RETENTION_STATE_PATH = "lore-maintenance/state.json";
pub const RETENTION_DAYS: u32 = 60;
const RETENTION_MILLISECONDS: i64 = @as(i64, RETENTION_DAYS) * 24 * 60 * 60 * 1000;
const SNAPSHOT_ID_TIMESTAMP_DIGITS = 13;
const SNAPSHOT_ID_ENTROPY_BYTES = 16;
const SNAPSHOT_ID_LENGTH = SNAPSHOT_ID_TIMESTAMP_DIGITS + 1 + SNAPSHOT_ID_ENTROPY_BYTES * 2;
const VERIFIED_SAVE_RECEIPT_ENTROPY_BYTES = 32;
const VERIFIED_SAVE_RECEIPT_PREFIX = "save-v1-";
const MAX_VERIFIED_SAVE_RECEIPTS = 32;
const PREVIEW_CAPABILITY_PREFIX = "lore-preview-v1-";
const MAX_PREVIEW_CAPABILITIES = 8;
const MAX_PREVIEW_TOMBSTONES = 64;
const RESTORE_CANDIDATE_PREFIX = "lore-restore-v1-";
const MAX_RESTORE_CANDIDATES = 4;
const MAX_RESTORE_CANDIDATE_TOMBSTONES = 64;

var capture_sequence: u64 = 0;
// Retained only for the private materializer's retired `retain` branch. The
// public preview door below never enables that branch and never returns a path.
var retained_preview_mutex: std.Io.Mutex = .init;
var retained_preview_directory: ?[]u8 = null;
var retained_preview_path: ?[]u8 = null;
var preview_capabilities = owned_byte_capability.Registry.init(
    std.heap.c_allocator,
    PREVIEW_CAPABILITY_PREFIX,
    MAX_PREVIEW_CAPABILITIES,
    MAX_PREVIEW_TOMBSTONES,
);
var restore_candidates = owned_byte_capability.Registry.init(
    std.heap.c_allocator,
    RESTORE_CANDIDATE_PREFIX,
    MAX_RESTORE_CANDIDATES,
    MAX_RESTORE_CANDIDATE_TOMBSTONES,
);

const SnapshotKind = enum {
    panic,
    normal,
    save_mismatch,
    pre_restore,
    pre_field_edit,
    restored,
    field_edit,
};

pub const TransactionSnapshotKind = enum {
    save_mismatch,
    pre_restore,
    pre_field_edit,
    restored,
    field_edit,
};

pub const LoreErrorCodeV1 = enum {
    invalid_request,
    invalid_host_response,
    library_unavailable,
    repository_unavailable,
    no_resident_session,
    wrong_model,
    stale_generation,
    snapshot_not_found,
    snapshot_expired,
    stale_history_row,
    hash_mismatch,
    corrupt_event,
    released_capability,
    restore_coordinator_unavailable,
    legacy_restore_disabled,
    authorization_failed,
    server_unavailable,
    busy,
    internal_error,
};

pub const PanicSnapshotRequestV1 = struct {
    version: u32,
    modelId: []const u8,
    sessionToken: []const u8,
    expectedGeneration: u64,
    kind: enum { panic },
    label: []const u8,
    note: ?[]const u8 = null,
    push: bool,
};

/// Package-coordinator-only request. The native issuer rereads and verifies the
/// installed geometry itself; JavaScript never supplies or receives RJMD bytes.
pub const VerifiedSaveReceiptIssueRequestV1 = struct {
    version: u32,
    modelId: []const u8,
    packageGeometryPath: []const u8,
    expectedSha256: []const u8,
};

/// Package-coordinator-only append request. `saveReceiptToken` is a one-use
/// capability over exact, already-read-back package bytes.
pub const NormalSnapshotRequestV1 = struct {
    version: u32,
    modelId: []const u8,
    kind: enum { normal },
    saveReceiptToken: []const u8,
    label: []const u8,
    note: ?[]const u8 = null,
    push: bool,
};

pub const OwnedVerifiedSave = struct {
    model_id: []u8,
    package_geometry_path: []u8,
    bytes: []u8,
    sha256: [64]u8,
    format_version: u32,

    pub fn deinit(self: *OwnedVerifiedSave, allocator: std.mem.Allocator) void {
        allocator.free(self.model_id);
        allocator.free(self.package_geometry_path);
        allocator.free(self.bytes);
        self.* = undefined;
    }
};

const VerifiedSaveReceiptEntry = struct {
    token: []u8,
    save: OwnedVerifiedSave,

    fn deinit(self: *VerifiedSaveReceiptEntry, allocator: std.mem.Allocator) void {
        allocator.free(self.token);
        self.save.deinit(allocator);
        self.* = undefined;
    }
};

/// Bounded native registry for exact package readback. Tokens are random,
/// model-bound, and removed before an append begins, so failure cannot make a
/// capability replayable.
pub const VerifiedSaveReceiptRegistry = struct {
    allocator: std.mem.Allocator,
    mutex: std.Io.Mutex = .init,
    entries: std.ArrayList(VerifiedSaveReceiptEntry) = .empty,

    pub fn init(allocator: std.mem.Allocator) VerifiedSaveReceiptRegistry {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *VerifiedSaveReceiptRegistry, io: std.Io) void {
        self.mutex.lockUncancelable(io);
        for (self.entries.items) |*entry| entry.deinit(self.allocator);
        self.entries.deinit(self.allocator);
        self.mutex.unlock(io);
        self.* = undefined;
    }

    pub fn issueOwned(
        self: *VerifiedSaveReceiptRegistry,
        io: std.Io,
        save: OwnedVerifiedSave,
    ) ![]u8 {
        var entropy: [VERIFIED_SAVE_RECEIPT_ENTROPY_BYTES]u8 = undefined;
        for (0..8) |_| {
            try io.randomSecure(&entropy);
            const hex = std.fmt.bytesToHex(entropy, .lower);
            const token = try std.fmt.allocPrint(self.allocator, VERIFIED_SAVE_RECEIPT_PREFIX ++ "{s}", .{&hex});
            errdefer self.allocator.free(token);

            self.mutex.lockUncancelable(io);
            defer self.mutex.unlock(io);
            if (self.entries.items.len >= MAX_VERIFIED_SAVE_RECEIPTS) return error.SaveReceiptRegistryFull;
            var collision = false;
            for (self.entries.items) |entry| {
                if (std.mem.eql(u8, entry.token, token)) {
                    collision = true;
                    break;
                }
            }
            if (collision) {
                self.allocator.free(token);
                continue;
            }
            const response_token = try self.allocator.dupe(u8, token);
            errdefer self.allocator.free(response_token);
            try self.entries.append(self.allocator, .{ .token = token, .save = save });
            return response_token;
        }
        return error.SaveReceiptCollision;
    }

    pub fn consume(
        self: *VerifiedSaveReceiptRegistry,
        io: std.Io,
        token: []const u8,
        model_id: []const u8,
    ) !OwnedVerifiedSave {
        self.mutex.lockUncancelable(io);
        defer self.mutex.unlock(io);
        for (self.entries.items, 0..) |entry, index| {
            if (!std.mem.eql(u8, entry.token, token)) continue;
            if (!std.mem.eql(u8, entry.save.model_id, model_id)) return error.SaveReceiptWrongModel;
            const owned = self.entries.orderedRemove(index);
            self.allocator.free(owned.token);
            return owned.save;
        }
        return error.SaveReceiptNotFound;
    }
};

pub const SnapshotReadGuard = struct {
    context: ?*anyopaque,
    validate: *const fn (?*anyopaque) bool,
};

pub fn loreErrorJsonAlloc(
    allocator: std.mem.Allocator,
    code: LoreErrorCodeV1,
    detail: []const u8,
) ![]u8 {
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = false,
        .version = 1,
        .code = code,
        .detail = detail,
    }, .{});
}

pub fn loreErrorWithGenerationJsonAlloc(
    allocator: std.mem.Allocator,
    code: LoreErrorCodeV1,
    detail: []const u8,
    current_generation: u64,
) ![]u8 {
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = false,
        .version = 1,
        .code = code,
        .detail = detail,
        .currentGeneration = current_generation,
    }, .{});
}

pub fn loreErrorForNativeErrorJsonAlloc(allocator: std.mem.Allocator, err: anyerror) ![]u8 {
    // A bounded interactive caller hit the busy gate. Name the holder so a
    // wedged or long-running background call (retention prune, network push)
    // is visible in the receipt instead of showing up as a frozen UI.
    if (err == error.LoreGateBusy) {
        if (lore.gateHolderView()) |holder| {
            const detail = try std.fmt.allocPrint(
                allocator,
                "Lore is busy: {s} has held the native gate for {d}s; try again in a moment",
                .{ holder.verb, @divTrunc(holder.held_ms, 1000) },
            );
            defer allocator.free(detail);
            return loreErrorJsonAlloc(allocator, .busy, detail);
        }
        return loreErrorJsonAlloc(allocator, .busy, "Lore is busy; try again in a moment");
    }
    const code: LoreErrorCodeV1 = switch (err) {
        error.LoreUnavailable => .library_unavailable,
        error.SnapshotNotFound => .snapshot_not_found,
        error.SnapshotExpired => .snapshot_expired,
        error.StaleHistoryRow => .stale_history_row,
        error.SnapshotHashMismatch, error.InvalidSnapshotHash => .hash_mismatch,
        error.RestoreReadbackMismatch,
        error.RestoreResidentMismatch,
        error.WrongObjectNamespace,
        error.RestoreCandidateNamespaceMismatch,
        => .hash_mismatch,
        error.NoResidentSession => .no_resident_session,
        error.WrongModel => .wrong_model,
        error.StaleGeneration => .stale_generation,
        error.InvalidRequest,
        error.InvalidModelId,
        error.InvalidSnapshotId,
        error.InvalidRevision,
        error.InvalidHistoryCursor,
        error.SnapshotIdRequired,
        => .invalid_request,
        error.VerifiedSaveHashMismatch,
        error.InvalidVerifiedSaveArtifact,
        => .hash_mismatch,
        error.SaveReceiptNotFound,
        error.SaveReceiptWrongModel,
        error.InvalidVerifiedSaveTarget,
        error.ModelWriteLeaseRefused,
        error.ObjectIdsUnpublished,
        error.ModelPackageNotFound,
        error.AmbiguousModelPackage,
        error.PackageManifestChanged,
        => .authorization_failed,
        error.DegradedRestoreCandidate => .corrupt_event,
        error.ReleasedCapability => .released_capability,
        error.CapabilityWrongModel => .wrong_model,
        error.CapabilityStaleGuard => .stale_history_row,
        error.InvalidCapabilityArtifact => .hash_mismatch,
        else => .internal_error,
    };
    return loreErrorJsonAlloc(allocator, code, @errorName(err));
}

pub fn parsePanicSnapshotRequestV1(
    allocator: std.mem.Allocator,
    request_json: []const u8,
) !std.json.Parsed(PanicSnapshotRequestV1) {
    var parsed = std.json.parseFromSlice(PanicSnapshotRequestV1, allocator, request_json, .{}) catch
        return error.InvalidRequest;
    errdefer parsed.deinit();
    if (parsed.value.version != 1 or
        parsed.value.modelId.len == 0 or
        parsed.value.sessionToken.len == 0 or
        parsed.value.label.len == 0)
    {
        return error.InvalidRequest;
    }
    return parsed;
}

pub fn parseVerifiedSaveReceiptIssueRequestV1(
    allocator: std.mem.Allocator,
    request_json: []const u8,
) !std.json.Parsed(VerifiedSaveReceiptIssueRequestV1) {
    var parsed = std.json.parseFromSlice(VerifiedSaveReceiptIssueRequestV1, allocator, request_json, .{}) catch
        return error.InvalidRequest;
    errdefer parsed.deinit();
    if (parsed.value.version != 1 or
        parsed.value.modelId.len == 0 or
        parsed.value.packageGeometryPath.len == 0 or
        !validSha256(parsed.value.expectedSha256))
    {
        return error.InvalidRequest;
    }
    return parsed;
}

pub fn parseNormalSnapshotRequestV1(
    allocator: std.mem.Allocator,
    request_json: []const u8,
) !std.json.Parsed(NormalSnapshotRequestV1) {
    var parsed = std.json.parseFromSlice(NormalSnapshotRequestV1, allocator, request_json, .{}) catch
        return error.InvalidRequest;
    errdefer parsed.deinit();
    if (parsed.value.version != 1 or
        parsed.value.modelId.len == 0 or
        parsed.value.saveReceiptToken.len != VERIFIED_SAVE_RECEIPT_PREFIX.len + VERIFIED_SAVE_RECEIPT_ENTROPY_BYTES * 2 or
        !std.mem.startsWith(u8, parsed.value.saveReceiptToken, VERIFIED_SAVE_RECEIPT_PREFIX) or
        parsed.value.label.len == 0)
    {
        return error.InvalidRequest;
    }
    for (parsed.value.saveReceiptToken[VERIFIED_SAVE_RECEIPT_PREFIX.len..]) |byte| {
        if (!std.ascii.isHex(byte) or std.ascii.isUpper(byte)) return error.InvalidRequest;
    }
    return parsed;
}

/// Mirrors `modelDocumentToken` in cart/editor/model/nativeMeshEvents.ts. Model
/// package IDs are UTF-8; ASCII is the durable package namespace in v1.
pub fn modelDocumentToken(model_id: []const u8) u32 {
    var hash: u32 = 0x811c9dc5;
    for (model_id) |byte| hash = (hash ^ byte) *% 0x01000193;
    const token = hash & 0x7fff_ffff;
    return if (token == 0) 1 else token;
}

pub fn validatePanicSession(
    request: *const PanicSnapshotRequestV1,
    active_token: u32,
    current_generation: u64,
) !void {
    if (active_token == 0) return error.NoResidentSession;
    if (modelDocumentToken(request.modelId) != active_token) return error.WrongModel;
    const requested_token = std.fmt.parseInt(u32, request.sessionToken, 10) catch return error.WrongModel;
    if (requested_token != active_token) return error.WrongModel;
    if (request.expectedGeneration != current_generation) return error.StaleGeneration;
}

const SnapshotRequest = struct {
    version: u32 = 0,
    modelId: []const u8,
    label: []const u8 = "Snapshot",
    note: ?[]const u8 = null,
    packageGeometryPath: []const u8 = "",
    objectIds: ?[][]const u8 = null,
    kind: SnapshotKind = .panic,
    push: bool = false,
};

const ModelRequest = struct {
    modelId: []const u8,
    limit: u32 = DEFAULT_HISTORY,
    cursor: []const u8 = "",
};

const RevisionRequest = struct {
    modelId: []const u8,
    snapshotId: []const u8 = "",
    expectedRevision: ?[]const u8 = null,
    expectedSha256: ?[]const u8 = null,
    // Transitional caller compatibility. This may locate an immutable index
    // row, but it never opens the retired shared resident/event paths.
    revision: []const u8 = "",
};

const PreviewOperationV1 = enum { open, release };

const PreviewRequestV1 = struct {
    version: u32,
    operation: PreviewOperationV1,
    modelId: ?[]const u8 = null,
    snapshotId: ?[]const u8 = null,
    expectedRevision: ?[]const u8 = null,
    expectedSha256: ?[]const u8 = null,
    capabilityToken: ?[]const u8 = null,
};

const RestoreCandidateOperationV1 = enum { open_candidate, release_candidate };

const RestoreCandidateRequestV1 = struct {
    version: u32,
    operation: RestoreCandidateOperationV1,
    modelId: ?[]const u8 = null,
    snapshotId: ?[]const u8 = null,
    expectedRevision: ?[]const u8 = null,
    expectedSha256: ?[]const u8 = null,
    candidateToken: ?[]const u8 = null,
};

const RestoreRequest = struct {
    modelId: []const u8,
    snapshotId: []const u8 = "",
    expectedRevision: ?[]const u8 = null,
    expectedSha256: ?[]const u8 = null,
    revision: []const u8 = "",
    packageGeometryPath: []const u8,
};

const PinRequest = struct {
    modelId: []const u8,
    snapshotId: []const u8 = "",
    expectedRevision: ?[]const u8 = null,
    expectedSha256: ?[]const u8 = null,
    revision: []const u8 = "",
    pinned: bool,
    push: bool = true,
};

const StatusRequest = struct {
    serverStorePath: []const u8 = DEFAULT_SERVER_STORE,
};

const HistoryRequestV1 = struct {
    version: u32,
    modelId: []const u8,
    cursor: ?[]const u8 = null,
    limit: ?u32 = null,
};

const PinRequestV1 = struct {
    version: u32,
    modelId: []const u8,
    snapshotId: []const u8,
    expectedRevision: ?[]const u8 = null,
    expectedSha256: ?[]const u8 = null,
    pinned: bool,
    push: bool,
};

const StatusRequestV1 = struct { version: u32 };

const SnapshotMetadata = struct {
    version: u32 = 2,
    snapshotId: []const u8 = "",
    timestampMs: i64,
    sequence: u64,
    captureId: []const u8 = "",
    modelId: []const u8,
    label: []const u8,
    note: []const u8,
    kind: []const u8,
    packageGeometryPath: []const u8,
    sha256: []const u8,
    sourceSha256: []const u8 = "",
    byteLength: u64,
    triangleCount: u64,
    authoredFaceCount: u64 = 0,
    partCount: u64,
    logicalVertexCount: u32,
    identityQuality: []const u8 = "degraded",
    objectNamespaceHash: []const u8 = "",
    recoveryDegradations: []const RecoveryDegradationV1 = &.{},
    residentPath: []const u8 = "",
    eventPath: []const u8 = "",
    /// Set only on immutable rows migrated from the retired shared layout.
    /// This is the durable old-revision -> new-snapshot identity proof used by
    /// crash retries; ordinary captures leave it empty.
    legacySourceRevision: []const u8 = "",
    legacySourceEventSha256: []const u8 = "",
};

fn dupeDegradations(
    allocator: std.mem.Allocator,
    source: []const RecoveryDegradationV1,
) ![]RecoveryDegradationV1 {
    const rows = try allocator.alloc(RecoveryDegradationV1, source.len);
    errdefer allocator.free(rows);
    var initialized: usize = 0;
    errdefer for (rows[0..initialized]) |row| {
        allocator.free(row.actions);
        allocator.free(row.reasons);
    };
    for (source, rows) |row, *target| {
        const actions = try allocator.dupe(RecoveryDegradationActionV1, row.actions);
        errdefer allocator.free(actions);
        const reasons = try allocator.dupe(RecoveryDegradationReasonV1, row.reasons);
        target.* = .{
            .channel = row.channel,
            .actions = actions,
            .reasons = reasons,
            .affectedCount = row.affectedCount,
        };
        initialized += 1;
    }
    return rows;
}

fn freeDegradations(allocator: std.mem.Allocator, rows: []RecoveryDegradationV1) void {
    for (rows) |row| {
        allocator.free(row.actions);
        allocator.free(row.reasons);
    }
    allocator.free(rows);
}

const OwnedMetadata = struct {
    version: u32 = 0,
    snapshot_id: []u8,
    timestamp_ms: i64 = 0,
    sequence: u64 = 0,
    capture_id: []u8,
    model_id: []u8,
    label: []u8,
    note: []u8,
    kind: []u8,
    package_geometry_path: []u8,
    sha256: []u8,
    source_sha256: []u8,
    byte_length: u64 = 0,
    triangle_count: u64 = 0,
    authored_face_count: u64 = 0,
    part_count: u64 = 0,
    logical_vertex_count: u32 = 0,
    identity_quality: []u8,
    object_namespace_hash: []u8,
    recovery_degradations: []RecoveryDegradationV1,
    resident_path: []u8,
    event_path: []u8,
    legacy_source_revision: []u8,
    legacy_source_event_sha256: []u8,

    fn empty(allocator: std.mem.Allocator) !OwnedMetadata {
        const snapshot_id = try allocator.dupe(u8, "");
        errdefer allocator.free(snapshot_id);
        const model_id = try allocator.dupe(u8, "");
        errdefer allocator.free(model_id);
        const capture_id = try allocator.dupe(u8, "");
        errdefer allocator.free(capture_id);
        const label = try allocator.dupe(u8, "");
        errdefer allocator.free(label);
        const note = try allocator.dupe(u8, "");
        errdefer allocator.free(note);
        const kind = try allocator.dupe(u8, "");
        errdefer allocator.free(kind);
        const package_path = try allocator.dupe(u8, "");
        errdefer allocator.free(package_path);
        const sha = try allocator.dupe(u8, "");
        errdefer allocator.free(sha);
        const source_sha = try allocator.dupe(u8, "");
        errdefer allocator.free(source_sha);
        const identity_quality = try allocator.dupe(u8, "degraded");
        errdefer allocator.free(identity_quality);
        const object_namespace_hash = try allocator.dupe(u8, "");
        errdefer allocator.free(object_namespace_hash);
        const recovery_degradations = try allocator.alloc(RecoveryDegradationV1, 0);
        errdefer allocator.free(recovery_degradations);
        const resident_path = try allocator.dupe(u8, "");
        errdefer allocator.free(resident_path);
        const event_path = try allocator.dupe(u8, "");
        errdefer allocator.free(event_path);
        const legacy_source_revision = try allocator.dupe(u8, "");
        errdefer allocator.free(legacy_source_revision);
        const legacy_source_event_sha256 = try allocator.dupe(u8, "");
        return .{
            .snapshot_id = snapshot_id,
            .capture_id = capture_id,
            .model_id = model_id,
            .label = label,
            .note = note,
            .kind = kind,
            .package_geometry_path = package_path,
            .sha256 = sha,
            .source_sha256 = source_sha,
            .identity_quality = identity_quality,
            .object_namespace_hash = object_namespace_hash,
            .recovery_degradations = recovery_degradations,
            .resident_path = resident_path,
            .event_path = event_path,
            .legacy_source_revision = legacy_source_revision,
            .legacy_source_event_sha256 = legacy_source_event_sha256,
        };
    }

    fn fromParsed(allocator: std.mem.Allocator, value: SnapshotMetadata) !OwnedMetadata {
        const snapshot_id = try allocator.dupe(u8, value.snapshotId);
        errdefer allocator.free(snapshot_id);
        const model_id = try allocator.dupe(u8, value.modelId);
        errdefer allocator.free(model_id);
        const capture_id = try allocator.dupe(u8, value.captureId);
        errdefer allocator.free(capture_id);
        const label = try allocator.dupe(u8, value.label);
        errdefer allocator.free(label);
        const note = try allocator.dupe(u8, value.note);
        errdefer allocator.free(note);
        const kind = try allocator.dupe(u8, value.kind);
        errdefer allocator.free(kind);
        const package_path = try allocator.dupe(u8, value.packageGeometryPath);
        errdefer allocator.free(package_path);
        const sha = try allocator.dupe(u8, value.sha256);
        errdefer allocator.free(sha);
        const source_sha = try allocator.dupe(u8, if (value.sourceSha256.len > 0) value.sourceSha256 else value.sha256);
        errdefer allocator.free(source_sha);
        const identity_quality = try allocator.dupe(u8, value.identityQuality);
        errdefer allocator.free(identity_quality);
        const object_namespace_hash = try allocator.dupe(u8, if (value.objectNamespaceHash.len > 0) value.objectNamespaceHash else value.sha256);
        errdefer allocator.free(object_namespace_hash);
        const source_degradations = if (!std.mem.eql(u8, value.identityQuality, "exact") and value.recoveryDegradations.len == 0)
            @as([]const RecoveryDegradationV1, &historical_degraded_rows)
        else
            value.recoveryDegradations;
        const recovery_degradations = try dupeDegradations(allocator, source_degradations);
        errdefer freeDegradations(allocator, recovery_degradations);
        const resident_path = try allocator.dupe(u8, value.residentPath);
        errdefer allocator.free(resident_path);
        const event_path = try allocator.dupe(u8, value.eventPath);
        errdefer allocator.free(event_path);
        const legacy_source_revision = try allocator.dupe(u8, value.legacySourceRevision);
        errdefer allocator.free(legacy_source_revision);
        const legacy_source_event_sha256 = try allocator.dupe(u8, value.legacySourceEventSha256);
        return .{
            .version = value.version,
            .snapshot_id = snapshot_id,
            .timestamp_ms = value.timestampMs,
            .sequence = value.sequence,
            .capture_id = capture_id,
            .model_id = model_id,
            .label = label,
            .note = note,
            .kind = kind,
            .package_geometry_path = package_path,
            .sha256 = sha,
            .source_sha256 = source_sha,
            .byte_length = value.byteLength,
            .triangle_count = value.triangleCount,
            .authored_face_count = value.authoredFaceCount,
            .part_count = value.partCount,
            .logical_vertex_count = value.logicalVertexCount,
            .identity_quality = identity_quality,
            .object_namespace_hash = object_namespace_hash,
            .recovery_degradations = recovery_degradations,
            .resident_path = resident_path,
            .event_path = event_path,
            .legacy_source_revision = legacy_source_revision,
            .legacy_source_event_sha256 = legacy_source_event_sha256,
        };
    }

    fn deinit(self: *OwnedMetadata, allocator: std.mem.Allocator) void {
        allocator.free(self.snapshot_id);
        allocator.free(self.capture_id);
        allocator.free(self.model_id);
        allocator.free(self.label);
        allocator.free(self.note);
        allocator.free(self.kind);
        allocator.free(self.package_geometry_path);
        allocator.free(self.sha256);
        allocator.free(self.source_sha256);
        allocator.free(self.identity_quality);
        allocator.free(self.object_namespace_hash);
        freeDegradations(allocator, self.recovery_degradations);
        allocator.free(self.resident_path);
        allocator.free(self.event_path);
        allocator.free(self.legacy_source_revision);
        allocator.free(self.legacy_source_event_sha256);
        self.* = undefined;
    }
};

pub const HistoryItemV1 = struct {
    snapshotId: []u8,
    revision: []u8,
    revisionNumber: u64,
    timestampMs: i64,
    sequence: u64,
    label: []u8,
    note: []u8,
    kind: []u8,
    sha256: []u8,
    byteLength: u64,
    bytes: u64,
    triangleCount: u64,
    triangles: u64,
    authoredFaces: u64,
    partCount: u64,
    parts: u64,
    logicalVertexCount: u32,
    logicalVertices: u32,
    pinned: bool,
    expiresAtMs: i64,
    pushState: []const u8,
    identityQuality: []u8,
    objectNamespaceHash: []u8,
    recoveryDegradations: []RecoveryDegradationV1,
    warning: ?[]const u8,

    fn deinit(self: *HistoryItemV1, allocator: std.mem.Allocator) void {
        allocator.free(self.snapshotId);
        allocator.free(self.revision);
        allocator.free(self.label);
        allocator.free(self.note);
        allocator.free(self.kind);
        allocator.free(self.sha256);
        allocator.free(self.identityQuality);
        allocator.free(self.objectNamespaceHash);
        freeDegradations(allocator, self.recoveryDegradations);
        self.* = undefined;
    }
};

/// Canonical v1 history-envelope serializer used by both the live Lore door
/// and the cross-language wire-contract fixture. `items` is generic so the
/// deterministic fixture can use immutable string literals while production
/// retains its allocator-owned HistoryItemV1 rows.
pub fn historyReceiptJsonAlloc(
    allocator: std.mem.Allocator,
    model_id: []const u8,
    cursor: ?[]const u8,
    next_cursor: ?[]const u8,
    items: anytype,
    indexed_repair: []const u8,
) ![]u8 {
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = true,
        .version = 1,
        .modelId = model_id,
        .state = if (items.len == 0) "empty" else "ready",
        .cursor = cursor,
        .nextCursor = next_cursor,
        .entries = items,
        .rows = items,
        .indexedRepair = indexed_repair,
    }, .{});
}

const PinRegistryWire = struct {
    version: u32 = 2,
    pinned: [][]const u8 = &.{},
    legacyRevisions: [][]const u8 = &.{},
};

const OwnedPins = struct {
    values: [][]const u8,
    legacy_revisions: [][]const u8,

    fn deinit(self: *OwnedPins, allocator: std.mem.Allocator) void {
        for (self.values) |value| allocator.free(value);
        allocator.free(self.values);
        for (self.legacy_revisions) |value| allocator.free(value);
        allocator.free(self.legacy_revisions);
        self.* = undefined;
    }

    fn contains(self: *const OwnedPins, snapshot_id: []const u8) bool {
        for (self.values) |value| if (std.mem.eql(u8, value, snapshot_id)) return true;
        return false;
    }
};

const HistoryIndexEntry = struct {
    snapshotId: []u8,
    timestampMs: i64,
    eventPath: []u8,
    residentPath: []u8,

    fn deinit(self: *HistoryIndexEntry, allocator: std.mem.Allocator) void {
        allocator.free(self.snapshotId);
        allocator.free(self.eventPath);
        allocator.free(self.residentPath);
        self.* = undefined;
    }
};

const HistoryIndexWire = struct {
    version: u32 = 1,
    entries: []const HistoryIndexEntry = &.{},
};

const OwnedHistoryIndex = struct {
    entries: []HistoryIndexEntry,

    fn deinit(self: *OwnedHistoryIndex, allocator: std.mem.Allocator) void {
        for (self.entries) |*entry| entry.deinit(allocator);
        allocator.free(self.entries);
        self.* = undefined;
    }
};

const Paths = struct {
    key: []u8,
    directory_lore: []u8,
    // Retired shared paths remain named only for the permanent cutover
    // scanner. Ordinary capture/history/preview/restore/pin never use them.
    resident_lore: []u8,
    event_lore: []u8,
    revisions_lore: []u8,
    index_lore: []u8,
    pins_lore: []u8,
    directory_full: []u8,
    resident_full: []u8,
    event_full: []u8,
    revisions_full: []u8,
    index_full: []u8,
    pins_full: []u8,

    fn init(allocator: std.mem.Allocator, model_id: []const u8) !Paths {
        const key = try modelKeyAlloc(allocator, model_id);
        errdefer allocator.free(key);
        const directory_lore = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ SNAPSHOT_ROOT, key });
        errdefer allocator.free(directory_lore);
        const resident_lore = try std.fmt.allocPrint(allocator, "{s}/resident.rjmd", .{directory_lore});
        errdefer allocator.free(resident_lore);
        const event_lore = try std.fmt.allocPrint(allocator, "{s}/event.json", .{directory_lore});
        errdefer allocator.free(event_lore);
        const revisions_lore = try std.fmt.allocPrint(allocator, "{s}/revisions", .{directory_lore});
        errdefer allocator.free(revisions_lore);
        const index_lore = try std.fmt.allocPrint(allocator, "{s}/history-index.json", .{directory_lore});
        errdefer allocator.free(index_lore);
        const pins_lore = try std.fmt.allocPrint(allocator, "{s}/pins.json", .{directory_lore});
        errdefer allocator.free(pins_lore);
        const directory_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, directory_lore });
        errdefer allocator.free(directory_full);
        const resident_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, resident_lore });
        errdefer allocator.free(resident_full);
        const event_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, event_lore });
        errdefer allocator.free(event_full);
        const revisions_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, revisions_lore });
        errdefer allocator.free(revisions_full);
        const index_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, index_lore });
        errdefer allocator.free(index_full);
        const pins_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, pins_lore });
        return .{
            .key = key,
            .directory_lore = directory_lore,
            .resident_lore = resident_lore,
            .event_lore = event_lore,
            .revisions_lore = revisions_lore,
            .index_lore = index_lore,
            .pins_lore = pins_lore,
            .directory_full = directory_full,
            .resident_full = resident_full,
            .event_full = event_full,
            .revisions_full = revisions_full,
            .index_full = index_full,
            .pins_full = pins_full,
        };
    }

    fn deinit(self: *Paths, allocator: std.mem.Allocator) void {
        allocator.free(self.key);
        allocator.free(self.directory_lore);
        allocator.free(self.resident_lore);
        allocator.free(self.event_lore);
        allocator.free(self.revisions_lore);
        allocator.free(self.index_lore);
        allocator.free(self.pins_lore);
        allocator.free(self.directory_full);
        allocator.free(self.resident_full);
        allocator.free(self.event_full);
        allocator.free(self.revisions_full);
        allocator.free(self.index_full);
        allocator.free(self.pins_full);
        self.* = undefined;
    }
};

const SnapshotPaths = struct {
    directory_lore: []u8,
    resident_lore: []u8,
    event_lore: []u8,
    directory_full: []u8,
    resident_full: []u8,
    event_full: []u8,

    fn init(allocator: std.mem.Allocator, paths: *const Paths, snapshot_id: []const u8) !SnapshotPaths {
        if (!validSnapshotId(snapshot_id)) return error.InvalidSnapshotId;
        const directory_lore = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ paths.revisions_lore, snapshot_id });
        errdefer allocator.free(directory_lore);
        const resident_lore = try std.fmt.allocPrint(allocator, "{s}/resident.rjmd", .{directory_lore});
        errdefer allocator.free(resident_lore);
        const event_lore = try std.fmt.allocPrint(allocator, "{s}/event.json", .{directory_lore});
        errdefer allocator.free(event_lore);
        const directory_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, directory_lore });
        errdefer allocator.free(directory_full);
        const resident_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, resident_lore });
        errdefer allocator.free(resident_full);
        const event_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, event_lore });
        return .{
            .directory_lore = directory_lore,
            .resident_lore = resident_lore,
            .event_lore = event_lore,
            .directory_full = directory_full,
            .resident_full = resident_full,
            .event_full = event_full,
        };
    }

    fn deinit(self: *SnapshotPaths, allocator: std.mem.Allocator) void {
        allocator.free(self.directory_lore);
        allocator.free(self.resident_lore);
        allocator.free(self.event_lore);
        allocator.free(self.directory_full);
        allocator.free(self.resident_full);
        allocator.free(self.event_full);
        self.* = undefined;
    }
};

fn parseRequest(comptime T: type, allocator: std.mem.Allocator, json: []const u8) !std.json.Parsed(T) {
    return std.json.parseFromSlice(T, allocator, json, .{ .ignore_unknown_fields = true });
}

fn repositoryPathAlloc(io: std.Io, allocator: std.mem.Allocator) ![:0]u8 {
    return std.Io.Dir.cwd().realPathFileAlloc(io, REPOSITORY_PATH, allocator);
}

fn acquireMutationLock(io: std.Io) !fs.TargetWriteLock {
    const cwd = std.Io.Dir.cwd();
    try cwd.createDirPath(io, REPOSITORY_PATH ++ "/" ++ SNAPSHOT_ROOT);
    return fs.acquireTargetWriteLock(io, cwd, MUTATION_LOCK_TARGET);
}

/// Interactive callers bound their wait for the repository mutation lock the
/// same way they bound the liblore call gate: while a maintenance cycle or
/// another transaction holds it past the caller's budget, this returns
/// `error.LoreGateBusy` (mapped to a busy receipt) instead of freezing the
/// frame thread on the blocking flock. Background callers with no declared
/// budget keep the original blocking acquire.
fn acquireMutationLockRespectingBudget(io: std.Io) !fs.TargetWriteLock {
    const budget_ms = lore.interactiveGateBudgetMs() orelse return acquireMutationLock(io);
    const cwd = std.Io.Dir.cwd();
    try cwd.createDirPath(io, REPOSITORY_PATH ++ "/" ++ SNAPSHOT_ROOT);
    const retry_step_ms: u32 = 25;
    var waited_ms: u32 = 0;
    while (true) {
        if (fs.tryAcquireTargetWriteLock(io, cwd, MUTATION_LOCK_TARGET)) |lock| {
            return lock;
        } else |err| if (err != error.WouldBlock) return err;
        if (waited_ms >= budget_ms) return error.LoreGateBusy;
        std.Io.sleep(io, .fromMilliseconds(retry_step_ms), .awake) catch return error.LoreGateBusy;
        waited_ms += retry_step_ms;
    }
}

fn acquirePushLock(io: std.Io) !fs.TargetWriteLock {
    return fs.acquireTargetWriteLock(io, std.Io.Dir.cwd(), PUSH_LOCK_TARGET);
}

pub fn writeDurableAtomic(io: std.Io, path: []const u8, bytes: []const u8) !void {
    const cwd = std.Io.Dir.cwd();
    try fs.writeAtomic(io, cwd, path, bytes);
    var file = try cwd.openFile(io, path, .{});
    defer file.close(io);
    try file.sync(io);
}

fn modelKeyAlloc(allocator: std.mem.Allocator, model_id: []const u8) ![]u8 {
    if (model_id.len == 0 or model_id.len > 4096) return error.InvalidModelId;
    var prefix: [48]u8 = undefined;
    var prefix_len: usize = 0;
    for (model_id) |byte| {
        if (prefix_len == prefix.len) break;
        prefix[prefix_len] = if (std.ascii.isAlphanumeric(byte) or byte == '-' or byte == '_') byte else '-';
        prefix_len += 1;
    }
    if (prefix_len == 0) {
        @memcpy(prefix[0..5], "model");
        prefix_len = 5;
    }
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(model_id, &digest, .{});
    const hex = std.fmt.bytesToHex(digest, .lower);
    return std.fmt.allocPrint(allocator, "{s}-{s}", .{ prefix[0..prefix_len], hex[0..16] });
}

fn hashHex(bytes: []const u8) [64]u8 {
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    return std.fmt.bytesToHex(digest, .lower);
}

fn validSha256(value: []const u8) bool {
    if (value.len != 64) return false;
    for (value) |byte| {
        if (!std.ascii.isHex(byte) or std.ascii.isUpper(byte)) return false;
    }
    return true;
}

fn revisionHex(hash: lore.Hash) [64]u8 {
    return std.fmt.bytesToHex(hash, .lower);
}

fn validRevision(value: []const u8) bool {
    if (value.len != 64) return false;
    for (value) |byte| if (!std.ascii.isHex(byte)) return false;
    return true;
}

pub fn validSnapshotId(value: []const u8) bool {
    if (value.len != SNAPSHOT_ID_LENGTH or value[SNAPSHOT_ID_TIMESTAMP_DIGITS] != '-') return false;
    for (value[0..SNAPSHOT_ID_TIMESTAMP_DIGITS]) |byte| if (!std.ascii.isDigit(byte)) return false;
    for (value[SNAPSHOT_ID_TIMESTAMP_DIGITS + 1 ..]) |byte| if (!std.ascii.isHex(byte)) return false;
    return true;
}

const SnapshotReservation = struct {
    id: []u8,
    paths: SnapshotPaths,

    fn deinit(self: *SnapshotReservation, allocator: std.mem.Allocator) void {
        allocator.free(self.id);
        self.paths.deinit(allocator);
        self.* = undefined;
    }
};

pub fn snapshotIdTimestampMs(value: []const u8) !i64 {
    if (!validSnapshotId(value)) return error.InvalidSnapshotId;
    return std.fmt.parseInt(i64, value[0..SNAPSHOT_ID_TIMESTAMP_DIGITS], 10);
}

pub fn snapshotExpiresAtMs(timestamp_ms: i64) !i64 {
    if (timestamp_ms < 0) return error.InvalidSnapshotTimestamp;
    return std.math.add(i64, timestamp_ms, RETENTION_MILLISECONDS) catch error.SnapshotTimestampOverflow;
}

pub fn snapshotIsExpired(timestamp_ms: i64, now_ms: i64) !bool {
    if (now_ms < 0) return error.InvalidSnapshotTimestamp;
    return now_ms >= try snapshotExpiresAtMs(timestamp_ms);
}

pub const RetentionEntry = struct {
    snapshot_id: []const u8,
    timestamp_ms: i64,
    pinned: bool,
};

pub const RetentionPlan = struct {
    expired_snapshot_ids: [][]const u8,
    retained_pin_ids: [][]const u8,

    pub fn deinit(self: *RetentionPlan, allocator: std.mem.Allocator) void {
        allocator.free(self.expired_snapshot_ids);
        allocator.free(self.retained_pin_ids);
        self.* = undefined;
    }
};

/// Pure logical pruning plan. Pins are retained only while their snapshots are
/// inside the active window; a pin is never an exemption from the hard ceiling.
pub fn retentionPlanAlloc(
    allocator: std.mem.Allocator,
    entries: []const RetentionEntry,
    now_ms: i64,
) !RetentionPlan {
    var expired: std.ArrayList([]const u8) = .empty;
    defer expired.deinit(allocator);
    var retained_pins: std.ArrayList([]const u8) = .empty;
    defer retained_pins.deinit(allocator);
    for (entries) |entry| {
        if (!validSnapshotId(entry.snapshot_id)) return error.InvalidSnapshotId;
        if (try snapshotIsExpired(entry.timestamp_ms, now_ms)) {
            try expired.append(allocator, entry.snapshot_id);
        } else if (entry.pinned) {
            try retained_pins.append(allocator, entry.snapshot_id);
        }
    }
    const expired_owned = try expired.toOwnedSlice(allocator);
    errdefer allocator.free(expired_owned);
    return .{
        .expired_snapshot_ids = expired_owned,
        .retained_pin_ids = try retained_pins.toOwnedSlice(allocator),
    };
}

fn snapshotIdAlloc(
    io: std.Io,
    allocator: std.mem.Allocator,
    paths: *const Paths,
    timestamp_ms: i64,
) !SnapshotReservation {
    if (timestamp_ms < 0 or timestamp_ms > 9_999_999_999_999) return error.InvalidSnapshotTimestamp;
    const cwd = std.Io.Dir.cwd();
    try fs.makePathDurable(io, cwd, paths.revisions_full);
    for (0..16) |_| {
        var entropy: [SNAPSHOT_ID_ENTROPY_BYTES]u8 = undefined;
        try io.randomSecure(&entropy);
        const entropy_hex = std.fmt.bytesToHex(entropy, .lower);
        const id = try std.fmt.allocPrint(allocator, "{d:0>13}-{s}", .{ @as(u64, @intCast(timestamp_ms)), entropy_hex[0..] });
        errdefer allocator.free(id);
        var snapshot_paths = try SnapshotPaths.init(allocator, paths, id);
        errdefer snapshot_paths.deinit(allocator);
        cwd.createDir(io, snapshot_paths.directory_full, .default_dir) catch |err| switch (err) {
            error.PathAlreadyExists => {
                snapshot_paths.deinit(allocator);
                allocator.free(id);
                continue;
            },
            else => return err,
        };
        return .{ .id = id, .paths = snapshot_paths };
    }
    return error.SnapshotIdCollision;
}

/// Stable migration identity. The original Lore revision remains embedded in
/// the migrated event, while its first 128 bits provide the collision-resistant
/// entropy portion expected by the immutable snapshot ID format.
fn legacySnapshotId(
    timestamp_ms: i64,
    source_revision: []const u8,
) ![SNAPSHOT_ID_LENGTH]u8 {
    if (timestamp_ms < 0 or timestamp_ms > 9_999_999_999_999)
        return error.InvalidSnapshotTimestamp;
    if (!validRevision(source_revision)) return error.InvalidRevision;
    var result: [SNAPSHOT_ID_LENGTH]u8 = undefined;
    const text = std.fmt.bufPrint(&result, "{d:0>13}-{s}", .{
        @as(u64, @intCast(timestamp_ms)),
        source_revision[0 .. SNAPSHOT_ID_ENTROPY_BYTES * 2],
    }) catch return error.InvalidSnapshotTimestamp;
    if (text.len != result.len) return error.InvalidSnapshotTimestamp;
    return result;
}

fn safeRanges(ranges: ?[]const u32) []const u32 {
    const rows = ranges orelse return &.{};
    if (rows.len == 0 or rows.len % 2 != 0) return &.{};
    const count: u32 = @intCast(rows.len / 2);
    return if (meshdoc_format.rangesValid(rows, count)) rows else &.{};
}

const EncodedResident = struct {
    bytes: []u8,
    part_count: u64,
    logical_vertex_count: u32,
    source_sha256: [64]u8 = [_]u8{'0'} ** 64,
    object_namespace_hash: [64]u8 = [_]u8{'0'} ** 64,
    degradations: [7]RecoveryDegradationV1 = undefined,
    degradation_count: usize = 0,
};

pub const RecoveryDegradationChannelV1 = enum {
    object_ids,
    range_membership,
    face_groups,
    materials,
    semantic_membership,
    semantic_table,
    logical_topology,
};
pub const RecoveryDegradationActionV1 = enum { synthesized, repaired, defaulted, dropped };
pub const RecoveryDegradationReasonV1 = enum {
    missing_or_duplicate_object_id,
    incoherent_range_membership,
    anonymous_or_invalid_group,
    invalid_material_index,
    invalid_semantic_membership,
    invalid_semantic_table,
    missing_or_invalid_logical_topology,
};
pub const RecoveryDegradationV1 = struct {
    channel: RecoveryDegradationChannelV1,
    actions: []const RecoveryDegradationActionV1,
    reasons: []const RecoveryDegradationReasonV1,
    affectedCount: u64,
};

pub const CapturedRecoveryDegradationSlotV1 = struct {
    /// 1..7 maps exactly to RecoveryDegradationChannelV1 declaration order.
    channel: u32,
    action_bits: u32,
    reason_bits: u64,
    affected_count: u64,
};

/// Cold-host view of the fixed Scene3D recovery metadata. Bytes remain owned by
/// the caller for the synchronous append; this boundary validates and commits
/// them verbatim and never stamps or re-encodes them.
pub const CapturedRecoveryArtifactV1 = struct {
    bytes: []u8,
    schema_version: u32,
    rjmd_version: u32,
    generation: u64,
    byte_len: u64,
    triangle_count: u64,
    authored_face_count: u64,
    part_count: u32,
    logical_vertex_count: u32,
    sha256: [32]u8,
    model_id_hash: [32]u8,
    session_token_hash: [32]u8,
    object_namespace_hash: [32]u8,
    identity_quality: u32,
    degradations: []const CapturedRecoveryDegradationSlotV1,
};

const RecoveryProvenanceEnvelopeV1 = struct {
    version: u32,
    identityQuality: []const u8,
    objectNamespaceHash: []const u8,
    recoveryDegradations: []const RecoveryDegradationV1,
};

const RecoverySemanticProbeV1 = struct {
    recoveryProvenance: ?RecoveryProvenanceEnvelopeV1 = null,
};

const action_synthesized = [_]RecoveryDegradationActionV1{.synthesized};
const action_repaired = [_]RecoveryDegradationActionV1{.repaired};
const action_defaulted = [_]RecoveryDegradationActionV1{.defaulted};
const action_dropped = [_]RecoveryDegradationActionV1{.dropped};
const reason_object_id = [_]RecoveryDegradationReasonV1{.missing_or_duplicate_object_id};
const reason_range = [_]RecoveryDegradationReasonV1{.incoherent_range_membership};
const reason_group = [_]RecoveryDegradationReasonV1{.anonymous_or_invalid_group};
const reason_material = [_]RecoveryDegradationReasonV1{.invalid_material_index};
const reason_semantic_membership = [_]RecoveryDegradationReasonV1{.invalid_semantic_membership};
const reason_semantic_table = [_]RecoveryDegradationReasonV1{.invalid_semantic_table};
const reason_logical = [_]RecoveryDegradationReasonV1{.missing_or_invalid_logical_topology};
const historical_degraded_rows = [_]RecoveryDegradationV1{.{
    .channel = .object_ids,
    .actions = &action_synthesized,
    .reasons = &reason_object_id,
    .affectedCount = 0,
}};

fn authoredFaceCountRows(verts_len: usize, optional_groups: ?[]const u32) u64 {
    return meshdoc_format.authoredFaceCount(verts_len / 24, optional_groups);
}

fn authoredFaceCount(document: *const meshdoc_format.Snapshot) u64 {
    return authoredFaceCountRows(document.verts.len, document.groups);
}

const RecoverySnapshotView = struct {
    snapshot: meshdoc_format.Snapshot,
    semantic_table: ?[]u8 = null,

    fn deinit(self: *RecoverySnapshotView, allocator: std.mem.Allocator) void {
        if (self.semantic_table) |json| allocator.free(json);
        self.* = undefined;
    }
};

fn recoverySnapshotViewAlloc(
    allocator: std.mem.Allocator,
    document: *const meshdoc_format.Snapshot,
) !RecoverySnapshotView {
    if (document.verts.len == 0 or document.verts.len % 24 != 0) return error.InvalidSnapshot;
    const face_count = document.verts.len / 24;
    const corner_count = face_count * 3;
    var persisted = document.*;
    if (persisted.groups) |rows| {
        if (rows.len != face_count) persisted.groups = null;
    }
    if (persisted.materials) |rows| {
        if (rows.len != face_count) persisted.materials = null;
    }
    const semantics_valid = persisted.semantic_regions != null and persisted.semantic_instances != null and
        persisted.semantic_regions.?.len == face_count and persisted.semantic_instances.?.len == face_count;
    if (!semantics_valid) {
        persisted.semantic_regions = null;
        persisted.semantic_instances = null;
        persisted.semantic_table_json = null;
    }
    const logical_valid = if (persisted.render_corner_logical_ids) |rows|
        rows.len == corner_count and persisted.logical_vertex_count > 0 and
            meshdoc_format.logicalRowsValid(
                allocator,
                persisted.verts,
                rows,
                persisted.logical_vertex_count,
                true,
            )
    else
        persisted.logical_vertex_count == 0;
    if (!logical_valid) {
        persisted.render_corner_logical_ids = null;
        persisted.logical_vertex_count = 0;
        persisted.dense_to_stable_logical_ids = null;
    }

    var result = RecoverySnapshotView{ .snapshot = persisted };
    if (semantics_valid) {
        if (document.semantic_table_json) |json| {
            result.semantic_table = mesh_edge_semantics.recoveryTableAlloc(
                allocator,
                json,
                persisted.render_corner_logical_ids == null,
                true,
            ) catch null;
            result.snapshot.semantic_table_json = result.semantic_table;
        }
    }
    return result;
}

fn encodeResidentAlloc(
    allocator: std.mem.Allocator,
    document: *const meshdoc_format.Snapshot,
    ranges: []const u32,
    object_ids: ?[][]const u8,
) !EncodedResident {
    if (object_ids) |ids| {
        if (ids.len == ranges.len / 2 and ids.len > 0) {
            if (meshdoc_format.encodeCurrentSnapshotWithRangeObjectIdsAlloc(
                allocator,
                document,
                ranges,
                ids,
            )) |bytes| {
                return .{
                    .bytes = bytes,
                    .part_count = ranges.len / 2,
                    .logical_vertex_count = document.logical_vertex_count,
                };
            } else |err| switch (err) {
                // Object identity is browsing metadata. It must never make the
                // panic lane less durable than a plain current-v5 envelope.
                error.InvalidSnapshot => {},
                else => return err,
            }
        }
    }
    if (ranges.len > 0) {
        if (meshdoc_format.encodeCurrentSnapshotAlloc(allocator, document, ranges)) |bytes| {
            return .{
                .bytes = bytes,
                .part_count = ranges.len / 2,
                .logical_vertex_count = document.logical_vertex_count,
            };
        } else |err| switch (err) {
            // Resident range/group disagreement is one of the ordinary Save
            // refusal modes this recovery door exists to outlive. Fall through
            // to a readable single-range envelope while preserving geometry.
            error.InvalidSnapshot => {},
            else => return err,
        }
    }

    // Retry with only individually invalid subchannels removed. A malformed
    // semantic edge table must not discard valid materials, logical topology,
    // face roles, groups, ranges, or stable object ids.
    var recovered = try recoverySnapshotViewAlloc(allocator, document);
    defer recovered.deinit(allocator);
    if (object_ids) |ids| {
        if (ids.len == ranges.len / 2 and ids.len > 0) {
            if (meshdoc_format.encodeCurrentSnapshotWithRangeObjectIdsAlloc(
                allocator,
                &recovered.snapshot,
                ranges,
                ids,
            )) |bytes| {
                return .{
                    .bytes = bytes,
                    .part_count = ranges.len / 2,
                    .logical_vertex_count = recovered.snapshot.logical_vertex_count,
                };
            } else |err| switch (err) {
                error.InvalidSnapshot => {},
                else => return err,
            }
        }
    }
    if (ranges.len > 0) {
        if (meshdoc_format.encodeCurrentSnapshotAlloc(allocator, &recovered.snapshot, ranges)) |bytes| {
            return .{
                .bytes = bytes,
                .part_count = ranges.len / 2,
                .logical_vertex_count = recovered.snapshot.logical_vertex_count,
            };
        } else |err| switch (err) {
            error.InvalidSnapshot => {},
            else => return err,
        }
    }

    // Current RJMD requires every face to belong to a persisted range. A raw
    // import may have no outliner partition yet; panic capture still needs a
    // readable envelope. Preserve finite group IDs under one covering range,
    // or synthesize group 0 when the resident has no encodable group channel.
    const face_count = document.verts.len / 24;
    if (face_count == 0) return error.InvalidSnapshot;
    var fallback_groups: ?[]u32 = null;
    defer if (fallback_groups) |owned| allocator.free(owned);
    var lo: u32 = std.math.maxInt(u32);
    var hi_inclusive: u32 = 0;
    var groups_usable = document.groups != null and document.groups.?.len == face_count;
    if (document.groups) |groups| {
        if (groups.len == face_count) {
            for (groups) |group| {
                if (group == meshdoc_format.NO_FACE_GROUP or group == std.math.maxInt(u32)) {
                    groups_usable = false;
                    break;
                }
                lo = @min(lo, group);
                hi_inclusive = @max(hi_inclusive, group);
            }
        }
    }
    var persisted = recovered.snapshot;
    if (!groups_usable) {
        const owned = try allocator.alloc(u32, face_count);
        @memset(owned, 0);
        fallback_groups = owned;
        persisted.groups = owned;
        lo = 0;
        hi_inclusive = 0;
    }
    const fallback_ranges = [_]u32{ lo, hi_inclusive + 1 };
    if (meshdoc_format.encodeCurrentSnapshotAlloc(allocator, &persisted, &fallback_ranges)) |bytes| {
        return .{
            .bytes = bytes,
            .part_count = 1,
            .logical_vertex_count = persisted.logical_vertex_count,
        };
    } else |err| switch (err) {
        error.InvalidSnapshot => {},
        else => return err,
    }

    // Only geometry + a synthesized owner can remain if the independently
    // sanitized channels still cannot form a readable v5 envelope.
    persisted.materials = null;
    persisted.semantic_regions = null;
    persisted.semantic_instances = null;
    persisted.render_corner_logical_ids = null;
    persisted.logical_vertex_count = 0;
    persisted.dense_to_stable_logical_ids = null;
    persisted.semantic_table_json = null;
    return .{
        .bytes = try meshdoc_format.encodeCurrentSnapshotAlloc(allocator, &persisted, &fallback_ranges),
        .part_count = 1,
        .logical_vertex_count = 0,
    };
}

fn optionalU32Equal(left: ?[]const u32, right: ?[]const u32) bool {
    if ((left == null) != (right == null)) return false;
    if (left == null) return true;
    return std.mem.eql(u32, left.?, right.?);
}

fn optionalU8Equal(left: ?[]const u8, right: ?[]const u8) bool {
    if ((left == null) != (right == null)) return false;
    if (left == null) return true;
    return std.mem.eql(u8, left.?, right.?);
}

fn validJson(allocator: std.mem.Allocator, bytes: []const u8) bool {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, bytes, .{}) catch return false;
    parsed.deinit();
    return true;
}

fn stableObjectIdsValid(ids: ?[][]const u8, range_count: usize) bool {
    const rows = ids orelse return false;
    if (rows.len != range_count or rows.len == 0) return false;
    for (rows, 0..) |row, index| {
        if (row.len == 0) return false;
        for (rows[0..index]) |prior| if (std.mem.eql(u8, row, prior)) return false;
    }
    return true;
}

const OwnedObjectIds = struct {
    rows: [][]const u8,

    fn deinit(self: *OwnedObjectIds, allocator: std.mem.Allocator) void {
        for (self.rows) |row| allocator.free(row);
        allocator.free(self.rows);
        self.* = undefined;
    }
};

fn deterministicRecoveryObjectIdsAlloc(
    allocator: std.mem.Allocator,
    verts: []const f32,
    ranges: []const u32,
) !OwnedObjectIds {
    const count = ranges.len / 2;
    const rows = try allocator.alloc([]const u8, count);
    errdefer allocator.free(rows);
    var initialized: usize = 0;
    errdefer for (rows[0..initialized]) |row| allocator.free(row);
    var digest: [32]u8 = undefined;
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update(std.mem.sliceAsBytes(verts));
    hash.update(std.mem.sliceAsBytes(ranges));
    hash.final(&digest);
    const hex = std.fmt.bytesToHex(digest, .lower);
    for (rows, 0..) |*row, index| {
        row.* = try std.fmt.allocPrint(allocator, "recovered-{s}-{d}-{d}-{d}", .{
            hex[0..16],
            index,
            ranges[index * 2],
            ranges[index * 2 + 1],
        });
        initialized += 1;
    }
    return .{ .rows = rows };
}

fn sourceHash(document: *const meshdoc_format.Snapshot, ranges: []const u32) [64]u8 {
    var digest: [32]u8 = undefined;
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update(std.mem.sliceAsBytes(document.verts));
    if (document.groups) |rows| hash.update(std.mem.sliceAsBytes(rows));
    if (document.materials) |rows| hash.update(std.mem.sliceAsBytes(rows));
    if (document.semantic_regions) |rows| hash.update(std.mem.sliceAsBytes(rows));
    if (document.semantic_instances) |rows| hash.update(std.mem.sliceAsBytes(rows));
    if (document.render_corner_logical_ids) |rows| hash.update(std.mem.sliceAsBytes(rows));
    if (document.semantic_table_json) |json| hash.update(json);
    hash.update(std.mem.sliceAsBytes(ranges));
    hash.final(&digest);
    return std.fmt.bytesToHex(digest, .lower);
}

fn appendDegradation(
    encoded: *EncodedResident,
    channel: RecoveryDegradationChannelV1,
    actions: []const RecoveryDegradationActionV1,
    reasons: []const RecoveryDegradationReasonV1,
    affected_count: u64,
) void {
    for (encoded.degradations[0..encoded.degradation_count]) |*existing| {
        if (existing.channel != channel) continue;
        existing.affectedCount = @max(existing.affectedCount, affected_count);
        return;
    }
    if (encoded.degradation_count == encoded.degradations.len) return;
    encoded.degradations[encoded.degradation_count] = .{
        .channel = channel,
        .actions = actions,
        .reasons = reasons,
        .affectedCount = affected_count,
    };
    encoded.degradation_count += 1;
}

fn appendCanonicalCarriedDegradation(encoded: *EncodedResident, row: RecoveryDegradationV1) void {
    switch (row.channel) {
        .object_ids => appendDegradation(encoded, .object_ids, &action_synthesized, &reason_object_id, row.affectedCount),
        .range_membership => appendDegradation(encoded, .range_membership, &action_repaired, &reason_range, row.affectedCount),
        .face_groups => appendDegradation(encoded, .face_groups, &action_defaulted, &reason_group, row.affectedCount),
        .materials => appendDegradation(encoded, .materials, &action_dropped, &reason_material, row.affectedCount),
        .semantic_membership => appendDegradation(encoded, .semantic_membership, &action_defaulted, &reason_semantic_membership, row.affectedCount),
        .semantic_table => appendDegradation(encoded, .semantic_table, &action_repaired, &reason_semantic_table, row.affectedCount),
        .logical_topology => appendDegradation(encoded, .logical_topology, &action_dropped, &reason_logical, row.affectedCount),
    }
}

fn carryEmbeddedRecoveryProvenance(
    allocator: std.mem.Allocator,
    encoded: *EncodedResident,
    semantic_json: ?[]const u8,
) void {
    const json = semantic_json orelse return;
    var parsed = std.json.parseFromSlice(RecoverySemanticProbeV1, allocator, json, .{
        .ignore_unknown_fields = true,
    }) catch return;
    defer parsed.deinit();
    const provenance = parsed.value.recoveryProvenance orelse return;
    if (provenance.version != 1 or !std.mem.eql(u8, provenance.identityQuality, "degraded")) return;
    for (provenance.recoveryDegradations) |row| appendCanonicalCarriedDegradation(encoded, row);
}

fn semanticJsonWithRecoveryProvenanceAlloc(
    allocator: std.mem.Allocator,
    semantic_json: []const u8,
    object_namespace_hash: []const u8,
    degradations: []const RecoveryDegradationV1,
) ![]u8 {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, semantic_json, .{});
    defer parsed.deinit();
    const root = switch (parsed.value) {
        .object => |*object| object,
        else => return error.InvalidRecoveryProvenance,
    };
    const arena = parsed.arena.allocator();
    var rows = std.json.Array.init(arena);
    for (degradations) |degradation| {
        var row = std.json.ObjectMap.empty;
        try row.put(arena, "channel", .{ .string = @tagName(degradation.channel) });
        var actions = std.json.Array.init(arena);
        for (degradation.actions) |action| try actions.append(.{ .string = @tagName(action) });
        try row.put(arena, "actions", .{ .array = actions });
        var reasons = std.json.Array.init(arena);
        for (degradation.reasons) |reason| try reasons.append(.{ .string = @tagName(reason) });
        try row.put(arena, "reasons", .{ .array = reasons });
        try row.put(arena, "affectedCount", .{ .integer = @intCast(degradation.affectedCount) });
        try rows.append(.{ .object = row });
    }
    var provenance = std.json.ObjectMap.empty;
    try provenance.put(arena, "version", .{ .integer = 1 });
    try provenance.put(arena, "identityQuality", .{ .string = "degraded" });
    try provenance.put(arena, "objectNamespaceHash", .{ .string = object_namespace_hash });
    try provenance.put(arena, "recoveryDegradations", .{ .array = rows });
    try root.put(arena, "recoveryProvenance", .{ .object = provenance });
    return std.json.Stringify.valueAlloc(allocator, parsed.value, .{});
}

fn objectNamespaceHash(
    model_id: []const u8,
    range_object_ids: ?[][]u8,
    ranges: []const u32,
) [64]u8 {
    const empty_ids = [_][]const u8{};
    const ids: []const []const u8 = if (range_object_ids) |values| values else &empty_ids;
    return meshdoc_format.objectNamespaceHashHex(model_id, ids, ranges);
}

fn encodeResidentV1Alloc(
    allocator: std.mem.Allocator,
    model_id: []const u8,
    document: *const meshdoc_format.Snapshot,
    ranges: []const u32,
    object_ids: ?[][]const u8,
) !EncodedResident {
    const supplied_ids_valid = stableObjectIdsValid(object_ids, ranges.len / 2);
    var initial_ids: ?OwnedObjectIds = null;
    defer if (initial_ids) |*owned| owned.deinit(allocator);
    const effective_ids: ?[][]const u8 = if (supplied_ids_valid)
        object_ids
    else if (ranges.len > 0) ids: {
        initial_ids = try deterministicRecoveryObjectIdsAlloc(allocator, document.verts, ranges);
        break :ids initial_ids.?.rows;
    } else null;

    var encoded = try encodeResidentAlloc(allocator, document, ranges, effective_ids);
    errdefer allocator.free(encoded.bytes);
    encoded.source_sha256 = sourceHash(document, ranges);

    var decoded = try meshdoc_format.decodeDocument(allocator, encoded.bytes);
    defer decoded.deinit(allocator);
    // A fallback range may differ from the caller's invalid/stale partition.
    // Stamp deterministic recovery IDs against the exact persisted ranges so
    // every artifact remains addressable without rank recovery.
    if (decoded.range_object_ids == null and decoded.ranges.len > 0) {
        var recovered_ids = try deterministicRecoveryObjectIdsAlloc(allocator, decoded.verts, decoded.ranges);
        defer recovered_ids.deinit(allocator);
        const face_count = decoded.verts.len / 24;
        var unassigned_regions: ?[]u32 = null;
        defer if (unassigned_regions) |rows| allocator.free(rows);
        var unassigned_instances: ?[]u32 = null;
        defer if (unassigned_instances) |rows| allocator.free(rows);
        if (decoded.semantic_regions == null) {
            unassigned_regions = try allocator.alloc(u32, face_count);
            unassigned_instances = try allocator.alloc(u32, face_count);
            @memset(unassigned_regions.?, std.math.maxInt(u32));
            @memset(unassigned_instances.?, std.math.maxInt(u32));
        }
        var persisted = meshdoc_format.Snapshot{
            .verts = decoded.verts,
            .groups = decoded.groups,
            .materials = decoded.materials,
            .semantic_regions = decoded.semantic_regions orelse unassigned_regions,
            .semantic_instances = decoded.semantic_instances orelse unassigned_instances,
            .render_corner_logical_ids = decoded.render_corner_logical_ids,
            .logical_vertex_count = decoded.logical_vertex_count,
            .dense_to_stable_logical_ids = null,
            .semantic_table_json = decoded.semantic_table_json orelse @constCast(@as([]const u8, "{\"version\":1,\"regions\":[]}")),
            .glass_first_vertex = decoded.glass_first_vertex orelse @intCast(decoded.verts.len / 8),
        };
        const with_ids = try meshdoc_format.encodeCurrentSnapshotWithRangeObjectIdsAlloc(
            allocator,
            &persisted,
            decoded.ranges,
            recovered_ids.rows,
        );
        allocator.free(encoded.bytes);
        encoded.bytes = with_ids;
        decoded.deinit(allocator);
        decoded = try meshdoc_format.decodeDocument(allocator, encoded.bytes);
    }

    carryEmbeddedRecoveryProvenance(allocator, &encoded, document.semantic_table_json);

    if (!supplied_ids_valid) appendDegradation(
        &encoded,
        .object_ids,
        &action_synthesized,
        &reason_object_id,
        @intCast(decoded.ranges.len / 2),
    );
    if (!std.mem.eql(u32, ranges, decoded.ranges)) appendDegradation(
        &encoded,
        .range_membership,
        &action_repaired,
        &reason_range,
        @intCast(decoded.ranges.len / 2),
    );
    if (!optionalU32Equal(document.groups, decoded.groups)) appendDegradation(
        &encoded,
        .face_groups,
        &action_defaulted,
        &reason_group,
        @intCast(decoded.verts.len / 24),
    );
    if (!optionalU32Equal(document.materials, decoded.materials)) appendDegradation(
        &encoded,
        .materials,
        &action_dropped,
        &reason_material,
        @intCast(decoded.verts.len / 24),
    );
    const semantic_input_absent = document.semantic_regions == null and document.semantic_instances == null;
    if (!semantic_input_absent and
        (!optionalU32Equal(document.semantic_regions, decoded.semantic_regions) or
            !optionalU32Equal(document.semantic_instances, decoded.semantic_instances))) appendDegradation(
        &encoded,
        .semantic_membership,
        &action_defaulted,
        &reason_semantic_membership,
        @intCast(decoded.verts.len / 24),
    );
    if (document.semantic_table_json) |semantic_json| {
        // Appending the v5 rangeObjects envelope is ordinary persistence, not
        // an anatomy repair. Only an actually unreadable resident dictionary
        // is a semantic-table degradation.
        if (!validJson(allocator, semantic_json)) appendDegradation(
            &encoded,
            .semantic_table,
            &action_repaired,
            &reason_semantic_table,
            @intCast(decoded.verts.len / 24),
        );
    }
    if (document.logical_vertex_count != decoded.logical_vertex_count or
        !optionalU32Equal(document.render_corner_logical_ids, decoded.render_corner_logical_ids)) appendDegradation(
        &encoded,
        .logical_topology,
        &action_dropped,
        &reason_logical,
        @intCast(decoded.verts.len / 8),
    );

    encoded.object_namespace_hash = objectNamespaceHash(model_id, decoded.range_object_ids, decoded.ranges);
    if (encoded.degradation_count > 0) {
        const semantic_json = decoded.semantic_table_json orelse return error.InvalidRecoveryProvenance;
        const recovery_json = try semanticJsonWithRecoveryProvenanceAlloc(
            allocator,
            semantic_json,
            &encoded.object_namespace_hash,
            encoded.degradations[0..encoded.degradation_count],
        );
        defer allocator.free(recovery_json);
        var persisted = meshdoc_format.Snapshot{
            .verts = decoded.verts,
            .groups = decoded.groups,
            .materials = decoded.materials,
            .semantic_regions = decoded.semantic_regions,
            .semantic_instances = decoded.semantic_instances,
            .render_corner_logical_ids = decoded.render_corner_logical_ids,
            .logical_vertex_count = decoded.logical_vertex_count,
            .dense_to_stable_logical_ids = null,
            .semantic_table_json = recovery_json,
            .glass_first_vertex = decoded.glass_first_vertex orelse @intCast(decoded.verts.len / 8),
        };
        const with_provenance = try meshdoc_format.encodeCurrentSnapshotAlloc(
            allocator,
            &persisted,
            decoded.ranges,
        );
        allocator.free(encoded.bytes);
        encoded.bytes = with_provenance;
    }
    encoded.part_count = decoded.ranges.len / 2;
    encoded.logical_vertex_count = decoded.logical_vertex_count;
    return encoded;
}

fn emptyPins(allocator: std.mem.Allocator) !OwnedPins {
    const values = try allocator.alloc([]const u8, 0);
    errdefer allocator.free(values);
    return .{
        .values = values,
        .legacy_revisions = try allocator.alloc([]const u8, 0),
    };
}

fn parsePinsBytes(allocator: std.mem.Allocator, bytes: []const u8) !OwnedPins {
    var parsed = try parseRequest(PinRegistryWire, allocator, bytes);
    defer parsed.deinit();
    if (parsed.value.version != 1 and parsed.value.version != 2) return error.UnsupportedPinRegistry;
    const snapshot_values = if (parsed.value.version == 2) parsed.value.pinned else &.{};
    const legacy_values = if (parsed.value.version == 1) parsed.value.pinned else parsed.value.legacyRevisions;
    const values = try allocator.alloc([]const u8, snapshot_values.len);
    errdefer allocator.free(values);
    var copied: usize = 0;
    errdefer for (values[0..copied]) |value| allocator.free(value);
    for (snapshot_values, values) |value, *target| {
        if (!validSnapshotId(value)) return error.InvalidPinRegistry;
        target.* = try allocator.dupe(u8, value);
        copied += 1;
    }
    const legacy_revisions = try allocator.alloc([]const u8, legacy_values.len);
    errdefer allocator.free(legacy_revisions);
    var legacy_copied: usize = 0;
    errdefer for (legacy_revisions[0..legacy_copied]) |value| allocator.free(value);
    for (legacy_values, legacy_revisions) |value, *target| {
        if (!validRevision(value)) return error.InvalidPinRegistry;
        target.* = try allocator.dupe(u8, value);
        legacy_copied += 1;
    }
    return .{ .values = values, .legacy_revisions = legacy_revisions };
}

fn emptyHistoryIndex(allocator: std.mem.Allocator) !OwnedHistoryIndex {
    return .{ .entries = try allocator.alloc(HistoryIndexEntry, 0) };
}

fn parseHistoryIndexBytes(allocator: std.mem.Allocator, bytes: []const u8) !OwnedHistoryIndex {
    var parsed = try parseRequest(HistoryIndexWire, allocator, bytes);
    defer parsed.deinit();
    if (parsed.value.version != 1) return error.UnsupportedHistoryIndex;
    const entries = try allocator.alloc(HistoryIndexEntry, parsed.value.entries.len);
    errdefer allocator.free(entries);
    var copied: usize = 0;
    errdefer for (entries[0..copied]) |*entry| entry.deinit(allocator);
    for (parsed.value.entries, entries) |source, *target| {
        if (!validSnapshotId(source.snapshotId)) return error.InvalidHistoryIndex;
        const snapshot_id = try allocator.dupe(u8, source.snapshotId);
        errdefer allocator.free(snapshot_id);
        const event_path = try allocator.dupe(u8, source.eventPath);
        errdefer allocator.free(event_path);
        const resident_path = try allocator.dupe(u8, source.residentPath);
        target.* = .{
            .snapshotId = snapshot_id,
            .timestampMs = source.timestampMs,
            .eventPath = event_path,
            .residentPath = resident_path,
        };
        copied += 1;
    }
    std.mem.sort(HistoryIndexEntry, entries, {}, struct {
        fn lessThan(_: void, left: HistoryIndexEntry, right: HistoryIndexEntry) bool {
            return std.mem.lessThan(u8, left.snapshotId, right.snapshotId);
        }
    }.lessThan);
    for (entries, 0..) |entry, index| {
        if (index > 0 and std.mem.eql(u8, entry.snapshotId, entries[index - 1].snapshotId)) {
            return error.DuplicateSnapshotId;
        }
        if (try snapshotIdTimestampMs(entry.snapshotId) != entry.timestampMs) return error.InvalidHistoryIndex;
    }
    return .{ .entries = entries };
}

const MaterializedFile = struct {
    io: std.Io,
    directory_path: []u8,
    full_path: []u8,
    bytes: []u8,
    cleanup: bool,

    fn deinit(self: *MaterializedFile, allocator: std.mem.Allocator) void {
        if (self.cleanup) {
            std.Io.Dir.deleteFileAbsolute(self.io, self.full_path) catch {};
            std.Io.Dir.deleteDirAbsolute(self.io, self.directory_path) catch {};
        }
        allocator.free(self.full_path);
        allocator.free(self.bytes);
        allocator.free(self.directory_path);
        self.* = undefined;
    }
};

fn privateMaterializationDirAlloc(io: std.Io, allocator: std.mem.Allocator) ![]u8 {
    const process_id = std.c.getpid();
    const runtime_root = try std.fmt.allocPrint(allocator, "/run/user/{d}", .{std.os.linux.getuid()});
    defer allocator.free(runtime_root);
    var root = try std.Io.Dir.openDirAbsolute(io, runtime_root, .{
        .iterate = true,
        .follow_symlinks = false,
    });
    defer root.close(io);
    const root_stat = try root.stat(io);
    if (root_stat.permissions.toMode() & 0o077 != 0) return error.InsecureRuntimeDirectory;

    // Runtime directories survive individual editor processes. Reap only our
    // own dead-process namespaces; a live sibling editor's current preview is
    // never touched.
    var iterator = root.iterate();
    while (iterator.next(io) catch null) |entry| {
        if (entry.kind != .directory or !std.mem.startsWith(u8, entry.name, "reactjit-lore-")) continue;
        const identity = entry.name["reactjit-lore-".len..];
        const separator = std.mem.indexOfScalar(u8, identity, '-') orelse {
            root.deleteTree(io, entry.name) catch {};
            continue;
        };
        const owner_pid = std.fmt.parseInt(i32, identity[0..separator], 10) catch {
            root.deleteTree(io, entry.name) catch {};
            continue;
        };
        if (owner_pid == process_id) continue;
        var proc_buffer: [64]u8 = undefined;
        const proc_path = std.fmt.bufPrint(&proc_buffer, "/proc/{d}", .{owner_pid}) catch continue;
        var process_dir = std.Io.Dir.openDirAbsolute(io, proc_path, .{ .follow_symlinks = false }) catch {
            root.deleteTree(io, entry.name) catch {};
            continue;
        };
        process_dir.close(io);
    }

    for (0..8) |_| {
        var random: [16]u8 = undefined;
        try io.randomSecure(&random);
        const hex = std.fmt.bytesToHex(random, .lower);
        var name_buffer: [64]u8 = undefined;
        const name = try std.fmt.bufPrint(&name_buffer, "reactjit-lore-{d}-{s}", .{ process_id, &hex });
        root.createDir(io, name, std.Io.File.Permissions.fromMode(0o700)) catch |err| switch (err) {
            error.PathAlreadyExists => continue,
            else => return err,
        };
        var created = root.openDir(io, name, .{ .iterate = true, .follow_symlinks = false }) catch |err| {
            root.deleteDir(io, name) catch {};
            return err;
        };
        const created_stat = created.stat(io) catch |err| {
            created.close(io);
            root.deleteDir(io, name) catch {};
            return err;
        };
        created.close(io);
        if (created_stat.permissions.toMode() & 0o077 != 0) {
            root.deleteDir(io, name) catch {};
            return error.InsecureMaterializationDirectory;
        }
        return std.fmt.allocPrint(allocator, "{s}/{s}", .{ runtime_root, name });
    }
    return error.MaterializationDirectoryCollision;
}

fn retainLatestPreview(io: std.Io, directory_path: []const u8, full_path: []const u8) !void {
    retained_preview_mutex.lockUncancelable(io);
    defer retained_preview_mutex.unlock(io);
    if (retained_preview_path) |prior| {
        std.Io.Dir.deleteFileAbsolute(io, prior) catch {};
        std.heap.c_allocator.free(prior);
        retained_preview_path = null;
    }
    if (retained_preview_directory) |prior| {
        std.Io.Dir.deleteDirAbsolute(io, prior) catch {};
        std.heap.c_allocator.free(prior);
        retained_preview_directory = null;
    }
    retained_preview_directory = try std.heap.c_allocator.dupe(u8, directory_path);
    errdefer {
        std.heap.c_allocator.free(retained_preview_directory.?);
        retained_preview_directory = null;
    }
    retained_preview_path = try std.heap.c_allocator.dupe(u8, full_path);
}

fn materializeLoreFile(
    io: std.Io,
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    lore_path: []const u8,
    revision: []const u8,
    suffix: []const u8,
    offline: bool,
    retain: bool,
) !MaterializedFile {
    if (!validRevision(revision)) return error.InvalidRevision;
    const directory_full = try privateMaterializationDirAlloc(io, allocator);
    errdefer {
        std.Io.Dir.deleteDirAbsolute(io, directory_full) catch {};
        allocator.free(directory_full);
    }
    const full_path = try std.fmt.allocPrint(allocator, "{s}/{s}{s}", .{ directory_full, revision, suffix });
    errdefer allocator.free(full_path);
    errdefer std.Io.Dir.deleteFileAbsolute(io, full_path) catch {};
    var write = try lore.fileWrite(
        allocator,
        repository_path,
        "",
        lore_path,
        revision,
        "",
        full_path,
        .{ .offline = offline },
    );
    defer write.deinit(allocator);
    const bytes = try std.Io.Dir.cwd().readFileAlloc(io, full_path, allocator, .unlimited);
    errdefer allocator.free(bytes);
    if (retain) try retainLatestPreview(io, directory_full, full_path);
    return .{
        .io = io,
        .directory_path = directory_full,
        .full_path = full_path,
        .bytes = bytes,
        .cleanup = !retain,
    };
}

fn readPinsDurable(
    io: std.Io,
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    paths: *const Paths,
) !OwnedPins {
    const pin_paths = [_][]const u8{paths.pins_lore};
    var info = try lore.fileInfo(allocator, repository_path, "", &pin_paths, "");
    defer info.deinit(allocator);
    if (info.entries.len == 0) return emptyPins(allocator);
    var history = try lore.fileHistory(allocator, repository_path, "", paths.pins_lore, .{ .length = 1 });
    defer history.deinit(allocator);
    if (history.entries.len == 0) return emptyPins(allocator);
    const revision = revisionHex(history.entries[0].revision);
    var file = try materializeLoreFile(
        io,
        allocator,
        repository_path,
        paths.pins_lore,
        &revision,
        ".json",
        true,
        false,
    );
    defer file.deinit(allocator);
    return parsePinsBytes(allocator, file.bytes);
}

fn readHistoryIndexDurable(
    io: std.Io,
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    paths: *const Paths,
) !OwnedHistoryIndex {
    const index_paths = [_][]const u8{paths.index_lore};
    var info = try lore.fileInfo(allocator, repository_path, "", &index_paths, "");
    defer info.deinit(allocator);
    if (info.entries.len == 0) return emptyHistoryIndex(allocator);
    var history = try lore.fileHistory(allocator, repository_path, "", paths.index_lore, .{ .length = 1 });
    defer history.deinit(allocator);
    if (history.entries.len == 0) return emptyHistoryIndex(allocator);
    const revision = revisionHex(history.entries[0].revision);
    var file = try materializeLoreFile(
        io,
        allocator,
        repository_path,
        paths.index_lore,
        &revision,
        ".json",
        true,
        false,
    );
    defer file.deinit(allocator);
    var index = try parseHistoryIndexBytes(allocator, file.bytes);
    errdefer index.deinit(allocator);
    for (index.entries) |*entry| try validateIndexEntryPaths(allocator, paths, entry);
    return index;
}

/// Permanent cutover input for the retired shared event path. This reader is
/// intentionally not called by history, preview, restore, or pin; migration
/// owns byte/hash verification and publication into an immutable snapshot ID
/// before an entry can become actionable again.
fn legacyEventHistoryForMigration(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    paths: *const Paths,
) !lore.FileHistory {
    return lore.fileHistory(allocator, repository_path, "", paths.event_lore, .{});
}

fn metadataFromRevision(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    revision: []const u8,
) !?OwnedMetadata {
    var list = try lore.revisionMetadataList(allocator, repository_path, "", revision);
    defer list.deinit(allocator);
    const keys = [_][]const u8{ METADATA_KEY, LEGACY_METADATA_KEY };
    for (keys) |key| {
        for (list.entries) |entry| {
            if (!std.mem.eql(u8, entry.key, key)) continue;
            const text = switch (entry.value) {
                .string => |value| value,
                else => continue,
            };
            var parsed = parseRequest(SnapshotMetadata, allocator, text) catch continue;
            defer parsed.deinit();
            return @as(?OwnedMetadata, try OwnedMetadata.fromParsed(allocator, parsed.value));
        }
    }
    return null;
}

fn metadataFromEventPathRevision(
    io: std.Io,
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    event_path: []const u8,
    revision: []const u8,
) !OwnedMetadata {
    var file = try materializeLoreFile(
        io,
        allocator,
        repository_path,
        event_path,
        revision,
        ".json",
        false,
        false,
    );
    defer file.deinit(allocator);
    var parsed = try parseRequest(SnapshotMetadata, allocator, file.bytes);
    defer parsed.deinit();
    return OwnedMetadata.fromParsed(allocator, parsed.value);
}

fn validateIndexedMetadata(
    model_id: []const u8,
    entry: *const HistoryIndexEntry,
    metadata: *const OwnedMetadata,
) !void {
    if (metadata.version != 2) return error.UnsupportedSnapshotEvent;
    if (!std.mem.eql(u8, metadata.model_id, model_id)) return error.SnapshotMetadataModelMismatch;
    if ((std.mem.eql(u8, metadata.identity_quality, "exact")) != (metadata.recovery_degradations.len == 0))
        return error.InvalidRecoveryProvenance;
    if (!validRevision(metadata.object_namespace_hash) or !validRevision(metadata.source_sha256))
        return error.InvalidRecoveryProvenance;
    if (metadata.legacy_source_revision.len > 0 and !validRevision(metadata.legacy_source_revision))
        return error.InvalidRecoveryProvenance;
    if (metadata.legacy_source_revision.len > 0 and !validSha256(metadata.legacy_source_event_sha256))
        return error.InvalidRecoveryProvenance;
    if (!std.mem.eql(u8, metadata.snapshot_id, entry.snapshotId) or
        !std.mem.eql(u8, metadata.event_path, entry.eventPath) or
        !std.mem.eql(u8, metadata.resident_path, entry.residentPath) or
        metadata.timestamp_ms != entry.timestampMs)
    {
        return error.SnapshotIndexEventMismatch;
    }
}

fn validateIndexEntryPaths(
    allocator: std.mem.Allocator,
    paths: *const Paths,
    entry: *const HistoryIndexEntry,
) !void {
    var expected = try SnapshotPaths.init(allocator, paths, entry.snapshotId);
    defer expected.deinit(allocator);
    if (!std.mem.eql(u8, expected.event_lore, entry.eventPath) or
        !std.mem.eql(u8, expected.resident_lore, entry.residentPath))
    {
        return error.HistoryIndexPathEscapesSnapshot;
    }
}

fn appendHistoryIndexEntry(
    allocator: std.mem.Allocator,
    index: *OwnedHistoryIndex,
    snapshot_id: []const u8,
    timestamp_ms: i64,
    event_path: []const u8,
    resident_path: []const u8,
) !void {
    for (index.entries) |entry| {
        if (std.mem.eql(u8, entry.snapshotId, snapshot_id)) return error.DuplicateSnapshotId;
    }
    const id_copy = try allocator.dupe(u8, snapshot_id);
    errdefer allocator.free(id_copy);
    const event_copy = try allocator.dupe(u8, event_path);
    errdefer allocator.free(event_copy);
    const resident_copy = try allocator.dupe(u8, resident_path);
    errdefer allocator.free(resident_copy);
    const old_len = index.entries.len;
    index.entries = try allocator.realloc(index.entries, old_len + 1);
    index.entries[old_len] = .{
        .snapshotId = id_copy,
        .timestampMs = timestamp_ms,
        .eventPath = event_copy,
        .residentPath = resident_copy,
    };
    std.mem.sort(HistoryIndexEntry, index.entries, {}, struct {
        fn lessThan(_: void, left: HistoryIndexEntry, right: HistoryIndexEntry) bool {
            return std.mem.lessThan(u8, left.snapshotId, right.snapshotId);
        }
    }.lessThan);
}

fn pushCurrent(io: std.Io, allocator: std.mem.Allocator, repository_path: []const u8, requested: bool) struct {
    attempted: bool,
    pushed: bool,
    error_text: ?[]const u8,
} {
    if (!requested) return .{ .attempted = false, .pushed = false, .error_text = null };
    // A slow or unavailable server must never hold the repository mutation
    // lock needed by an offline panic capture. Network pushes serialize only
    // with other pushes; a concurrent local commit may make this push fail,
    // which is truthfully reported while the local snapshot remains durable.
    var push_lock = acquirePushLock(io) catch |err|
        return .{ .attempted = true, .pushed = false, .error_text = @errorName(err) };
    defer push_lock.release();
    var result = lore.branchPush(allocator, repository_path, "", .{}) catch |err|
        return .{ .attempted = true, .pushed = false, .error_text = @errorName(err) };
    defer result.deinit(allocator);
    return .{ .attempted = true, .pushed = true, .error_text = null };
}

fn commitEncodedSnapshotJson(
    io: std.Io,
    allocator: std.mem.Allocator,
    request: *const SnapshotRequest,
    encoded: *const EncodedResident,
    triangle_count: u64,
    authored_face_count: u64,
    read_guard: ?SnapshotReadGuard,
) ![]u8 {
    var paths = try Paths.init(allocator, request.modelId);
    defer paths.deinit(allocator);
    // The V8 callback owns the Scene3D thread while this function runs. The
    // guard is re-read after the potentially allocating encoder and before any
    // repository mutation, so a stale caller can never commit bytes under the
    // wrong visible session/generation.
    if (read_guard) |guard| if (!guard.validate(guard.context)) return error.StaleGeneration;
    const sha = hashHex(encoded.bytes);
    const repository_path = try repositoryPathAlloc(io, allocator);
    defer allocator.free(repository_path);
    var reservation: ?SnapshotReservation = null;
    defer if (reservation) |*value| value.deinit(allocator);

    const Committed = struct {
        snapshot_id: [SNAPSHOT_ID_LENGTH]u8,
        revision: [64]u8,
        revision_number: u64,
        timestamp_ms: i64,
        sequence: u64,
        metadata_stored: bool,
    };
    const committed: Committed = commit_block: {
        // One lock covers no-replace ID reservation, immutable payload creation,
        // the locator index, and Lore's mutable stage/current revision state.
        var mutation_lock = try acquireMutationLockRespectingBudget(io);
        defer mutation_lock.release();

        const now = std.Io.Clock.now(.real, io);
        const timestamp_ms = now.toMilliseconds();
        reservation = try snapshotIdAlloc(io, allocator, &paths, timestamp_ms);
        const immutable = &reservation.?;
        capture_sequence +%= 1;
        var capture_id_buffer: [128]u8 = undefined;
        const capture_id = try std.fmt.bufPrint(&capture_id_buffer, "{d}-{d}-{d}", .{
            now.nanoseconds,
            std.c.getpid(),
            capture_sequence,
        });
        const metadata = SnapshotMetadata{
            .snapshotId = immutable.id,
            .timestampMs = timestamp_ms,
            .sequence = capture_sequence,
            .captureId = capture_id,
            .modelId = request.modelId,
            .label = if (request.label.len == 0) "Snapshot" else request.label,
            .note = request.note orelse "",
            .kind = @tagName(request.kind),
            .packageGeometryPath = request.packageGeometryPath,
            .sha256 = &sha,
            .sourceSha256 = &encoded.source_sha256,
            .byteLength = encoded.bytes.len,
            .triangleCount = triangle_count,
            .authoredFaceCount = authored_face_count,
            .partCount = encoded.part_count,
            .logicalVertexCount = encoded.logical_vertex_count,
            .identityQuality = if (encoded.degradation_count == 0) "exact" else "degraded",
            .objectNamespaceHash = &encoded.object_namespace_hash,
            .recoveryDegradations = encoded.degradations[0..encoded.degradation_count],
            .residentPath = immutable.paths.resident_lore,
            .eventPath = immutable.paths.event_lore,
        };
        const metadata_json = try std.json.Stringify.valueAlloc(allocator, metadata, .{});
        defer allocator.free(metadata_json);

        var index = try readHistoryIndexDurable(io, allocator, repository_path, &paths);
        defer index.deinit(allocator);
        try appendHistoryIndexEntry(
            allocator,
            &index,
            immutable.id,
            timestamp_ms,
            immutable.paths.event_lore,
            immutable.paths.resident_lore,
        );
        const index_json = try std.json.Stringify.valueAlloc(allocator, HistoryIndexWire{
            .entries = index.entries,
        }, .{});
        defer allocator.free(index_json);

        try writeDurableAtomic(io, immutable.paths.resident_full, encoded.bytes);
        try writeDurableAtomic(io, immutable.paths.event_full, metadata_json);
        try writeDurableAtomic(io, paths.index_full, index_json);

        const stage_paths = [_][]const u8{
            immutable.paths.resident_lore,
            immutable.paths.event_lore,
            paths.index_lore,
        };
        var stage = try lore.fileStage(allocator, repository_path, "", &stage_paths, .{});
        defer stage.deinit(allocator);

        // Lore's setter targets mutable current-revision state. The immediately
        // following commit is what freezes these values on this snapshot hash.
        var metadata_stored = true;
        const metadata_writes = [_]lore.MetadataWrite{.{
            .key = METADATA_KEY,
            .value = metadata_json,
            .format = .string,
        }};
        lore.revisionMetadataSet(allocator, repository_path, "", &metadata_writes) catch {
            metadata_stored = false;
        };

        const message = try std.fmt.allocPrint(allocator, "model snapshot: {s} [{s}]", .{ metadata.label, request.modelId });
        defer allocator.free(message);
        var commit = try lore.revisionCommit(allocator, repository_path, "", message, true);
        defer commit.deinit(allocator);
        const commit_hex = revisionHex(commit.revision.revision);

        // Never return a revision merely because COMMIT emitted success. Reread
        // its exact model event and resident payload from Lore, then compare the
        // immutable bytes to what this call received from the native session.
        var resident_proof = try materializeResidentPath(
            io,
            allocator,
            repository_path,
            immutable.paths.resident_lore,
            &commit_hex,
            true,
            false,
        );
        defer resident_proof.deinit(allocator);
        if (!std.mem.eql(u8, resident_proof.file.bytes, encoded.bytes)) return error.CommittedResidentMismatch;
        var event_proof = try materializeLoreFile(
            io,
            allocator,
            repository_path,
            immutable.paths.event_lore,
            &commit_hex,
            ".json",
            true,
            false,
        );
        defer event_proof.deinit(allocator);
        if (!std.mem.eql(u8, event_proof.bytes, metadata_json)) return error.CommittedEventMismatch;
        var index_proof = try materializeLoreFile(
            io,
            allocator,
            repository_path,
            paths.index_lore,
            &commit_hex,
            ".json",
            true,
            false,
        );
        defer index_proof.deinit(allocator);
        if (!std.mem.eql(u8, index_proof.bytes, index_json)) return error.CommittedHistoryIndexMismatch;
        if (metadata_stored) {
            var stored = (try metadataFromRevision(allocator, repository_path, &commit_hex)) orelse
                return error.CommittedMetadataMissing;
            defer stored.deinit(allocator);
            if (!std.mem.eql(u8, stored.model_id, request.modelId) or
                !std.mem.eql(u8, stored.sha256, &sha) or
                stored.timestamp_ms != metadata.timestampMs or
                stored.sequence != metadata.sequence)
            {
                return error.CommittedMetadataMismatch;
            }
        }
        var snapshot_id: [SNAPSHOT_ID_LENGTH]u8 = undefined;
        @memcpy(snapshot_id[0..], immutable.id);
        break :commit_block .{
            .snapshot_id = snapshot_id,
            .revision = commit_hex,
            .revision_number = commit.revision.revision_number,
            .timestamp_ms = metadata.timestampMs,
            .sequence = metadata.sequence,
            .metadata_stored = metadata_stored,
        };
    };
    const push = pushCurrent(
        io,
        allocator,
        repository_path,
        request.push,
    );
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = true,
        .version = 1,
        .modelId = request.modelId,
        .snapshotId = &committed.snapshot_id,
        .revision = &committed.revision,
        .revisionNumber = committed.revision_number,
        .timestampMs = committed.timestamp_ms,
        .sequence = committed.sequence,
        .sha256 = &sha,
        .sourceSha256 = &encoded.source_sha256,
        .byteLength = encoded.bytes.len,
        .bytes = encoded.bytes.len,
        .triangleCount = triangle_count,
        .triangles = triangle_count,
        .authoredFaces = authored_face_count,
        .partCount = encoded.part_count,
        .parts = encoded.part_count,
        .logicalVertexCount = encoded.logical_vertex_count,
        .logicalVertices = encoded.logical_vertex_count,
        .expiresAtMs = try snapshotExpiresAtMs(committed.timestamp_ms),
        .indexed = true,
        .metadataStored = committed.metadata_stored,
        .pushAttempted = push.attempted,
        .pushed = push.pushed,
        .pushState = if (push.pushed) "pushed" else if (push.attempted) "unknown" else "local",
        .pushError = push.error_text,
        .identityQuality = if (encoded.degradation_count == 0) "exact" else "degraded",
        .objectNamespaceHash = &encoded.object_namespace_hash,
        .recoveryDegradations = encoded.degradations[0..encoded.degradation_count],
        .warning = if (encoded.degradation_count == 0) null else "recovery snapshot persisted typed channel degradation",
        .spoolPath = if (request.version == 1) null else reservation.?.paths.resident_full,
    }, .{});
}

fn snapshotJsonImpl(
    io: std.Io,
    allocator: std.mem.Allocator,
    document: *const meshdoc_format.Snapshot,
    ranges: ?[]const u32,
    request_json: []const u8,
    read_guard: ?SnapshotReadGuard,
    object_ids_override: ?[][]const u8,
) ![]u8 {
    var parsed = try parseRequest(SnapshotRequest, allocator, request_json);
    defer parsed.deinit();
    const persisted_ranges = safeRanges(ranges);
    const capture_object_ids = object_ids_override orelse parsed.value.objectIds;
    const encoded = if (parsed.value.version == 1)
        try encodeResidentV1Alloc(allocator, parsed.value.modelId, document, persisted_ranges, capture_object_ids)
    else
        try encodeResidentAlloc(allocator, document, persisted_ranges, capture_object_ids);
    defer allocator.free(encoded.bytes);
    return commitEncodedSnapshotJson(
        io,
        allocator,
        &parsed.value,
        &encoded,
        document.verts.len / 24,
        authoredFaceCount(document),
        read_guard,
    );
}

pub fn snapshotJson(
    io: std.Io,
    allocator: std.mem.Allocator,
    document: *const meshdoc_format.Snapshot,
    ranges: ?[]const u32,
    request_json: []const u8,
) ![]u8 {
    return snapshotJsonImpl(io, allocator, document, ranges, request_json, null, null);
}

pub fn snapshotJsonGuarded(
    io: std.Io,
    allocator: std.mem.Allocator,
    document: *const meshdoc_format.Snapshot,
    ranges: ?[]const u32,
    request_json: []const u8,
    read_guard: SnapshotReadGuard,
    object_ids: ?[][]const u8,
) ![]u8 {
    return snapshotJsonImpl(io, allocator, document, ranges, request_json, read_guard, object_ids);
}

fn validateCapturedIdentityHash(text: []const u8, actual: *const [32]u8) !void {
    var expected: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(text, &expected, .{});
    if (!std.mem.eql(u8, &expected, actual)) return error.InvalidCapturedRecoveryMetadata;
}

/// Commit one Scene3D-owned panic capture without ever importing Scene3D state
/// into the cold host and without re-encoding the supplied bytes. All metadata
/// is independently derived/checked before the repository mutation begins.
pub fn commitCapturedRecoveryJson(
    io: std.Io,
    allocator: std.mem.Allocator,
    request_json: []const u8,
    captured: *const CapturedRecoveryArtifactV1,
) ![]u8 {
    var parsed = try parsePanicSnapshotRequestV1(allocator, request_json);
    defer parsed.deinit();
    const request = parsed.value;
    if (captured.schema_version != 1 or
        captured.rjmd_version != meshdoc_format.VERSION_LOGICAL_TOPOLOGY or
        captured.generation != request.expectedGeneration or
        captured.byte_len != captured.bytes.len or
        captured.degradations.len > 7 or
        captured.identity_quality > 1 or
        (captured.degradations.len == 0) != (captured.identity_quality == 0))
    {
        return error.InvalidCapturedRecoveryMetadata;
    }
    try validateCapturedIdentityHash(request.modelId, &captured.model_id_hash);
    try validateCapturedIdentityHash(request.sessionToken, &captured.session_token_hash);
    var bytes_digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(captured.bytes, &bytes_digest, .{});
    if (!std.mem.eql(u8, &bytes_digest, &captured.sha256)) return error.InvalidCapturedRecoveryMetadata;

    var document = meshdoc_format.decodeDocument(allocator, captured.bytes) catch
        return error.InvalidCapturedRecoveryArtifact;
    defer document.deinit(allocator);
    const triangle_count = document.verts.len / 24;
    const part_count = document.ranges.len / 2;
    if (document.version != captured.rjmd_version or
        captured.triangle_count != triangle_count or
        captured.authored_face_count != meshdoc_format.authoredFaceCount(triangle_count, document.groups) or
        captured.part_count != part_count or
        captured.logical_vertex_count != document.logical_vertex_count or
        document.range_object_ids == null or
        document.range_object_ids.?.len != part_count)
    {
        return error.InvalidCapturedRecoveryMetadata;
    }
    const object_ids: []const []const u8 = document.range_object_ids.?;
    const namespace_digest = meshdoc_format.objectNamespaceDigest(request.modelId, object_ids, document.ranges);
    if (!std.mem.eql(u8, &namespace_digest, &captured.object_namespace_hash))
        return error.InvalidCapturedRecoveryMetadata;

    var encoded = EncodedResident{
        .bytes = captured.bytes,
        .part_count = captured.part_count,
        .logical_vertex_count = captured.logical_vertex_count,
        .source_sha256 = std.fmt.bytesToHex(captured.sha256, .lower),
        .object_namespace_hash = std.fmt.bytesToHex(captured.object_namespace_hash, .lower),
    };
    var owned_actions = [_]?[]RecoveryDegradationActionV1{null} ** 7;
    var owned_reasons = [_]?[]RecoveryDegradationReasonV1{null} ** 7;
    defer {
        for (&owned_actions) |value| if (value) |rows| allocator.free(rows);
        for (&owned_reasons) |value| if (value) |rows| allocator.free(rows);
    }
    var seen_channels = [_]bool{false} ** 7;
    for (captured.degradations, 0..) |slot, row_index| {
        if (slot.channel == 0 or slot.channel > 7 or
            slot.action_bits == 0 or slot.action_bits & ~@as(u32, 0x0f) != 0 or
            slot.reason_bits == 0 or slot.reason_bits & ~@as(u64, 0x7f) != 0 or
            slot.affected_count == 0)
        {
            return error.InvalidCapturedRecoveryMetadata;
        }
        const channel_index: usize = @intCast(slot.channel - 1);
        if (seen_channels[channel_index] or slot.reason_bits != (@as(u64, 1) << @intCast(channel_index)))
            return error.InvalidCapturedRecoveryMetadata;
        seen_channels[channel_index] = true;

        const actions = try allocator.alloc(RecoveryDegradationActionV1, @popCount(slot.action_bits));
        owned_actions[row_index] = actions;
        var action_index: usize = 0;
        for (0..4) |bit| if (slot.action_bits & (@as(u32, 1) << @intCast(bit)) != 0) {
            actions[action_index] = @enumFromInt(bit);
            action_index += 1;
        };
        const reasons = try allocator.alloc(RecoveryDegradationReasonV1, @popCount(slot.reason_bits));
        owned_reasons[row_index] = reasons;
        var reason_index: usize = 0;
        for (0..7) |bit| if (slot.reason_bits & (@as(u64, 1) << @intCast(bit)) != 0) {
            reasons[reason_index] = @enumFromInt(bit);
            reason_index += 1;
        };
        encoded.degradations[row_index] = .{
            .channel = @enumFromInt(channel_index),
            .actions = actions,
            .reasons = reasons,
            .affectedCount = slot.affected_count,
        };
    }
    encoded.degradation_count = captured.degradations.len;

    const internal_request = SnapshotRequest{
        .version = 1,
        .modelId = request.modelId,
        .label = request.label,
        .note = request.note,
        .kind = .panic,
        .push = request.push,
    };
    return commitEncodedSnapshotJson(
        io,
        allocator,
        &internal_request,
        &encoded,
        captured.triangle_count,
        captured.authored_face_count,
        null,
    );
}

/// Consume one exact verified-Save capability and append those owned package
/// bytes as `normal`. The receipt is removed before repository work begins;
/// replay and cross-model use are authorization failures.
pub fn normalSnapshotJson(
    io: std.Io,
    allocator: std.mem.Allocator,
    registry: *VerifiedSaveReceiptRegistry,
    request_json: []const u8,
) ![]u8 {
    var parsed = try parseNormalSnapshotRequestV1(allocator, request_json);
    defer parsed.deinit();
    const request = parsed.value;
    var save = try registry.consume(io, request.saveReceiptToken, request.modelId);
    defer save.deinit(registry.allocator);
    const current_sha = hashHex(save.bytes);
    if (!std.mem.eql(u8, &current_sha, &save.sha256)) return error.VerifiedSaveHashMismatch;

    var document = meshdoc_format.decodeDocument(allocator, save.bytes) catch
        return error.InvalidVerifiedSaveArtifact;
    defer document.deinit(allocator);
    if (document.version != save.format_version or
        document.version != meshdoc_format.VERSION_LOGICAL_TOPOLOGY or
        document.range_object_ids == null or
        document.range_object_ids.?.len != document.ranges.len / 2)
    {
        return error.InvalidVerifiedSaveArtifact;
    }

    var encoded = EncodedResident{
        .bytes = save.bytes,
        .part_count = document.ranges.len / 2,
        .logical_vertex_count = document.logical_vertex_count,
        .source_sha256 = save.sha256,
        .object_namespace_hash = objectNamespaceHash(request.modelId, document.range_object_ids, document.ranges),
    };
    carryEmbeddedRecoveryProvenance(allocator, &encoded, document.semantic_table_json);
    const internal_request = SnapshotRequest{
        .version = 1,
        .modelId = request.modelId,
        .label = request.label,
        .note = request.note,
        .packageGeometryPath = save.package_geometry_path,
        .kind = .normal,
        .push = request.push,
    };
    return commitEncodedSnapshotJson(
        io,
        allocator,
        &internal_request,
        &encoded,
        document.verts.len / 24,
        authoredFaceCountRows(document.verts.len, document.groups),
        null,
    );
}

/// Native-only transaction event append. The coordinator already owns and has
/// hash-verified these bytes; JavaScript cannot choose this event vocabulary or
/// supply geometry through a public host door.
pub fn appendOwnedTransactionEventJson(
    io: std.Io,
    allocator: std.mem.Allocator,
    model_id: []const u8,
    kind: TransactionSnapshotKind,
    label: []const u8,
    note: ?[]const u8,
    package_geometry_path: []const u8,
    bytes: []const u8,
    expected_sha256: []const u8,
    push: bool,
) ![]u8 {
    if (model_id.len == 0 or label.len == 0 or expected_sha256.len != 64)
        return error.InvalidRequest;
    const sha = hashHex(bytes);
    if (!std.mem.eql(u8, &sha, expected_sha256)) return error.SnapshotHashMismatch;
    var document = meshdoc_format.decodeDocument(allocator, bytes) catch
        return error.InvalidVerifiedSaveArtifact;
    defer document.deinit(allocator);
    if (document.version != meshdoc_format.VERSION_LOGICAL_TOPOLOGY or
        document.range_object_ids == null or
        document.range_object_ids.?.len == 0 or
        document.range_object_ids.?.len * 2 != document.ranges.len)
    {
        return error.InvalidVerifiedSaveArtifact;
    }
    var encoded = EncodedResident{
        .bytes = @constCast(bytes),
        .part_count = document.ranges.len / 2,
        .logical_vertex_count = document.logical_vertex_count,
        .source_sha256 = sha,
        .object_namespace_hash = objectNamespaceHash(model_id, document.range_object_ids, document.ranges),
    };
    carryEmbeddedRecoveryProvenance(allocator, &encoded, document.semantic_table_json);
    const internal_request = SnapshotRequest{
        .version = 1,
        .modelId = model_id,
        .label = label,
        .note = note,
        .packageGeometryPath = package_geometry_path,
        .kind = switch (kind) {
            .save_mismatch => .save_mismatch,
            .pre_restore => .pre_restore,
            .pre_field_edit => .pre_field_edit,
            .restored => .restored,
            .field_edit => .field_edit,
        },
        .push = push,
    };
    return commitEncodedSnapshotJson(
        io,
        allocator,
        &internal_request,
        &encoded,
        document.verts.len / 24,
        authoredFaceCountRows(document.verts.len, document.groups),
        null,
    );
}

const MaterializedRevision = struct {
    file: MaterializedFile,
    document: meshdoc_format.Document,

    fn deinit(self: *MaterializedRevision, allocator: std.mem.Allocator) void {
        self.document.deinit(allocator);
        self.file.deinit(allocator);
        self.* = undefined;
    }
};

fn materializeResidentPath(
    io: std.Io,
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    resident_path: []const u8,
    revision: []const u8,
    offline: bool,
    retain: bool,
) !MaterializedRevision {
    if (!validRevision(revision)) return error.InvalidRevision;
    var file = try materializeLoreFile(
        io,
        allocator,
        repository_path,
        resident_path,
        revision,
        ".rjmd",
        offline,
        retain,
    );
    errdefer file.deinit(allocator);
    const document = try meshdoc_format.decodeDocument(allocator, file.bytes);
    errdefer {
        var owned = document;
        owned.deinit(allocator);
    }
    if (document.version != meshdoc_format.VERSION_LOGICAL_TOPOLOGY) return error.NotCurrentRjmd;
    return .{ .file = file, .document = document };
}

const ResolvedSnapshot = struct {
    revision: [64]u8,
    revision_number: u64,
    metadata: OwnedMetadata,

    fn deinit(self: *ResolvedSnapshot, allocator: std.mem.Allocator) void {
        self.metadata.deinit(allocator);
        self.* = undefined;
    }
};

fn resolveIndexEntry(
    io: std.Io,
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    paths: *const Paths,
    model_id: []const u8,
    entry: *const HistoryIndexEntry,
    now_ms: i64,
    expected_revision: ?[]const u8,
    expected_sha256: ?[]const u8,
) !ResolvedSnapshot {
    try validateIndexEntryPaths(allocator, paths, entry);
    var event_history = try lore.fileHistory(allocator, repository_path, "", entry.eventPath, .{ .length = 1 });
    defer event_history.deinit(allocator);
    if (event_history.entries.len == 0) return error.SnapshotNotFound;
    const revision = revisionHex(event_history.entries[0].revision);
    if (expected_revision) |guard| {
        if (!validRevision(guard)) return error.InvalidRevision;
        if (!std.mem.eql(u8, guard, &revision)) return error.StaleHistoryRow;
    }
    var metadata = try metadataFromEventPathRevision(
        io,
        allocator,
        repository_path,
        entry.eventPath,
        &revision,
    );
    errdefer metadata.deinit(allocator);
    try validateIndexedMetadata(model_id, entry, &metadata);
    if (try snapshotIsExpired(metadata.timestamp_ms, now_ms)) return error.SnapshotExpired;
    if (expected_sha256) |guard| {
        if (!validRevision(guard)) return error.InvalidSnapshotHash;
        if (!std.mem.eql(u8, guard, metadata.sha256)) return error.StaleHistoryRow;
    }
    return .{
        .revision = revision,
        .revision_number = event_history.entries[0].revision_number,
        .metadata = metadata,
    };
}

fn resolveSnapshot(
    io: std.Io,
    allocator: std.mem.Allocator,
    model_id: []const u8,
    snapshot_id: []const u8,
    compatibility_revision: []const u8,
    expected_revision: ?[]const u8,
    expected_sha256: ?[]const u8,
) !ResolvedSnapshot {
    if (snapshot_id.len == 0 and compatibility_revision.len == 0) return error.SnapshotIdRequired;
    if (snapshot_id.len > 0 and !validSnapshotId(snapshot_id)) return error.InvalidSnapshotId;
    if (compatibility_revision.len > 0 and !validRevision(compatibility_revision)) return error.InvalidRevision;
    const now_ms = std.Io.Clock.now(.real, io).toMilliseconds();
    // Snapshot ID time is part of the stable identity and is cross-checked
    // against every indexed event. Check it before index lookup so a row that
    // maintenance already removed still refuses as expired, never "not found".
    if (snapshot_id.len > 0 and try snapshotIsExpired(try snapshotIdTimestampMs(snapshot_id), now_ms))
        return error.SnapshotExpired;
    var paths = try Paths.init(allocator, model_id);
    defer paths.deinit(allocator);
    const repository_path = try repositoryPathAlloc(io, allocator);
    defer allocator.free(repository_path);
    var index = try readHistoryIndexDurable(io, allocator, repository_path, &paths);
    defer index.deinit(allocator);
    if (snapshot_id.len > 0) {
        for (index.entries) |*entry| {
            if (!std.mem.eql(u8, entry.snapshotId, snapshot_id)) continue;
            return resolveIndexEntry(
                io,
                allocator,
                repository_path,
                &paths,
                model_id,
                entry,
                now_ms,
                expected_revision,
                expected_sha256,
            );
        }
        return error.SnapshotNotFound;
    }

    // Temporary request compatibility is index-only: revisions may locate a
    // new immutable row, but never authorize reading the retired shared paths.
    for (index.entries) |*entry| {
        var event_history = try lore.fileHistory(allocator, repository_path, "", entry.eventPath, .{ .length = 1 });
        defer event_history.deinit(allocator);
        if (event_history.entries.len == 0) continue;
        const candidate = revisionHex(event_history.entries[0].revision);
        if (!std.mem.eql(u8, &candidate, compatibility_revision)) continue;
        return resolveIndexEntry(
            io,
            allocator,
            repository_path,
            &paths,
            model_id,
            entry,
            now_ms,
            expected_revision,
            expected_sha256,
        );
    }
    return error.SnapshotNotFound;
}

fn historyItemFromResolved(
    allocator: std.mem.Allocator,
    resolved: *const ResolvedSnapshot,
    pinned: bool,
) !HistoryItemV1 {
    const snapshot_id = try allocator.dupe(u8, resolved.metadata.snapshot_id);
    errdefer allocator.free(snapshot_id);
    const revision = try allocator.dupe(u8, &resolved.revision);
    errdefer allocator.free(revision);
    const label = try allocator.dupe(u8, resolved.metadata.label);
    errdefer allocator.free(label);
    const note = try allocator.dupe(u8, resolved.metadata.note);
    errdefer allocator.free(note);
    const kind = try allocator.dupe(u8, resolved.metadata.kind);
    errdefer allocator.free(kind);
    const sha = try allocator.dupe(u8, resolved.metadata.sha256);
    errdefer allocator.free(sha);
    const identity_quality = try allocator.dupe(u8, resolved.metadata.identity_quality);
    errdefer allocator.free(identity_quality);
    const object_namespace_hash = try allocator.dupe(u8, resolved.metadata.object_namespace_hash);
    errdefer allocator.free(object_namespace_hash);
    const recovery_degradations = try dupeDegradations(allocator, resolved.metadata.recovery_degradations);
    errdefer freeDegradations(allocator, recovery_degradations);
    const expires_at_ms = try snapshotExpiresAtMs(resolved.metadata.timestamp_ms);
    const degraded = recovery_degradations.len > 0;
    return .{
        .snapshotId = snapshot_id,
        .revision = revision,
        .revisionNumber = resolved.revision_number,
        .timestampMs = resolved.metadata.timestamp_ms,
        .sequence = resolved.metadata.sequence,
        .label = label,
        .note = note,
        .kind = kind,
        .sha256 = sha,
        .byteLength = resolved.metadata.byte_length,
        .bytes = resolved.metadata.byte_length,
        .triangleCount = resolved.metadata.triangle_count,
        .triangles = resolved.metadata.triangle_count,
        .authoredFaces = if (resolved.metadata.authored_face_count > 0)
            resolved.metadata.authored_face_count
        else
            resolved.metadata.triangle_count,
        .partCount = resolved.metadata.part_count,
        .parts = resolved.metadata.part_count,
        .logicalVertexCount = resolved.metadata.logical_vertex_count,
        .logicalVertices = resolved.metadata.logical_vertex_count,
        .pinned = pinned,
        .expiresAtMs = expires_at_ms,
        .pushState = "unknown",
        .identityQuality = identity_quality,
        .objectNamespaceHash = object_namespace_hash,
        .recoveryDegradations = recovery_degradations,
        .warning = if (degraded) "recovery snapshot contains persisted channel degradation" else null,
    };
}

pub fn historyJson(io: std.Io, allocator: std.mem.Allocator, request_json: []const u8) ![]u8 {
    var parsed = try parseRequest(ModelRequest, allocator, request_json);
    defer parsed.deinit();
    if (parsed.value.cursor.len > 0 and !validSnapshotId(parsed.value.cursor)) return error.InvalidHistoryCursor;
    var paths = try Paths.init(allocator, parsed.value.modelId);
    defer paths.deinit(allocator);
    const repository_path = try repositoryPathAlloc(io, allocator);
    defer allocator.free(repository_path);
    var index = try readHistoryIndexDurable(io, allocator, repository_path, &paths);
    defer index.deinit(allocator);
    var pins = try readPinsDurable(io, allocator, repository_path, &paths);
    defer pins.deinit(allocator);
    std.mem.sort(HistoryIndexEntry, index.entries, {}, struct {
        fn lessThan(_: void, left: HistoryIndexEntry, right: HistoryIndexEntry) bool {
            return std.mem.lessThan(u8, right.snapshotId, left.snapshotId);
        }
    }.lessThan);

    var start: usize = 0;
    if (parsed.value.cursor.len > 0) {
        start = for (index.entries, 0..) |entry, position| {
            if (std.mem.eql(u8, entry.snapshotId, parsed.value.cursor)) break position + 1;
        } else return error.InvalidHistoryCursor;
    }
    const page_length = @min(if (parsed.value.limit == 0) DEFAULT_HISTORY else parsed.value.limit, MAX_HISTORY);
    const now_ms = std.Io.Clock.now(.real, io).toMilliseconds();
    var items: std.ArrayList(HistoryItemV1) = .empty;
    defer {
        for (items.items) |*item| item.deinit(allocator);
        items.deinit(allocator);
    }
    var has_more = false;
    for (index.entries[start..]) |*entry| {
        var resolved = resolveIndexEntry(
            io,
            allocator,
            repository_path,
            &paths,
            parsed.value.modelId,
            entry,
            now_ms,
            null,
            null,
        ) catch |err| switch (err) {
            error.SnapshotExpired => continue,
            else => return err,
        };
        defer resolved.deinit(allocator);
        if (items.items.len == page_length) {
            has_more = true;
            break;
        }
        var item = try historyItemFromResolved(
            allocator,
            &resolved,
            pins.contains(resolved.metadata.snapshot_id),
        );
        errdefer item.deinit(allocator);
        try items.append(allocator, item);
    }
    const next_cursor: ?[]const u8 = if (has_more and items.items.len > 0)
        items.items[items.items.len - 1].snapshotId
    else
        null;
    return historyReceiptJsonAlloc(
        allocator,
        parsed.value.modelId,
        if (parsed.value.cursor.len == 0) null else parsed.value.cursor,
        next_cursor,
        items.items,
        "not_needed",
    );
}

pub fn historyProtocolJson(io: std.Io, allocator: std.mem.Allocator, request_json: []const u8) ![]u8 {
    var request = std.json.parseFromSlice(HistoryRequestV1, allocator, request_json, .{}) catch
        return loreErrorJsonAlloc(allocator, .invalid_request, "invalid HistoryRequestV1");
    defer request.deinit();
    if (request.value.version != 1 or request.value.modelId.len == 0) {
        return loreErrorJsonAlloc(allocator, .invalid_request, "invalid HistoryRequestV1");
    }
    if (request.value.limit) |limit| if (limit == 0 or limit > MAX_HISTORY)
        return loreErrorJsonAlloc(allocator, .invalid_request, "invalid HistoryRequestV1");
    return historyJson(io, allocator, request_json) catch |err|
        loreErrorForNativeErrorJsonAlloc(allocator, err);
}

/// The retired path-returning preview surface is permanently disabled. Keeping
/// this symbol lets old test roots compile while making it impossible for any
/// caller to receive a private materialization filename.
pub fn previewJson(_: std.Io, _: std.mem.Allocator, _: []const u8) ![]u8 {
    return error.LegacyPreviewDisabled;
}

pub const PreviewCapabilityBorrow = owned_byte_capability.BorrowGuard;

/// Borrow bytes synchronously for the cold-host -> replaceable-Scene3D call.
/// The caller must `deinit(io)` the returned guard after the Scene3D callback
/// returns. No byte slice survives the guard and no filesystem path crosses.
pub fn borrowPreviewCapability(
    io: std.Io,
    capability_token: []const u8,
    expected: owned_byte_capability.BorrowExpectation,
) !PreviewCapabilityBorrow {
    return preview_capabilities.borrow(io, capability_token, expected);
}

pub fn releasePreviewCapability(
    io: std.Io,
    capability_token: []const u8,
) !owned_byte_capability.ReleaseResult {
    return preview_capabilities.release(io, capability_token);
}

pub fn previewCapabilityCount(io: std.Io) usize {
    return preview_capabilities.activeCount(io);
}

pub fn clearPreviewCapabilities(io: std.Io) void {
    preview_capabilities.deinit(io);
    preview_capabilities = owned_byte_capability.Registry.init(
        std.heap.c_allocator,
        PREVIEW_CAPABILITY_PREFIX,
        MAX_PREVIEW_CAPABILITIES,
        MAX_PREVIEW_TOMBSTONES,
    );
}

/// Resolve the immutable snapshot row, verify the exact RJMD bytes, and retain
/// them behind an opaque process-private capability. The only consumer is the
/// synchronous native Scene3D preview bridge.
pub fn previewProtocolJson(io: std.Io, allocator: std.mem.Allocator, request_json: []const u8) ![]u8 {
    var request = std.json.parseFromSlice(PreviewRequestV1, allocator, request_json, .{}) catch
        return loreErrorJsonAlloc(allocator, .invalid_request, "invalid PreviewRequestV1");
    defer request.deinit();
    if (request.value.version != 1) {
        return loreErrorJsonAlloc(allocator, .invalid_request, "invalid PreviewRequestV1");
    }

    switch (request.value.operation) {
        .release => {
            const token = request.value.capabilityToken orelse
                return loreErrorJsonAlloc(allocator, .invalid_request, "release requires capabilityToken");
            if (token.len == 0 or request.value.modelId != null or request.value.snapshotId != null or
                request.value.expectedRevision != null or request.value.expectedSha256 != null)
            {
                return loreErrorJsonAlloc(allocator, .invalid_request, "release accepts only capabilityToken");
            }
            const released = releasePreviewCapability(io, token) catch |err|
                return loreErrorForNativeErrorJsonAlloc(allocator, err);
            return std.json.Stringify.valueAlloc(allocator, .{
                .ok = true,
                .version = 1,
                .released = released.released,
                .alreadyReleased = released.already_released,
            }, .{});
        },
        .open => {
            const model_id = request.value.modelId orelse
                return loreErrorJsonAlloc(allocator, .invalid_request, "open requires modelId");
            const snapshot_id = request.value.snapshotId orelse
                return loreErrorJsonAlloc(allocator, .invalid_request, "open requires snapshotId");
            if (model_id.len == 0 or snapshot_id.len == 0 or request.value.capabilityToken != null) {
                return loreErrorJsonAlloc(allocator, .invalid_request, "invalid preview open fields");
            }
            var resolved = resolveSnapshot(
                io,
                allocator,
                model_id,
                snapshot_id,
                "",
                request.value.expectedRevision,
                request.value.expectedSha256,
            ) catch |err| return loreErrorForNativeErrorJsonAlloc(allocator, err);
            defer resolved.deinit(allocator);
            const repository_path = repositoryPathAlloc(io, allocator) catch |err|
                return loreErrorForNativeErrorJsonAlloc(allocator, err);
            defer allocator.free(repository_path);
            var materialized = materializeResidentPath(
                io,
                allocator,
                repository_path,
                resolved.metadata.resident_path,
                &resolved.revision,
                false,
                false,
            ) catch |err| return loreErrorForNativeErrorJsonAlloc(allocator, err);
            defer materialized.deinit(allocator);
            const sha = hashHex(materialized.file.bytes);
            if (!std.mem.eql(u8, &sha, resolved.metadata.sha256)) {
                return loreErrorJsonAlloc(allocator, .hash_mismatch, "snapshot bytes do not match immutable event SHA-256");
            }

            const owned_bytes = std.heap.c_allocator.dupe(u8, materialized.file.bytes) catch
                return loreErrorJsonAlloc(allocator, .internal_error, "preview byte retention failed");
            var owns_bytes = true;
            errdefer if (owns_bytes) std.heap.c_allocator.free(owned_bytes);
            const capability_token = preview_capabilities.issueOwned(io, .{
                .model_id = model_id,
                .stable_id = snapshot_id,
                .revision = &resolved.revision,
                .sha256 = &sha,
                .format_version = materialized.document.version,
                .bytes = owned_bytes,
            }) catch |err| return loreErrorForNativeErrorJsonAlloc(allocator, err);
            owns_bytes = false;
            defer std.heap.c_allocator.free(capability_token);
            errdefer _ = releasePreviewCapability(io, capability_token) catch {};

            return std.json.Stringify.valueAlloc(allocator, .{
                .ok = true,
                .version = 1,
                .snapshotId = resolved.metadata.snapshot_id,
                .resolvedRevision = &resolved.revision,
                .sha256 = &sha,
                .formatVersion = materialized.document.version,
                .capabilityToken = capability_token,
                .artifactScope = "rjmd_geometry",
                .identityQuality = resolved.metadata.identity_quality,
                .objectNamespaceHash = resolved.metadata.object_namespace_hash,
                .recoveryDegradations = resolved.metadata.recovery_degradations,
            }, .{});
        },
    }
}

pub const RestoreCandidateBorrow = owned_byte_capability.BorrowGuard;

pub fn borrowRestoreCandidate(
    io: std.Io,
    candidate_token: []const u8,
    expected: owned_byte_capability.BorrowExpectation,
) !RestoreCandidateBorrow {
    return restore_candidates.borrow(io, candidate_token, expected);
}

pub fn releaseRestoreCandidate(
    io: std.Io,
    candidate_token: []const u8,
) !owned_byte_capability.ReleaseResult {
    return restore_candidates.release(io, candidate_token);
}

pub fn restoreCandidateCount(io: std.Io) usize {
    return restore_candidates.activeCount(io);
}

pub fn clearRestoreCandidates(io: std.Io) void {
    restore_candidates.deinit(io);
    restore_candidates = owned_byte_capability.Registry.init(
        std.heap.c_allocator,
        RESTORE_CANDIDATE_PREFIX,
        MAX_RESTORE_CANDIDATES,
        MAX_RESTORE_CANDIDATE_TOMBSTONES,
    );
}

/// Resolve and retain one immutable historical target behind a distinct opaque
/// capability. Preview and restore tokens are intentionally not interchangeable.
pub fn validateExactRestoreCandidateProvenance(
    identity_quality: []const u8,
    degradation_count: usize,
    expected_object_namespace_hash: []const u8,
    computed_object_namespace_hash: []const u8,
) !void {
    if (!std.mem.eql(u8, identity_quality, "exact") or degradation_count != 0)
        return error.DegradedRestoreCandidate;
    if (!validRevision(expected_object_namespace_hash) or
        !validRevision(computed_object_namespace_hash) or
        !std.mem.eql(u8, expected_object_namespace_hash, computed_object_namespace_hash))
    {
        return error.RestoreCandidateNamespaceMismatch;
    }
}

pub fn restoreCandidateProtocolJson(
    io: std.Io,
    allocator: std.mem.Allocator,
    request_json: []const u8,
) ![]u8 {
    var request = std.json.parseFromSlice(RestoreCandidateRequestV1, allocator, request_json, .{}) catch
        return loreErrorJsonAlloc(allocator, .invalid_request, "invalid RestoreCandidateRequestV1");
    defer request.deinit();
    if (request.value.version != 1)
        return loreErrorJsonAlloc(allocator, .invalid_request, "invalid RestoreCandidateRequestV1");

    switch (request.value.operation) {
        .release_candidate => {
            const token = request.value.candidateToken orelse
                return loreErrorJsonAlloc(allocator, .invalid_request, "release_candidate requires candidateToken");
            if (token.len == 0 or request.value.modelId != null or request.value.snapshotId != null or
                request.value.expectedRevision != null or request.value.expectedSha256 != null)
            {
                return loreErrorJsonAlloc(allocator, .invalid_request, "release_candidate accepts only candidateToken");
            }
            const released = releaseRestoreCandidate(io, token) catch |err|
                return loreErrorForNativeErrorJsonAlloc(allocator, err);
            return std.json.Stringify.valueAlloc(allocator, .{
                .ok = true,
                .version = 1,
                .released = released.released,
                .alreadyReleased = released.already_released,
            }, .{});
        },
        .open_candidate => {
            const model_id = request.value.modelId orelse
                return loreErrorJsonAlloc(allocator, .invalid_request, "open_candidate requires modelId");
            const snapshot_id = request.value.snapshotId orelse
                return loreErrorJsonAlloc(allocator, .invalid_request, "open_candidate requires snapshotId");
            if (model_id.len == 0 or snapshot_id.len == 0 or request.value.candidateToken != null)
                return loreErrorJsonAlloc(allocator, .invalid_request, "invalid restore candidate fields");
            var resolved = resolveSnapshot(
                io,
                allocator,
                model_id,
                snapshot_id,
                "",
                request.value.expectedRevision,
                request.value.expectedSha256,
            ) catch |err| return loreErrorForNativeErrorJsonAlloc(allocator, err);
            defer resolved.deinit(allocator);
            const repository_path = repositoryPathAlloc(io, allocator) catch |err|
                return loreErrorForNativeErrorJsonAlloc(allocator, err);
            defer allocator.free(repository_path);
            var materialized = materializeResidentPath(
                io,
                allocator,
                repository_path,
                resolved.metadata.resident_path,
                &resolved.revision,
                false,
                false,
            ) catch |err| return loreErrorForNativeErrorJsonAlloc(allocator, err);
            defer materialized.deinit(allocator);
            if (materialized.document.version != meshdoc_format.VERSION_LOGICAL_TOPOLOGY or
                materialized.document.range_object_ids == null or
                materialized.document.logical_vertex_count == 0 or
                materialized.document.range_object_ids.?.len == 0 or
                materialized.document.range_object_ids.?.len * 2 != materialized.document.ranges.len)
            {
                return loreErrorJsonAlloc(allocator, .corrupt_event, "restore candidate must be RJMD v5 with stable object IDs");
            }
            const sha = hashHex(materialized.file.bytes);
            if (!std.mem.eql(u8, &sha, resolved.metadata.sha256))
                return loreErrorJsonAlloc(allocator, .hash_mismatch, "candidate bytes do not match immutable event SHA-256");
            const computed_namespace = objectNamespaceHash(
                model_id,
                materialized.document.range_object_ids,
                materialized.document.ranges,
            );
            validateExactRestoreCandidateProvenance(
                resolved.metadata.identity_quality,
                resolved.metadata.recovery_degradations.len,
                resolved.metadata.object_namespace_hash,
                &computed_namespace,
            ) catch |err| return loreErrorJsonAlloc(allocator, .corrupt_event, switch (err) {
                error.DegradedRestoreCandidate => "restore requires an exact snapshot with zero recovery degradations",
                error.RestoreCandidateNamespaceMismatch => "candidate object namespace differs from immutable event metadata",
            });

            const owned_bytes = std.heap.c_allocator.dupe(u8, materialized.file.bytes) catch
                return loreErrorJsonAlloc(allocator, .internal_error, "restore candidate retention failed");
            var owns_bytes = true;
            errdefer if (owns_bytes) std.heap.c_allocator.free(owned_bytes);
            const candidate_token = restore_candidates.issueOwned(io, .{
                .model_id = model_id,
                .stable_id = snapshot_id,
                .revision = &resolved.revision,
                .sha256 = &sha,
                .format_version = materialized.document.version,
                .bytes = owned_bytes,
            }) catch |err| return loreErrorForNativeErrorJsonAlloc(allocator, err);
            owns_bytes = false;
            defer std.heap.c_allocator.free(candidate_token);
            errdefer _ = releaseRestoreCandidate(io, candidate_token) catch {};

            return std.json.Stringify.valueAlloc(allocator, .{
                .ok = true,
                .version = 1,
                .snapshotId = resolved.metadata.snapshot_id,
                .resolvedRevision = &resolved.revision,
                .sha256 = &sha,
                .formatVersion = materialized.document.version,
                .candidateToken = candidate_token,
                .artifactScope = "rjmd_geometry",
                .identityQuality = resolved.metadata.identity_quality,
                .objectNamespaceHash = resolved.metadata.object_namespace_hash,
                .recoveryDegradations = resolved.metadata.recovery_degradations,
            }, .{});
        },
    }
}

pub fn validPackageGeometryPath(path: []const u8) bool {
    if (!fs.isConfined(path) or !std.mem.startsWith(u8, path, MODEL_PACKAGE_ROOT ++ "/")) return false;
    var segments = std.mem.splitScalar(u8, path, '/');
    while (segments.next()) |segment| {
        // Prefix checks before lexical normalization are not confinement.
        // Reject every ambiguous segment, even when `..` would remain beneath
        // the repository root after depth counting.
        if (segment.len == 0 or std.mem.eql(u8, segment, ".") or std.mem.eql(u8, segment, "..")) return false;
    }
    return (std.mem.endsWith(u8, path, ".rjmd") or std.mem.endsWith(u8, path, "/mesh/doc.blob"));
}

pub fn restoreParentConfined(io: std.Io, allocator: std.mem.Allocator, path: []const u8) !bool {
    const parent_path = std.fs.path.dirname(path) orelse return false;
    const cwd = std.Io.Dir.cwd();
    const root = try cwd.realPathFileAlloc(io, MODEL_PACKAGE_ROOT, allocator);
    defer allocator.free(root);
    const parent = try cwd.realPathFileAlloc(io, parent_path, allocator);
    defer allocator.free(parent);
    return parent.len > root.len and
        std.mem.startsWith(u8, parent, root) and
        parent[root.len] == '/';
}

pub const PackageArtifactTransaction = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    path: []u8,
    predecessor: ?[]u8,
    predecessor_sha256: ?[64]u8,
    lock: fs.TargetWriteLock,
    target_installed: bool = false,
    installed_sha256: ?[64]u8 = null,
    closed: bool = false,

    pub fn begin(
        io: std.Io,
        allocator: std.mem.Allocator,
        path: []const u8,
        expected_predecessor_sha256: ?[]const u8,
    ) !PackageArtifactTransaction {
        if (!validPackageGeometryPath(path) or !try restoreParentConfined(io, allocator, path))
            return error.RestoreTargetEscapesModelRoot;
        if (expected_predecessor_sha256) |sha| if (!validSha256(sha)) return error.InvalidRequest;
        const owned_path = try allocator.dupe(u8, path);
        errdefer allocator.free(owned_path);
        var lock = try fs.acquireTargetWriteLock(io, std.Io.Dir.cwd(), path);
        errdefer lock.release();
        const predecessor = std.Io.Dir.cwd().readFileAlloc(io, path, allocator, .unlimited) catch |err| switch (err) {
            error.FileNotFound => null,
            else => return err,
        };
        errdefer if (predecessor) |bytes| allocator.free(bytes);
        const predecessor_sha = if (predecessor) |bytes| hashHex(bytes) else null;
        if ((expected_predecessor_sha256 == null) != (predecessor == null)) return error.PackagePredecessorChanged;
        if (expected_predecessor_sha256) |expected| {
            if (!std.mem.eql(u8, expected, &predecessor_sha.?)) return error.PackagePredecessorChanged;
        }
        if (predecessor) |bytes| {
            var document = meshdoc_format.decodeDocument(allocator, bytes) catch return error.InvalidPackagePredecessor;
            defer document.deinit(allocator);
            if (document.version != meshdoc_format.VERSION_LOGICAL_TOPOLOGY or document.range_object_ids == null)
                return error.InvalidPackagePredecessor;
        }
        return .{
            .allocator = allocator,
            .io = io,
            .path = owned_path,
            .predecessor = predecessor,
            .predecessor_sha256 = predecessor_sha,
            .lock = lock,
        };
    }

    pub fn install(self: *PackageArtifactTransaction, bytes: []const u8, expected_sha256: []const u8) ![64]u8 {
        if (self.closed or self.target_installed or !validSha256(expected_sha256)) return error.InvalidPackageTransaction;
        const sha = hashHex(bytes);
        if (!std.mem.eql(u8, &sha, expected_sha256)) return error.SnapshotHashMismatch;
        if (!contentAddressMatches(self.path, &sha)) return error.ImmutableArtifactHashMismatch;
        var document = meshdoc_format.decodeDocument(self.allocator, bytes) catch return error.InvalidVerifiedSaveArtifact;
        defer document.deinit(self.allocator);
        if (document.version != meshdoc_format.VERSION_LOGICAL_TOPOLOGY or document.range_object_ids == null)
            return error.InvalidVerifiedSaveArtifact;

        // The advisory lock serializes every current writer, while this exact
        // check also catches an old/uncoordinated writer before replacement.
        const current = std.Io.Dir.cwd().readFileAlloc(self.io, self.path, self.allocator, .unlimited) catch |err| switch (err) {
            error.FileNotFound => null,
            else => return err,
        };
        defer if (current) |current_bytes| self.allocator.free(current_bytes);
        if ((current == null) != (self.predecessor == null)) return error.PackagePredecessorChanged;
        if (current) |current_bytes| {
            if (!std.mem.eql(u8, current_bytes, self.predecessor.?)) return error.PackagePredecessorChanged;
        }

        self.installed_sha256 = sha;
        self.target_installed = true;
        try writeDurableAtomic(self.io, self.path, bytes);
        const readback = try std.Io.Dir.cwd().readFileAlloc(self.io, self.path, self.allocator, .unlimited);
        defer self.allocator.free(readback);
        const readback_sha = hashHex(readback);
        if (!std.mem.eql(u8, &readback_sha, &sha) or !std.mem.eql(u8, readback, bytes))
            return error.RestoreReadbackMismatch;
        var readback_document = meshdoc_format.decodeDocument(self.allocator, readback) catch
            return error.RestoreReadbackMismatch;
        defer readback_document.deinit(self.allocator);
        if (readback_document.version != meshdoc_format.VERSION_LOGICAL_TOPOLOGY or
            readback_document.range_object_ids == null)
        {
            return error.RestoreReadbackMismatch;
        }
        return readback_sha;
    }

    pub fn rollback(self: *PackageArtifactTransaction) !void {
        if (self.closed) return error.InvalidPackageTransaction;
        if (!self.target_installed) return;
        if (self.target_installed) {
            const current = std.Io.Dir.cwd().readFileAlloc(self.io, self.path, self.allocator, .unlimited) catch |err| switch (err) {
                error.FileNotFound => null,
                else => return err,
            };
            defer if (current) |current_bytes| self.allocator.free(current_bytes);
            const already_predecessor = if (self.predecessor) |predecessor|
                current != null and std.mem.eql(u8, current.?, predecessor)
            else
                current == null;
            if (already_predecessor) {
                self.target_installed = false;
                self.installed_sha256 = null;
                return;
            }
            const current_bytes = current orelse return error.PackageRollbackTargetChanged;
            const current_sha = hashHex(current_bytes);
            if (!std.mem.eql(u8, &current_sha, &self.installed_sha256.?)) return error.PackageRollbackTargetChanged;
        }
        if (self.predecessor) |bytes| {
            try writeDurableAtomic(self.io, self.path, bytes);
            const readback = try std.Io.Dir.cwd().readFileAlloc(self.io, self.path, self.allocator, .unlimited);
            defer self.allocator.free(readback);
            const readback_sha = hashHex(readback);
            if (!std.mem.eql(u8, readback, bytes) or
                !std.mem.eql(u8, &readback_sha, &self.predecessor_sha256.?))
            {
                return error.PackageRollbackMismatch;
            }
        } else {
            std.Io.Dir.cwd().deleteFile(self.io, self.path) catch |err| switch (err) {
                error.FileNotFound => {},
                else => return err,
            };
            if (fs.pathExists(self.io, std.Io.Dir.cwd(), self.path)) return error.PackageRollbackMismatch;
        }
        self.target_installed = false;
        self.installed_sha256 = null;
    }

    pub fn deinit(self: *PackageArtifactTransaction) void {
        if (self.closed) return;
        self.lock.release();
        if (self.predecessor) |bytes| self.allocator.free(bytes);
        self.allocator.free(self.path);
        self.closed = true;
    }
};

fn contentAddressMatches(path: []const u8, sha: []const u8) bool {
    const base = std.fs.path.basename(path);
    if (!std.mem.startsWith(u8, base, "character-") or !std.mem.endsWith(u8, base, ".rjmd")) return true;
    const encoded = base["character-".len .. base.len - ".rjmd".len];
    return std.mem.eql(u8, encoded, sha);
}

/// Validate one exact package readback before it may enter the receipt registry.
/// Current v5 plus stable range/object identity are mandatory; this function
/// never repairs or re-encodes ordinary Save bytes.
pub fn verifiedSaveFromBytesAlloc(
    allocator: std.mem.Allocator,
    model_id: []const u8,
    package_geometry_path: []const u8,
    bytes: []const u8,
    expected_sha256: []const u8,
) !OwnedVerifiedSave {
    const sha = hashHex(bytes);
    if (!std.mem.eql(u8, &sha, expected_sha256)) return error.VerifiedSaveHashMismatch;
    if (!contentAddressMatches(package_geometry_path, &sha)) return error.VerifiedSaveHashMismatch;
    var document = meshdoc_format.decodeDocument(allocator, bytes) catch return error.InvalidVerifiedSaveArtifact;
    defer document.deinit(allocator);
    if (document.version != meshdoc_format.VERSION_LOGICAL_TOPOLOGY or
        document.ranges.len == 0 or document.ranges.len % 2 != 0 or
        document.range_object_ids == null or
        document.range_object_ids.?.len != document.ranges.len / 2)
    {
        return error.InvalidVerifiedSaveArtifact;
    }
    for (document.range_object_ids.?, 0..) |object_id, index| {
        if (object_id.len == 0) return error.InvalidVerifiedSaveArtifact;
        for (document.range_object_ids.?[0..index]) |prior| {
            if (std.mem.eql(u8, prior, object_id)) return error.InvalidVerifiedSaveArtifact;
        }
    }
    const model_copy = try allocator.dupe(u8, model_id);
    errdefer allocator.free(model_copy);
    const path_copy = try allocator.dupe(u8, package_geometry_path);
    errdefer allocator.free(path_copy);
    return .{
        .model_id = model_copy,
        .package_geometry_path = path_copy,
        .bytes = try allocator.dupe(u8, bytes),
        .sha256 = sha,
        .format_version = document.version,
    };
}

pub fn issueVerifiedSaveReceiptJson(
    io: std.Io,
    allocator: std.mem.Allocator,
    registry: *VerifiedSaveReceiptRegistry,
    request_json: []const u8,
) ![]u8 {
    var parsed = try parseVerifiedSaveReceiptIssueRequestV1(allocator, request_json);
    defer parsed.deinit();
    const request = parsed.value;
    const bytes = model_package_geometry.readDeclaredGeometryFromCwdAlloc(
        io,
        allocator,
        request.modelId,
        request.packageGeometryPath,
    ) catch return error.InvalidVerifiedSaveTarget;
    defer allocator.free(bytes);
    var save = try verifiedSaveFromBytesAlloc(
        registry.allocator,
        request.modelId,
        request.packageGeometryPath,
        bytes,
        request.expectedSha256,
    );
    var transferred = false;
    errdefer if (!transferred) save.deinit(registry.allocator);
    const format_version = save.format_version;
    const token = try registry.issueOwned(io, save);
    transferred = true;
    defer registry.allocator.free(token);
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = true,
        .version = 1,
        .modelId = request.modelId,
        .saveReceiptToken = token,
        .sha256 = request.expectedSha256,
        .bytes = bytes.len,
        .formatVersion = format_version,
    }, .{});
}

pub fn restoreJson(io: std.Io, allocator: std.mem.Allocator, request_json: []const u8) ![]u8 {
    var parsed = try parseRequest(RestoreRequest, allocator, request_json);
    defer parsed.deinit();
    if (!validPackageGeometryPath(parsed.value.packageGeometryPath)) return error.InvalidRestoreTarget;
    if (!try restoreParentConfined(io, allocator, parsed.value.packageGeometryPath)) return error.RestoreTargetEscapesModelRoot;
    var resolved = try resolveSnapshot(
        io,
        allocator,
        parsed.value.modelId,
        parsed.value.snapshotId,
        parsed.value.revision,
        parsed.value.expectedRevision,
        parsed.value.expectedSha256,
    );
    defer resolved.deinit(allocator);
    const repository_path = try repositoryPathAlloc(io, allocator);
    defer allocator.free(repository_path);
    var materialized = try materializeResidentPath(
        io,
        allocator,
        repository_path,
        resolved.metadata.resident_path,
        &resolved.revision,
        false,
        false,
    );
    defer materialized.deinit(allocator);
    if (resolved.metadata.package_geometry_path.len == 0 or
        !std.mem.eql(u8, resolved.metadata.package_geometry_path, parsed.value.packageGeometryPath))
    {
        return error.RestoreTargetDoesNotMatchSnapshot;
    }
    const sha = hashHex(materialized.file.bytes);
    if (!std.mem.eql(u8, &sha, resolved.metadata.sha256)) return error.SnapshotHashMismatch;
    if (!contentAddressMatches(parsed.value.packageGeometryPath, &sha)) return error.ImmutableArtifactHashMismatch;
    var target_lock = try fs.acquireTargetWriteLock(io, std.Io.Dir.cwd(), parsed.value.packageGeometryPath);
    defer target_lock.release();
    try writeDurableAtomic(io, parsed.value.packageGeometryPath, materialized.file.bytes);
    const readback = try std.Io.Dir.cwd().readFileAlloc(
        io,
        parsed.value.packageGeometryPath,
        allocator,
        .unlimited,
    );
    defer allocator.free(readback);
    const readback_sha = hashHex(readback);
    if (!std.mem.eql(u8, &sha, &readback_sha)) return error.RestoreReadbackMismatch;
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = true,
        .protocolVersion = 1,
        .modelId = parsed.value.modelId,
        .snapshotId = resolved.metadata.snapshot_id,
        .revision = &resolved.revision,
        .resolvedRevision = &resolved.revision,
        .path = parsed.value.packageGeometryPath,
        .byteLength = readback.len,
        .sha256 = &readback_sha,
        .version = materialized.document.version,
        .triangleCount = materialized.document.verts.len / 24,
    }, .{});
}

/// The former restore door replaced package bytes directly. Restore now
/// requires the lease-backed resident/package transaction coordinator; keeping
/// this explicit refusal prevents any intermediate UI from reaching the legacy
/// disk writer.
pub fn restoreProtocolJson(_: std.Io, allocator: std.mem.Allocator, _: []const u8) ![]u8 {
    return loreErrorJsonAlloc(
        allocator,
        .legacy_restore_disabled,
        "legacy disk-replacing restore is disabled until the native restore coordinator is registered",
    );
}

fn revisionExists(history: *const lore.FileHistory, revision: []const u8) bool {
    for (history.entries) |entry| {
        const candidate = revisionHex(entry.revision);
        if (std.mem.eql(u8, &candidate, revision)) return true;
    }
    return false;
}

pub fn pinJson(io: std.Io, allocator: std.mem.Allocator, request_json: []const u8) ![]u8 {
    var parsed = try parseRequest(PinRequest, allocator, request_json);
    defer parsed.deinit();
    var paths = try Paths.init(allocator, parsed.value.modelId);
    defer paths.deinit(allocator);
    const repository_path = try repositoryPathAlloc(io, allocator);
    defer allocator.free(repository_path);

    const RegistryCommit = struct {
        revision: [64]u8 = [_]u8{'0'} ** 64,
        revision_number: u64 = 0,
        has_revision: bool = false,
        changed: bool = false,
        snapshot_id: [SNAPSHOT_ID_LENGTH]u8 = [_]u8{0} ** SNAPSHOT_ID_LENGTH,
        snapshot_revision: [64]u8 = [_]u8{'0'} ** 64,
    };
    const registry_commit: RegistryCommit = pin_block: {
        var mutation_lock = try acquireMutationLockRespectingBudget(io);
        defer mutation_lock.release();
        var resolved = try resolveSnapshot(
            io,
            allocator,
            parsed.value.modelId,
            parsed.value.snapshotId,
            parsed.value.revision,
            parsed.value.expectedRevision,
            parsed.value.expectedSha256,
        );
        defer resolved.deinit(allocator);
        var target_snapshot_id: [SNAPSHOT_ID_LENGTH]u8 = undefined;
        @memcpy(target_snapshot_id[0..], resolved.metadata.snapshot_id);
        var existing = try readPinsDurable(io, allocator, repository_path, &paths);
        defer existing.deinit(allocator);

        if (existing.contains(resolved.metadata.snapshot_id) == parsed.value.pinned) {
            var prior = try lore.fileHistory(allocator, repository_path, "", paths.pins_lore, .{ .length = 1 });
            defer prior.deinit(allocator);
            if (prior.entries.len == 0) break :pin_block .{
                .snapshot_id = target_snapshot_id,
                .snapshot_revision = resolved.revision,
            };
            break :pin_block .{
                .revision = revisionHex(prior.entries[0].revision),
                .revision_number = prior.entries[0].revision_number,
                .has_revision = true,
                .changed = false,
                .snapshot_id = target_snapshot_id,
                .snapshot_revision = resolved.revision,
            };
        }

        var next: std.ArrayList([]const u8) = .empty;
        defer next.deinit(allocator);
        for (existing.values) |value| {
            if (!std.mem.eql(u8, value, resolved.metadata.snapshot_id)) try next.append(allocator, value);
        }
        if (parsed.value.pinned) try next.append(allocator, resolved.metadata.snapshot_id);
        std.mem.sort([]const u8, next.items, {}, struct {
            fn lessThan(_: void, left: []const u8, right: []const u8) bool {
                return std.mem.lessThan(u8, left, right);
            }
        }.lessThan);
        const registry_json = try std.json.Stringify.valueAlloc(allocator, PinRegistryWire{
            .pinned = next.items,
            .legacyRevisions = existing.legacy_revisions,
        }, .{});
        defer allocator.free(registry_json);
        try fs.makePathDurable(io, std.Io.Dir.cwd(), paths.directory_full);
        try writeDurableAtomic(io, paths.pins_full, registry_json);
        const stage_paths = [_][]const u8{paths.pins_lore};
        var stage = try lore.fileStage(allocator, repository_path, "", &stage_paths, .{});
        defer stage.deinit(allocator);
        const message = try std.fmt.allocPrint(allocator, "{s} model snapshot {s}", .{
            if (parsed.value.pinned) "pin" else "unpin",
            resolved.metadata.snapshot_id,
        });
        defer allocator.free(message);
        var commit = try lore.revisionCommit(allocator, repository_path, "", message, false);
        defer commit.deinit(allocator);
        const commit_hex = revisionHex(commit.revision.revision);

        var proof_history = try lore.fileHistory(allocator, repository_path, "", paths.pins_lore, .{});
        defer proof_history.deinit(allocator);
        if (!revisionExists(&proof_history, &commit_hex)) return error.PinCommitMissingFromHistory;
        var proof_file = try materializeLoreFile(
            io,
            allocator,
            repository_path,
            paths.pins_lore,
            &commit_hex,
            ".json",
            true,
            false,
        );
        defer proof_file.deinit(allocator);
        if (!std.mem.eql(u8, proof_file.bytes, registry_json)) return error.CommittedPinRegistryMismatch;
        var proof_registry = try parsePinsBytes(allocator, proof_file.bytes);
        defer proof_registry.deinit(allocator);
        if (proof_registry.contains(resolved.metadata.snapshot_id) != parsed.value.pinned) return error.CommittedPinStateMismatch;
        break :pin_block .{
            .revision = commit_hex,
            .revision_number = commit.revision.revision_number,
            .has_revision = true,
            .changed = true,
            .snapshot_id = target_snapshot_id,
            .snapshot_revision = resolved.revision,
        };
    };
    const push = pushCurrent(io, allocator, repository_path, parsed.value.push);
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = true,
        .version = 1,
        .modelId = parsed.value.modelId,
        .snapshotId = &registry_commit.snapshot_id,
        .revision = &registry_commit.snapshot_revision,
        .pinned = parsed.value.pinned,
        .changed = registry_commit.changed,
        .registryRevision = if (registry_commit.has_revision) &registry_commit.revision else null,
        .registryRevisionNumber = if (registry_commit.has_revision) registry_commit.revision_number else null,
        .pushAttempted = push.attempted,
        .pushed = push.pushed,
        .pushState = if (push.pushed) "pushed" else if (push.attempted) "unknown" else "local",
        .pushError = push.error_text,
    }, .{});
}

pub fn pinProtocolJson(io: std.Io, allocator: std.mem.Allocator, request_json: []const u8) ![]u8 {
    var request = std.json.parseFromSlice(PinRequestV1, allocator, request_json, .{}) catch
        return loreErrorJsonAlloc(allocator, .invalid_request, "invalid PinRequestV1");
    defer request.deinit();
    if (request.value.version != 1 or request.value.modelId.len == 0 or
        !validSnapshotId(request.value.snapshotId))
    {
        return loreErrorJsonAlloc(allocator, .invalid_request, "invalid PinRequestV1");
    }
    return pinJson(io, allocator, request_json) catch |err|
        loreErrorForNativeErrorJsonAlloc(allocator, err);
}

const RetentionMaintenanceContext = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    remote_watermark: ?[64]u8 = null,
};

fn validMaintenanceModelKey(value: []const u8) bool {
    if (value.len == 0 or value.len > 80) return false;
    for (value) |byte| {
        if (!std.ascii.isAlphanumeric(byte) and byte != '-' and byte != '_' and byte != '.') return false;
    }
    return true;
}

fn maintenanceIndexPathAlloc(allocator: std.mem.Allocator, model_key: []const u8) ![]u8 {
    if (!validMaintenanceModelKey(model_key)) return error.InvalidRetentionModelKey;
    return std.fmt.allocPrint(allocator, "{s}/{s}/history-index.json", .{ SNAPSHOT_ROOT, model_key });
}

fn maintenancePinsPathAlloc(allocator: std.mem.Allocator, model_key: []const u8) ![]u8 {
    if (!validMaintenanceModelKey(model_key)) return error.InvalidRetentionModelKey;
    return std.fmt.allocPrint(allocator, "{s}/{s}/pins.json", .{ SNAPSHOT_ROOT, model_key });
}

fn maintenanceFullPathAlloc(allocator: std.mem.Allocator, lore_path: []const u8) ![]u8 {
    if (!std.mem.startsWith(u8, lore_path, SNAPSHOT_ROOT ++ "/") or
        std.mem.indexOf(u8, lore_path, "..") != null)
    {
        return error.RetentionPathEscapesRepository;
    }
    return std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, lore_path });
}

fn validateMaintenanceCandidatePaths(candidate: *const retention.Candidate) !void {
    if (!validMaintenanceModelKey(candidate.model_key) or !validSnapshotId(candidate.snapshot_id))
        return error.InvalidRetentionCandidate;
    var expected_directory: [256]u8 = undefined;
    const directory = std.fmt.bufPrint(&expected_directory, "{s}/{s}/revisions/{s}/", .{
        SNAPSHOT_ROOT,
        candidate.model_key,
        candidate.snapshot_id,
    }) catch return error.InvalidRetentionCandidate;
    var resident_buffer: [280]u8 = undefined;
    const resident = std.fmt.bufPrint(&resident_buffer, "{s}resident.rjmd", .{directory}) catch
        return error.InvalidRetentionCandidate;
    var event_buffer: [280]u8 = undefined;
    const event = std.fmt.bufPrint(&event_buffer, "{s}event.json", .{directory}) catch
        return error.InvalidRetentionCandidate;
    if (!std.mem.eql(u8, candidate.resident_path, resident) or
        !std.mem.eql(u8, candidate.event_path, event))
    {
        return error.InvalidRetentionCandidate;
    }
}

fn trackedCurrentBytesAlloc(
    context: *RetentionMaintenanceContext,
    lore_path: []const u8,
    max_bytes: usize,
) !?[]u8 {
    const full_path = try maintenanceFullPathAlloc(context.allocator, lore_path);
    defer context.allocator.free(full_path);
    if (std.Io.Dir.cwd().readFileAlloc(
        context.io,
        full_path,
        context.allocator,
        .limited(max_bytes),
    )) |bytes| return bytes else |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    }
    var history = try lore.fileHistory(context.allocator, context.repository_path, "", lore_path, .{ .length = 1 });
    defer history.deinit(context.allocator);
    if (history.entries.len == 0) return null;
    const revision = revisionHex(history.entries[0].revision);
    var file = try materializeLoreFile(
        context.io,
        context.allocator,
        context.repository_path,
        lore_path,
        &revision,
        ".json",
        true,
        false,
    );
    defer file.deinit(context.allocator);
    if (file.bytes.len > max_bytes) return error.RetentionRegistryTooLarge;
    return @as(?[]u8, try context.allocator.dupe(u8, file.bytes));
}

fn trackedCommittedBytesAlloc(
    context: *RetentionMaintenanceContext,
    lore_path: []const u8,
    max_bytes: usize,
) !?[]u8 {
    var history = try lore.fileHistory(context.allocator, context.repository_path, "", lore_path, .{ .length = 1 });
    defer history.deinit(context.allocator);
    if (history.entries.len == 0) return null;
    const revision = revisionHex(history.entries[0].revision);
    var file = try materializeLoreFile(
        context.io,
        context.allocator,
        context.repository_path,
        lore_path,
        &revision,
        ".json",
        true,
        false,
    );
    defer file.deinit(context.allocator);
    if (file.bytes.len > max_bytes) return error.RetentionRegistryTooLarge;
    return @as(?[]u8, try context.allocator.dupe(u8, file.bytes));
}

fn maintenanceRemoveIndexAndPin(raw: ?*anyopaque, candidate: *const retention.Candidate) !void {
    const context: *RetentionMaintenanceContext = @ptrCast(@alignCast(raw orelse
        return error.RetentionContextMissing));
    try validateMaintenanceCandidatePaths(candidate);
    const index_lore = try maintenanceIndexPathAlloc(context.allocator, candidate.model_key);
    defer context.allocator.free(index_lore);
    const pins_lore = try maintenancePinsPathAlloc(context.allocator, candidate.model_key);
    defer context.allocator.free(pins_lore);
    const index_full = try maintenanceFullPathAlloc(context.allocator, index_lore);
    defer context.allocator.free(index_full);
    const pins_full = try maintenanceFullPathAlloc(context.allocator, pins_lore);
    defer context.allocator.free(pins_full);

    const index_bytes = (try trackedCurrentBytesAlloc(context, index_lore, 8 * 1024 * 1024)) orelse
        return error.RetentionIndexMissing;
    defer context.allocator.free(index_bytes);
    var index = try parseHistoryIndexBytes(context.allocator, index_bytes);
    defer index.deinit(context.allocator);
    var retained_entries: std.ArrayList(HistoryIndexEntry) = .empty;
    defer retained_entries.deinit(context.allocator);
    for (index.entries) |entry| {
        if (std.mem.eql(u8, entry.snapshotId, candidate.snapshot_id)) {
            continue;
        }
        try retained_entries.append(context.allocator, entry);
    }
    // Missing is a valid crash retry: the external tombstone was persisted
    // before the first attempt and the registry commit may have completed just
    // before its outcome bit could be persisted.
    const index_json = try std.json.Stringify.valueAlloc(context.allocator, HistoryIndexWire{
        .entries = retained_entries.items,
    }, .{});
    defer context.allocator.free(index_json);

    var pins = if (try trackedCurrentBytesAlloc(context, pins_lore, 2 * 1024 * 1024)) |bytes| pins_block: {
        defer context.allocator.free(bytes);
        break :pins_block try parsePinsBytes(context.allocator, bytes);
    } else try emptyPins(context.allocator);
    defer pins.deinit(context.allocator);
    var retained_pins: std.ArrayList([]const u8) = .empty;
    defer retained_pins.deinit(context.allocator);
    for (pins.values) |snapshot_id| {
        if (!std.mem.eql(u8, snapshot_id, candidate.snapshot_id))
            try retained_pins.append(context.allocator, snapshot_id);
    }
    const pins_json = try std.json.Stringify.valueAlloc(context.allocator, PinRegistryWire{
        .pinned = retained_pins.items,
        .legacyRevisions = pins.legacy_revisions,
    }, .{});
    defer context.allocator.free(pins_json);

    try writeDurableAtomic(context.io, index_full, index_json);
    try writeDurableAtomic(context.io, pins_full, pins_json);
    const stage_paths = [_][]const u8{ index_lore, pins_lore };
    var stage = try lore.fileStage(context.allocator, context.repository_path, "", &stage_paths, .{ .scan = true });
    defer stage.deinit(context.allocator);
    if (stage.counts.total > 0) {
        const message = try std.fmt.allocPrint(context.allocator, "retention tombstone {s}", .{candidate.snapshot_id});
        defer context.allocator.free(message);
        var commit = try lore.revisionCommit(context.allocator, context.repository_path, "", message, false);
        defer commit.deinit(context.allocator);
    }

    // Prove both mutable registries at the current committed revision before
    // the irreversible path-level obliteration begins.
    const proof_index = (try trackedCommittedBytesAlloc(context, index_lore, 8 * 1024 * 1024)) orelse
        return error.RetentionIndexProofMissing;
    defer context.allocator.free(proof_index);
    const proof_pins = (try trackedCommittedBytesAlloc(context, pins_lore, 2 * 1024 * 1024)) orelse
        return error.RetentionPinsProofMissing;
    defer context.allocator.free(proof_pins);
    if (!std.mem.eql(u8, proof_index, index_json) or !std.mem.eql(u8, proof_pins, pins_json))
        return error.RetentionRegistryProofMismatch;
}

fn maintenanceObliteratePath(
    raw: ?*anyopaque,
    candidate: *const retention.Candidate,
    path: []const u8,
) !retention.ObliterateOutcome {
    const context: *RetentionMaintenanceContext = @ptrCast(@alignCast(raw orelse
        return error.RetentionContextMissing));
    try validateMaintenanceCandidatePaths(candidate);
    if (!std.mem.eql(u8, path, candidate.resident_path) and !std.mem.eql(u8, path, candidate.event_path))
        return error.RetentionPathEscapesRepository;
    var history = try lore.fileHistory(context.allocator, context.repository_path, "", path, .{ .length = 1 });
    defer history.deinit(context.allocator);
    if (history.entries.len == 0) return .{};
    var result = try lore.fileObliterate(context.allocator, context.repository_path, "", path, "");
    defer result.deinit(context.allocator);
    return .{
        .fragments = result.fragments,
        .payloads = result.payloads,
    };
}

fn maintenanceCommitDeletes(raw: ?*anyopaque, candidate: *const retention.Candidate) !void {
    const context: *RetentionMaintenanceContext = @ptrCast(@alignCast(raw orelse
        return error.RetentionContextMissing));
    try validateMaintenanceCandidatePaths(candidate);
    const resident_full = try maintenanceFullPathAlloc(context.allocator, candidate.resident_path);
    defer context.allocator.free(resident_full);
    const event_full = try maintenanceFullPathAlloc(context.allocator, candidate.event_path);
    defer context.allocator.free(event_full);
    std.Io.Dir.cwd().deleteFile(context.io, resident_full) catch |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    };
    std.Io.Dir.cwd().deleteFile(context.io, event_full) catch |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    };
    const paths = [_][]const u8{ candidate.resident_path, candidate.event_path };
    var stage = try lore.fileStage(context.allocator, context.repository_path, "", &paths, .{ .scan = true });
    defer stage.deinit(context.allocator);
    if (stage.counts.total > 0) {
        const message = try std.fmt.allocPrint(context.allocator, "retention delete {s}", .{candidate.snapshot_id});
        defer context.allocator.free(message);
        var commit = try lore.revisionCommit(context.allocator, context.repository_path, "", message, false);
        defer commit.deinit(context.allocator);
    }
    var status = try lore.repositoryStatus(context.allocator, context.repository_path, "", .{
        .staged = true,
        .scan = true,
        .paths = &paths,
    });
    defer status.deinit(context.allocator);
    if (status.files.len != 0) return error.RetentionDeleteWorktreeNotClean;
    const snapshot_directory = std.fs.path.dirname(resident_full) orelse return;
    std.Io.Dir.cwd().deleteDir(context.io, snapshot_directory) catch {};
}

fn maintenanceGc(raw: ?*anyopaque) !u64 {
    const context: *RetentionMaintenanceContext = @ptrCast(@alignCast(raw orelse
        return error.RetentionContextMissing));
    const store_path = try std.fmt.allocPrint(context.allocator, "{s}/.lore", .{REPOSITORY_PATH});
    defer context.allocator.free(store_path);
    const before = directorySize(context.io, context.allocator, store_path);
    try lore.repositoryGc(context.repository_path, "");
    const after = directorySize(context.io, context.allocator, store_path);
    return before -| after;
}

fn validateLegacyCutoverCandidatePaths(candidate: *const retention.LegacyCutoverCandidate) !void {
    if (!validMaintenanceModelKey(candidate.model_key)) return error.InvalidLegacyCutoverCandidate;
    var resident_buffer: [192]u8 = undefined;
    const resident = std.fmt.bufPrint(&resident_buffer, "{s}/{s}/resident.rjmd", .{
        SNAPSHOT_ROOT,
        candidate.model_key,
    }) catch return error.InvalidLegacyCutoverCandidate;
    var event_buffer: [192]u8 = undefined;
    const event = std.fmt.bufPrint(&event_buffer, "{s}/{s}/event.json", .{
        SNAPSHOT_ROOT,
        candidate.model_key,
    }) catch return error.InvalidLegacyCutoverCandidate;
    if (!std.mem.eql(u8, candidate.resident_path, resident) or
        !std.mem.eql(u8, candidate.event_path, event))
    {
        return error.InvalidLegacyCutoverCandidate;
    }
}

fn maintenanceLegacyObliteratePath(
    raw: ?*anyopaque,
    candidate: *const retention.LegacyCutoverCandidate,
    path: []const u8,
) !retention.ObliterateOutcome {
    const context: *RetentionMaintenanceContext = @ptrCast(@alignCast(raw orelse
        return error.RetentionContextMissing));
    try validateLegacyCutoverCandidatePaths(candidate);
    if (!std.mem.eql(u8, path, candidate.resident_path) and
        !std.mem.eql(u8, path, candidate.event_path))
    {
        return error.RetentionPathEscapesRepository;
    }
    var history = try lore.fileHistory(
        context.allocator,
        context.repository_path,
        "",
        path,
        .{ .length = 1 },
    );
    defer history.deinit(context.allocator);
    if (history.entries.len == 0) return .{};
    var result = try lore.fileObliterate(
        context.allocator,
        context.repository_path,
        "",
        path,
        "",
    );
    defer result.deinit(context.allocator);
    return .{ .fragments = result.fragments, .payloads = result.payloads };
}

fn maintenanceLegacyCommitDeletes(
    raw: ?*anyopaque,
    candidate: *const retention.LegacyCutoverCandidate,
) !void {
    const context: *RetentionMaintenanceContext = @ptrCast(@alignCast(raw orelse
        return error.RetentionContextMissing));
    try validateLegacyCutoverCandidatePaths(candidate);
    const resident_full = try maintenanceFullPathAlloc(context.allocator, candidate.resident_path);
    defer context.allocator.free(resident_full);
    const event_full = try maintenanceFullPathAlloc(context.allocator, candidate.event_path);
    defer context.allocator.free(event_full);
    const pins_lore = try maintenancePinsPathAlloc(context.allocator, candidate.model_key);
    defer context.allocator.free(pins_lore);
    const pins_full = try maintenanceFullPathAlloc(context.allocator, pins_lore);
    defer context.allocator.free(pins_full);

    var pins = if (try trackedCurrentBytesAlloc(context, pins_lore, 2 * 1024 * 1024)) |bytes| block: {
        defer context.allocator.free(bytes);
        break :block try parsePinsBytes(context.allocator, bytes);
    } else try emptyPins(context.allocator);
    defer pins.deinit(context.allocator);
    const pins_json = try std.json.Stringify.valueAlloc(context.allocator, PinRegistryWire{
        .pinned = pins.values,
        .legacyRevisions = &.{},
    }, .{});
    defer context.allocator.free(pins_json);
    try writeDurableAtomic(context.io, pins_full, pins_json);
    std.Io.Dir.cwd().deleteFile(context.io, resident_full) catch |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    };
    std.Io.Dir.cwd().deleteFile(context.io, event_full) catch |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    };
    const stage_paths = [_][]const u8{ candidate.resident_path, candidate.event_path, pins_lore };
    var stage = try lore.fileStage(
        context.allocator,
        context.repository_path,
        "",
        &stage_paths,
        .{ .scan = true },
    );
    defer stage.deinit(context.allocator);
    if (stage.counts.total > 0) {
        const message = try std.fmt.allocPrint(
            context.allocator,
            "retire legacy shared snapshot paths {s}",
            .{candidate.model_key},
        );
        defer context.allocator.free(message);
        var commit = try lore.revisionCommit(
            context.allocator,
            context.repository_path,
            "",
            message,
            false,
        );
        defer commit.deinit(context.allocator);
    }
    const pins_proof = (try trackedCommittedBytesAlloc(
        context,
        pins_lore,
        2 * 1024 * 1024,
    )) orelse return error.LegacyCutoverPinsProofMissing;
    defer context.allocator.free(pins_proof);
    if (!std.mem.eql(u8, pins_proof, pins_json)) return error.LegacyCutoverPinsProofMismatch;
    var status = try lore.repositoryStatus(context.allocator, context.repository_path, "", .{
        .staged = true,
        .scan = true,
        .paths = &stage_paths,
    });
    defer status.deinit(context.allocator);
    if (status.files.len != 0) return error.LegacyCutoverWorktreeNotClean;
}

fn maintenanceRemoteEqual(context: *RetentionMaintenanceContext) !bool {
    var push_lock = try acquirePushLock(context.io);
    defer push_lock.release();
    var push = try lore.branchPush(context.allocator, context.repository_path, "", .{});
    defer push.deinit(context.allocator);
    var status = try lore.repositoryStatus(context.allocator, context.repository_path, "", .{ .revision_only = true });
    defer status.deinit(context.allocator);
    const revision = status.revision orelse return error.RemoteAbsenceUnproven;
    if (!revision.remote_available or !revision.remote_authorized or revision.local_ahead or revision.remote_ahead or
        !std.mem.eql(u8, &revision.local_revision, &revision.remote_revision))
    {
        return false;
    }
    context.remote_watermark = revisionHex(revision.remote_revision);
    return true;
}

fn maintenanceRemoteAbsent(raw: ?*anyopaque, _: *const retention.Candidate) !bool {
    const context: *RetentionMaintenanceContext = @ptrCast(@alignCast(raw orelse
        return error.RetentionContextMissing));
    return maintenanceRemoteEqual(context);
}

fn maintenanceLegacyRemoteAbsent(
    raw: ?*anyopaque,
    _: *const retention.LegacyCutoverCandidate,
) !bool {
    const context: *RetentionMaintenanceContext = @ptrCast(@alignCast(raw orelse
        return error.RetentionContextMissing));
    return maintenanceRemoteEqual(context);
}

fn maintenanceRemoteWatermark(raw: ?*anyopaque) ?[]const u8 {
    const context: *RetentionMaintenanceContext = @ptrCast(@alignCast(raw orelse return null));
    if (context.remote_watermark) |*value| return value;
    return null;
}

fn maintenanceRemoteDeferred(_: ?*anyopaque, _: *const retention.Candidate) !bool {
    return error.RemotePruneDeferred;
}

fn maintenanceLegacyRemoteDeferred(
    _: ?*anyopaque,
    _: *const retention.LegacyCutoverCandidate,
) !bool {
    return error.RemotePruneDeferred;
}

const OwnedRetentionCandidates = struct {
    entries: std.ArrayList(retention.Candidate) = .empty,
    legacy_cutovers: std.ArrayList(retention.LegacyCutoverCandidate) = .empty,

    fn deinit(self: *OwnedRetentionCandidates, allocator: std.mem.Allocator) void {
        for (self.entries.items) |entry| {
            allocator.free(entry.model_key);
            allocator.free(entry.snapshot_id);
            allocator.free(entry.resident_path);
            allocator.free(entry.event_path);
        }
        self.entries.deinit(allocator);
        for (self.legacy_cutovers.items) |entry| {
            allocator.free(entry.model_key);
            allocator.free(entry.resident_path);
            allocator.free(entry.event_path);
        }
        self.legacy_cutovers.deinit(allocator);
        self.* = undefined;
    }
};

fn appendRetentionCandidate(
    allocator: std.mem.Allocator,
    owned: *OwnedRetentionCandidates,
    model_key: []const u8,
    entry: *const HistoryIndexEntry,
    logical_bytes: u64,
    push_state: retention.PushState,
) !void {
    const key = try allocator.dupe(u8, model_key);
    errdefer allocator.free(key);
    const snapshot_id = try allocator.dupe(u8, entry.snapshotId);
    errdefer allocator.free(snapshot_id);
    const resident_path = try allocator.dupe(u8, entry.residentPath);
    errdefer allocator.free(resident_path);
    const event_path = try allocator.dupe(u8, entry.eventPath);
    errdefer allocator.free(event_path);
    try owned.entries.append(allocator, .{
        .model_key = key,
        .snapshot_id = snapshot_id,
        .timestamp_ms = entry.timestampMs,
        .logical_bytes = logical_bytes,
        .resident_path = resident_path,
        .event_path = event_path,
        .push_state = push_state,
    });
}

fn appendLegacyCutoverCandidate(
    allocator: std.mem.Allocator,
    owned: *OwnedRetentionCandidates,
    model_key: []const u8,
    resident_path: []const u8,
    event_path: []const u8,
    push_state: retention.PushState,
) !void {
    const key = try allocator.dupe(u8, model_key);
    errdefer allocator.free(key);
    const resident = try allocator.dupe(u8, resident_path);
    errdefer allocator.free(resident);
    const event = try allocator.dupe(u8, event_path);
    try owned.legacy_cutovers.append(allocator, .{
        .model_key = key,
        .resident_path = resident,
        .event_path = event,
        .push_state = push_state,
    });
}

fn currentMaintenanceIndex(
    context: *RetentionMaintenanceContext,
    paths: *const Paths,
) !OwnedHistoryIndex {
    const bytes = (try trackedCurrentBytesAlloc(context, paths.index_lore, 8 * 1024 * 1024)) orelse
        return emptyHistoryIndex(context.allocator);
    defer context.allocator.free(bytes);
    var index = try parseHistoryIndexBytes(context.allocator, bytes);
    errdefer index.deinit(context.allocator);
    for (index.entries) |*entry| try validateIndexEntryPaths(context.allocator, paths, entry);
    return index;
}

fn currentMaintenancePins(
    context: *RetentionMaintenanceContext,
    paths: *const Paths,
) !OwnedPins {
    const bytes = (try trackedCurrentBytesAlloc(context, paths.pins_lore, 2 * 1024 * 1024)) orelse
        return emptyPins(context.allocator);
    defer context.allocator.free(bytes);
    return parsePinsBytes(context.allocator, bytes);
}

fn ensureMigrationIndexEntry(
    allocator: std.mem.Allocator,
    index: *OwnedHistoryIndex,
    paths: *const Paths,
    snapshot_id: []const u8,
    timestamp_ms: i64,
) !bool {
    var immutable = try SnapshotPaths.init(allocator, paths, snapshot_id);
    defer immutable.deinit(allocator);
    for (index.entries) |entry| {
        if (!std.mem.eql(u8, entry.snapshotId, snapshot_id)) continue;
        if (entry.timestampMs != timestamp_ms or
            !std.mem.eql(u8, entry.residentPath, immutable.resident_lore) or
            !std.mem.eql(u8, entry.eventPath, immutable.event_lore))
        {
            return error.LegacyMigrationIdentityCollision;
        }
        return true;
    }
    try appendHistoryIndexEntry(
        allocator,
        index,
        snapshot_id,
        timestamp_ms,
        immutable.event_lore,
        immutable.resident_lore,
    );
    return false;
}

fn containsText(values: []const []const u8, needle: []const u8) bool {
    for (values) |value| if (std.mem.eql(u8, value, needle)) return true;
    return false;
}

fn migratedLegacyMetadata(
    source: *const OwnedMetadata,
    target_id: []const u8,
    immutable: *const SnapshotPaths,
    source_revision: []const u8,
    source_event_sha: []const u8,
) SnapshotMetadata {
    return .{
        .snapshotId = target_id,
        .timestampMs = source.timestamp_ms,
        .sequence = source.sequence,
        .captureId = source.capture_id,
        .modelId = source.model_id,
        .label = source.label,
        .note = source.note,
        .kind = source.kind,
        .packageGeometryPath = source.package_geometry_path,
        .sha256 = source.sha256,
        .sourceSha256 = source.source_sha256,
        .byteLength = source.byte_length,
        .triangleCount = source.triangle_count,
        .authoredFaceCount = source.authored_face_count,
        .partCount = source.part_count,
        .logicalVertexCount = source.logical_vertex_count,
        .identityQuality = source.identity_quality,
        .objectNamespaceHash = source.object_namespace_hash,
        .recoveryDegradations = source.recovery_degradations,
        .residentPath = immutable.resident_lore,
        .eventPath = immutable.event_lore,
        .legacySourceRevision = source_revision,
        .legacySourceEventSha256 = source_event_sha,
    };
}

fn publishLegacyRevision(
    context: *RetentionMaintenanceContext,
    model_key: []const u8,
    shared_resident_path: []const u8,
    source_revision: []const u8,
    source_event_bytes: []const u8,
    source: *const OwnedMetadata,
) !void {
    if (source.version != 1 or source.timestamp_ms < 0 or
        !validSha256(source.sha256) or source.model_id.len == 0)
    {
        return error.InvalidLegacySnapshotMetadata;
    }
    var paths = try Paths.init(context.allocator, source.model_id);
    defer paths.deinit(context.allocator);
    if (!std.mem.eql(u8, paths.key, model_key) or
        !std.mem.eql(u8, paths.resident_lore, shared_resident_path))
    {
        return error.LegacySnapshotModelMismatch;
    }

    const target_id = try legacySnapshotId(source.timestamp_ms, source_revision);
    var immutable = try SnapshotPaths.init(context.allocator, &paths, &target_id);
    defer immutable.deinit(context.allocator);
    try fs.makePathDurable(context.io, std.Io.Dir.cwd(), immutable.directory_full);

    const source_event_sha = hashHex(source_event_bytes);
    const migrated = migratedLegacyMetadata(
        source,
        &target_id,
        &immutable,
        source_revision,
        &source_event_sha,
    );
    const event_json = try std.json.Stringify.valueAlloc(context.allocator, migrated, .{});
    defer context.allocator.free(event_json);

    var index = try currentMaintenanceIndex(context, &paths);
    defer index.deinit(context.allocator);
    const already_indexed = try ensureMigrationIndexEntry(
        context.allocator,
        &index,
        &paths,
        &target_id,
        source.timestamp_ms,
    );
    var committed_migration_revision: ?[64]u8 = null;
    if (already_indexed) {
        var prior_history = try lore.fileHistory(
            context.allocator,
            context.repository_path,
            "",
            immutable.event_lore,
            .{ .length = 1 },
        );
        defer prior_history.deinit(context.allocator);
        if (prior_history.entries.len > 0) {
            const prior_revision = revisionHex(prior_history.entries[0].revision);
            var prior = try metadataFromEventPathRevision(
                context.io,
                context.allocator,
                context.repository_path,
                immutable.event_lore,
                &prior_revision,
            );
            defer prior.deinit(context.allocator);
            if (!std.mem.eql(u8, prior.legacy_source_revision, source_revision) or
                !std.mem.eql(u8, prior.legacy_source_event_sha256, &source_event_sha) or
                !std.mem.eql(u8, prior.sha256, source.sha256) or
                prior.timestamp_ms != source.timestamp_ms)
            {
                return error.LegacyMigrationIdentityCollision;
            }
            committed_migration_revision = prior_revision;
        }
    }
    // A cutover retry may already have obliterated the retired shared resident
    // path. Once the immutable event proves the deterministic mapping, its
    // paired immutable resident is the canonical retry source; otherwise this
    // is the first publication and the exact shared revision is required.
    var resident = if (committed_migration_revision) |revision|
        try materializeResidentPath(
            context.io,
            context.allocator,
            context.repository_path,
            immutable.resident_lore,
            &revision,
            true,
            false,
        )
    else
        try materializeResidentPath(
            context.io,
            context.allocator,
            context.repository_path,
            shared_resident_path,
            source_revision,
            true,
            false,
        );
    defer resident.deinit(context.allocator);
    const resident_sha = hashHex(resident.file.bytes);
    if (!std.mem.eql(u8, &resident_sha, source.sha256) or
        source.byte_length != resident.file.bytes.len)
    {
        return error.LegacyResidentHashMismatch;
    }
    if (source.triangle_count != resident.document.verts.len / 24 or
        source.part_count != resident.document.ranges.len / 2 or
        source.logical_vertex_count != resident.document.logical_vertex_count)
    {
        return error.LegacyResidentMetadataMismatch;
    }
    const index_json = try std.json.Stringify.valueAlloc(context.allocator, HistoryIndexWire{
        .entries = index.entries,
    }, .{});
    defer context.allocator.free(index_json);

    var pins = try currentMaintenancePins(context, &paths);
    defer pins.deinit(context.allocator);
    const source_was_pinned = containsText(pins.legacy_revisions, source_revision);
    var next_pins: std.ArrayList([]const u8) = .empty;
    defer next_pins.deinit(context.allocator);
    try next_pins.appendSlice(context.allocator, pins.values);
    if (source_was_pinned and !containsText(next_pins.items, &target_id))
        try next_pins.append(context.allocator, &target_id);
    var next_legacy: std.ArrayList([]const u8) = .empty;
    defer next_legacy.deinit(context.allocator);
    for (pins.legacy_revisions) |revision| {
        if (!std.mem.eql(u8, revision, source_revision))
            try next_legacy.append(context.allocator, revision);
    }
    const pins_json = try std.json.Stringify.valueAlloc(context.allocator, PinRegistryWire{
        .pinned = next_pins.items,
        .legacyRevisions = next_legacy.items,
    }, .{});
    defer context.allocator.free(pins_json);

    try writeDurableAtomic(context.io, immutable.resident_full, resident.file.bytes);
    try writeDurableAtomic(context.io, immutable.event_full, event_json);
    try writeDurableAtomic(context.io, paths.index_full, index_json);
    try writeDurableAtomic(context.io, paths.pins_full, pins_json);
    const stage_paths = [_][]const u8{
        immutable.resident_lore,
        immutable.event_lore,
        paths.index_lore,
        paths.pins_lore,
    };
    var stage = try lore.fileStage(
        context.allocator,
        context.repository_path,
        "",
        &stage_paths,
        .{ .scan = true },
    );
    defer stage.deinit(context.allocator);
    if (stage.counts.total > 0) {
        const writes = [_]lore.MetadataWrite{.{
            .key = METADATA_KEY,
            .value = event_json,
            .format = .string,
        }};
        try lore.revisionMetadataSet(context.allocator, context.repository_path, "", &writes);
        const message = try std.fmt.allocPrint(
            context.allocator,
            "migrate legacy snapshot {s} -> {s}",
            .{ source_revision, &target_id },
        );
        defer context.allocator.free(message);
        var commit = try lore.revisionCommit(
            context.allocator,
            context.repository_path,
            "",
            message,
            false,
        );
        defer commit.deinit(context.allocator);
    }

    var event_history = try lore.fileHistory(
        context.allocator,
        context.repository_path,
        "",
        immutable.event_lore,
        .{ .length = 1 },
    );
    defer event_history.deinit(context.allocator);
    if (event_history.entries.len == 0) return error.LegacyMigrationProofMissing;
    const proof_revision = revisionHex(event_history.entries[0].revision);
    var resident_proof = try materializeResidentPath(
        context.io,
        context.allocator,
        context.repository_path,
        immutable.resident_lore,
        &proof_revision,
        true,
        false,
    );
    defer resident_proof.deinit(context.allocator);
    if (!std.mem.eql(u8, resident_proof.file.bytes, resident.file.bytes))
        return error.LegacyMigrationResidentProofMismatch;
    var event_proof = try materializeLoreFile(
        context.io,
        context.allocator,
        context.repository_path,
        immutable.event_lore,
        &proof_revision,
        ".json",
        true,
        false,
    );
    defer event_proof.deinit(context.allocator);
    if (!std.mem.eql(u8, event_proof.bytes, event_json))
        return error.LegacyMigrationEventProofMismatch;
    const index_proof = (try trackedCommittedBytesAlloc(
        context,
        paths.index_lore,
        8 * 1024 * 1024,
    )) orelse return error.LegacyMigrationIndexProofMissing;
    defer context.allocator.free(index_proof);
    const pins_proof = (try trackedCommittedBytesAlloc(
        context,
        paths.pins_lore,
        2 * 1024 * 1024,
    )) orelse return error.LegacyMigrationPinsProofMissing;
    defer context.allocator.free(pins_proof);
    if (!std.mem.eql(u8, index_proof, index_json) or !std.mem.eql(u8, pins_proof, pins_json))
        return error.LegacyMigrationRegistryProofMismatch;
    var proof_metadata = try metadataFromEventPathRevision(
        context.io,
        context.allocator,
        context.repository_path,
        immutable.event_lore,
        &proof_revision,
    );
    defer proof_metadata.deinit(context.allocator);
    if (!std.mem.eql(u8, proof_metadata.legacy_source_revision, source_revision) or
        !std.mem.eql(u8, proof_metadata.legacy_source_event_sha256, &source_event_sha) or
        !std.mem.eql(u8, proof_metadata.sha256, source.sha256) or
        proof_metadata.timestamp_ms != source.timestamp_ms)
    {
        return error.LegacyMigrationIdentityProofMismatch;
    }
}

fn legacyFallbackTimestamp(
    context: *RetentionMaintenanceContext,
    revision: []const u8,
) ?i64 {
    var metadata = metadataFromRevision(
        context.allocator,
        context.repository_path,
        revision,
    ) catch return null;
    defer if (metadata) |*value| value.deinit(context.allocator);
    return if (metadata) |value| value.timestamp_ms else null;
}

fn scanRetentionCandidates(
    context: *RetentionMaintenanceContext,
    now_ms: i64,
    legacy: *retention.LegacyFacts,
) !OwnedRetentionCandidates {
    var result = OwnedRetentionCandidates{};
    errdefer result.deinit(context.allocator);
    var repository_info = try lore.repositoryInfo(context.allocator, context.repository_path, "");
    defer repository_info.deinit(context.allocator);
    const push_state: retention.PushState = if (repository_info.remote_url.len == 0) .local else .unknown;
    var root = std.Io.Dir.cwd().openDir(
        context.io,
        REPOSITORY_PATH ++ "/" ++ SNAPSHOT_ROOT,
        .{ .iterate = true },
    ) catch |err| switch (err) {
        error.FileNotFound => return result,
        else => return err,
    };
    defer root.close(context.io);
    var iterator = root.iterate();
    while (try iterator.next(context.io)) |directory_entry| {
        if (directory_entry.kind != .directory or !validMaintenanceModelKey(directory_entry.name)) continue;
        const index_lore = try maintenanceIndexPathAlloc(context.allocator, directory_entry.name);
        defer context.allocator.free(index_lore);
        // Old shared-layout directories commonly have no immutable index at
        // all. Absence means "no immutable rows" and must not skip migration;
        // a present but corrupt index still blocks the entire model because
        // guessing its rows could delete a live immutable snapshot.
        if (try trackedCurrentBytesAlloc(context, index_lore, 8 * 1024 * 1024)) |index_bytes| {
            defer context.allocator.free(index_bytes);
            var index = parseHistoryIndexBytes(context.allocator, index_bytes) catch
                return error.CorruptRetentionIndex;
            defer index.deinit(context.allocator);
            for (index.entries) |*entry| {
                if (!try retention.isExpired(entry.timestampMs, now_ms)) continue;
                const probe = retention.Candidate{
                    .model_key = directory_entry.name,
                    .snapshot_id = entry.snapshotId,
                    .timestamp_ms = entry.timestampMs,
                    .logical_bytes = 0,
                    .resident_path = entry.residentPath,
                    .event_path = entry.eventPath,
                    .push_state = push_state,
                };
                try validateMaintenanceCandidatePaths(&probe);
                var resident_history = try lore.fileHistory(
                    context.allocator,
                    context.repository_path,
                    "",
                    entry.residentPath,
                    .{ .length = 1 },
                );
                defer resident_history.deinit(context.allocator);
                const logical_bytes = if (resident_history.entries.len > 0)
                    resident_history.entries[0].size
                else
                    0;
                try appendRetentionCandidate(
                    context.allocator,
                    &result,
                    directory_entry.name,
                    entry,
                    logical_bytes,
                    push_state,
                );
            }
        }

        const legacy_event = try std.fmt.allocPrint(context.allocator, "{s}/{s}/event.json", .{
            SNAPSHOT_ROOT,
            directory_entry.name,
        });
        defer context.allocator.free(legacy_event);
        const legacy_resident = try std.fmt.allocPrint(context.allocator, "{s}/{s}/resident.rjmd", .{
            SNAPSHOT_ROOT,
            directory_entry.name,
        });
        defer context.allocator.free(legacy_resident);
        var legacy_history = lore.fileHistory(
            context.allocator,
            context.repository_path,
            "",
            legacy_event,
            .{},
        ) catch {
            legacy.corrupt_pending +|= 1;
            legacy.local_cutover_complete = false;
            legacy.remote_cutover_complete = false;
            continue;
        };
        defer legacy_history.deinit(context.allocator);
        var has_legacy_content = false;
        const model_unmigrated_before = legacy.unexpired_pending;
        const model_corrupt_before = legacy.corrupt_pending;
        for (legacy_history.entries) |history_entry| {
            if (history_entry.action == .delete) continue;
            has_legacy_content = true;
            const revision = revisionHex(history_entry.revision);
            var event_file = materializeLoreFile(
                context.io,
                context.allocator,
                context.repository_path,
                legacy_event,
                &revision,
                ".json",
                true,
                false,
            ) catch {
                const action = try retention.classifyLegacyRevision(
                    legacyFallbackTimestamp(context, &revision),
                    false,
                    now_ms,
                );
                if (action == .block_corrupt) legacy.corrupt_pending +|= 1;
                continue;
            };
            defer event_file.deinit(context.allocator);
            var parsed = parseRequest(SnapshotMetadata, context.allocator, event_file.bytes) catch {
                const action = try retention.classifyLegacyRevision(
                    legacyFallbackTimestamp(context, &revision),
                    false,
                    now_ms,
                );
                if (action == .block_corrupt) legacy.corrupt_pending +|= 1;
                continue;
            };
            defer parsed.deinit();
            var metadata = OwnedMetadata.fromParsed(context.allocator, parsed.value) catch {
                const action = try retention.classifyLegacyRevision(
                    parsed.value.timestampMs,
                    false,
                    now_ms,
                );
                if (action == .block_corrupt) legacy.corrupt_pending +|= 1;
                continue;
            };
            defer metadata.deinit(context.allocator);
            switch (try retention.classifyLegacyRevision(metadata.timestamp_ms, true, now_ms)) {
                .ignore_expired => continue,
                .block_corrupt => unreachable,
                .migrate => publishLegacyRevision(
                    context,
                    directory_entry.name,
                    legacy_resident,
                    &revision,
                    event_file.bytes,
                    &metadata,
                ) catch |err| {
                    legacy.unexpired_pending +|= 1;
                    return err;
                },
            }
        }
        if (has_legacy_content) {
            legacy.local_cutover_complete = false;
            legacy.remote_cutover_complete = false;
            if (legacy.unexpired_pending == model_unmigrated_before and
                legacy.corrupt_pending == model_corrupt_before)
            {
                try appendLegacyCutoverCandidate(
                    context.allocator,
                    &result,
                    directory_entry.name,
                    legacy_resident,
                    legacy_event,
                    push_state,
                );
            }
        }
    }
    return result;
}

/// Internal-only maintenance entrypoint. The state directory must be an
/// external application-data directory (normally fs.dataDir), never the Lore
/// checkout. Local mutation is serialized with snapshots/pins; network retry
/// runs only after that lock is released.
pub fn runRetentionMaintenance(
    io: std.Io,
    allocator: std.mem.Allocator,
    state_directory: std.Io.Dir,
    now_ms: i64,
) !void {
    const repository_path = try repositoryPathAlloc(io, allocator);
    defer allocator.free(repository_path);
    var context = RetentionMaintenanceContext{
        .io = io,
        .allocator = allocator,
        .repository_path = repository_path,
    };
    const store = retention.Store{
        .io = io,
        .allocator = allocator,
        .directory = state_directory,
        .path = RETENTION_STATE_PATH,
    };
    var state = try store.load();
    defer state.deinit(allocator);
    var legacy = retention.LegacyFacts{
        .local_cutover_complete = true,
        .remote_cutover_complete = true,
    };
    if (try state.localCycleDue(now_ms)) {
        var mutation_lock = try acquireMutationLock(io);
        defer mutation_lock.release();
        var candidates = scanRetentionCandidates(&context, now_ms, &legacy) catch |err| {
            state.legacy_unexpired_pending = legacy.unexpired_pending;
            state.legacy_corrupt_pending = legacy.corrupt_pending;
            state.legacy_layout_cutover = false;
            try state.recordError(allocator, @errorName(err));
            try store.save(&state);
            return err;
        };
        defer candidates.deinit(allocator);
        retention.runCycle(store, &state, now_ms, candidates.entries.items, legacy, .{
            .context = &context,
            .remove_index_and_pin = maintenanceRemoveIndexAndPin,
            .obliterate_path = maintenanceObliteratePath,
            .commit_deletes = maintenanceCommitDeletes,
            .gc = maintenanceGc,
            .remote_absent = maintenanceRemoteDeferred,
            .remote_watermark = maintenanceRemoteWatermark,
        }) catch |err| {
            try state.recordError(allocator, @errorName(err));
            try store.save(&state);
            return err;
        };
        retention.runLegacyCutovers(store, &state, candidates.legacy_cutovers.items, .{
            .context = &context,
            .obliterate_path = maintenanceLegacyObliteratePath,
            .commit_deletes = maintenanceLegacyCommitDeletes,
            .gc = maintenanceGc,
            .remote_absent = maintenanceLegacyRemoteDeferred,
            .remote_watermark = maintenanceRemoteWatermark,
        }) catch |err| {
            try state.recordError(allocator, @errorName(err));
            try store.save(&state);
            return err;
        };
    }
    try retention.retryRemote(store, &state, .{
        .context = &context,
        .remove_index_and_pin = maintenanceRemoveIndexAndPin,
        .obliterate_path = maintenanceObliteratePath,
        .commit_deletes = maintenanceCommitDeletes,
        .gc = maintenanceGc,
        .remote_absent = maintenanceRemoteAbsent,
        .remote_watermark = maintenanceRemoteWatermark,
    });
    try retention.retryLegacyRemote(store, &state, .{
        .context = &context,
        .obliterate_path = maintenanceLegacyObliteratePath,
        .commit_deletes = maintenanceLegacyCommitDeletes,
        .gc = maintenanceGc,
        .remote_absent = maintenanceLegacyRemoteAbsent,
        .remote_watermark = maintenanceRemoteWatermark,
    });
}

pub const RetentionStatusFacts = struct {
    last_prune_ms: ?i64 = null,
    next_prune_ms: ?i64 = null,
    local_tombstones: u64 = 0,
    remote_pending_tombstones: u64 = 0,
    logically_removed_entries: u64 = 0,
    logically_removed_bytes: u64 = 0,
    physically_reclaimed_bytes: u64 = 0,
    remote_watermark: ?[]u8 = null,
    legacy_unexpired_pending: u64 = 0,
    legacy_corrupt_pending: u64 = 0,
    legacy_layout_cutover: bool = false,
    last_error: ?[]u8 = null,

    pub fn deinit(self: *RetentionStatusFacts, allocator: std.mem.Allocator) void {
        if (self.remote_watermark) |value| allocator.free(value);
        if (self.last_error) |value| allocator.free(value);
        self.* = undefined;
    }
};

pub fn retentionStatusFactsAlloc(
    io: std.Io,
    allocator: std.mem.Allocator,
    state_directory: std.Io.Dir,
) !RetentionStatusFacts {
    const store = retention.Store{
        .io = io,
        .allocator = allocator,
        .directory = state_directory,
        .path = RETENTION_STATE_PATH,
    };
    var state = try store.load();
    defer state.deinit(allocator);
    return .{
        .last_prune_ms = state.last_prune_ms,
        .next_prune_ms = state.next_prune_ms,
        .local_tombstones = state.localTombstones() +| state.legacyLocalCutovers(),
        .remote_pending_tombstones = state.remotePendingTombstones() +| state.legacyRemotePendingCutovers(),
        .logically_removed_entries = state.logically_removed_entries,
        .logically_removed_bytes = state.logically_removed_bytes,
        .physically_reclaimed_bytes = state.physically_reclaimed_bytes,
        .remote_watermark = if (state.remote_watermark) |value| try allocator.dupe(u8, value) else null,
        .legacy_unexpired_pending = state.legacy_unexpired_pending,
        .legacy_corrupt_pending = state.legacy_corrupt_pending,
        .legacy_layout_cutover = state.legacy_layout_cutover,
        .last_error = if (state.last_error) |value| try allocator.dupe(u8, value) else null,
    };
}

fn directorySize(io: std.Io, allocator: std.mem.Allocator, path: []const u8) u64 {
    var dir = std.Io.Dir.cwd().openDir(io, path, .{ .iterate = true }) catch return 0;
    defer dir.close(io);
    var walker = dir.walk(allocator) catch return 0;
    defer walker.deinit();
    var total: u64 = 0;
    while (walker.next(io) catch null) |entry| {
        if (entry.kind != .file) continue;
        const stat = dir.statFile(io, entry.path, .{}) catch continue;
        total +|= stat.size;
    }
    return total;
}

fn healthCode(io: std.Io, allocator: std.mem.Allocator) u16 {
    // Keep this identical in spirit to tools/lore-hook-health: a status probe
    // must never wedge the editor behind a sick server. curl owns both its
    // network deadline and redirect-free HTTP semantics; the process owner adds
    // a final timeout in case curl itself is unhealthy.
    const result = std.process.run(allocator, io, .{
        .argv = &.{
            "curl",
            "-sS",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "--connect-timeout",
            "2",
            "--max-time",
            "2",
            HEALTH_URL,
        },
        .stdout_limit = .limited(16),
        .stderr_limit = .limited(1024),
        .timeout = .{ .duration = .{ .raw = .fromSeconds(3), .clock = .awake } },
    }) catch return 0;
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |code| if (code != 0) return 0,
        else => return 0,
    }
    return std.fmt.parseInt(u16, std.mem.trim(u8, result.stdout, " \t\r\n"), 10) catch 0;
}

fn statusCommandAlloc(
    io: std.Io,
    allocator: std.mem.Allocator,
    argv: []const []const u8,
    limit: usize,
) ![]u8 {
    const result = std.process.run(allocator, io, .{
        .argv = argv,
        .stdout_limit = .limited(limit),
        .stderr_limit = .limited(limit),
        .timeout = .{ .duration = .{ .raw = .fromSeconds(2), .clock = .awake } },
    }) catch return allocator.dupe(u8, "unavailable");
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    const stdout = std.mem.trim(u8, result.stdout, " \t\r\n");
    if (stdout.len > 0) return allocator.dupe(u8, stdout);
    const stderr = std.mem.trim(u8, result.stderr, " \t\r\n");
    return allocator.dupe(u8, if (stderr.len > 0) stderr else "unknown");
}

pub fn serverStatusJson(io: std.Io, allocator: std.mem.Allocator, request_json: []const u8) ![]u8 {
    var parsed = try parseRequest(StatusRequest, allocator, request_json);
    defer parsed.deinit();
    const repository_path = repositoryPathAlloc(io, allocator) catch null;
    defer if (repository_path) |path| allocator.free(path);
    var repository_ready = false;
    var repository_revision: u64 = 0;
    var repository_revision_hash: ?[64]u8 = null;
    if (repository_path) |path| {
        var info = lore.repositoryInfo(allocator, path, "") catch null;
        if (info) |*value| {
            defer value.deinit(allocator);
            repository_ready = true;
            var status = lore.repositoryStatus(allocator, path, "", .{
                .revision_only = true,
            }) catch null;
            if (status) |*current| {
                defer current.deinit(allocator);
                if (current.revision) |revision| {
                    repository_revision = revision.revision_number;
                    repository_revision_hash = revisionHex(revision.revision);
                }
            }
        }
    }
    const code = healthCode(io, allocator);
    const unit_active = try statusCommandAlloc(
        io,
        allocator,
        &.{ "systemctl", "--user", "is-active", "loreserver.service" },
        256,
    );
    defer allocator.free(unit_active);
    const unit_enabled = try statusCommandAlloc(
        io,
        allocator,
        &.{ "systemctl", "--user", "is-enabled", "loreserver.service" },
        256,
    );
    defer allocator.free(unit_enabled);
    const recent_journal = try statusCommandAlloc(
        io,
        allocator,
        &.{ "journalctl", "--user", "-u", "loreserver.service", "-n", "5", "--no-pager", "-o", "cat" },
        4096,
    );
    defer allocator.free(recent_journal);
    const local_store_path = try std.fmt.allocPrint(allocator, "{s}/.lore", .{REPOSITORY_PATH});
    defer allocator.free(local_store_path);
    var journal_lines: std.ArrayList([]const u8) = .empty;
    defer journal_lines.deinit(allocator);
    var line_iterator = std.mem.splitScalar(u8, recent_journal, '\n');
    while (line_iterator.next()) |line| {
        if (line.len == 0) continue;
        try journal_lines.append(allocator, line);
    }
    const now_ms = std.Io.Clock.now(.real, io).toMilliseconds();
    var retention_facts: ?RetentionStatusFacts = facts: {
        const data_directory = fs.dataDir() catch break :facts null;
        break :facts retentionStatusFactsAlloc(io, allocator, data_directory) catch |err| RetentionStatusFacts{
            .last_error = try allocator.dupe(u8, @errorName(err)),
        };
    };
    defer if (retention_facts) |*facts| facts.deinit(allocator);
    const service_healthy = code == 200;
    const library_available = lore.available();
    const state = if (!library_available or !repository_ready)
        "blocked"
    else if (service_healthy)
        "ready"
    else
        "local";
    const server_store_ready = ready: {
        std.Io.Dir.cwd().access(io, parsed.value.serverStorePath, .{}) catch break :ready false;
        break :ready true;
    };
    const restore_commands = [_][]const u8{
        "systemctl --user start loreserver.service",
        "systemctl --user status loreserver.service --no-pager",
        "journalctl --user -u loreserver.service -n 50 --no-pager",
    };
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = true,
        .version = 1,
        .status = .{
            .state = state,
            .library = .{
                .available = library_available,
                .version = if (library_available and lore.version().len > 0) lore.version() else null,
            },
            .repository = .{
                .ready = repository_ready,
                .path = repository_path orelse REPOSITORY_PATH,
                .revision = if (repository_revision_hash) |*revision| @as(?[]const u8, revision) else null,
            },
            .service = .{
                .healthy = service_healthy,
                .healthUrl = HEALTH_URL,
                .httpCode = if (code == 0) null else code,
                .unitName = "loreserver.service",
                .active = std.mem.eql(u8, unit_active, "active"),
                .enabled = std.mem.eql(u8, unit_enabled, "enabled"),
                .journalTail = journal_lines.items,
                .restoreCommands = &restore_commands,
            },
            .stores = .{
                .snapshotRoot = SNAPSHOT_ROOT,
                .localBytes = directorySize(io, allocator, local_store_path),
                .serverBytes = if (server_store_ready)
                    @as(?u64, directorySize(io, allocator, parsed.value.serverStorePath))
                else
                    null,
            },
            .retention = .{
                .days = RETENTION_DAYS,
                .nowMs = now_ms,
                .lastPruneMs = if (retention_facts) |facts| facts.last_prune_ms else null,
                .nextPruneMs = if (retention_facts) |facts| facts.next_prune_ms else null,
                .immediatelyExpired = if (retention_facts) |facts| facts.local_tombstones else 0,
                .localTombstones = if (retention_facts) |facts| facts.local_tombstones else 0,
                .remotePendingTombstones = if (retention_facts) |facts| facts.remote_pending_tombstones else 0,
                .logicallyRemovedEntries = if (retention_facts) |facts| facts.logically_removed_entries else 0,
                .logicallyRemovedBytes = if (retention_facts) |facts| facts.logically_removed_bytes else 0,
                .physicallyReclaimedBytes = if (retention_facts) |facts| facts.physically_reclaimed_bytes else 0,
                .remoteWatermark = if (retention_facts) |facts| facts.remote_watermark else null,
                .legacyUnexpiredPending = if (retention_facts) |facts| facts.legacy_unexpired_pending else 0,
                .legacyCorruptPending = if (retention_facts) |facts| facts.legacy_corrupt_pending else 0,
                .legacyLayoutCutover = if (retention_facts) |facts| facts.legacy_layout_cutover else false,
                .lastError = if (retention_facts) |facts| facts.last_error else "retention state is not initialized",
            },
            .history = .{ .pushed = 0, .local = 0, .unknown = 0 },
            .probe = .{ .lastCompletedMs = now_ms, .lastTransitionMs = null },
        },
        .available = lore.available(),
        .libraryVersion = lore.version(),
        .serverHealthy = code == 200,
        .healthUrl = HEALTH_URL,
        .healthCode = code,
        .unitName = "loreserver.service",
        .unitActive = unit_active,
        .unitEnabled = unit_enabled,
        .recentJournal = recent_journal,
        .restoreCommands = restore_commands,
        .repositoryReady = repository_ready,
        .repositoryRevision = repository_revision,
        .repositoryPath = repository_path orelse REPOSITORY_PATH,
        .snapshotRoot = SNAPSHOT_ROOT,
        .localStoreBytes = directorySize(io, allocator, local_store_path),
        .serverStorePath = parsed.value.serverStorePath,
        .serverStoreBytes = directorySize(io, allocator, parsed.value.serverStorePath),
    }, .{});
}

pub fn serverStatusProtocolJson(io: std.Io, allocator: std.mem.Allocator, request_json: []const u8) ![]u8 {
    var request = std.json.parseFromSlice(StatusRequestV1, allocator, request_json, .{}) catch
        return loreErrorJsonAlloc(allocator, .invalid_request, "invalid StatusRequestV1");
    defer request.deinit();
    if (request.value.version != 1)
        return loreErrorJsonAlloc(allocator, .invalid_request, "invalid StatusRequestV1");
    return serverStatusJson(io, allocator, "{}") catch |err|
        loreErrorForNativeErrorJsonAlloc(allocator, err);
}

test "model spool keys preserve readable identity and add a collision hash" {
    const allocator = std.testing.allocator;
    const one = try modelKeyAlloc(allocator, "car/body");
    defer allocator.free(one);
    const two = try modelKeyAlloc(allocator, "car?body");
    defer allocator.free(two);
    try std.testing.expect(std.mem.startsWith(u8, one, "car-body-"));
    try std.testing.expect(!std.mem.eql(u8, one, two));
}

test "immutable snapshot paths never alias retired shared migration paths" {
    const allocator = std.testing.allocator;
    var paths = try Paths.init(allocator, "models/hero");
    defer paths.deinit(allocator);
    const first_id = "1700000000000-00000000000000000000000000000001";
    const second_id = "1700000000000-00000000000000000000000000000002";
    var first = try SnapshotPaths.init(allocator, &paths, first_id);
    defer first.deinit(allocator);
    var second = try SnapshotPaths.init(allocator, &paths, second_id);
    defer second.deinit(allocator);
    try std.testing.expect(!std.mem.eql(u8, first.resident_lore, second.resident_lore));
    try std.testing.expect(!std.mem.eql(u8, first.event_lore, second.event_lore));
    try std.testing.expect(!std.mem.eql(u8, first.resident_lore, paths.resident_lore));
    try std.testing.expect(!std.mem.eql(u8, first.event_lore, paths.event_lore));
    try std.testing.expect(std.mem.indexOf(u8, first.resident_lore, "/revisions/") != null);
}

test "legacy revision mapping is deterministic and preserves the original timestamp" {
    const timestamp_ms: i64 = 1_800_000_000_000;
    const revision = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const first = try legacySnapshotId(timestamp_ms, revision);
    const retry = try legacySnapshotId(timestamp_ms, revision);
    try std.testing.expectEqualSlices(u8, &first, &retry);
    try std.testing.expectEqual(timestamp_ms, try snapshotIdTimestampMs(&first));
    try std.testing.expectEqualStrings(revision[0..32], first[14..]);
}

test "legacy migration index publication is idempotent and rejects identity drift" {
    const allocator = std.testing.allocator;
    var paths = try Paths.init(allocator, "fixture:model");
    defer paths.deinit(allocator);
    var index = try emptyHistoryIndex(allocator);
    defer index.deinit(allocator);
    const timestamp_ms: i64 = 1_800_000_000_000;
    const revision = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const snapshot_id = try legacySnapshotId(timestamp_ms, revision);
    try std.testing.expect(!(try ensureMigrationIndexEntry(
        allocator,
        &index,
        &paths,
        &snapshot_id,
        timestamp_ms,
    )));
    try std.testing.expect(try ensureMigrationIndexEntry(
        allocator,
        &index,
        &paths,
        &snapshot_id,
        timestamp_ms,
    ));
    try std.testing.expectEqual(@as(usize, 1), index.entries.len);
    try std.testing.expectError(
        error.LegacyMigrationIdentityCollision,
        ensureMigrationIndexEntry(allocator, &index, &paths, &snapshot_id, timestamp_ms + 1),
    );
}

test "legacy migration event preserves every v1 browse field and source hashes" {
    const allocator = std.testing.allocator;
    const source_json =
        \\{"version":1,"timestampMs":1800000000000,"sequence":77,"captureId":"old-capture","modelId":"fixture:model","label":"Before bevel","note":"keep this","kind":"panic","packageGeometryPath":"mesh/doc.blob","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","byteLength":1234,"triangleCount":55,"partCount":3,"logicalVertexCount":88}
    ;
    var parsed = try parseRequest(SnapshotMetadata, allocator, source_json);
    defer parsed.deinit();
    var source = try OwnedMetadata.fromParsed(allocator, parsed.value);
    defer source.deinit(allocator);
    var paths = try Paths.init(allocator, source.model_id);
    defer paths.deinit(allocator);
    const revision = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const target_id = try legacySnapshotId(source.timestamp_ms, revision);
    var immutable = try SnapshotPaths.init(allocator, &paths, &target_id);
    defer immutable.deinit(allocator);
    const event_sha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const migrated = migratedLegacyMetadata(
        &source,
        &target_id,
        &immutable,
        revision,
        event_sha,
    );
    try std.testing.expectEqual(@as(u32, 2), migrated.version);
    try std.testing.expectEqual(source.timestamp_ms, migrated.timestampMs);
    try std.testing.expectEqual(source.sequence, migrated.sequence);
    try std.testing.expectEqualStrings("old-capture", migrated.captureId);
    try std.testing.expectEqualStrings("Before bevel", migrated.label);
    try std.testing.expectEqualStrings("keep this", migrated.note);
    try std.testing.expectEqualStrings("panic", migrated.kind);
    try std.testing.expectEqualStrings("mesh/doc.blob", migrated.packageGeometryPath);
    try std.testing.expectEqualStrings(source.sha256, migrated.sha256);
    try std.testing.expectEqualStrings(revision, migrated.legacySourceRevision);
    try std.testing.expectEqualStrings(event_sha, migrated.legacySourceEventSha256);
    try std.testing.expectEqual(source.byte_length, migrated.byteLength);
    try std.testing.expectEqual(source.triangle_count, migrated.triangleCount);
    try std.testing.expectEqual(source.part_count, migrated.partCount);
    try std.testing.expectEqual(source.logical_vertex_count, migrated.logicalVertexCount);
}

test "legacy revision pins are retained as migration input, not active snapshot pins" {
    const allocator = std.testing.allocator;
    const legacy_revision = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const bytes = try std.json.Stringify.valueAlloc(allocator, .{
        .version = 1,
        .pinned = [_][]const u8{legacy_revision},
    }, .{});
    defer allocator.free(bytes);
    var pins = try parsePinsBytes(allocator, bytes);
    defer pins.deinit(allocator);
    try std.testing.expectEqual(@as(usize, 0), pins.values.len);
    try std.testing.expectEqual(@as(usize, 1), pins.legacy_revisions.len);
    try std.testing.expectEqualStrings(legacy_revision, pins.legacy_revisions[0]);
}

test "current resident encoder always emits readable RJMD v5" {
    const allocator = std.testing.allocator;
    var verts = [_]f32{0} ** 24;
    const snapshot = meshdoc_format.Snapshot{
        .verts = &verts,
        .groups = null,
        .materials = null,
        .semantic_regions = null,
        .semantic_instances = null,
        .render_corner_logical_ids = null,
        .logical_vertex_count = 0,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = null,
        .glass_first_vertex = 3,
    };
    const encoded = try encodeResidentAlloc(allocator, &snapshot, &.{}, null);
    defer allocator.free(encoded.bytes);
    var decoded = try meshdoc_format.decodeDocument(allocator, encoded.bytes);
    defer decoded.deinit(allocator);
    try std.testing.expectEqual(meshdoc_format.VERSION_LOGICAL_TOPOLOGY, decoded.version);
    try std.testing.expectEqual(@as(usize, 1), decoded.verts.len / 24);
}

test "v1 panic encoder persists deterministic object IDs and typed degradation" {
    const allocator = std.testing.allocator;
    var verts = [_]f32{0} ** 24;
    var groups = [_]u32{7};
    const resident = meshdoc_format.Snapshot{
        .verts = &verts,
        .groups = &groups,
        .materials = null,
        .semantic_regions = null,
        .semantic_instances = null,
        .render_corner_logical_ids = null,
        .logical_vertex_count = 0,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = null,
        .glass_first_vertex = 3,
    };
    const ranges = [_]u32{ 7, 8 };
    const encoded = try encodeResidentV1Alloc(allocator, "model:fixture", &resident, &ranges, null);
    defer allocator.free(encoded.bytes);
    try std.testing.expect(encoded.degradation_count >= 1);
    try std.testing.expectEqual(RecoveryDegradationChannelV1.object_ids, encoded.degradations[0].channel);
    try std.testing.expect(validRevision(&encoded.object_namespace_hash));
    try std.testing.expect(validRevision(&encoded.source_sha256));
    var decoded = try meshdoc_format.decodeDocument(allocator, encoded.bytes);
    defer decoded.deinit(allocator);
    try std.testing.expect(decoded.range_object_ids != null);
    try std.testing.expect(std.mem.startsWith(u8, decoded.range_object_ids.?[0], "recovered-"));
    try std.testing.expect(std.mem.indexOf(u8, decoded.semantic_table_json.?, "\"recoveryProvenance\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, decoded.semantic_table_json.?, "\"object_ids\"") != null);

    const again = try encodeResidentV1Alloc(allocator, "model:fixture", &resident, &ranges, null);
    defer allocator.free(again.bytes);
    try std.testing.expectEqualSlices(u8, encoded.bytes, again.bytes);
    try std.testing.expectEqualStrings(&encoded.object_namespace_hash, &again.object_namespace_hash);
}

test "published stable object IDs keep v1 recovery identity exact" {
    const allocator = std.testing.allocator;
    var verts = [_]f32{0} ** 24;
    var groups = [_]u32{7};
    const resident = meshdoc_format.Snapshot{
        .verts = &verts,
        .groups = &groups,
        .materials = null,
        .semantic_regions = null,
        .semantic_instances = null,
        .render_corner_logical_ids = null,
        .logical_vertex_count = 0,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = null,
        .glass_first_vertex = 3,
    };
    const ranges = [_]u32{ 7, 8 };
    const object_ids = [_][]const u8{"body"};
    const encoded = try encodeResidentV1Alloc(
        allocator,
        "model:fixture",
        &resident,
        &ranges,
        @constCast(&object_ids),
    );
    defer allocator.free(encoded.bytes);
    try std.testing.expectEqual(@as(usize, 0), encoded.degradation_count);
    try std.testing.expect(validRevision(&encoded.object_namespace_hash));
    var decoded = try meshdoc_format.decodeDocument(allocator, encoded.bytes);
    defer decoded.deinit(allocator);
    try std.testing.expectEqualStrings("body", decoded.range_object_ids.?[0]);
}

test "panic encoder preserves geometry when every auxiliary channel is stale" {
    const allocator = std.testing.allocator;
    var verts = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        2, 0, 0, 0, 0, 1, 1, 0,
        0, 3, 0, 0, 0, 1, 0, 1,
    };
    var groups = [_]u32{meshdoc_format.NO_FACE_GROUP};
    var no_material_rows = [_]u32{};
    var regions = [_]u32{7};
    var instances = [_]u32{0};
    var invalid_logical = [_]u32{ 0, 1, 2 };
    var malformed_semantics = [_]u8{ '{', 'x' };
    const resident = meshdoc_format.Snapshot{
        .verts = &verts,
        .groups = &groups,
        .materials = &no_material_rows,
        .semantic_regions = &regions,
        .semantic_instances = &instances,
        .render_corner_logical_ids = &invalid_logical,
        .logical_vertex_count = 1,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = &malformed_semantics,
        .glass_first_vertex = 3,
    };
    const stale_ranges = [_]u32{ 9, 10 };
    const object_ids = [_][]const u8{"body"};
    const encoded = try encodeResidentAlloc(allocator, &resident, &stale_ranges, @constCast(&object_ids));
    defer allocator.free(encoded.bytes);
    try std.testing.expectEqual(@as(u64, 1), encoded.part_count);
    try std.testing.expectEqual(@as(u32, 0), encoded.logical_vertex_count);
    var decoded = try meshdoc_format.decodeDocument(allocator, encoded.bytes);
    defer decoded.deinit(allocator);
    try std.testing.expectEqualSlices(f32, &verts, decoded.verts);
    try std.testing.expectEqualSlices(u32, &.{0}, decoded.groups.?);
    try std.testing.expectEqualSlices(u32, &.{ 0, 1 }, decoded.ranges);
    try std.testing.expect(decoded.materials == null);
    try std.testing.expectEqualSlices(u32, &regions, decoded.semantic_regions.?);
    try std.testing.expectEqualSlices(u32, &instances, decoded.semantic_instances.?);
    try std.testing.expect(decoded.render_corner_logical_ids == null);
}

test "panic encoder drops only stale semantic table and preserves every valid sibling channel" {
    const allocator = std.testing.allocator;
    var verts = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 1, 0,
        0, 1, 0, 0, 0, 1, 0, 1,
        2, 0, 0, 0, 0, 1, 0, 0,
        3, 0, 0, 0, 0, 1, 1, 0,
        2, 1, 0, 0, 0, 1, 0, 1,
    };
    var groups = [_]u32{ 2, 9 };
    var materials = [_]u32{ 3, 7 };
    var regions = [_]u32{ 4, 5 };
    var instances = [_]u32{ 0, 1 };
    var logical = [_]u32{ 0, 1, 2, 3, 4, 5 };
    var malformed_semantics = [_]u8{ '{', 'x' };
    const resident = meshdoc_format.Snapshot{
        .verts = &verts,
        .groups = &groups,
        .materials = &materials,
        .semantic_regions = &regions,
        .semantic_instances = &instances,
        .render_corner_logical_ids = &logical,
        .logical_vertex_count = 6,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = &malformed_semantics,
        .glass_first_vertex = 6,
    };
    const ranges = [_]u32{ 2, 3, 9, 10 };
    const object_ids = [_][]const u8{ "body", "head" };
    const encoded = try encodeResidentAlloc(allocator, &resident, &ranges, @constCast(&object_ids));
    defer allocator.free(encoded.bytes);
    try std.testing.expectEqual(@as(u64, 2), encoded.part_count);
    try std.testing.expectEqual(@as(u32, 6), encoded.logical_vertex_count);
    var decoded = try meshdoc_format.decodeDocument(allocator, encoded.bytes);
    defer decoded.deinit(allocator);
    try std.testing.expectEqualSlices(f32, &verts, decoded.verts);
    try std.testing.expectEqualSlices(u32, &groups, decoded.groups.?);
    try std.testing.expectEqualSlices(u32, &materials, decoded.materials.?);
    try std.testing.expectEqualSlices(u32, &regions, decoded.semantic_regions.?);
    try std.testing.expectEqualSlices(u32, &instances, decoded.semantic_instances.?);
    try std.testing.expectEqualSlices(u32, &logical, decoded.render_corner_logical_ids.?);
    try std.testing.expectEqualSlices(u32, &ranges, decoded.ranges);
    try std.testing.expectEqualStrings("body", decoded.range_object_ids.?[0]);
    try std.testing.expectEqualStrings("head", decoded.range_object_ids.?[1]);
}

test "restore path authorization rejects normalized and nested traversal" {
    try std.testing.expect(validPackageGeometryPath(
        "cart/editor/data/models/props/car/mesh/doc.blob",
    ));
    try std.testing.expect(validPackageGeometryPath(
        "cart/editor/data/models/characters/person/mesh/character-abc.rjmd",
    ));
    try std.testing.expect(!validPackageGeometryPath(
        "cart/editor/data/models/../../framework/escape.rjmd",
    ));
    try std.testing.expect(!validPackageGeometryPath(
        "cart/editor/data/models/props/car/../truck/mesh/doc.blob",
    ));
    try std.testing.expect(!validPackageGeometryPath(
        "cart/editor/data/models//props/car/mesh/doc.blob",
    ));
    try std.testing.expect(!validPackageGeometryPath(
        "/cart/editor/data/models/props/car/mesh/doc.blob",
    ));
}
