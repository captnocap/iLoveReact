//! Engine-side tests for resident face-material UV expansion and selection.
//! Run: tools/zig/zig build test-world-mesh-prop-uv

const std = @import("std");
const mesh_prop_uv = @import("world_mesh_prop_uv");

test "assigned material gets face UVs while paint view remains unchanged" {
    const allocator = std.testing.allocator;
    const base = [_]f32{
        0, 0, 0, 0, 0, 1, 0.25, 0.75,
        1, 0, 0, 0, 0, 1, 0.25, 0.75,
        0, 1, 0, 0, 0, 1, 0.25, 0.75,
    };
    const face_uvs = [_]f32{ 0, 1, 1, 1, 0, 0 };
    const bytes = std.mem.sliceAsBytes(face_uvs[0..]);
    const material = try mesh_prop_uv.expand(allocator, base[0..], 3, bytes);
    defer allocator.free(material);

    try std.testing.expectEqual(@as(f32, 0.25), base[6]);
    try std.testing.expectEqual(@as(f32, 0.75), base[7]);
    try std.testing.expectEqual(@as(f32, 0), material[6]);
    try std.testing.expectEqual(@as(f32, 1), material[7]);
    try std.testing.expect(mesh_prop_uv.verticesForOverride(base[0..], material, false).ptr == base[0..].ptr);
    try std.testing.expect(mesh_prop_uv.verticesForOverride(base[0..], material, true).ptr == material.ptr);
}

test "partial material UV payload is rejected" {
    const base = [_]f32{0} ** 24;
    const partial = [_]u8{0} ** 8;
    try std.testing.expectError(error.InvalidUvCount, mesh_prop_uv.expand(std.testing.allocator, base[0..], 3, partial[0..]));
}
