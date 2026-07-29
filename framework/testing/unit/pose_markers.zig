//! Behavior tests for framework/skeleton/pose_markers.zig.
//!
//! Run: zig build test-pose-markers

const std = @import("std");
const testing = std.testing;
const markers = @import("pose_markers");

test "wire ids decode fail-closed to the shared marker vocabulary" {
    try testing.expectEqual(markers.Kind.none, markers.decode(std.math.nan(f32)));
    try testing.expectEqual(markers.Kind.none, markers.decode(-1));
    try testing.expectEqual(markers.Kind.face, markers.decode(1));
    try testing.expectEqual(markers.Kind.upper, markers.decode(2));
    try testing.expectEqual(markers.Kind.leg, markers.decode(3));
    try testing.expectEqual(markers.Kind.none, markers.decode(99));
}

test "camera and model marker regions share the requested colors" {
    try testing.expectEqual([3]f32{ 0.91, 0.76, 0.30 }, markers.color(.face));
    try testing.expectEqual([3]f32{ 0.30, 0.79, 0.91 }, markers.color(.upper));
    try testing.expectEqual([3]f32{ 0.91, 0.53, 0.30 }, markers.color(.leg));
    try testing.expect(markers.Tuning.diameter_meters > 0);
}
