//! Native-resident model recovery snapshots backed by Lore.
//!
//! This module never asks the editor Save pipeline for model bytes. The V8
//! boundary hands it an immutable native mesh snapshot, which is encoded as
//! current RJMD v5 and written to a private Lore spool. Package geometry is
//! untouched during capture; only an explicit, validated restore may replace it.

const std = @import("std");
const meshdoc_format = @import("../gpu/meshdoc_format.zig");
const mesh_edge_semantics = @import("../gpu/mesh_edge_semantics.zig");
const fs = @import("../fs/fs.zig");
const lore = @import("lore.zig");

const REPOSITORY_PATH = "cart/editor";
const SNAPSHOT_ROOT = ".lore-snapshots";
const MUTATION_LOCK_TARGET = "cart/editor/.lore-snapshots/repository-transaction";
const PUSH_LOCK_TARGET = "cart/editor/.lore-snapshots/network-push";
const MODEL_PACKAGE_ROOT = "cart/editor/data/models";
const METADATA_KEY = "rjit.snapshot.v1";
const MAX_HISTORY: u32 = 500;
const DEFAULT_HISTORY: u32 = 100;
const DEFAULT_SERVER_STORE = "/home/siah/.local/share/loreserver/store";
const HEALTH_URL = "http://127.0.0.1:41339/health_check";

var capture_sequence: u64 = 0;
var retained_preview_mutex: std.Io.Mutex = .init;
var retained_preview_directory: ?[]u8 = null;
var retained_preview_path: ?[]u8 = null;

const SnapshotKind = enum { panic, normal };

const SnapshotRequest = struct {
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
    revision: []const u8,
};

const RestoreRequest = struct {
    modelId: []const u8,
    revision: []const u8,
    packageGeometryPath: []const u8,
};

const PinRequest = struct {
    modelId: []const u8,
    revision: []const u8,
    pinned: bool,
    push: bool = true,
};

const StatusRequest = struct {
    serverStorePath: []const u8 = DEFAULT_SERVER_STORE,
};

const SnapshotMetadata = struct {
    version: u32 = 1,
    timestampMs: i64,
    sequence: u64,
    captureId: []const u8 = "",
    modelId: []const u8,
    label: []const u8,
    note: []const u8,
    kind: []const u8,
    packageGeometryPath: []const u8,
    sha256: []const u8,
    byteLength: u64,
    triangleCount: u64,
    partCount: u64,
    logicalVertexCount: u32,
};

const OwnedMetadata = struct {
    timestamp_ms: i64 = 0,
    sequence: u64 = 0,
    model_id: []u8,
    label: []u8,
    note: []u8,
    kind: []u8,
    package_geometry_path: []u8,
    sha256: []u8,
    byte_length: u64 = 0,
    triangle_count: u64 = 0,
    part_count: u64 = 0,
    logical_vertex_count: u32 = 0,

    fn empty(allocator: std.mem.Allocator) !OwnedMetadata {
        const model_id = try allocator.dupe(u8, "");
        errdefer allocator.free(model_id);
        const label = try allocator.dupe(u8, "");
        errdefer allocator.free(label);
        const note = try allocator.dupe(u8, "");
        errdefer allocator.free(note);
        const kind = try allocator.dupe(u8, "");
        errdefer allocator.free(kind);
        const package_path = try allocator.dupe(u8, "");
        errdefer allocator.free(package_path);
        const sha = try allocator.dupe(u8, "");
        return .{
            .model_id = model_id,
            .label = label,
            .note = note,
            .kind = kind,
            .package_geometry_path = package_path,
            .sha256 = sha,
        };
    }

    fn fromParsed(allocator: std.mem.Allocator, value: SnapshotMetadata) !OwnedMetadata {
        const model_id = try allocator.dupe(u8, value.modelId);
        errdefer allocator.free(model_id);
        const label = try allocator.dupe(u8, value.label);
        errdefer allocator.free(label);
        const note = try allocator.dupe(u8, value.note);
        errdefer allocator.free(note);
        const kind = try allocator.dupe(u8, value.kind);
        errdefer allocator.free(kind);
        const package_path = try allocator.dupe(u8, value.packageGeometryPath);
        errdefer allocator.free(package_path);
        const sha = try allocator.dupe(u8, value.sha256);
        return .{
            .timestamp_ms = value.timestampMs,
            .sequence = value.sequence,
            .model_id = model_id,
            .label = label,
            .note = note,
            .kind = kind,
            .package_geometry_path = package_path,
            .sha256 = sha,
            .byte_length = value.byteLength,
            .triangle_count = value.triangleCount,
            .part_count = value.partCount,
            .logical_vertex_count = value.logicalVertexCount,
        };
    }

    fn deinit(self: *OwnedMetadata, allocator: std.mem.Allocator) void {
        allocator.free(self.model_id);
        allocator.free(self.label);
        allocator.free(self.note);
        allocator.free(self.kind);
        allocator.free(self.package_geometry_path);
        allocator.free(self.sha256);
        self.* = undefined;
    }
};

const HistoryItem = struct {
    revision: []u8,
    revisionNumber: u64,
    timestampMs: i64,
    sequence: u64,
    label: []u8,
    note: []u8,
    kind: []u8,
    packageGeometryPath: []u8,
    sha256: []u8,
    byteLength: u64,
    triangleCount: u64,
    partCount: u64,
    logicalVertexCount: u32,
    pinned: bool,

    fn deinit(self: *HistoryItem, allocator: std.mem.Allocator) void {
        allocator.free(self.revision);
        allocator.free(self.label);
        allocator.free(self.note);
        allocator.free(self.kind);
        allocator.free(self.packageGeometryPath);
        allocator.free(self.sha256);
        self.* = undefined;
    }
};

const PinRegistryWire = struct {
    version: u32 = 1,
    pinned: [][]const u8 = &.{},
};

const OwnedPins = struct {
    values: [][]u8,

    fn deinit(self: *OwnedPins, allocator: std.mem.Allocator) void {
        for (self.values) |value| allocator.free(value);
        allocator.free(self.values);
        self.* = undefined;
    }

    fn contains(self: *const OwnedPins, revision: []const u8) bool {
        for (self.values) |value| if (std.mem.eql(u8, value, revision)) return true;
        return false;
    }
};

const Paths = struct {
    key: []u8,
    directory_lore: []u8,
    resident_lore: []u8,
    event_lore: []u8,
    pins_lore: []u8,
    directory_full: []u8,
    resident_full: []u8,
    event_full: []u8,
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
        const pins_lore = try std.fmt.allocPrint(allocator, "{s}/pins.json", .{directory_lore});
        errdefer allocator.free(pins_lore);
        const directory_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, directory_lore });
        errdefer allocator.free(directory_full);
        const resident_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, resident_lore });
        errdefer allocator.free(resident_full);
        const event_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, event_lore });
        errdefer allocator.free(event_full);
        const pins_full = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ REPOSITORY_PATH, pins_lore });
        return .{
            .key = key,
            .directory_lore = directory_lore,
            .resident_lore = resident_lore,
            .event_lore = event_lore,
            .pins_lore = pins_lore,
            .directory_full = directory_full,
            .resident_full = resident_full,
            .event_full = event_full,
            .pins_full = pins_full,
        };
    }

    fn deinit(self: *Paths, allocator: std.mem.Allocator) void {
        allocator.free(self.key);
        allocator.free(self.directory_lore);
        allocator.free(self.resident_lore);
        allocator.free(self.event_lore);
        allocator.free(self.pins_lore);
        allocator.free(self.directory_full);
        allocator.free(self.resident_full);
        allocator.free(self.event_full);
        allocator.free(self.pins_full);
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

fn acquirePushLock(io: std.Io) !fs.TargetWriteLock {
    return fs.acquireTargetWriteLock(io, std.Io.Dir.cwd(), PUSH_LOCK_TARGET);
}

fn writeDurableAtomic(io: std.Io, path: []const u8, bytes: []const u8) !void {
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

fn revisionHex(hash: lore.Hash) [64]u8 {
    return std.fmt.bytesToHex(hash, .lower);
}

fn hashIsZero(hash: lore.Hash) bool {
    for (hash) |byte| if (byte != 0) return false;
    return true;
}

fn validRevision(value: []const u8) bool {
    if (value.len != 64) return false;
    for (value) |byte| if (!std.ascii.isHex(byte)) return false;
    return true;
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
};

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

fn emptyPins(allocator: std.mem.Allocator) !OwnedPins {
    return .{ .values = try allocator.alloc([]u8, 0) };
}

fn parsePinsBytes(allocator: std.mem.Allocator, bytes: []const u8) !OwnedPins {
    var parsed = try parseRequest(PinRegistryWire, allocator, bytes);
    defer parsed.deinit();
    if (parsed.value.version != 1) return error.UnsupportedPinRegistry;
    const values = try allocator.alloc([]u8, parsed.value.pinned.len);
    errdefer allocator.free(values);
    var copied: usize = 0;
    errdefer for (values[0..copied]) |value| allocator.free(value);
    for (parsed.value.pinned, values) |value, *target| {
        if (!validRevision(value)) return error.InvalidPinRegistry;
        target.* = try allocator.dupe(u8, value);
        copied += 1;
    }
    return .{ .values = values };
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

fn metadataFromRevision(
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    revision: []const u8,
) !?OwnedMetadata {
    var list = try lore.revisionMetadataList(allocator, repository_path, "", revision);
    defer list.deinit(allocator);
    for (list.entries) |entry| {
        if (!std.mem.eql(u8, entry.key, METADATA_KEY)) continue;
        const text = switch (entry.value) {
            .string => |value| value,
            else => continue,
        };
        var parsed = parseRequest(SnapshotMetadata, allocator, text) catch continue;
        defer parsed.deinit();
        return @as(?OwnedMetadata, try OwnedMetadata.fromParsed(allocator, parsed.value));
    }
    return null;
}

fn metadataFromEventRevision(
    io: std.Io,
    allocator: std.mem.Allocator,
    repository_path: []const u8,
    paths: *const Paths,
    revision: []const u8,
) !OwnedMetadata {
    var file = try materializeLoreFile(
        io,
        allocator,
        repository_path,
        paths.event_lore,
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

pub fn snapshotJson(
    io: std.Io,
    allocator: std.mem.Allocator,
    document: *const meshdoc_format.Snapshot,
    ranges: ?[]const u32,
    request_json: []const u8,
) ![]u8 {
    var parsed = try parseRequest(SnapshotRequest, allocator, request_json);
    defer parsed.deinit();
    const request = parsed.value;
    var paths = try Paths.init(allocator, request.modelId);
    defer paths.deinit(allocator);

    const persisted_ranges = safeRanges(ranges);
    const encoded = try encodeResidentAlloc(allocator, document, persisted_ranges, request.objectIds);
    defer allocator.free(encoded.bytes);
    const sha = hashHex(encoded.bytes);
    const repository_path = try repositoryPathAlloc(io, allocator);
    defer allocator.free(repository_path);

    const Committed = struct {
        revision: [64]u8,
        revision_number: u64,
        timestamp_ms: i64,
        sequence: u64,
        metadata_stored: bool,
    };
    const committed: Committed = commit_block: {
        // One lock covers both fixed spool paths and Lore's mutable stage/current
        // revision state. Without it, two editor processes can truthfully encode
        // different documents and still commit a mixed pair of bytes + metadata.
        var mutation_lock = try acquireMutationLock(io);
        defer mutation_lock.release();

        const now = std.Io.Clock.now(.real, io);
        capture_sequence +%= 1;
        var capture_id_buffer: [128]u8 = undefined;
        const capture_id = try std.fmt.bufPrint(&capture_id_buffer, "{d}-{d}-{d}", .{
            now.nanoseconds,
            std.c.getpid(),
            capture_sequence,
        });
        const metadata = SnapshotMetadata{
            .timestampMs = now.toMilliseconds(),
            .sequence = capture_sequence,
            .captureId = capture_id,
            .modelId = request.modelId,
            .label = if (request.label.len == 0) "Snapshot" else request.label,
            .note = request.note orelse "",
            .kind = @tagName(request.kind),
            .packageGeometryPath = request.packageGeometryPath,
            .sha256 = &sha,
            .byteLength = encoded.bytes.len,
            .triangleCount = document.verts.len / 24,
            .partCount = encoded.part_count,
            .logicalVertexCount = encoded.logical_vertex_count,
        };
        const metadata_json = try std.json.Stringify.valueAlloc(allocator, metadata, .{});
        defer allocator.free(metadata_json);

        const cwd = std.Io.Dir.cwd();
        try fs.makePathDurable(io, cwd, paths.directory_full);
        try writeDurableAtomic(io, paths.resident_full, encoded.bytes);
        // `event.json` changes for every user snapshot, even when the mesh bytes
        // do not. Its file history is therefore the exact browser timeline.
        try writeDurableAtomic(io, paths.event_full, metadata_json);

        const stage_paths = [_][]const u8{ paths.resident_lore, paths.event_lore };
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
        var resident_proof = try materializeRevision(
            io,
            allocator,
            request.modelId,
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
            paths.event_lore,
            &commit_hex,
            ".json",
            true,
            false,
        );
        defer event_proof.deinit(allocator);
        if (!std.mem.eql(u8, event_proof.bytes, metadata_json)) return error.CommittedEventMismatch;
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
        break :commit_block .{
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
        request.kind == .normal and request.push,
    );
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = true,
        .modelId = request.modelId,
        .revision = &committed.revision,
        .revisionNumber = committed.revision_number,
        .timestampMs = committed.timestamp_ms,
        .sequence = committed.sequence,
        .sha256 = &sha,
        .byteLength = encoded.bytes.len,
        .triangleCount = document.verts.len / 24,
        .partCount = encoded.part_count,
        .logicalVertexCount = encoded.logical_vertex_count,
        .metadataStored = committed.metadata_stored,
        .pushAttempted = push.attempted,
        .pushed = push.pushed,
        .pushError = push.error_text,
        .spoolPath = paths.resident_full,
    }, .{});
}

pub fn historyJson(io: std.Io, allocator: std.mem.Allocator, request_json: []const u8) ![]u8 {
    var parsed = try parseRequest(ModelRequest, allocator, request_json);
    defer parsed.deinit();
    var paths = try Paths.init(allocator, parsed.value.modelId);
    defer paths.deinit(allocator);
    if (parsed.value.cursor.len > 0 and !validRevision(parsed.value.cursor)) return error.InvalidHistoryCursor;
    const repository_path = try repositoryPathAlloc(io, allocator);
    defer allocator.free(repository_path);
    const event_paths = [_][]const u8{paths.event_lore};
    var event_info = try lore.fileInfo(allocator, repository_path, "", &event_paths, "");
    defer event_info.deinit(allocator);
    if (event_info.entries.len == 0) {
        return std.json.Stringify.valueAlloc(allocator, .{
            .ok = true,
            .modelId = parsed.value.modelId,
            .state = "empty",
            .entries = [_]HistoryItem{},
        }, .{});
    }
    var pins = try readPinsDurable(io, allocator, repository_path, &paths);
    defer pins.deinit(allocator);
    const page_length = @min(if (parsed.value.limit == 0) DEFAULT_HISTORY else parsed.value.limit, MAX_HISTORY);
    var history = try lore.fileHistory(allocator, repository_path, "", paths.event_lore, .{
        .revision = parsed.value.cursor,
        .length = page_length,
    });
    defer history.deinit(allocator);

    const items = try allocator.alloc(HistoryItem, history.entries.len);
    var initialized: usize = 0;
    defer {
        for (items[0..initialized]) |*item| item.deinit(allocator);
        allocator.free(items);
    }
    for (history.entries, items) |entry, *item| {
        const revision = revisionHex(entry.revision);
        const revision_text = try allocator.dupe(u8, &revision);
        errdefer allocator.free(revision_text);
        // event.json was committed and byte-compared in the same transaction as
        // resident.rjmd. It is the canonical browse record; revision metadata is
        // an index hint only and must never override same-model event facts.
        var metadata = try metadataFromEventRevision(io, allocator, repository_path, &paths, revision_text);
        errdefer metadata.deinit(allocator);
        if (!std.mem.eql(u8, metadata.model_id, parsed.value.modelId)) return error.SnapshotMetadataModelMismatch;
        item.* = .{
            .revision = revision_text,
            .revisionNumber = entry.revision_number,
            .timestampMs = metadata.timestamp_ms,
            .sequence = metadata.sequence,
            .label = metadata.label,
            .note = metadata.note,
            .kind = metadata.kind,
            .packageGeometryPath = metadata.package_geometry_path,
            .sha256 = metadata.sha256,
            .byteLength = metadata.byte_length,
            .triangleCount = metadata.triangle_count,
            .partCount = metadata.part_count,
            .logicalVertexCount = metadata.logical_vertex_count,
            .pinned = pins.contains(revision_text),
        };
        allocator.free(metadata.model_id);
        metadata = undefined;
        initialized += 1;
    }
    var next_cursor_storage: [64]u8 = undefined;
    const next_cursor: ?[]const u8 = if (history.entries.len == page_length and history.entries.len > 0 and
        !hashIsZero(history.entries[history.entries.len - 1].parents[0]))
    cursor: {
        next_cursor_storage = revisionHex(history.entries[history.entries.len - 1].parents[0]);
        break :cursor &next_cursor_storage;
    } else null;
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = true,
        .modelId = parsed.value.modelId,
        .state = if (items.len == 0) "empty" else "ready",
        .cursor = if (parsed.value.cursor.len == 0) null else parsed.value.cursor,
        .nextCursor = next_cursor,
        .entries = items,
    }, .{});
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

fn materializeRevision(
    io: std.Io,
    allocator: std.mem.Allocator,
    model_id: []const u8,
    revision: []const u8,
    offline: bool,
    retain: bool,
) !MaterializedRevision {
    if (!validRevision(revision)) return error.InvalidRevision;
    var paths = try Paths.init(allocator, model_id);
    defer paths.deinit(allocator);
    const repository_path = try repositoryPathAlloc(io, allocator);
    defer allocator.free(repository_path);
    var event_history = try lore.fileHistory(allocator, repository_path, "", paths.event_lore, .{});
    defer event_history.deinit(allocator);
    if (!revisionExists(&event_history, revision)) return error.RevisionNotFoundForModel;

    // Historical materializations are disposable views outside the checkout;
    // preview and proof never manufacture untracked repository state.
    var file = try materializeLoreFile(
        io,
        allocator,
        repository_path,
        paths.resident_lore,
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

pub fn previewJson(io: std.Io, allocator: std.mem.Allocator, request_json: []const u8) ![]u8 {
    var parsed = try parseRequest(RevisionRequest, allocator, request_json);
    defer parsed.deinit();
    var materialized = try materializeRevision(io, allocator, parsed.value.modelId, parsed.value.revision, false, true);
    defer materialized.deinit(allocator);
    const sha = hashHex(materialized.file.bytes);
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = true,
        .modelId = parsed.value.modelId,
        .revision = parsed.value.revision,
        .path = materialized.file.full_path,
        .version = materialized.document.version,
        .byteLength = materialized.file.bytes.len,
        .sha256 = &sha,
        .vertexCount = materialized.document.verts.len / 8,
        .triangleCount = materialized.document.verts.len / 24,
        .partCount = materialized.document.ranges.len / 2,
        .logicalVertexCount = materialized.document.logical_vertex_count,
    }, .{});
}

fn validPackageGeometryPath(path: []const u8) bool {
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

fn restoreParentConfined(io: std.Io, allocator: std.mem.Allocator, path: []const u8) !bool {
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

fn contentAddressMatches(path: []const u8, sha: []const u8) bool {
    const base = std.fs.path.basename(path);
    if (!std.mem.startsWith(u8, base, "character-") or !std.mem.endsWith(u8, base, ".rjmd")) return true;
    const encoded = base["character-".len .. base.len - ".rjmd".len];
    return std.mem.eql(u8, encoded, sha);
}

pub fn restoreJson(io: std.Io, allocator: std.mem.Allocator, request_json: []const u8) ![]u8 {
    var parsed = try parseRequest(RestoreRequest, allocator, request_json);
    defer parsed.deinit();
    if (!validPackageGeometryPath(parsed.value.packageGeometryPath)) return error.InvalidRestoreTarget;
    if (!try restoreParentConfined(io, allocator, parsed.value.packageGeometryPath)) return error.RestoreTargetEscapesModelRoot;
    var materialized = try materializeRevision(io, allocator, parsed.value.modelId, parsed.value.revision, false, false);
    defer materialized.deinit(allocator);
    var paths = try Paths.init(allocator, parsed.value.modelId);
    defer paths.deinit(allocator);
    const repository_path = try repositoryPathAlloc(io, allocator);
    defer allocator.free(repository_path);
    var metadata = try metadataFromEventRevision(
        io,
        allocator,
        repository_path,
        &paths,
        parsed.value.revision,
    );
    defer metadata.deinit(allocator);
    if (!std.mem.eql(u8, metadata.model_id, parsed.value.modelId)) return error.RestoreModelMismatch;
    if (metadata.package_geometry_path.len == 0 or
        !std.mem.eql(u8, metadata.package_geometry_path, parsed.value.packageGeometryPath))
    {
        return error.RestoreTargetDoesNotMatchSnapshot;
    }
    const sha = hashHex(materialized.file.bytes);
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
        .modelId = parsed.value.modelId,
        .revision = parsed.value.revision,
        .path = parsed.value.packageGeometryPath,
        .byteLength = readback.len,
        .sha256 = &readback_sha,
        .version = materialized.document.version,
        .triangleCount = materialized.document.verts.len / 24,
    }, .{});
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
    if (!validRevision(parsed.value.revision)) return error.InvalidRevision;
    var paths = try Paths.init(allocator, parsed.value.modelId);
    defer paths.deinit(allocator);
    const repository_path = try repositoryPathAlloc(io, allocator);
    defer allocator.free(repository_path);

    const RegistryCommit = struct {
        revision: [64]u8 = [_]u8{'0'} ** 64,
        revision_number: u64 = 0,
        has_revision: bool = false,
        changed: bool = false,
    };
    const registry_commit: RegistryCommit = pin_block: {
        var mutation_lock = try acquireMutationLock(io);
        defer mutation_lock.release();
        var history = try lore.fileHistory(allocator, repository_path, "", paths.event_lore, .{});
        defer history.deinit(allocator);
        if (!revisionExists(&history, parsed.value.revision)) return error.RevisionNotFoundForModel;
        var existing = try readPinsDurable(io, allocator, repository_path, &paths);
        defer existing.deinit(allocator);

        if (existing.contains(parsed.value.revision) == parsed.value.pinned) {
            var prior = try lore.fileHistory(allocator, repository_path, "", paths.pins_lore, .{ .length = 1 });
            defer prior.deinit(allocator);
            if (prior.entries.len == 0) break :pin_block .{};
            break :pin_block .{
                .revision = revisionHex(prior.entries[0].revision),
                .revision_number = prior.entries[0].revision_number,
                .has_revision = true,
                .changed = false,
            };
        }

        var next: std.ArrayList([]const u8) = .empty;
        defer next.deinit(allocator);
        for (existing.values) |value| {
            if (!std.mem.eql(u8, value, parsed.value.revision)) try next.append(allocator, value);
        }
        if (parsed.value.pinned) try next.append(allocator, parsed.value.revision);
        std.mem.sort([]const u8, next.items, {}, struct {
            fn lessThan(_: void, left: []const u8, right: []const u8) bool {
                return std.mem.lessThan(u8, left, right);
            }
        }.lessThan);
        const registry_json = try std.json.Stringify.valueAlloc(allocator, PinRegistryWire{
            .pinned = next.items,
        }, .{});
        defer allocator.free(registry_json);
        try fs.makePathDurable(io, std.Io.Dir.cwd(), paths.directory_full);
        try writeDurableAtomic(io, paths.pins_full, registry_json);
        const stage_paths = [_][]const u8{paths.pins_lore};
        var stage = try lore.fileStage(allocator, repository_path, "", &stage_paths, .{});
        defer stage.deinit(allocator);
        const message = try std.fmt.allocPrint(allocator, "{s} model snapshot {s}", .{
            if (parsed.value.pinned) "pin" else "unpin",
            parsed.value.revision,
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
        if (proof_registry.contains(parsed.value.revision) != parsed.value.pinned) return error.CommittedPinStateMismatch;
        break :pin_block .{
            .revision = commit_hex,
            .revision_number = commit.revision.revision_number,
            .has_revision = true,
            .changed = true,
        };
    };
    const push = pushCurrent(io, allocator, repository_path, parsed.value.push);
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = true,
        .modelId = parsed.value.modelId,
        .revision = parsed.value.revision,
        .pinned = parsed.value.pinned,
        .changed = registry_commit.changed,
        .registryRevision = if (registry_commit.has_revision) &registry_commit.revision else null,
        .registryRevisionNumber = if (registry_commit.has_revision) registry_commit.revision_number else null,
        .pushAttempted = push.attempted,
        .pushed = push.pushed,
        .pushError = push.error_text,
    }, .{});
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
                if (current.revision) |revision| repository_revision = revision.revision_number;
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
    return std.json.Stringify.valueAlloc(allocator, .{
        .ok = lore.available() and repository_ready,
        .available = lore.available(),
        .version = lore.version(),
        .serverHealthy = code == 200,
        .healthUrl = HEALTH_URL,
        .healthCode = code,
        .unitName = "loreserver.service",
        .unitActive = unit_active,
        .unitEnabled = unit_enabled,
        .recentJournal = recent_journal,
        .restoreCommands = [_][]const u8{
            "systemctl --user start loreserver.service",
            "systemctl --user status loreserver.service --no-pager",
            "journalctl --user -u loreserver.service -n 50 --no-pager",
        },
        .repositoryReady = repository_ready,
        .repositoryRevision = repository_revision,
        .repositoryPath = repository_path orelse REPOSITORY_PATH,
        .snapshotRoot = SNAPSHOT_ROOT,
        .localStoreBytes = directorySize(io, allocator, local_store_path),
        .serverStorePath = parsed.value.serverStorePath,
        .serverStoreBytes = directorySize(io, allocator, parsed.value.serverStorePath),
    }, .{});
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
