//! Editor-live emitted-light wire tests.
//! Run: tools/zig/zig test --dep live_lights \
//!   -Mroot=framework/testing/unit/world_live_lights.zig \
//!   -Mlive_lights=framework/world_loader/live_lights.zig

const std = @import("std");
const lights = @import("live_lights");

fn bytes(rows: []const f32) []const u8 {
    return std.mem.sliceAsBytes(rows);
}

test "live light wire decodes point and normalized spot rows" {
    const rows = [_]f32{
        0, 1, 2, 3, 0, 0, 0, 1, 0.5, 0, 2, 9, 32, 1,
        1, -1, 4, 5, 0, -2, 0, 0.2, 0.4, 0.6, 3, 12, 28, 1,
    };
    var out: [2]lights.Light = undefined;
    try std.testing.expectEqual(@as(usize, 2), lights.decode(bytes(&rows), &out));
    try std.testing.expectEqual(.point, out[0].kind);
    try std.testing.expect(!out[0].casts_shadow);
    try std.testing.expectEqual(.spot, out[1].kind);
    try std.testing.expectApproxEqAbs(@as(f32, -1), out[1].direction[1], 0.00001);
    try std.testing.expect(out[1].casts_shadow);
}

test "live light wire clamps hostile values and ignores an incomplete tail" {
    const rows = [_]f32{
        1, std.math.nan(f32), 2, 3, 0, 0, 0, -4, 2, std.math.inf(f32), 99, -3, 200, 1,
        7,
    };
    var out: [4]lights.Light = undefined;
    try std.testing.expectEqual(@as(usize, 1), lights.decode(bytes(&rows), &out));
    try std.testing.expectEqual(@as(f32, 0), out[0].position[0]);
    try std.testing.expectEqual([3]f32{ 0, -1, 0 }, out[0].direction);
    try std.testing.expectEqual([3]f32{ 0, 1, 1 }, out[0].color);
    try std.testing.expectEqual(@as(f32, 20), out[0].intensity);
    try std.testing.expectEqual(@as(f32, 0.1), out[0].range);
    try std.testing.expectEqual(@as(f32, 85), out[0].cone_degrees);
}
