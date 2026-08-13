const std = @import("std");
const character_rig_session = @import("character_rig_session");
const skeleton = character_rig_session.schema;
const humanoid = character_rig_session.canonical_humanoid;

fn quote(writer: *std.Io.Writer, value: []const u8) !void {
    try writer.writeByte('"');
    for (value) |byte| switch (byte) {
        '"' => try writer.writeAll("\\\""),
        '\\' => try writer.writeAll("\\\\"),
        '\n' => try writer.writeAll("\\n"),
        '\r' => try writer.writeAll("\\r"),
        '\t' => try writer.writeAll("\\t"),
        0...8, 11, 12, 14...31 => try writer.print("\\u{x:0>4}", .{byte}),
        else => try writer.writeByte(byte),
    };
    try writer.writeByte('"');
}

fn vec3(writer: *std.Io.Writer, value: skeleton.Vec3) !void {
    try writer.print("[{d},{d},{d}]", .{ value[0], value[1], value[2] });
}

fn quat(writer: *std.Io.Writer, value: skeleton.Quat) !void {
    try writer.print("[{d},{d},{d},{d}]", .{ value[0], value[1], value[2], value[3] });
}

fn joint(writer: *std.Io.Writer, value: skeleton.Joint) !void {
    try writer.writeAll("{\"kind\":");
    try quote(writer, @tagName(value.kind));
    switch (value.kind) {
        .fixed => {},
        .ball => try writer.print(
            ",\"swingX\":{{\"min\":{d},\"max\":{d}}},\"swingZ\":{{\"min\":{d},\"max\":{d}}},\"twistY\":{{\"min\":{d},\"max\":{d}}}",
            .{ value.swing_x.?.min, value.swing_x.?.max, value.swing_z.?.min, value.swing_z.?.max, value.twist_y.?.min, value.twist_y.?.max },
        ),
        else => {
            try writer.writeAll(",\"axis\":");
            try vec3(writer, value.axis.?);
            if (value.limit_min != null and value.limit_max != null) {
                try writer.print(",\"limits\":{{\"min\":{d},\"max\":{d}}}", .{ value.limit_min.?, value.limit_max.? });
            }
        },
    }
    try writer.writeByte('}');
}

fn skeletonJsonWithFit(
    allocator: std.mem.Allocator,
    break_parent: bool,
    fit_source: []const u8,
    fit_confidence: f32,
    shape_hash: []const u8,
) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    const writer = &output.writer;
    try writer.writeAll("{\"id\":\"starter-skeleton\",\"bones\":[");
    for (humanoid.HUMANOID_V1_BONES, 0..) |bone, index| {
        if (index != 0) try writer.writeByte(',');
        try writer.writeAll("{\"id\":");
        try quote(writer, bone.id);
        try writer.writeAll(",\"displayName\":");
        try quote(writer, bone.display_name orelse bone.id);
        try writer.writeAll(",\"parent\":");
        if (break_parent and index == 8) {
            try quote(writer, "pelvis");
        } else if (bone.parent) |parent| {
            try quote(writer, parent);
        } else {
            try writer.writeAll("null");
        }
        try writer.writeAll(",\"transform\":{\"pos\":");
        try vec3(writer, bone.transform.pos);
        try writer.writeAll(",\"rot\":");
        try quat(writer, bone.transform.rot);
        try writer.writeAll(",\"scale\":");
        try vec3(writer, bone.transform.scale);
        try writer.writeByte('}');
        if (bone.tip) |tip| {
            try writer.writeAll(",\"tip\":");
            try vec3(writer, tip);
        }
        if (bone.joint) |joint_value| {
            try writer.writeAll(",\"joint\":");
            try joint(writer, joint_value);
        }
        try writer.writeByte('}');
    }
    try writer.writeAll("],\"characterRig\":{\"version\":1,\"state\":\"draft\",\"semanticBindings\":[");
    for (humanoid.HUMANOID_V1_SEMANTIC_BINDINGS, 0..) |binding, index| {
        if (index != 0) try writer.writeByte(',');
        try writer.writeAll("{\"role\":");
        try quote(writer, @tagName(binding.role));
        if (binding.side) |side| {
            try writer.writeAll(",\"side\":");
            try quote(writer, @tagName(side));
        }
        try writer.writeAll(",\"boneId\":");
        try quote(writer, binding.bone_id);
        try writer.writeByte('}');
    }
    try writer.writeAll("],\"objectBindings\":[{\"objectId\":\"body-object\",\"mode\":\"body\"}],\"fit\":{");
    for (humanoid.HUMANOID_V1_BONE_IDS, 0..) |bone_id, index| {
        if (index != 0) try writer.writeByte(',');
        try quote(writer, bone_id);
        try writer.writeAll(":{\"source\":");
        try quote(writer, fit_source);
        try writer.print(",\"confidence\":{d},\"locked\":false}}", .{fit_confidence});
    }
    try writer.writeAll("},\"shapeHash\":");
    try quote(writer, shape_hash);
    try writer.writeAll("}}");
    return allocator.dupe(u8, output.written());
}

fn skeletonJson(allocator: std.mem.Allocator, break_parent: bool) ![]u8 {
    return skeletonJsonWithFit(allocator, break_parent, "template", 0.5, "");
}

fn openRequestWithFit(
    allocator: std.mem.Allocator,
    break_parent: bool,
    fit_source: []const u8,
    fit_confidence: f32,
    shape_hash: []const u8,
) ![]u8 {
    const skeleton_json = try skeletonJsonWithFit(
        allocator,
        break_parent,
        fit_source,
        fit_confidence,
        shape_hash,
    );
    defer allocator.free(skeleton_json);
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"op\":\"open\",\"payload\":{\"documentId\":\"doc\",\"modelId\":\"model\",\"packagePath\":\"models/model\",\"modelSourceKey\":\"resident:mesh\",\"rangeObjectIds\":[\"body-object\"],\"skeletonJson\":");
    try quote(&output.writer, skeleton_json);
    try output.writer.writeAll("}}");
    return allocator.dupe(u8, output.written());
}

fn openRequest(allocator: std.mem.Allocator, break_parent: bool) ![]u8 {
    return openRequestWithFit(allocator, break_parent, "template", 0.5, "");
}

fn shapeHashHex(verts: []const f32, logical_vertex_count: u32) [64]u8 {
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update("RJIT.character.shape.v1\x00");
    var bytes: [4]u8 = undefined;
    std.mem.writeInt(u32, &bytes, logical_vertex_count, .little);
    hash.update(&bytes);
    for (0..logical_vertex_count) |logical_id| {
        const at: usize = @as(usize, @intCast(logical_id)) * 8;
        for (verts[at..][0..3]) |value| {
            std.mem.writeInt(u32, &bytes, @bitCast(value), .little);
            hash.update(&bytes);
        }
    }
    var digest: [32]u8 = undefined;
    hash.final(&digest);
    return std.fmt.bytesToHex(digest, .lower);
}

fn parseReply(allocator: std.mem.Allocator, reply: []const u8) !std.json.Parsed(std.json.Value) {
    return std.json.parseFromSlice(std.json.Value, allocator, reply, .{});
}

fn pickFirstLogicalVertex(_: f32, _: f32) ?u32 {
    return 0;
}

var viewport_sync_count: usize = 0;
var viewport_clear_count: usize = 0;
var viewport_bind_mesh = false;
var viewport_deformed_mesh = false;
var viewport_joint_editable = true;
var viewport_specimen_separation: f32 = -1;

const RigViewportSyncPointer = @typeInfo(@FieldType(character_rig_session.ResidentContext, "sync_rig_viewport")).optional.child;
const RigViewportSyncFunction = @typeInfo(RigViewportSyncPointer).pointer.child;
const RigViewportStatePointer = @typeInfo(RigViewportSyncFunction).@"fn".params[0].type.?;
const RigViewportState = @typeInfo(RigViewportStatePointer).pointer.child;

fn captureRigViewport(state: *const RigViewportState) void {
    viewport_sync_count += 1;
    viewport_bind_mesh = state.bind_mesh;
    viewport_deformed_mesh = state.deformed_mesh;
    viewport_joint_editable = state.joint_editable;
    viewport_specimen_separation = state.specimen_separation;
}

fn captureRigViewportClear() void {
    viewport_clear_count += 1;
}

fn resetViewportCapture() void {
    viewport_sync_count = 0;
    viewport_clear_count = 0;
    viewport_bind_mesh = false;
    viewport_deformed_mesh = false;
    viewport_joint_editable = true;
    viewport_specimen_separation = -1;
}

fn commandRequest(
    allocator: std.mem.Allocator,
    session_id: []const u8,
    revision: u64,
    payload_json: []const u8,
) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"op\":\"command\",\"sessionId\":");
    try quote(&output.writer, session_id);
    try output.writer.print(",\"expectedRevision\":{d},\"payload\":", .{revision});
    try output.writer.writeAll(payload_json);
    try output.writer.writeByte('}');
    return allocator.dupe(u8, output.written());
}

fn snapshotRequest(allocator: std.mem.Allocator, session_id: []const u8, revision: u64) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"op\":\"snapshot\",\"sessionId\":");
    try quote(&output.writer, session_id);
    try output.writer.print(",\"expectedRevision\":{d}}}", .{revision});
    return allocator.dupe(u8, output.written());
}

fn inspectRequest(
    allocator: std.mem.Allocator,
    session_id: []const u8,
    revision: u64,
    payload_json: []const u8,
) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"op\":\"inspect\",\"sessionId\":");
    try quote(&output.writer, session_id);
    try output.writer.print(",\"expectedRevision\":{d},\"payload\":", .{revision});
    try output.writer.writeAll(payload_json);
    try output.writer.writeByte('}');
    return allocator.dupe(u8, output.written());
}

fn snapshotBone(snapshot: std.json.ObjectMap, bone_id: []const u8) !std.json.ObjectMap {
    for (snapshot.get("bones").?.array.items) |bone_value| {
        const bone = bone_value.object;
        if (std.mem.eql(u8, bone.get("id").?.string, bone_id)) return bone;
    }
    return error.BoneNotFound;
}

fn inspectedBone(inspection: std.json.ObjectMap, bone_id: []const u8) !std.json.ObjectMap {
    for (inspection.get("bones").?.array.items) |bone_value| {
        const bone = bone_value.object;
        if (std.mem.eql(u8, bone.get("id").?.string, bone_id)) return bone;
    }
    return error.BoneNotFound;
}

fn numberAsF32(value: std.json.Value) f32 {
    return switch (value) {
        .integer => |integer| @floatFromInt(integer),
        .float => |float| @floatCast(float),
        else => unreachable,
    };
}

fn bonePosition(bone: std.json.ObjectMap) [3]f32 {
    const items = bone.get("transform").?.object.get("pos").?.array.items;
    return .{ numberAsF32(items[0]), numberAsF32(items[1]), numberAsF32(items[2]) };
}

fn expectHistory(snapshot: std.json.ObjectMap, undo_depth: i64, redo_depth: i64) !void {
    const history = snapshot.get("history").?.object;
    try std.testing.expectEqual(undo_depth != 0, history.get("canUndo").?.bool);
    try std.testing.expectEqual(redo_depth != 0, history.get("canRedo").?.bool);
    try std.testing.expectEqual(undo_depth, history.get("undoDepth").?.integer);
    try std.testing.expectEqual(redo_depth, history.get("redoDepth").?.integer);
}

test "malformed request fails through JSON rather than escaping the host door" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    const reply = try character_rig_session.handle(std.testing.allocator, "not json");
    defer std.testing.allocator.free(reply);
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, reply, .{});
    defer parsed.deinit();
    try std.testing.expect(!parsed.value.object.get("ok").?.bool);
}

test "open preflight fully validates and owns before resident mutation is eligible" {
    const valid_request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(valid_request);
    try std.testing.expectEqual(
        @as(?usize, 1),
        character_rig_session.preflightOpenRangeObjectCount(
            std.testing.allocator,
            valid_request,
            "resident:mesh",
        ),
    );
    try std.testing.expect(character_rig_session.preflightOpenRangeObjectCount(
        std.testing.allocator,
        valid_request,
        "resident:other",
    ) == null);

    const rejected_skeleton = try openRequest(std.testing.allocator, true);
    defer std.testing.allocator.free(rejected_skeleton);
    try std.testing.expect(character_rig_session.preflightOpenRangeObjectCount(
        std.testing.allocator,
        rejected_skeleton,
        "resident:mesh",
    ) == null);
    try std.testing.expect(character_rig_session.preflightOpenRangeObjectCount(
        std.testing.allocator,
        "{\"op\":\"open\",\"payload\":{}}",
        "resident:mesh",
    ) == null);
}

test "attach preflight identifies the largest connected object before installing a rig" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    var verts = [_]f32{
        0, 0, 0, 0, 1, 0, 0, 0,
        1, 0, 0, 0, 1, 0, 1, 0,
        0, 1, 0, 0, 1, 0, 0, 1,
        2, 0, 0, 0, 1, 0, 0, 0,
        3, 0, 0, 0, 1, 0, 1, 0,
        2, 1, 0, 0, 1, 0, 0, 1,
        3, 1, 0, 0, 1, 0, 1, 1,
        2, 0, 0, 0, 1, 0, 0, 0,
        2, 1, 0, 0, 1, 0, 0, 1,
    };
    var groups = [_]u32{ 0, 1, 1 };
    var semantics = [_]u32{ 0, 0, 0 };
    var instances = [_]u32{ 0, 0, 0 };
    var logical = [_]u32{ 0, 1, 2, 3, 4, 5, 4, 6, 5 };
    var dense_to_stable = [_]u32{ 0, 1, 2, 3, 4, 5, 6 };
    var semantic_json = "{\"version\":1,\"regions\":[{\"id\":0,\"name\":\"Pelvis\",\"role\":\"pelvis\"}]}".*;
    var snapshot = character_rig_session.MeshDocSnapshot{
        .verts = &verts,
        .groups = &groups,
        .materials = null,
        .semantic_regions = &semantics,
        .semantic_instances = &instances,
        .render_corner_logical_ids = &logical,
        .logical_vertex_count = 7,
        .dense_to_stable_logical_ids = &dense_to_stable,
        .semantic_table_json = &semantic_json,
        .glass_first_vertex = 9,
    };
    const ranges = [_]u32{ 0, 1, 1, 2 };
    const resident = character_rig_session.ResidentContext{
        .io = std.testing.io,
        .source_key = "resident:mesh",
        .snapshot = &snapshot,
        .ranges = &ranges,
    };
    const reply = try character_rig_session.handleResident(
        std.testing.allocator,
        "{\"op\":\"preflightAttach\",\"payload\":{\"rangeObjectIds\":[\"part:hat\",\"part:body\"]}}",
        &resident,
    );
    defer std.testing.allocator.free(reply);
    var parsed = try parseReply(std.testing.allocator, reply);
    defer parsed.deinit();
    try std.testing.expect(parsed.value.object.get("ok").?.bool);
    const value = parsed.value.object.get("value").?.object;
    try std.testing.expect(!value.get("accepted").?.bool);
    try std.testing.expectEqualStrings("part:hat", value.get("candidateBodyObjectId").?.string);
    try std.testing.expectEqualStrings("part:body", value.get("recommendedBodyObjectId").?.string);
    const objects = value.get("objects").?.array.items;
    try std.testing.expectEqual(@as(usize, 2), objects.len);
    try std.testing.expectEqual(@as(i64, 1), objects[0].object.get("largestConnectedTriangles").?.integer);
    try std.testing.expectEqual(@as(i64, 2), objects[1].object.get("largestConnectedTriangles").?.integer);
}

test "canonical camelCase skeleton opens into a compact revision-zero snapshot" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    const request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(request);
    const reply = try character_rig_session.handle(std.testing.allocator, request);
    defer std.testing.allocator.free(reply);
    var parsed = try parseReply(std.testing.allocator, reply);
    defer parsed.deinit();
    const root = parsed.value.object;
    try std.testing.expect(root.get("ok").?.bool);
    const snapshot = root.get("value").?.object;
    try std.testing.expectEqual(@as(i64, 0), snapshot.get("revision").?.integer);
    try std.testing.expectEqual(@as(usize, 24), snapshot.get("bones").?.array.items.len);
    try std.testing.expectEqualStrings("root", snapshot.get("bones").?.array.items[0].object.get("id").?.string);
    try std.testing.expect(snapshot.get("fitNeedsReview").?.bool);
    try expectHistory(snapshot, 0, 0);
}

test "external rig adoption converts render corners to logical weights and replaces the fixed palette" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    var verts = [_]f32{
        0, 0, 0,   0, 1, 0, 0, 0,
        1, 0, 0.1, 0, 1, 0, 1, 0,
        0, 1, 0.2, 0, 1, 0, 0, 1,
        0, 1, 0.2, 0, 1, 0, 0, 1,
        1, 0, 0.1, 0, 1, 0, 1, 0,
        1, 1, 0.3, 0, 1, 0, 1, 1,
    };
    var groups = [_]u32{ 0, 0 };
    var semantics = [_]u32{ 0, 0 };
    var instances = [_]u32{ 0, 0 };
    var logical = [_]u32{ 0, 1, 2, 2, 1, 3 };
    var dense_to_stable = [_]u32{ 0, 1, 2, 3 };
    var semantic_json = "{\"version\":1,\"regions\":[{\"id\":0,\"name\":\"Head\",\"role\":\"head\"}]}".*;
    var snapshot = character_rig_session.MeshDocSnapshot{
        .verts = &verts,
        .groups = &groups,
        .materials = null,
        .semantic_regions = &semantics,
        .semantic_instances = &instances,
        .render_corner_logical_ids = &logical,
        .logical_vertex_count = 4,
        .dense_to_stable_logical_ids = &dense_to_stable,
        .semantic_table_json = &semantic_json,
        .glass_first_vertex = 6,
    };
    const ranges = [_]u32{ 0, 1 };
    const resident = character_rig_session.ResidentContext{
        .io = std.testing.io,
        .source_key = "resident:mesh",
        .snapshot = &snapshot,
        .ranges = &ranges,
        .sync_rig_viewport = captureRigViewport,
        .clear_rig_viewport = captureRigViewportClear,
    };
    resetViewportCapture();
    const open_request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(open_request);
    const open_reply = try character_rig_session.handleResident(std.testing.allocator, open_request, &resident);
    defer std.testing.allocator.free(open_reply);
    var opened = try parseReply(std.testing.allocator, open_reply);
    defer opened.deinit();
    const open_value = opened.value.object.get("value").?.object;
    const session_id = open_value.get("sessionId").?.string;

    const adopt_request = try commandRequest(
        std.testing.allocator,
        session_id,
        0,
        "{\"kind\":\"adoptExternalRig\",\"partNames\":[\"head\"],\"rig\":{\"ok\":true,\"cls\":\"rignet\",\"joints\":[[0,0,0],[0,-0.1,1],[0,-0.2,2]],\"parents\":[-1,0,1],\"vertices\":[[0,0,0],[1,-0.1,0],[0,-0.2,1],[0,-0.2,1],[1,-0.1,0],[1,-0.3,1]],\"skin_top4\":[[[0,1]],[[1,1]],[[2,1]],[[2,1]],[[2,1]],[[2,1]]]}}",
    );
    defer std.testing.allocator.free(adopt_request);
    const adopt_reply = try character_rig_session.handleResident(std.testing.allocator, adopt_request, &resident);
    defer std.testing.allocator.free(adopt_reply);
    var adopted = try parseReply(std.testing.allocator, adopt_reply);
    defer adopted.deinit();
    try std.testing.expect(adopted.value.object.get("ok").?.bool);
    const adopted_value = adopted.value.object.get("value").?.object;
    try std.testing.expectEqualStrings("bound", adopted_value.get("state").?.string);
    const adopted_readiness = adopted_value.get("readiness").?.array.items;
    try std.testing.expectEqualStrings("connected_body", adopted_readiness[0].object.get("id").?.string);
    try std.testing.expectEqualStrings("ready", adopted_readiness[0].object.get("status").?.string);
    try std.testing.expect(std.mem.indexOf(
        u8,
        adopted_readiness[0].object.get("detail").?.string,
        "authoring diagnostic",
    ) != null);
    try std.testing.expectEqualStrings("required_semantics", adopted_readiness[1].object.get("id").?.string);
    try std.testing.expectEqualStrings("blocked", adopted_readiness[1].object.get("status").?.string);
    try std.testing.expect(std.mem.indexOf(
        u8,
        adopted_readiness[1].object.get("detail").?.string,
        "required semantic bone roles",
    ) != null);
    const adopted_bones = adopted_value.get("bones").?.array.items;
    try std.testing.expectEqual(@as(usize, 3), adopted_bones.len);
    try std.testing.expectEqualStrings("external_joint_0", adopted_bones[0].object.get("id").?.string);
    try std.testing.expectEqualStrings("external", adopted_bones[0].object.get("fit").?.object.get("source").?.string);
    try std.testing.expectEqualStrings("head 1", adopted_bones[0].object.get("displayName").?.string);
    const child_position = adopted_bones[1].object.get("transform").?.object.get("pos").?.array.items;
    try std.testing.expectApproxEqAbs(@as(f32, 0), numberAsF32(child_position[0]), 1.0e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 1), numberAsF32(child_position[1]), 1.0e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 0.1), numberAsF32(child_position[2]), 1.0e-6);

    const semantic_request = try commandRequest(
        std.testing.allocator,
        session_id,
        1,
        "{\"kind\":\"setSemanticBinding\",\"boneId\":\"external_joint_1\",\"role\":\"pelvis\"}",
    );
    defer std.testing.allocator.free(semantic_request);
    const semantic_reply = try character_rig_session.handleResident(std.testing.allocator, semantic_request, &resident);
    defer std.testing.allocator.free(semantic_reply);
    var semantic = try parseReply(std.testing.allocator, semantic_reply);
    defer semantic.deinit();
    try std.testing.expect(semantic.value.object.get("ok").?.bool);
    const semantic_value = semantic.value.object.get("value").?.object;
    const semantic_bindings = semantic_value.get("semanticBindings").?.array.items;
    try std.testing.expectEqual(@as(usize, 2), semantic_bindings.len);
    try std.testing.expectEqualStrings("pelvis", semantic_bindings[1].object.get("role").?.string);
    try std.testing.expectEqualStrings("external_joint_1", semantic_bindings[1].object.get("boneId").?.string);
    try std.testing.expectEqualStrings(
        "Pelvis",
        semantic_value.get("bones").?.array.items[1].object.get("displayName").?.string,
    );
    try std.testing.expectEqualStrings(
        "blocked",
        semantic_value.get("readiness").?.array.items[1].object.get("status").?.string,
    );

    // The mesh and its adopted skeleton are one scale transaction at the
    // editor boundary. Simulate the already-applied resident half, then prove
    // the native half retains palette/weight identity while resizing every
    // bind translation and terminal tip.
    for (0..6) |corner| {
        const at = corner * 8;
        for (verts[at..][0..3]) |*component| component.* *= 2;
    }
    const scale_request = try commandRequest(
        std.testing.allocator,
        session_id,
        2,
        "{\"kind\":\"scaleExternalSkeleton\",\"factor\":2}",
    );
    defer std.testing.allocator.free(scale_request);
    const scale_reply = try character_rig_session.handleResident(std.testing.allocator, scale_request, &resident);
    defer std.testing.allocator.free(scale_reply);
    var scaled = try parseReply(std.testing.allocator, scale_reply);
    defer scaled.deinit();
    try std.testing.expect(scaled.value.object.get("ok").?.bool);
    const scaled_value = scaled.value.object.get("value").?.object;
    const scaled_bones = scaled_value.get("bones").?.array.items;
    const scaled_child_position = scaled_bones[1].object.get("transform").?.object.get("pos").?.array.items;
    try std.testing.expectApproxEqAbs(@as(f32, 2), numberAsF32(scaled_child_position[1]), 1.0e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 0.2), numberAsF32(scaled_child_position[2]), 1.0e-6);
    const scaled_leaf_tip = scaled_bones[2].object.get("tip").?.array.items;
    try std.testing.expectApproxEqAbs(@as(f32, 0.7), numberAsF32(scaled_leaf_tip[1]), 1.0e-6);
    try std.testing.expectEqualStrings(
        "ready",
        scaled_value.get("readiness").?.array.items[3].object.get("status").?.string,
    );

    const probe_request = try inspectRequest(
        std.testing.allocator,
        session_id,
        3,
        "{\"kind\":\"probe\",\"logicalVertexId\":1}",
    );
    defer std.testing.allocator.free(probe_request);
    const probe_reply = try character_rig_session.handleResident(std.testing.allocator, probe_request, &resident);
    defer std.testing.allocator.free(probe_reply);
    var probed = try parseReply(std.testing.allocator, probe_reply);
    defer probed.deinit();
    const influences = probed.value.object.get("value").?.object.get("influences").?.array.items;
    try std.testing.expectEqualStrings("external_joint_1", influences[0].object.get("boneId").?.string);
    try std.testing.expectApproxEqAbs(@as(f32, 0.5), numberAsF32(influences[0].object.get("weight").?), 1.0e-6);
    try std.testing.expectEqualStrings("external_joint_2", influences[1].object.get("boneId").?.string);
    try std.testing.expectApproxEqAbs(@as(f32, 0.5), numberAsF32(influences[1].object.get("weight").?), 1.0e-6);

    const activate_request = try commandRequest(
        std.testing.allocator,
        session_id,
        3,
        "{\"kind\":\"setViewportActive\",\"active\":true}",
    );
    defer std.testing.allocator.free(activate_request);
    const activate_reply = try character_rig_session.handleResident(std.testing.allocator, activate_request, &resident);
    defer std.testing.allocator.free(activate_reply);
    var activated = try parseReply(std.testing.allocator, activate_reply);
    defer activated.deinit();
    try std.testing.expect(viewport_bind_mesh);
    try std.testing.expect(viewport_deformed_mesh);
    try std.testing.expect(viewport_specimen_separation > 0);

    const one_specimen_request = try commandRequest(
        std.testing.allocator,
        session_id,
        4,
        "{\"kind\":\"setOverlay\",\"overlay\":{\"bindMesh\":false,\"deformedMesh\":true}}",
    );
    defer std.testing.allocator.free(one_specimen_request);
    const one_specimen_reply = try character_rig_session.handleResident(std.testing.allocator, one_specimen_request, &resident);
    defer std.testing.allocator.free(one_specimen_reply);
    var one_specimen = try parseReply(std.testing.allocator, one_specimen_reply);
    defer one_specimen.deinit();
    try std.testing.expect(!viewport_bind_mesh);
    try std.testing.expect(viewport_deformed_mesh);
    try std.testing.expectApproxEqAbs(@as(f32, 0), viewport_specimen_separation, 1.0e-6);
    try std.testing.expectApproxEqAbs(
        @as(f32, 0),
        numberAsF32(one_specimen.value.object.get("value").?.object.get("specimenSeparation").?),
        1.0e-6,
    );

    var save_request_writer: std.Io.Writer.Allocating = .init(std.testing.allocator);
    defer save_request_writer.deinit();
    try save_request_writer.writer.writeAll("{\"op\":\"prepareSave\",\"sessionId\":");
    try quote(&save_request_writer.writer, session_id);
    try save_request_writer.writer.writeAll(",\"expectedRevision\":5}");
    const save_reply = try character_rig_session.handleResident(
        std.testing.allocator,
        save_request_writer.written(),
        &resident,
    );
    defer std.testing.allocator.free(save_reply);
    var saved = try parseReply(std.testing.allocator, save_reply);
    defer saved.deinit();
    try std.testing.expect(saved.value.object.get("ok").?.bool);
    const saved_value = saved.value.object.get("value").?.object;
    const geometry_path = saved_value.get("geometry").?.object.get("temporaryPath").?.string;
    const skin_path = saved_value.get("skin").?.object.get("temporaryPath").?.string;
    defer std.Io.Dir.cwd().deleteFile(std.testing.io, geometry_path) catch {};
    defer std.Io.Dir.cwd().deleteFile(std.testing.io, skin_path) catch {};
    try std.testing.expectEqual(@as(usize, 3), saved_value.get("skeleton").?.object.get("bones").?.array.items.len);
    const descriptor = saved_value.get("descriptor").?.object;
    const saved_semantic_bindings = descriptor.get("semanticBindings").?.array.items;
    try std.testing.expectEqual(@as(usize, 2), saved_semantic_bindings.len);
    try std.testing.expectEqualStrings("pelvis", saved_semantic_bindings[1].object.get("role").?.string);
    try std.testing.expectEqualStrings("external_joint_1", saved_semantic_bindings[1].object.get("boneId").?.string);
    try std.testing.expectEqualStrings(
        "SkinTokens",
        descriptor.get("externalProvenance").?.object.get("provider").?.string,
    );
    try std.testing.expectEqualStrings(
        "rignet",
        descriptor.get("externalProvenance").?.object.get("modelClass").?.string,
    );
    const skin_bytes = try std.Io.Dir.cwd().readFileAlloc(
        std.testing.io,
        skin_path,
        std.testing.allocator,
        .limited(1024 * 1024),
    );
    defer std.testing.allocator.free(skin_bytes);
    try std.testing.expectEqual(@as(u16, 3), std.mem.readInt(u16, skin_bytes[12..14], .little));
}

test "runtime parser owns the same canonical skeleton and descriptor" {
    const json = try skeletonJson(std.testing.allocator, false);
    defer std.testing.allocator.free(json);
    var owned = try character_rig_session.parseOwnedCharacterSkeleton(std.testing.allocator, json);
    defer owned.deinit();

    const parsed = owned.skeleton();
    try std.testing.expectEqual(@as(usize, 24), parsed.bones.len);
    try std.testing.expectEqualStrings("root", parsed.bones[0].id);
    try std.testing.expectEqualStrings("lower_arm_left", parsed.bones[8].id);
    try std.testing.expectEqual(@as(usize, 23), parsed.character_rig.?.semantic_bindings.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.character_rig.?.object_bindings.len);
    try std.testing.expect(parsed.meshes == null);
}

test "draft prepareSave writes and read-verifies one RJMD v5 snapshot" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    var verts = [_]f32{
        0, 0, 0, 0, 1, 0, 0, 0,
        1, 0, 0, 0, 1, 0, 1, 0,
        0, 1, 0, 0, 1, 0, 0, 1,
    };
    var groups = [_]u32{0};
    var semantics = [_]u32{0};
    var instances = [_]u32{0};
    var logical = [_]u32{ 0, 1, 2 };
    var dense_to_stable = [_]u32{ 0, 1, 2 };
    var semantic_json = "{\"version\":1,\"regions\":[{\"id\":0,\"name\":\"Pelvis\",\"role\":\"pelvis\"}]}".*;
    var snapshot = character_rig_session.MeshDocSnapshot{
        .verts = &verts,
        .groups = &groups,
        .materials = null,
        .semantic_regions = &semantics,
        .semantic_instances = &instances,
        .render_corner_logical_ids = &logical,
        .logical_vertex_count = 3,
        .dense_to_stable_logical_ids = &dense_to_stable,
        .semantic_table_json = &semantic_json,
        .glass_first_vertex = 3,
    };
    const ranges = [_]u32{ 0, 1 };
    const resident = character_rig_session.ResidentContext{
        .io = std.testing.io,
        .source_key = "resident:mesh",
        .snapshot = &snapshot,
        .ranges = &ranges,
        .pick_logical_vertex = pickFirstLogicalVertex,
    };
    const open_request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(open_request);
    const open_reply = try character_rig_session.handleResident(std.testing.allocator, open_request, &resident);
    defer std.testing.allocator.free(open_reply);
    var open_parsed = try parseReply(std.testing.allocator, open_reply);
    defer open_parsed.deinit();
    try std.testing.expect(open_parsed.value.object.get("ok").?.bool);
    const session_id = open_parsed.value.object.get("value").?.object.get("sessionId").?.string;

    var request_writer: std.Io.Writer.Allocating = .init(std.testing.allocator);
    defer request_writer.deinit();
    try request_writer.writer.writeAll("{\"op\":\"prepareSave\",\"sessionId\":");
    try quote(&request_writer.writer, session_id);
    try request_writer.writer.writeAll(",\"expectedRevision\":0}");
    const save_reply = try character_rig_session.handleResident(
        std.testing.allocator,
        request_writer.written(),
        &resident,
    );
    defer std.testing.allocator.free(save_reply);
    var save_parsed = try parseReply(std.testing.allocator, save_reply);
    defer save_parsed.deinit();
    try std.testing.expect(save_parsed.value.object.get("ok").?.bool);
    const value = save_parsed.value.object.get("value").?.object;
    try std.testing.expectEqualStrings("draft", value.get("descriptor").?.object.get("state").?.string);
    const geometry = value.get("geometry").?.object;
    const path = geometry.get("temporaryPath").?.string;
    defer std.Io.Dir.cwd().deleteFile(std.testing.io, path) catch {};
    const bytes = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, path, std.testing.allocator, .limited(4096));
    defer std.testing.allocator.free(bytes);
    try std.testing.expectEqual(@as(usize, @intCast(geometry.get("byteLength").?.integer)), bytes.len);
    try std.testing.expectEqualStrings("RJMD", bytes[0..4]);
    try std.testing.expectEqual(@as(u32, 5), std.mem.readInt(u32, bytes[4..8], .little));

    const activate_request = try commandRequest(
        std.testing.allocator,
        session_id,
        0,
        "{\"kind\":\"setViewportActive\",\"active\":true}",
    );
    defer std.testing.allocator.free(activate_request);
    const activate_reply = try character_rig_session.handleResident(
        std.testing.allocator,
        activate_request,
        &resident,
    );
    defer std.testing.allocator.free(activate_reply);
    var activate_parsed = try parseReply(std.testing.allocator, activate_reply);
    defer activate_parsed.deinit();
    try std.testing.expect(activate_parsed.value.object.get("ok").?.bool);

    var probe_request: std.Io.Writer.Allocating = .init(std.testing.allocator);
    defer probe_request.deinit();
    try probe_request.writer.writeAll("{\"op\":\"command\",\"sessionId\":");
    try quote(&probe_request.writer, session_id);
    try probe_request.writer.writeAll(",\"expectedRevision\":1,\"payload\":{\"kind\":\"selectVertex\",\"viewportX\":0,\"viewportY\":0}}");
    const probe_reply = try character_rig_session.handleResident(
        std.testing.allocator,
        probe_request.written(),
        &resident,
    );
    defer std.testing.allocator.free(probe_reply);
    var probe_parsed = try parseReply(std.testing.allocator, probe_reply);
    defer probe_parsed.deinit();
    const probe = probe_parsed.value.object.get("value").?.object.get("selectedVertex").?.object;
    const influences = probe.get("influences").?.array.items;
    try std.testing.expectEqual(@as(usize, 4), influences.len);
    for (influences) |influence| {
        try std.testing.expect(influence.object.get("boneId").? == .null);
        try std.testing.expectEqual(@as(i64, 0), influence.object.get("weight").?.integer);
    }
}

test "position-only sculpt preserves the fitted shape baseline and requests review" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    var verts = [_]f32{
        0, 0, 0, 0, 1, 0, 0, 0,
        1, 0, 0, 0, 1, 0, 1, 0,
        0, 1, 0, 0, 1, 0, 0, 1,
    };
    var groups = [_]u32{0};
    var semantics = [_]u32{0};
    var instances = [_]u32{0};
    var logical = [_]u32{ 0, 1, 2 };
    var dense_to_stable = [_]u32{ 0, 1, 2 };
    var semantic_json = "{\"version\":1,\"regions\":[{\"id\":0,\"name\":\"Pelvis\",\"role\":\"pelvis\"}]}".*;
    var snapshot = character_rig_session.MeshDocSnapshot{
        .verts = &verts,
        .groups = &groups,
        .materials = null,
        .semantic_regions = &semantics,
        .semantic_instances = &instances,
        .render_corner_logical_ids = &logical,
        .logical_vertex_count = 3,
        .dense_to_stable_logical_ids = &dense_to_stable,
        .semantic_table_json = &semantic_json,
        .glass_first_vertex = 3,
    };
    const ranges = [_]u32{ 0, 1 };
    const resident = character_rig_session.ResidentContext{
        .io = std.testing.io,
        .source_key = "resident:mesh",
        .snapshot = &snapshot,
        .ranges = &ranges,
    };
    const fitted_shape = shapeHashHex(&verts, 3);
    const open_request = try openRequestWithFit(
        std.testing.allocator,
        false,
        "boundary",
        1,
        &fitted_shape,
    );
    defer std.testing.allocator.free(open_request);
    const open_reply = try character_rig_session.handleResident(std.testing.allocator, open_request, &resident);
    defer std.testing.allocator.free(open_reply);
    var open_parsed = try parseReply(std.testing.allocator, open_reply);
    defer open_parsed.deinit();
    const open_value = open_parsed.value.object.get("value").?.object;
    try std.testing.expect(!open_value.get("fitNeedsReview").?.bool);
    const session_id = open_value.get("sessionId").?.string;

    // Logical connectivity and semantics are unchanged; only one model-space
    // position moved. Saved weights remain eligible, while the fitted shape is
    // deliberately not advanced until Fit Skeleton is invoked.
    verts[0] = 0.25;
    var snapshot_request: std.Io.Writer.Allocating = .init(std.testing.allocator);
    defer snapshot_request.deinit();
    try snapshot_request.writer.writeAll("{\"op\":\"snapshot\",\"sessionId\":");
    try quote(&snapshot_request.writer, session_id);
    try snapshot_request.writer.writeAll(",\"expectedRevision\":0}");
    const changed_reply = try character_rig_session.handleResident(
        std.testing.allocator,
        snapshot_request.written(),
        &resident,
    );
    defer std.testing.allocator.free(changed_reply);
    var changed = try parseReply(std.testing.allocator, changed_reply);
    defer changed.deinit();
    try std.testing.expect(changed.value.object.get("value").?.object.get("fitNeedsReview").?.bool);

    var save_request: std.Io.Writer.Allocating = .init(std.testing.allocator);
    defer save_request.deinit();
    try save_request.writer.writeAll("{\"op\":\"prepareSave\",\"sessionId\":");
    try quote(&save_request.writer, session_id);
    try save_request.writer.writeAll(",\"expectedRevision\":0}");
    const save_reply = try character_rig_session.handleResident(
        std.testing.allocator,
        save_request.written(),
        &resident,
    );
    defer std.testing.allocator.free(save_reply);
    var saved = try parseReply(std.testing.allocator, save_reply);
    defer saved.deinit();
    const save_value = saved.value.object.get("value").?.object;
    try std.testing.expectEqualStrings(
        &fitted_shape,
        save_value.get("descriptor").?.object.get("shapeHash").?.string,
    );
    const geometry_path = save_value.get("geometry").?.object.get("temporaryPath").?.string;
    defer std.Io.Dir.cwd().deleteFile(std.testing.io, geometry_path) catch {};
}

test "resident rig viewport gates joint editing and reports detached body topology" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();
    resetViewportCapture();

    var verts = [_]f32{
        0, 0, 0, 0, 1, 0, 0, 0,
        1, 0, 0, 0, 1, 0, 1, 0,
        0, 1, 0, 0, 1, 0, 0, 1,
        2, 0, 0, 0, 1, 0, 0, 0,
        3, 0, 0, 0, 1, 0, 1, 0,
        2, 1, 0, 0, 1, 0, 0, 1,
    };
    var groups = [_]u32{ 0, 0 };
    var semantics = [_]u32{ 0, 0 };
    var instances = [_]u32{ 0, 0 };
    var logical = [_]u32{ 0, 1, 2, 3, 4, 5 };
    var dense_to_stable = [_]u32{ 0, 1, 2, 3, 4, 5 };
    var semantic_json = "{\"version\":1,\"regions\":[{\"id\":0,\"name\":\"Pelvis\",\"role\":\"pelvis\"}]}".*;
    var snapshot = character_rig_session.MeshDocSnapshot{
        .verts = &verts,
        .groups = &groups,
        .materials = null,
        .semantic_regions = &semantics,
        .semantic_instances = &instances,
        .render_corner_logical_ids = &logical,
        .logical_vertex_count = 6,
        .dense_to_stable_logical_ids = &dense_to_stable,
        .semantic_table_json = &semantic_json,
        .glass_first_vertex = 6,
    };
    const ranges = [_]u32{ 0, 1 };
    const resident = character_rig_session.ResidentContext{
        .io = std.testing.io,
        .source_key = "resident:mesh",
        .snapshot = &snapshot,
        .ranges = &ranges,
        .pick_logical_vertex = pickFirstLogicalVertex,
        .sync_rig_viewport = captureRigViewport,
        .clear_rig_viewport = captureRigViewportClear,
    };

    const open_request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(open_request);
    const open_reply = try character_rig_session.handleResident(std.testing.allocator, open_request, &resident);
    defer std.testing.allocator.free(open_reply);
    var opened = try parseReply(std.testing.allocator, open_reply);
    defer opened.deinit();
    const open_value = opened.value.object.get("value").?.object;
    try std.testing.expect(!open_value.get("viewportActive").?.bool);
    const body_topology = open_value.get("bodyTopology").?.object;
    try std.testing.expectEqual(@as(i64, 2), body_topology.get("componentCount").?.integer);
    try std.testing.expectEqual(@as(i64, 1), body_topology.get("mainTriangleCount").?.integer);
    try std.testing.expectEqual(@as(i64, 1), body_topology.get("detachedTriangleCount").?.integer);
    try std.testing.expect(body_topology.get("detachedSelectionComplete").?.bool);
    try std.testing.expectEqual(@as(usize, 1), body_topology.get("detachedFaceIndices").?.array.items.len);
    var connected_detail: ?[]const u8 = null;
    for (open_value.get("readiness").?.array.items) |row_value| {
        const row = row_value.object;
        if (std.mem.eql(u8, row.get("id").?.string, "connected_body")) {
            connected_detail = row.get("detail").?.string;
            break;
        }
    }
    try std.testing.expectEqualStrings(
        "body has 2 logical edge components: main 1 triangle; detached 1 triangle",
        connected_detail orelse return error.MissingConnectedBodyReadiness,
    );
    try std.testing.expectEqual(@as(usize, 0), viewport_sync_count);
    try std.testing.expectEqual(@as(usize, 1), viewport_clear_count);
    const session_id = open_value.get("sessionId").?.string;

    const activate_request = try commandRequest(
        std.testing.allocator,
        session_id,
        0,
        "{\"kind\":\"setViewportActive\",\"active\":true}",
    );
    defer std.testing.allocator.free(activate_request);
    const activate_reply = try character_rig_session.handleResident(std.testing.allocator, activate_request, &resident);
    defer std.testing.allocator.free(activate_reply);
    var activated = try parseReply(std.testing.allocator, activate_reply);
    defer activated.deinit();
    try std.testing.expect(activated.value.object.get("value").?.object.get("viewportActive").?.bool);
    try std.testing.expectEqual(@as(usize, 1), viewport_sync_count);
    try std.testing.expect(viewport_bind_mesh);
    try std.testing.expect(!viewport_deformed_mesh);
    try std.testing.expect(!viewport_joint_editable);
    try std.testing.expectApproxEqAbs(@as(f32, 0), viewport_specimen_separation, 1.0e-6);

    const blocked_joint_request = try commandRequest(
        std.testing.allocator,
        session_id,
        1,
        "{\"kind\":\"setJointTransform\",\"boneId\":\"pelvis\",\"transform\":{\"pos\":[0,0.8,0],\"rot\":[0,0,0,1],\"scale\":[1,1,1]}}",
    );
    defer std.testing.allocator.free(blocked_joint_request);
    const blocked_joint_reply = try character_rig_session.handleResident(std.testing.allocator, blocked_joint_request, &resident);
    defer std.testing.allocator.free(blocked_joint_reply);
    var blocked_joint = try parseReply(std.testing.allocator, blocked_joint_reply);
    defer blocked_joint.deinit();
    try std.testing.expect(!blocked_joint.value.object.get("ok").?.bool);
    try std.testing.expectEqual(@as(i64, 1), blocked_joint.value.object.get("currentRevision").?.integer);

    const deactivate_request = try commandRequest(
        std.testing.allocator,
        session_id,
        1,
        "{\"kind\":\"setViewportActive\",\"active\":false}",
    );
    defer std.testing.allocator.free(deactivate_request);
    const deactivate_reply = try character_rig_session.handleResident(std.testing.allocator, deactivate_request, &resident);
    defer std.testing.allocator.free(deactivate_reply);
    var deactivated = try parseReply(std.testing.allocator, deactivate_reply);
    defer deactivated.deinit();
    try std.testing.expect(!deactivated.value.object.get("value").?.object.get("viewportActive").?.bool);
    try std.testing.expectEqual(@as(usize, 1), viewport_sync_count);
    try std.testing.expectEqual(@as(usize, 2), viewport_clear_count);

    const pick_request = try commandRequest(
        std.testing.allocator,
        session_id,
        2,
        "{\"kind\":\"selectVertex\",\"viewportX\":0,\"viewportY\":0}",
    );
    defer std.testing.allocator.free(pick_request);
    const pick_reply = try character_rig_session.handleResident(std.testing.allocator, pick_request, &resident);
    defer std.testing.allocator.free(pick_reply);
    var picked = try parseReply(std.testing.allocator, pick_reply);
    defer picked.deinit();
    try std.testing.expect(!picked.value.object.get("ok").?.bool);
    try std.testing.expectEqual(@as(i64, 2), picked.value.object.get("currentRevision").?.integer);
}

test "bind translation anchors child joints while root translation carries the hierarchy" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    const open_request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(open_request);
    const open_reply = try character_rig_session.handle(std.testing.allocator, open_request);
    defer std.testing.allocator.free(open_reply);
    var opened = try parseReply(std.testing.allocator, open_reply);
    defer opened.deinit();
    const session_id = opened.value.object.get("value").?.object.get("sessionId").?.string;

    const pelvis_request = try commandRequest(
        std.testing.allocator,
        session_id,
        0,
        "{\"kind\":\"setJointTransform\",\"boneId\":\"pelvis\",\"preserveChildren\":true,\"transform\":{\"pos\":[0,0.8,0],\"rot\":[0,0,0,1],\"scale\":[1,1,1]}}",
    );
    defer std.testing.allocator.free(pelvis_request);
    const pelvis_reply = try character_rig_session.handle(std.testing.allocator, pelvis_request);
    defer std.testing.allocator.free(pelvis_reply);
    var pelvis_changed = try parseReply(std.testing.allocator, pelvis_reply);
    defer pelvis_changed.deinit();
    const pelvis_snapshot = pelvis_changed.value.object.get("value").?.object;
    const pelvis_position = bonePosition(try snapshotBone(pelvis_snapshot, "pelvis"));
    const spine_position = bonePosition(try snapshotBone(pelvis_snapshot, "spine_lower"));
    const left_hip_position = bonePosition(try snapshotBone(pelvis_snapshot, "upper_leg_left"));
    const right_hip_position = bonePosition(try snapshotBone(pelvis_snapshot, "upper_leg_right"));
    try std.testing.expectApproxEqAbs(@as(f32, 0.8), pelvis_position[1], 1.0e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 0.30), spine_position[1], 1.0e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 0.16), left_hip_position[1], 1.0e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 0.16), right_hip_position[1], 1.0e-6);
    // The immediate child global origins remain at their canonical heights.
    try std.testing.expectApproxEqAbs(@as(f32, 1.10), pelvis_position[1] + spine_position[1], 1.0e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 0.96), pelvis_position[1] + left_hip_position[1], 1.0e-6);

    const root_request = try commandRequest(
        std.testing.allocator,
        session_id,
        1,
        "{\"kind\":\"setJointTransform\",\"boneId\":\"root\",\"preserveChildren\":true,\"transform\":{\"pos\":[0,0.2,0],\"rot\":[0,0,0,1],\"scale\":[1,1,1]}}",
    );
    defer std.testing.allocator.free(root_request);
    const root_reply = try character_rig_session.handle(std.testing.allocator, root_request);
    defer std.testing.allocator.free(root_reply);
    var root_changed = try parseReply(std.testing.allocator, root_reply);
    defer root_changed.deinit();
    const root_snapshot = root_changed.value.object.get("value").?.object;
    const root_position = bonePosition(try snapshotBone(root_snapshot, "root"));
    const root_child_position = bonePosition(try snapshotBone(root_snapshot, "pelvis"));
    try std.testing.expectApproxEqAbs(@as(f32, 0.2), root_position[1], 1.0e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 0.8), root_child_position[1], 1.0e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 1.0), root_position[1] + root_child_position[1], 1.0e-6);

    // A zero-length segment is invalid. Both the selected transform and its
    // compensated child edits must roll back together, without a revision bump.
    const invalid_request = try commandRequest(
        std.testing.allocator,
        session_id,
        2,
        "{\"kind\":\"setJointTransform\",\"boneId\":\"spine_lower\",\"preserveChildren\":true,\"transform\":{\"pos\":[0,0,0],\"rot\":[0,0,0,1],\"scale\":[1,1,1]}}",
    );
    defer std.testing.allocator.free(invalid_request);
    const invalid_reply = try character_rig_session.handle(std.testing.allocator, invalid_request);
    defer std.testing.allocator.free(invalid_reply);
    var invalid = try parseReply(std.testing.allocator, invalid_reply);
    defer invalid.deinit();
    try std.testing.expect(!invalid.value.object.get("ok").?.bool);
    try std.testing.expectEqual(@as(i64, 2), invalid.value.object.get("currentRevision").?.integer);

    const after_invalid_request = try snapshotRequest(std.testing.allocator, session_id, 2);
    defer std.testing.allocator.free(after_invalid_request);
    const after_invalid_reply = try character_rig_session.handle(std.testing.allocator, after_invalid_request);
    defer std.testing.allocator.free(after_invalid_reply);
    var after_invalid = try parseReply(std.testing.allocator, after_invalid_reply);
    defer after_invalid.deinit();
    const after_invalid_snapshot = after_invalid.value.object.get("value").?.object;
    const preserved_spine = bonePosition(try snapshotBone(after_invalid_snapshot, "spine_lower"));
    const preserved_spine_child = bonePosition(try snapshotBone(after_invalid_snapshot, "spine_upper"));
    try std.testing.expectApproxEqAbs(@as(f32, 0.30), preserved_spine[1], 1.0e-6);
    try std.testing.expectApproxEqAbs(@as(f32, 0.24), preserved_spine_child[1], 1.0e-6);
}

test "absolute joint origins remain model-space under a rotated parent and resize segments" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    const open_request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(open_request);
    const open_reply = try character_rig_session.handle(std.testing.allocator, open_request);
    defer std.testing.allocator.free(open_reply);
    var opened = try parseReply(std.testing.allocator, open_reply);
    defer opened.deinit();
    const session_id = opened.value.object.get("value").?.object.get("sessionId").?.string;

    const rotate_parent = try commandRequest(
        std.testing.allocator,
        session_id,
        0,
        "{\"kind\":\"setJointGlobalTransform\",\"boneId\":\"pelvis\",\"origin\":[0,1,0],\"frame\":[0,0,0.70710678,0.70710678]}",
    );
    defer std.testing.allocator.free(rotate_parent);
    const rotate_reply = try character_rig_session.handle(std.testing.allocator, rotate_parent);
    defer std.testing.allocator.free(rotate_reply);
    var rotated = try parseReply(std.testing.allocator, rotate_reply);
    defer rotated.deinit();
    try std.testing.expect(rotated.value.object.get("ok").?.bool);

    const place_child = try commandRequest(
        std.testing.allocator,
        session_id,
        1,
        "{\"kind\":\"setJointGlobalTransform\",\"boneId\":\"spine_lower\",\"origin\":[0.25,1.1,0]}",
    );
    defer std.testing.allocator.free(place_child);
    const place_reply = try character_rig_session.handle(std.testing.allocator, place_child);
    defer std.testing.allocator.free(place_reply);
    var placed = try parseReply(std.testing.allocator, place_reply);
    defer placed.deinit();
    try std.testing.expect(placed.value.object.get("ok").?.bool);

    const inspect_request = try inspectRequest(std.testing.allocator, session_id, 2, "{\"kind\":\"skeleton\"}");
    defer std.testing.allocator.free(inspect_request);
    const inspect_reply = try character_rig_session.handle(std.testing.allocator, inspect_request);
    defer std.testing.allocator.free(inspect_reply);
    var inspected = try parseReply(std.testing.allocator, inspect_reply);
    defer inspected.deinit();
    const inspection = inspected.value.object.get("value").?.object;
    const spine = try inspectedBone(inspection, "spine_lower");
    const origin = spine.get("origin").?.array.items;
    try std.testing.expectApproxEqAbs(@as(f32, 0.25), numberAsF32(origin[0]), 1.0e-5);
    try std.testing.expectApproxEqAbs(@as(f32, 1.1), numberAsF32(origin[1]), 1.0e-5);
    const local = spine.get("localTransform").?.object.get("pos").?.array.items;
    try std.testing.expectApproxEqAbs(@as(f32, 0.1), numberAsF32(local[0]), 1.0e-5);
    try std.testing.expectApproxEqAbs(@as(f32, -0.25), numberAsF32(local[1]), 1.0e-5);
    const pelvis = try inspectedBone(inspection, "pelvis");
    try std.testing.expectApproxEqAbs(@as(f32, @sqrt(0.0725)), numberAsF32(pelvis.get("segmentLength").?), 1.0e-5);
}

test "joint mirror reflects absolute source-side origins onto canonical counterparts" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    const open_request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(open_request);
    const open_reply = try character_rig_session.handle(std.testing.allocator, open_request);
    defer std.testing.allocator.free(open_reply);
    var opened = try parseReply(std.testing.allocator, open_reply);
    defer opened.deinit();
    const session_id = opened.value.object.get("value").?.object.get("sessionId").?.string;

    const place_left = try commandRequest(
        std.testing.allocator,
        session_id,
        0,
        "{\"kind\":\"setJointGlobalTransform\",\"boneId\":\"lower_arm_left\",\"origin\":[-0.81,1.41,0.07]}",
    );
    defer std.testing.allocator.free(place_left);
    const place_reply = try character_rig_session.handle(std.testing.allocator, place_left);
    defer std.testing.allocator.free(place_reply);

    const mirror = try commandRequest(
        std.testing.allocator,
        session_id,
        1,
        "{\"kind\":\"mirrorJoints\",\"source\":\"left\"}",
    );
    defer std.testing.allocator.free(mirror);
    const mirror_reply = try character_rig_session.handle(std.testing.allocator, mirror);
    defer std.testing.allocator.free(mirror_reply);
    var mirrored = try parseReply(std.testing.allocator, mirror_reply);
    defer mirrored.deinit();
    try std.testing.expect(mirrored.value.object.get("ok").?.bool);

    const inspect_request = try inspectRequest(std.testing.allocator, session_id, 2, "{\"kind\":\"skeleton\"}");
    defer std.testing.allocator.free(inspect_request);
    const inspect_reply = try character_rig_session.handle(std.testing.allocator, inspect_request);
    defer std.testing.allocator.free(inspect_reply);
    var inspected = try parseReply(std.testing.allocator, inspect_reply);
    defer inspected.deinit();
    const right = try inspectedBone(inspected.value.object.get("value").?.object, "lower_arm_right");
    const origin = right.get("origin").?.array.items;
    try std.testing.expectApproxEqAbs(@as(f32, 0.81), numberAsF32(origin[0]), 1.0e-5);
    try std.testing.expectApproxEqAbs(@as(f32, 1.41), numberAsF32(origin[1]), 1.0e-5);
    try std.testing.expectApproxEqAbs(@as(f32, 0.07), numberAsF32(origin[2]), 1.0e-5);
}

test "native rig history journals authoring commands and preserves live inspection state" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    const open_request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(open_request);
    const open_reply = try character_rig_session.handle(std.testing.allocator, open_request);
    defer std.testing.allocator.free(open_reply);
    var opened = try parseReply(std.testing.allocator, open_reply);
    defer opened.deinit();
    const opened_snapshot = opened.value.object.get("value").?.object;
    const session_id = opened_snapshot.get("sessionId").?.string;
    const original_pelvis = bonePosition(try snapshotBone(opened_snapshot, "pelvis"));
    try expectHistory(opened_snapshot, 0, 0);

    const transform_request = try commandRequest(
        std.testing.allocator,
        session_id,
        0,
        "{\"kind\":\"setJointTransform\",\"boneId\":\"pelvis\",\"preserveChildren\":true,\"transform\":{\"pos\":[0,0.8,0],\"rot\":[0,0,0,1],\"scale\":[1,1,1]}}",
    );
    defer std.testing.allocator.free(transform_request);
    const transform_reply = try character_rig_session.handle(std.testing.allocator, transform_request);
    defer std.testing.allocator.free(transform_reply);
    var transformed = try parseReply(std.testing.allocator, transform_reply);
    defer transformed.deinit();
    const transformed_snapshot = transformed.value.object.get("value").?.object;
    try std.testing.expectEqual(@as(i64, 1), transformed_snapshot.get("revision").?.integer);
    try expectHistory(transformed_snapshot, 1, 0);
    const transformed_pelvis = try snapshotBone(transformed_snapshot, "pelvis");
    try std.testing.expectApproxEqAbs(@as(f32, 0.8), bonePosition(transformed_pelvis)[1], 1.0e-6);
    try std.testing.expectEqualStrings("manual", transformed_pelvis.get("fit").?.object.get("source").?.string);
    try std.testing.expect(transformed_pelvis.get("fit").?.object.get("locked").?.bool);

    const select_request = try commandRequest(
        std.testing.allocator,
        session_id,
        1,
        "{\"kind\":\"selectBone\",\"boneId\":\"pelvis\"}",
    );
    defer std.testing.allocator.free(select_request);
    const select_reply = try character_rig_session.handle(std.testing.allocator, select_request);
    defer std.testing.allocator.free(select_reply);
    var selected = try parseReply(std.testing.allocator, select_reply);
    defer selected.deinit();
    try expectHistory(selected.value.object.get("value").?.object, 1, 0);

    const overlay_request = try commandRequest(
        std.testing.allocator,
        session_id,
        2,
        "{\"kind\":\"setOverlay\",\"overlay\":{\"axes\":false,\"names\":false}}",
    );
    defer std.testing.allocator.free(overlay_request);
    const overlay_reply = try character_rig_session.handle(std.testing.allocator, overlay_request);
    defer std.testing.allocator.free(overlay_reply);
    var overlay_changed = try parseReply(std.testing.allocator, overlay_reply);
    defer overlay_changed.deinit();
    try expectHistory(overlay_changed.value.object.get("value").?.object, 1, 0);

    const undo_request = try commandRequest(std.testing.allocator, session_id, 3, "{\"kind\":\"undo\"}");
    defer std.testing.allocator.free(undo_request);
    const undo_reply = try character_rig_session.handle(std.testing.allocator, undo_request);
    defer std.testing.allocator.free(undo_reply);
    var undone = try parseReply(std.testing.allocator, undo_reply);
    defer undone.deinit();
    const undone_snapshot = undone.value.object.get("value").?.object;
    try std.testing.expectEqual(@as(i64, 4), undone_snapshot.get("revision").?.integer);
    try expectHistory(undone_snapshot, 0, 1);
    try std.testing.expectApproxEqAbs(original_pelvis[1], bonePosition(try snapshotBone(undone_snapshot, "pelvis"))[1], 1.0e-6);
    try std.testing.expectEqualStrings("pelvis", undone_snapshot.get("selectedBoneId").?.string);
    try std.testing.expect(!undone_snapshot.get("overlay").?.object.get("axes").?.bool);
    try std.testing.expect(!undone_snapshot.get("overlay").?.object.get("names").?.bool);
    const restored_fit = (try snapshotBone(undone_snapshot, "pelvis")).get("fit").?.object;
    try std.testing.expectEqualStrings("template", restored_fit.get("source").?.string);
    try std.testing.expect(!restored_fit.get("locked").?.bool);

    // A rejected authored edit is exactly transactional: no revision, undo
    // point, or redo branch changes.
    const invalid_request = try commandRequest(
        std.testing.allocator,
        session_id,
        4,
        "{\"kind\":\"setJointTransform\",\"boneId\":\"spine_lower\",\"preserveChildren\":true,\"transform\":{\"pos\":[0,0,0],\"rot\":[0,0,0,1],\"scale\":[1,1,1]}}",
    );
    defer std.testing.allocator.free(invalid_request);
    const invalid_reply = try character_rig_session.handle(std.testing.allocator, invalid_request);
    defer std.testing.allocator.free(invalid_reply);
    var invalid = try parseReply(std.testing.allocator, invalid_reply);
    defer invalid.deinit();
    try std.testing.expect(!invalid.value.object.get("ok").?.bool);
    try std.testing.expectEqual(@as(i64, 4), invalid.value.object.get("currentRevision").?.integer);

    const after_invalid_request = try snapshotRequest(std.testing.allocator, session_id, 4);
    defer std.testing.allocator.free(after_invalid_request);
    const after_invalid_reply = try character_rig_session.handle(std.testing.allocator, after_invalid_request);
    defer std.testing.allocator.free(after_invalid_reply);
    var after_invalid = try parseReply(std.testing.allocator, after_invalid_reply);
    defer after_invalid.deinit();
    try expectHistory(after_invalid.value.object.get("value").?.object, 0, 1);

    const redo_request = try commandRequest(std.testing.allocator, session_id, 4, "{\"kind\":\"redo\"}");
    defer std.testing.allocator.free(redo_request);
    const redo_reply = try character_rig_session.handle(std.testing.allocator, redo_request);
    defer std.testing.allocator.free(redo_reply);
    var redone = try parseReply(std.testing.allocator, redo_reply);
    defer redone.deinit();
    const redone_snapshot = redone.value.object.get("value").?.object;
    try std.testing.expectEqual(@as(i64, 5), redone_snapshot.get("revision").?.integer);
    try expectHistory(redone_snapshot, 1, 0);
    try std.testing.expectApproxEqAbs(@as(f32, 0.8), bonePosition(try snapshotBone(redone_snapshot, "pelvis"))[1], 1.0e-6);

    const second_undo_request = try commandRequest(std.testing.allocator, session_id, 5, "{\"kind\":\"undo\"}");
    defer std.testing.allocator.free(second_undo_request);
    const second_undo_reply = try character_rig_session.handle(std.testing.allocator, second_undo_request);
    defer std.testing.allocator.free(second_undo_reply);
    var second_undo = try parseReply(std.testing.allocator, second_undo_reply);
    defer second_undo.deinit();
    try expectHistory(second_undo.value.object.get("value").?.object, 0, 1);

    const branch_request = try commandRequest(
        std.testing.allocator,
        session_id,
        6,
        "{\"kind\":\"setJointLock\",\"boneId\":\"pelvis\",\"locked\":true}",
    );
    defer std.testing.allocator.free(branch_request);
    const branch_reply = try character_rig_session.handle(std.testing.allocator, branch_request);
    defer std.testing.allocator.free(branch_reply);
    var branched = try parseReply(std.testing.allocator, branch_reply);
    defer branched.deinit();
    try expectHistory(branched.value.object.get("value").?.object, 1, 0);

    const abandoned_redo_request = try commandRequest(std.testing.allocator, session_id, 7, "{\"kind\":\"redo\"}");
    defer std.testing.allocator.free(abandoned_redo_request);
    const abandoned_redo_reply = try character_rig_session.handle(std.testing.allocator, abandoned_redo_request);
    defer std.testing.allocator.free(abandoned_redo_reply);
    var abandoned_redo = try parseReply(std.testing.allocator, abandoned_redo_reply);
    defer abandoned_redo.deinit();
    try std.testing.expect(!abandoned_redo.value.object.get("ok").?.bool);
    try std.testing.expectEqual(@as(i64, 7), abandoned_redo.value.object.get("currentRevision").?.integer);
}

test "object-binding history restores descriptor state and complete binding rows" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    const open_request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(open_request);
    const open_reply = try character_rig_session.handle(std.testing.allocator, open_request);
    defer std.testing.allocator.free(open_reply);
    var opened = try parseReply(std.testing.allocator, open_reply);
    defer opened.deinit();
    const session_id = opened.value.object.get("value").?.object.get("sessionId").?.string;

    const bind_object_request = try commandRequest(
        std.testing.allocator,
        session_id,
        0,
        "{\"kind\":\"setObjectBinding\",\"binding\":{\"objectId\":\"hat-object\",\"mode\":\"rigid\",\"boneId\":\"head\"}}",
    );
    defer std.testing.allocator.free(bind_object_request);
    const bind_object_reply = try character_rig_session.handle(std.testing.allocator, bind_object_request);
    defer std.testing.allocator.free(bind_object_reply);
    var bound_object = try parseReply(std.testing.allocator, bind_object_reply);
    defer bound_object.deinit();
    const bound_snapshot = bound_object.value.object.get("value").?.object;
    try std.testing.expectEqualStrings("needs_bind", bound_snapshot.get("state").?.string);
    try std.testing.expectEqual(@as(usize, 2), bound_snapshot.get("objectBindings").?.array.items.len);
    try expectHistory(bound_snapshot, 1, 0);

    const undo_request = try commandRequest(std.testing.allocator, session_id, 1, "{\"kind\":\"undo\"}");
    defer std.testing.allocator.free(undo_request);
    const undo_reply = try character_rig_session.handle(std.testing.allocator, undo_request);
    defer std.testing.allocator.free(undo_reply);
    var undone = try parseReply(std.testing.allocator, undo_reply);
    defer undone.deinit();
    const undone_snapshot = undone.value.object.get("value").?.object;
    try std.testing.expectEqualStrings("draft", undone_snapshot.get("state").?.string);
    try std.testing.expectEqual(@as(usize, 1), undone_snapshot.get("objectBindings").?.array.items.len);
    try std.testing.expectEqualStrings(
        "body-object",
        undone_snapshot.get("objectBindings").?.array.items[0].object.get("objectId").?.string,
    );
    try expectHistory(undone_snapshot, 0, 1);

    const redo_request = try commandRequest(std.testing.allocator, session_id, 2, "{\"kind\":\"redo\"}");
    defer std.testing.allocator.free(redo_request);
    const redo_reply = try character_rig_session.handle(std.testing.allocator, redo_request);
    defer std.testing.allocator.free(redo_reply);
    var redone = try parseReply(std.testing.allocator, redo_reply);
    defer redone.deinit();
    const redone_snapshot = redone.value.object.get("value").?.object;
    try std.testing.expectEqualStrings("needs_bind", redone_snapshot.get("state").?.string);
    try std.testing.expectEqual(@as(usize, 2), redone_snapshot.get("objectBindings").?.array.items.len);
    try std.testing.expectEqualStrings(
        "hat-object",
        redone_snapshot.get("objectBindings").?.array.items[1].object.get("objectId").?.string,
    );
    try expectHistory(redone_snapshot, 1, 0);
}

test "empty stale and authored no-op history commands preserve revision and redo" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    const open_request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(open_request);
    const open_reply = try character_rig_session.handle(std.testing.allocator, open_request);
    defer std.testing.allocator.free(open_reply);
    var opened = try parseReply(std.testing.allocator, open_reply);
    defer opened.deinit();
    const session_id = opened.value.object.get("value").?.object.get("sessionId").?.string;

    const empty_undo_request = try commandRequest(std.testing.allocator, session_id, 0, "{\"kind\":\"undo\"}");
    defer std.testing.allocator.free(empty_undo_request);
    const empty_undo_reply = try character_rig_session.handle(std.testing.allocator, empty_undo_request);
    defer std.testing.allocator.free(empty_undo_reply);
    var empty_undo = try parseReply(std.testing.allocator, empty_undo_reply);
    defer empty_undo.deinit();
    try std.testing.expect(!empty_undo.value.object.get("ok").?.bool);
    try std.testing.expectEqual(@as(i64, 0), empty_undo.value.object.get("currentRevision").?.integer);

    const lock_request = try commandRequest(
        std.testing.allocator,
        session_id,
        0,
        "{\"kind\":\"setJointLock\",\"boneId\":\"pelvis\",\"locked\":true}",
    );
    defer std.testing.allocator.free(lock_request);
    const lock_reply = try character_rig_session.handle(std.testing.allocator, lock_request);
    defer std.testing.allocator.free(lock_reply);
    var locked = try parseReply(std.testing.allocator, lock_reply);
    defer locked.deinit();
    try expectHistory(locked.value.object.get("value").?.object, 1, 0);

    const undo_request = try commandRequest(std.testing.allocator, session_id, 1, "{\"kind\":\"undo\"}");
    defer std.testing.allocator.free(undo_request);
    const undo_reply = try character_rig_session.handle(std.testing.allocator, undo_request);
    defer std.testing.allocator.free(undo_reply);
    var undone = try parseReply(std.testing.allocator, undo_reply);
    defer undone.deinit();
    try expectHistory(undone.value.object.get("value").?.object, 0, 1);

    // The requested value already matches the restored authored state. It is
    // acknowledged as revision 3, but creates no undo and keeps redo intact.
    const noop_request = try commandRequest(
        std.testing.allocator,
        session_id,
        2,
        "{\"kind\":\"setJointLock\",\"boneId\":\"pelvis\",\"locked\":false}",
    );
    defer std.testing.allocator.free(noop_request);
    const noop_reply = try character_rig_session.handle(std.testing.allocator, noop_request);
    defer std.testing.allocator.free(noop_reply);
    var noop = try parseReply(std.testing.allocator, noop_reply);
    defer noop.deinit();
    const noop_snapshot = noop.value.object.get("value").?.object;
    try std.testing.expectEqual(@as(i64, 3), noop_snapshot.get("revision").?.integer);
    try expectHistory(noop_snapshot, 0, 1);

    const redo_request = try commandRequest(std.testing.allocator, session_id, 3, "{\"kind\":\"redo\"}");
    defer std.testing.allocator.free(redo_request);
    const redo_reply = try character_rig_session.handle(std.testing.allocator, redo_request);
    defer std.testing.allocator.free(redo_reply);
    var redone = try parseReply(std.testing.allocator, redo_reply);
    defer redone.deinit();
    const redone_snapshot = redone.value.object.get("value").?.object;
    try std.testing.expectEqual(@as(i64, 4), redone_snapshot.get("revision").?.integer);
    try expectHistory(redone_snapshot, 1, 0);
    try std.testing.expect((try snapshotBone(redone_snapshot, "pelvis")).get("fit").?.object.get("locked").?.bool);

    const stale_undo_request = try commandRequest(std.testing.allocator, session_id, 3, "{\"kind\":\"undo\"}");
    defer std.testing.allocator.free(stale_undo_request);
    const stale_undo_reply = try character_rig_session.handle(std.testing.allocator, stale_undo_request);
    defer std.testing.allocator.free(stale_undo_reply);
    var stale_undo = try parseReply(std.testing.allocator, stale_undo_reply);
    defer stale_undo.deinit();
    try std.testing.expect(!stale_undo.value.object.get("ok").?.bool);
    try std.testing.expectEqual(@as(i64, 4), stale_undo.value.object.get("currentRevision").?.integer);

    const after_stale_request = try snapshotRequest(std.testing.allocator, session_id, 4);
    defer std.testing.allocator.free(after_stale_request);
    const after_stale_reply = try character_rig_session.handle(std.testing.allocator, after_stale_request);
    defer std.testing.allocator.free(after_stale_reply);
    var after_stale = try parseReply(std.testing.allocator, after_stale_reply);
    defer after_stale.deinit();
    try expectHistory(after_stale.value.object.get("value").?.object, 1, 0);
}

test "exercise mounts a built-in clip, parks exactly, ticks while playing, and yields to the test pose" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    const open_request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(open_request);
    const open_reply = try character_rig_session.handle(std.testing.allocator, open_request);
    defer std.testing.allocator.free(open_reply);
    var opened = try parseReply(std.testing.allocator, open_reply);
    defer opened.deinit();
    const open_value = opened.value.object.get("value").?.object;
    try std.testing.expect(open_value.get("exercise").? == .null);
    const session_id = try std.testing.allocator.dupe(u8, open_value.get("sessionId").?.string);
    defer std.testing.allocator.free(session_id);

    // The exercise clock advances only for a deliberately active rig viewport.
    const viewport_request = try commandRequest(std.testing.allocator, session_id, 0, "{\"kind\":\"setViewportActive\",\"active\":true}");
    defer std.testing.allocator.free(viewport_request);
    const viewport_reply = try character_rig_session.handle(std.testing.allocator, viewport_request);
    defer std.testing.allocator.free(viewport_reply);
    var viewport = try parseReply(std.testing.allocator, viewport_reply);
    defer viewport.deinit();
    try std.testing.expect(viewport.value.object.get("ok").?.bool);

    const mount_request = try commandRequest(std.testing.allocator, session_id, 1, "{\"kind\":\"mountExercise\",\"source\":\"clip:walk\"}");
    defer std.testing.allocator.free(mount_request);
    const mount_reply = try character_rig_session.handle(std.testing.allocator, mount_request);
    defer std.testing.allocator.free(mount_reply);
    var mounted = try parseReply(std.testing.allocator, mount_reply);
    defer mounted.deinit();
    try std.testing.expect(mounted.value.object.get("ok").?.bool);
    const mounted_exercise = mounted.value.object.get("value").?.object.get("exercise").?.object;
    try std.testing.expectEqualStrings("clip:walk", mounted_exercise.get("source").?.string);
    try std.testing.expect(mounted_exercise.get("playing").?.bool);
    try std.testing.expect(mounted_exercise.get("looping").?.bool);
    const channel_count = mounted_exercise.get("channelCount").?.integer;
    // The canonical skeleton's bone ids are the clip channel vocabulary: every
    // rotation channel must resolve, or the walk would half-animate silently.
    try std.testing.expectEqual(channel_count, mounted_exercise.get("matchedChannelCount").?.integer);

    // A playing exercise answers the frame clock with a full matrix set.
    const tick = character_rig_session.tickExercise(1.0 / 60.0) orelse return error.ExpectedExerciseTick;
    try std.testing.expectEqual(@as(usize, 24), tick.bone_count);
    try std.testing.expectEqual(@as(usize, 24), tick.pose_global.len);
    try std.testing.expectEqual(@as(usize, 24), tick.skin_matrices.len);

    const park_request = try commandRequest(std.testing.allocator, session_id, 2, "{\"kind\":\"parkExercise\",\"seconds\":0.25}");
    defer std.testing.allocator.free(park_request);
    const park_reply = try character_rig_session.handle(std.testing.allocator, park_request);
    defer std.testing.allocator.free(park_reply);
    var parked = try parseReply(std.testing.allocator, park_reply);
    defer parked.deinit();
    try std.testing.expect(parked.value.object.get("ok").?.bool);
    const parked_exercise = parked.value.object.get("value").?.object.get("exercise").?.object;
    try std.testing.expect(!parked_exercise.get("playing").?.bool);
    try std.testing.expectApproxEqAbs(@as(f64, 0.25), switch (parked_exercise.get("playheadSeconds").?) {
        .float => |value| value,
        .integer => |value| @as(f64, @floatFromInt(value)),
        else => return error.MalformedPlayhead,
    }, 1e-6);

    // Parked means parked: the frame clock is refused, the exact pose holds.
    try std.testing.expect(character_rig_session.tickExercise(1.0 / 60.0) == null);

    const resume_request = try commandRequest(std.testing.allocator, session_id, 3, "{\"kind\":\"resumeExercise\"}");
    defer std.testing.allocator.free(resume_request);
    const resume_reply = try character_rig_session.handle(std.testing.allocator, resume_request);
    defer std.testing.allocator.free(resume_reply);
    var resumed = try parseReply(std.testing.allocator, resume_reply);
    defer resumed.deinit();
    try std.testing.expect(resumed.value.object.get("ok").?.bool);
    try std.testing.expect(resumed.value.object.get("value").?.object.get("exercise").?.object.get("playing").?.bool);

    // The exercise and the test pose are two writers to one displayed slot;
    // the last writer answers.
    const pose_request = try commandRequest(std.testing.allocator, session_id, 4, "{\"kind\":\"setTestPose\",\"pose\":{\"name\":\"shoulder_abduction\",\"side\":\"both\"}}");
    defer std.testing.allocator.free(pose_request);
    const pose_reply = try character_rig_session.handle(std.testing.allocator, pose_request);
    defer std.testing.allocator.free(pose_reply);
    var posed = try parseReply(std.testing.allocator, pose_reply);
    defer posed.deinit();
    try std.testing.expect(posed.value.object.get("ok").?.bool);
    try std.testing.expect(posed.value.object.get("value").?.object.get("exercise").? == .null);
    try std.testing.expect(character_rig_session.tickExercise(1.0 / 60.0) == null);
}

test "exercise refuses unknown clips and stays view-state outside undo history" {
    character_rig_session.resetForTests();
    defer character_rig_session.resetForTests();

    const open_request = try openRequest(std.testing.allocator, false);
    defer std.testing.allocator.free(open_request);
    const open_reply = try character_rig_session.handle(std.testing.allocator, open_request);
    defer std.testing.allocator.free(open_reply);
    var opened = try parseReply(std.testing.allocator, open_reply);
    defer opened.deinit();
    const open_value = opened.value.object.get("value").?.object;
    const session_id = try std.testing.allocator.dupe(u8, open_value.get("sessionId").?.string);
    defer std.testing.allocator.free(session_id);

    const bad_request = try commandRequest(std.testing.allocator, session_id, 0, "{\"kind\":\"mountExercise\",\"source\":\"clip:moonwalk\"}");
    defer std.testing.allocator.free(bad_request);
    const bad_reply = try character_rig_session.handle(std.testing.allocator, bad_request);
    defer std.testing.allocator.free(bad_reply);
    var refused = try parseReply(std.testing.allocator, bad_reply);
    defer refused.deinit();
    try std.testing.expect(!refused.value.object.get("ok").?.bool);

    const mount_request = try commandRequest(std.testing.allocator, session_id, 0, "{\"kind\":\"mountExercise\",\"source\":\"clip:idle\"}");
    defer std.testing.allocator.free(mount_request);
    const mount_reply = try character_rig_session.handle(std.testing.allocator, mount_request);
    defer std.testing.allocator.free(mount_reply);
    var mounted = try parseReply(std.testing.allocator, mount_reply);
    defer mounted.deinit();
    try std.testing.expect(mounted.value.object.get("ok").?.bool);
    const mounted_snapshot = mounted.value.object.get("value").?.object;
    try std.testing.expectEqualStrings("clip:idle", mounted_snapshot.get("exercise").?.object.get("source").?.string);
    // Mounting motion is rehearsal, not authoring: no undo unit may appear.
    try expectHistory(mounted_snapshot, 0, 0);
}
