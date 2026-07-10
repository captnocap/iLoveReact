//! Focused regressions for the native mesh-edit boundary contract.
//! Run: zig build test-mesh-edit

const std = @import("std");
const testing = std.testing;
const mesh_edit = @import("mesh_edit");

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

test "masked plane cut cannot cross an outliner part boundary (req_2899)" {
    // Two coincident quads represent separate outliner parts. Both cross x=1, but only
    // the first part is inside the edit scope. The scoped cut must split that quad while
    // leaving the second quad's two triangles and authored group completely untouched.
    const quad = [_]f32{
        0, 0, 0, 2, 0, 0, 2, 2, 0,
        0, 0, 0, 2, 2, 0, 0, 2, 0,
    };
    var pos: [quad.len * 2]f32 = undefined;
    @memcpy(pos[0..quad.len], quad[0..]);
    @memcpy(pos[quad.len..], quad[0..]);
    const groups = [_]u32{ 7, 7, 19, 19 };
    const editable = [_]bool{ true, true, false, false };

    const cut = mesh_edit.planeCutSoupMasked(pos[0..], 4, .{ 1, 0, 0 }, 1.0, groups[0..], editable[0..]).?;
    defer {
        std.heap.c_allocator.free(cut.positions);
        std.heap.c_allocator.free(cut.src_face);
        if (cut.groups) |g| std.heap.c_allocator.free(g);
    }

    try testing.expectEqual(@as(u32, 6), cut.tri_count); // 4 cut tris + 2 untouched tris
    var untouched: u32 = 0;
    for (cut.src_face, 0..) |src, i| {
        if (src < 2) continue;
        untouched += 1;
        try testing.expectEqual(@as(u32, 19), cut.groups.?[i]);
        const out = cut.positions[i * 9 .. i * 9 + 9];
        const original = pos[@as(usize, src) * 9 .. @as(usize, src) * 9 + 9];
        try testing.expectEqualSlices(f32, original, out);
    }
    try testing.expectEqual(@as(u32, 2), untouched);
}

// Keep the mesh module's co-located lower-level tests in this unit target too.
test {
    std.testing.refAllDecls(mesh_edit);
}
