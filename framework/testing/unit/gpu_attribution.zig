const std = @import("std");
const testing = std.testing;
const gpu = @import("../../gpu/gpu.zig");

test "text attribution rolls frame trace and atlas misses into last-frame stats" {
    gpu.testingResetTextAttributionState();
    gpu.testingRecordTextTrace("hmsc-int", 13, 13);
    gpu.testingRecordTextTrace("hmsc-int", 13, 13);
    gpu.testingRecordTextTrace("phase\tA\nB", 10, 12);
    gpu.testingBumpTextAtlasMisses(7);

    gpu.testingResetTextFrame();

    try testing.expectEqual(@as(usize, 7), gpu.testingLastTextAtlasMissCount());
    const summary = gpu.testingLastTextTraceSummary();
    try testing.expect(std.mem.indexOf(u8, summary, "sz=13 font=0 n=2 bytes=8 text=\"hmsc-int\"") != null);
    try testing.expect(std.mem.indexOf(u8, summary, "sz=10 render=12 font=0 n=1 bytes=9 text=\"phase A B\"") != null);

    gpu.testingResetTextFrame();
    try testing.expectEqual(@as(usize, 0), gpu.testingLastTextAtlasMissCount());
    try testing.expectEqual(@as(usize, 0), gpu.testingLastTextTraceSummary().len);
}

test "static capture attribution reports key sample and primitive deltas" {
    var buffer: [256]u8 = undefined;
    const out = gpu.testingFormatStaticCaptureTrace(
        &buffer,
        "chrome-titlebar-static-surface",
        320,
        24,
        .{ .rects = 10, .glyphs = 20, .curves = 2, .capsules = 1, .polys = 4, .images = 3 },
        .{ .rects = 14, .glyphs = 29, .curves = 2, .capsules = 3, .polys = 7, .images = 4 },
    );

    try testing.expectEqualStrings(
        "#0 key=\"chrome-titlebar-static-surface\" 320x24 r4 g9 c0 cap2 p3 img1",
        out,
    );
}
