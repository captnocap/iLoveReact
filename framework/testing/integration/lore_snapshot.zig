//! Opt-in live Lore proof for the resident model recovery chain.
//!
//! This test commits only an ignored `__rjit_lore_integration_v1` spool and
//! creates/removes one dot-prefixed temporary model package. It never stages or
//! commits a game model. Run with `zig build test-lore-snapshot-live` while the
//! local Lore service is available.

const std = @import("std");
const snapshot = @import("../../vcs/snapshot.zig");
const lore = @import("../../vcs/lore.zig");
const meshdoc = @import("../../gpu/meshdoc_format.zig");
const event_bus = @import("../../diag/event_bus.zig");

const model_id = "__rjit_lore_integration_v1";
const package_dir = "cart/editor/data/models/.lore-snapshot-integration";
const package_mesh_dir = package_dir ++ "/mesh";
const package_geometry = package_mesh_dir ++ "/doc.blob";
const other_package_dir = "cart/editor/data/models/.lore-snapshot-other";
const other_mesh_dir = other_package_dir ++ "/mesh";
const other_geometry = other_mesh_dir ++ "/doc.blob";

const SnapshotReply = struct {
    revision: []const u8,
    sha256: []const u8,
    spoolPath: []const u8,
    metadataStored: bool,
};

const HistoryEntry = struct {
    revision: []const u8,
    label: []const u8,
    sha256: []const u8,
    triangleCount: u64,
    pinned: bool,
};

const HistoryReply = struct {
    state: []const u8,
    entries: []const HistoryEntry,
};

const PreviewReply = struct {
    path: []const u8,
    sha256: []const u8,
    triangleCount: u64,
    version: u32,
};

fn parse(comptime T: type, allocator: std.mem.Allocator, bytes: []const u8) !std.json.Parsed(T) {
    return std.json.parseFromSlice(T, allocator, bytes, .{ .ignore_unknown_fields = true });
}

fn fixture() meshdoc.Snapshot {
    const Data = struct {
        var verts = [_]f32{
            0, 0, 0, 0, 0, 1, 0, 0,
            2, 0, 0, 0, 0, 1, 1, 0,
            0, 3, 0, 0, 0, 1, 0, 1,
        };
        var groups = [_]u32{2};
    };
    return .{
        .verts = &Data.verts,
        .groups = &Data.groups,
        .materials = null,
        .semantic_regions = null,
        .semantic_instances = null,
        .render_corner_logical_ids = null,
        .logical_vertex_count = 0,
        .dense_to_stable_logical_ids = null,
        .semantic_table_json = null,
        .glass_first_vertex = 3,
    };
}

fn expectedBytes(allocator: std.mem.Allocator) ![]u8 {
    var document = fixture();
    const recovered_ranges = [_]u32{ 2, 3 };
    return meshdoc.encodeCurrentSnapshotAlloc(allocator, &document, &recovered_ranges);
}

fn readExact(io: std.Io, allocator: std.mem.Allocator, path: []const u8, expected: []const u8) !void {
    const bytes = try std.Io.Dir.cwd().readFileAlloc(io, path, allocator, .unlimited);
    defer allocator.free(bytes);
    try std.testing.expectEqualSlices(u8, expected, bytes);
}

fn removeIfPresent(io: std.Io, path: []const u8) void {
    std.Io.Dir.cwd().deleteFile(io, path) catch {};
}

fn setPin(io: std.Io, allocator: std.mem.Allocator, revision: []const u8, pinned: bool) !void {
    const request = try std.json.Stringify.valueAlloc(allocator, .{
        .modelId = model_id,
        .revision = revision,
        .pinned = pinned,
        .push = false,
    }, .{});
    defer allocator.free(request);
    const response = try snapshot.pinJson(io, allocator, request);
    defer allocator.free(response);
    try std.testing.expect(std.mem.indexOf(u8, response, if (pinned) "\"pinned\":true" else "\"pinned\":false") != null);
}

fn findRevision(history: HistoryReply, revision: []const u8) ?HistoryEntry {
    for (history.entries) |entry| if (std.mem.eql(u8, entry.revision, revision)) return entry;
    return null;
}

const ConcurrentCapture = struct {
    io: std.Io,
    label: []const u8,
    apex_y: f32,
    response: ?[]u8 = null,
    failure: ?anyerror = null,

    fn run(self: *ConcurrentCapture) void {
        const allocator = std.heap.c_allocator;
        var verts = [_]f32{
            0, 0,           0, 0, 0, 1, 0, 0,
            2, 0,           0, 0, 0, 1, 1, 0,
            0, self.apex_y, 0, 0, 0, 1, 0, 1,
        };
        var groups = [_]u32{2};
        const document = meshdoc.Snapshot{
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
        const request = std.json.Stringify.valueAlloc(allocator, .{
            .modelId = "__rjit_lore_concurrency_v1",
            .label = self.label,
            .kind = "panic",
            .push = false,
        }, .{}) catch |err| {
            self.failure = err;
            return;
        };
        defer allocator.free(request);
        const ranges = [_]u32{ 2, 3 };
        self.response = snapshot.snapshotJson(self.io, allocator, &document, &ranges, request) catch |err| {
            self.failure = err;
            return;
        };
    }
};

test "live snapshot survives spool loss and cold history preview pin restore" {
    const io = std.testing.io;
    const allocator = std.testing.allocator;
    defer event_bus.deinit();
    const cwd = std.Io.Dir.cwd();
    cwd.deleteTree(io, package_dir) catch {};
    defer cwd.deleteTree(io, package_dir) catch {};
    cwd.deleteTree(io, other_package_dir) catch {};
    defer cwd.deleteTree(io, other_package_dir) catch {};
    try cwd.createDirPath(io, package_mesh_dir);
    var old = try cwd.createFile(io, package_geometry, .{ .truncate = true });
    try old.writeStreamingAll(io, "old package bytes");
    try old.sync(io);
    old.close(io);

    var document = fixture();
    const stale_ranges = [_]u32{ 0, 1 };
    const request = try std.json.Stringify.valueAlloc(allocator, .{
        .modelId = model_id,
        .label = "Live resident integration proof",
        .note = "spool deletion must not hide this revision",
        .packageGeometryPath = package_geometry,
        .kind = "panic",
        .push = false,
    }, .{});
    defer allocator.free(request);
    const snapshot_json = try snapshot.snapshotJson(io, allocator, &document, &stale_ranges, request);
    defer allocator.free(snapshot_json);
    var captured = try parse(SnapshotReply, allocator, snapshot_json);
    defer captured.deinit();
    try std.testing.expect(captured.value.metadataStored);

    const expected = try expectedBytes(allocator);
    defer allocator.free(expected);
    try readExact(io, allocator, captured.value.spoolPath, expected);
    const spool_dir = std.fs.path.dirname(captured.value.spoolPath) orelse return error.InvalidSpoolPath;
    const event_path = try std.fmt.allocPrint(allocator, "{s}/event.json", .{spool_dir});
    defer allocator.free(event_path);
    const pins_path = try std.fmt.allocPrint(allocator, "{s}/pins.json", .{spool_dir});
    defer allocator.free(pins_path);
    removeIfPresent(io, captured.value.spoolPath);
    removeIfPresent(io, event_path);

    const history_request = "{\"modelId\":\"__rjit_lore_integration_v1\",\"limit\":100}";
    const history_json = try snapshot.historyJson(io, allocator, history_request);
    defer allocator.free(history_json);
    var history = try parse(HistoryReply, allocator, history_json);
    defer history.deinit();
    try std.testing.expectEqualStrings("ready", history.value.state);
    const entry = findRevision(history.value, captured.value.revision) orelse return error.CapturedRevisionMissing;
    try std.testing.expectEqualStrings("Live resident integration proof", entry.label);
    try std.testing.expectEqualStrings(captured.value.sha256, entry.sha256);
    try std.testing.expectEqual(@as(u64, 1), entry.triangleCount);

    try setPin(io, allocator, captured.value.revision, true);
    removeIfPresent(io, pins_path);
    const pinned_json = try snapshot.historyJson(io, allocator, history_request);
    defer allocator.free(pinned_json);
    var pinned_history = try parse(HistoryReply, allocator, pinned_json);
    defer pinned_history.deinit();
    try std.testing.expect((findRevision(pinned_history.value, captured.value.revision) orelse
        return error.PinnedRevisionMissing).pinned);

    const repository_path = try cwd.realPathFileAlloc(io, "cart/editor", allocator);
    defer allocator.free(repository_path);
    var before = try lore.repositoryStatus(allocator, repository_path, "", .{ .revision_only = true });
    defer before.deinit(allocator);
    const before_revision = before.revision.?.revision_number;
    const revision_request = try std.json.Stringify.valueAlloc(allocator, .{
        .modelId = model_id,
        .revision = captured.value.revision,
    }, .{});
    defer allocator.free(revision_request);
    const preview_json = try snapshot.previewJson(io, allocator, revision_request);
    defer allocator.free(preview_json);
    var preview = try parse(PreviewReply, allocator, preview_json);
    defer preview.deinit();
    try std.testing.expectEqual(meshdoc.VERSION_LOGICAL_TOPOLOGY, preview.value.version);
    try std.testing.expectEqualStrings(captured.value.sha256, preview.value.sha256);
    try readExact(io, allocator, preview.value.path, expected);
    var after = try lore.repositoryStatus(allocator, repository_path, "", .{ .revision_only = true });
    defer after.deinit(allocator);
    try std.testing.expectEqual(before_revision, after.revision.?.revision_number);

    try cwd.createDirPath(io, other_mesh_dir);
    var other = try cwd.createFile(io, other_geometry, .{ .truncate = true });
    try other.writeStreamingAll(io, "other model sentinel");
    try other.sync(io);
    other.close(io);
    const wrong_restore_request = try std.json.Stringify.valueAlloc(allocator, .{
        .modelId = model_id,
        .revision = captured.value.revision,
        .packageGeometryPath = other_geometry,
    }, .{});
    defer allocator.free(wrong_restore_request);
    if (snapshot.restoreJson(io, allocator, wrong_restore_request)) |unexpected| {
        allocator.free(unexpected);
        return error.CrossModelRestoreWasAccepted;
    } else |err| try std.testing.expectEqual(error.RestoreTargetDoesNotMatchSnapshot, err);
    try readExact(io, allocator, other_geometry, "other model sentinel");

    const restore_request = try std.json.Stringify.valueAlloc(allocator, .{
        .modelId = model_id,
        .revision = captured.value.revision,
        .packageGeometryPath = package_geometry,
    }, .{});
    defer allocator.free(restore_request);
    const restore_json = try snapshot.restoreJson(io, allocator, restore_request);
    defer allocator.free(restore_json);
    try std.testing.expect(std.mem.indexOf(u8, restore_json, "\"ok\":true") != null);
    try readExact(io, allocator, package_geometry, expected);

    try setPin(io, allocator, captured.value.revision, false);
    removeIfPresent(io, pins_path);
    const unpinned_json = try snapshot.historyJson(io, allocator, history_request);
    defer allocator.free(unpinned_json);
    var unpinned_history = try parse(HistoryReply, allocator, unpinned_json);
    defer unpinned_history.deinit();
    try std.testing.expect(!(findRevision(unpinned_history.value, captured.value.revision) orelse
        return error.UnpinnedRevisionMissing).pinned);
}

test "concurrent resident captures cannot mix fixed spool bytes and event metadata" {
    const io = std.testing.io;
    const allocator = std.testing.allocator;
    defer event_bus.deinit();
    var first = ConcurrentCapture{ .io = io, .label = "concurrent-A", .apex_y = 4 };
    var second = ConcurrentCapture{ .io = io, .label = "concurrent-B", .apex_y = 9 };
    const first_thread = try std.Thread.spawn(.{}, ConcurrentCapture.run, .{&first});
    const second_thread = try std.Thread.spawn(.{}, ConcurrentCapture.run, .{&second});
    first_thread.join();
    second_thread.join();
    if (first.failure) |err| return err;
    if (second.failure) |err| return err;
    const first_json = first.response orelse return error.FirstCaptureMissing;
    defer std.heap.c_allocator.free(first_json);
    const second_json = second.response orelse return error.SecondCaptureMissing;
    defer std.heap.c_allocator.free(second_json);
    var first_reply = try parse(SnapshotReply, allocator, first_json);
    defer first_reply.deinit();
    var second_reply = try parse(SnapshotReply, allocator, second_json);
    defer second_reply.deinit();
    try std.testing.expect(!std.mem.eql(u8, first_reply.value.revision, second_reply.value.revision));
    try std.testing.expect(!std.mem.eql(u8, first_reply.value.sha256, second_reply.value.sha256));

    const history_json = try snapshot.historyJson(
        io,
        allocator,
        "{\"modelId\":\"__rjit_lore_concurrency_v1\",\"limit\":20}",
    );
    defer allocator.free(history_json);
    var history = try parse(HistoryReply, allocator, history_json);
    defer history.deinit();
    const first_entry = findRevision(history.value, first_reply.value.revision) orelse
        return error.FirstConcurrentRevisionMissing;
    const second_entry = findRevision(history.value, second_reply.value.revision) orelse
        return error.SecondConcurrentRevisionMissing;
    try std.testing.expectEqualStrings("concurrent-A", first_entry.label);
    try std.testing.expectEqualStrings(first_reply.value.sha256, first_entry.sha256);
    try std.testing.expectEqualStrings("concurrent-B", second_entry.label);
    try std.testing.expectEqualStrings(second_reply.value.sha256, second_entry.sha256);
}
