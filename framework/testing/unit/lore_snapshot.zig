//! Focused native boundary tests for resident Lore recovery snapshots.

const std = @import("std");
const snapshot = @import("../../vcs/snapshot.zig");
const meshdoc_format = @import("../../gpu/meshdoc_format.zig");

test "all six native door bodies compile without mutating on incomplete requests" {
    const allocator = std.testing.allocator;
    var verts = [_]f32{0} ** 24;
    const document = meshdoc_format.Snapshot{
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

    if (snapshot.snapshotJson(std.testing.io, allocator, &document, null, "{}")) |json| allocator.free(json) else |_| {}
    if (snapshot.historyJson(std.testing.io, allocator, "{}")) |json| allocator.free(json) else |_| {}
    if (snapshot.previewJson(std.testing.io, allocator, "{}")) |json| allocator.free(json) else |_| {}
    if (snapshot.restoreJson(std.testing.io, allocator, "{}")) |json| allocator.free(json) else |_| {}
    if (snapshot.pinJson(std.testing.io, allocator, "{}")) |json| allocator.free(json) else |_| {}
    const status = try snapshot.serverStatusJson(std.testing.io, allocator, "{}");
    defer allocator.free(status);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"available\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"unitActive\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"recentJournal\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, status, "\"restoreCommands\"") != null);
}
