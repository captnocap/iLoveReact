//! Focused regressions for the native mesh-edit boundary contract.
//! Run: zig build test-mesh-edit

const std = @import("std");
const testing = std.testing;
const mesh_edit = @import("mesh_edit");
const indexed_edit_mesh = @import("indexed_edit_mesh");

test "meshdoc range table must exactly match the declared Outliner count" {
    const healthy = [_]u32{ 0, 4, 4, 9, 12, 15 };
    try testing.expect(mesh_edit.partRangesValid(healthy[0..], 3));
    try testing.expect(!mesh_edit.partRangesValid(healthy[0..], 1));
    try testing.expect(!mesh_edit.partRangesValid(null, 3));
    const overlap = [_]u32{ 0, 5, 4, 9 };
    try testing.expect(!mesh_edit.partRangesValid(overlap[0..], 2));
    const empty = [_]u32{ 0, 0 };
    try testing.expect(!mesh_edit.partRangesValid(empty[0..], 1));
}

test "flipping selected winding reverses the normal and keeps corner UVs attached" {
    var verts = [_]f32{
        // Selected triangle: +Z winding, distinct UVs on every corner.
        0, 0, 0, 0.25, 0.5, 0.75, 0.1, 0.2,
        1, 0, 0, 0.25, 0.5, 0.75, 0.3, 0.4,
        0, 1, 0, 0.25, 0.5, 0.75, 0.5, 0.6,
        // Unselected control triangle.
        2, 0, 0, 0.2,  0.4, 0.8,  0.7, 0.1,
        3, 0, 0, 0.2,  0.4, 0.8,  0.8, 0.2,
        2, 1, 0, 0.2,  0.4, 0.8,  0.9, 0.3,
    };
    const original = verts;

    try testing.expectEqual(@as(u32, 1), mesh_edit.flipSelectedTriangleWinding(verts[0..], 2, &.{ true, false }));

    // a stays first; c and b swap as complete rows, including their UV pair.
    try testing.expectEqualSlices(f32, &.{ 0, 0, 0 }, verts[0..3]);
    try testing.expectEqualSlices(f32, &.{ 0, 1, 0 }, verts[8..11]);
    try testing.expectEqualSlices(f32, &.{ 0.5, 0.6 }, verts[14..16]);
    try testing.expectEqualSlices(f32, &.{ 1, 0, 0 }, verts[16..19]);
    try testing.expectEqualSlices(f32, &.{ 0.3, 0.4 }, verts[22..24]);
    try testing.expectEqualSlices(f32, &.{ -0.25, -0.5, -0.75 }, verts[3..6]);

    // The unselected triangle is byte-for-byte untouched, and flipping twice is an
    // involution: useful for both the user's correction and undo/redo confidence.
    try testing.expectEqualSlices(f32, original[24..], verts[24..]);
    try testing.expectEqual(@as(u32, 1), mesh_edit.flipSelectedTriangleWinding(verts[0..], 2, &.{ true, false }));
    try testing.expectEqualSlices(f32, original[0..], verts[0..]);
}

test "flipping winding rejects an undersized boundary without partial writes" {
    var verts = [_]f32{0} ** 24;
    const original = verts;
    try testing.expectEqual(@as(u32, 0), mesh_edit.flipSelectedTriangleWinding(verts[0..], 2, &.{ true, true }));
    try testing.expectEqualSlices(f32, original[0..], verts[0..]);
}

test "created grouped face becomes the one active face ready to flip" {
    var soup = [_]f32{0} ** (9 * 8); // one old triangle + a new split quad
    mesh_edit.test_support.loadGroupedSoup(2921, soup[0..], 9, &.{ 3, 8, 8 });
    defer mesh_edit.test_support.clear();

    try testing.expectEqual(@as(u32, 1), mesh_edit.focusCreatedFace(1, 2));
    try testing.expectEqual(mesh_edit.Mode.face, mesh_edit.mode());
    try testing.expectEqual(@as(u32, 1), mesh_edit.selCount()); // authored face, not two triangles
    var mask = [_]bool{ false, false, false };
    try testing.expectEqual(@as(u32, 2), mesh_edit.buildDeleteMask(mask[0..]));
    try testing.expectEqualSlices(bool, &.{ false, true, true }, mask[0..]);
}

test "created ungrouped quad focuses both appended triangles" {
    var soup = [_]f32{0} ** (9 * 8);
    const loose = std.math.maxInt(u32);
    mesh_edit.test_support.loadGroupedSoup(2922, soup[0..], 9, &.{ loose, loose, loose });
    defer mesh_edit.test_support.clear();

    try testing.expectEqual(@as(u32, 2), mesh_edit.focusCreatedFace(1, 2));
    try testing.expectEqual(mesh_edit.Mode.face, mesh_edit.mode());
    var mask = [_]bool{ false, false, false };
    try testing.expectEqual(@as(u32, 2), mesh_edit.buildDeleteMask(mask[0..]));
    try testing.expectEqualSlices(bool, &.{ false, true, true }, mask[0..]);
}

test "exact uniform scale multiplies the selection frame around a stable pivot" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 1, 0,
        0, 2, 0, 0, 0, 1, 0, 1,
    };
    mesh_edit.test_support.loadGroupedSoup(2930, soup[0..], 3, &.{0});
    defer mesh_edit.test_support.clear();
    mesh_edit.setMode(.face);
    try testing.expect(mesh_edit.selectFaceByIndex(0, false));

    const before = mesh_edit.selectionFrame().?;
    const mutation = mesh_edit.scaleSelectionUniform(before.center, 48);
    try testing.expect(mutation.changed);
    const after = mesh_edit.selectionFrame().?;
    inline for (0..3) |axis| try testing.expectApproxEqAbs(before.center[axis], after.center[axis], 0.0001);
    try testing.expectApproxEqAbs(before.radius * 48, after.radius, 0.001);

    // A factor of one is an explicit no-op, not a phantom undo candidate.
    try testing.expect(!mesh_edit.scaleSelectionUniform(after.center, 1).changed);
}

test "merging authored faces dissolves their shared selectable edge (req_2871)" {
    // Two side-by-side quads, each represented by two render triangles. Before the
    // merge there are seven authored boundary segments: the six-segment outer rim plus
    // the vertical seam between the two faces. The fan diagonals are already internal.
    var soup = [_]f32{
        // Left quad: (0,0) → (1,0) → (1,1) → (0,1).
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
        // Right quad: (1,0) → (2,0) → (2,1) → (1,1).
        1, 0, 0, 0, 0, 1, 0, 0,
        2, 0, 0, 0, 0, 1, 0, 0,
        2, 1, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        2, 1, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
    };

    mesh_edit.test_support.loadGroupedSoup(2871, soup[0..], 12, &.{ 0, 0, 1, 1 });
    defer mesh_edit.test_support.clear();
    try testing.expect(mesh_edit.ensureTopologyPub());
    try testing.expectEqual(@as(u32, 9), mesh_edit.edgeCount());
    try testing.expectEqual(@as(u32, 7), mesh_edit.boundaryEdgeCount());

    // This is the group-only mutation performed by meshMergeSelectedFaces. Triangle
    // count and render triangulation stay unchanged; the authored topology does not.
    mesh_edit.test_support.regroup(&.{ 0, 0, 0, 0 });
    try testing.expect(mesh_edit.ensureTopologyPub());
    try testing.expectEqual(@as(u32, 9), mesh_edit.edgeCount());
    try testing.expectEqual(@as(u32, 6), mesh_edit.boundaryEdgeCount());
}

test "dissolving an irregular four-quad grid drops seam verts and rebuilds a clean quad" {
    // A sheared/transformed plane, not the unit-cube convenience case.  The four
    // selected authored quads contain nine welded vertices and twelve visible edge
    // runs before dissolve; the clean outer boundary is four corners / four runs.
    const p = [_][3]f32{
        .{ 3, -2, 5 },     .{ 5, -1, 5.5 },   .{ 7, 0, 6 },
        .{ 2.5, 1, 5.25 }, .{ 4.5, 2, 5.75 }, .{ 6.5, 3, 6.25 },
        .{ 2, 4, 5.5 },    .{ 4, 5, 6 },      .{ 6, 6, 6.5 },
    };
    var pos: [8 * 9]f32 = undefined;
    const Emit = struct {
        fn tri(out: []f32, n: *usize, a: [3]f32, b: [3]f32, c: [3]f32) void {
            for ([_][3]f32{ a, b, c }) |v| {
                out[n.*] = v[0];
                out[n.* + 1] = v[1];
                out[n.* + 2] = v[2];
                n.* += 3;
            }
        }
    };
    var n: usize = 0;
    for ([_][4]usize{ .{ 0, 1, 4, 3 }, .{ 1, 2, 5, 4 }, .{ 3, 4, 7, 6 }, .{ 4, 5, 8, 7 } }) |q| {
        Emit.tri(pos[0..], &n, p[q[0]], p[q[1]], p[q[2]]);
        Emit.tri(pos[0..], &n, p[q[0]], p[q[2]], p[q[3]]);
    }
    var soup: [8 * 3 * 8]f32 = @splat(0);
    var vertex: usize = 0;
    while (vertex < 8 * 3) : (vertex += 1) {
        @memcpy(soup[vertex * 8 .. vertex * 8 + 3], pos[vertex * 3 .. vertex * 3 + 3]);
    }
    const groups = [_]u32{ 10, 10, 11, 11, 12, 12, 13, 13 };
    const selected = [_]bool{true} ** 8;
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 8, groups[0..], null);
    defer indexed.deinit();
    try testing.expect(try indexed.mergeSelected(selected[0..]));
    var lowered = try indexed.lower();
    defer lowered.deinit();
    try testing.expectEqual(@as(u32, 2), lowered.tri_count);
    try testing.expectEqualSlices(u32, &.{ 10, 10 }, lowered.groups);
    try testing.expectEqual(@as(usize, 4), indexed.faces.items[0].vertices.items.len);
}

test "twelve sided cylinder keeps all authored rim and side edges (req_2953/req_2954)" {
    // Exact topology emitted by editMeshToGeometry(cylinder(..., 12)):
    // 12 side quads (two triangles/group), then 24 real cap triangles around
    // explicit center vertices, matching js-bench-editor's primitive (req_3230).
    // Quad render diagonals are still derived; cap spokes are authored edges.
    const segments: usize = 12;
    const triangle_count: usize = segments * 4;
    var soup = [_]f32{0} ** (triangle_count * 3 * 8);
    var groups: [triangle_count]u32 = undefined;
    var bottom: [segments][3]f32 = undefined;
    var top: [segments][3]f32 = undefined;

    for (0..segments) |i| {
        const angle = @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(segments)) * 2.0 * std.math.pi;
        const x = @cos(angle) * 0.5;
        const z = @sin(angle) * 0.5;
        bottom[i] = .{ x, 0.0, z };
        top[i] = .{ x, 1.0, z };
    }

    const Emit = struct {
        fn triangle(out: []f32, rows: []u32, triangle_index: *usize, group: u32, a: [3]f32, b: [3]f32, c: [3]f32) void {
            const points = [_][3]f32{ a, b, c };
            for (points, 0..) |point, corner| {
                const base = (triangle_index.* * 3 + corner) * 8;
                out[base + 0] = point[0];
                out[base + 1] = point[1];
                out[base + 2] = point[2];
            }
            rows[triangle_index.*] = group;
            triangle_index.* += 1;
        }
    };

    var triangle_index: usize = 0;
    for (0..segments) |i| {
        const next = (i + 1) % segments;
        Emit.triangle(soup[0..], groups[0..], &triangle_index, @intCast(i), bottom[i], top[i], top[next]);
        Emit.triangle(soup[0..], groups[0..], &triangle_index, @intCast(i), bottom[i], top[next], bottom[next]);
    }
    for (0..segments) |i| {
        const next = (i + 1) % segments;
        Emit.triangle(soup[0..], groups[0..], &triangle_index, @intCast(segments + i * 2), top[i], .{ 0, 1, 0 }, top[next]);
        Emit.triangle(soup[0..], groups[0..], &triangle_index, @intCast(segments + i * 2 + 1), bottom[i], bottom[next], .{ 0, 0, 0 });
    }
    try testing.expectEqual(triangle_count, triangle_index);

    mesh_edit.test_support.loadGroupedSoup(2953, soup[0..], @intCast(triangle_count * 3), groups[0..]);
    defer mesh_edit.test_support.clear();
    try testing.expect(mesh_edit.ensureTopologyPub());
    try testing.expectEqual(@as(u32, 26), mesh_edit.vertCount());
    try testing.expectEqual(@as(u32, 72), mesh_edit.edgeCount());
    try testing.expectEqual(@as(u32, 60), mesh_edit.boundaryEdgeCount());

    // The user's seven-line screenshot is precisely a stale [0,2) part scope:
    // two adjacent quads contribute two top + two bottom + three vertical edges.
    mesh_edit.setEditScope(0, 2);
    var scoped_edges: u32 = 0;
    for (0..mesh_edit.edgeCount()) |edge| {
        const index: u32 = @intCast(edge);
        if (mesh_edit.edgeIsBoundaryPub(index) and mesh_edit.edgeInScopePub(index)) scoped_edges += 1;
    }
    try testing.expectEqual(@as(u32, 7), scoped_edges);

    // Loading a different document must not inherit that old part's range.
    mesh_edit.resetForModelLoad();
    try testing.expect(mesh_edit.ensureTopologyPub());
    var fresh_edges: u32 = 0;
    for (0..mesh_edit.edgeCount()) |edge| {
        const index: u32 = @intCast(edge);
        if (mesh_edit.edgeIsBoundaryPub(index) and mesh_edit.edgeInScopePub(index)) fresh_edges += 1;
    }
    try testing.expectEqual(@as(u32, 60), fresh_edges);

    var internal_edge: ?u32 = null;
    for (0..mesh_edit.edgeCount()) |edge| {
        const index: u32 = @intCast(edge);
        if (!mesh_edit.edgeIsBoundaryPub(index)) {
            internal_edge = index;
            break;
        }
    }
    try testing.expect(internal_edge != null);
    try testing.expect(!mesh_edit.selectEdgeByIndex(internal_edge.?, false));
}

test "face RGBA inheritance follows indexed lowering provenance" {
    const dark = [_]u8{ 12, 16, 24, 255 };
    const grey = [_]u8{ 154, 163, 173, 255 };
    const source = dark ++ grey;
    const parents = [_]u32{ 0, 1, 0 };
    var inherited: [12]u8 = undefined;
    try testing.expect(mesh_edit.inheritFaceRgba(source[0..], parents[0..], inherited[0..]));
    try testing.expectEqualSlices(u8, dark[0..], inherited[0..4]);
    try testing.expectEqualSlices(u8, grey[0..], inherited[4..8]);
    try testing.expectEqualSlices(u8, dark[0..], inherited[8..12]);

    const before = inherited;
    try testing.expect(!mesh_edit.inheritFaceRgba(source[0..], &.{ 0, 2, 0 }, inherited[0..]));
    try testing.expectEqualSlices(u8, before[0..], inherited[0..]);
}

test "symmetrize is bounded by the focused outliner part" {
    const focused = [4][3]f32{
        .{ -1, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 1, 0 }, .{ -1, 1, 0 },
    };
    const control = [4][3]f32{
        .{ 10, 3, 0 }, .{ 12, 3, 0 }, .{ 12, 5, 0 }, .{ 10, 5, 0 },
    };
    var soup = [_]f32{0} ** (4 * 3 * 8);
    const Emit = struct {
        fn triangle(out: []f32, triangle_index: usize, a: [3]f32, b: [3]f32, c: [3]f32) void {
            for ([_][3]f32{ a, b, c }, 0..) |position, corner| {
                const base = (triangle_index * 3 + corner) * 8;
                @memcpy(out[base .. base + 3], position[0..]);
            }
        }
    };
    Emit.triangle(soup[0..], 0, focused[0], focused[1], focused[2]);
    Emit.triangle(soup[0..], 1, focused[0], focused[2], focused[3]);
    Emit.triangle(soup[0..], 2, control[0], control[1], control[2]);
    Emit.triangle(soup[0..], 3, control[0], control[2], control[3]);
    const groups = [_]u32{ 0, 0, 1, 1 };
    const parts = [_]u32{ 0, 0, 1, 1 };
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 4, groups[0..], parts[0..]);
    defer indexed.deinit();
    var before: [4][3]f32 = undefined;
    for (indexed.faces.items[1].vertices.items, 0..) |vertex_id, corner| {
        before[corner] = indexed.vertices.items[vertex_id].position;
    }

    try testing.expect(try indexed.symmetrizeParts(0, true, &.{ true, false }));
    try testing.expect(indexed.faces.items[1].alive);
    for (indexed.faces.items[1].vertices.items, 0..) |vertex_id, corner| {
        try testing.expectEqual(before[corner], indexed.vertices.items[vertex_id].position);
    }
    var control_faces: u32 = 0;
    for (indexed.faces.items) |face| if (face.alive and face.part == 1) {
        control_faces += 1;
    };
    try testing.expectEqual(@as(u32, 1), control_faces);
}

test "solidify offsets a triangulated cube by authored planes, not diagonal incidence" {
    const corners = [8][3]f32{
        .{ -0.5, -0.5, -0.5 }, .{ 0.5, -0.5, -0.5 }, .{ 0.5, -0.5, 0.5 }, .{ -0.5, -0.5, 0.5 },
        .{ -0.5, 0.5, -0.5 },  .{ 0.5, 0.5, -0.5 },  .{ 0.5, 0.5, 0.5 },  .{ -0.5, 0.5, 0.5 },
    };
    const quads = [6][4]u32{
        .{ 4, 7, 6, 5 }, .{ 0, 1, 2, 3 }, .{ 0, 4, 5, 1 },
        .{ 3, 2, 6, 7 }, .{ 0, 3, 7, 4 }, .{ 1, 5, 6, 2 },
    };
    var triangles: [12]mesh_edit.SolidifyTriangle = undefined;
    var face: u32 = 0;
    for (quads, 0..) |quad, group| {
        const split = [2][3]u32{
            .{ quad[0], quad[1], quad[2] },
            .{ quad[0], quad[2], quad[3] },
        };
        for (split) |triangle| {
            triangles[face] = .{
                .face = face,
                .group = @intCast(group),
                .corners = triangle,
                .positions = .{ corners[triangle[0]], corners[triangle[1]], corners[triangle[2]] },
            };
            face += 1;
        }
    }

    const thickness: f32 = 0.125;
    var offsets = try mesh_edit.solidifyOffsets(testing.allocator, triangles[0..], thickness);
    defer offsets.deinit();

    for (corners, 0..) |position, vertex| {
        const expected = [3]f32{
            if (position[0] < 0) thickness else -thickness,
            if (position[1] < 0) thickness else -thickness,
            if (position[2] < 0) thickness else -thickness,
        };
        const actual = offsets.get(@intCast(vertex));
        inline for (0..3) |axis| try testing.expectApproxEqAbs(expected[axis], actual[axis], 0.00001);
    }
}

test "solidify keeps a triangulated planar panel parallel at exact thickness" {
    const triangles = [2]mesh_edit.SolidifyTriangle{
        .{
            .face = 0,
            .group = 42,
            .corners = .{ 0, 1, 2 },
            .positions = .{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 } },
        },
        .{
            .face = 1,
            .group = 42,
            .corners = .{ 0, 2, 3 },
            .positions = .{ .{ 0, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } },
        },
    };
    var offsets = try mesh_edit.solidifyOffsets(testing.allocator, triangles[0..], 0.2);
    defer offsets.deinit();
    var vertex: u32 = 0;
    while (vertex < 4) : (vertex += 1) {
        const actual = offsets.get(vertex);
        try testing.expectApproxEqAbs(@as(f32, 0), actual[0], 0.00001);
        try testing.expectApproxEqAbs(@as(f32, 0), actual[1], 0.00001);
        try testing.expectApproxEqAbs(@as(f32, -0.2), actual[2], 0.00001);
    }
}

// Keep the mesh module's co-located lower-level tests in this unit target too.
test {
    std.testing.refAllDecls(mesh_edit);
}
