const std = @import("std");
const testing = std.testing;
const indexed_edit_mesh = @import("indexed_edit_mesh");

const cube_corners = [8][3]f32{
    .{ -0.5, -0.5, -0.5 }, .{ 0.5, -0.5, -0.5 }, .{ 0.5, -0.5, 0.5 }, .{ -0.5, -0.5, 0.5 },
    .{ -0.5, 0.5, -0.5 },  .{ 0.5, 0.5, -0.5 },  .{ 0.5, 0.5, 0.5 },  .{ -0.5, 0.5, 0.5 },
};

fn cubeSoup(out: []f32) void {
    const quads = [6][4]u32{
        .{ 4, 7, 6, 5 }, .{ 0, 1, 2, 3 }, .{ 0, 4, 5, 1 },
        .{ 3, 2, 6, 7 }, .{ 0, 3, 7, 4 }, .{ 1, 5, 6, 2 },
    };
    const quad_uvs = [4][2]f32{ .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } };
    var triangle: usize = 0;
    for (quads) |quad| {
        for ([2][3]u32{ .{ 0, 1, 2 }, .{ 0, 2, 3 } }) |split| {
            for (split, 0..) |quad_corner, output_corner| {
                const base = (triangle * 3 + output_corner) * 8;
                const position = cube_corners[quad[quad_corner]];
                @memcpy(out[base .. base + 3], position[0..]);
                out[base + 6] = quad_uvs[quad_corner][0];
                out[base + 7] = quad_uvs[quad_corner][1];
            }
            triangle += 1;
        }
    }
}

fn cubeMesh() !indexed_edit_mesh.Mesh {
    var soup = [_]f32{0} ** (12 * 3 * 8);
    cubeSoup(soup[0..]);
    const groups = [_]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
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

fn expectDurableLowering(lowered: *const indexed_edit_mesh.Lowered, expected_triangles: u32) !void {
    try testing.expectEqual(expected_triangles, lowered.tri_count);
    for (lowered.parts) |part| try testing.expectEqual(@as(u32, 7), part);
    for (lowered.materials) |material| try testing.expectEqual(@as(u32, 3), material);
    var triangle: u32 = 0;
    while (triangle < lowered.tri_count) : (triangle += 1) {
        const base = @as(usize, triangle) * 9;
        const a = [3]f32{ lowered.positions[base], lowered.positions[base + 1], lowered.positions[base + 2] };
        const b = [3]f32{ lowered.positions[base + 3], lowered.positions[base + 4], lowered.positions[base + 5] };
        const c = [3]f32{ lowered.positions[base + 6], lowered.positions[base + 7], lowered.positions[base + 8] };
        const ab = [3]f32{ b[0] - a[0], b[1] - a[1], b[2] - a[2] };
        const ac = [3]f32{ c[0] - a[0], c[1] - a[1], c[2] - a[2] };
        const cross = [3]f32{
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        };
        const area_squared = cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2];
        try testing.expect(area_squared > indexed_edit_mesh.IMPORT_WELD_EPS * indexed_edit_mesh.IMPORT_WELD_EPS);
    }
}

const PointKey = [3]u32;
const GeometricEdgeKey = struct { a: PointKey, b: PointKey };

fn pointKey(position: [3]f32) PointKey {
    return .{ @bitCast(position[0]), @bitCast(position[1]), @bitCast(position[2]) };
}

fn pointLessThan(left: PointKey, right: PointKey) bool {
    for (left, right) |lhs, rhs| {
        if (lhs != rhs) return lhs < rhs;
    }
    return false;
}

fn expectWatertight(lowered: *const indexed_edit_mesh.Lowered) !void {
    var incidence = std.AutoHashMap(GeometricEdgeKey, u32).init(testing.allocator);
    defer incidence.deinit();
    var triangle: u32 = 0;
    while (triangle < lowered.tri_count) : (triangle += 1) {
        const base = @as(usize, triangle) * 9;
        const points = [3]PointKey{
            pointKey(.{ lowered.positions[base], lowered.positions[base + 1], lowered.positions[base + 2] }),
            pointKey(.{ lowered.positions[base + 3], lowered.positions[base + 4], lowered.positions[base + 5] }),
            pointKey(.{ lowered.positions[base + 6], lowered.positions[base + 7], lowered.positions[base + 8] }),
        };
        for ([3][2]u32{ .{ 0, 1 }, .{ 1, 2 }, .{ 2, 0 } }) |edge| {
            const first = points[edge[0]];
            const second = points[edge[1]];
            const key: GeometricEdgeKey = if (pointLessThan(first, second))
                .{ .a = first, .b = second }
            else
                .{ .a = second, .b = first };
            const count = try incidence.getOrPut(key);
            if (!count.found_existing) count.value_ptr.* = 0;
            count.value_ptr.* += 1;
        }
    }
    var key_iterator = incidence.iterator();
    while (key_iterator.next()) |entry| {
        try testing.expectEqual(@as(u32, 2), entry.value_ptr.*);
    }
}

test "two adjacent cube edges join through one clean corner" {
    var mesh = try cubeMesh();
    defer mesh.deinit();
    const selected = [2][2][3]f32{
        .{ cube_corners[1], cube_corners[5] },
        .{ cube_corners[5], cube_corners[4] },
    };
    var edges: [selected.len][2]u32 = undefined;
    const resolved = mesh.resolveBevelEdges(selected[0..], 7, edges[0..]) orelse
        return error.ExpectedAdjacentManifoldEdges;
    try testing.expectApproxEqAbs(indexed_edit_mesh.BevelTuning.vertex_edge_fraction, resolved.max_width, 0.00001);
    try testing.expect(try mesh.bevelEdges(edges[0..], indexed_edit_mesh.BevelTuning.default_width_m));
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try expectDurableLowering(&lowered, 18);
    try expectWatertight(&lowered);
}

test "Select All bevels every cube edge as one watertight operation" {
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
    _ = mesh.resolveBevelEdges(selected[0..], 7, edges[0..]) orelse
        return error.ExpectedWholeCubeEdgeSet;
    try testing.expect(try mesh.bevelEdges(edges[0..], indexed_edit_mesh.BevelTuning.default_width_m));
    var lowered = try mesh.lower();
    defer lowered.deinit();
    try expectDurableLowering(&lowered, 44);
    try expectWatertight(&lowered);
}
