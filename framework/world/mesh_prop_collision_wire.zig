//! MESH_PROPS v10 exact-collision payload decoder.
//!
//! The transport carries a triangle count followed by local-frame xyz triples.
//! Keeping this boundary separate makes malformed-count, truncation, and finite-
//! coordinate validation testable without pulling the renderer into unit tests.

const std = @import("std");

pub const Error = error{
    InvalidCollisionTriangles,
    OutOfMemory,
};

fn readF32(data: []const u8, at: usize) f32 {
    return @bitCast(std.mem.readInt(u32, data[at..][0..4], .little));
}

/// Decode `u32 triangleCount` + `triangleCount × 9 × f32` and advance `at`.
/// The returned xyz array is owned by `allocator`; zero triangles return `&.{}`.
pub fn decode(allocator: std.mem.Allocator, data: []const u8, at: *usize) Error![]f32 {
    if (at.* + 4 > data.len) return error.InvalidCollisionTriangles;
    const triangle_count: usize = @intCast(std.mem.readInt(u32, data[at.*..][0..4], .little));
    at.* += 4;
    if (triangle_count == 0) return &.{};
    const float_count = std.math.mul(usize, triangle_count, 9) catch return error.InvalidCollisionTriangles;
    const byte_count = std.math.mul(usize, float_count, @sizeOf(f32)) catch return error.InvalidCollisionTriangles;
    if (byte_count > data.len - at.*) return error.InvalidCollisionTriangles;

    const out = try allocator.alloc(f32, float_count);
    errdefer allocator.free(out);
    for (out, 0..) |*value, index| {
        value.* = readF32(data, at.* + index * @sizeOf(f32));
        if (!std.math.isFinite(value.*)) return error.InvalidCollisionTriangles;
    }
    at.* += byte_count;
    return out;
}
