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

test "meshdoc snapshot keeps hidden part faces and rejects metadata-only ranges" {
    var visible = [_]f32{0} ** 24;
    var hidden = [_]f32{0} ** 24;
    visible[0] = 10;
    hidden[0] = 20;
    const visible_groups = [_]u32{3};
    const hidden_groups = [_]u32{9};
    const visible_colors = [_]u8{ 80, 90, 100, 255 };
    const hidden_colors = [_]u8{ 20, 30, 40, 87 };
    const blocks = [_]mesh_edit.MeshDocFaceBlock{
        .{ .verts = visible[0..], .groups = visible_groups[0..], .materials = null, .colors = visible_colors[0..] },
        .{ .verts = hidden[0..], .groups = hidden_groups[0..], .materials = null, .colors = hidden_colors[0..] },
    };
    var snapshot = try mesh_edit.composeMeshDocSnapshot(testing.allocator, blocks[0..]);
    defer snapshot.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 48), snapshot.verts.len);
    try testing.expectEqualSlices(u32, &.{ 3, 9 }, snapshot.groups.?);
    try testing.expect(snapshot.materials == null);
    try testing.expectEqual(@as(u32, 3), snapshot.glass_first_vertex);
    try testing.expectEqual(@as(f32, 10), snapshot.verts[0]);
    try testing.expectEqual(@as(f32, 20), snapshot.verts[24]);

    const ranges = [_]u32{ 3, 4, 9, 10 };
    try testing.expect(mesh_edit.meshDocRangesOwnEveryFace(ranges[0..], snapshot.groups, 2));
    try testing.expect(!mesh_edit.meshDocRangesOwnEveryFace(ranges[0..], visible_groups[0..], 2));
}

test "quality save snapshot uses the reduced resident topology" {
    // The retained baseline may contain many more faces so the slider can be
    // adjusted again, but Save passes only the chosen resident projection into the
    // durable snapshot. Its mapped authored group remains owned by the same part.
    var reduced = [_]f32{0} ** 24;
    reduced[0] = 3315;
    const mapped_group = [_]u32{7};
    const mapped_material = [_]u32{3};
    const mapped_color = [_]u8{ 42, 84, 126, 255 };
    const chosen = [_]mesh_edit.MeshDocFaceBlock{.{
        .verts = reduced[0..],
        .groups = mapped_group[0..],
        .materials = mapped_material[0..],
        .colors = mapped_color[0..],
    }};
    var snapshot = try mesh_edit.composeMeshDocSnapshot(testing.allocator, chosen[0..]);
    defer snapshot.deinit(testing.allocator);

    try testing.expectEqual(@as(usize, 24), snapshot.verts.len);
    try testing.expectEqual(@as(f32, 3315), snapshot.verts[0]);
    try testing.expectEqualSlices(u32, mapped_group[0..], snapshot.groups.?);
    try testing.expectEqualSlices(u32, mapped_material[0..], snapshot.materials.?);
    try testing.expect(mesh_edit.meshDocRangesOwnEveryFace(&.{ 7, 8 }, snapshot.groups, 1));
}

test "paint face hits cannot cross the active outliner scope" {
    var soup = [_]f32{0} ** (6 * 8);
    mesh_edit.test_support.loadGroupedSoup(3238, soup[0..], 6, &.{ 4, 9 });
    defer mesh_edit.test_support.clear();

    mesh_edit.setEditScope(4, 5);
    try testing.expectEqual(@as(i32, 0), mesh_edit.scopedFaceHit(0));
    try testing.expectEqual(@as(i32, -1), mesh_edit.scopedFaceHit(1));
    try testing.expectEqual(@as(i32, -1), mesh_edit.scopedFaceHit(-1));

    mesh_edit.setEditScope(0, 0);
    try testing.expectEqual(@as(i32, 1), mesh_edit.scopedFaceHit(1));
}

test "changing outliner scope drops stale vertex selection before transform" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
        3, 0, 0, 0, 0, 1, 0, 0,
        4, 0, 0, 0, 0, 1, 0, 0,
        3, 1, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3250, soup[0..], 6, &.{ 0, 1 });
    defer mesh_edit.test_support.clear();

    mesh_edit.setMode(.vertex);
    mesh_edit.setEditScope(0, 1);
    try testing.expectEqual(@as(i32, 3), mesh_edit.selectAll());
    try testing.expectEqual(@as(u32, 3), mesh_edit.selCount());

    mesh_edit.setEditScope(1, 2);
    try testing.expectEqual(@as(u32, 0), mesh_edit.selCount());
    try testing.expect(!mesh_edit.translateSelection(.{ 5, 0, 0 }).changed);

    try testing.expectEqual(@as(i32, 3), mesh_edit.selectAll());
    const moved = mesh_edit.translateSelection(.{ 1, 0, 0 });
    try testing.expect(moved.changed);
    try testing.expectEqual(@as(u32, 1), moved.first_face);
    try testing.expectEqual(@as(u32, 1), moved.last_face);
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

// ── Winding repair (req_3450) ─────────────────────────────────────────────────────────

/// Write one quad (two CCW triangles on the quad's 0-2 diagonal) into interleaved rows.
fn windingQuad(out: []f32, first_triangle: usize, corners: [4][3]f32, normal: [3]f32) void {
    const triangles = [2][3][3]f32{
        .{ corners[0], corners[1], corners[2] },
        .{ corners[0], corners[2], corners[3] },
    };
    for (triangles, 0..) |triangle, t| {
        for (triangle, 0..) |p, corner| {
            const row = ((first_triangle + t) * 3 + corner) * 8;
            out[row] = p[0];
            out[row + 1] = p[1];
            out[row + 2] = p[2];
            out[row + 3] = normal[0];
            out[row + 4] = normal[1];
            out[row + 5] = normal[2];
            out[row + 6] = 0.25 * @as(f32, @floatFromInt(corner));
            out[row + 7] = 0.5;
        }
    }
}

/// The unit cube [0,1]³ as 12 outward-CCW triangles — winding a culled renderer accepts
/// from every side. Offset from the origin matters in no test: the volume rule is
/// translation-invariant only for CLOSED shells, which is exactly what it gates on.
fn windingCube(out: *[12 * 24]f32) void {
    windingQuad(out, 0, .{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 0, 1 }, .{ 0, 0, 1 } }, .{ 0, -1, 0 }); // bottom
    windingQuad(out, 2, .{ .{ 0, 1, 0 }, .{ 0, 1, 1 }, .{ 1, 1, 1 }, .{ 1, 1, 0 } }, .{ 0, 1, 0 }); // top
    windingQuad(out, 4, .{ .{ 0, 0, 1 }, .{ 1, 0, 1 }, .{ 1, 1, 1 }, .{ 0, 1, 1 } }, .{ 0, 0, 1 }); // front
    windingQuad(out, 6, .{ .{ 0, 0, 0 }, .{ 0, 1, 0 }, .{ 1, 1, 0 }, .{ 1, 0, 0 } }, .{ 0, 0, -1 }); // back
    windingQuad(out, 8, .{ .{ 0, 0, 0 }, .{ 0, 0, 1 }, .{ 0, 1, 1 }, .{ 0, 1, 0 } }, .{ -1, 0, 0 }); // left
    windingQuad(out, 10, .{ .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 1, 1, 1 }, .{ 1, 0, 1 } }, .{ 1, 0, 0 }); // right
}

test "winding repair flips exactly the triangles wound against their neighbors" {
    var verts: [12 * 24]f32 = undefined;
    windingCube(&verts);
    const pristine = verts;
    // Sabotage two triangles on different faces — the imported-bookshelf defect.
    var sabotage = [_]bool{false} ** 12;
    sabotage[3] = true;
    sabotage[9] = true;
    try testing.expectEqual(@as(u32, 2), mesh_edit.flipSelectedTriangleWinding(verts[0..], 12, sabotage[0..]));

    var mask = [_]bool{false} ** 12;
    try testing.expectEqual(@as(u32, 2), mesh_edit.inconsistentWindingMask(verts[0..], 12, mask[0..]));
    try testing.expectEqualSlices(bool, sabotage[0..], mask[0..]);

    // Repair restores the pristine soup byte-for-byte (flip is an involution), and
    // a repaired mesh detects clean.
    try testing.expectEqual(@as(u32, 2), mesh_edit.normalizeTriangleWinding(verts[0..], 12));
    try testing.expectEqualSlices(f32, pristine[0..], verts[0..]);
    try testing.expectEqual(@as(u32, 0), mesh_edit.inconsistentWindingMask(verts[0..], 12, mask[0..]));
}

test "a wholly inside-out closed shell is caught by its negative volume" {
    var verts: [12 * 24]f32 = undefined;
    windingCube(&verts);
    const pristine = verts;
    const all = [_]bool{true} ** 12;
    try testing.expectEqual(@as(u32, 12), mesh_edit.flipSelectedTriangleWinding(verts[0..], 12, all[0..]));
    // Fully inverted = locally CONSISTENT (no neighbor conflicts) — only the closed
    // volume rule can see it.
    try testing.expectEqual(@as(u32, 12), mesh_edit.normalizeTriangleWinding(verts[0..], 12));
    try testing.expectEqualSlices(f32, pristine[0..], verts[0..]);
}

test "wire rows never join the winding graph and are never flipped" {
    var verts: [13 * 24]f32 = undefined;
    windingCube(verts[0 .. 12 * 24]);
    // One Pen Edges wire row: a degenerate (a, b, b) triangle riding beside the cube.
    const wire = [3][3]f32{ .{ 5, 0, 0 }, .{ 6, 0, 0 }, .{ 6, 0, 0 } };
    for (wire, 0..) |p, corner| {
        const row = (12 * 3 + corner) * 8;
        verts[row] = p[0];
        verts[row + 1] = p[1];
        verts[row + 2] = p[2];
        verts[row + 3] = 0;
        verts[row + 4] = 1;
        verts[row + 5] = 0;
        verts[row + 6] = 0;
        verts[row + 7] = 0;
    }
    const pristine = verts;
    try testing.expectEqual(@as(u32, 0), mesh_edit.normalizeTriangleWinding(verts[0..], 13));
    try testing.expectEqualSlices(f32, pristine[0..], verts[0..]);
}

test "an open sheet flips its minority, not the majority" {
    var verts: [4 * 24]f32 = undefined;
    windingQuad(verts[0 .. 2 * 24], 0, .{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 } }, .{ 0, 0, -1 });
    windingQuad(verts[0..], 2, .{ .{ 1, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 1, 0 }, .{ 1, 1, 0 } }, .{ 0, 0, -1 });
    var sabotage = [_]bool{ false, true, false, false };
    try testing.expectEqual(@as(u32, 1), mesh_edit.flipSelectedTriangleWinding(verts[0..], 4, sabotage[0..]));
    var mask = [_]bool{false} ** 4;
    try testing.expectEqual(@as(u32, 1), mesh_edit.inconsistentWindingMask(verts[0..], 4, mask[0..]));
    try testing.expectEqualSlices(bool, sabotage[0..], mask[0..]);
}

test "an inside-out box glued at a T-junction flips by its centered volume (the bookshelf_001 defect)" {
    // Two stacked unit cubes sharing the y=1 face — the merged-boxes import shape.
    // Cube B arrives fully inverted. Its shared-face edges carry 4 incidences, so
    // orientation can never propagate across the joint; only the enclosed-volume
    // rule can convict it. The coincident face pairs (A top / B bottom) sit in
    // flat stacks, measure zero centered volume, and must stay untouched.
    var verts: [24 * 24]f32 = undefined;
    windingCube(verts[0 .. 12 * 24]);
    windingCube(verts[12 * 24 .. 24 * 24]);
    var tri: usize = 12;
    while (tri < 24) : (tri += 1) {
        var corner: usize = 0;
        while (corner < 3) : (corner += 1) verts[(tri * 3 + corner) * 8 + 1] += 1;
    }
    var invert_b = [_]bool{false} ** 24;
    for (12..24) |t| invert_b[t] = true;
    try testing.expectEqual(@as(u32, 12), mesh_edit.flipSelectedTriangleWinding(verts[0..], 24, invert_b[0..]));

    var mask = [_]bool{false} ** 24;
    try testing.expectEqual(@as(u32, 10), mesh_edit.inconsistentWindingMask(verts[0..], 24, mask[0..]));
    // Cube A entirely untouched; B's bottom pair (triangles 12/13, hidden inside
    // the joint) stays as authored; B's ten visible triangles all repair.
    for (0..14) |t| try testing.expect(!mask[t]);
    for (14..24) |t| try testing.expect(mask[t]);
}

test "a coincident two-sided sheet is deliberate authoring and stays untouched" {
    var verts: [4 * 24]f32 = undefined;
    const corners = [4][3]f32{ .{ 3, 0, 7 }, .{ 4, 0, 7 }, .{ 4, 1, 7 }, .{ 3, 1, 7 } };
    windingQuad(verts[0 .. 2 * 24], 0, corners, .{ 0, 0, 1 });
    // The reversed back side: same positions, opposite loop.
    windingQuad(verts[0..], 2, .{ corners[0], corners[3], corners[2], corners[1] }, .{ 0, 0, -1 });
    const pristine = verts;
    // Every shared edge carries four incidences, so orientation never crosses and
    // no isolated triangle may fall through to the closed-volume rule (deliberately
    // placed away from the origin — a position-dependent flip would trip this).
    try testing.expectEqual(@as(u32, 0), mesh_edit.normalizeTriangleWinding(verts[0..], 4));
    try testing.expectEqualSlices(f32, pristine[0..], verts[0..]);
}

test "created grouped face becomes the one active face ready to flip" {
    var soup = [_]f32{0} ** (9 * 8); // one old triangle + a new split quad
    mesh_edit.test_support.loadGroupedSoup(2921, soup[0..], 9, &.{ 3, 8, 8 });
    defer mesh_edit.test_support.clear();

    try testing.expectEqual(@as(u32, 1), mesh_edit.focusCreatedFace(1, 2));
    try testing.expectEqual(mesh_edit.Mode.face, mesh_edit.mode());
    try testing.expectEqual(@as(u32, 1), mesh_edit.selCount()); // authored face, not two triangles
    try testing.expect(!mesh_edit.faceSelectedPub(0));
    try testing.expect(mesh_edit.faceSelectedPub(1));
    try testing.expect(mesh_edit.faceSelectedPub(2));
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

test "UV corner identities preserve the welded vertices of an authored quad" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 1, 0,
        1, 1, 0, 0, 0, 1, 1, 1,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 1, 1,
        0, 1, 0, 0, 0, 1, 0, 1,
    };
    mesh_edit.test_support.loadGroupedSoup(3391, soup[0..], 6, &.{ 12, 12 });
    defer mesh_edit.test_support.clear();

    const first = mesh_edit.faceCornerVerticesPub(0) orelse return error.MissingFirstFace;
    const second = mesh_edit.faceCornerVerticesPub(1) orelse return error.MissingSecondFace;
    try testing.expectEqual(first[0], second[0]);
    try testing.expectEqual(first[2], second[1]);
    try testing.expect(first[0] != first[1] and first[1] != first[2] and first[0] != first[2]);
    try testing.expect(second[2] != first[0] and second[2] != first[1] and second[2] != first[2]);
}

test "UV orientation collection joins disconnected same-direction islands only" {
    var soup = [_]f32{
        // Two disconnected +Z faces become separate islands with one orientation.
        0, 0, 0, 0, 0, 1,  0, 0,
        1, 0, 0, 0, 0, 1,  0, 0,
        0, 1, 0, 0, 0, 1,  0, 0,
        2, 0, 0, 0, 0, 1,  0, 0,
        3, 0, 0, 0, 0, 1,  0, 0,
        2, 1, 0, 0, 0, 1,  0, 0,
        // Same dominant axis, opposite sign: must remain separate.
        4, 0, 0, 0, 0, -1, 0, 0,
        4, 1, 0, 0, 0, -1, 0, 0,
        5, 0, 0, 0, 0, -1, 0, 0,
        // +X is a different projection direction.
        0, 0, 2, 1, 0, 0,  0, 0,
        0, 1, 2, 1, 0, 0,  0, 0,
        0, 0, 3, 1, 0, 0,  0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3388, soup[0..], 12, &.{ 0, 1, 2, 3 });
    defer mesh_edit.test_support.clear();

    try testing.expect(mesh_edit.selectFaceByIndex(0, false));
    try testing.expectEqual(@as(u32, 2), mesh_edit.selectSameUvOrientation());
    try testing.expect(mesh_edit.faceSelectedPub(0));
    try testing.expect(mesh_edit.faceSelectedPub(1));
    try testing.expect(!mesh_edit.faceSelectedPub(2));
    try testing.expect(!mesh_edit.faceSelectedPub(3));

    // Outliner focus is an ownership boundary even when another matching island
    // exists elsewhere in the model.
    mesh_edit.setEditScope(0, 1);
    try testing.expect(mesh_edit.selectFaceByIndex(0, false));
    try testing.expectEqual(@as(u32, 1), mesh_edit.selectSameUvOrientation());
    try testing.expect(mesh_edit.faceSelectedPub(0));
    try testing.expect(!mesh_edit.faceSelectedPub(1));
}

test "detached seam create-face selection carries the detached part owner" {
    // Two position-coincident quads model the exact detach seam: their render
    // positions overlap, but each authored face belongs to an independent part.
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3314, soup[0..], 12, &.{ 0, 0, 1, 1 });
    defer mesh_edit.test_support.clear();
    mesh_edit.test_support.setPartRanges(&.{ 0, 1, 1, 2 });
    mesh_edit.setMode(.edge);

    // The focused detached range owns all selected edges even though the source
    // face occupies the same coordinates. This is the owner Create Face must carry.
    mesh_edit.setEditScope(1, 2);
    try testing.expectEqual(@as(i32, 4), mesh_edit.selectAll());
    try testing.expectEqual(@as(u32, 1), mesh_edit.selectedEdgesCommonPartPub().?);

    // A selection spanning independent outliners has no legal single owner and is
    // rejected instead of arbitrarily assigning the new face to the first triangle.
    mesh_edit.setEditScope(0, 0);
    try testing.expectEqual(@as(i32, 8), mesh_edit.selectAll());
    try testing.expect(mesh_edit.selectedEdgesCommonPartPub() == null);
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

test "exact uniform scale accepts a negative factor to mirror through its pivot" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        2, 0, 0, 0, 0, 1, 1, 0,
        0, 2, 0, 0, 0, 1, 0, 1,
    };
    mesh_edit.test_support.loadGroupedSoup(2931, soup[0..], 3, &.{0});
    defer mesh_edit.test_support.clear();
    mesh_edit.setMode(.face);
    try testing.expect(mesh_edit.selectFaceByIndex(0, false));

    const pivot = mesh_edit.selectionFrame().?.center;
    const before = mesh_edit.vertPosPub(0);
    try testing.expect(mesh_edit.scaleSelectionUniform(pivot, -1).changed);
    const after = mesh_edit.vertPosPub(0);
    inline for (0..3) |axis| try testing.expectApproxEqAbs(pivot[axis] * 2 - before[axis], after[axis], 0.0001);

    try testing.expect(!mesh_edit.scaleSelectionUniform(pivot, 0).changed);
    try testing.expect(!mesh_edit.scaleSelectionUniform(pivot, -51).changed);
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

test "dissolving an irregular four-quad grid cleans authored boundary without rebuilding render triangles" {
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
    try testing.expectEqual(@as(u32, 8), lowered.tri_count);
    try testing.expectEqualSlices(u32, &.{ 10, 10, 10, 10, 10, 10, 10, 10 }, lowered.groups);
    try testing.expectEqual(@as(usize, 4), indexed.faces.items[0].vertices.items.len);
}

test "tris to quads recovers every selected cell instead of pairing across grid seams" {
    // Two adjacent squares arrive as four independent triangles. The middle vertical
    // edge is also a legal triangle adjacency, so an arbitrary first-match walk can
    // make one diagonal parallelogram and strand both intended cell mates. The bulk
    // transaction scores all candidates first and recovers both authored squares.
    const points = [_][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 2, 0, 0 },
        .{ 0, 1, 0 }, .{ 1, 1, 0 }, .{ 2, 1, 0 },
    };
    const triangles = [_][3]usize{
        .{ 0, 1, 4 }, .{ 0, 4, 3 },
        .{ 1, 2, 5 }, .{ 1, 5, 4 },
    };
    const triangle_count: u32 = triangles.len;
    var soup = [_]f32{0} ** (triangles.len * 3 * 8);
    for (triangles, 0..) |triangle, triangle_index| {
        for (triangle, 0..) |point, corner| {
            const base = (triangle_index * 3 + corner) * 8;
            @memcpy(soup[base .. base + 3], points[point][0..]);
            soup[base + 6] = @as(f32, @floatFromInt(point)) * 0.1;
            soup[base + 7] = @as(f32, @floatFromInt(triangle_index)) * 0.1;
        }
    }
    const groups = [_]u32{ 0, 1, 2, 3 };
    const parts = [_]u32{7} ** triangles.len;
    const materials = [_]u32{3} ** triangles.len;
    const selected = [_]bool{true} ** triangles.len;
    var indexed = try indexed_edit_mesh.Mesh.fromSoupWithMaterials(
        testing.allocator,
        soup[0..],
        triangle_count,
        groups[0..],
        parts[0..],
        materials[0..],
    );
    defer indexed.deinit();

    try testing.expectEqual(@as(u32, 2), try indexed.quadifySelected(selected[0..]));
    var resident_groups: [triangles.len]u32 = undefined;
    var resident_parts: [triangles.len]u32 = undefined;
    var resident_materials: [triangles.len]u32 = undefined;
    try testing.expect(indexed.writeResidentMetadata(&resident_groups, &resident_parts, &resident_materials));
    try testing.expectEqualSlices(u32, &.{ 0, 0, 2, 2 }, resident_groups[0..]);
    try testing.expectEqualSlices(u32, parts[0..], resident_parts[0..]);
    try testing.expectEqualSlices(u32, materials[0..], resident_materials[0..]);
    try testing.expect(indexed.residentUvsMatch(soup[0..], triangle_count));

    var live_quads: u32 = 0;
    for (indexed.faces.items) |face| {
        if (!face.alive) continue;
        try testing.expectEqual(@as(usize, 4), face.vertices.items.len);
        try testing.expectEqual(@as(usize, 2), face.source_triangles.items.len);
        try testing.expect(face.diagonal != null);
        live_quads += 1;
    }
    try testing.expectEqual(@as(u32, 2), live_quads);
}

test "tris to quads leaves selected material mismatches and unmatched triangles alone" {
    var soup = [_]f32{0} ** (3 * 3 * 8);
    const corners = [9][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 },
        .{ 0, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 },
        .{ 3, 0, 0 }, .{ 4, 0, 0 }, .{ 3, 1, 0 },
    };
    for (corners, 0..) |corner, row| @memcpy(soup[row * 8 .. row * 8 + 3], corner[0..]);
    const groups = [_]u32{ 0, 1, 2 };
    const parts = [_]u32{ 4, 4, 4 };
    const materials = [_]u32{ 8, 9, 8 };
    const selected = [_]bool{ true, true, true };
    var indexed = try indexed_edit_mesh.Mesh.fromSoupWithMaterials(
        testing.allocator,
        soup[0..],
        3,
        groups[0..],
        parts[0..],
        materials[0..],
    );
    defer indexed.deinit();

    try testing.expectEqual(@as(u32, 0), try indexed.quadifySelected(selected[0..]));
    var resident_groups: [3]u32 = undefined;
    var resident_parts: [3]u32 = undefined;
    var resident_materials: [3]u32 = undefined;
    try testing.expect(indexed.writeResidentMetadata(&resident_groups, &resident_parts, &resident_materials));
    try testing.expectEqualSlices(u32, groups[0..], resident_groups[0..]);
    try testing.expectEqualSlices(u32, parts[0..], resident_parts[0..]);
    try testing.expectEqualSlices(u32, materials[0..], resident_materials[0..]);
}

test "tris to quads rejects a shared edge made non-manifold by an unselected face" {
    var soup = [_]f32{0} ** (3 * 3 * 8);
    const corners = [9][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 0, 1, 0 },
        .{ 1, 0, 0 }, .{ 0, 0, 0 }, .{ 1, -1, 0 },
        .{ 1, 0, 0 }, .{ 0, 0, 0 }, .{ 0, -1, 0 },
    };
    for (corners, 0..) |corner, row| @memcpy(soup[row * 8 .. row * 8 + 3], corner[0..]);
    const groups = [_]u32{ 0, 1, 2 };
    const selected = [_]bool{ true, true, false };
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 3, groups[0..], null);
    defer indexed.deinit();

    try testing.expectEqual(@as(u32, 0), try indexed.quadifySelected(selected[0..]));
    var resident_groups: [3]u32 = undefined;
    var resident_parts: [3]u32 = undefined;
    var resident_materials: [3]u32 = undefined;
    try testing.expect(indexed.writeResidentMetadata(&resident_groups, &resident_parts, &resident_materials));
    try testing.expectEqualSlices(u32, groups[0..], resident_groups[0..]);
}

test "sequential concave face merges preserve resident triangles uv and part ownership" {
    // Bookshelf sides are not one convex rectangle: shelf offsets leave an inward
    // corner along the three-face perimeter. Merging one side and then its opposite
    // must change authored face identity only. Re-fanning either concave perimeter
    // reverses render triangles (the face disappears under back-face culling), moves
    // pinned atlas samples, and leaves the second merge lowering corrupted ownership.
    const front = [_][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 2, 0.35, 0 }, .{ 3, 0, 0 },
        .{ 0, 1, 0 }, .{ 1, 1, 0 }, .{ 2, 1, 0 },    .{ 3, 1, 0 },
    };
    const back = [_][3]f32{
        .{ 0, 0, -0.2 }, .{ 1, 0, -0.2 }, .{ 2, 0.35, -0.2 }, .{ 3, 0, -0.2 },
        .{ 0, 1, -0.2 }, .{ 1, 1, -0.2 }, .{ 2, 1, -0.2 },    .{ 3, 1, -0.2 },
    };
    var soup = [_]f32{0} ** (12 * 3 * 8);
    const Emit = struct {
        fn triangle(
            out: []f32,
            triangle_index: usize,
            a: [3]f32,
            b: [3]f32,
            c: [3]f32,
            uv_pin: f32,
        ) void {
            for ([_][3]f32{ a, b, c }, 0..) |position, corner| {
                const base = (triangle_index * 3 + corner) * 8;
                @memcpy(out[base .. base + 3], position[0..]);
                out[base + 6] = uv_pin + @as(f32, @floatFromInt(corner)) * 0.001;
                out[base + 7] = uv_pin + @as(f32, @floatFromInt(triangle_index)) * 0.001;
            }
        }
    };
    var triangle: usize = 0;
    for (0..3) |panel| {
        Emit.triangle(soup[0..], triangle, front[panel], front[panel + 1], front[panel + 5], 0.1 + @as(f32, @floatFromInt(panel)) * 0.1);
        triangle += 1;
        Emit.triangle(soup[0..], triangle, front[panel], front[panel + 5], front[panel + 4], 0.1 + @as(f32, @floatFromInt(panel)) * 0.1);
        triangle += 1;
    }
    for (0..3) |panel| {
        // Reverse winding for the opposite side while retaining a distinct atlas pin.
        Emit.triangle(soup[0..], triangle, back[panel], back[panel + 5], back[panel + 1], 0.6 + @as(f32, @floatFromInt(panel)) * 0.1);
        triangle += 1;
        Emit.triangle(soup[0..], triangle, back[panel], back[panel + 4], back[panel + 5], 0.6 + @as(f32, @floatFromInt(panel)) * 0.1);
        triangle += 1;
    }
    const groups = [_]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    const parts = [_]u32{0} ** 12;
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 12, groups[0..], parts[0..]);
    defer indexed.deinit();
    try testing.expect(indexed.residentUvsMatch(soup[0..], 12));
    var uv_edited = soup;
    uv_edited[6] += 0.125;
    try testing.expect(!indexed.residentUvsMatch(uv_edited[0..], 12));

    var first_selection = [_]bool{false} ** 12;
    @memset(first_selection[0..6], true);
    try testing.expect(try indexed.mergeSelected(first_selection[0..]));
    var resident_groups: [12]u32 = undefined;
    var resident_parts: [12]u32 = undefined;
    var resident_materials: [12]u32 = undefined;
    try testing.expect(indexed.writeResidentMetadata(&resident_groups, &resident_parts, &resident_materials));
    try testing.expectEqualSlices(u32, &.{ 0, 0, 0, 0, 0, 0, 3, 3, 4, 4, 5, 5 }, &resident_groups);
    try testing.expectEqualSlices(u32, parts[0..], &resident_parts);
    try testing.expectEqualSlices(u32, &([_]u32{indexed_edit_mesh.NO_MATERIAL} ** 12), &resident_materials);
    var first = try indexed.lower();
    defer first.deinit();
    try testing.expectEqual(@as(u32, 12), first.tri_count);
    for (0..12 * 3) |vertex| {
        const source = vertex * 8;
        const position = vertex * 3;
        const uv = vertex * 2;
        try testing.expectEqualSlices(f32, soup[source .. source + 3], first.positions[position .. position + 3]);
        try testing.expectEqualSlices(f32, soup[source + 6 .. source + 8], first.uvs[uv .. uv + 2]);
    }
    try testing.expectEqualSlices(u32, &.{ 0, 0, 0, 0, 0, 0, 3, 3, 4, 4, 5, 5 }, first.groups);
    try testing.expectEqualSlices(u32, parts[0..], first.parts);

    indexed.adoptLoweredMetadata(&first, first.groups, first.parts);
    var second_selection = [_]bool{false} ** 12;
    @memset(second_selection[6..12], true);
    try testing.expect(try indexed.mergeSelected(second_selection[0..]));
    var second = try indexed.lower();
    defer second.deinit();
    try testing.expectEqual(@as(u32, 12), second.tri_count);
    for (0..12 * 3) |vertex| {
        const source = vertex * 8;
        const position = vertex * 3;
        const uv = vertex * 2;
        try testing.expectEqualSlices(f32, soup[source .. source + 3], second.positions[position .. position + 3]);
        try testing.expectEqualSlices(f32, soup[source + 6 .. source + 8], second.uvs[uv .. uv + 2]);
    }
    try testing.expectEqualSlices(u32, &.{ 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3 }, second.groups);
    try testing.expectEqualSlices(u32, parts[0..], second.parts);
}

test "merge faces rejects mixed material identity" {
    const left = [4][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 },
    };
    const right = [4][3]f32{
        .{ 1, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 1, 0 }, .{ 1, 1, 0 },
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
    Emit.triangle(soup[0..], 0, left[0], left[1], left[2]);
    Emit.triangle(soup[0..], 1, left[0], left[2], left[3]);
    Emit.triangle(soup[0..], 2, right[0], right[1], right[2]);
    Emit.triangle(soup[0..], 3, right[0], right[2], right[3]);
    const groups = [_]u32{ 0, 0, 1, 1 };
    const parts = [_]u32{0} ** 4;
    const materials = [_]u32{ 7, 7, 9, 9 };
    const selected = [_]bool{true} ** 4;
    var indexed = try indexed_edit_mesh.Mesh.fromSoupWithMaterials(
        testing.allocator,
        soup[0..],
        4,
        groups[0..],
        parts[0..],
        materials[0..],
    );
    defer indexed.deinit();

    try testing.expect(!(try indexed.mergeSelected(selected[0..])));
    var lowered = try indexed.lower();
    defer lowered.deinit();
    try testing.expectEqualSlices(u32, groups[0..], lowered.groups);
    try testing.expectEqualSlices(u32, materials[0..], lowered.materials);
}

test "merge faces rejects a connected bent surface without changing its topology" {
    // Both authored quads point generally the same way and share one full edge, but
    // the second rises out of the first quad's plane. The old 0.5 normal-dot gate
    // accepted this 27-degree bend and lowered its six-corner perimeter as one fan,
    // changing physical diagonals even though the displayed triangle count happened
    // to stay constant (the bookshelf corruption from req_3374).
    const flat = [4][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 },
    };
    const bent = [4][3]f32{
        .{ 1, 1, 0 }, .{ 1, 0, 0 }, .{ 2, 0, 0.5 }, .{ 2, 1, 0.5 },
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
    Emit.triangle(soup[0..], 0, flat[0], flat[1], flat[2]);
    Emit.triangle(soup[0..], 1, flat[0], flat[2], flat[3]);
    Emit.triangle(soup[0..], 2, bent[0], bent[1], bent[2]);
    Emit.triangle(soup[0..], 3, bent[0], bent[2], bent[3]);
    const groups = [_]u32{ 0, 0, 1, 1 };
    const parts = [_]u32{ 0, 0, 0, 0 };
    const selected = [_]bool{true} ** 4;
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 4, groups[0..], parts[0..]);
    defer indexed.deinit();

    try testing.expect(!(try indexed.mergeSelected(selected[0..])));
    var lowered = try indexed.lower();
    defer lowered.deinit();
    try testing.expectEqual(@as(u32, 4), lowered.tri_count);
    try testing.expectEqualSlices(u32, groups[0..], lowered.groups);
    try testing.expectEqualSlices(u32, parts[0..], lowered.parts);
}

test "merge faces discards cached ownership after structural part merge" {
    // Two coplanar quads begin in independent Outliner parts, so their coincident
    // seam deliberately has separate stable vertex ids in the cached topology.
    // Merge Parts changes only resident groups/ownership. Merge Faces must reject
    // that stale cache, re-import under the sole surviving part, and then dissolve
    // the now-shared seam without resurrecting either old part id.
    const left = [4][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 },
    };
    const right = [4][3]f32{
        .{ 1, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 1, 0 }, .{ 1, 1, 0 },
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
    Emit.triangle(soup[0..], 0, left[0], left[1], left[2]);
    Emit.triangle(soup[0..], 1, left[0], left[2], left[3]);
    Emit.triangle(soup[0..], 2, right[0], right[1], right[2]);
    Emit.triangle(soup[0..], 3, right[0], right[2], right[3]);

    const old_groups = [_]u32{ 0, 0, 1, 1 };
    const old_parts = [_]u32{ 0, 0, 1, 1 };
    const merged_groups = [_]u32{ 8, 8, 9, 9 };
    const merged_parts = [_]u32{ 0, 0, 0, 0 };
    var cached = try indexed_edit_mesh.Mesh.fromSoup(
        testing.allocator,
        soup[0..],
        4,
        old_groups[0..],
        old_parts[0..],
    );
    defer cached.deinit();
    try testing.expect(cached.residentMetadataMatches(4, old_groups[0..], old_parts[0..], null));
    try testing.expect(!cached.residentMetadataMatches(4, merged_groups[0..], merged_parts[0..], null));

    var refreshed = try indexed_edit_mesh.Mesh.fromSoup(
        testing.allocator,
        soup[0..],
        4,
        merged_groups[0..],
        merged_parts[0..],
    );
    defer refreshed.deinit();
    try testing.expect(refreshed.residentMetadataMatches(4, merged_groups[0..], merged_parts[0..], null));
    const selected = [_]bool{true} ** 4;
    try testing.expect(try refreshed.mergeSelected(selected[0..]));
    var lowered = try refreshed.lower();
    defer lowered.deinit();
    try testing.expectEqual(@as(u32, 4), lowered.tri_count);
    try testing.expectEqualSlices(u32, &.{ 8, 8, 8, 8 }, lowered.groups);
    try testing.expectEqualSlices(u32, &.{ 0, 0, 0, 0 }, lowered.parts);
}

test "loop cut ignores collapsed quad members in an unrelated outliner part" {
    const clean = [4][3]f32{
        .{ 0, 0, 0 }, .{ 2, 0, 0 }, .{ 2, 2, 0 }, .{ 0, 2, 0 },
    };
    const collapsed = [3][3]f32{
        .{ 10, 0, 0 }, .{ 12, 0, 0 }, .{ 12, 2, 0 },
    };
    const collapsed_first = [3][3]f32{
        .{ 20, 0, 0 }, .{ 22, 0, 0 }, .{ 22, 2, 0 },
    };
    var soup = [_]f32{0} ** (6 * 3 * 8);
    const Emit = struct {
        fn triangle(out: []f32, triangle_index: usize, a: [3]f32, b: [3]f32, c: [3]f32) void {
            for ([_][3]f32{ a, b, c }, 0..) |position, corner| {
                const base = (triangle_index * 3 + corner) * 8;
                @memcpy(out[base .. base + 3], position[0..]);
            }
        }
    };
    Emit.triangle(soup[0..], 0, clean[0], clean[1], clean[2]);
    Emit.triangle(soup[0..], 1, clean[0], clean[2], clean[3]);
    // This is the exact collapsed-quad form from the car_seat fixture: the
    // second render triangle repeats one corner and has zero area.
    Emit.triangle(soup[0..], 2, collapsed[0], collapsed[1], collapsed[2]);
    Emit.triangle(soup[0..], 3, collapsed[0], collapsed[2], collapsed[0]);
    // The same collapse can put the zero-area member first; both orders occur in
    // the saved car_seat geometry from the report.
    Emit.triangle(soup[0..], 4, collapsed_first[0], collapsed_first[1], collapsed_first[1]);
    Emit.triangle(soup[0..], 5, collapsed_first[0], collapsed_first[1], collapsed_first[2]);
    const groups = [_]u32{ 0, 0, 1, 1, 2, 2 };
    const parts = [_]u32{ 0, 0, 1, 1, 2, 2 };
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 6, groups[0..], parts[0..]);
    defer indexed.deinit();

    try testing.expectEqual(@as(usize, 3), indexed.faces.items.len);
    try testing.expectEqual(@as(usize, 3), indexed.faces.items[1].vertices.items.len);
    try testing.expectEqual(@as(usize, 3), indexed.faces.items[2].vertices.items.len);
    const selected = [_]bool{ true, true, false, false, false, false };
    try testing.expect(try indexed.loopCut(selected[0..], 0, 1, 0.5));

    var lowered = try indexed.lower();
    defer lowered.deinit();
    var collapsed_triangles: u32 = 0;
    for (lowered.parts, lowered.groups, lowered.source_triangles) |part, group, source| {
        if (part == 1 or part == 2) {
            collapsed_triangles += 1;
            try testing.expectEqual(part, group);
            if (part == 1)
                try testing.expect(source == 2 or source == 3)
            else
                try testing.expect(source == 4 or source == 5);
        }
    }
    try testing.expectEqual(@as(u32, 4), collapsed_triangles);
}

test "focusing an edge by rebuilt endpoints replaces the previous edge selection" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3379, soup[0..], 6, &.{ 1, 1 });
    defer mesh_edit.test_support.clear();

    mesh_edit.setMode(.edge);
    try testing.expect(mesh_edit.selectEdgeByIndex(0, false));
    // The outer top edge is the equivalent of an edge extrusion's newly minted
    // edge. A tiny coordinate drift models the soup rebuild across that operation.
    try testing.expect(mesh_edit.focusEdgeByEndpoints(.{ 0.0001, 1, 0 }, .{ 1, 1, 0 }));
    try testing.expectEqual(mesh_edit.Mode.edge, mesh_edit.mode());
    try testing.expectEqual(@as(u32, 1), mesh_edit.selCount());
    const focused = mesh_edit.selectedEdgeIndexPub().?;
    const endpoints = mesh_edit.edgeEndpointsPub(focused);
    const a = mesh_edit.vertPosPub(endpoints[0]);
    const b = mesh_edit.vertPosPub(endpoints[1]);
    const is_top_edge = (a[1] == 1 and b[1] == 1) and
        ((a[0] == 0 and b[0] == 1) or (a[0] == 1 and b[0] == 0));
    try testing.expect(is_top_edge);
}

test "edge extrusion extends a grouped quad outward in its plane" {
    var soup = [_]f32{
        // One authored quad split across the A-C render diagonal.
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3381, soup[0..], 6, &.{ 7, 7 });
    defer mesh_edit.test_support.clear();

    mesh_edit.setMode(.edge);
    try testing.expect(mesh_edit.focusEdgeByEndpoints(.{ 0, 0, 0 }, .{ 0, 1, 0 }));
    const frame = mesh_edit.edgeExtrusionFramePub(mesh_edit.selectedEdgeIndexPub().?) orelse
        return error.TestUnexpectedResult;

    // The hidden render triangle touching this edge points toward the upper-right
    // corner. Using that triangle alone would introduce a Y component; using the
    // authored quad must produce the exact -X continuation the user expects.
    try testing.expectApproxEqAbs(@as(f32, -1), frame.outward[0], 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 0), frame.outward[1], 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 0), frame.outward[2], 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 1), frame.face_normal[2], 1e-6);

    const outer = frame.outer(0.25);
    try testing.expectApproxEqAbs(@as(f32, -0.25), outer[0][0], 1e-6);
    try testing.expectApproxEqAbs(@as(f32, -0.25), outer[1][0], 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 0), outer[0][2], 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 0), outer[1][2], 1e-6);
}

test "part range rebase keeps an unchanged scope push from clearing edge focus" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3385, soup[0..], 6, &.{ 0, 0 });
    defer mesh_edit.test_support.clear();
    mesh_edit.test_support.setPartRanges(&.{ 0, 1 });

    mesh_edit.setEditScope(0, 1);
    mesh_edit.setMode(.edge);
    try testing.expect(mesh_edit.focusEdgeByEndpoints(.{ 0, 0, 0 }, .{ 0, 1, 0 }));
    try testing.expectEqual(@as(u32, 1), mesh_edit.selectedEdgeCountPub());

    // Appending a new authored face widens the same part. The native transaction
    // rebases before rebuilding, then the cart echoes the resulting range after
    // adoption. Neither step may make the freshly focused edge disappear.
    try testing.expect(mesh_edit.rebaseEditScopePartRanges(&.{ 0, 1 }, &.{ 0, 2 }));
    var scope: [4]u32 = undefined;
    try testing.expectEqual(@as(usize, 2), mesh_edit.scopeRangesPub(scope[0..]));
    try testing.expectEqualSlices(u32, &.{ 0, 2 }, scope[0..2]);
    mesh_edit.setEditScope(0, 2);
    try testing.expectEqual(@as(u32, 1), mesh_edit.selectedEdgeCountPub());

    // A genuinely different outliner focus remains a selection boundary.
    mesh_edit.setEditScope(2, 3);
    try testing.expectEqual(@as(u32, 0), mesh_edit.selectedEdgeCountPub());
}

test "edge extrusion rejects a hidden triangulation diagonal" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3382, soup[0..], 6, &.{ 3, 3 });
    defer mesh_edit.test_support.clear();
    try testing.expect(mesh_edit.ensureTopologyPub());

    var diagonal: ?u32 = null;
    for (0..mesh_edit.edgeCount()) |edge| {
        const index: u32 = @intCast(edge);
        if (!mesh_edit.edgeIsBoundaryPub(index)) {
            diagonal = index;
            break;
        }
    }
    try testing.expect(diagonal != null);
    try testing.expect(mesh_edit.edgeExtrusionFramePub(diagonal.?) == null);
}

test "repeated edge extrusion keeps extending the same authored strip" {
    var soup = [_]f32{
        // Original quad, group 7.
        0,     0, 0, 0, 0, 1, 0, 0,
        1,     0, 0, 0, 0, 1, 0, 0,
        1,     1, 0, 0, 0, 1, 0, 0,
        0,     0, 0, 0, 0, 1, 0, 0,
        1,     1, 0, 0, 0, 1, 0, 0,
        0,     1, 0, 0, 0, 1, 0, 0,
        // First bridge, group 8: this is the resident result after one extrusion.
        0,     0, 0, 0, 0, 1, 0, 0,
        0,     1, 0, 0, 0, 1, 0, 0,
        -0.25, 1, 0, 0, 0, 1, 0, 0,
        0,     0, 0, 0, 0, 1, 0, 0,
        -0.25, 1, 0, 0, 0, 1, 0, 0,
        -0.25, 0, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3383, soup[0..], 12, &.{ 7, 7, 8, 8 });
    defer mesh_edit.test_support.clear();

    mesh_edit.setMode(.edge);
    try testing.expect(mesh_edit.focusEdgeByEndpoints(.{ -0.25, 0, 0 }, .{ -0.25, 1, 0 }));
    const frame = mesh_edit.edgeExtrusionFramePub(mesh_edit.selectedEdgeIndexPub().?) orelse
        return error.TestUnexpectedResult;
    const next = frame.outer(0.25);

    try testing.expectApproxEqAbs(@as(f32, -0.5), next[0][0], 1e-6);
    try testing.expectApproxEqAbs(@as(f32, -0.5), next[1][0], 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 0), next[0][2], 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 0), next[1][2], 1e-6);
}

test "same-face diagonal adoption keeps boundary edge selection" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    const groups = [_]u32{ 7, 7 };
    mesh_edit.test_support.loadGroupedSoup(3312, soup[0..], 6, groups[0..]);
    defer mesh_edit.test_support.clear();
    mesh_edit.setMode(.edge);
    try testing.expectEqual(@as(i32, 4), mesh_edit.selectAll());

    // Re-triangulate the same authored quad across B-D. Copy complete rows so the
    // atlas UV attached to every physical corner follows that corner exactly.
    var alternate: [6 * 8]f32 = undefined;
    const rows = [_]usize{ 1, 2, 5, 1, 5, 0 };
    for (rows, 0..) |source_row, destination_row| {
        @memcpy(
            alternate[destination_row * 8 .. destination_row * 8 + 8],
            soup[source_row * 8 .. source_row * 8 + 8],
        );
    }
    try testing.expect(mesh_edit.test_support.replaceGroupedSoupSameFaceCount(3312, alternate[0..], 6, groups[0..]));
    try testing.expect(mesh_edit.adoptSameFaceTriangulation());
    try testing.expectEqual(@as(u32, 4), mesh_edit.selectedEdgeCountPub());
    try testing.expectEqual(@as(u32, 4), mesh_edit.boundaryEdgeCount());
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

test "pen edge wire triangles weld into naked selectable boundary edges" {
    // The Pen Edges format: one zero-area triangle (a, b, b) per wire segment.
    // Two segments over three points — P0(0,0,0) → P1(1,0,0) → P2(1,1,0).
    var soup = [_]f32{0} ** (2 * 3 * 8);
    const p0 = [3]f32{ 0, 0, 0 };
    const p1 = [3]f32{ 1, 0, 0 };
    const p2 = [3]f32{ 1, 1, 0 };
    const corners = [6][3]f32{ p0, p1, p1, p1, p2, p2 };
    for (corners, 0..) |corner, row| {
        soup[row * 8 + 0] = corner[0];
        soup[row * 8 + 1] = corner[1];
        soup[row * 8 + 2] = corner[2];
    }
    mesh_edit.test_support.loadGroupedSoup(4407, soup[0..], 6, &.{ 5, 5 });
    defer mesh_edit.test_support.clear();

    try testing.expect(mesh_edit.ensureTopologyPub());
    // Three welded vertices, two distinct edges — and BOTH edges must classify as
    // real boundary edges. Before the per-face incidence dedupe, each degenerate
    // triangle walked its lone edge twice (incidence 2, same group), which hid the
    // whole wire as if it were a triangulation diagonal.
    try testing.expectEqual(@as(u32, 3), mesh_edit.vertCount());
    try testing.expectEqual(@as(u32, 2), mesh_edit.edgeCount());
    try testing.expectEqual(@as(u32, 2), mesh_edit.boundaryEdgeCount());
    try testing.expect(mesh_edit.edgeIsBoundaryPub(0));
    try testing.expect(mesh_edit.edgeIsBoundaryPub(1));
    // Both classify WIRE — no rasterizing face touches them, which is what routes
    // them through the view-mode wire overlay.
    try testing.expect(mesh_edit.edgeIsWirePub(0));
    try testing.expect(mesh_edit.edgeIsWirePub(1));
}

test "a real face's edges never classify as pen wire" {
    // One genuine triangle (distinct corners) alongside one wire segment.
    var soup = [_]f32{0} ** (2 * 3 * 8);
    const real = [3][3]f32{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 0, 1, 0 } };
    const wire_a = [3]f32{ 3, 0, 0 };
    const wire_b = [3]f32{ 4, 0, 0 };
    const corners = [6][3]f32{ real[0], real[1], real[2], wire_a, wire_b, wire_b };
    for (corners, 0..) |corner, row| {
        soup[row * 8 + 0] = corner[0];
        soup[row * 8 + 1] = corner[1];
        soup[row * 8 + 2] = corner[2];
    }
    mesh_edit.test_support.loadGroupedSoup(4408, soup[0..], 6, &.{ 1, 2 });
    defer mesh_edit.test_support.clear();

    try testing.expect(mesh_edit.ensureTopologyPub());
    try testing.expectEqual(@as(u32, 4), mesh_edit.edgeCount());
    var wire_edges: u32 = 0;
    var edge: u32 = 0;
    while (edge < mesh_edit.edgeCount()) : (edge += 1) {
        if (mesh_edit.edgeIsWirePub(edge)) wire_edges += 1;
    }
    try testing.expectEqual(@as(u32, 1), wire_edges);
}

test "raw import recovers isolated coplanar quad pairs but keeps triangle fans separate" {
    // A square is emitted as two render triangles. Its shared diagonal is not an
    // authored edge after import, while the three coplanar cap wedges remain
    // independent because they do not form isolated four-corner quads.
    var soup = [_]f32{0} ** (5 * 3 * 8);
    const corners = [15][3]f32{
        .{ 0, 0, 0 },     .{ 1, 0, 0 },   .{ 1, 1, 0 },
        .{ 0, 0, 0 },     .{ 1, 1, 0 },   .{ 0, 1, 0 },
        .{ 3.5, 0.4, 0 }, .{ 4, 0, 0 },   .{ 3.5, 1, 0 },
        .{ 3.5, 0.4, 0 }, .{ 3.5, 1, 0 }, .{ 3, 0, 0 },
        .{ 3.5, 0.4, 0 }, .{ 3, 0, 0 },   .{ 4, 0, 0 },
    };
    for (corners, 0..) |corner, row| {
        soup[row * 8 + 0] = corner[0];
        soup[row * 8 + 1] = corner[1];
        soup[row * 8 + 2] = corner[2];
    }
    const groups = try indexed_edit_mesh.inferQuadFaceGroups(testing.allocator, soup[0..], 5);
    defer testing.allocator.free(groups);
    try testing.expectEqual(groups[0], groups[1]);
    try testing.expect(groups[2] != groups[3]);
    try testing.expect(groups[3] != groups[4]);
    try testing.expect(groups[2] != groups[4]);
}

const bevel_cube_corners = [8][3]f32{
    .{ -0.5, -0.5, -0.5 }, .{ 0.5, -0.5, -0.5 }, .{ 0.5, -0.5, 0.5 }, .{ -0.5, -0.5, 0.5 },
    .{ -0.5, 0.5, -0.5 },  .{ 0.5, 0.5, -0.5 },  .{ 0.5, 0.5, 0.5 },  .{ -0.5, 0.5, 0.5 },
};

fn bevelCubeSoup(out: []f32) void {
    const quads = [6][4]u32{
        .{ 4, 7, 6, 5 }, .{ 0, 1, 2, 3 }, .{ 0, 4, 5, 1 },
        .{ 3, 2, 6, 7 }, .{ 0, 3, 7, 4 }, .{ 1, 5, 6, 2 },
    };
    const quad_uvs = [4][2]f32{ .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } };
    var triangle: usize = 0;
    for (quads) |quad| {
        const splits = [2][3]u32{ .{ 0, 1, 2 }, .{ 0, 2, 3 } };
        for (splits) |split| {
            for (split, 0..) |quad_corner, output_corner| {
                const base = (triangle * 3 + output_corner) * 8;
                const position = bevel_cube_corners[quad[quad_corner]];
                @memcpy(out[base .. base + 3], position[0..]);
                out[base + 6] = quad_uvs[quad_corner][0];
                out[base + 7] = quad_uvs[quad_corner][1];
            }
            triangle += 1;
        }
    }
}

fn expectDurableBevelLowering(lowered: *const indexed_edit_mesh.Lowered, expected_triangles: u32) !void {
    try testing.expectEqual(expected_triangles, lowered.tri_count);
    try testing.expectEqual(@as(usize, expected_triangles) * 9, lowered.positions.len);
    try testing.expectEqual(@as(usize, expected_triangles) * 6, lowered.uvs.len);
    for (lowered.parts) |part| try testing.expectEqual(@as(u32, 7), part);
    for (lowered.materials) |material| try testing.expectEqual(@as(u32, 3), material);
    for (lowered.uvs) |uv| {
        try testing.expect(std.math.isFinite(uv));
        try testing.expect(uv >= 0 and uv <= 1);
    }
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

test "bevel vertex selection boundary restores one part-owned welded index" {
    var soup = [_]f32{0} ** (12 * 3 * 8);
    bevelCubeSoup(soup[0..]);
    const groups = [_]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    mesh_edit.test_support.loadGroupedSoup(3456, soup[0..], 36, groups[0..]);
    defer mesh_edit.test_support.clear();
    mesh_edit.test_support.setPartRanges(&.{ 0, 6 });

    try testing.expect(mesh_edit.selectVertexByIndex(0, false));
    try testing.expectEqual(@as(?u32, 0), mesh_edit.selectedVertexIndexPub());
    try testing.expectEqual(@as(?u32, 0), mesh_edit.selectedVertexPartPub());
    try testing.expect(mesh_edit.selectVertexByIndex(1, true));
    try testing.expect(mesh_edit.selectedVertexIndexPub() == null);
    mesh_edit.clearSelection();
    try testing.expect(mesh_edit.selectVertexByIndex(0, false));
    try testing.expectEqual(@as(?u32, 0), mesh_edit.selectedVertexIndexPub());
}

test "indexed edge bevel replaces a sharp cube edge with one durable chamfer face" {
    var soup = [_]f32{0} ** (12 * 3 * 8);
    bevelCubeSoup(soup[0..]);
    const groups = [_]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    const parts = [_]u32{7} ** 12;
    const materials = [_]u32{3} ** 12;
    var indexed = try indexed_edit_mesh.Mesh.fromSoupWithMaterials(
        testing.allocator,
        soup[0..],
        12,
        groups[0..],
        parts[0..],
        materials[0..],
    );
    defer indexed.deinit();

    const selection = indexed.resolveBevelEdge(bevel_cube_corners[1], bevel_cube_corners[5], 7) orelse
        return error.ExpectedSharpManifoldEdge;
    try testing.expectApproxEqAbs(indexed_edit_mesh.BevelTuning.vertex_edge_fraction, selection.max_width, 0.00001);
    const edge = switch (selection.target) {
        .edge => |value| value,
        .vertex => return error.ExpectedEdgeTarget,
    };
    try testing.expect(try indexed.bevel(selection.target, indexed_edit_mesh.BevelTuning.default_width_m));
    try testing.expectEqual(@as(usize, 12), indexed.vertices.items.len);
    try testing.expect(!indexed.vertices.items[edge[0]].alive);
    try testing.expect(!indexed.vertices.items[edge[1]].alive);

    var lowered = try indexed.lower();
    defer lowered.deinit();
    try expectDurableBevelLowering(&lowered, 16);
    var saw_fresh_group = false;
    for (lowered.groups) |group| if (group >= 6) {
        saw_fresh_group = true;
    };
    try testing.expect(saw_fresh_group);
}

test "indexed vertex bevel clips a cube corner and caps its three-edge ring" {
    var soup = [_]f32{0} ** (12 * 3 * 8);
    bevelCubeSoup(soup[0..]);
    const groups = [_]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    const parts = [_]u32{7} ** 12;
    const materials = [_]u32{3} ** 12;
    var indexed = try indexed_edit_mesh.Mesh.fromSoupWithMaterials(
        testing.allocator,
        soup[0..],
        12,
        groups[0..],
        parts[0..],
        materials[0..],
    );
    defer indexed.deinit();

    const selection = indexed.resolveBevelVertex(bevel_cube_corners[6], 7) orelse
        return error.ExpectedThreeEdgeCorner;
    try testing.expectApproxEqAbs(indexed_edit_mesh.BevelTuning.vertex_edge_fraction, selection.max_width, 0.00001);
    const vertex = switch (selection.target) {
        .vertex => |value| value,
        .edge => return error.ExpectedVertexTarget,
    };
    try testing.expect(try indexed.bevel(selection.target, indexed_edit_mesh.BevelTuning.default_width_m));
    try testing.expectEqual(@as(usize, 11), indexed.vertices.items.len);
    try testing.expect(!indexed.vertices.items[vertex].alive);

    var lowered = try indexed.lower();
    defer lowered.deinit();
    try expectDurableBevelLowering(&lowered, 16);
}

test "indexed bevel rejects boundary edges and flat triangulation seams" {
    var soup = [_]f32{0} ** (2 * 3 * 8);
    const corners = [6][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 },
        .{ 0, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 },
    };
    for (corners, 0..) |position, corner| {
        const base = corner * 8;
        @memcpy(soup[base .. base + 3], position[0..]);
    }
    const groups = [_]u32{ 0, 1 };
    const parts = [_]u32{ 7, 7 };
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 2, groups[0..], parts[0..]);
    defer indexed.deinit();

    try testing.expect(indexed.resolveBevelEdge(corners[0], corners[1], 7) == null);
    try testing.expect(indexed.resolveBevelEdge(corners[0], corners[2], 7) == null);
}

// Keep the mesh module's co-located lower-level tests in this unit target too.
test {
    std.testing.refAllDecls(mesh_edit);
}
