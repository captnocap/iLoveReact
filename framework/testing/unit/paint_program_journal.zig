//! Exact paint-program state carried by model UV/texture undo.
//! Run: zig build test-paint-program-journal

const std = @import("std");
const testing = std.testing;
const paint_program = @import("paint_program_root").paint_program;

test "journal state restores layers and the stroke history it replaced" {
    paint_program.reset();
    defer paint_program.reset();

    const second = paint_program.layerAdd();
    try testing.expect(second != 0);
    try testing.expect(paint_program.layerRename(second, "Ink"));
    try testing.expectEqual(@as(usize, 2), paint_program.layerCount());
    try testing.expectEqual([2]u32{ 1, 0 }, paint_program.historyCounts());

    const retained = paint_program.journalStateCapture() orelse return error.TestUnexpectedResult;
    try testing.expect(paint_program.journalStateBytes(retained) > 0);
    const restore = paint_program.journalStateClone(retained) orelse {
        paint_program.journalStateFree(retained);
        return error.TestUnexpectedResult;
    };
    paint_program.journalStateFree(retained);

    const third = paint_program.layerAdd();
    try testing.expect(third != 0);
    try testing.expect(paint_program.layerRename(third, "Discard me"));
    try testing.expectEqual(@as(usize, 3), paint_program.layerCount());
    try testing.expectEqual([2]u32{ 2, 0 }, paint_program.historyCounts());

    // Consumes the clone. No replay or allocator can fail after this boundary.
    paint_program.journalStateAdopt(restore);
    try testing.expectEqual(@as(usize, 2), paint_program.layerCount());
    try testing.expectEqualStrings("Ink", paint_program.layerInfoAt(1).name);
    try testing.expectEqual(second, paint_program.activeLayerId());
    try testing.expectEqual([2]u32{ 1, 0 }, paint_program.historyCounts());
    try testing.expectEqualStrings("add layer", paint_program.undoLabel());
}
