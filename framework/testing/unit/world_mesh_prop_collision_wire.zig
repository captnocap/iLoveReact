//! Engine-side tests for the MESH_PROPS v10 exact-collision payload.
//! Run: tools/zig/zig build test-world-mesh-prop-collision-wire

const std = @import("std");
const wire = @import("world_mesh_prop_collision_wire");

fn writeF32(out: []u8, at: usize, value: f32) void {
    std.mem.writeInt(u32, out[at..][0..4], @bitCast(value), .little);
}

test "exact collision triangle payload decodes finite xyz corners" {
    var bytes = [_]u8{0} ** (4 + 9 * 4);
    std.mem.writeInt(u32, bytes[0..4], 1, .little);
    const values = [_]f32{ 0, 0.5, 4, 1, 0.5, 4, 1, 6.8, 2.7 };
    for (values, 0..) |value, index| writeF32(bytes[0..], 4 + index * 4, value);

    var at: usize = 0;
    const decoded = try wire.decode(std.testing.allocator, bytes[0..], &at);
    defer std.testing.allocator.free(decoded);
    try std.testing.expectEqual(values.len, decoded.len);
    try std.testing.expectEqual(bytes.len, at);
    try std.testing.expectEqualSlices(f32, values[0..], decoded);
}

test "exact collision triangle payload rejects truncation and non-finite coordinates" {
    var truncated = [_]u8{0} ** 8;
    std.mem.writeInt(u32, truncated[0..4], 1, .little);
    var at: usize = 0;
    try std.testing.expectError(error.InvalidCollisionTriangles, wire.decode(std.testing.allocator, truncated[0..], &at));

    var non_finite = [_]u8{0} ** (4 + 9 * 4);
    std.mem.writeInt(u32, non_finite[0..4], 1, .little);
    writeF32(non_finite[0..], 4, std.math.nan(f32));
    at = 0;
    try std.testing.expectError(error.InvalidCollisionTriangles, wire.decode(std.testing.allocator, non_finite[0..], &at));
}
