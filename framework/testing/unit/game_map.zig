//! Cross-concern boundary tests for framework/game/map.

const std = @import("std");
const engine = @import("../../game/map/engine.zig");
const chunks = @import("../../game/map/chunks.zig");

test "reset unbinds the outgoing document and clears map-scoped bindings" {
    engine.reset();
    engine.setTileBindings(&.{ 11, 12, 13, 14, 21, 22, 23, 24 });
    try std.testing.expectEqual(@as(usize, 2), engine.tileBindings().len);

    const path = "/tmp/reactjit-map-reset-boundary.rmap";
    std.fs.cwd().deleteFile(path) catch {};
    defer std.fs.cwd().deleteFile(path) catch {};

    _ = chunks.growChunk(0, 0).?;
    engine.setAutosaveFile(path);
    try std.testing.expect(engine.autosaveNow());

    engine.reset();
    try std.testing.expectEqual(@as(usize, 0), engine.tileBindings().len);
    // Make the replacement map non-empty so false proves the document target
    // was unbound, rather than merely hitting autosave's empty-world guard.
    _ = chunks.growChunk(0, 0).?;
    try std.testing.expect(!engine.autosaveNow());
}

test "transport pen previews after one anchor and keeps rail out of the road tile compiler" {
    engine.reset();
    defer engine.reset();
    const chunk = chunks.growChunk(0, 0).?;
    engine.setTool(.{ .channel = .road });
    engine.setPathProfile(.{ .light_rail = .{ .tracks = 2 } }, 18);

    engine.strokeBegin(-20, 0);
    _ = engine.strokeEnd();
    engine.setPathHover(20, 0);
    const live = engine.transport.draftPreview().?;
    try std.testing.expectEqual(@as(usize, 1), engine.transport.draftPointCount());
    try std.testing.expectEqual(@as(usize, 2), live.points.len);
    try std.testing.expect(engine.transport.draftValidation().valid);

    engine.strokeBegin(20, 0);
    _ = engine.strokeEnd();
    try std.testing.expect(engine.pathCommit() != null);
    try std.testing.expectEqual(@as(usize, 1), engine.transport.railCount());
    for (chunk.tiles) |tile| try std.testing.expectEqual(chunks.EMPTY_CELL, tile);
}
