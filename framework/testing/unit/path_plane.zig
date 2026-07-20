//! Pen-path triangulation and camera-plane projection regressions.
//! Run: zig build test-path-plane

const std = @import("std");
const testing = std.testing;
const path_plane = @import("path_plane");

test "concave pen polygon triangulates without a convex fan shortcut" {
    const points = [_]f32{
        0, 0,
        1, 0,
        1, 0.4,
        0.4, 0.4,
        0.4, 1,
        0, 1,
    };
    const triangles = path_plane.triangulate(testing.allocator, &points) orelse return error.TestUnexpectedResult;
    defer testing.allocator.free(triangles);
    try testing.expectEqual(@as(usize, (points.len / 2 - 2) * 3), triangles.len);
    for (triangles) |index| try testing.expect(index < points.len / 2);
}

test "path plane lies on the orbit focus plane and faces the camera" {
    const points = [_]f32{ 0.25, 0.25, 0.75, 0.25, 0.65, 0.75, 0.35, 0.75 };
    const camera = path_plane.Camera{ .eye = .{ 0, 0, 5 }, .target = .{ 0, 0, 0 }, .fov_deg = 50 };
    var mesh = path_plane.build(testing.allocator, &points, camera, 800, 600) orelse return error.TestUnexpectedResult;
    defer mesh.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 2), mesh.groups.len);
    for (mesh.groups) |group| try testing.expectEqual(@as(u32, 0), group);
    var vertex: usize = 0;
    while (vertex < mesh.verts.len / 8) : (vertex += 1) {
        try testing.expectApproxEqAbs(@as(f32, 0), mesh.verts[vertex * 8 + 2], 1e-5);
        try testing.expect(mesh.verts[vertex * 8 + 5] > 0.99);
        try testing.expect(mesh.verts[vertex * 8 + 6] >= 0 and mesh.verts[vertex * 8 + 6] <= 1);
        try testing.expect(mesh.verts[vertex * 8 + 7] >= 0 and mesh.verts[vertex * 8 + 7] <= 1);
    }
}
