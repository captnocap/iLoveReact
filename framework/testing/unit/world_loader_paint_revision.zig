//! Whole-map invalidation contract for the split world loader.
//!
//! Run: zig build test-world-loader

const std = @import("std");
const paint_revision = @import("world_loader_paint_revision");

test "a new map revision releases every retained coordinate claim once" {
    var observed: u64 = 7;
    var used = [_]bool{ true, false, true, true };

    try std.testing.expect(paint_revision.reconcile(&observed, 8, used[0..]));
    try std.testing.expectEqual(@as(u64, 8), observed);
    try std.testing.expectEqualSlices(bool, &[_]bool{ false, false, false, false }, used[0..]);

    // Per-chunk work after the boundary remains live until another whole-map
    // replacement; ordinary frames must not repeatedly clear the cache.
    used[1] = true;
    try std.testing.expect(!paint_revision.reconcile(&observed, 8, used[0..]));
    try std.testing.expect(used[1]);

    try std.testing.expect(!paint_revision.resultIsCurrent(7, observed));
    try std.testing.expect(paint_revision.resultIsCurrent(8, observed));
}
