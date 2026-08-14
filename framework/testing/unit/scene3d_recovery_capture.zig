//! Native-owner recovery provenance. This uses the real resident Scene3D state;
//! no VCS-side fallback is allowed to make a lying owner receipt appear correct.

const std = @import("std");
const testing = std.testing;
const scene3d = @import("../../gpu/scene3d/root.zig");
const model_source = @import("../../gpu/model_source.zig");
const meshdoc_format = @import("../../gpu/meshdoc_format.zig");

fn degradationFor(
    artifact: *const scene3d.RecoveryCaptureArtifact,
    channel: []const u8,
) ?scene3d.RecoveryCaptureDegradation {
    for (artifact.degradations[0..artifact.degradation_count]) |degradation| {
        if (std.mem.eql(u8, @tagName(degradation.channel), channel)) return degradation;
    }
    return null;
}

test "panic capture reports stripped semantic edge rows as degraded identity" {
    const model_id = "model:semantic-recovery-receipt";
    try testing.expect(scene3d.modelSessionSelect(0x4195));
    scene3d.meshEditBeginModel();

    var verts = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 1, 0,
        0, 1, 0, 0, 0, 1, 0, 1,
    };
    const logical = [_]u32{ 0, 1, 2 };
    scene3d.setPaintTarget(model_id, &verts, 3);
    try testing.expect(model_source.retainWithLogicalTopology(model_id, &verts, 3, &logical, 3));
    scene3d.meshEditSetFaceGroups(&.{0});
    const table =
        "{\"version\":1,\"regions\":[{\"id\":2,\"name\":\"body\"}]," ++
        "\"edgeRegions\":[" ++
        "{\"id\":3,\"name\":\"stale-a\",\"role\":\"hinge\",\"objectId\":\"body\",\"closed\":false,\"vertices\":[90,91]}," ++
        "{\"id\":4,\"name\":\"stale-b\",\"role\":\"boundary\",\"objectId\":\"body\",\"closed\":false,\"vertices\":[92,93]}" ++
        "],\"nextRegionId\":5,\"future\":{\"kept\":true}}";
    try testing.expect(scene3d.meshEditSetFaceSemantics(&.{2}, &.{0}, table));
    scene3d.meshEditSetPartRanges(&.{ 0, 1 });
    try testing.expectEqual(
        model_source.PartObjectIdPublication.changed,
        model_source.publishPartObjectIds(model_id, &.{"body"}),
    );

    var artifact = try scene3d.captureRecoveryArtifactAlloc(testing.allocator, model_id);
    defer artifact.deinit(testing.allocator);
    try testing.expectEqual(@as(u32, 1), artifact.identity_quality);
    try testing.expectEqual(@as(u32, 1), artifact.degradation_count);
    const degradation = artifact.degradations[0];
    try testing.expectEqualStrings("semantic_table", @tagName(degradation.channel));
    try testing.expectEqual(@as(u32, 1 << 3), degradation.action_bits);
    try testing.expectEqual(@as(u64, 1 << 5), degradation.reason_bits);
    try testing.expectEqual(@as(u64, 2), degradation.affected_count);

    var decoded = try meshdoc_format.decodeDocument(testing.allocator, artifact.bytes);
    defer decoded.deinit(testing.allocator);
    const recovered_table = decoded.semantic_table_json orelse return error.TestUnexpectedResult;
    try testing.expect(std.mem.indexOf(u8, recovered_table, "\"edgeRegions\"") == null);
    try testing.expect(std.mem.indexOf(u8, recovered_table, "\"name\":\"body\"") != null);
    try testing.expect(std.mem.indexOf(u8, recovered_table, "\"future\"") != null);
}

test "panic capture reports a wholly dropped semantic table" {
    const model_id = "model:semantic-table-drop-receipt";
    try testing.expect(scene3d.modelSessionSelect(0x4196));
    scene3d.meshEditBeginModel();

    var verts = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 1, 0,
        0, 1, 0, 0, 0, 1, 0, 1,
    };
    scene3d.setPaintTarget(model_id, &verts, 3);
    model_source.retain(model_id, &verts, 3);
    // A stale zero-length group channel makes strict composition fail. Recovery
    // keeps the triangle, but no face-semantic membership exists to anchor this
    // otherwise valid table, so the complete payload is deliberately omitted.
    model_source.setFaceGroups(&.{});
    const table =
        "{\"version\":1,\"regions\":[{\"id\":2,\"name\":\"body\"}]," ++
        "\"future\":{\"kept\":true},\"nextRegionId\":3}";
    try testing.expect(model_source.setSemanticTableJson(table));
    model_source.setPartRanges(&.{ 0, 1 });
    try testing.expectEqual(
        model_source.PartObjectIdPublication.changed,
        model_source.publishPartObjectIds(model_id, &.{"body"}),
    );

    var artifact = try scene3d.captureRecoveryArtifactAlloc(testing.allocator, model_id);
    defer artifact.deinit(testing.allocator);
    try testing.expectEqual(@as(u32, 1), artifact.identity_quality);
    const degradation = degradationFor(&artifact, "semantic_table") orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(u32, 1 << 3), degradation.action_bits);
    try testing.expectEqual(@as(u64, 1 << 5), degradation.reason_bits);
    try testing.expectEqual(@as(u64, 2), degradation.affected_count);

    var decoded = try meshdoc_format.decodeDocument(testing.allocator, artifact.bytes);
    defer decoded.deinit(testing.allocator);
    const recovered_table = decoded.semantic_table_json orelse return error.TestUnexpectedResult;
    try testing.expect(std.mem.indexOf(u8, recovered_table, "\"name\":\"body\"") == null);
    try testing.expect(std.mem.indexOf(u8, recovered_table, "\"future\"") == null);
    const groups = degradationFor(&artifact, "face_groups") orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(u32, 1 << 2), groups.action_bits);
    try testing.expectEqual(@as(u64, 1 << 2), groups.reason_bits);
    try testing.expectEqual(@as(u64, 1), groups.affected_count);
}

test "panic capture reports synthesized logical corners" {
    const model_id = "model:logical-recovery-receipt";
    try testing.expect(scene3d.modelSessionSelect(0x4197));
    scene3d.meshEditBeginModel();
    var verts = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 1, 0,
        0, 1, 0, 0, 0, 1, 0, 1,
        2, 0, 0, 0, 0, 1, 0, 0,
        3, 0, 0, 0, 0, 1, 1, 0,
        2, 1, 0, 0, 0, 1, 0, 1,
    };
    const logical = [_]u32{ 0, 1, 2, 3, 4, 5 };
    scene3d.setPaintTarget(model_id, &verts, 6);
    try testing.expect(model_source.retainWithLogicalTopology(model_id, &verts, 6, &logical, 6));
    scene3d.meshEditSetFaceGroups(&.{ 0, 1 });
    scene3d.meshEditSetPartRanges(&.{ 0, 1, 1, 2 });
    try testing.expect(scene3d.meshSetGroupHidden(1, 2, true, false));
    try testing.expectEqual(
        model_source.PartObjectIdPublication.changed,
        model_source.publishPartObjectIds(model_id, &.{ "body", "hidden" }),
    );

    var exact = model_source.Session{};
    model_source.sessionSave(&exact);
    var missing = exact;
    missing.g_render_corner_logical_id = null;
    missing.g_logical_vertex_count = 0;
    model_source.sessionLoad(&missing);
    defer model_source.sessionLoad(&exact);

    var artifact = try scene3d.captureRecoveryArtifactAlloc(testing.allocator, model_id);
    defer artifact.deinit(testing.allocator);
    const degradation = degradationFor(&artifact, "logical_topology") orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(u32, 1 << 0), degradation.action_bits);
    try testing.expectEqual(@as(u64, 1 << 6), degradation.reason_bits);
    try testing.expectEqual(@as(u64, 3), degradation.affected_count);
    try testing.expectEqual(@as(u32, 1), artifact.identity_quality);

    var decoded = try meshdoc_format.decodeDocument(testing.allocator, artifact.bytes);
    defer decoded.deinit(testing.allocator);
    try testing.expectEqual(@as(u32, 6), decoded.logical_vertex_count);
    try testing.expectEqual(@as(usize, 6), decoded.render_corner_logical_ids.?.len);
}

test "panic capture reports a composed logical-position conflict as fully dropped" {
    const model_id = "model:logical-conflict-recovery-receipt";
    try testing.expect(scene3d.modelSessionSelect(0x4200));
    scene3d.meshEditBeginModel();
    var verts = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 1, 0,
        0, 1, 0, 0, 0, 1, 0, 1,
        2, 0, 0, 0, 0, 1, 0, 0,
        3, 0, 0, 0, 0, 1, 1, 0,
        2, 1, 0, 0, 0, 1, 0, 1,
    };
    const logical = [_]u32{ 0, 1, 2, 3, 4, 5 };
    scene3d.setPaintTarget(model_id, &verts, 6);
    try testing.expect(model_source.retainWithLogicalTopology(model_id, &verts, 6, &logical, 6));
    scene3d.meshEditSetFaceGroups(&.{ 0, 1 });
    scene3d.meshEditSetPartRanges(&.{ 0, 1, 1, 2 });
    try testing.expect(scene3d.meshSetGroupHidden(1, 2, true, false));
    try testing.expectEqual(
        model_source.PartObjectIdPublication.changed,
        model_source.publishPartObjectIds(model_id, &.{ "body", "hidden" }),
    );

    var exact = model_source.Session{};
    model_source.sessionSave(&exact);
    const conflicting = try testing.allocator.dupe(u32, &.{ 3, 6, 7 });
    var stale = exact;
    stale.g_render_corner_logical_id = conflicting;
    stale.g_logical_vertex_count = 8;
    model_source.sessionLoad(&stale);
    defer {
        model_source.sessionLoad(&exact);
        testing.allocator.free(conflicting);
    }

    var artifact = try scene3d.captureRecoveryArtifactAlloc(testing.allocator, model_id);
    defer artifact.deinit(testing.allocator);
    const degradation = degradationFor(&artifact, "logical_topology") orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(u32, 1 << 3), degradation.action_bits);
    try testing.expectEqual(@as(u64, 1 << 6), degradation.reason_bits);
    try testing.expectEqual(@as(u64, 6), degradation.affected_count);

    var decoded = try meshdoc_format.decodeDocument(testing.allocator, artifact.bytes);
    defer decoded.deinit(testing.allocator);
    try testing.expectEqual(@as(u32, 0), decoded.logical_vertex_count);
    try testing.expect(decoded.render_corner_logical_ids == null);
}

test "panic capture reports defaulted semantic membership" {
    const model_id = "model:semantic-membership-recovery-receipt";
    try testing.expect(scene3d.modelSessionSelect(0x4198));
    scene3d.meshEditBeginModel();
    var verts = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 1, 0,
        0, 1, 0, 0, 0, 1, 0, 1,
        2, 0, 0, 0, 0, 1, 0, 0,
        3, 0, 0, 0, 0, 1, 1, 0,
        2, 1, 0, 0, 0, 1, 0, 1,
    };
    scene3d.setPaintTarget(model_id, &verts, 6);
    model_source.retain(model_id, &verts, 6);
    scene3d.meshEditSetFaceGroups(&.{ 0, 1 });
    const table = "{\"version\":1,\"regions\":[{\"id\":2,\"name\":\"body\"}],\"nextRegionId\":3}";
    try testing.expect(scene3d.meshEditSetFaceSemantics(&.{ 2, 2 }, &.{ 0, 0 }, table));
    scene3d.meshEditSetPartRanges(&.{ 0, 1, 1, 2 });
    try testing.expect(scene3d.meshSetGroupHidden(1, 2, true, false));
    try testing.expectEqual(
        model_source.PartObjectIdPublication.changed,
        model_source.publishPartObjectIds(model_id, &.{ "body", "hidden" }),
    );

    var exact = model_source.Session{};
    model_source.sessionSave(&exact);
    var missing = exact;
    missing.g_source_face_region = null;
    model_source.sessionLoad(&missing);
    defer model_source.sessionLoad(&exact);

    var artifact = try scene3d.captureRecoveryArtifactAlloc(testing.allocator, model_id);
    defer artifact.deinit(testing.allocator);
    const degradation = degradationFor(&artifact, "semantic_membership") orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(u32, 1 << 2), degradation.action_bits);
    try testing.expectEqual(@as(u64, 1 << 4), degradation.reason_bits);
    try testing.expectEqual(@as(u64, 1), degradation.affected_count);

    var decoded = try meshdoc_format.decodeDocument(testing.allocator, artifact.bytes);
    defer decoded.deinit(testing.allocator);
    try testing.expectEqual(@as(usize, 2), decoded.semantic_regions.?.len);
    try testing.expectEqual(@as(u32, std.math.maxInt(u32)), decoded.semantic_regions.?[0]);
    try testing.expectEqual(@as(u32, 2), decoded.semantic_regions.?[1]);
}

test "panic capture reports a dropped invalid material row" {
    const model_id = "model:material-recovery-receipt";
    try testing.expect(scene3d.modelSessionSelect(0x4199));
    scene3d.meshEditBeginModel();
    var verts = [_]f32{
        0, 0, 0, 0, 0, 1, 0, 0,
        1, 0, 0, 0, 0, 1, 1, 0,
        0, 1, 0, 0, 0, 1, 0, 1,
    };
    scene3d.setPaintTarget(model_id, &verts, 3);
    model_source.retain(model_id, &verts, 3);
    scene3d.meshEditSetFaceGroups(&.{0});
    model_source.setFaceMaterials(&.{7});
    scene3d.meshEditSetPartRanges(&.{ 0, 1 });
    try testing.expectEqual(
        model_source.PartObjectIdPublication.changed,
        model_source.publishPartObjectIds(model_id, &.{"body"}),
    );

    var exact = model_source.Session{};
    model_source.sessionSave(&exact);
    const stale_materials = try testing.allocator.alloc(u32, 0);
    var stale = exact;
    stale.g_source_face_material = stale_materials;
    model_source.sessionLoad(&stale);
    defer {
        model_source.sessionLoad(&exact);
        testing.allocator.free(stale_materials);
    }

    var artifact = try scene3d.captureRecoveryArtifactAlloc(testing.allocator, model_id);
    defer artifact.deinit(testing.allocator);
    const degradation = degradationFor(&artifact, "materials") orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(u32, 1 << 3), degradation.action_bits);
    try testing.expectEqual(@as(u64, 1 << 3), degradation.reason_bits);
    try testing.expectEqual(@as(u64, 1), degradation.affected_count);

    var decoded = try meshdoc_format.decodeDocument(testing.allocator, artifact.bytes);
    defer decoded.deinit(testing.allocator);
    try testing.expect(decoded.materials == null);
}
