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

test "pen wire commits open paths as one zero-area triangle per segment" {
    const points = [_]f32{ 0.2, 0.2, 0.8, 0.2, 0.8, 0.8 };
    const camera = path_plane.Camera{ .eye = .{ 0, 0, 5 }, .target = .{ 0, 0, 0 }, .fov_deg = 50 };
    var wire = path_plane.buildWire(testing.allocator, &points, false, camera, 800, 600) orelse return error.TestUnexpectedResult;
    defer wire.deinit(testing.allocator);
    // 3 anchors, open → 2 segments → 2 render triangles, one shared authored group.
    try testing.expectEqual(@as(usize, 2), wire.groups.len);
    try testing.expectEqual(@as(usize, 2 * 3 * 8), wire.verts.len);
    for (wire.groups) |group| try testing.expectEqual(@as(u32, 0), group);
    var triangle: usize = 0;
    while (triangle < wire.verts.len / 24) : (triangle += 1) {
        const base = triangle * 24;
        // Corners b and c coincide: the triangle is pure edge, never a rasterized face.
        var attr: usize = 0;
        while (attr < 3) : (attr += 1) {
            try testing.expectEqual(wire.verts[base + 8 + attr], wire.verts[base + 16 + attr]);
        }
        // Every point still lies on the focus plane (z = 0 for this camera).
        try testing.expectApproxEqAbs(@as(f32, 0), wire.verts[base + 2], 1e-5);
        // The carried normal looks back at the authoring eye.
        try testing.expect(wire.verts[base + 5] > 0.99);
    }
}

test "pen wire closes the return segment and refuses degenerate input" {
    const points = [_]f32{ 0.25, 0.25, 0.75, 0.25, 0.5, 0.75 };
    const camera = path_plane.Camera{ .eye = .{ 0, 0, 5 }, .target = .{ 0, 0, 0 }, .fov_deg = 50 };
    var wire = path_plane.buildWire(testing.allocator, &points, true, camera, 800, 600) orelse return error.TestUnexpectedResult;
    defer wire.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 3), wire.groups.len);

    // A two-point closed loop would stack the same edge twice — refused.
    const two = [_]f32{ 0.25, 0.25, 0.75, 0.25 };
    try testing.expect(path_plane.buildWire(testing.allocator, &two, true, camera, 800, 600) == null);
    // A single point has no segment at all.
    const one = [_]f32{ 0.5, 0.5 };
    try testing.expect(path_plane.buildWire(testing.allocator, &one, false, camera, 800, 600) == null);
    // Consecutive duplicates collapse; an all-duplicate path commits nothing.
    const dupes = [_]f32{ 0.5, 0.5, 0.5, 0.5, 0.5, 0.5 };
    try testing.expect(path_plane.buildWire(testing.allocator, &dupes, false, camera, 800, 600) == null);
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
