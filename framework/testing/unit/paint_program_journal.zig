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
    try testing.expect(paint_program.layerRename(second, "Live rename"));
    try testing.expect(paint_program.layerSetActive(second));
    try testing.expectEqual(@as(usize, 3), paint_program.layerCount());
    try testing.expectEqual([2]u32{ 2, 0 }, paint_program.historyCounts());

    // Consumes the clone. No replay or allocator can fail after this boundary.
    paint_program.journalStateAdopt(restore);
    try testing.expectEqual(@as(usize, 2), paint_program.layerCount());
    try testing.expectEqualStrings("Live rename", paint_program.layerInfoAt(1).name);
    try testing.expectEqual(second, paint_program.activeLayerId());
    try testing.expectEqual([2]u32{ 1, 0 }, paint_program.historyCounts());
    try testing.expectEqualStrings("add layer", paint_program.undoLabel());
}

test "history swaps retain paint redo while a new UV action abandons the old branch" {
    paint_program.reset();
    defer paint_program.reset();
    var environ = try std.testing.environ.createMap(std.testing.allocator);
    defer environ.deinit();

    try testing.expect(paint_program.layerAdd() != 0);
    try testing.expect(paint_program.undoStroke(std.testing.io, &environ));
    try testing.expectEqual([2]u32{ 0, 1 }, paint_program.historyCounts());

    const swap_state = paint_program.journalStateCapture() orelse return error.TestUnexpectedResult;
    const swap_restore = paint_program.journalStateClone(swap_state) orelse {
        paint_program.journalStateFree(swap_state);
        return error.TestUnexpectedResult;
    };
    paint_program.journalStateFree(swap_state);
    try testing.expectEqual([2]u32{ 0, 1 }, paint_program.historyCounts());

    // A mesh-journal swap retains paint units undone after the UV step, so redoing UV
    // can expose those paint redos in the correct order afterward.
    try testing.expect(paint_program.layerAdd() != 0);
    paint_program.journalStateAdopt(swap_restore);
    try testing.expectEqual([2]u32{ 0, 1 }, paint_program.historyCounts());

    const new_action_state = paint_program.journalStateCaptureForNewAction() orelse return error.TestUnexpectedResult;
    const new_action_restore = paint_program.journalStateClone(new_action_state) orelse {
        paint_program.journalStateFree(new_action_state);
        return error.TestUnexpectedResult;
    };
    paint_program.journalStateFree(new_action_state);
    try testing.expect(paint_program.layerAdd() != 0);
    paint_program.journalStateAdopt(new_action_restore);
    try testing.expectEqual([2]u32{ 0, 0 }, paint_program.historyCounts());
}

test "selection fills commit as one durable paint-program unit" {
    paint_program.reset();
    defer paint_program.reset();

    paint_program.beginRecordedOp();
    paint_program.recordFill(3, false, .{ 10, 20, 30 });
    paint_program.recordFill(7, false, .{ 10, 20, 30 });
    try testing.expect(paint_program.endStrokeUnit());
    try testing.expect(!paint_program.isEmpty());
    try testing.expectEqual([2]u32{ 1, 0 }, paint_program.historyCounts());
    try testing.expectEqualStrings("fill", paint_program.undoLabel());

    const blob = paint_program.serialize() orelse return error.TestUnexpectedResult;
    defer std.heap.c_allocator.free(blob);
    try testing.expect(blob.len > 8);
    try testing.expect(paint_program.programDetail(blob) != null);
}
