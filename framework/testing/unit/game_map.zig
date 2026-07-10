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
