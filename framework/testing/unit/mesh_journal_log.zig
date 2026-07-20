//! Focused regressions for the mesh journal's diagnostic boundary.
//! Run: zig build test-mesh-journal-log

const std = @import("std");
const testing = std.testing;
const journal_log = @import("mesh_journal_log");

test "metadata checkpoints require a real bounded state transition" {
    try testing.expect(journal_log.metadataCheckpointValid("before", "after"));
    try testing.expect(!journal_log.metadataCheckpointValid("same", "same"));
    try testing.expect(!journal_log.metadataCheckpointValid("", "after"));
    try testing.expect(!journal_log.metadataCheckpointValid("before", ""));

    const too_large = try testing.allocator.alloc(u8, journal_log.MAX_METADATA_NOTE_BYTES + 1);
    defer testing.allocator.free(too_large);
    @memset(too_large, 'x');
    try testing.expect(!journal_log.metadataCheckpointValid("before", too_large));
}

test "every outliner action admitted by the command layer has a host checkpoint label" {
    const cases = [_]struct { []const u8, []const u8 }{
        .{ "part.rename", "rename part" },
        .{ "parts.group", "group parts" },
        .{ "parts.ungroup", "ungroup parts" },
        .{ "group.rename", "rename group" },
        .{ "group.dissolve", "dissolve group" },
        .{ "outliner.move", "move outliner item" },
    };
    for (cases) |case| try testing.expectEqualStrings(case[1], journal_log.metadataCheckpointLabel(case[0]).?);
    try testing.expect(journal_log.metadataCheckpointLabel("unknown") == null);
}

test "every journaled mesh label has one stable semantic command identity" {
    const cases = [_]struct { []const u8, journal_log.ActionKind, []const u8 }{
        .{ "extrude face", .extrude_face, "model.mesh.extrude-face" },
        .{ "extrude edge", .extrude_edge, "model.mesh.extrude-edge" },
        .{ "create face", .create_face, "model.mesh.create-face" },
        .{ "loop cut", .loop_cut, "model.mesh.loop-cut" },
        .{ "symmetrize", .symmetrize, "model.mesh.symmetrize" },
        .{ "delete selection", .delete_selection, "model.mesh.delete-selection" },
        .{ "delete part", .delete_part, "model.mesh.delete-part" },
        .{ "add part", .add_part, "model.mesh.add-part" },
        .{ "hide part", .hide_part, "model.mesh.hide-part" },
        .{ "show part", .show_part, "model.mesh.show-part" },
        .{ "duplicate part", .duplicate_part, "model.mesh.duplicate-part" },
        .{ "mirror part", .mirror_part, "model.mesh.mirror-part" },
        .{ "path array", .path_array, "model.mesh.path-array" },
        .{ "detach faces", .detach_faces, "model.mesh.detach-faces" },
        .{ "merge parts", .merge_parts, "model.mesh.merge-parts" },
        .{ "flip faces", .flip_faces, "model.mesh.flip-faces" },
        .{ "merge faces", .merge_faces, "model.mesh.merge-faces" },
        .{ "glass faces", .glass_faces, "model.mesh.glass-faces" },
        .{ "solidify faces", .solidify_faces, "model.mesh.solidify-faces" },
        .{ "split quads", .split_quads, "model.mesh.split-quads" },
        .{ "transform", .transform, "model.mesh.transform" },
        .{ "nudge", .nudge, "model.mesh.nudge" },
        .{ "scale by value", .scale_by_value, "model.mesh.scale-by" },
    };
    try testing.expectEqual(@typeInfo(journal_log.ActionKind).@"enum".fields.len, cases.len);
    for (cases) |case| {
        const kind = journal_log.actionKindForLabel(case[0]) orelse return error.MissingActionKind;
        try testing.expectEqual(case[1], kind);
        try testing.expectEqualStrings(case[2], journal_log.actionCommandId(kind));
    }
    try testing.expect(journal_log.actionKindForLabel("rename group") == null);
    try testing.expect(journal_log.actionKindForLabel("unknown mutation") == null);
}

test "only UV-structural mesh actions invalidate an authored paint layout" {
    try testing.expect(journal_log.actionInvalidatesPaintLayout(.add_part));
    try testing.expect(journal_log.actionInvalidatesPaintLayout(.loop_cut));
    try testing.expect(journal_log.actionInvalidatesPaintLayout(.delete_part));
    try testing.expect(journal_log.actionInvalidatesPaintLayout(.split_quads));
    try testing.expect(journal_log.actionInvalidatesPaintLayout(.symmetrize));
    try testing.expect(!journal_log.actionInvalidatesPaintLayout(.transform));
    try testing.expect(!journal_log.actionInvalidatesPaintLayout(.nudge));
    try testing.expect(!journal_log.actionInvalidatesPaintLayout(.hide_part));
    try testing.expect(!journal_log.actionInvalidatesPaintLayout(.glass_faces));
}

test "part boundary accepts a complete live range and rejects a stale subrange" {
    const ranges = [_]u32{ 0, 16, 16, 32 };
    try testing.expect(journal_log.hasExactPartRange(&ranges, 0, 16));
    try testing.expect(journal_log.hasExactPartRange(&ranges, 16, 32));
    try testing.expect(!journal_log.hasExactPartRange(&ranges, 0, 6));
    try testing.expect(!journal_log.hasExactPartRange(&ranges, 6, 16));
    try testing.expect(!journal_log.hasExactPartRange(&ranges, 0, 32));
}

test "append boundary requires the cart and host to share one complete partition" {
    const ranges = [_]u32{ 0, 4, 6, 10 };
    const groups = [_]u32{ 0, 3, 6, 9 };
    try testing.expect(journal_log.ownsExactPartPartition(&groups, &ranges, 2));
    try testing.expect(!journal_log.ownsExactPartPartition(&groups, &ranges, 1));
    try testing.expect(!journal_log.ownsExactPartPartition(&.{ 0, 5, 6 }, &ranges, 2));
    try testing.expect(!journal_log.ownsExactPartPartition(&.{ 0, journal_log.NO_FACE_GROUP }, &ranges, 2));
    try testing.expect(!journal_log.ownsExactPartPartition(&.{ 0, 3 }, &ranges, 2));
    try testing.expect(!journal_log.ownsExactPartPartition(&groups, &.{ 0, 7, 6, 10 }, 2));
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
