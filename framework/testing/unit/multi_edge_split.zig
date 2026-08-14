const std = @import("std");
const testing = std.testing;
const indexed_edit_mesh = @import("indexed_edit_mesh");

const cube_corners = [8][3]f32{
    .{ -0.5, -0.5, -0.5 }, .{ 0.5, -0.5, -0.5 }, .{ 0.5, -0.5, 0.5 }, .{ -0.5, -0.5, 0.5 },
    .{ -0.5, 0.5, -0.5 },  .{ 0.5, 0.5, -0.5 },  .{ 0.5, 0.5, 0.5 },  .{ -0.5, 0.5, 0.5 },
};

fn cubeMesh() !indexed_edit_mesh.Mesh {
    const quads = [6][4]u32{
        .{ 4, 7, 6, 5 }, .{ 0, 1, 2, 3 }, .{ 0, 4, 5, 1 },
        .{ 3, 2, 6, 7 }, .{ 0, 3, 7, 4 }, .{ 1, 5, 6, 2 },
    };
    const quad_uvs = [4][2]f32{ .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } };
    var soup = [_]f32{0} ** (12 * 3 * 8);
    var groups: [12]u32 = undefined;
    var triangle: usize = 0;
    for (quads, 0..) |quad, group| {
        for ([2][3]u32{ .{ 0, 1, 2 }, .{ 0, 2, 3 } }) |split| {
            for (split, 0..) |quad_corner, output_corner| {
                const base = (triangle * 3 + output_corner) * 8;
                const position = cube_corners[quad[quad_corner]];
                @memcpy(soup[base .. base + 3], position[0..]);
                soup[base + 6] = quad_uvs[quad_corner][0];
                soup[base + 7] = quad_uvs[quad_corner][1];
            }
            groups[triangle] = @intCast(group);
            triangle += 1;
        }
    }
    const parts = [_]u32{7} ** 12;
    const materials = [_]u32{3} ** 12;
    return indexed_edit_mesh.Mesh.fromSoupWithMaterials(
        testing.allocator,
        soup[0..],
        12,
        groups[0..],
        parts[0..],
        materials[0..],
    );
}

fn samePoint(a: [3]f32, b: [3]f32) bool {
    return a[0] == b[0] and a[1] == b[1] and a[2] == b[2];
}

fn expectSplitGeometricEdge(mesh: *const indexed_edit_mesh.Mesh, positions: [2][3]f32) !void {
    var logical_edges = std.AutoHashMap(u64, u32).init(testing.allocator);
    defer logical_edges.deinit();
    for (mesh.faces.items) |face| {
        if (!face.alive) continue;
        for (face.vertices.items, 0..) |a, corner| {
            const b = face.vertices.items[(corner + 1) % face.vertices.items.len];
            const pa = mesh.vertices.items[a].position;
            const pb = mesh.vertices.items[b].position;
            const matches = (samePoint(pa, positions[0]) and samePoint(pb, positions[1])) or
                (samePoint(pa, positions[1]) and samePoint(pb, positions[0]));
            if (!matches) continue;
            const key = (@as(u64, @min(a, b)) << 32) | @as(u64, @max(a, b));
            const count = try logical_edges.getOrPut(key);
            if (!count.found_existing) count.value_ptr.* = 0;
            count.value_ptr.* += 1;
        }
    }
    try testing.expectEqual(@as(u32, 2), logical_edges.count());
    var counts = logical_edges.valueIterator();
    while (counts.next()) |count| try testing.expectEqual(@as(u32, 1), count.*);
}

fn expectPreservedRows(mesh: *const indexed_edit_mesh.Mesh) !void {
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try testing.expectEqual(@as(u32, 12), lowered.tri_count);
    for (lowered.parts) |part| try testing.expectEqual(@as(u32, 7), part);
    for (lowered.materials) |material| try testing.expectEqual(@as(u32, 3), material);
    var group_counts = [_]u32{0} ** 6;
    for (lowered.groups) |group| {
        try testing.expect(group < group_counts.len);
        group_counts[group] += 1;
    }
    for (group_counts) |count| try testing.expectEqual(@as(u32, 2), count);
}

test "adjacent selected edges split logical face fans without creating a part" {
    var mesh = try cubeMesh();
    defer mesh.deinit();
    const selected = [2][2][3]f32{
        .{ cube_corners[1], cube_corners[5] },
        .{ cube_corners[5], cube_corners[4] },
    };
    var edges: [selected.len][2]u32 = undefined;
    try testing.expect(mesh.resolveSplitEdges(selected[0..], 7, edges[0..]));
    try testing.expect(try mesh.splitEdges(edges[0..]));
    try expectSplitGeometricEdge(&mesh, selected[0]);
    try expectSplitGeometricEdge(&mesh, selected[1]);
    try expectPreservedRows(&mesh);
}

test "Select All splits every cube face but keeps one Outliner part" {
    var mesh = try cubeMesh();
    defer mesh.deinit();
    const selected = [12][2][3]f32{
        .{ cube_corners[0], cube_corners[1] }, .{ cube_corners[1], cube_corners[2] },
        .{ cube_corners[2], cube_corners[3] }, .{ cube_corners[3], cube_corners[0] },
        .{ cube_corners[4], cube_corners[5] }, .{ cube_corners[5], cube_corners[6] },
        .{ cube_corners[6], cube_corners[7] }, .{ cube_corners[7], cube_corners[4] },
        .{ cube_corners[0], cube_corners[4] }, .{ cube_corners[1], cube_corners[5] },
        .{ cube_corners[2], cube_corners[6] }, .{ cube_corners[3], cube_corners[7] },
    };
    var edges: [selected.len][2]u32 = undefined;
    try testing.expect(mesh.resolveSplitEdges(selected[0..], 7, edges[0..]));
    try testing.expect(try mesh.splitEdges(edges[0..]));
    try testing.expectEqual(@as(usize, 24), mesh.vertices.items.len);
    for (selected) |edge| try expectSplitGeometricEdge(&mesh, edge);
    try expectPreservedRows(&mesh);
}
