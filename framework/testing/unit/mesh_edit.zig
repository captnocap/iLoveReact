//! Focused regressions for the native mesh-edit boundary contract.
//! Run: zig build test-mesh-edit

const std = @import("std");
const testing = std.testing;
const mesh_edit = @import("mesh_edit");
const indexed_edit_mesh = @import("indexed_edit_mesh");

test "indexed mesh checked teardown preserves valid owned storage" {
    var mesh = indexed_edit_mesh.Mesh{ .allocator = testing.allocator };
    try mesh.vertices.append(testing.allocator, .{ .position = .{ 1, 2, 3 } });
    try testing.expect(mesh.deinitRefusal() == null);
    try testing.expect(mesh.deinitChecked(0x1234));
}

test "indexed mesh checked teardown refuses the observed low faces pointer" {
    const bad_address = std.heap.page_size_min / 2;
    const bad_faces: [*]indexed_edit_mesh.Face = @ptrFromInt(bad_address);
    var mesh = indexed_edit_mesh.Mesh{ .allocator = testing.allocator };
    mesh.faces = .{ .items = bad_faces[0..1], .capacity = 1 };

    const refusal = mesh.deinitRefusal().?;
    try testing.expectEqual(indexed_edit_mesh.MeshStorageField.faces, refusal.field);
    try testing.expectEqual(bad_address, refusal.address);
    try testing.expectEqual(@as(usize, 1), refusal.len);
    try testing.expectEqual(@as(usize, 1), refusal.capacity);
    try testing.expect(!mesh.deinitChecked(0x5678));
}

test "indexed mesh checked teardown validates nested face storage before freeing" {
    const bad_address = std.heap.page_size_min / 2;
    const bad_vertices: [*]u32 = @ptrFromInt(bad_address);
    var mesh = indexed_edit_mesh.Mesh{ .allocator = testing.allocator };
    try mesh.faces.append(testing.allocator, .{ .id = 0, .group = 0, .part = 0 });
    mesh.faces.items[0].vertices = .{ .items = bad_vertices[0..1], .capacity = 1 };

    const refusal = mesh.deinitRefusal().?;
    try testing.expectEqual(indexed_edit_mesh.MeshStorageField.face_vertices, refusal.field);
    try testing.expectEqual(@as(?usize, 0), refusal.owner_index);
    try testing.expect(!mesh.deinitChecked(0x9abc));

    // The refusal deliberately leaves ownership untouched for diagnosis.  Once
    // the damaged header is restored, the legitimate allocations still release.
    mesh.faces.items[0].vertices = .empty;
    try testing.expect(mesh.deinitChecked(0xdef0));
}

test "manual retopology tint preserves the user's exact face mask" {
    var labels = [_]u16{mesh_edit.RETOPO_BAND_UNASSIGNED} ** 6;
    const first = [_]bool{ false, true, true, false, true, false };
    try testing.expectEqual(@as(u32, 3), mesh_edit.assignRetopoManualBand(labels[0..], first[0..], 4));
    try testing.expectEqualSlices(u16, &.{ mesh_edit.RETOPO_BAND_UNASSIGNED, 4, 4, mesh_edit.RETOPO_BAND_UNASSIGNED, 4, mesh_edit.RETOPO_BAND_UNASSIGNED }, labels[0..]);

    const erase = [_]bool{ false, false, true, false, true, false };
    try testing.expectEqual(@as(u32, 2), mesh_edit.assignRetopoManualBand(labels[0..], erase[0..], null));
    try testing.expectEqualSlices(u16, &.{ mesh_edit.RETOPO_BAND_UNASSIGNED, 4, mesh_edit.RETOPO_BAND_UNASSIGNED, mesh_edit.RETOPO_BAND_UNASSIGNED, mesh_edit.RETOPO_BAND_UNASSIGNED, mesh_edit.RETOPO_BAND_UNASSIGNED }, labels[0..]);
}

test "manual retopology tint follows topology provenance and face compaction" {
    const labels = [_]u16{ 2, 2, 7, mesh_edit.RETOPO_BAND_UNASSIGNED };
    const sources = [_]u32{ 0, 0, 1, 2, 2, 3 };
    var inherited: [sources.len]u16 = undefined;
    try testing.expect(mesh_edit.inheritRetopoManualBands(labels[0..], sources[0..], inherited[0..]));
    try testing.expectEqualSlices(u16, &.{ 2, 2, 2, 7, 7, mesh_edit.RETOPO_BAND_UNASSIGNED }, inherited[0..]);
    try testing.expect(!mesh_edit.inheritRetopoManualBands(labels[0..], &.{ 0, 4 }, inherited[0..2]));

    const removed = [_]bool{ false, true, false, true };
    var compacted: [2]u16 = undefined;
    try testing.expect(mesh_edit.compactRetopoManualBands(labels[0..], removed[0..], compacted[0..]));
    try testing.expectEqualSlices(u16, &.{ 2, 7 }, compacted[0..]);

    try testing.expectEqual(@as(?u16, 2), mesh_edit.uniformRetopoManualBand(labels[0..], &.{ true, true, false, false }));
    try testing.expectEqual(@as(?u16, null), mesh_edit.uniformRetopoManualBand(labels[0..], &.{ true, false, true, false }));
    try testing.expectEqual(@as(?u16, null), mesh_edit.uniformRetopoManualBand(labels[0..], &.{ false, false, false, true }));

    try testing.expect(mesh_edit.retopoSourceGhostTracks(4, 4, 4, 4));
    try testing.expect(!mesh_edit.retopoSourceGhostTracks(4, 5, 4, 4));
    try testing.expect(!mesh_edit.retopoSourceGhostTracks(4, 4, 4, 5));
    try testing.expectEqual(@as(u32, 3), mesh_edit.assignedRetopoBandCount(labels[0..]));
}

test "retopology teaching guide survives an exact package round trip" {
    const live = [_]u16{ 2, mesh_edit.RETOPO_BAND_UNASSIGNED, 7 };
    const source = [_]u16{ 2, 2, 7, mesh_edit.RETOPO_BAND_UNASSIGNED };
    const positions = [_]f32{
        0, 0, 0, 1, 0, 0, 0, 1, 0,
        1, 0, 0, 1, 1, 0, 0, 1, 0,
        0, 1, 0, 1, 1, 0, 0, 2, 0,
        1, 1, 0, 1, 2, 0, 0, 2, 0,
    };
    const bytes = try mesh_edit.encodeRetopoGuide(testing.allocator, .{
        .live_bands = &live,
        .source_positions = &positions,
        .source_bands = &source,
        .ghost_visible = true,
        .source_tracks_live = false,
    });
    defer testing.allocator.free(bytes);
    var decoded = try mesh_edit.decodeRetopoGuide(testing.allocator, bytes);
    defer decoded.deinit(testing.allocator);

    try testing.expectEqualSlices(u16, &live, decoded.live_bands);
    try testing.expectEqualSlices(u16, &source, decoded.source_bands);
    try testing.expectEqualSlices(f32, &positions, decoded.source_positions);
    try testing.expect(decoded.ghost_visible);
    try testing.expect(!decoded.source_tracks_live);
}

test "retopology teaching guide rejects stale or corrupt records" {
    try testing.expectError(error.InvalidRetopoGuide, mesh_edit.encodeRetopoGuide(testing.allocator, .{
        .live_bands = &.{mesh_edit.RetopoBandTuning.max_bands},
        .source_positions = &.{ 0, 0, 0, 1, 0, 0, 0, 1, 0 },
        .source_bands = &.{0},
        .ghost_visible = false,
        .source_tracks_live = true,
    }));
    try testing.expectError(error.InvalidRetopoGuide, mesh_edit.decodeRetopoGuide(testing.allocator, &.{ 1, 2, 3, 4 }));
}

test "retopology axis bands cover every face and retain phase-relative buckets" {
    const positions = [_]f32{
        0, 0.10, 0, 1, 0.10, 0, 0, 0.10, 1,
        0, 0.60, 0, 1, 0.60, 0, 0, 0.60, 1,
        0, 1.10, 0, 1, 1.10, 0, 0, 1.10, 1,
    };
    var plan = try mesh_edit.planRetopoAxisBands(testing.allocator, positions[0..], 3, 1, 0.5, 0.25);
    defer plan.deinit(testing.allocator);

    try testing.expectEqual(@as(u8, 1), plan.axis);
    try testing.expectEqual(@as(usize, 3), plan.faces.len);
    try testing.expectEqualSlices(u16, &.{ 0, 1, 2 }, plan.faces);
    try testing.expectEqual(@as(usize, 3), plan.bands.len);
    try testing.expectEqual(@as(i32, -1), plan.bands[0].bucket);
    try testing.expectEqual(@as(i32, 0), plan.bands[1].bucket);
    try testing.expectEqual(@as(i32, 1), plan.bands[2].bucket);
    var covered: u32 = 0;
    for (plan.bands) |band| covered += band.faces;
    try testing.expectEqual(@as(u32, 3), covered);
}

test "retopology rail bands follow local sloped rails instead of global y slabs" {
    const positions = [_]f32{
        0.4, 0.60,  0, 0.6, 0.60,  0, 0.5, 0.60,  0.1,
        0.4, 1.60,  0, 0.6, 1.60,  0, 0.5, 1.60,  0.1,
        0.4, -0.40, 0, 0.6, -0.40, 0, 0.5, -0.40, 0.1,
    };
    // At x=.5 the interpolated rails are y=.1 and y=1.1. The three
    // triangles therefore land inside, one band above, and one below.
    const rails = [_]f32{
        0, 0,   0, 0, 1,   0,
        1, 0.2, 0, 1, 1.2, 0,
    };
    var plan = try mesh_edit.planRetopoRailBands(testing.allocator, positions[0..], 3, rails[0..]);
    defer plan.deinit(testing.allocator);
    try testing.expectEqual(mesh_edit.RetopoBandMode.rails, plan.mode);
    try testing.expectEqual(@as(u16, 2), plan.rail_samples);
    try testing.expectEqualSlices(u16, &.{ 1, 2, 0 }, plan.faces);
    try testing.expectEqual(@as(i32, -1), plan.bands[0].bucket);
    try testing.expectEqual(@as(i32, 0), plan.bands[1].bucket);
    try testing.expectEqual(@as(i32, 1), plan.bands[2].bucket);
}

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

test "detach repartitions durable logical vertices at the new part boundary" {
    // Two triangles share logical vertices 1 and 2 while they belong to one part.
    // Detach moves the second triangle into a different part. Those two addresses
    // must split even though their positions remain coincident; otherwise moving
    // the detached part mutates the indexed guard's copy of the body seam and a
    // rigid translation is falsely reported as a concave edit.
    const logical = [_]u32{ 0, 1, 2, 2, 1, 3 };
    const joined_parts = [_]u32{ 0, 0 };
    var joined = try indexed_edit_mesh.partitionLogicalCornersByPart(
        testing.allocator,
        logical[0..],
        joined_parts[0..],
        4,
    );
    defer joined.deinit(testing.allocator);
    try testing.expectEqual(@as(u32, 4), joined.vertex_count);
    try testing.expectEqualSlices(u32, logical[0..], joined.rows);

    const detached_parts = [_]u32{ 0, 1 };
    var detached = try indexed_edit_mesh.partitionLogicalCornersByPart(
        testing.allocator,
        logical[0..],
        detached_parts[0..],
        4,
    );
    defer detached.deinit(testing.allocator);
    try testing.expectEqual(@as(u32, 6), detached.vertex_count);
    try testing.expectEqualSlices(u32, &.{ 0, 1, 2, 3, 4, 5 }, detached.rows);
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

test "meshdoc v5 snapshot compacts native ids once across hidden and glass reorder" {
    var glass = [_]f32{0} ** 24;
    var solid = [_]f32{0} ** 24;
    // Stable ids 90 and 100 appear in both blocks with the same positions. Normal/UV
    // rows intentionally differ because those are render-corner attributes.
    glass[0] = 0;
    glass[1] = 0;
    glass[8] = 1;
    glass[9] = 0;
    glass[16] = 0;
    glass[17] = 1;
    glass[3] = 1;
    glass[6] = 0.25;
    solid[0] = 1;
    solid[1] = 0;
    solid[8] = 0;
    solid[9] = 0;
    solid[16] = 1;
    solid[17] = 1;
    solid[3] = 9;
    solid[6] = 0.75;
    const glass_ids = [_]u32{ 90, 100, 110 };
    const opaque_ids = [_]u32{ 100, 90, 120 };
    const glass_color = [_]u8{ 20, 30, 40, 80 };
    const opaque_color = [_]u8{ 20, 30, 40, 255 };
    var snapshot = try mesh_edit.composeMeshDocSnapshot(testing.allocator, &.{
        .{ .verts = glass[0..], .render_corner_logical_ids = glass_ids[0..], .colors = glass_color[0..] },
        .{ .verts = solid[0..], .render_corner_logical_ids = opaque_ids[0..], .colors = opaque_color[0..] },
    });
    defer snapshot.deinit(testing.allocator);

    try testing.expectEqual(@as(u32, 3), snapshot.glass_first_vertex);
    try testing.expectEqual(@as(u32, 4), snapshot.logical_vertex_count);
    try testing.expectEqualSlices(u32, &.{ 90, 100, 110, 120 }, snapshot.dense_to_stable_logical_ids.?);
    try testing.expectEqualSlices(u32, &.{ 1, 0, 3, 0, 1, 2 }, snapshot.render_corner_logical_ids.?);
}

test "meshdoc v5 snapshot rejects one logical id at separated positions" {
    var first = [_]f32{0} ** 24;
    var second = [_]f32{0} ** 24;
    first[8] = 1;
    first[17] = 1;
    second[0] = 0.01;
    second[8] = 1;
    second[17] = 1;
    try testing.expectError(error.InvalidLogicalTopology, mesh_edit.composeMeshDocSnapshot(testing.allocator, &.{
        .{ .verts = first[0..], .render_corner_logical_ids = &.{ 0, 1, 2 } },
        .{ .verts = second[0..], .render_corner_logical_ids = &.{ 0, 1, 2 } },
    }));
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

test "RJMD v5 indexed hydration trusts logical ids instead of position welding" {
    var soup = [_]f32{0} ** (6 * 8);
    const positions = [_][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 0, 1, 0 },
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 0, -1, 0 },
    };
    for (positions, 0..) |position, corner| {
        const at = corner * 8;
        soup[at] = position[0];
        soup[at + 1] = position[1];
        soup[at + 2] = position[2];
    }
    const logical_ids = [_]u32{ 0, 1, 2, 3, 4, 5 };
    var indexed = try indexed_edit_mesh.Mesh.fromSoupWithLogicalSemantics(
        testing.allocator,
        soup[0..],
        2,
        null,
        null,
        null,
        null,
        null,
        logical_ids[0..],
        6,
    );
    defer indexed.deinit();
    try testing.expectEqual(@as(usize, 6), indexed.vertices.items.len);
    try testing.expectEqualSlices(u32, &.{ 0, 1, 2 }, indexed.render_triangles.items[0][0..]);
    try testing.expectEqualSlices(u32, &.{ 3, 4, 5 }, indexed.render_triangles.items[1][0..]);
    try testing.expect(indexed.residentLogicalTopologyMatches(logical_ids[0..], 6));
    try testing.expect(!indexed.residentLogicalTopologyMatches(null, 0));

    soup[3 * 8] = 0.01;
    try testing.expectError(error.InvalidLogicalTopology, indexed_edit_mesh.Mesh.fromSoupWithLogicalSemantics(
        testing.allocator,
        soup[0..],
        2,
        null,
        null,
        null,
        null,
        null,
        &.{ 0, 1, 2, 0, 4, 5 },
        6,
    ));
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

test "stale edge bits outside the Outliner scope cannot enter topology tools" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
        3, 0, 0, 0, 0, 1, 0, 0,
        4, 0, 0, 0, 0, 1, 0, 0,
        3, 1, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3904, soup[0..], 6, &.{ 0, 1 });
    defer mesh_edit.test_support.clear();
    mesh_edit.test_support.setPartRanges(&.{ 0, 1, 1, 2 });
    mesh_edit.setEditScope(0, 1);
    try testing.expect(mesh_edit.ensureTopologyPub());

    var part_zero_edge: ?u32 = null;
    var part_one_edge: ?u32 = null;
    var edge: u32 = 0;
    while (edge < mesh_edit.edgeCount()) : (edge += 1) {
        if (!mesh_edit.edgeIsBoundaryPub(edge)) continue;
        const endpoints = mesh_edit.edgeEndpointsPub(edge);
        const part = mesh_edit.vertPartPub(endpoints[0]) orelse continue;
        if (part == 0 and part_zero_edge == null) part_zero_edge = edge;
        if (part == 1 and part_one_edge == null) part_one_edge = edge;
    }
    try testing.expect(part_zero_edge != null and part_one_edge != null);
    try testing.expect(mesh_edit.test_support.forceEdgeSelection(&.{ part_zero_edge.?, part_one_edge.? }));

    // The compact inspector can still report both raw bits for surgery, but every
    // topology boundary sees only the edge owned by the focused part.
    try testing.expectEqual(@as(u32, 1), mesh_edit.selectedEdgeCountPub());
    try testing.expectEqual(part_zero_edge.?, mesh_edit.selectedEdgeIndexPub().?);
    try testing.expectEqual(@as(u32, 0), mesh_edit.selectedEdgesCommonPartPub().?);
    var selected: [2]mesh_edit.Edge = undefined;
    try testing.expectEqual(@as(u32, 1), mesh_edit.selectedEdgesPub(selected[0..]));
    try testing.expectEqual(mesh_edit.edgeEndpointsPub(part_zero_edge.?), selected[0]);
}

test "follow patch records exact selected triangles and their next adjacency ring" {
    var soup = [_]f32{0} ** (9 * 8);
    const positions = [_][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 0, 1, 0 },
        .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 },
        .{ 1, 0, 0 }, .{ 2, 0, 0 }, .{ 1, 1, 0 },
    };
    for (positions, 0..) |position, row| {
        soup[row * 8] = position[0];
        soup[row * 8 + 1] = position[1];
        soup[row * 8 + 2] = position[2];
        soup[row * 8 + 5] = 1;
    }
    mesh_edit.test_support.loadGroupedSoup(3617, soup[0..], 9, &.{ 10, 11, 12 });
    defer mesh_edit.test_support.clear();

    try testing.expect(mesh_edit.selectFaceByIndex(0, false));
    try testing.expect(mesh_edit.selectFaceByIndex(1, true));
    const before = mesh_edit.followPatchJson(testing.allocator, null, 1) orelse return error.TestUnexpectedResult;
    defer testing.allocator.free(before);
    try testing.expect(std.mem.indexOf(u8, before, "\"selectedTriangles\":[0,1]") != null);
    try testing.expect(std.mem.indexOf(u8, before, "\"selectedGroups\":[10,11]") != null);
    try testing.expect(std.mem.indexOf(u8, before, "\"id\":2,\"selected\":false") != null);
    try testing.expect(std.mem.indexOf(u8, before, "\"outside\":2") != null);

    // Merge Faces keeps resident triangle ids and welded vertices fixed; only the
    // authored grouping changes. Re-reading the recorded ids therefore proves the
    // exact before/after lesson without a second mesh snapshot.
    mesh_edit.test_support.regroup(&.{ 21, 21, 12 });
    const after = mesh_edit.followPatchJson(testing.allocator, &.{ 0, 1 }, 1) orelse return error.TestUnexpectedResult;
    defer testing.allocator.free(after);
    try testing.expect(std.mem.indexOf(u8, after, "\"selectedGroups\":[21]") != null);
    try testing.expect(std.mem.indexOf(u8, after, "\"vertices\":[0,1,2]") != null);
}

test "selection snapshot exposes the native face edge and vertex facts the inspector shows" {
    var soup = [_]f32{0} ** (6 * 8);
    const positions = [_][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 0, 1, 0 },
        .{ 1, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 },
    };
    for (positions, 0..) |position, row| {
        soup[row * 8] = position[0];
        soup[row * 8 + 1] = position[1];
        soup[row * 8 + 2] = position[2];
        soup[row * 8 + 5] = 1;
    }
    mesh_edit.test_support.loadGroupedSoup(3828, soup[0..], 6, &.{ 10, 10 });
    defer mesh_edit.test_support.clear();
    mesh_edit.test_support.setPartRanges(&.{ 10, 11 });

    try testing.expect(mesh_edit.selectFaceByIndex(0, false));
    const face_json = mesh_edit.selectionSnapshotJson(testing.allocator) orelse return error.MissingFaceSelectionSnapshot;
    defer testing.allocator.free(face_json);
    try testing.expect(std.mem.indexOf(u8, face_json, "\"mode\":3,\"count\":1,\"affectedVertices\":4,\"selectedTriangles\":2") != null);
    try testing.expect(std.mem.indexOf(u8, face_json, "\"group\":10,\"part\":0,\"material\":null,\"region\":null,\"instance\":null") != null);
    try testing.expect(std.mem.indexOf(u8, face_json, "\"normal\":[0,0,1],\"area\":0.5") != null);

    try testing.expect(mesh_edit.selectVertexByIndex(0, false));
    const vertex_json = mesh_edit.selectionSnapshotJson(testing.allocator) orelse return error.MissingVertexSelectionSnapshot;
    defer testing.allocator.free(vertex_json);
    try testing.expect(std.mem.indexOf(u8, vertex_json, "\"mode\":1,\"count\":1,\"affectedVertices\":1,\"selectedTriangles\":0") != null);
    try testing.expect(std.mem.indexOf(u8, vertex_json, "\"vertices\":[{\"id\":0,\"at\":[0,0,0],\"part\":0}]") != null);

    var boundary: ?u32 = null;
    var edge: u32 = 0;
    while (edge < mesh_edit.edgeCount()) : (edge += 1) {
        if (mesh_edit.edgeIsBoundaryPub(edge)) {
            boundary = edge;
            break;
        }
    }
    try testing.expect(boundary != null);
    try testing.expect(mesh_edit.selectEdgeByIndex(boundary.?, false));
    const edge_json = mesh_edit.selectionSnapshotJson(testing.allocator) orelse return error.MissingEdgeSelectionSnapshot;
    defer testing.allocator.free(edge_json);
    try testing.expect(std.mem.indexOf(u8, edge_json, "\"mode\":2,\"count\":1,\"affectedVertices\":2,\"selectedTriangles\":0") != null);
    try testing.expect(std.mem.indexOf(u8, edge_json, "\"length\":1,\"faces\":1,\"open\":true,\"part\":0") != null);
}

test "measurement bounds prefer selection then focused scope then the whole model" {
    var soup = [_]f32{0} ** (6 * 8);
    const positions = [_][3]f32{
        .{ -1, 0, 0 },  .{ 1, 0, 0 },   .{ -1, 2, 0 },
        .{ 10, -2, 3 }, .{ 14, -2, 3 }, .{ 10, 1, 7 },
    };
    for (positions, 0..) |position, row| {
        soup[row * 8] = position[0];
        soup[row * 8 + 1] = position[1];
        soup[row * 8 + 2] = position[2];
        soup[row * 8 + 5] = 1;
    }
    mesh_edit.test_support.loadGroupedSoup(4234, soup[0..], 6, &.{ 10, 20 });
    defer mesh_edit.test_support.clear();

    mesh_edit.setMode(.none);
    const whole = mesh_edit.measurementBoundsPub() orelse return error.MissingModelMeasurement;
    try testing.expectEqual(mesh_edit.MeasurementSubject.model, whole.subject);
    try testing.expectEqualSlices(f32, &.{ -1, -2, 0 }, &whole.min);
    try testing.expectEqualSlices(f32, &.{ 14, 2, 7 }, &whole.max);

    mesh_edit.setEditScope(10, 11);
    const focused = mesh_edit.measurementBoundsPub() orelse return error.MissingScopeMeasurement;
    try testing.expectEqual(mesh_edit.MeasurementSubject.scope, focused.subject);
    try testing.expectEqualSlices(f32, &.{ -1, 0, 0 }, &focused.min);
    try testing.expectEqualSlices(f32, &.{ 1, 2, 0 }, &focused.max);
    const focused_size = focused.size();
    try testing.expectEqualSlices(f32, &.{ 2, 2, 0 }, &focused_size);

    mesh_edit.setEditScope(0, 0);
    try testing.expect(mesh_edit.selectFaceByIndex(1, false));
    const selected = mesh_edit.measurementBoundsPub() orelse return error.MissingSelectionMeasurement;
    try testing.expectEqual(mesh_edit.MeasurementSubject.selection, selected.subject);
    try testing.expectEqualSlices(f32, &.{ 10, -2, 3 }, &selected.min);
    try testing.expectEqualSlices(f32, &.{ 14, 1, 7 }, &selected.max);
    const selected_size = selected.size();
    try testing.expectEqualSlices(f32, &.{ 4, 3, 4 }, &selected_size);
}

test "neutral view suppresses edit selection without destroying its dormant set" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(4237, soup[0..], 3, &.{42});
    defer mesh_edit.test_support.clear();

    try testing.expect(mesh_edit.selectFaceByIndex(0, false));
    try testing.expectEqual(mesh_edit.Mode.face, mesh_edit.mode());
    try testing.expectEqual(@as(u32, 1), mesh_edit.selCount());

    mesh_edit.setMode(.none);
    try testing.expectEqual(@as(u32, 0), mesh_edit.selCount());

    mesh_edit.setMode(.face);
    try testing.expectEqual(@as(u32, 1), mesh_edit.selCount());
}

test "follow action queue retains rapid native lessons and drains them exactly once" {
    var queue: mesh_edit.FollowActionQueue = .{};
    defer queue.deinit(testing.allocator);

    try queue.append(testing.allocator, 5, 2, "{\"version\":1,\"selectedTriangles\":[4,5]}", "{\"version\":1,\"deleted\":true}");
    try queue.append(testing.allocator, 2, 4, "{\"version\":1,\"selectedEdges\":[8,9]}", "{\"version\":1,\"selectedTriangles\":[6,7],\"selectedGroups\":[78]}");

    const first = try queue.drainJson(testing.allocator);
    defer testing.allocator.free(first);
    try testing.expect(std.mem.indexOf(u8, first, "\"source\":2") != null);
    try testing.expect(std.mem.indexOf(u8, first, "\"source\":4") != null);
    try testing.expect(std.mem.indexOf(u8, first, "\"kind\":5") != null);
    try testing.expect(std.mem.indexOf(u8, first, "\"kind\":2") != null);
    try testing.expect(std.mem.indexOf(u8, first, "\"selectedTriangles\":[4,5]") != null);
    try testing.expect(std.mem.indexOf(u8, first, "\"selectedEdges\":[8,9]") != null);

    const second = try queue.drainJson(testing.allocator);
    defer testing.allocator.free(second);
    try testing.expectEqualStrings("{\"version\":1,\"events\":[]}", second);
}

test "follow action queue never evicts an unconsumed demonstration" {
    var queue: mesh_edit.FollowActionQueue = .{};
    defer queue.deinit(testing.allocator);

    var index: usize = 0;
    while (index < 96) : (index += 1) {
        try queue.append(
            testing.allocator,
            @intCast(index % 33),
            0,
            "{\"version\":1,\"stream\":\"journal\"}",
            "{\"version\":1,\"accepted\":true}",
        );
    }
    const drained = try queue.drainJson(testing.allocator);
    defer testing.allocator.free(drained);
    try testing.expectEqual(@as(usize, 96), std.mem.count(u8, drained, "\"stream\":\"journal\""));
    try testing.expectEqual(@as(usize, 96), std.mem.count(u8, drained, "\"accepted\":true"));
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

test "mirrored basic cut keeps the clicked-face seed and splits both authored twins" {
    var soup = [_]f32{0} ** (4 * 3 * 8);
    windingQuad(soup[0..], 0, .{
        .{ -2, 0, -1 }, .{ 0, 0, -1 }, .{ 0, 0, 1 }, .{ -2, 0, 1 },
    }, .{ 0, -1, 0 });
    windingQuad(soup[0..], 2, .{
        .{ 2, 0, 1 }, .{ 0, 0, 1 }, .{ 0, 0, -1 }, .{ 2, 0, -1 },
    }, .{ 0, -1, 0 });
    const groups = [_]u32{ 10, 10, 20, 20 };
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(
        testing.allocator,
        soup[0..],
        4,
        groups[0..],
        null,
    );
    defer indexed.deinit();

    // The user clicked the later (+X) authored face. Capture its seed before live
    // mirror broadens the operation mask to include the earlier (-X) twin.
    var operation_mask = [_]bool{ false, false, true, true };
    const seed = indexed.seedInfo(operation_mask[0..]).?;
    try testing.expectEqual(@as(u32, 20), seed.keep_group);
    try testing.expectApproxEqAbs(@as(f32, 1), seed.center[0], 0.00001);
    operation_mask[0] = true;
    operation_mask[1] = true;

    try testing.expect(try indexed.cutSelected(operation_mask[0..], seed.directions[0], 1, 0.5));
    var lowered = try indexed.lower();
    defer lowered.deinit();
    // Each mirrored quad goes from two render triangles to four. A one-sided cut
    // would produce six total; eight proves both authored twins joined this edit.
    try testing.expectEqual(@as(u32, 8), lowered.tri_count);
    var source_station = false;
    var twin_station = false;
    var row: usize = 0;
    while (row + 2 < lowered.positions.len) : (row += 3) {
        const x = lowered.positions[row];
        if (@abs(x - 1) < 0.00001) source_station = true;
        if (@abs(x + 1) < 0.00001) twin_station = true;
    }
    try testing.expect(source_station);
    try testing.expect(twin_station);
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

test "create-face reference normal follows the neighboring authored surface" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3632, soup[0..], 6, &.{ 0, 0 });
    defer mesh_edit.test_support.clear();
    mesh_edit.setMode(.edge);
    try testing.expect(mesh_edit.ensureTopologyPub());

    var selected: u32 = 0;
    var edge: u32 = 0;
    while (edge < mesh_edit.edgeCount() and selected < 2) : (edge += 1) {
        if (!mesh_edit.edgeIsBoundaryPub(edge)) continue;
        try testing.expect(mesh_edit.selectEdgeByIndex(edge, selected != 0));
        selected += 1;
    }
    try testing.expectEqual(@as(u32, 2), selected);
    const normal = mesh_edit.selectedEdgesReferenceNormalPub().?;
    try testing.expectApproxEqAbs(@as(f32, 0), normal[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 0), normal[1], 0.0001);
    try testing.expect(normal[2] > 0.999);
}

test "bridge winding falls back to the quad's other two edges across a recess" {
    // Four authored faces around a missing quad: the faces beside the hole's left
    // and right edges are opposing flank walls (normals -x / +x), while the faces
    // above and below both face +z. Selecting the flank pair used to reject with
    // no derivable winding even though the identical quad bridges cleanly from the
    // top/bottom pair (req_3840).
    var soup = [_]f32{
        0,   1,   0,  0,  0, 1, 0, 0,
        1,   1,   0,  0,  0, 1, 0, 0,
        0.5, 2,   0,  0,  0, 1, 0, 0,
        1,   0,   0,  0,  0, 1, 0, 0,
        0,   0,   0,  0,  0, 1, 0, 0,
        0.5, -1,  0,  0,  0, 1, 0, 0,
        0,   1,   0,  -1, 0, 0, 0, 0,
        0,   0.5, -1, -1, 0, 0, 0, 0,
        0,   0,   0,  -1, 0, 0, 0, 0,
        1,   1,   0,  1,  0, 0, 0, 0,
        1,   0,   0,  1,  0, 0, 0, 0,
        1,   0.5, -1, 1,  0, 0, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3840, soup[0..], 12, &.{ 0, 1, 2, 3 });
    defer mesh_edit.test_support.clear();
    mesh_edit.setMode(.edge);
    try testing.expect(mesh_edit.ensureTopologyPub());

    var tl: ?u32 = null;
    var tr: ?u32 = null;
    var bl: ?u32 = null;
    var br: ?u32 = null;
    var vertex: u32 = 0;
    while (vertex < mesh_edit.vertCount()) : (vertex += 1) {
        const at = mesh_edit.vertPosPub(vertex);
        if (at[2] != 0) continue;
        if (at[0] == 0 and at[1] == 1) tl = vertex;
        if (at[0] == 1 and at[1] == 1) tr = vertex;
        if (at[0] == 0 and at[1] == 0) bl = vertex;
        if (at[0] == 1 and at[1] == 0) br = vertex;
    }
    const left: mesh_edit.Edge = .{ tl.?, bl.? };
    const right: mesh_edit.Edge = .{ tr.?, br.? };

    // The flank pair's own neighbors oppose: no agreed reference normal.
    var edge: u32 = 0;
    while (edge < mesh_edit.edgeCount()) : (edge += 1) {
        const ends = mesh_edit.edgeEndpointsPub(edge);
        const is_left = (ends[0] == left[0] and ends[1] == left[1]) or (ends[0] == left[1] and ends[1] == left[0]);
        const is_right = (ends[0] == right[0] and ends[1] == right[1]) or (ends[0] == right[1] and ends[1] == right[0]);
        if (is_left or is_right) try testing.expect(mesh_edit.selectEdgeByIndex(edge, true));
    }
    try testing.expect(mesh_edit.selectedEdgesReferenceNormalPub() == null);

    // The quad's other two edges (top and bottom) agree and carry the winding.
    const fallback = mesh_edit.bridgeCrossReferenceNormalPub(left, right, .{ tl.?, tr.? }, .{ bl.?, br.? }).?;
    try testing.expectApproxEqAbs(@as(f32, 0), fallback[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 0), fallback[1], 0.0001);
    try testing.expect(fallback[2] > 0.999);

    // Cross edges that do not exist (the diagonals) still reject the bridge.
    try testing.expect(mesh_edit.bridgeCrossReferenceNormalPub(left, right, .{ tl.?, br.? }, .{ bl.?, tr.? }) == null);
}

test "bridge winding follows the oriented boundary when every neighbor-normal pair disagrees" {
    // Four consistently wound triangles surround one missing quad, but each opposite
    // pair bends across a different hard transition. Normal averaging therefore has
    // no answer from either the selected edges or the other two sides. The boundary
    // circulation still has one exact answer: the new face must traverse every shared
    // edge opposite to its sole incident face (req_3963/req_3964).
    var soup = [_]f32{
        0,   0,   0, 0,  -1, -1, 0, 0,
        1,   0,   0, 0,  -1, -1, 0, 0,
        0.5, -1,  1, 0,  -1, -1, 0, 0,

        1,   0,   0, 1,  0,  -1, 0, 0,
        1,   1,   0, 1,  0,  -1, 0, 0,
        2,   0.5, 1, 1,  0,  -1, 0, 0,

        1,   1,   0, 0,  1,  -1, 0, 0,
        0,   1,   0, 0,  1,  -1, 0, 0,
        0.5, 2,   1, 0,  1,  -1, 0, 0,

        0,   1,   0, -1, 0,  -1, 0, 0,
        0,   0,   0, -1, 0,  -1, 0, 0,
        -1,  0.5, 1, -1, 0,  -1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3964, soup[0..], 12, &.{ 0, 1, 2, 3 });
    defer mesh_edit.test_support.clear();
    mesh_edit.setMode(.edge);
    try testing.expect(mesh_edit.ensureTopologyPub());

    var a: ?u32 = null;
    var b: ?u32 = null;
    var c: ?u32 = null;
    var d: ?u32 = null;
    var vertex: u32 = 0;
    while (vertex < mesh_edit.vertCount()) : (vertex += 1) {
        const at = mesh_edit.vertPosPub(vertex);
        if (at[2] != 0) continue;
        if (at[0] == 0 and at[1] == 0) a = vertex;
        if (at[0] == 1 and at[1] == 0) b = vertex;
        if (at[0] == 1 and at[1] == 1) c = vertex;
        if (at[0] == 0 and at[1] == 1) d = vertex;
    }
    const selected_0: mesh_edit.Edge = .{ a.?, b.? };
    const selected_1: mesh_edit.Edge = .{ c.?, d.? };

    var edge: u32 = 0;
    while (edge < mesh_edit.edgeCount()) : (edge += 1) {
        const ends = mesh_edit.edgeEndpointsPub(edge);
        const is_first = (ends[0] == selected_0[0] and ends[1] == selected_0[1]) or
            (ends[0] == selected_0[1] and ends[1] == selected_0[0]);
        const is_second = (ends[0] == selected_1[0] and ends[1] == selected_1[1]) or
            (ends[0] == selected_1[1] and ends[1] == selected_1[0]);
        if (is_first or is_second) try testing.expect(mesh_edit.selectEdgeByIndex(edge, true));
    }

    try testing.expect(mesh_edit.selectedEdgesReferenceNormalPub() == null);
    try testing.expect(mesh_edit.bridgeCrossReferenceNormalPub(
        selected_0,
        selected_1,
        .{ b.?, c.? },
        .{ d.?, a.? },
    ) == null);

    const reference = mesh_edit.bridgeBoundaryReferenceNormalPub(
        selected_0,
        selected_1,
        .{ a.?, b.?, c.?, d.? },
    ).?;
    try testing.expectApproxEqAbs(@as(f32, 0), reference[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 0), reference[1], 0.0001);
    try testing.expect(reference[2] < -0.999);
}

test "a side the quad already shares decides the bridge the selected pair cannot" {
    // req_4204. Two open edges joined by a THIRD edge are not an ambiguous bridge:
    // that edge is a side of the quad, it already carries a face, and the new face
    // must run it the other way. Here the two selected edges are wound against each
    // other, so both the neighbour-normal and boundary-circulation authorities go
    // silent, and only ONE of the quad's other two sides exists — which is exactly
    // the case the cross-reference rescue cannot serve, since it demands both.
    //
    //   v3 ─── v2      selected: (v0,v1) and (v2,v3)
    //   │  fill  │     absent:   (v1,v2)
    //   v0 ─── v1      present:  (v3,v0), carrying one face
    var soup = [_]f32{
        // face 0 — carries (v0,v1), running v0 → v1
        0,   0,    0, 0, 0, -1, 0, 0,
        1,   0,    0, 0, 0, -1, 0, 0,
        0.5, -1,   0, 0, 0, -1, 0, 0,

        // face 1 — carries (v2,v3), running v3 → v2: wound AGAINST face 0
        0,   1,    0, 0, 0, 1,  0, 0,
        1,   1,    0, 0, 0, 1,  0, 0,
        0.5, 2,    0, 0, 0, 1,  0, 0,

        // face 2 — the connecting side, carrying (v3,v0) and running v3 → v0
        0,   1,    0, 0, 0, -1, 0, 0,
        0,   0,    0, 0, 0, -1, 0, 0,
        -1,  0.5,  0, 0, 0, -1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(4204, soup[0..], 9, &.{ 0, 1, 2 });
    defer mesh_edit.test_support.clear();
    mesh_edit.setMode(.edge);
    try testing.expect(mesh_edit.ensureTopologyPub());

    var v0: ?u32 = null;
    var v1: ?u32 = null;
    var v2: ?u32 = null;
    var v3: ?u32 = null;
    var vertex: u32 = 0;
    while (vertex < mesh_edit.vertCount()) : (vertex += 1) {
        const at = mesh_edit.vertPosPub(vertex);
        if (at[0] == 0 and at[1] == 0) v0 = vertex;
        if (at[0] == 1 and at[1] == 0) v1 = vertex;
        if (at[0] == 1 and at[1] == 1) v2 = vertex;
        if (at[0] == 0 and at[1] == 1) v3 = vertex;
    }
    const selected_0: mesh_edit.Edge = .{ v0.?, v1.? };
    const selected_1: mesh_edit.Edge = .{ v2.?, v3.? };
    const candidate = [4]u32{ v0.?, v1.?, v2.?, v3.? };

    var edge: u32 = 0;
    while (edge < mesh_edit.edgeCount()) : (edge += 1) {
        const ends = mesh_edit.edgeEndpointsPub(edge);
        inline for (.{ selected_0, selected_1 }) |wanted| {
            if ((ends[0] == wanted[0] and ends[1] == wanted[1]) or
                (ends[0] == wanted[1] and ends[1] == wanted[0]))
            {
                try testing.expect(mesh_edit.selectEdgeByIndex(edge, true));
            }
        }
    }

    // Every authority that only ever looks at the SELECTED pair goes silent.
    try testing.expect(mesh_edit.selectedEdgesReferenceNormalPub() == null);
    try testing.expect(mesh_edit.bridgeBoundaryReferenceNormalPub(selected_0, selected_1, candidate) == null);
    // …and the cross-reference rescue cannot fire, because (v1,v2) does not exist.
    try testing.expect(mesh_edit.bridgeCrossReferenceNormalPub(
        selected_0,
        selected_1,
        .{ v1.?, v2.? },
        .{ v3.?, v0.? },
    ) == null);

    // The one side that IS there answers outright: face 2 runs v3 → v0, so the quad
    // must run v0 → v3, which is the reverse of the order written above.
    const reference = mesh_edit.bridgeConnectingSideReferenceNormalPub(selected_0, selected_1, candidate).?;
    try testing.expectApproxEqAbs(@as(f32, 0), reference[0], 0.0001);
    try testing.expectApproxEqAbs(@as(f32, 0), reference[1], 0.0001);
    try testing.expect(reference[2] < -0.999);

    // Abstaining is not agreeing: a loop whose other two sides are BOTH absent leaves
    // nothing to consult, and that still refuses rather than guessing a facing.
    try testing.expect(mesh_edit.bridgeConnectingSideReferenceNormalPub(
        selected_0,
        selected_1,
        .{ v0.?, v1.?, v3.?, v2.? },
    ) == null);
}

test "twin-edge probe requires matching face incidence between source and twin" {
    // A mirrored op must mean the same thing on both sides: a bridge built from an
    // open source edge must not land on a twin edge that already carries two faces
    // (req_3843 — twin create-face was stacking duplicates over filled sides), while
    // matching incidence keeps deliberate authored-seam ops bilateral.
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 1, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3843, soup[0..], 6, &.{ 0, 1 });
    defer mesh_edit.test_support.clear();
    try testing.expect(mesh_edit.ensureTopologyPub());

    var origin: ?u32 = null;
    var right: ?u32 = null;
    var far: ?u32 = null;
    var up: ?u32 = null;
    var vertex: u32 = 0;
    while (vertex < mesh_edit.vertCount()) : (vertex += 1) {
        const at = mesh_edit.vertPosPub(vertex);
        if (at[0] == 0 and at[1] == 0) origin = vertex;
        if (at[0] == 1 and at[1] == 0) right = vertex;
        if (at[0] == 1 and at[1] == 1) far = vertex;
        if (at[0] == 0 and at[1] == 1) up = vertex;
    }
    const open_source: mesh_edit.Edge = .{ origin.?, right.? };
    const seam: mesh_edit.Edge = .{ origin.?, far.? };

    // Open source (1 incident face) onto an open twin — legal.
    try testing.expect(mesh_edit.twinEdgeMatchesSourcePub(open_source, right.?, far.?));
    // Open source onto the filled interior diagonal (2 faces) — refused, even though
    // the edge itself exists.
    try testing.expect(mesh_edit.hasEdgeBetweenPub(origin.?, far.?));
    try testing.expect(!mesh_edit.twinEdgeMatchesSourcePub(open_source, origin.?, far.?));
    // Seam source onto a matching seam — stays bilateral.
    try testing.expect(mesh_edit.twinEdgeMatchesSourcePub(seam, origin.?, far.?));
    // A twin pair with no edge at all stays refused.
    try testing.expect(!mesh_edit.twinEdgeMatchesSourcePub(open_source, right.?, up.?));
}

test "create-face mirror mapping keeps endpoints on the symmetry seam" {
    // Two triangles meet on x=0. A Create Face bridge built from the +X boundary
    // needs the off-plane endpoint reflected to -X while the seam endpoint remains
    // the same welded vertex. Rejecting that self-image drops the complete twin face.
    var soup = [_]f32{
        0,  0, 0, 0, 0, 1, 0, 0,
        1,  0, 0, 0, 0, 1, 0, 0,
        0,  1, 0, 0, 0, 1, 0, 0,
        0,  0, 0, 0, 0, 1, 0, 0,
        0,  1, 0, 0, 0, 1, 0, 0,
        -1, 0, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(3838, soup[0..], 6, &.{ 0, 1 });
    defer {
        mesh_edit.test_support.clear();
        mesh_edit.setMirrorMask(0);
    }
    mesh_edit.setMirrorMask(1);
    try testing.expect(mesh_edit.ensureTopologyPub());

    var positive: ?u32 = null;
    var negative: ?u32 = null;
    var seam: ?u32 = null;
    var vertex: u32 = 0;
    while (vertex < mesh_edit.vertCount()) : (vertex += 1) {
        const at = mesh_edit.vertPosPub(vertex);
        if (at[0] == 1 and at[1] == 0 and at[2] == 0) positive = vertex;
        if (at[0] == -1 and at[1] == 0 and at[2] == 0) negative = vertex;
        if (at[0] == 0 and at[1] == 0 and at[2] == 0) seam = vertex;
    }

    const mirrored_outer = mesh_edit.mirrorImageOfVertPub(positive.?, 1).?;
    const mirrored_seam = mesh_edit.mirrorImageOfVertPub(seam.?, 1).?;
    try testing.expectEqual(negative.?, mirrored_outer);
    try testing.expectEqual(seam.?, mirrored_seam);
    try testing.expect(mesh_edit.hasEdgeBetweenPub(mirrored_outer, mirrored_seam));
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

test "align loop flattens a skewed vertex ring on its least-varying axis" {
    const corners = [4][3]f32{
        .{ -0.12, -1, -1 },
        .{ 0.08, 1, -1 },
        .{ 0.04, 1, 1 },
        .{ -0.10, -1, 1 },
    };
    var soup = [_]f32{0} ** (2 * 3 * 8);
    for ([2][3]u32{ .{ 0, 1, 2 }, .{ 0, 2, 3 } }, 0..) |triangle, face| {
        for (triangle, 0..) |corner, slot| {
            const at = (face * 3 + slot) * 8;
            @memcpy(soup[at .. at + 3], corners[corner][0..]);
        }
    }
    mesh_edit.test_support.loadGroupedSoup(4017, soup[0..], 6, &.{ 7, 7 });
    defer mesh_edit.test_support.clear();
    for (0..corners.len) |vertex| try testing.expect(mesh_edit.selectVertexByIndex(@intCast(vertex), vertex != 0));

    const alignment = mesh_edit.alignSelectedLoop() orelse return error.ExpectedLoopAlignment;
    try testing.expectEqual(@as(u8, 0), alignment.axis);
    try testing.expectApproxEqAbs(@as(f32, -0.025), alignment.coordinate, 0.00001);
    for (0..corners.len) |vertex| {
        const position = mesh_edit.vertPosPub(@intCast(vertex));
        try testing.expectApproxEqAbs(alignment.coordinate, position[0], 0.00001);
        try testing.expectApproxEqAbs(corners[vertex][1], position[1], 0.00001);
        try testing.expectApproxEqAbs(corners[vertex][2], position[2], 0.00001);
    }
    try testing.expectEqual(@as(u32, 4), mesh_edit.selCount());
    try testing.expect(mesh_edit.alignSelectedLoop() == null); // already flat: no phantom undo
}

test "exact numeric scaling preserves sub-centimetre factors instead of drag clamping" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 1, 0,
        0, 1, 0, 0, 0, 1, 0, 1,
    };
    mesh_edit.test_support.loadGroupedSoup(2932, soup[0..], 3, &.{0});
    defer mesh_edit.test_support.clear();
    mesh_edit.setMode(.face);
    try testing.expect(mesh_edit.selectFaceByIndex(0, false));
    const pivot = mesh_edit.selectionFrame().?.center;
    try testing.expect(mesh_edit.scaleSelectionAxis(.{ 1, 0, 0 }, pivot, 0.018).changed);
    const after = mesh_edit.vertPosPub(1);
    try testing.expectApproxEqAbs(pivot[0] + (1.0 - pivot[0]) * 0.018, after[0], 0.000001);
}

test "resident interleaved frame follows transformed geometry" {
    const verts = [_]f32{
        -2, 1, 3, 0, 1, 0, 0, 0,
        4,  5, 7, 0, 1, 0, 1, 0,
    };
    const frame = mesh_edit.frameForInterleavedPositions(verts[0..]).?;
    try testing.expectEqual([3]f32{ 1, 3, 5 }, frame.center);
    try testing.expectApproxEqAbs(@sqrt(@as(f32, 17)), frame.radius, 0.0001);
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

test "dissolving an irregular four-quad grid re-tessellates the clean boundary and drops seam verts" {
    // A sheared/transformed plane, not the unit-cube convenience case.  The four
    // selected authored quads contain nine welded vertices and twelve visible edge
    // runs before dissolve; the clean outer boundary is four corners / four runs.
    // The convex boundary dropped five corners (centre + four collinear seams),
    // so the merge must re-tessellate (req_3771): a byte-stable commit would
    // leave those verts alive in the soup as dots no authored edge runs through.
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
    const merged = (try indexed.mergeSelected(selected[0..])).?;
    try testing.expect(merged.retessellated);
    var lowered = try indexed.lower();
    defer lowered.deinit();
    try testing.expectEqual(@as(u32, 2), lowered.tri_count);
    try testing.expectEqualSlices(u32, &.{ 10, 10 }, lowered.groups);
    try testing.expectEqual(@as(usize, 4), indexed.faces.items[0].vertices.items.len);
    // The centre vert and the four collinear seam verts left the soup entirely.
    for ([_]usize{ 1, 3, 4, 5, 7 }) |dropped| {
        var row: usize = 0;
        while (row < lowered.tri_count * 3) : (row += 1) {
            const base = row * 3;
            const dx = lowered.positions[base] - p[dropped][0];
            const dy = lowered.positions[base + 1] - p[dropped][1];
            const dz = lowered.positions[base + 2] - p[dropped][2];
            try testing.expect(dx * dx + dy * dy + dz * dz > 1e-6);
        }
    }
}

test "merge faces dissolves a T-junction seam the staged path could already merge (req_3800)" {
    // One tall left quad next to two stacked right quads. The seam at x=1 is a
    // T-junction: the left face spans it with ONE edge (y 0→2) while the right
    // faces split it at y=1 — a vertex the left face never references. The user
    // proved this region merges fine when staged (merge the right pair first,
    // then the two full-height faces), so the one-shot merge refusing it is a
    // fake restriction: edge cancellation by vertex id alone can't see that the
    // overlapping seam runs are the same geometry.
    const p = [_][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 2, 0, 0 },
        .{ 1, 1, 0 }, .{ 2, 1, 0 }, .{ 0, 2, 0 },
        .{ 1, 2, 0 }, .{ 2, 2, 0 },
    };
    const triangles = [_][3]usize{
        // left tall quad (0,0)-(1,0)-(1,2)-(0,2)
        .{ 0, 1, 6 }, .{ 0, 6, 5 },
        // right bottom quad (1,0)-(2,0)-(2,1)-(1,1)
        .{ 1, 2, 4 }, .{ 1, 4, 3 },
        // right top quad (1,1)-(2,1)-(2,2)-(1,2)
        .{ 3, 4, 7 }, .{ 3, 7, 6 },
    };
    var soup = [_]f32{0} ** (triangles.len * 3 * 8);
    for (triangles, 0..) |triangle, triangle_index| {
        for (triangle, 0..) |point, corner| {
            const base = (triangle_index * 3 + corner) * 8;
            @memcpy(soup[base .. base + 3], p[point][0..]);
        }
    }
    const groups = [_]u32{ 30, 30, 31, 31, 32, 32 };
    const selected = [_]bool{true} ** triangles.len;
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], triangles.len, groups[0..], null);
    defer indexed.deinit();
    const merged = (try indexed.mergeSelected(selected[0..])).?;
    // The T-vertex (1,1) and the collinear rim verts (1,0),(1,2),(2,1) all leave
    // the boundary, so the merge re-tessellates down to one clean 2x2 quad.
    try testing.expect(merged.retessellated);
    try testing.expectEqual(@as(usize, 4), indexed.faces.items[merged.face_id].vertices.items.len);
    var lowered = try indexed.lower();
    defer lowered.deinit();
    try testing.expectEqual(@as(u32, 2), lowered.tri_count);
}

test "merge faces refuses a concave horseshoe over cracked T-split seams (req_3805)" {
    // The user's live demo: two tall columns bridged only by a small bottom quad,
    // with a HOLE above the bridge. Both bridge seams are T-junctions — the columns
    // have no vertex at the bridge's top corners — so the cancelled seams are
    // physical cracks in the render rows. The fused loop is a concave horseshoe,
    // which never re-tessellates (a re-fan flips rows), so committing would produce
    // one authored face whose interior still renders open edges and whose centre
    // dot floats over the void. The merge must refuse.
    const p = [_][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 2, 0, 0 }, .{ 3, 0, 0 },
        .{ 1, 1, 0 }, .{ 2, 1, 0 }, .{ 0, 3, 0 }, .{ 1, 3, 0 },
        .{ 2, 3, 0 }, .{ 3, 3, 0 },
    };
    const triangles = [_][3]usize{
        // left column (0,0)-(1,0)-(1,3)-(0,3)
        .{ 0, 1, 7 }, .{ 0, 7, 6 },
        // bottom bridge (1,0)-(2,0)-(2,1)-(1,1) — the hole sits above it
        .{ 1, 2, 5 }, .{ 1, 5, 4 },
        // right column (2,0)-(3,0)-(3,3)-(2,3)
        .{ 2, 3, 9 }, .{ 2, 9, 8 },
    };
    var soup = [_]f32{0} ** (triangles.len * 3 * 8);
    for (triangles, 0..) |triangle, triangle_index| {
        for (triangle, 0..) |point, corner| {
            const base = (triangle_index * 3 + corner) * 8;
            @memcpy(soup[base .. base + 3], p[point][0..]);
        }
    }
    const groups = [_]u32{ 40, 40, 41, 41, 42, 42 };
    const selected = [_]bool{true} ** triangles.len;
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], triangles.len, groups[0..], null);
    defer indexed.deinit();
    try testing.expect((try indexed.mergeSelected(selected[0..])) == null);

    // Control: fill the hole and the same T-split seams become mergeable — the
    // union is a convex rectangle, so the dissolve re-tessellates and STITCHES
    // the cracks instead of hiding them.
    const filler = [_][3]usize{ .{ 4, 5, 8 }, .{ 4, 8, 7 } };
    var full_soup = [_]f32{0} ** ((triangles.len + filler.len) * 3 * 8);
    @memcpy(full_soup[0..soup.len], soup[0..]);
    for (filler, 0..) |triangle, triangle_index| {
        for (triangle, 0..) |point, corner| {
            const base = ((triangles.len + triangle_index) * 3 + corner) * 8;
            @memcpy(full_soup[base .. base + 3], p[point][0..]);
        }
    }
    const full_groups = [_]u32{ 40, 40, 41, 41, 42, 42, 43, 43 };
    const full_selected = [_]bool{true} ** (triangles.len + filler.len);
    var full = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, full_soup[0..], triangles.len + filler.len, full_groups[0..], null);
    defer full.deinit();
    const merged = (try full.mergeSelected(full_selected[0..])).?;
    try testing.expect(merged.retessellated);
    try testing.expectEqual(@as(usize, 4), full.faces.items[merged.face_id].vertices.items.len);
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

test "position mutation adopts recomputed normals without invalidating indexed topology" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 1, 0,
        0, 1, 0, 0, 0, 1, 0, 1,
    };
    const groups = [_]u32{0};
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(
        testing.allocator,
        soup[0..],
        1,
        groups[0..],
        null,
    );
    defer indexed.deinit();
    try testing.expect(indexed.residentRenderChannelsMatch(soup[0..], 1));

    // Moving one corner changes the triangle's derived flat normal, while its UV
    // rows remain the exact same authored render channel.
    soup[2] = 0.5;
    const inv_sqrt_125: f32 = 1.0 / @sqrt(@as(f32, 1.25));
    const changed_normal = [3]f32{ 0.5 * inv_sqrt_125, 0.5 * inv_sqrt_125, inv_sqrt_125 };
    for (0..3) |corner| {
        const base = corner * 8;
        @memcpy(soup[base + 3 .. base + 6], changed_normal[0..]);
    }
    try testing.expect(indexed.residentUvsMatch(soup[0..], 1));
    try testing.expect(!indexed.residentRenderChannelsMatch(soup[0..], 1));
    try testing.expect(indexed.updatePositionsFromInterleaved(soup[0..], 1));
    try testing.expect(indexed.residentRenderChannelsMatch(soup[0..], 1));
}

test "tris to quads maximizes the total across an ambiguous four-triangle chain" {
    // A convex hexagon fan produces candidate graph 0—1—2—3. Taking the tempting
    // middle seam first strands both ends (one quad); the exact augmenting-path
    // planner must rearrange that local choice into (0,1) + (2,3), for two.
    const points = [_][3]f32{
        .{ 0, 0, 0 },
        .{ 2, 0, 0 },
        .{ 3, 1, 0 },
        .{ 2.5, 2, 0 },
        .{ 1, 3, 0 },
        .{ 0, 2, 0 },
    };
    const triangles = [_][3]usize{
        .{ 0, 1, 2 },
        .{ 0, 2, 3 },
        .{ 0, 3, 4 },
        .{ 0, 4, 5 },
    };
    var soup = [_]f32{0} ** (triangles.len * 3 * 8);
    for (triangles, 0..) |triangle, triangle_index| {
        for (triangle, 0..) |point, corner| {
            const base = (triangle_index * 3 + corner) * 8;
            @memcpy(soup[base .. base + 3], points[point][0..]);
        }
    }
    const groups = [_]u32{ 0, 1, 2, 3 };
    const selected = [_]bool{true} ** triangles.len;
    for ([_]indexed_edit_mesh.QuadEvaluation{ .balanced, .short_seams, .alternate_flow }) |evaluation| {
        var indexed = try indexed_edit_mesh.Mesh.fromSoup(
            testing.allocator,
            soup[0..],
            triangles.len,
            groups[0..],
            null,
        );
        defer indexed.deinit();
        const stats = try indexed.quadifySelectedWithEvaluation(selected[0..], evaluation);
        try testing.expectEqual(@as(u32, 4), stats.authored_faces_before);
        try testing.expectEqual(@as(u32, 3), stats.candidate_pairs);
        try testing.expectEqual(@as(u32, 2), stats.ambiguous_triangles);
        try testing.expectEqual(@as(u32, 2), stats.quads);
        try testing.expectEqual(@as(u32, 2), stats.authored_faces_after);

        var resident_groups: [triangles.len]u32 = undefined;
        var resident_parts: [triangles.len]u32 = undefined;
        var resident_materials: [triangles.len]u32 = undefined;
        try testing.expect(indexed.writeResidentMetadata(&resident_groups, &resident_parts, &resident_materials));
        try testing.expectEqualSlices(u32, &.{ 0, 0, 2, 2 }, resident_groups[0..]);
    }
}

test "tris to quads solves an odd ambiguous fan without losing the tail pair" {
    // The first three faces form an odd candidate cycle; face 2 also owns the
    // only edge to face 3. The maximum therefore has to reserve (2,3) and pair
    // (0,1). This is the blossom case that a plain bipartite/path matcher misses.
    const points = [_][3]f32{
        .{ 0, 0, 0 }, // center
        .{ -2, -1, 0 }, // outer A
        .{ 2, -1, 0 }, // outer B
        .{ 0, 2, 0 }, // outer C
        .{ -3, 2, 0 }, // tail
    };
    const triangles = [_][3]usize{
        .{ 0, 1, 2 },
        .{ 0, 2, 3 },
        .{ 0, 3, 1 },
        .{ 1, 3, 4 },
    };
    var soup = [_]f32{0} ** (triangles.len * 3 * 8);
    for (triangles, 0..) |triangle, triangle_index| {
        for (triangle, 0..) |point, corner| {
            const base = (triangle_index * 3 + corner) * 8;
            @memcpy(soup[base .. base + 3], points[point][0..]);
        }
    }
    const groups = [_]u32{ 0, 1, 2, 3 };
    const selected = [_]bool{true} ** triangles.len;
    for ([_]indexed_edit_mesh.QuadEvaluation{ .balanced, .short_seams, .alternate_flow }) |evaluation| {
        var indexed = try indexed_edit_mesh.Mesh.fromSoup(
            testing.allocator,
            soup[0..],
            triangles.len,
            groups[0..],
            null,
        );
        defer indexed.deinit();
        const stats = try indexed.quadifySelectedWithEvaluation(selected[0..], evaluation);
        try testing.expectEqual(@as(u32, 4), stats.candidate_pairs);
        try testing.expectEqual(@as(u32, 3), stats.ambiguous_triangles);
        try testing.expectEqual(@as(u32, 2), stats.quads);

        var resident_groups: [triangles.len]u32 = undefined;
        var resident_parts: [triangles.len]u32 = undefined;
        var resident_materials: [triangles.len]u32 = undefined;
        try testing.expect(indexed.writeResidentMetadata(&resident_groups, &resident_parts, &resident_materials));
        try testing.expectEqualSlices(u32, &.{ 0, 0, 2, 2 }, resident_groups[0..]);
    }
}

test "tris to quads accepts the same concave pair as two-face merge" {
    // Manual Merge Faces supports a concave authored boundary. The whole-topology
    // sweep must use that same pairwise contract instead of silently applying the
    // stricter convex-only import heuristic.
    const points = [_][3]f32{
        .{ 0, 0, 0 },
        .{ 2, 0, 0 },
        .{ 1, 0.5, 0 },
        .{ 0, 2, 0 },
    };
    const triangles = [_][3]usize{
        .{ 0, 1, 2 },
        .{ 0, 2, 3 },
    };
    var soup = [_]f32{0} ** (triangles.len * 3 * 8);
    for (triangles, 0..) |triangle, triangle_index| {
        for (triangle, 0..) |point, corner| {
            const base = (triangle_index * 3 + corner) * 8;
            @memcpy(soup[base .. base + 3], points[point][0..]);
        }
    }
    const groups = [_]u32{ 0, 1 };
    const selected = [_]bool{ true, true };
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(
        testing.allocator,
        soup[0..],
        triangles.len,
        groups[0..],
        null,
    );
    defer indexed.deinit();

    const stats = try indexed.quadifySelectedWithEvaluation(selected[0..], .balanced);
    try testing.expectEqual(@as(u32, 1), stats.candidate_pairs);
    try testing.expectEqual(@as(u32, 1), stats.quads);
    try testing.expectEqual(@as(usize, 4), indexed.faces.items[0].vertices.items.len);
    try testing.expect(!indexed.faces.items[1].alive);
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
    // The concave perimeter drops its collinear top-run corners but must NOT
    // re-tessellate — a re-fan would flip triangles — so the merge stays
    // byte-stable and every resident row below survives verbatim.
    const first_merge = (try indexed.mergeSelected(first_selection[0..])).?;
    try testing.expect(!first_merge.retessellated);
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
    const second_merge = (try indexed.mergeSelected(second_selection[0..])).?;
    try testing.expect(!second_merge.retessellated);
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

    try testing.expect((try indexed.mergeSelected(selected[0..])) == null);
    var lowered = try indexed.lower();
    defer lowered.deinit();
    try testing.expectEqualSlices(u32, groups[0..], lowered.groups);
    try testing.expectEqualSlices(u32, materials[0..], lowered.materials);
}

test "merge faces turns conflicting semantic names into explicit debt" {
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
    const parts = [_]u32{ 0, 0 };
    const materials = [_]u32{ 3, 3 };
    const regions = [_]u32{ 7, 9 };
    const instances = [_]u32{ 0, 0 };
    var indexed = try indexed_edit_mesh.Mesh.fromSoupWithSemantics(
        testing.allocator,
        soup[0..],
        2,
        groups[0..],
        parts[0..],
        materials[0..],
        regions[0..],
        instances[0..],
    );
    defer indexed.deinit();
    const selected = [_]bool{ true, true };
    try testing.expect((try indexed.mergeSelected(selected[0..])) != null);
    var lowered = try indexed.lower();
    defer lowered.deinit();
    for (lowered.semantic_regions) |region| try testing.expectEqual(indexed_edit_mesh.NO_SEMANTIC_ID, region);
    for (lowered.semantic_instances) |instance| try testing.expectEqual(indexed_edit_mesh.NO_SEMANTIC_ID, instance);
}

test "interactive merge accepts a connected bent surface without retessellating it" {
    // Both authored quads point generally the same way and share one full edge, but
    // the second rises out of the first quad's plane. Explicit Merge Faces is user
    // intent and may author this warped six-corner face. Its existing four source
    // triangles remain the physical surface, so accepting the grouping operation
    // must not silently fan or change a diagonal.
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
    var before_triangles: [4][3]u32 = undefined;
    @memcpy(before_triangles[0..], indexed.render_triangles.items[0..4]);

    const merged = (try indexed.mergeSelected(selected[0..])) orelse return error.ExpectedBentMerge;
    try testing.expect(!merged.retessellated);
    try testing.expectEqual(@as(usize, 6), indexed.faces.items[merged.face_id].vertices.items.len);
    var lowered = try indexed.lower();
    defer lowered.deinit();
    try testing.expectEqual(@as(u32, 4), lowered.tri_count);
    try testing.expectEqualSlices([3]u32, before_triangles[0..], lowered.triangle_vertices);
    try testing.expectEqualSlices(u32, &.{ 0, 0, 0, 0 }, lowered.groups);
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
    // The convex 2x1 boundary drops its two collinear seam verts, so this merge
    // re-tessellates (req_3771): one clean quad, still under the surviving part.
    const merged = (try refreshed.mergeSelected(selected[0..])).?;
    try testing.expect(merged.retessellated);
    var lowered = try refreshed.lower();
    defer lowered.deinit();
    try testing.expectEqual(@as(u32, 2), lowered.tri_count);
    try testing.expectEqualSlices(u32, &.{ 8, 8 }, lowered.groups);
    try testing.expectEqualSlices(u32, &.{ 0, 0 }, lowered.parts);
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

test "exact edge extrusion angle tilts the strip without changing its distance" {
    const frame = mesh_edit.EdgeExtrusionFrame{
        .a = .{ 0, 0, 0 },
        .b = .{ 0, 1, 0 },
        .outward = .{ 1, 0, 0 },
        .face_normal = .{ 0, 0, 1 },
        .source_face = 0,
    };
    const radians = mesh_edit.extrusionAngleRadiansPub(45) orelse return error.TestUnexpectedResult;
    const outer = frame.outerAtAngleRadians(2, radians);
    const component = @sqrt(@as(f32, 2));
    try testing.expectApproxEqAbs(component, outer[0][0], 1e-6);
    try testing.expectApproxEqAbs(component, outer[0][2], 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 2), @sqrt(outer[0][0] * outer[0][0] + outer[0][2] * outer[0][2]), 1e-6);
    try testing.expectEqual(@as(f32, 1), outer[1][1]);
}

test "edge plus vertex extrusion reuses one corner and leaves one open" {
    const frame = mesh_edit.EdgeExtrusionFrame{
        .a = .{ 0, 0, 0 },
        .b = .{ 0, 1, 0 },
        .outward = .{ 1, 0, 0 },
        .face_normal = .{ 0, 0, 1 },
        .source_face = 0,
    };
    const incident = mesh_edit.anchoredEdgeExtrusionPub(frame, .{ 4, 7 }, 4, frame.a, 2, 0);
    try testing.expect(incident.triangle);
    try testing.expectEqual(@as(u1, 0), incident.shared_index);
    try testing.expectEqualSlices(f32, &.{ 0, 0, 0 }, &incident.outer[0]);
    try testing.expectEqualSlices(f32, &.{ 2, 1, 0 }, &incident.outer[1]);

    const target: [3]f32 = .{ 2.1, 1.1, 0 };
    const separate = mesh_edit.anchoredEdgeExtrusionPub(frame, .{ 4, 7 }, 12, target, 2, 0);
    try testing.expect(!separate.triangle);
    try testing.expectEqual(@as(u1, 1), separate.shared_index);
    try testing.expectEqualSlices(f32, &target, &separate.outer[1]);
    try testing.expectEqualSlices(f32, &.{ 2, 0, 0 }, &separate.outer[0]);
}

test "shift selecting a target vertex retains the source edge across modes" {
    var soup = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 0, 0,
        0, 1, 0, 0, 0, 1, 0, 0,
    };
    mesh_edit.test_support.loadGroupedSoup(4046, soup[0..], 3, &.{5});
    defer mesh_edit.test_support.clear();

    mesh_edit.setMode(.edge);
    try testing.expect(mesh_edit.focusEdgeByEndpoints(.{ 0, 0, 0 }, .{ 1, 0, 0 }));
    const source_edge = mesh_edit.selectedEdgeIndexPub() orelse return error.TestUnexpectedResult;
    mesh_edit.setMode(.vertex);
    try testing.expect(mesh_edit.selectVertexByIndex(0, true));
    try testing.expectEqual(source_edge, mesh_edit.selectedEdgeIndexPub().?);
    try testing.expectEqual(@as(u32, 0), mesh_edit.selectedVertexIndexPub().?);
}

test "face extrusion draft widens and narrows around the cap center" {
    const positive = mesh_edit.extrusionAngleRadiansPub(45) orelse return error.TestUnexpectedResult;
    const widen = mesh_edit.faceExtrudeScalePub(2, 1, positive) orelse return error.TestUnexpectedResult;
    try testing.expectApproxEqAbs(@as(f32, 1.5), widen, 1e-6);
    const widened = mesh_edit.faceExtrudePointPub(.{ 2, 0, 0 }, .{ 0, 0, 0 }, .{ 0, 0, 1 }, 1, widen);
    try testing.expectApproxEqAbs(@as(f32, 3), widened[0], 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 1), widened[2], 1e-6);

    const negative = mesh_edit.extrusionAngleRadiansPub(-45) orelse return error.TestUnexpectedResult;
    const narrow = mesh_edit.faceExtrudeScalePub(2, 1, negative) orelse return error.TestUnexpectedResult;
    try testing.expectApproxEqAbs(@as(f32, 0.5), narrow, 1e-6);
    try testing.expect(mesh_edit.faceExtrudeScalePub(0.5, 1, negative) == null);
    try testing.expect(mesh_edit.extrusionAngleRadiansPub(90) == null);
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

    try testing.expect(try indexed.symmetrizeParts(0, 0, true, &.{ true, false }));
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

test "solidify clamps the miter spike at a knife-edge crease" {
    const triangles = [2]mesh_edit.SolidifyTriangle{
        .{
            .face = 0,
            .group = 10,
            .corners = .{ 0, 1, 2 },
            .positions = .{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 0, 1, 0 } },
        },
        .{
            .face = 1,
            .group = 20,
            .corners = .{ 0, 1, 3 },
            .positions = .{ .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 0, -0.9848078, -0.17364818 } },
        },
    };
    const thickness: f32 = 0.005;
    var offsets = try mesh_edit.solidifyOffsets(testing.allocator, triangles[0..], thickness);
    defer offsets.deinit();

    const offset = offsets.get(0);
    const magnitude = @sqrt(offset[0] * offset[0] + offset[1] * offset[1] + offset[2] * offset[2]);
    const limit = mesh_edit.SolidifyTuning.miter_limit * thickness;
    try testing.expect(magnitude <= limit + 1.0e-6);
    try testing.expect(magnitude > thickness);
}

test "solidify leaves a well-conditioned cube corner below the miter limit" {
    try testing.expect(mesh_edit.SolidifyTuning.miter_limit > @sqrt(3.0));
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
    try testing.expectEqual(@as(u16, 1), mesh_edit.edgeFaceIncidencePub(0));
    try testing.expectEqual(@as(u16, 1), mesh_edit.edgeFaceIncidencePub(1));
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
    var selected: [2]u32 = undefined;
    try testing.expectEqual(@as(u32, 2), mesh_edit.selectedVerticesPub(selected[0..]));
    try testing.expectEqualSlices(u32, &.{ 0, 1 }, selected[0..]);
    mesh_edit.clearSelection();
    try testing.expect(mesh_edit.selectVertexByIndex(0, false));
    try testing.expectEqual(@as(?u32, 0), mesh_edit.selectedVertexIndexPub());
}

test "connect vertices splits one authored face and inherits its meaning" {
    var soup = [_]f32{0} ** (12 * 3 * 8);
    bevelCubeSoup(soup[0..]);
    const groups = [_]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    const parts = [_]u32{7} ** 12;
    const materials = [_]u32{3} ** 12;
    const regions = [_]u32{11} ** 12;
    const instances = [_]u32{2} ** 12;
    var indexed = try indexed_edit_mesh.Mesh.fromSoupWithSemantics(
        testing.allocator,
        soup[0..],
        12,
        groups[0..],
        parts[0..],
        materials[0..],
        regions[0..],
        instances[0..],
    );
    defer indexed.deinit();

    const first = indexed.faces.items[0].vertices.items;
    try testing.expectEqual(@as(usize, 4), first.len);
    const a = first[0];
    const adjacent = first[1];
    const b = first[2];
    try testing.expect(!(try indexed.connectVertices(a, adjacent)));
    try testing.expect(try indexed.connectVertices(a, b));
    try testing.expectEqual(@as(usize, 7), indexed.faces.items.len);
    const split = &indexed.faces.items[6];
    try testing.expectEqual(@as(u32, 7), split.part);
    try testing.expectEqual(@as(u32, 3), split.material);
    try testing.expectEqual(@as(u32, 11), split.semantic.region);
    try testing.expectEqual(@as(u32, 2), split.semantic.instance);
    try testing.expect(split.group >= 6);
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

const boundary_chamfer_outer = [4][3]f32{
    .{ -2, 2, 0 }, .{ 2, 2, 0 }, .{ 2, -2, 0 }, .{ -2, -2, 0 },
};
const boundary_chamfer_inner = [4][3]f32{
    .{ -1, 1, 0 }, .{ 1, 1, 0 }, .{ 1, -1, 0 }, .{ -1, -1, 0 },
};

fn boundaryChamferRingSoup(out: []f32) void {
    const quads = [4][4][3]f32{
        .{ boundary_chamfer_outer[0], boundary_chamfer_outer[1], boundary_chamfer_inner[1], boundary_chamfer_inner[0] },
        .{ boundary_chamfer_outer[1], boundary_chamfer_outer[2], boundary_chamfer_inner[2], boundary_chamfer_inner[1] },
        .{ boundary_chamfer_outer[2], boundary_chamfer_outer[3], boundary_chamfer_inner[3], boundary_chamfer_inner[2] },
        .{ boundary_chamfer_outer[3], boundary_chamfer_outer[0], boundary_chamfer_inner[0], boundary_chamfer_inner[3] },
    };
    var triangle: usize = 0;
    for (quads) |quad| {
        for ([2][3]u32{ .{ 0, 1, 2 }, .{ 0, 2, 3 } }) |split| {
            for (split, 0..) |quad_corner, output_corner| {
                const base = (triangle * 3 + output_corner) * 8;
                @memcpy(out[base .. base + 3], quad[quad_corner][0..]);
            }
            triangle += 1;
        }
    }
}

fn countOpenEdges(mesh: *const indexed_edit_mesh.Mesh) !u32 {
    var incidences = std.AutoHashMap(u64, u32).init(testing.allocator);
    defer incidences.deinit();
    for (mesh.faces.items) |face| {
        if (!face.alive) continue;
        for (face.vertices.items, 0..) |vertex, corner| {
            const next = face.vertices.items[(corner + 1) % face.vertices.items.len];
            const lo = @min(vertex, next);
            const hi = @max(vertex, next);
            const key = (@as(u64, lo) << 32) | hi;
            const entry = try incidences.getOrPut(key);
            if (!entry.found_existing) entry.value_ptr.* = 0;
            entry.value_ptr.* += 1;
        }
    }
    var boundary_edges: u32 = 0;
    var edge_it = incidences.valueIterator();
    while (edge_it.next()) |incidence| if (incidence.* == 1) {
        boundary_edges += 1;
    };
    return boundary_edges;
}

test "selected open boundary loop chamfers to its chosen target side count" {
    var soup = [_]f32{0} ** (8 * 3 * 8);
    boundaryChamferRingSoup(soup[0..]);
    const groups = [_]u32{ 0, 0, 1, 1, 2, 2, 3, 3 };
    const parts = [_]u32{7} ** 8;
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 8, groups[0..], parts[0..]);
    defer indexed.deinit();

    const selected_edges = [4][2][3]f32{
        .{ boundary_chamfer_inner[0], boundary_chamfer_inner[1] },
        .{ boundary_chamfer_inner[1], boundary_chamfer_inner[2] },
        .{ boundary_chamfer_inner[2], boundary_chamfer_inner[3] },
        .{ boundary_chamfer_inner[3], boundary_chamfer_inner[0] },
    };
    var loop: [selected_edges.len]u32 = undefined;
    const selection = indexed.resolveBoundaryChamfer(selected_edges[0..], 7, loop[0..]) orelse
        return error.ExpectedOpenBoundaryLoop;
    try testing.expectEqual(@as(u32, 4), selection.sides_before);
    try testing.expectEqual(@as(u32, 8), selection.default_target_sides);
    try testing.expectEqual(@as(u32, 5), selection.minimum_target_sides);
    try testing.expectEqual(@as(u32, 256), selection.maximum_target_sides);
    try testing.expectApproxEqAbs(@as(f32, 0.9), selection.max_width, 0.00001);
    const first_chamfer_face: u32 = @intCast(indexed.faces.items.len);
    try testing.expect(try indexed.chamferBoundary(loop[0..], 0.25, 8));
    try testing.expectEqual(@as(u32, 12), try countOpenEdges(&indexed)); // 4 outer + 8 inner.
    // The old corners become interior support vertices for the four new corner
    // faces; only the OPEN boundary changes from four edges to eight.
    for (loop) |vertex| try testing.expect(indexed.vertices.items[vertex].alive);

    var lowered = try indexed.lower();
    defer lowered.deinit();
    try testing.expectEqual(@as(u32, 20), lowered.tri_count);
    for (lowered.positions) |position| try testing.expect(std.math.isFinite(position));
    const neutral_uv = [2]f32{ 0.8125, 0.9375 };
    try testing.expect(lowered.pointFreshFacesAtUv(first_chamfer_face, neutral_uv));
    var neutral_triangles: u32 = 0;
    for (lowered.face_ids, 0..) |face_id, triangle| {
        if (face_id < first_chamfer_face) continue;
        neutral_triangles += 1;
        const at = triangle * 6;
        for (0..3) |corner| {
            try testing.expectApproxEqAbs(neutral_uv[0], lowered.uvs[at + corner * 2], 0.000001);
            try testing.expectApproxEqAbs(neutral_uv[1], lowered.uvs[at + corner * 2 + 1], 0.000001);
        }
    }
    try testing.expect(neutral_triangles > 0);
}

test "boundary chamfer accepts the loop-cut opening captured by Follow" {
    // req_3979: these are the exact four authored quads surrounding the face the
    // user deleted after four accepted Loop Cut transactions. The opening is a
    // slightly sloped 0.2 m x 0.21 m quad, not the planar square fixture above.
    const v180 = [3]f32{ 0.35714287, 1.724881, -0.100000024 };
    const v181 = [3]f32{ 0.35714287, 1.724881, 0.099999994 };
    const v184 = [3]f32{ 0.36192286, 1.724881, -0.100000024 };
    const v185 = [3]f32{ 0.36192286, 1.724881, 0.099999994 };
    const v188 = [3]f32{ 0.546875, 1.6248809, -0.100000024 };
    const v190 = [3]f32{ 0.546875, 1.6248809, 0.099999994 };
    const quads = [4][4][3]f32{
        .{ v180, v181, v185, v184 },
        .{ v184, v188, .{ 0.5, 1.6248809, -0.3 }, .{ 0.36192286, 1.724881, -0.3 } },
        .{ .{ 0.5, 1.5248808, -0.100000024 }, v188, v190, .{ 0.5, 1.5248808, 0.099999994 } },
        .{ .{ 0.5, 1.6248809, 0.3 }, v190, v185, .{ 0.36192286, 1.724881, 0.3 } },
    };
    var soup = [_]f32{0} ** (8 * 3 * 8);
    var triangle: usize = 0;
    for (quads) |quad| {
        for ([2][3]u32{ .{ 0, 1, 2 }, .{ 0, 2, 3 } }) |split| {
            for (split, 0..) |quad_corner, output_corner| {
                const base = (triangle * 3 + output_corner) * 8;
                @memcpy(soup[base .. base + 3], quad[quad_corner][0..]);
            }
            triangle += 1;
        }
    }
    const groups = [_]u32{ 180, 180, 190, 190, 184, 184, 212, 212 };
    const parts = [_]u32{7} ** 8;
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 8, groups[0..], parts[0..]);
    defer indexed.deinit();

    const selected_edges = [4][2][3]f32{
        .{ v185, v190 },
        .{ v188, v190 },
        .{ v184, v188 },
        .{ v184, v185 },
    };
    var loop: [selected_edges.len]u32 = undefined;
    const selection = indexed.resolveBoundaryChamfer(selected_edges[0..], 7, loop[0..]) orelse
        return error.ExpectedFollowOpening;
    try testing.expectEqual(@as(u32, 4), selection.sides_before);
    try testing.expect(selection.max_width >= indexed_edit_mesh.BoundaryChamferTuning.minimum_width_m);
    try testing.expect(try indexed.chamferBoundary(
        loop[0..],
        indexed_edit_mesh.BoundaryChamferTuning.minimum_width_m,
        8,
    ));

    var lowered = try indexed.lower();
    defer lowered.deinit();
    try testing.expectEqual(@as(u32, 20), lowered.tri_count);
    try testing.expectEqual(@as(u32, 20), try countOpenEdges(&indexed)); // 12 outer edges + 8 chamfered opening edges.
    for (lowered.positions) |position| try testing.expect(std.math.isFinite(position));
}

test "one selected quad becomes a welded eight-sided extrusion center without n-gon transition faces" {
    const corners = [4][3]f32{
        .{ -1, -1, 0 },
        .{ 1, -1, 0 },
        .{ 1, 1, 0 },
        .{ -1, 1, 0 },
    };
    const corner_uvs = [4][2]f32{ .{ 0, 0 }, .{ 1, 0 }, .{ 1, 1 }, .{ 0, 1 } };
    var soup = [_]f32{0} ** (2 * 3 * 8);
    for ([2][3]u32{ .{ 0, 1, 2 }, .{ 0, 2, 3 } }, 0..) |triangle, face| {
        for (triangle, 0..) |corner, slot| {
            const at = (face * 3 + slot) * 8;
            @memcpy(soup[at .. at + 3], corners[corner][0..]);
            soup[at + 6] = corner_uvs[corner][0];
            soup[at + 7] = corner_uvs[corner][1];
        }
    }
    const groups = [_]u32{ 9, 9 };
    const parts = [_]u32{ 3, 3 };
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 2, groups[0..], parts[0..]);
    defer indexed.deinit();

    const selected = [_]bool{ true, true };
    const selection = indexed.resolveFacePolygon(selected[0..]) orelse return error.ExpectedFacePolygonSelection;
    try testing.expectEqual(@as(u32, 4), selection.sides_before);
    try testing.expectEqual(@as(u32, 8), selection.default_target_sides);
    try testing.expect(selection.max_width > indexed_edit_mesh.FacePolygonTuning.minimum_width_m);

    const center_id = (try indexed.polygonizeFace(selection.face_id, 0.25, 8)) orelse
        return error.ExpectedFacePolygon;
    try testing.expect(!indexed.faces.items[selection.face_id].alive);
    const center = &indexed.faces.items[center_id];
    try testing.expect(center.alive);
    try testing.expectEqual(@as(usize, 8), center.vertices.items.len);
    try testing.expectEqual(@as(u32, 9), center.group);
    try testing.expectEqual(@as(u32, 3), center.part);

    var triangles: u32 = 0;
    var quads: u32 = 0;
    var transition_faces: u32 = 0;
    for (indexed.faces.items) |face| {
        if (!face.alive or face.id == center_id) continue;
        transition_faces += 1;
        if (face.vertices.items.len == 3) triangles += 1 else if (face.vertices.items.len == 4) quads += 1 else return error.UnexpectedTransitionNgon;
    }
    try testing.expectEqual(@as(u32, 8), transition_faces);
    try testing.expectEqual(@as(u32, 4), triangles);
    try testing.expectEqual(@as(u32, 4), quads);
    try testing.expectEqual(@as(u32, 4), try countOpenEdges(&indexed));

    var lowered = try indexed.lower();
    defer lowered.deinit();
    try testing.expectEqual(@as(u32, 18), lowered.tri_count);
    for (lowered.positions) |position| try testing.expect(std.math.isFinite(position));
}

test "face polygon keeps its first edge aligned while the side count changes" {
    const corners = [4][3]f32{
        .{ -1, -1, 0 },
        .{ 1, -1, 0 },
        .{ 1, 1, 0 },
        .{ -1, 1, 0 },
    };
    const triangles = [2][3]u32{ .{ 0, 1, 2 }, .{ 0, 2, 3 } };
    for ([_]usize{ 5, 17 }) |target_sides| {
        var soup = [_]f32{0} ** (2 * 3 * 8);
        for (triangles, 0..) |triangle, face| {
            for (triangle, 0..) |corner, slot| {
                const at = (face * 3 + slot) * 8;
                @memcpy(soup[at .. at + 3], corners[corner][0..]);
            }
        }
        const groups = [_]u32{ 9, 9 };
        const parts = [_]u32{ 3, 3 };
        var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 2, groups[0..], parts[0..]);
        defer indexed.deinit();

        const selection = indexed.resolveFacePolygon(&.{ true, true }) orelse
            return error.ExpectedFacePolygonSelection;
        const source = &indexed.faces.items[selection.face_id];
        const source_a = indexed.vertices.items[source.vertices.items[0]].position;
        const source_b = indexed.vertices.items[source.vertices.items[1]].position;
        const center_id = (try indexed.polygonizeFace(selection.face_id, 0.25, target_sides)) orelse
            return error.ExpectedFacePolygon;
        const center = &indexed.faces.items[center_id];
        const center_a = indexed.vertices.items[center.vertices.items[0]].position;
        const center_b = indexed.vertices.items[center.vertices.items[1]].position;
        const source_edge = [3]f32{ source_b[0] - source_a[0], source_b[1] - source_a[1], source_b[2] - source_a[2] };
        const center_edge = [3]f32{ center_b[0] - center_a[0], center_b[1] - center_a[1], center_b[2] - center_a[2] };
        const cross = [3]f32{
            source_edge[1] * center_edge[2] - source_edge[2] * center_edge[1],
            source_edge[2] * center_edge[0] - source_edge[0] * center_edge[2],
            source_edge[0] * center_edge[1] - source_edge[1] * center_edge[0],
        };
        try testing.expectApproxEqAbs(@as(f32, 0), cross[0], 0.00001);
        try testing.expectApproxEqAbs(@as(f32, 0), cross[1], 0.00001);
        try testing.expectApproxEqAbs(@as(f32, 0), cross[2], 0.00001);
        try testing.expect(source_edge[0] * center_edge[0] + source_edge[1] * center_edge[1] + source_edge[2] * center_edge[2] > 0);
    }
}

test "boundary chamfer supports non-doubling and multi-segment targets" {
    const selected_edges = [4][2][3]f32{
        .{ boundary_chamfer_inner[0], boundary_chamfer_inner[1] },
        .{ boundary_chamfer_inner[1], boundary_chamfer_inner[2] },
        .{ boundary_chamfer_inner[2], boundary_chamfer_inner[3] },
        .{ boundary_chamfer_inner[3], boundary_chamfer_inner[0] },
    };
    for ([_]u32{ 6, 12 }) |target_sides| {
        var soup = [_]f32{0} ** (8 * 3 * 8);
        boundaryChamferRingSoup(soup[0..]);
        const groups = [_]u32{ 0, 0, 1, 1, 2, 2, 3, 3 };
        const parts = [_]u32{7} ** 8;
        var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 8, groups[0..], parts[0..]);
        defer indexed.deinit();
        var loop: [selected_edges.len]u32 = undefined;
        _ = indexed.resolveBoundaryChamfer(selected_edges[0..], 7, loop[0..]) orelse
            return error.ExpectedOpenBoundaryLoop;
        try testing.expect(try indexed.chamferBoundary(loop[0..], 0.25, target_sides));
        try testing.expectEqual(@as(u32, 4) + target_sides, try countOpenEdges(&indexed));
        var lowered = try indexed.lower();
        defer lowered.deinit();
        for (lowered.positions) |position| try testing.expect(std.math.isFinite(position));
    }
}

test "boundary chamfer rejects target counts that do not refine the opening" {
    var soup = [_]f32{0} ** (8 * 3 * 8);
    boundaryChamferRingSoup(soup[0..]);
    const groups = [_]u32{ 0, 0, 1, 1, 2, 2, 3, 3 };
    const parts = [_]u32{7} ** 8;
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, soup[0..], 8, groups[0..], parts[0..]);
    defer indexed.deinit();
    const selected_edges = [4][2][3]f32{
        .{ boundary_chamfer_inner[0], boundary_chamfer_inner[1] },
        .{ boundary_chamfer_inner[1], boundary_chamfer_inner[2] },
        .{ boundary_chamfer_inner[2], boundary_chamfer_inner[3] },
        .{ boundary_chamfer_inner[3], boundary_chamfer_inner[0] },
    };
    var loop: [selected_edges.len]u32 = undefined;
    _ = indexed.resolveBoundaryChamfer(selected_edges[0..], 7, loop[0..]) orelse
        return error.ExpectedOpenBoundaryLoop;
    try testing.expect(!(try indexed.chamferBoundary(loop[0..], 0.25, 4)));
    try testing.expect(!(try indexed.chamferBoundary(loop[0..], 0.25, 257)));
}

test "boundary chamfer rejects an open chain and a closed manifold loop" {
    var ring_soup = [_]f32{0} ** (8 * 3 * 8);
    boundaryChamferRingSoup(ring_soup[0..]);
    const ring_groups = [_]u32{ 0, 0, 1, 1, 2, 2, 3, 3 };
    const ring_parts = [_]u32{7} ** 8;
    var ring = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, ring_soup[0..], 8, ring_groups[0..], ring_parts[0..]);
    defer ring.deinit();
    const chain = [3][2][3]f32{
        .{ boundary_chamfer_inner[0], boundary_chamfer_inner[1] },
        .{ boundary_chamfer_inner[1], boundary_chamfer_inner[2] },
        .{ boundary_chamfer_inner[2], boundary_chamfer_inner[3] },
    };
    var chain_loop: [chain.len]u32 = undefined;
    try testing.expect(ring.resolveBoundaryChamfer(chain[0..], 7, chain_loop[0..]) == null);

    var cube_soup = [_]f32{0} ** (12 * 3 * 8);
    bevelCubeSoup(cube_soup[0..]);
    const cube_groups = [_]u32{ 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };
    const cube_parts = [_]u32{7} ** 12;
    var cube = try indexed_edit_mesh.Mesh.fromSoup(testing.allocator, cube_soup[0..], 12, cube_groups[0..], cube_parts[0..]);
    defer cube.deinit();
    const manifold = [4][2][3]f32{
        .{ bevel_cube_corners[4], bevel_cube_corners[5] },
        .{ bevel_cube_corners[5], bevel_cube_corners[6] },
        .{ bevel_cube_corners[6], bevel_cube_corners[7] },
        .{ bevel_cube_corners[7], bevel_cube_corners[4] },
    };
    var manifold_loop: [manifold.len]u32 = undefined;
    try testing.expect(cube.resolveBoundaryChamfer(manifold[0..], 7, manifold_loop[0..]) == null);
}

test "opposite-corner weld removes the authored quad whose boundary cancels" {
    var soup = [_]f32{0} ** (2 * 3 * 8);
    const corners = [6][3]f32{
        .{ 0, 0, 0 }, .{ 0, 0, 1 },     .{ 0.2, 0, 1.1 },
        .{ 0, 0, 0 }, .{ 0.2, 0, 1.1 }, .{ 0.2, 0, 0.9 },
    };
    for (corners, 0..) |position, corner| {
        const base = corner * 8;
        @memcpy(soup[base .. base + 3], position[0..]);
    }
    const merged = [3]f32{ 0.1, 0, 0.95 };
    var final_positions = [_]f32{
        0, 0, 0, merged[0], merged[1], merged[2], 0.2,       0,         1.1,
        0, 0, 0, 0.2,       0,         1.1,       merged[0], merged[1], merged[2],
    };
    const groups = [_]u32{ 8, 8 };
    const parts = [_]u32{ 0, 0 };
    const untouched = [_]bool{ false, false };
    const touched = [_]bool{ true, true };
    var mask = [_]bool{ false, false };

    // The repair is scoped to this weld. A malformed group elsewhere is not
    // silently removed when the user edits another surface.
    try testing.expectEqual(
        @as(u32, 0),
        try indexed_edit_mesh.maskMalformedWeldFaceGroups(
            testing.allocator,
            soup[0..],
            final_positions[0..],
            2,
            groups[0..],
            parts[0..],
            untouched[0..],
            mask[0..],
        ),
    );
    try testing.expectEqualSlices(bool, &.{ false, false }, mask[0..]);

    try testing.expectEqual(
        @as(u32, 2),
        try indexed_edit_mesh.maskMalformedWeldFaceGroups(
            testing.allocator,
            soup[0..],
            final_positions[0..],
            2,
            groups[0..],
            parts[0..],
            touched[0..],
            mask[0..],
        ),
    );
    try testing.expectEqualSlices(bool, &.{ true, true }, mask[0..]);
}

test "adjacent-corner weld keeps the valid triangle left by a collapsed quad" {
    var soup = [_]f32{0} ** (2 * 3 * 8);
    const corners = [6][3]f32{
        .{ 0, 0, 0 }, .{ 1, 0, 0 }, .{ 1, 1, 0 },
        .{ 0, 0, 0 }, .{ 1, 1, 0 }, .{ 0, 1, 0 },
    };
    for (corners, 0..) |position, corner| {
        const base = corner * 8;
        @memcpy(soup[base .. base + 3], position[0..]);
    }
    // The first triangle has already been removed by Weld's local repeated-
    // corner check. The second is a real triangle and must remain.
    const merged = [3]f32{ 0.5, 0, 0 };
    var final_positions = [_]f32{
        merged[0], merged[1], merged[2], merged[0], merged[1], merged[2], 1, 1, 0,
        merged[0], merged[1], merged[2], 1,         1,         0,         0, 1, 0,
    };
    const groups = [_]u32{ 4, 4 };
    const parts = [_]u32{ 0, 0 };
    const touched = [_]bool{ true, true };
    var mask = [_]bool{ true, false };

    try testing.expectEqual(
        @as(u32, 0),
        try indexed_edit_mesh.maskMalformedWeldFaceGroups(
            testing.allocator,
            soup[0..],
            final_positions[0..],
            2,
            groups[0..],
            parts[0..],
            touched[0..],
            mask[0..],
        ),
    );
    try testing.expectEqualSlices(bool, &.{ true, false }, mask[0..]);
}

// Keep the mesh module's co-located lower-level tests in this unit target too.
test {
    std.testing.refAllDecls(mesh_edit);
}
