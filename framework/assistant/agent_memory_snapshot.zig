//! Agent memory snapshot management
//! Handles syncing agent memory from project snapshots

const std = @import("std");
const Allocator = std.mem.Allocator;

/// Snapshot metadata
pub const SnapshotMeta = struct {
    updated_at: []const u8,

    pub fn parse(json: []const u8, allocator: Allocator) !?SnapshotMeta {
        // Simplified JSON parsing - in production use std.json
        if (std.mem.indexOf(u8, json, "\"updatedAt\"")) |_| {
            // Extract value between quotes after updatedAt
            const start = std.mem.indexOf(u8, json, "\"updatedAt\"") orelse return null;
            const value_start = std.mem.indexOfPos(u8, json, start + 11, "\"") orelse return null;
            const value_end = std.mem.indexOfPos(u8, json, value_start + 1, "\"") orelse return null;
            return SnapshotMeta{
                .updated_at = try allocator.dupe(u8, json[value_start + 1 .. value_end]),
            };
        }
        return null;
    }
};

/// Sync metadata tracking
pub const SyncedMeta = struct {
    synced_from: []const u8,

    pub fn parse(json: []const u8, allocator: Allocator) !?SyncedMeta {
        if (std.mem.indexOf(u8, json, "\"syncedFrom\"")) |_| {
            const start = std.mem.indexOf(u8, json, "\"syncedFrom\"") orelse return null;
            const value_start = std.mem.indexOfPos(u8, json, start + 12, "\"") orelse return null;
            const value_end = std.mem.indexOfPos(u8, json, value_start + 1, "\"") orelse return null;
            return SyncedMeta{
                .synced_from = try allocator.dupe(u8, json[value_start + 1 .. value_end]),
            };
        }
        return null;
    }

    pub fn toJson(self: SyncedMeta, allocator: Allocator) ![]const u8 {
        return try std.fmt.allocPrint(allocator, "{{\"syncedFrom\":\"{s}\"}}", .{self.synced_from});
    }
};

/// Action to take based on snapshot check
pub const SnapshotAction = union(enum) {
    none,
    initialize: struct { snapshot_timestamp: []const u8 },
    prompt_update: struct { snapshot_timestamp: []const u8 },
};

/// Snapshot manager for agent memory
pub const SnapshotManager = struct {
    allocator: Allocator,
    snapshot_base: []const u8,

    pub const SNAPSHOT_JSON = "snapshot.json";
    pub const SYNCED_JSON = ".snapshot-synced.json";

    pub fn init(allocator: Allocator, project_root: []const u8) !SnapshotManager {
        const snapshot_base = try std.fs.path.join(allocator, &.{ project_root, ".agent-memory-snapshots" });
        return .{
            .allocator = allocator,
            .snapshot_base = snapshot_base,
        };
    }

    pub fn deinit(self: *SnapshotManager) void {
        self.allocator.free(self.snapshot_base);
    }

    /// Get snapshot directory for an agent
    pub fn getSnapshotDir(self: *SnapshotManager, agent_type: []const u8) ![]const u8 {
        return try std.fs.path.join(self.allocator, &.{ self.snapshot_base, agent_type });
    }

    /// Get snapshot.json path
    fn getSnapshotJsonPath(self: *SnapshotManager, agent_type: []const u8) ![]const u8 {
        const dir = try self.getSnapshotDir(agent_type);
        defer self.allocator.free(dir);
        return try std.fs.path.join(self.allocator, &.{ dir, SNAPSHOT_JSON });
    }

    /// Check if snapshot exists and whether it's newer than what we last synced
    pub fn checkSnapshot(
        self: *SnapshotManager,
        io: std.Io,
        agent_type: []const u8,
        local_memory_dir: []const u8,
    ) !SnapshotAction {
        // Read snapshot metadata
        const snapshot_path = try self.getSnapshotJsonPath(agent_type);
        defer self.allocator.free(snapshot_path);

        const snapshot_meta = try self.readSnapshotMeta(io, snapshot_path) orelse {
            return .none;
        };
        defer self.allocator.free(snapshot_meta.updated_at);

        // Check if local memory exists
        const has_local = try self.hasLocalMemory(io, local_memory_dir);

        if (!has_local) {
            return .{ .initialize = .{ .snapshot_timestamp = snapshot_meta.updated_at } };
        }

        // Check synced metadata
        const synced_path = try std.fs.path.join(self.allocator, &.{ local_memory_dir, SYNCED_JSON });
        defer self.allocator.free(synced_path);

        const synced_meta = try self.readSyncedMeta(io, synced_path);
        defer if (synced_meta) |m| self.allocator.free(m.synced_from);

        if (synced_meta == null) {
            return .{ .prompt_update = .{ .snapshot_timestamp = snapshot_meta.updated_at } };
        }

        // Compare timestamps
        if (isNewer(snapshot_meta.updated_at, synced_meta.?.synced_from)) {
            return .{ .prompt_update = .{ .snapshot_timestamp = snapshot_meta.updated_at } };
        }

        return .none;
    }

    /// Initialize local memory from snapshot
    pub fn initializeFromSnapshot(
        self: *SnapshotManager,
        io: std.Io,
        agent_type: []const u8,
        local_memory_dir: []const u8,
        snapshot_timestamp: []const u8,
    ) !void {
        try self.copySnapshotToLocal(io, agent_type, local_memory_dir);
        try self.saveSyncedMeta(io, local_memory_dir, snapshot_timestamp);
    }

    /// Replace local memory with snapshot
    pub fn replaceFromSnapshot(
        self: *SnapshotManager,
        io: std.Io,
        agent_type: []const u8,
        local_memory_dir: []const u8,
        snapshot_timestamp: []const u8,
    ) !void {
        // Remove existing .md files
        try self.clearMdFiles(io, local_memory_dir);
        try self.copySnapshotToLocal(io, agent_type, local_memory_dir);
        try self.saveSyncedMeta(io, local_memory_dir, snapshot_timestamp);
    }

    /// Mark current snapshot as synced without changing local memory
    pub fn markSnapshotSynced(
        self: *SnapshotManager,
        io: std.Io,
        local_memory_dir: []const u8,
        snapshot_timestamp: []const u8,
    ) !void {
        try self.saveSyncedMeta(io, local_memory_dir, snapshot_timestamp);
    }

    fn readSnapshotMeta(self: *SnapshotManager, io: std.Io, path: []const u8) !?SnapshotMeta {
        const content = self.readFile(io, path) catch |err| {
            if (err == error.FileNotFound) return null;
            return err;
        };
        defer if (content) |c| self.allocator.free(c);
        if (content) |c| {
            return try SnapshotMeta.parse(c, self.allocator);
        }
        return null;
    }

    fn readSyncedMeta(self: *SnapshotManager, io: std.Io, path: []const u8) !?SyncedMeta {
        const content = self.readFile(io, path) catch |err| {
            if (err == error.FileNotFound) return null;
            return err;
        };
        defer if (content) |c| self.allocator.free(c);
        if (content) |c| {
            return try SyncedMeta.parse(c, self.allocator);
        }
        return null;
    }

    fn readFile(self: *SnapshotManager, io: std.Io, path: []const u8) !?[]const u8 {
        return try std.Io.Dir.cwd().readFileAlloc(io, path, self.allocator, .unlimited);
    }

    fn hasLocalMemory(_: *SnapshotManager, io: std.Io, dir: []const u8) !bool {
        var d = std.Io.Dir.cwd().openDir(io, dir, .{ .iterate = true }) catch return false;
        defer d.close(io);

        var iter = d.iterate();
        while (try iter.next(io)) |entry| {
            if (entry.kind == .file and std.mem.endsWith(u8, entry.name, ".md")) {
                return true;
            }
        }
        return false;
    }

    fn copySnapshotToLocal(
        self: *SnapshotManager,
        io: std.Io,
        agent_type: []const u8,
        local_dir: []const u8,
    ) !void {
        const snapshot_dir = try self.getSnapshotDir(agent_type);
        defer self.allocator.free(snapshot_dir);

        // Create local directory
        try std.Io.Dir.cwd().createDirPath(io, local_dir);

        // Copy files (simplified - iterate and copy)
        var dir = std.Io.Dir.cwd().openDir(io, snapshot_dir, .{ .iterate = true }) catch return;
        defer dir.close(io);

        var iter = dir.iterate();
        while (try iter.next(io)) |entry| {
            if (entry.kind != .file or std.mem.eql(u8, entry.name, SNAPSHOT_JSON)) continue;

            const src_path = try std.fs.path.join(self.allocator, &.{ snapshot_dir, entry.name });
            defer self.allocator.free(src_path);
            const dst_path = try std.fs.path.join(self.allocator, &.{ local_dir, entry.name });
            defer self.allocator.free(dst_path);

            const content = self.readFile(io, src_path) catch continue;
            defer if (content) |c| self.allocator.free(c);

            if (content) |c| {
                const dst_file = std.Io.Dir.cwd().createFile(io, dst_path, .{}) catch continue;
                defer dst_file.close(io);
                try dst_file.writeStreamingAll(io, c);
            }
        }
    }

    fn clearMdFiles(self: *SnapshotManager, io: std.Io, dir: []const u8) !void {
        var d = std.Io.Dir.cwd().openDir(io, dir, .{ .iterate = true }) catch return;
        defer d.close(io);

        var iter = d.iterate();
        while (try iter.next(io)) |entry| {
            if (entry.kind == .file and std.mem.endsWith(u8, entry.name, ".md")) {
                const path = try std.fs.path.join(self.allocator, &.{ dir, entry.name });
                defer self.allocator.free(path);
                std.Io.Dir.cwd().deleteFile(io, path) catch {};
            }
        }
    }

    fn saveSyncedMeta(self: *SnapshotManager, io: std.Io, dir: []const u8, timestamp: []const u8) !void {
        try std.Io.Dir.cwd().createDirPath(io, dir);
        const path = try std.fs.path.join(self.allocator, &.{ dir, SYNCED_JSON });
        defer self.allocator.free(path);

        const meta = SyncedMeta{ .synced_from = timestamp };
        const json = try meta.toJson(self.allocator);
        defer self.allocator.free(json);

        try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = path, .data = json });
    }
};

/// Compare two ISO timestamps (simplified)
fn isNewer(ts1: []const u8, ts2: []const u8) bool {
    return std.mem.order(u8, ts1, ts2) == .gt;
}

// =============================================================================
// Tests
// =============================================================================

test "SnapshotMeta parse" {
    const allocator = std.testing.allocator;
    const json = "{\"updatedAt\":\"2024-01-15T10:30:00Z\"}";
    const meta = try SnapshotMeta.parse(json, allocator);
    defer if (meta) |m| allocator.free(m.updated_at);

    try std.testing.expect(meta != null);
    try std.testing.expectEqualStrings("2024-01-15T10:30:00Z", meta.?.updated_at);
}

test "SyncedMeta parse and toJson" {
    const allocator = std.testing.allocator;
    const json = "{\"syncedFrom\":\"2024-01-15T10:30:00Z\"}";
    const meta = try SyncedMeta.parse(json, allocator);
    defer if (meta) |m| allocator.free(m.synced_from);

    try std.testing.expect(meta != null);
    try std.testing.expectEqualStrings("2024-01-15T10:30:00Z", meta.?.synced_from);

    const out = try meta.?.toJson(allocator);
    defer allocator.free(out);
    try std.testing.expect(std.mem.indexOf(u8, out, "syncedFrom") != null);
}

test "isNewer timestamp comparison" {
    try std.testing.expect(isNewer("2024-01-16T00:00:00Z", "2024-01-15T00:00:00Z"));
    try std.testing.expect(!isNewer("2024-01-15T00:00:00Z", "2024-01-16T00:00:00Z"));
    try std.testing.expect(!isNewer("2024-01-15T00:00:00Z", "2024-01-15T00:00:00Z"));
}

test "SnapshotManager paths" {
    const allocator = std.testing.allocator;
    var manager = try SnapshotManager.init(allocator, "/project");
    defer manager.deinit();

    const dir = try manager.getSnapshotDir("explorer");
    defer allocator.free(dir);
    try std.testing.expectEqualStrings("/project/.agent-memory-snapshots/explorer", dir);
}

test "SnapshotManager performs snapshot io through the supplied capability" {
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    var root_buf: [std.fs.max_path_bytes]u8 = undefined;
    const root_len = try tmp.dir.realPath(io, &root_buf);
    const root = root_buf[0..root_len];

    var manager = try SnapshotManager.init(allocator, root);
    defer manager.deinit();

    const snapshot_dir = try manager.getSnapshotDir("explorer");
    defer allocator.free(snapshot_dir);
    try std.Io.Dir.cwd().createDirPath(io, snapshot_dir);

    const snapshot_json = try std.fs.path.join(allocator, &.{ snapshot_dir, SnapshotManager.SNAPSHOT_JSON });
    defer allocator.free(snapshot_json);
    try std.Io.Dir.cwd().writeFile(io, .{
        .sub_path = snapshot_json,
        .data = "{\"updatedAt\":\"2026-07-18T12:00:00Z\"}",
    });

    const snapshot_memory = try std.fs.path.join(allocator, &.{ snapshot_dir, "memory.md" });
    defer allocator.free(snapshot_memory);
    try std.Io.Dir.cwd().writeFile(io, .{
        .sub_path = snapshot_memory,
        .data = "snapshot one",
    });

    const local_dir = try std.fs.path.join(allocator, &.{ root, "local-memory" });
    defer allocator.free(local_dir);

    const initial_action = try manager.checkSnapshot(io, "explorer", local_dir);
    try std.testing.expect(initial_action == .initialize);

    try manager.initializeFromSnapshot(io, "explorer", local_dir, "2026-07-18T12:00:00Z");

    const local_memory = try std.fs.path.join(allocator, &.{ local_dir, "memory.md" });
    defer allocator.free(local_memory);
    const initialized = try std.Io.Dir.cwd().readFileAlloc(io, local_memory, allocator, .limited(1024));
    defer allocator.free(initialized);
    try std.testing.expectEqualStrings("snapshot one", initialized);
    try std.testing.expect((try manager.checkSnapshot(io, "explorer", local_dir)) == .none);

    const stale_memory = try std.fs.path.join(allocator, &.{ local_dir, "stale.md" });
    defer allocator.free(stale_memory);
    try std.Io.Dir.cwd().writeFile(io, .{
        .sub_path = stale_memory,
        .data = "remove me",
    });
    try std.Io.Dir.cwd().writeFile(io, .{
        .sub_path = snapshot_memory,
        .data = "snapshot two",
    });

    try manager.replaceFromSnapshot(io, "explorer", local_dir, "2026-07-18T13:00:00Z");
    try std.testing.expectError(error.FileNotFound, std.Io.Dir.cwd().access(io, stale_memory, .{}));
    const replaced = try std.Io.Dir.cwd().readFileAlloc(io, local_memory, allocator, .limited(1024));
    defer allocator.free(replaced);
    try std.testing.expectEqualStrings("snapshot two", replaced);

    try manager.markSnapshotSynced(io, local_dir, "2026-07-18T14:00:00Z");
    const synced_path = try std.fs.path.join(allocator, &.{ local_dir, SnapshotManager.SYNCED_JSON });
    defer allocator.free(synced_path);
    const synced = try std.Io.Dir.cwd().readFileAlloc(io, synced_path, allocator, .limited(1024));
    defer allocator.free(synced);
    try std.testing.expectEqualStrings("{\"syncedFrom\":\"2026-07-18T14:00:00Z\"}", synced);
}
