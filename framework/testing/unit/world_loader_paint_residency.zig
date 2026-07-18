//! Live painted-chunk residency contract.
//!
//! Run: zig build test-world-loader

const std = @import("std");
const residency = @import("world_loader_paint_residency");

test "nearest chunks replace distant residents independent of document order" {
    var slots: [2]residency.Candidate = undefined;
    var count: usize = 0;

    try std.testing.expectEqual(@as(?usize, 0), residency.offer(slots[0..], &count, residency.candidate(0, 0, 0, 0, .{ 950, 99 })));
    try std.testing.expectEqual(@as(?usize, 1), residency.offer(slots[0..], &count, residency.candidate(5, 3, 600, 360, .{ 950, 99 })));
    try std.testing.expect(residency.offer(slots[0..], &count, residency.candidate(8, 1, 960, 120, .{ 950, 99 })) != null);

    try std.testing.expectEqual(@as(usize, 2), count);
    try std.testing.expect(residency.contains(slots[0..count], .{ 8, 1 }));
    try std.testing.expect(residency.contains(slots[0..count], .{ 5, 3 }));
    try std.testing.expect(!residency.contains(slots[0..count], .{ 0, 0 }));
}

test "equal-distance selection has a stable coordinate tie break" {
    var slots: [1]residency.Candidate = undefined;
    var count: usize = 0;
    _ = residency.offer(slots[0..], &count, .{ .coord = .{ 2, 2 }, .distance_sq = 4 });
    try std.testing.expect(residency.offer(slots[0..], &count, .{ .coord = .{ 1, 2 }, .distance_sq = 4 }) != null);
    try std.testing.expectEqualSlices(i32, &[_]i32{ 1, 2 }, slots[0].coord[0..]);
}
