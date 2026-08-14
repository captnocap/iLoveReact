//! Exact headless reproduction of the retained-cache drag regression.
//! No renderer or GPU is initialized: the host mesh stash is the presentation
//! cache, while the real Scene3D journal and gizmo own every state transition.

const std = @import("std");
const testing = std.testing;
const scene3d = @import("../../gpu/scene3d/root.zig");
const indexed_edit_mesh = @import("../../gpu/indexed_edit_mesh.zig");
const mesh_edit = @import("../../gpu/mesh_edit.zig");
const mesh_edge_semantics = @import("../../gpu/mesh_edge_semantics.zig");
const meshdoc_format = @import("../../gpu/meshdoc_format.zig");
const model_paint = @import("../../gpu/model_paint.zig");
const model_source = @import("../../gpu/model_source.zig");
const fixtures = @import("../fixtures/mesh_face_table_fixtures.zig");

const ordinary_drag_px: f32 = 10.0;
const same_snap_bucket_jitter_px: f32 = 0.25;
const position_epsilon: f32 = 0.00001;

fn installExplicitFixtureTopology(soup: *const fixtures.Soup) ![]u32 {
    var indexed = try indexed_edit_mesh.Mesh.fromSoup(
        testing.allocator,
        soup.interleaved,
        soup.triangleCount(),
        soup.groups,
        soup.parts,
    );
    defer indexed.deinit();
    const rows = try testing.allocator.alloc(u32, soup.interleaved.len / 8);
    var at: usize = 0;
    for (indexed.render_triangles.items) |triangle| {
        @memcpy(rows[at .. at + 3], triangle[0..]);
        at += 3;
    }
    try testing.expectEqual(rows.len, at);
    try testing.expect(model_source.setLogicalTopology(rows, @intCast(indexed.vertices.items.len)));
    return rows;
}

fn fixtureEdgeTableAlloc(a: u32, b: u32) ![]u8 {
    return std.fmt.allocPrint(
        testing.allocator,
        "{{\"version\":1,\"regions\":[],\"edgeRegions\":[{{\"id\":19,\"name\":\"test.hinge\",\"role\":\"hinge\",\"objectId\":\"fixture\",\"closed\":false,\"vertices\":[{d},{d}]}}]}}",
        .{ a, b },
    );
}

fn stableLogicalIdForEditVertex(
    edit_vertex: u32,
    logical_rows: []const u32,
    render_corner_count: u32,
) !u32 {
    try testing.expectEqual(@as(usize, render_corner_count), logical_rows.len);
    var found: ?u32 = null;
    var face: u32 = 0;
    while (face < render_corner_count / 3) : (face += 1) {
        for (0..3) |corner| {
            if (mesh_edit.cornerVertPub(face, @intCast(corner)) != edit_vertex) continue;
            const stable_id = logical_rows[@as(usize, face) * 3 + corner];
            if (found) |prior| {
                try testing.expectEqual(prior, stable_id);
            } else found = stable_id;
        }
    }
    return found orelse error.TestUnexpectedResult;
}

fn expectOnlyXMoved(before: [3]f32, after: [3]f32) !f32 {
    try testing.expectApproxEqAbs(before[1], after[1], position_epsilon);
    try testing.expectApproxEqAbs(before[2], after[2], position_epsilon);
    const delta = after[0] - before[0];
    try testing.expect(@abs(delta) > position_epsilon);
    return delta;
}

test "two committed snapped vertex drags keep presentation current and never replay one step" {
    // A non-zero model session gives the real journal a concrete write-lease
    // identity; the primordial session intentionally has none.
    try testing.expect(scene3d.modelSessionSelect(0x4165));
    scene3d.meshEditBeginModel();

    var cube = try fixtures.cube(testing.allocator);
    defer cube.deinit();
    scene3d.setPaintTarget("headless-two-drag-cube", cube.interleaved, @intCast(cube.interleaved.len / 8));
    scene3d.meshEditSetFaceGroups(cube.groups);
    scene3d.meshEditSetPartRanges(&.{ 0, 6 });
    try testing.expect(scene3d.stashActiveEditMesh());

    scene3d.meshEditSetMode(1);
    try testing.expect(scene3d.meshEditSelectVertex(0, false));
    scene3d.test_support.setPaintCamera(
        .{ 0.5, 0.5, 5.0 },
        .{ 0.5, 0.5, 0.5 },
        50.0,
        800.0,
        800.0,
    );

    const p0 = scene3d.test_support.vertexPosition(0) orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(u32, 1), scene3d.meshEditGeneration());

    // Gesture one is the user's first one-grid-step drag. Releasing it advances
    // resident face-analysis revision, but the already-patched host presentation
    // must remain addressable under its independent geometry generation.
    scene3d.meshGizmoBegin();
    try testing.expect(scene3d.meshGizmoDrag(0, ordinary_drag_px, 0, false, false, false));
    _ = scene3d.meshGizmoFinish();
    const p1 = scene3d.test_support.vertexPosition(0) orelse return error.TestUnexpectedResult;
    const first_step = try expectOnlyXMoved(p0, p1);
    try testing.expectEqual(@as(u32, 2), scene3d.meshEditGeneration());
    try testing.expect(scene3d.test_support.hostPresentationIsCurrent());

    // Gesture two starts from a fresh accumulator. The first motion lands one
    // more step. A tiny later motion remains in that same snap bucket, so it must
    // neither report a mutation nor move the vertex again. The broken pipeline
    // mutated CPU state, failed its stale cache patch, left `applied` at zero, and
    // replayed the whole snapped step on precisely this second event.
    scene3d.meshGizmoBegin();
    try testing.expect(scene3d.meshGizmoDrag(0, ordinary_drag_px, 0, false, false, false));
    const p2 = scene3d.test_support.vertexPosition(0) orelse return error.TestUnexpectedResult;
    const second_step = try expectOnlyXMoved(p1, p2);
    try testing.expectApproxEqAbs(first_step, second_step, position_epsilon);

    try testing.expect(!scene3d.meshGizmoDrag(0, same_snap_bucket_jitter_px, 0, false, false, false));
    const p3 = scene3d.test_support.vertexPosition(0) orelse return error.TestUnexpectedResult;
    try testing.expectEqual(p2, p3);
    _ = scene3d.meshGizmoFinish();

    try testing.expectEqual(@as(u32, 3), scene3d.meshEditGeneration());
    try testing.expect(scene3d.test_support.hostPresentationIsCurrent());
    try testing.expectApproxEqAbs(first_step * 2.0, p3[0] - p0[0], position_epsilon);
}

test "a post-mutation presentation miss queues the full mesh without replaying the drag" {
    try testing.expect(scene3d.modelSessionSelect(0x4166));
    scene3d.meshEditBeginModel();

    var cube = try fixtures.cube(testing.allocator);
    defer cube.deinit();
    scene3d.setPaintTarget("headless-drag-presentation-miss", cube.interleaved, @intCast(cube.interleaved.len / 8));
    scene3d.meshEditSetFaceGroups(cube.groups);
    scene3d.meshEditSetPartRanges(&.{ 0, 6 });
    // Deliberately do not stash the target. The authoritative CPU mutation must
    // still count as accepted; its full current mesh is queued after the fast
    // incremental presentation path finds no slot.
    try testing.expect(!scene3d.test_support.hostPresentationIsCurrent());

    scene3d.meshEditSetMode(1);
    try testing.expect(scene3d.meshEditSelectVertex(0, false));
    scene3d.test_support.setPaintCamera(
        .{ 0.5, 0.5, 5.0 },
        .{ 0.5, 0.5, 0.5 },
        50.0,
        800.0,
        800.0,
    );

    const p0 = scene3d.test_support.vertexPosition(0) orelse return error.TestUnexpectedResult;
    scene3d.meshGizmoBegin();
    try testing.expect(scene3d.meshGizmoDrag(0, ordinary_drag_px, 0, false, false, false));
    const p1 = scene3d.test_support.vertexPosition(0) orelse return error.TestUnexpectedResult;
    _ = try expectOnlyXMoved(p0, p1);
    try testing.expect(scene3d.test_support.hostPresentationIsCurrent());

    try testing.expect(!scene3d.meshGizmoDrag(0, same_snap_bucket_jitter_px, 0, false, false, false));
    const p2 = scene3d.test_support.vertexPosition(0) orelse return error.TestUnexpectedResult;
    try testing.expectEqual(p1, p2);
    _ = scene3d.meshGizmoFinish();
    try testing.expectEqual(@as(u32, 2), scene3d.meshEditGeneration());
}

fn expectAtlasRgbEqual(expected: []const u8, actual: []const u8) !void {
    try testing.expectEqual(expected.len, actual.len);
    var at: usize = 0;
    while (at < expected.len) : (at += 4) {
        try testing.expectEqualSlices(u8, expected[at .. at + 3], actual[at .. at + 3]);
    }
}

fn expectSourceFaceOrder(source_before: []const f32, order: []const u32) !void {
    const source_after = model_source.verts() orelse return error.TestUnexpectedResult;
    try testing.expectEqual(source_before.len, source_after.len);
    for (order, 0..) |old_face, new_face| {
        const old_base = @as(usize, old_face) * 24;
        const new_base = new_face * 24;
        try testing.expectEqualSlices(
            f32,
            source_before[old_base .. old_base + 24],
            source_after[new_base .. new_base + 24],
        );
    }
}

test "glass is an alpha-only stable face reorder across undo and redo" {
    try testing.expect(scene3d.modelSessionSelect(0x4177));
    scene3d.meshEditBeginModel();

    var cube = try fixtures.cube(testing.allocator);
    defer cube.deinit();
    const source_before = try testing.allocator.dupe(f32, cube.interleaved);
    defer testing.allocator.free(source_before);
    const vertex_count: u32 = @intCast(cube.interleaved.len / 8);
    scene3d.setPaintTarget("headless-glass-cube", cube.interleaved, vertex_count);
    model_source.retain("headless-glass-cube", source_before, vertex_count);
    scene3d.meshEditSetFaceGroups(cube.groups);
    scene3d.meshEditSetPartRanges(&.{ 0, 6 });
    try testing.expect(scene3d.meshEditSetFaceMaterials(cube.materials));
    try testing.expect(scene3d.stashActiveEditMesh());

    const live_atlas = model_paint.atlas() orelse return error.TestUnexpectedResult;
    const detailed_rgb = try testing.allocator.dupe(u8, live_atlas.rgba);
    defer testing.allocator.free(detailed_rgb);
    var texel: usize = 0;
    while (texel < detailed_rgb.len) : (texel += 4) {
        detailed_rgb[texel + 0] = @intCast((texel / 4 * 17 + 3) % 251);
        detailed_rgb[texel + 1] = @intCast((texel / 4 * 29 + 7) % 253);
        detailed_rgb[texel + 2] = @intCast((texel / 4 * 43 + 11) % 255);
    }
    try testing.expect(model_paint.setAtlas(detailed_rgb));
    const layout_revision = model_paint.layoutRevision();

    scene3d.meshEditSetMode(3);
    try testing.expect(scene3d.meshEditSelectFace(0, false));
    try testing.expectEqual(@as(u32, 2), scene3d.uvZoneAssignSelection(4));
    defer _ = scene3d.uvZoneClearAll();
    try testing.expect(scene3d.meshSetSelectionGlass());
    try testing.expectEqual(layout_revision, model_paint.layoutRevision());

    const reordered = [_]u32{ 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1 };
    try expectSourceFaceOrder(source_before, &reordered);
    try expectAtlasRgbEqual(detailed_rgb, model_paint.atlas().?.rgba);
    for (0..10) |face| try testing.expect(!model_paint.faceIsGlass(@intCast(face)));
    try testing.expect(model_paint.faceIsGlass(10));
    try testing.expect(model_paint.faceIsGlass(11));
    for (0..10) |face| try testing.expectEqual(scene3d.UV_ZONE_UNASSIGNED, scene3d.uvZoneOfFace(@intCast(face)));
    try testing.expectEqual(@as(u16, 4), scene3d.uvZoneOfFace(10));
    try testing.expectEqual(@as(u16, 4), scene3d.uvZoneOfFace(11));

    try testing.expect(scene3d.meshUndo());
    try testing.expectEqual(layout_revision, model_paint.layoutRevision());
    const original = [_]u32{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 };
    try expectSourceFaceOrder(source_before, &original);
    try expectAtlasRgbEqual(detailed_rgb, model_paint.atlas().?.rgba);
    for (0..12) |face| try testing.expect(!model_paint.faceIsGlass(@intCast(face)));
    try testing.expectEqual(@as(u16, 4), scene3d.uvZoneOfFace(0));
    try testing.expectEqual(@as(u16, 4), scene3d.uvZoneOfFace(1));
    for (2..12) |face| try testing.expectEqual(scene3d.UV_ZONE_UNASSIGNED, scene3d.uvZoneOfFace(@intCast(face)));

    try testing.expect(scene3d.meshRedo());
    try expectSourceFaceOrder(source_before, &reordered);
    try expectAtlasRgbEqual(detailed_rgb, model_paint.atlas().?.rgba);
    for (0..10) |face| try testing.expect(!model_paint.faceIsGlass(@intCast(face)));
    try testing.expect(model_paint.faceIsGlass(10));
    try testing.expect(model_paint.faceIsGlass(11));
    try testing.expectEqual(@as(u16, 4), scene3d.uvZoneOfFace(10));
    try testing.expectEqual(@as(u16, 4), scene3d.uvZoneOfFace(11));
}

test "UV zone rows park with their model session across background tab switches" {
    var cube_a = try fixtures.cube(testing.allocator);
    defer cube_a.deinit();
    const source_a = try testing.allocator.dupe(f32, cube_a.interleaved);
    defer testing.allocator.free(source_a);
    const count_a: u32 = @intCast(cube_a.interleaved.len / 8);

    try testing.expect(scene3d.modelSessionSelect(0x4178));
    scene3d.meshEditBeginModel();
    scene3d.setPaintTarget("uv-zone-session-a", cube_a.interleaved, count_a);
    model_source.retain("uv-zone-session-a", source_a, count_a);
    scene3d.meshEditSetFaceGroups(cube_a.groups);
    scene3d.meshEditSetMode(3);
    try testing.expect(scene3d.meshEditSelectFace(0, false));
    try testing.expectEqual(@as(u32, 2), scene3d.uvZoneAssignSelection(4));

    var cube_b = try fixtures.cube(testing.allocator);
    defer cube_b.deinit();
    const source_b = try testing.allocator.dupe(f32, cube_b.interleaved);
    defer testing.allocator.free(source_b);
    const count_b: u32 = @intCast(cube_b.interleaved.len / 8);
    try testing.expect(scene3d.modelSessionSelect(0x4179));
    scene3d.meshEditBeginModel();
    scene3d.setPaintTarget("uv-zone-session-b", cube_b.interleaved, count_b);
    model_source.retain("uv-zone-session-b", source_b, count_b);
    scene3d.meshEditSetFaceGroups(cube_b.groups);
    try testing.expectEqual(scene3d.UV_ZONE_UNASSIGNED, scene3d.uvZoneOfFace(0));
    scene3d.meshEditSetMode(3);
    try testing.expect(scene3d.meshEditSelectFace(2, false));
    try testing.expectEqual(@as(u32, 2), scene3d.uvZoneAssignSelection(7));

    try testing.expect(scene3d.modelSessionSelect(0x4178));
    try testing.expectEqual(@as(u16, 4), scene3d.uvZoneOfFace(0));
    try testing.expectEqual(@as(u16, 4), scene3d.uvZoneOfFace(1));
    try testing.expectEqual(scene3d.UV_ZONE_UNASSIGNED, scene3d.uvZoneOfFace(2));

    try testing.expect(scene3d.modelSessionSelect(0x4179));
    try testing.expectEqual(scene3d.UV_ZONE_UNASSIGNED, scene3d.uvZoneOfFace(0));
    try testing.expectEqual(@as(u16, 7), scene3d.uvZoneOfFace(2));
    try testing.expectEqual(@as(u16, 7), scene3d.uvZoneOfFace(3));
    _ = scene3d.uvZoneClearAll();
    try testing.expect(scene3d.modelSessionSelect(0x4178));
    _ = scene3d.uvZoneClearAll();
}

test "named edge paths cross the edit-id boundary as stable logical ids" {
    try testing.expect(scene3d.modelSessionSelect(0x4199));
    scene3d.meshEditBeginModel();

    var cube = try fixtures.cube(testing.allocator);
    defer cube.deinit();
    const render_corner_count: u32 = @intCast(cube.interleaved.len / 8);
    scene3d.setPaintTarget("v5-edge-id-boundary", cube.interleaved, render_corner_count);
    const source = try testing.allocator.dupe(f32, cube.interleaved);
    defer testing.allocator.free(source);
    model_source.retain("v5-edge-id-boundary", source, render_corner_count);
    scene3d.meshEditSetFaceGroups(cube.groups);
    scene3d.meshEditSetPartRanges(&.{ 0, 6 });

    const natural_rows = try installExplicitFixtureTopology(&cube);
    defer testing.allocator.free(natural_rows);
    const logical_vertex_count = model_source.logicalVertexCount();
    try testing.expect(logical_vertex_count > 2);
    const permuted_rows = try testing.allocator.dupe(u32, natural_rows);
    defer testing.allocator.free(permuted_rows);
    for (permuted_rows) |*logical_id| logical_id.* = logical_vertex_count - 1 - logical_id.*;
    try testing.expect(model_source.setLogicalTopology(permuted_rows, logical_vertex_count));

    scene3d.meshEditSetMode(2);
    try testing.expect(scene3d.meshEditSelectEdge(0, false));
    var selected_before: [1]mesh_edit.Edge = undefined;
    try testing.expectEqual(@as(u32, 1), mesh_edit.selectedEdgesPub(&selected_before));
    const stable_a = try stableLogicalIdForEditVertex(selected_before[0][0], permuted_rows, render_corner_count);
    const stable_b = try stableLogicalIdForEditVertex(selected_before[0][1], permuted_rows, render_corner_count);
    try testing.expect(stable_a != selected_before[0][0] or stable_b != selected_before[0][1]);

    const receipt = scene3d.meshEdgeSemanticAssignSelection(
        testing.allocator,
        "fixture.hinge",
        "hinge",
        "fixture",
    ) orelse return error.TestUnexpectedResult;
    defer testing.allocator.free(receipt);
    const table_json = model_source.semanticTableJson() orelse return error.TestUnexpectedResult;
    var region = try mesh_edge_semantics.regionByIdAlloc(testing.allocator, table_json, 0);
    defer region.deinit();
    try testing.expectEqualSlices(
        u32,
        &.{ @min(stable_a, stable_b), @max(stable_a, stable_b) },
        region.vertices,
    );
    try testing.expect(try mesh_edge_semantics.pathsResolveInTopology(
        testing.allocator,
        table_json,
        permuted_rows,
        logical_vertex_count,
        cube.groups,
    ));

    try testing.expect(scene3d.meshEditSelectVertex(0, false));
    try testing.expectEqual(@as(u32, 1), scene3d.meshEdgeSemanticSelect(region.id, false));
    var selected_after: [1]mesh_edit.Edge = undefined;
    try testing.expectEqual(@as(u32, 1), mesh_edit.selectedEdgesPub(&selected_after));
    try testing.expect(
        (selected_after[0][0] == selected_before[0][0] and selected_after[0][1] == selected_before[0][1]) or
            (selected_after[0][0] == selected_before[0][1] and selected_after[0][1] == selected_before[0][0]),
    );
}

test "naming an edge on an anonymous glass-reordered prop mints topology immediately" {
    try testing.expect(scene3d.modelSessionSelect(0x4200));
    scene3d.meshEditBeginModel();

    var cube = try fixtures.cube(testing.allocator);
    defer cube.deinit();
    const render_corner_count: u32 = @intCast(cube.interleaved.len / 8);
    scene3d.setPaintTarget("anonymous-edge-after-glass", cube.interleaved, render_corner_count);
    const source = try testing.allocator.dupe(f32, cube.interleaved);
    defer testing.allocator.free(source);
    model_source.retain("anonymous-edge-after-glass", source, render_corner_count);
    scene3d.meshEditSetFaceGroups(cube.groups);
    scene3d.meshEditSetPartRanges(&.{ 0, 6 });
    try testing.expect(scene3d.meshEditSetFaceMaterials(cube.materials));
    try testing.expect(model_source.renderCornerLogicalIds() == null);

    scene3d.meshEditSetMode(3);
    try testing.expect(scene3d.meshEditSelectFace(0, false));
    try testing.expect(scene3d.meshSetSelectionGlass());
    try testing.expect(model_source.renderCornerLogicalIds() == null);

    scene3d.meshEditSetMode(2);
    try testing.expect(scene3d.meshEditSelectEdge(0, false));
    const receipt = scene3d.meshEdgeSemanticAssignSelection(
        testing.allocator,
        "fixture.contact",
        "contact",
        "fixture",
    ) orelse return error.TestUnexpectedResult;
    defer testing.allocator.free(receipt);

    // A named path cannot live even temporarily in the anonymous/edit-id
    // namespace: later opaque/glass sorting may renumber those handles before
    // Save. Edge authoring is therefore the explicit v4 -> v5 mint boundary.
    const logical_rows = model_source.renderCornerLogicalIds() orelse return error.TestUnexpectedResult;
    const logical_vertex_count = model_source.logicalVertexCount();
    const table_json = model_source.semanticTableJson() orelse return error.TestUnexpectedResult;
    try testing.expect(try mesh_edge_semantics.pathsResolveInTopology(
        testing.allocator,
        table_json,
        logical_rows,
        logical_vertex_count,
        model_source.faceGroups(),
    ));
    var snapshot = scene3d.modelDocumentSnapshot(testing.allocator) orelse return error.TestUnexpectedResult;
    defer snapshot.deinit(testing.allocator);
    const encoded = try meshdoc_format.encodeCurrentSnapshotAlloc(
        testing.allocator,
        &snapshot,
        &.{ 0, 6 },
    );
    defer testing.allocator.free(encoded);
    var decoded = try meshdoc_format.decodeDocument(testing.allocator, encoded);
    defer decoded.deinit(testing.allocator);
    try testing.expectEqual(meshdoc_format.VERSION_LOGICAL_TOPOLOGY, decoded.version);
    try testing.expect(decoded.render_corner_logical_ids != null);
    try testing.expect(decoded.semantic_table_json != null);
    try testing.expect(try mesh_edge_semantics.pathsResolveInTopology(
        testing.allocator,
        decoded.semantic_table_json.?,
        decoded.render_corner_logical_ids.?,
        decoded.logical_vertex_count,
        decoded.groups,
    ));
}

test "current v5 face flip preserves exact logical rows through save snapshot" {
    try testing.expect(scene3d.modelSessionSelect(0x4194));
    scene3d.meshEditBeginModel();

    var cube = try fixtures.cube(testing.allocator);
    defer cube.deinit();
    const vertex_count: u32 = @intCast(cube.interleaved.len / 8);
    scene3d.setPaintTarget("v5-logical-flip", cube.interleaved, vertex_count);
    const source = try testing.allocator.dupe(f32, cube.interleaved);
    defer testing.allocator.free(source);
    model_source.retain("v5-logical-flip", source, vertex_count);
    scene3d.meshEditSetFaceGroups(cube.groups);
    scene3d.meshEditSetPartRanges(&.{ 0, 6 });
    const before = try installExplicitFixtureTopology(&cube);
    defer testing.allocator.free(before);
    const logical_vertex_count = model_source.logicalVertexCount();

    scene3d.meshEditSetMode(3);
    try testing.expect(scene3d.meshEditSelectFace(0, false));
    try testing.expect(scene3d.meshFlipSelectionWinding());

    const after = model_source.renderCornerLogicalIds() orelse return error.TestUnexpectedResult;
    try testing.expectEqual(before.len, after.len);
    try testing.expectEqual(logical_vertex_count, model_source.logicalVertexCount());
    for (cube.groups, 0..) |group, face| {
        const base = face * 3;
        if (group == cube.groups[0]) {
            try testing.expectEqual(before[base], after[base]);
            try testing.expectEqual(before[base + 2], after[base + 1]);
            try testing.expectEqual(before[base + 1], after[base + 2]);
        } else {
            try testing.expectEqualSlices(u32, before[base .. base + 3], after[base .. base + 3]);
        }
    }

    var snapshot = scene3d.modelDocumentSnapshot(testing.allocator) orelse return error.TestUnexpectedResult;
    defer snapshot.deinit(testing.allocator);
    try testing.expect(snapshot.render_corner_logical_ids != null);
    try testing.expectEqual(logical_vertex_count, snapshot.logical_vertex_count);
}

test "save restores only exact cached v5 ids and resolves named edge paths first" {
    try testing.expect(scene3d.modelSessionSelect(0x4195));
    scene3d.meshEditBeginModel();

    var cube = try fixtures.cube(testing.allocator);
    defer cube.deinit();
    const vertex_count: u32 = @intCast(cube.interleaved.len / 8);
    scene3d.setPaintTarget("v5-logical-save-recovery", cube.interleaved, vertex_count);
    const source = try testing.allocator.dupe(f32, cube.interleaved);
    defer testing.allocator.free(source);
    model_source.retain("v5-logical-save-recovery", source, vertex_count);
    scene3d.meshEditSetFaceGroups(cube.groups);
    scene3d.meshEditSetPartRanges(&.{ 0, 6 });
    const exact_rows = try installExplicitFixtureTopology(&cube);
    defer testing.allocator.free(exact_rows);
    const logical_vertex_count = model_source.logicalVertexCount();

    const edge_table = try fixtureEdgeTableAlloc(exact_rows[0], exact_rows[1]);
    defer testing.allocator.free(edge_table);
    try testing.expect(try model_source.semanticEdgePathsResolveInTopology(
        testing.allocator,
        edge_table,
        exact_rows,
        logical_vertex_count,
        cube.groups,
    ));
    const unassigned_regions = try testing.allocator.alloc(u32, cube.groups.len);
    defer testing.allocator.free(unassigned_regions);
    @memset(unassigned_regions, model_source.NO_SEMANTIC_ID);
    const unassigned_instances = try testing.allocator.alloc(u32, cube.groups.len);
    defer testing.allocator.free(unassigned_instances);
    @memset(unassigned_instances, model_source.NO_SEMANTIC_ID);
    try testing.expect(model_source.setSemanticState(unassigned_regions, unassigned_instances, edge_table));
    try testing.expect(scene3d.test_support.ensureExplicitIndexedCache());

    // Reproduce only the historical channel-loss state. The cache still owns the
    // explicit ids hydrated from v5; Save must publish those exact rows or remain
    // anonymous. It may never enter the position-weld legacy promotion path.
    model_source.clearLogicalTopology();
    try testing.expect(model_source.renderCornerLogicalIds() == null);
    var snapshot = scene3d.modelDocumentSnapshot(testing.allocator) orelse return error.TestUnexpectedResult;
    defer snapshot.deinit(testing.allocator);

    try testing.expectEqualStrings("", scene3d.test_support.exactIndexedSavePromotionRefusal());
    const restored = model_source.renderCornerLogicalIds() orelse return error.TestUnexpectedResult;
    try testing.expectEqualSlices(u32, exact_rows, restored);
    try testing.expectEqual(logical_vertex_count, model_source.logicalVertexCount());
    try testing.expect(snapshot.render_corner_logical_ids != null);
    try testing.expect(snapshot.semantic_table_json != null);
    try testing.expect(std.mem.indexOf(u8, snapshot.semantic_table_json.?, "\"edgeRegions\"") != null);

    const encoded = try meshdoc_format.encodeCurrentSnapshotAlloc(
        testing.allocator,
        &snapshot,
        &.{ 0, 6 },
    );
    defer testing.allocator.free(encoded);
    var decoded = try meshdoc_format.decodeDocument(testing.allocator, encoded);
    defer decoded.deinit(testing.allocator);
    try testing.expectEqual(meshdoc_format.VERSION_LOGICAL_TOPOLOGY, decoded.version);
    try testing.expect(decoded.render_corner_logical_ids != null);
    try testing.expect(decoded.semantic_table_json != null);
}

test "five-cut preview keeps every minted face inside the focused cube part" {
    try testing.expect(scene3d.modelSessionSelect(0x4276));
    scene3d.meshEditBeginModel();

    var cube = try fixtures.cube(testing.allocator);
    defer cube.deinit();
    scene3d.setPaintTarget("loop-cut-preview-part-ownership", cube.interleaved, @intCast(cube.interleaved.len / 8));
    scene3d.meshEditSetFaceGroups(cube.groups);
    scene3d.meshEditSetPartRanges(&.{ 0, 6 });
    scene3d.meshEditSetScope(0, 6);
    try testing.expect(scene3d.stashActiveEditMesh());

    scene3d.meshEditSetMode(3);
    try testing.expect(scene3d.meshEditSelectFace(0, false));
    try testing.expect(scene3d.meshLoopCutFaceBegin(false) != null);
    try testing.expect(scene3d.meshLoopCutFacePreview(0, 5, 0.5));

    const groups = model_source.faceGroups() orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(usize, 52), groups.len);
    try testing.expectEqual(@as(?u32, 26), mesh_edit.authoredFaceCountFromGroups(groups));
    try testing.expectEqualSlices(u32, &.{ 0, 26 }, model_source.partRanges().?);
    try testing.expect(mesh_edit.ensureTopologyPub());
    for (0..groups.len) |face| {
        try testing.expectEqual(@as(u32, 0), model_source.partIndexOf(groups[face]));
        try testing.expect(mesh_edit.faceInScopePub(@intCast(face)));
    }

    // Cancel is the other half of a preview transaction: the original ownership
    // interval and triangle table return exactly, with no widened range left behind.
    try testing.expect(scene3d.meshLoopCutFaceEnd(false));
    try testing.expectEqualSlices(u32, &.{ 0, 6 }, model_source.partRanges().?);
    try testing.expectEqual(@as(u32, 12), model_paint.faceCount());
}

test "Edge Split keeps coincident face sides independent in the live edit cache" {
    try testing.expect(scene3d.modelSessionSelect(0x4400));
    scene3d.meshEditBeginModel();

    var cube = try fixtures.cube(testing.allocator);
    defer cube.deinit();
    const render_corner_count: u32 = @intCast(cube.interleaved.len / 8);
    scene3d.setPaintTarget("edge-split-live-seam", cube.interleaved, render_corner_count);
    scene3d.meshEditSetFaceGroups(cube.groups);
    scene3d.meshEditSetPartRanges(&.{ 0, 6 });
    try testing.expect(scene3d.stashActiveEditMesh());

    scene3d.meshEditSetMode(2);
    try testing.expectEqual(@as(i32, 12), scene3d.meshEditSelectAll());
    try testing.expect(scene3d.meshTopoSplitEdges());
    try testing.expectEqual(@as(u32, 24), model_source.logicalVertexCount());

    const before = try testing.allocator.dupe(f32, model_paint.positions().?);
    defer testing.allocator.free(before);
    scene3d.meshEditSetMode(3);
    try testing.expect(scene3d.meshEditSelectFace(0, false));
    const mutation = mesh_edit.translateSelection(.{ 0, 0.25, 0 });
    try testing.expect(mutation.changed);
    try testing.expectEqual(@as(u32, 0), mutation.first_face);
    try testing.expectEqual(@as(u32, 1), mutation.last_face);

    const after = model_paint.positions().?;
    for (0..2 * 9) |component| {
        const axis = component % 3;
        const expected = before[component] + @as(f32, if (axis == 1) 0.25 else 0);
        try testing.expectApproxEqAbs(expected, after[component], position_epsilon);
    }
    try testing.expectEqualSlices(f32, before[2 * 9 ..], after[2 * 9 ..]);
}
