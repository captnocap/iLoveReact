const std = @import("std");
const pose_stream = @import("pose_stream");

test "sparse pose targets interpolate across one observation interval" {
    var current = [_]f32{ 0, 0, 0, 0, 0, 0, 1, 1, 1 };
    const target = [_]f32{ 2, 4, 6, 20, 40, 60, 2, 3, 4 };
    var remaining = pose_stream.TARGET_INTERVAL_SECONDS;
    pose_stream.advance(&current, &target, &remaining, pose_stream.TARGET_INTERVAL_SECONDS / 2);
    try std.testing.expectApproxEqAbs(@as(f32, 1), current[0], 0.0001);
    try std.testing.expectApproxEqAbs(@as(f32, 30), current[5], 0.0001);
    try std.testing.expect(remaining > 0);
    pose_stream.advance(&current, &target, &remaining, pose_stream.TARGET_INTERVAL_SECONDS / 2);
    try std.testing.expectEqualSlices(f32, &target, &current);
    try std.testing.expectEqual(@as(f32, 0), remaining);
}

test "rotation interpolation takes the short path through the wrap" {
    var current = [_]f32{ 0, 0, 0, 170, 0, 0, 1, 1, 1 };
    const target = [_]f32{ 0, 0, 0, -170, 0, 0, 1, 1, 1 };
    var remaining = pose_stream.TARGET_INTERVAL_SECONDS;
    pose_stream.advance(&current, &target, &remaining, pose_stream.TARGET_INTERVAL_SECONDS / 2);
    try std.testing.expectApproxEqAbs(@as(f32, 180), current[3], 0.0001);
    pose_stream.advance(&current, &target, &remaining, pose_stream.TARGET_INTERVAL_SECONDS / 2);
    try std.testing.expectEqual(@as(f32, -170), current[3]);
}

test "mismatched rows fail closed without consuming time" {
    var current = [_]f32{ 1, 2 };
    const target = [_]f32{ 9 };
    var remaining = pose_stream.TARGET_INTERVAL_SECONDS;
    pose_stream.advance(&current, &target, &remaining, 0.02);
    try std.testing.expectEqualSlices(f32, &[_]f32{ 1, 2 }, &current);
    try std.testing.expectEqual(pose_stream.TARGET_INTERVAL_SECONDS, remaining);
}
