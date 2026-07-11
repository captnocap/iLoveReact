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

test "rail storey points derive grade and TC Stops sample the same 3D path" {
    engine.reset();
    defer engine.reset();
    _ = chunks.growChunk(0, 0).?;
    engine.setTool(.{ .channel = .road });
    engine.setPathProfile(.{ .light_rail = .{} }, 18);

    engine.setPathLevel(0);
    engine.strokeBegin(-30, 0);
    _ = engine.strokeEnd();
    engine.setPathLevel(1);
    engine.setPathHover(30, 0);
    const validation = engine.transport.draftValidation();
    try std.testing.expect(validation.valid);
    try std.testing.expectApproxEqAbs(@as(f32, 0.05), validation.max_grade, 0.001);
    engine.strokeBegin(30, 0);
    _ = engine.strokeEnd();
    const path_id = engine.pathCommit().?;
    const path = engine.transport.pathForId(path_id).?;
    try std.testing.expectApproxEqAbs(@as(f32, 3), path.points[1].elevation_m, 0.001);

    engine.setPathAuthoringTool(.stop);
    engine.setPathHover(0, 1);
    const stop_preview = engine.transport.controlPreview().?;
    try std.testing.expect(stop_preview.valid);
    try std.testing.expectApproxEqAbs(@as(f32, 1.5), stop_preview.sample.point.elevation_m, 0.1);
    engine.strokeBegin(0, 1);
    _ = engine.strokeEnd();
    try std.testing.expectEqual(@as(usize, 1), engine.transport.controlCount());
}

test "Map Paint undo and redo restore the native RMAP concern per gesture" {
    engine.reset();
    defer engine.reset();
    _ = chunks.growChunk(0, 0).?;
    engine.setTool(.{ .channel = .terrain, .terrain_tool = .brush, .radius_m = 3, .center_z = 6, .profile = .flat });
    engine.strokeBegin(0, 0);
    _ = engine.strokeEnd();
    try std.testing.expectApproxEqAbs(@as(f32, 6), engine.heightAt(0, 0), 0.001);
    try std.testing.expectEqual(@as(usize, 1), engine.mapHistoryStats().undo);

    const undone = engine.mapHistoryUndo();
    try std.testing.expect(undone.ok);
    try std.testing.expectApproxEqAbs(@as(f32, 0), engine.heightAt(0, 0), 0.001);
    try std.testing.expectEqual(@as(usize, 1), undone.stats.redo);

    const redone = engine.mapHistoryRedo();
    try std.testing.expect(redone.ok);
    try std.testing.expectApproxEqAbs(@as(f32, 6), engine.heightAt(0, 0), 0.001);
    try std.testing.expectEqual(@as(usize, 1), redone.stats.undo);
}
