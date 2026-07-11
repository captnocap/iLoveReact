//! Focused regressions for the mesh journal's diagnostic boundary.
//! Run: zig build test-mesh-journal-log

const std = @import("std");
const testing = std.testing;
const journal_log = @import("mesh_journal_log");

test "part boundary accepts a complete live range and rejects a stale subrange" {
    const ranges = [_]u32{ 0, 16, 16, 32 };
    try testing.expect(journal_log.hasExactPartRange(&ranges, 0, 16));
    try testing.expect(journal_log.hasExactPartRange(&ranges, 16, 32));
    try testing.expect(!journal_log.hasExactPartRange(&ranges, 0, 6));
    try testing.expect(!journal_log.hasExactPartRange(&ranges, 6, 16));
    try testing.expect(!journal_log.hasExactPartRange(&ranges, 0, 32));
}

test "valid part ranges count every face exactly once" {
    var summary = try journal_log.analyze(testing.allocator, .{
        .vertex_count = 15,
        .groups = &.{ 0, 0, 4, 6, 7 },
        .part_ranges = &.{ 0, 5, 6, 8 },
        .hidden_parts = 1,
        .bytes = 144,
    });
    defer summary.deinit(testing.allocator);

    try testing.expect(summary.groups_match_triangles);
    try testing.expect(summary.ranges_valid);
    try testing.expect(summary.ownership_valid);
    try testing.expectEqual(@as(usize, 4), summary.authored_groups);
    try testing.expectEqual(@as(usize, 3), summary.parts[0].faces);
    try testing.expectEqual(@as(usize, 2), summary.parts[1].faces);
    try testing.expectEqual(@as(usize, 0), summary.unowned_faces);
    try testing.expectEqual(@as(usize, 0), summary.multiply_owned_faces);
}

test "overlapping ranges expose multiply-owned and unowned faces" {
    var summary = try journal_log.analyze(testing.allocator, .{
        .vertex_count = 12,
        .groups = &.{ 1, 4, 6, journal_log.NO_FACE_GROUP },
        .part_ranges = &.{ 0, 5, 4, 7 },
    });
    defer summary.deinit(testing.allocator);

    try testing.expect(!summary.ranges_valid);
    try testing.expect(!summary.ownership_valid);
    try testing.expectEqual(@as(usize, 1), summary.multiply_owned_faces);
    try testing.expectEqual(@as(usize, 1), summary.unowned_faces);
    try testing.expectEqual(@as(usize, 2), summary.parts[0].faces);
    try testing.expectEqual(@as(usize, 2), summary.parts[1].faces);
}

test "json keeps chronological labels state ownership and escaped notes" {
    const before = journal_log.StateView{
        .vertex_count = 3,
        .groups = &.{0},
        .part_ranges = &.{ 0, 1 },
        .bytes = 100,
        .note = "before \"row\"\nline",
    };
    const after = journal_log.StateView{
        .vertex_count = 6,
        .groups = &.{ 0, 1 },
        .part_ranges = &.{ 0, 1, 1, 2 },
        .bytes = 200,
    };
    const undo = [_]journal_log.EntryView{.{ .label = "duplicate part", .state = before }};
    const redo = [_]journal_log.EntryView{.{ .label = "move part", .state = after }};
    const json = try journal_log.encode(testing.allocator, .{
        .capacity = 32,
        .byte_budget = 1024,
        .journal_bytes = 300,
        .pending_gizmo = false,
        .pending_loop_cut = true,
        .scope_ranges = &.{ 0, 2 },
        .topology = .{ .welded_vertices = 24, .triangle_edges = 66, .editable_edges = 36 },
        .undo = &undo,
        .current = after,
        .redo = &redo,
    });
    defer testing.allocator.free(json);

    try testing.expect(std.mem.indexOf(u8, json, "\"label\":\"duplicate part\"") != null);
    try testing.expect(std.mem.indexOf(u8, json, "\"ownershipValid\":true") != null);
    try testing.expect(std.mem.indexOf(u8, json, "before \\\"row\\\"\\nline") != null);
    try testing.expect(std.mem.indexOf(u8, json, "\"loopCut\":true") != null);
    try testing.expect(std.mem.indexOf(u8, json, "\"scope\":{\"ranges\":[[0,2]]}") != null);
    try testing.expect(std.mem.indexOf(u8, json, "\"triangleEdges\":66,\"editableEdges\":36") != null);
}
